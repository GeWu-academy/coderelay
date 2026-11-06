//! Platform-neutral CodeRelay domain core.
//!
//! This crate deliberately does not depend on Tauri, a terminal framework, or
//! a specific operating system. Host applications provide filesystem,
//! process, and persistence adapters.

pub mod agent;
pub mod agents;
pub mod config;
pub mod host;
pub mod model;
pub mod router;
pub mod runtime;
pub mod scanner;
pub mod session;

pub use agent::{AgentDescriptor, AgentId, agent_ids, supported_agents};
pub use agents::{
    CliCapabilities, DEFAULT_PERMISSION_ID, ModelCatalog, ModelOption, ModelProbeRoots,
    PermissionOption, ProbeDisplay, ProbeDisplayStatus, ProbeResult, ProbedModel,
    PromptBuildOptions, TargetSelection, build_prompt_args, create_model_probes, permission_args,
    permission_options, probe_model_catalog, to_route_candidates, validate_explicit_target,
};
pub use config::{
    Config, ConfigError, ConfigSaveError, LoadConfigOptions, LoadedConfig, default_config,
    load_config, parse_config_yaml, project_config_path, render_default_config_yaml,
    save_config_source,
};
pub use host::{CommandRunner, ExecOutput, ExecRequest, FileSystem, Host, Platform, SystemHost};
pub use model::{
    AgentModelRef, MODEL_STRENGTHS, ModelConfig, ModelCost, ModelStrength, format_model_ref,
    parse_model_ref,
};
pub use router::{
    ROUTING_MODES, RouteCandidate, RouteDecision, RouteError, RouteOptions, RouteRequest,
    RouteStrategy, RoutingMode, RoutingStrategy, RuleMatch, ScoredCandidate,
    build_route_candidates, has_ambiguous_route, resolve_routing_mode, route, select_candidate,
};
pub use runtime::{
    AgentAbortHandle, AgentEvent, AgentProtocol, AgentRunHandle, AgentRunOptions, AgentRunResult,
    AgentRunStatus, ChunkParser, OutputSource, start_agent_run,
};
pub use scanner::{
    CliCandidate, CliDiagnostic, CliRuntime, CliSource, DetectedCli, DiagnosticLevel, LaunchTarget,
    ScannerOptions, cli_definitions, detect_host_agent, scan_coding_clis, scan_wsl_clis,
};
pub use session::{
    AppendTurnInput, ListSessionsOptions, SessionRecord, SessionStore, SessionStoreError,
    SessionTurn, TurnContextSource, TurnProtocol, TurnRunStatus, build_prompt_with_context,
    default_session_db_path,
};

/// Semantic version of the Rust core crate.
pub const CORE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn built_in_agents_are_non_empty_and_unique() {
        let agents = supported_agents();
        assert!(!agents.is_empty());

        let unique: HashSet<_> = agents.iter().map(|agent| agent.id).collect();
        assert_eq!(unique.len(), agents.len());
        assert_eq!(agent_ids().count(), agents.len());
    }

    #[test]
    fn core_version_matches_workspace_version() {
        assert_eq!(CORE_VERSION, env!("CARGO_PKG_VERSION"));
    }
}
