use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use coderelay_core::AgentId;
use coderelay_core::agents::{
    ProbeDisplayStatus, create_model_probes, probe_model_catalog, to_route_candidates,
    validate_explicit_target,
};
use coderelay_core::config::parse_config_yaml;
use coderelay_core::host::{FileSystem, FsError};
use coderelay_core::model::{ModelCost, ModelStrength};
use coderelay_core::scanner::{CliRuntime, CliSource, DetectedCli};

#[derive(Default)]
struct FakeFileSystem {
    files: BTreeMap<String, String>,
}

impl FakeFileSystem {
    fn with_file(mut self, path: impl Into<String>, content: impl Into<String>) -> Self {
        self.files.insert(path.into(), content.into());
        self
    }
}

impl FileSystem for FakeFileSystem {
    fn is_executable(&self, _path: &Path) -> bool {
        true
    }

    fn read_to_string(&self, path: &Path) -> Result<String, FsError> {
        let key = path.to_string_lossy().replace('\\', "/");
        self.files.get(&key).cloned().ok_or(FsError::NotFound {
            path: PathBuf::from(key),
        })
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<String>, FsError> {
        Err(FsError::NotFound {
            path: path.to_path_buf(),
        })
    }
}

fn detected(agent: AgentId, available: bool) -> DetectedCli {
    DetectedCli {
        id: agent,
        bin: agent.to_string(),
        path: if available {
            format!("/fixture/{}", agent.as_str())
        } else {
            String::new()
        },
        version: available.then(|| "1.0.0".to_owned()),
        available,
        runtime: CliRuntime::Local,
        source: CliSource::Path,
        candidates: Vec::new(),
        diagnostics: Vec::new(),
    }
}

fn all_detected(available_agent: AgentId) -> Vec<DetectedCli> {
    [AgentId::Codex, AgentId::Claude, AgentId::Pi, AgentId::Omp]
        .into_iter()
        .map(|agent| detected(agent, agent == available_agent))
        .collect()
}

fn roots(home: &str) -> coderelay_core::agents::ModelProbeRoots {
    coderelay_core::agents::ModelProbeRoots {
        codex: PathBuf::from(format!("{home}/fixture-codex")),
        claude: PathBuf::from(format!("{home}/fixture-claude")),
        pi: PathBuf::from(format!("{home}/fixture-pi")),
        omp_root: PathBuf::from(format!("{home}/fixture-omp")),
        omp_agent: PathBuf::from(format!("{home}/fixture-omp/agent")),
    }
}

#[test]
fn codex_catalog_merges_native_models_with_config_metadata() {
    let home = "/tmp/coderelay-model-fixture";
    let config = parse_config_yaml(
        r#"
defaultAgent: codex
defaultModel: codex:gpt-5
agents:
  codex:
    models:
      - id: small
        label: Small Model
        strengths: [fast, cheap]
        cost: 1
        contextWindow: 32000
      - id: gpt-5
        label: GPT-5 Codex
        strengths: [coding, tool-use, long-context]
        cost: 3
        contextWindow: 200000
        default: true
"#,
    )
    .expect("valid config");
    let fs = FakeFileSystem::default()
        .with_file(
            format!("{home}/fixture-codex/config.toml"),
            "model = \"gpt-5\"\nmodel_catalog_json = \"models_cache.json\"\n",
        )
        .with_file(
            format!("{home}/fixture-codex/models_cache.json"),
            r#"{"models":[{"slug":"small","display_name":"Native Small","description":"native description"},{"slug":"gpt-5","display_name":"Native GPT-5"}]}"#,
        );
    let probes = create_model_probes(roots(home));
    let catalog = probe_model_catalog(&all_detected(AgentId::Codex), &config, &probes, &fs);

    let codex = catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Codex)
        .expect("codex probe");
    assert_eq!(codex.status, ProbeDisplayStatus::Found);
    assert_eq!(codex.models.len(), 2);

    let gpt = codex
        .models
        .iter()
        .find(|model| model.model_id == "gpt-5")
        .expect("gpt model");
    assert_eq!(gpt.label, "GPT-5 Codex");
    assert_eq!(
        gpt.strengths,
        vec![
            ModelStrength::Coding,
            ModelStrength::ToolUse,
            ModelStrength::LongContext
        ]
    );
    assert_eq!(gpt.cost, Some(ModelCost::Three));
    assert_eq!(gpt.context_window, Some(200_000));
    assert!(gpt.is_default);
    assert_eq!(gpt.is_native_default, Some(true));

    let small = catalog
        .options
        .iter()
        .find(|model| model.model_id == "small")
        .expect("small option");
    assert_eq!(small.label, "Small Model");
    assert_eq!(small.cost, Some(ModelCost::One));
    assert_eq!(small.context_window, Some(32_000));

    let routes = to_route_candidates(&catalog, &config);
    let gpt_route = routes
        .iter()
        .find(|candidate| candidate.model.as_deref() == Some("gpt-5"))
        .expect("gpt route candidate");
    assert!(gpt_route.is_default);
    assert_eq!(gpt_route.cost, Some(ModelCost::Three));
}

#[test]
fn explicit_target_validation_keeps_agent_and_model_boundaries() {
    let home = "/tmp/coderelay-target-fixture";
    let config = parse_config_yaml(
        r#"
defaultAgent: codex
agents:
  codex:
    models:
      - id: gpt-5
        strengths: [coding]
      - id: o3-mini
        strengths: [fast]
"#,
    )
    .expect("valid config");
    let fs = FakeFileSystem::default().with_file(
        format!("{home}/fixture-codex/models_cache.json"),
        r#"{"models":[{"slug":"gpt-5"},{"slug":"o3-mini"}]}"#,
    );
    let catalog = probe_model_catalog(
        &all_detected(AgentId::Codex),
        &config,
        &create_model_probes(roots(home)),
        &fs,
    );

    let selected =
        validate_explicit_target(&catalog, Some("codex"), Some("o3-mini"), AgentId::Codex)
            .expect("explicit target");
    assert_eq!(selected.cli_id, AgentId::Codex);
    assert_eq!(selected.model_id.as_deref(), Some("o3-mini"));

    let error = validate_explicit_target(&catalog, Some("codex"), Some("unknown"), AgentId::Codex)
        .expect_err("unknown model must fail");
    assert!(error.contains("模型不存在"));
}

#[test]
fn disabled_and_missing_agents_do_not_contribute_candidates() {
    let home = "/tmp/coderelay-disabled-fixture";
    let config = parse_config_yaml(
        "defaultAgent: claude\nagents:\n  codex:\n    enabled: false\n  claude:\n    enabled: true\n",
    )
    .expect("valid config");
    let fs = FakeFileSystem::default();
    let catalog = probe_model_catalog(
        &[
            detected(AgentId::Codex, true),
            detected(AgentId::Claude, false),
        ],
        &config,
        &create_model_probes(roots(home)),
        &fs,
    );

    let codex = catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Codex)
        .expect("codex");
    let claude = catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Claude)
        .expect("claude");
    assert_eq!(codex.status, ProbeDisplayStatus::Disabled);
    assert_eq!(claude.status, ProbeDisplayStatus::NotInstalled);
    assert!(catalog.options.is_empty());
}

#[test]
fn pi_missing_models_file_uses_native_default_without_inventing_a_model() {
    let home = "/tmp/coderelay-pi-fixture";
    let config = parse_config_yaml("defaultAgent: pi\n").expect("valid config");
    let catalog = probe_model_catalog(
        &all_detected(AgentId::Pi),
        &config,
        &create_model_probes(roots(home)),
        &FakeFileSystem::default(),
    );
    let pi = catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Pi)
        .expect("pi");
    assert_eq!(pi.status, ProbeDisplayStatus::Found);
    assert_eq!(pi.models.len(), 1);
    assert_eq!(pi.models[0].model_id, "");
    assert_eq!(pi.models[0].label, "Pi 默认模型");
    assert_eq!(pi.models[0].is_native_default, Some(true));

    let routes = to_route_candidates(&catalog, &config);
    assert_eq!(routes.len(), 1);
    assert!(routes[0].model.is_none());
}

#[test]
fn claude_settings_and_omp_config_produce_native_model_catalogs() {
    let home = "/tmp/coderelay-multi-probe-fixture";
    let fs = FakeFileSystem::default()
        .with_file(
            format!("{home}/fixture-claude/settings.json"),
            r#"{"env":{"ANTHROPIC_DEFAULT_OPUS_MODEL":"opus","ANTHROPIC_DEFAULT_SONNET_MODEL":"sonnet"},"model":"sonnet"}"#,
        )
        .with_file(
            format!("{home}/fixture-omp/agent/config.yml"),
            "modelRoles:\n  default: openai/gpt-5\n",
        )
        .with_file(
            format!("{home}/fixture-omp/agent/models.yml"),
            "providers:\n  openai:\n    models:\n      - id: o3-mini\n        name: O3 Mini\n",
        );

    let claude_config = parse_config_yaml("defaultAgent: claude\n").expect("claude config");
    let claude_catalog = probe_model_catalog(
        &all_detected(AgentId::Claude),
        &claude_config,
        &create_model_probes(roots(home)),
        &fs,
    );
    let claude = claude_catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Claude)
        .expect("claude");
    assert_eq!(claude.status, ProbeDisplayStatus::Found);
    let sonnet = claude
        .models
        .iter()
        .find(|model| model.model_id == "sonnet")
        .expect("sonnet");
    assert_eq!(sonnet.is_native_default, Some(true));

    let omp_config = parse_config_yaml("defaultAgent: omp\n").expect("omp config");
    let omp_catalog = probe_model_catalog(
        &all_detected(AgentId::Omp),
        &omp_config,
        &create_model_probes(roots(home)),
        &fs,
    );
    let omp = omp_catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Omp)
        .expect("omp");
    assert_eq!(omp.status, ProbeDisplayStatus::Found);
    assert!(
        omp.models
            .iter()
            .any(|model| model.model_id == "openai/gpt-5" && model.is_native_default == Some(true))
    );
    assert!(
        omp.models
            .iter()
            .any(|model| model.model_id == "openai/o3-mini" && model.label == "O3 Mini")
    );
    assert!(
        omp.models
            .iter()
            .any(|model| model.capabilities.tool_events)
    );
}

#[test]
fn failed_codex_probe_is_reported_with_a_reason() {
    let home = "/tmp/coderelay-failed-probe-fixture";
    let config = parse_config_yaml("defaultAgent: codex\n").expect("valid config");
    let catalog = probe_model_catalog(
        &all_detected(AgentId::Codex),
        &config,
        &create_model_probes(roots(home)),
        &FakeFileSystem::default(),
    );
    let codex = catalog
        .probes
        .iter()
        .find(|probe| probe.cli_id == AgentId::Codex)
        .expect("codex");
    assert_eq!(codex.status, ProbeDisplayStatus::Unprobed);
    assert!(
        codex
            .reason
            .as_deref()
            .is_some_and(|reason| reason.contains("模型配置缺失"))
    );
}
