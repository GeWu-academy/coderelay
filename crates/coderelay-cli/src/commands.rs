use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, bail};
use coderelay_core::agents::ProbeDisplayStatus;
use coderelay_core::router::jev;
use coderelay_core::{
    AgentEvent, AgentId, AgentRunOptions, AgentRunStatus, CliCandidate, CliDiagnostic, CliRuntime,
    CliSource, DiagnosticLevel, ModelCatalog, RouteRequest, RoutingMode, SessionStore,
    default_session_db_path, start_agent_run,
};
use coderelay_protocol::PROTOCOL_VERSION;
use serde::Serialize;

use crate::context::{agent_label, load_context};
use crate::jev::JevHttpClient;

#[derive(Debug, Clone, Default)]
pub struct CommonArgs {
    pub cwd: Option<PathBuf>,
    pub config: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct RunArgs {
    pub prompt: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub mode: Option<RoutingMode>,
    pub files: Vec<String>,
    pub language: Option<String>,
    pub context_size: Option<u64>,
    pub required_strengths: Vec<coderelay_core::ModelStrength>,
    pub timeout_ms: Option<u64>,
    pub common: CommonArgs,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListEntry {
    pub id: AgentId,
    pub label: String,
    pub enabled: bool,
    pub is_default: bool,
    pub available: bool,
    pub command: String,
    pub path: String,
    pub version: Option<String>,
    pub models: Vec<String>,
    pub runtime: CliRuntime,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distro: Option<String>,
    pub source: CliSource,
    pub candidates: Vec<CliCandidate>,
    pub diagnostics: Vec<CliDiagnostic>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DoctorStatus {
    Ok,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheck {
    pub name: String,
    pub status: DoctorStatus,
    pub message: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub core_version: &'static str,
    pub protocol_version: u32,
    pub checks: Vec<DoctorCheck>,
    pub ok: bool,
}

fn runtime_label(runtime: CliRuntime) -> &'static str {
    match runtime {
        CliRuntime::Local => "local",
        CliRuntime::Wsl => "wsl",
    }
}

fn source_label(source: CliSource) -> &'static str {
    match source {
        CliSource::Path => "path",
        CliSource::Npm => "npm",
        CliSource::Bun => "bun",
        CliSource::Pnpm => "pnpm",
        CliSource::Yarn => "yarn",
        CliSource::Brew => "brew",
        CliSource::Winget => "winget",
        CliSource::Installer => "installer",
        CliSource::Nix => "nix",
        CliSource::Mise => "mise",
        CliSource::Fallback => "fallback",
    }
}

fn probe_status_label(status: ProbeDisplayStatus) -> &'static str {
    match status {
        ProbeDisplayStatus::Scanning => "scanning",
        ProbeDisplayStatus::Found => "found",
        ProbeDisplayStatus::Unprobed => "unprobed",
        ProbeDisplayStatus::NotInstalled => "not-installed",
        ProbeDisplayStatus::Disabled => "disabled",
    }
}

fn diagnostic_level(level: DiagnosticLevel) -> &'static str {
    match level {
        DiagnosticLevel::Info => "info",
        DiagnosticLevel::Warn => "warn",
    }
}

pub fn build_agent_entries(context: &crate::context::CliContext) -> Vec<AgentListEntry> {
    context
        .detected
        .iter()
        .map(|detected| {
            let config = context.config().agents.get(&detected.id);
            let command = config
                .and_then(|config| config.command.clone())
                .filter(|command| !command.trim().is_empty())
                .unwrap_or_else(|| {
                    if detected.path.is_empty() {
                        detected.bin.clone()
                    } else {
                        detected.path.clone()
                    }
                });
            AgentListEntry {
                id: detected.id,
                label: agent_label(detected.id).to_owned(),
                enabled: config.is_none_or(|config| config.enabled),
                is_default: context.config().default_agent == detected.id,
                available: detected.available,
                command,
                path: detected.path.clone(),
                version: detected.version.clone(),
                models: config
                    .map(|config| config.models.iter().map(|model| model.id.clone()).collect())
                    .unwrap_or_default(),
                runtime: detected.runtime,
                distro: detected.distro.clone(),
                source: detected.source,
                candidates: detected.candidates.clone(),
                diagnostics: detected.diagnostics.clone(),
            }
        })
        .collect()
}

fn format_agent_entries(entries: &[AgentListEntry]) -> String {
    entries
        .iter()
        .map(|entry| {
            let mut lines = vec![
                format!(
                    "{} ({}) [{}{}]",
                    entry.label,
                    entry.id,
                    if entry.enabled { "enabled" } else { "disabled" },
                    if entry.is_default { " default" } else { "" }
                ),
                format!(
                    "  status: {}",
                    entry.version.as_deref().unwrap_or(if entry.available {
                        "available（版本未知）"
                    } else {
                        "not found"
                    })
                ),
                format!(
                    "  runtime: {}{}",
                    runtime_label(entry.runtime),
                    entry
                        .distro
                        .as_deref()
                        .map(|distro| format!(" ({distro})"))
                        .unwrap_or_default()
                ),
                format!("  command: {}", entry.command),
                format!("  source: {}", source_label(entry.source)),
            ];
            if !entry.path.is_empty() {
                lines.push(format!("  path: {}", entry.path));
            }
            if !entry.models.is_empty() {
                lines.push(format!("  models: {}", entry.models.join(", ")));
            }
            for diagnostic in &entry.diagnostics {
                lines.push(format!(
                    "  {}: {}",
                    diagnostic_level(diagnostic.level),
                    diagnostic.message
                ));
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub async fn agents(args: CommonArgs, json: bool) -> i32 {
    let result = (|| -> anyhow::Result<Vec<AgentListEntry>> {
        let context = load_context(args.cwd.as_deref(), args.config.as_deref())?;
        Ok(build_agent_entries(&context))
    })();

    match result {
        Ok(entries) if json => match serde_json::to_string_pretty(&entries) {
            Ok(output) => {
                println!("{output}");
                0
            }
            Err(error) => {
                eprintln!("coderelay agents: {error}");
                1
            }
        },
        Ok(entries) => {
            println!("{}", format_agent_entries(&entries));
            0
        }
        Err(error) => {
            eprintln!("coderelay agents: {error:#}");
            1
        }
    }
}

fn format_models(catalog: &ModelCatalog) -> String {
    catalog
        .probes
        .iter()
        .map(|probe| {
            let mut lines = vec![format!(
                "{} ({}) [{}]",
                agent_label(probe.cli_id),
                probe.cli_id,
                probe_status_label(probe.status)
            )];
            if probe.models.is_empty() {
                if let Some(reason) = &probe.reason {
                    lines.push(format!("  {reason}"));
                }
            } else {
                for model in &probe.models {
                    let label = if model.label != model.model_id {
                        format!(" ({})", model.label)
                    } else {
                        String::new()
                    };
                    let default = if model.is_default { " [default]" } else { "" };
                    let strengths = if model.strengths.is_empty() {
                        String::new()
                    } else {
                        format!(
                            " [{}]",
                            model
                                .strengths
                                .iter()
                                .map(|strength| strength.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        )
                    };
                    let model_id = if model.model_id.is_empty() {
                        "(adapter default)"
                    } else {
                        &model.model_id
                    };
                    lines.push(format!("  - {model_id}{label}{default}{strengths}"));
                }
            }
            lines.join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub async fn models(args: CommonArgs, json: bool) -> i32 {
    let result = (|| -> anyhow::Result<ModelCatalog> {
        let context = load_context(args.cwd.as_deref(), args.config.as_deref())?;
        Ok(context.catalog)
    })();

    match result {
        Ok(catalog) if json => match serde_json::to_string_pretty(&catalog) {
            Ok(output) => {
                println!("{output}");
                0
            }
            Err(error) => {
                eprintln!("coderelay models: {error}");
                1
            }
        },
        Ok(catalog) => {
            println!("{}", format_models(&catalog));
            0
        }
        Err(error) => {
            eprintln!("coderelay models: {error:#}");
            1
        }
    }
}

fn build_doctor_report(context: &crate::context::CliContext) -> DoctorReport {
    let mut checks = vec![
        match context.loaded_config.path.as_ref() {
            Some(path) => DoctorCheck {
                name: "config".to_owned(),
                status: DoctorStatus::Ok,
                message: format!("loaded {}", path.display()),
                details: Vec::new(),
            },
            None => DoctorCheck {
                name: "config".to_owned(),
                status: DoctorStatus::Warn,
                message: "no config file found; using built-in defaults".to_owned(),
                details: Vec::new(),
            },
        },
        DoctorCheck {
            name: "environment".to_owned(),
            status: DoctorStatus::Ok,
            message: format!(
                "{:?} · {}",
                context.scanner_options.platform,
                context.cwd.display()
            ),
            details: Vec::new(),
        },
        DoctorCheck {
            name: "default agent".to_owned(),
            status: DoctorStatus::Ok,
            message: context.config().default_agent.to_string(),
            details: Vec::new(),
        },
    ];

    for probe in &context.catalog.probes {
        let configured = context.config().agents.get(&probe.cli_id);
        let enabled = configured.is_none_or(|config| config.enabled);
        let explicitly_enabled = configured.is_some_and(|config| config.enabled);
        let required = explicitly_enabled || context.config().default_agent == probe.cli_id;
        let detected = context.detected(probe.cli_id);
        let status = if !enabled {
            DoctorStatus::Warn
        } else if detected.is_some_and(|detected| detected.available) {
            if probe.status == ProbeDisplayStatus::Found {
                DoctorStatus::Ok
            } else {
                DoctorStatus::Warn
            }
        } else if required {
            DoctorStatus::Error
        } else {
            DoctorStatus::Warn
        };
        let message = if let Some(detected) = detected.filter(|detected| detected.available) {
            format!(
                "{} · {} · models: {}",
                detected.path,
                detected.version.as_deref().unwrap_or("unknown version"),
                probe_status_label(probe.status)
            )
        } else if enabled {
            format!("not found · models: {}", probe_status_label(probe.status))
        } else {
            "disabled".to_owned()
        };
        checks.push(DoctorCheck {
            name: format!("agent {}", probe.cli_id),
            status,
            message,
            details: probe.reason.clone().into_iter().collect(),
        });
    }

    let ok = checks
        .iter()
        .all(|check| check.status != DoctorStatus::Error);
    DoctorReport {
        core_version: coderelay_core::CORE_VERSION,
        protocol_version: PROTOCOL_VERSION,
        checks,
        ok,
    }
}

fn format_doctor(report: &DoctorReport) -> String {
    report
        .checks
        .iter()
        .flat_map(|check| {
            let status = match check.status {
                DoctorStatus::Ok => "ok",
                DoctorStatus::Warn => "warn",
                DoctorStatus::Error => "error",
            };
            std::iter::once(format!("{status:<5} {}: {}", check.name, check.message))
                .chain(check.details.iter().map(|detail| format!("      {detail}")))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub async fn doctor(args: CommonArgs, json: bool) -> i32 {
    let result = (|| -> anyhow::Result<DoctorReport> {
        let context = load_context(args.cwd.as_deref(), args.config.as_deref())?;
        Ok(build_doctor_report(&context))
    })();

    match result {
        Ok(report) if json => match serde_json::to_string_pretty(&report) {
            Ok(output) => {
                println!("{output}");
                if report.ok { 0 } else { 1 }
            }
            Err(error) => {
                eprintln!("coderelay doctor: {error}");
                1
            }
        },
        Ok(report) => {
            println!("{}", format_doctor(&report));
            if report.ok { 0 } else { 1 }
        }
        Err(error) => {
            eprintln!("coderelay doctor: {error:#}");
            1
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FavoriteResult {
    favorite_agent: Option<AgentId>,
    changed: bool,
    message: String,
}

pub async fn favorite(agent: Option<String>, json: bool) -> i32 {
    let result = (|| -> anyhow::Result<FavoriteResult> {
        let home_dir = dirs::home_dir().context("resolve home directory")?;
        let environment: std::collections::BTreeMap<String, String> = std::env::vars().collect();
        let coderelay_home = environment.get("CODERELAY_HOME").map(PathBuf::from);
        let path = default_session_db_path(Some(&home_dir), coderelay_home.as_deref())
            .context("resolve session database path")?;
        let mut store = SessionStore::open(path)?;

        let raw = agent
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if let Some(raw) = raw {
            if matches!(raw, "clear" | "none") {
                store.clear_favorite_agent()?;
                return Ok(FavoriteResult {
                    favorite_agent: None,
                    changed: true,
                    message: "已清除最喜欢的初始化 agent 偏好。".to_owned(),
                });
            }
            let agent_id = raw
                .parse::<AgentId>()
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            store.set_favorite_agent(agent_id)?;
            return Ok(FavoriteResult {
                favorite_agent: Some(agent_id),
                changed: true,
                message: format!(
                    "已将 {} ({agent_id}) 设为最喜欢的初始化 agent。",
                    agent_label(agent_id)
                ),
            });
        }

        let favorite_agent = store.get_favorite_agent()?;
        Ok(FavoriteResult {
            message: favorite_agent
                .map(|agent| format!("当前最喜欢的初始化 agent: {} ({agent})", agent_label(agent)))
                .unwrap_or_else(|| "尚未设置最喜欢的初始化 agent。".to_owned()),
            favorite_agent,
            changed: false,
        })
    })();

    match result {
        Ok(result) if json => match serde_json::to_string_pretty(&result) {
            Ok(output) => {
                println!("{output}");
                0
            }
            Err(error) => {
                eprintln!("coderelay favorite: {error}");
                1
            }
        },
        Ok(result) => {
            println!("{}", result.message);
            0
        }
        Err(error) => {
            eprintln!("coderelay favorite: {error:#}");
            1
        }
    }
}

fn write_event(event: &AgentEvent) {
    match event {
        AgentEvent::AssistantText { text } => {
            print!("{text}");
            let _ = io::stdout().flush();
        }
        AgentEvent::Stderr { text } => {
            eprint!("{text}");
            let _ = io::stderr().flush();
        }
        AgentEvent::ToolStarted { tool } => {
            eprintln!("coderelay: 正在执行工具：{tool}");
        }
        AgentEvent::Status { text } => {
            eprintln!("coderelay: {text}");
        }
        AgentEvent::ToolFinished { .. }
        | AgentEvent::SessionStarted { .. }
        | AgentEvent::Completed { .. }
        | AgentEvent::Failed { .. }
        | AgentEvent::Aborted { .. } => {}
    }
}

pub async fn run(args: RunArgs) -> i32 {
    match run_inner(args).await {
        Ok(code) => code,
        Err(error) => {
            eprintln!("coderelay run: {error:#}");
            1
        }
    }
}

async fn run_inner(args: RunArgs) -> anyhow::Result<i32> {
    let prompt = args.prompt.trim();
    if prompt.is_empty() {
        bail!("prompt must not be empty");
    }

    let context = load_context(args.common.cwd.as_deref(), args.common.config.as_deref())?;
    let request = RouteRequest {
        prompt: prompt.to_owned(),
        files: (!args.files.is_empty()).then_some(args.files.clone()),
        language: args.language.clone(),
        context_size: args.context_size,
        required_strengths: (!args.required_strengths.is_empty())
            .then_some(args.required_strengths.clone()),
    };
    let mode = args.mode.unwrap_or(context.config().routing.mode);

    let (agent, model, reasons) = if args.agent.is_some() || args.model.is_some() {
        let selection = context.select(
            &request,
            args.agent.as_deref(),
            args.model.as_deref(),
            Some(mode),
        )?;
        (selection.agent, selection.model, selection.reasons)
    } else {
        match mode {
            RoutingMode::Manual => {
                bail!("routing.mode=manual 时，非交互 run 必须显式提供 --agent 或 --model")
            }
            RoutingMode::Jev => {
                let candidates = context.route_candidates();
                if candidates.is_empty() {
                    bail!("没有可用的已探测模型");
                }
                let client = JevHttpClient::from_config(
                    context.config(),
                    &context.cwd,
                    &context.environment,
                )
                .await?;
                let decision = jev::route_with_jev(&request, &candidates, &client).await?;
                (decision.agent, decision.model, decision.reasons)
            }
            RoutingMode::Local => {
                let selection = context.select(&request, None, None, Some(mode))?;
                (selection.agent, selection.model, selection.reasons)
            }
        }
    };

    let target_text = model
        .as_ref()
        .map(|model| format!("{agent}:{model}"))
        .unwrap_or_else(|| agent.to_string());
    eprintln!("coderelay: routing to {target_text}");
    for reason in reasons {
        eprintln!("coderelay: {reason}");
    }

    let prepared = context.prepare_agent(agent, model, prompt, None)?;
    if prepared.target.runtime == CliRuntime::Wsl && prepared.cwd.is_none() {
        eprintln!("coderelay: 无法把工作目录转换为 WSL 路径，将在 WSL 当前目录执行");
    }

    let mut options = AgentRunOptions::new(prepared.command);
    options.cwd = prepared.cwd;
    options.environment = prepared.environment;
    options.timeout = args.timeout_ms.map(Duration::from_millis);
    options.protocol = if prepared.structured {
        coderelay_core::AgentProtocol::Structured
    } else {
        coderelay_core::AgentProtocol::Text
    };
    options.target = Some(prepared.target);
    let mut handle = start_agent_run(options);
    let mut listen_for_ctrl_c = true;

    loop {
        tokio::select! {
            event = handle.events.recv() => {
                match event {
                    Some(event) => write_event(&event),
                    None => break,
                }
            }
            signal = tokio::signal::ctrl_c(), if listen_for_ctrl_c => {
                if signal.is_ok() {
                    listen_for_ctrl_c = false;
                    handle.abort();
                }
            }
        }
    }

    let result = handle.done.await.context("join agent run task")?;
    match result.status {
        AgentRunStatus::Completed => Ok(0),
        AgentRunStatus::Timeout => {
            eprintln!(
                "coderelay run: process timed out after {}ms",
                args.timeout_ms.unwrap_or(0)
            );
            Ok(124)
        }
        AgentRunStatus::Aborted => {
            eprintln!("coderelay run: process aborted");
            Ok(130)
        }
        AgentRunStatus::Failed | AgentRunStatus::SpawnError => {
            if !result.stderr_tail.trim().is_empty() {
                eprintln!("{}", result.stderr_tail.trim_end());
            }
            Ok(result.code.filter(|code| *code > 0).unwrap_or(1))
        }
    }
}
