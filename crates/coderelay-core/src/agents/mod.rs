pub mod catalog;
pub mod invocation;
pub mod permissions;
pub mod probes;
pub mod types;

pub use catalog::{
    TargetSelection, compare_targets, probe_model_catalog, to_route_candidates,
    validate_explicit_target,
};
pub use invocation::{PromptBuildOptions, build_prompt_args};
pub use permissions::{
    DEFAULT_PERMISSION_ID, PermissionOption, permission_args, permission_options,
};
pub use probes::{
    ClaudeModelProbe, CodexModelProbe, ModelProbe, ModelProbeRegistry, ModelProbeRoots,
    OmpModelProbe, PiModelProbe, create_model_probes,
};
pub use types::{
    CliCapabilities, ModelCatalog, ModelOption, ProbeDisplay, ProbeDisplayStatus, ProbeResult,
    ProbedModel, capabilities_for,
};
