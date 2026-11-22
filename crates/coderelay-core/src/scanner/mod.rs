pub mod cli;
pub mod paths;
pub mod types;
pub mod version;

pub use cli::{ScannerOptions, cli_version, resolve_on_path, scan_coding_clis};
pub use types::{
    CliCandidate, CliDefinition, CliDiagnostic, CliRuntime, CliSource, DetectedCli,
    DiagnosticLevel, LaunchTarget, cli_definitions, detect_host_agent,
};
