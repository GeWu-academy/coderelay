use serde::{Deserialize, Serialize};

use crate::agent::AgentId;

/// Version flags attempted for every CLI.
pub const DEFAULT_VERSION_ARGS: &[&[&str]] = &[&["--version"], &["-v"], &["-V"]];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CliSource {
    Path,
    Npm,
    Bun,
    Pnpm,
    Yarn,
    Brew,
    Winget,
    Installer,
    Nix,
    Mise,
    Fallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliRuntime {
    Local,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCandidate {
    pub path: String,
    pub runtime: CliRuntime,
    pub source: CliSource,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticLevel {
    Info,
    Warn,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDiagnostic {
    pub level: DiagnosticLevel,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedCli {
    pub id: AgentId,
    pub bin: String,
    pub path: String,
    pub version: Option<String>,
    pub available: bool,
    pub runtime: CliRuntime,
    pub source: CliSource,
    pub candidates: Vec<CliCandidate>,
    pub diagnostics: Vec<CliDiagnostic>,
}

impl DetectedCli {
    pub fn launch_target(&self) -> Option<LaunchTarget> {
        if !self.available || self.path.is_empty() {
            return None;
        }
        Some(LaunchTarget {
            path: self.path.clone(),
            runtime: self.runtime,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchTarget {
    pub path: String,
    pub runtime: CliRuntime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliDefinition {
    pub id: AgentId,
    pub bin: String,
    pub version_args: Vec<Vec<String>>,
}

pub fn cli_definitions() -> Vec<CliDefinition> {
    crate::agent::supported_agents()
        .into_iter()
        .map(|agent| CliDefinition {
            id: agent.id,
            bin: agent.binary,
            version_args: DEFAULT_VERSION_ARGS
                .iter()
                .map(|args| args.iter().map(|arg| (*arg).to_owned()).collect())
                .collect(),
        })
        .collect()
}

/// Claude Code and Pi expose documented host-agent markers.
pub fn detect_host_agent(env: &std::collections::BTreeMap<String, String>) -> Option<AgentId> {
    if env.get("CLAUDECODE").is_some_and(|value| value == "1")
        || env
            .get("CLAUDE_CODE_CHILD_SESSION")
            .is_some_and(|value| value == "1")
    {
        return Some(AgentId::Claude);
    }

    if env
        .get("PI_CODING_AGENT")
        .is_some_and(|value| value == "true" || value == "1")
    {
        return Some(AgentId::Pi);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::supported_agents;

    #[test]
    fn cli_definitions_share_the_agent_catalog() {
        let definitions = cli_definitions();
        let agents = supported_agents();
        assert_eq!(definitions.len(), agents.len());
        assert_eq!(definitions[0].id, agents[0].id);
        assert_eq!(definitions[0].bin, agents[0].binary);
    }
}
