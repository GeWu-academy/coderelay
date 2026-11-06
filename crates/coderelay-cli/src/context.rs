use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use coderelay_core::agents::{ModelProbeRoots, create_model_probes, probe_model_catalog};
use coderelay_core::config::{LoadConfigOptions, LoadedConfig, load_config};
use coderelay_core::host::{FileSystem, Platform, SystemHost};
use coderelay_core::scanner::{
    CliCandidate, CliRuntime, CliSource, DetectedCli, ScannerOptions, build_wsl_args,
    cli_definitions, cli_version, resolve_on_path, scan_coding_clis, to_wsl_path,
};
use coderelay_core::{
    AgentId, LaunchTarget, ModelCatalog, RouteCandidate, RouteOptions, RouteRequest, RoutingMode,
    build_prompt_args, build_route_candidates, route, to_route_candidates,
    validate_explicit_target,
};

pub struct CliContext {
    pub cwd: PathBuf,
    pub home_dir: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub loaded_config: LoadedConfig,
    pub detected: Vec<DetectedCli>,
    pub catalog: ModelCatalog,
    pub scanner_options: ScannerOptions,
}

pub struct RunSelection {
    pub agent: AgentId,
    pub model: Option<String>,
    pub candidate: Option<RouteCandidate>,
    pub reasons: Vec<String>,
}

pub struct PreparedAgent {
    pub target: LaunchTarget,
    pub command: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub structured: bool,
    pub environment: BTreeMap<String, String>,
}

pub fn agent_label(agent: AgentId) -> &'static str {
    match agent {
        AgentId::Codex => "Codex",
        AgentId::Claude => "Claude Code",
        AgentId::Pi => "Pi",
        AgentId::Omp => "OMP",
    }
}

fn resolve_cwd(cwd: Option<&Path>) -> anyhow::Result<PathBuf> {
    match cwd {
        Some(path) if path.is_absolute() => Ok(path.to_path_buf()),
        Some(path) => Ok(std::env::current_dir()
            .context("resolve current directory")?
            .join(path)),
        None => std::env::current_dir().context("resolve current directory"),
    }
}

fn config_path(cwd: &Path, path: Option<&Path>) -> Option<PathBuf> {
    path.map(|path| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            cwd.join(path)
        }
    })
}

pub fn resolve_command(command: &str, options: &ScannerOptions) -> Option<String> {
    let host = SystemHost;
    let path = Path::new(command);
    if path.is_absolute() || command.contains('/') || command.contains('\\') {
        host.is_executable(path)
            .then(|| path.to_string_lossy().into_owned())
    } else {
        resolve_on_path(&host, command, options)
    }
}

fn apply_command_overrides(
    config: &coderelay_core::Config,
    detected: &mut Vec<DetectedCli>,
    options: &ScannerOptions,
) {
    for definition in cli_definitions() {
        let Some(configured) = config
            .agents
            .get(&definition.id)
            .and_then(|agent| agent.command.as_deref())
            .map(str::trim)
            .filter(|command| !command.is_empty())
        else {
            continue;
        };
        let Some(path) = resolve_command(configured, options) else {
            continue;
        };
        let version = cli_version(&SystemHost, &path, options);
        let candidate = CliCandidate {
            path: path.clone(),
            runtime: CliRuntime::Local,
            source: CliSource::Fallback,
            distro: None,
            mount_root: None,
            version: version.clone(),
        };
        if let Some(existing) = detected.iter_mut().find(|item| item.id == definition.id) {
            existing.path = path;
            existing.version = version;
            existing.available = true;
            existing.runtime = CliRuntime::Local;
            existing.source = CliSource::Fallback;
            existing.distro = None;
            existing.mount_root = None;
            if !existing
                .candidates
                .iter()
                .any(|item| item.path == existing.path)
            {
                existing.candidates.insert(0, candidate);
            }
        } else {
            detected.push(DetectedCli {
                id: definition.id,
                bin: definition.bin,
                path,
                version,
                available: true,
                runtime: CliRuntime::Local,
                source: CliSource::Fallback,
                distro: None,
                mount_root: None,
                candidates: vec![candidate],
                diagnostics: Vec::new(),
            });
        }
    }
}

pub fn load_context(
    cwd: Option<&Path>,
    explicit_config: Option<&Path>,
) -> anyhow::Result<CliContext> {
    let cwd = resolve_cwd(cwd)?;
    let environment: BTreeMap<String, String> = std::env::vars().collect();
    let home_dir = dirs::home_dir().unwrap_or_else(|| cwd.clone());
    let mut load_options = LoadConfigOptions::new(&cwd);
    load_options.home_dir = Some(home_dir.clone());
    load_options.coderelay_home = environment.get("CODERELAY_HOME").map(PathBuf::from);
    if let Some(path) = config_path(&cwd, explicit_config) {
        load_options.path = Some(path);
    }
    let loaded_config = load_config(&load_options).context("load CodeRelay config")?;

    let scanner_options = ScannerOptions {
        platform: Platform::current(),
        home_dir: home_dir.clone(),
        environment: environment.clone(),
        ..ScannerOptions::default()
    };
    let host = SystemHost;
    let mut detected = scan_coding_clis(&host, &scanner_options);
    apply_command_overrides(&loaded_config.config, &mut detected, &scanner_options);

    let roots = ModelProbeRoots::from_config(&home_dir, &environment, &loaded_config.config);
    let probes = create_model_probes(roots);
    let catalog = probe_model_catalog(&detected, &loaded_config.config, &probes, &SystemHost);

    Ok(CliContext {
        cwd,
        home_dir,
        environment,
        loaded_config,
        detected,
        catalog,
        scanner_options,
    })
}

impl CliContext {
    pub fn config(&self) -> &coderelay_core::Config {
        &self.loaded_config.config
    }

    pub fn detected(&self, agent: AgentId) -> Option<&DetectedCli> {
        self.detected.iter().find(|item| item.id == agent)
    }

    pub fn resolve_agent_target(&self, agent: AgentId) -> anyhow::Result<LaunchTarget> {
        if let Some(command) = self
            .config()
            .agents
            .get(&agent)
            .and_then(|config| config.command.as_deref())
            .map(str::trim)
            .filter(|command| !command.is_empty())
        {
            return resolve_command(command, &self.scanner_options)
                .map(|path| LaunchTarget {
                    path,
                    runtime: CliRuntime::Local,
                    distro: None,
                    mount_root: None,
                })
                .ok_or_else(|| {
                    anyhow::anyhow!("configured command for {agent} was not found: {command}")
                });
        }

        if let Some(target) = self.detected(agent).and_then(DetectedCli::launch_target) {
            return Ok(target);
        }

        let definition = cli_definitions()
            .into_iter()
            .find(|definition| definition.id == agent)
            .ok_or_else(|| anyhow::anyhow!("unsupported agent: {agent}"))?;
        resolve_on_path(&SystemHost, &definition.bin, &self.scanner_options)
            .map(|path| LaunchTarget {
                path,
                runtime: CliRuntime::Local,
                distro: None,
                mount_root: None,
            })
            .ok_or_else(|| anyhow::anyhow!("agent is not available: {agent}"))
    }

    pub fn select(
        &self,
        request: &RouteRequest,
        agent: Option<&str>,
        model: Option<&str>,
        mode_override: Option<RoutingMode>,
    ) -> anyhow::Result<RunSelection> {
        let mode = mode_override.unwrap_or(self.config().routing.mode);

        if agent.is_some() || model.is_some() {
            let selected =
                validate_explicit_target(&self.catalog, agent, model, self.config().default_agent)
                    .map_err(anyhow::Error::msg)?;
            return Ok(RunSelection {
                agent: selected.cli_id,
                model: selected.model_id,
                candidate: None,
                reasons: vec!["explicit target".to_owned()],
            });
        }

        match mode {
            RoutingMode::Manual => {
                bail!("routing.mode=manual 时，非交互 run 必须显式提供 --agent 或 --model")
            }
            RoutingMode::Jev => bail!("Jev routing requires the asynchronous CLI runner"),
            RoutingMode::Local => {
                let candidates = to_route_candidates(&self.catalog, self.config());
                if candidates.is_empty() {
                    let reasons = self
                        .catalog
                        .probes
                        .iter()
                        .map(|probe| {
                            format!(
                                "{}: {}",
                                probe.cli_id,
                                probe.reason.as_deref().unwrap_or("unknown")
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("; ");
                    bail!("没有可用的已探测模型（{reasons}）");
                }
                let decision = route(
                    request,
                    self.config(),
                    &RouteOptions {
                        candidates: Some(candidates),
                        ..RouteOptions::default()
                    },
                )
                .map_err(anyhow::Error::msg)?;
                Ok(RunSelection {
                    agent: decision.agent,
                    model: decision.model,
                    candidate: Some(decision.candidate),
                    reasons: decision.reasons,
                })
            }
        }
    }

    pub fn prepare_agent(
        &self,
        agent: AgentId,
        model: Option<String>,
        prompt: &str,
        permission: Option<&str>,
    ) -> anyhow::Result<PreparedAgent> {
        let target = self.resolve_agent_target(agent)?;
        let agent_config = self.config().agents.get(&agent);
        // Permission flags go first so user-configured extra_args can still override them.
        let mut extra_args: Vec<String> = coderelay_core::permission_args(agent, permission)
            .map_err(anyhow::Error::msg)?
            .iter()
            .map(|arg| (*arg).to_owned())
            .collect();
        if let Some(config) = agent_config {
            extra_args.extend(config.extra_args.clone());
        }
        let prompt_args = build_prompt_args(
            agent,
            &coderelay_core::PromptBuildOptions {
                prompt: prompt.to_owned(),
                model: model.clone(),
                extra_args,
                native_session_id: None,
            },
        );
        let command = if target.runtime == CliRuntime::Wsl {
            let mut command = vec!["wsl.exe".to_owned()];
            let mut wsl_args =
                build_wsl_args(target.distro.as_deref(), std::slice::from_ref(&target.path));
            wsl_args.extend(prompt_args);
            command.extend(wsl_args);
            command
        } else {
            std::iter::once(target.path.clone())
                .chain(prompt_args)
                .collect()
        };
        let cwd = if target.runtime == CliRuntime::Wsl {
            let cwd = self.cwd.to_string_lossy();
            to_wsl_path(&cwd, target.mount_root.as_deref()).map(PathBuf::from)
        } else {
            Some(self.cwd.clone())
        };
        let structured = self
            .catalog
            .probes
            .iter()
            .find(|probe| probe.cli_id == agent)
            .and_then(|probe| {
                model
                    .as_deref()
                    .and_then(|model| probe.models.iter().find(|item| item.model_id == model))
                    .or_else(|| probe.models.first())
            })
            .is_some_and(|model| model.capabilities.structured_events);
        let environment = agent_config
            .map(|config| config.env.clone())
            .unwrap_or_default();

        Ok(PreparedAgent {
            target,
            command,
            cwd,
            structured,
            environment,
        })
    }

    pub fn default_store_path(&self) -> anyhow::Result<PathBuf> {
        let coderelay_home = self.environment.get("CODERELAY_HOME").map(PathBuf::from);
        coderelay_core::default_session_db_path(
            Some(self.home_dir.as_path()),
            coderelay_home.as_deref(),
        )
        .ok_or_else(|| anyhow::anyhow!("unable to resolve the CodeRelay home directory"))
    }

    pub fn route_candidates(&self) -> Vec<RouteCandidate> {
        to_route_candidates(&self.catalog, self.config())
    }

    pub fn configured_candidates(&self) -> Vec<RouteCandidate> {
        build_route_candidates(self.config(), &RouteOptions::default())
    }
}
