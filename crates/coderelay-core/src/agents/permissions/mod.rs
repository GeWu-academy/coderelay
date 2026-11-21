mod claude;
mod codex;
mod omp;
mod pi;

use serde::Serialize;

use crate::agent::AgentId;

pub use claude::ClaudePermissions;
pub use codex::CodexPermissions;
pub use omp::OmpPermissions;
pub use pi::PiPermissions;

/// Permission level id meaning "do not pass any permission flag; keep the CLI's own config".
pub const DEFAULT_PERMISSION_ID: &str = "default";

/// One user-selectable permission level of a CLI.
///
/// Each CLI module is the single source of truth for its own options: the UI
/// lists `id`/`label`/`description`, and `args` is spliced into the CLI argv.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    #[serde(skip)]
    pub args: &'static [&'static str],
    /// Disables sandboxing/approvals; the UI should flag it visually.
    pub dangerous: bool,
}

/// Per-CLI permission provider encapsulating the levels supported by a CLI.
pub trait CliPermissions: Sync {
    fn agent_id(&self) -> AgentId;
    fn options(&self) -> &'static [PermissionOption];
}

pub(super) const fn option(
    id: &'static str,
    label: &'static str,
    description: &'static str,
    args: &'static [&'static str],
    dangerous: bool,
) -> PermissionOption {
    PermissionOption {
        id,
        label,
        description,
        args,
        dangerous,
    }
}

pub(super) const DEFAULT_OPTION: PermissionOption = option(
    DEFAULT_PERMISSION_ID,
    "默认",
    "沿用该 CLI 自身的配置",
    &[],
    false,
);

const CODEX_PERMISSIONS: CodexPermissions = CodexPermissions;
const CLAUDE_PERMISSIONS: ClaudePermissions = ClaudePermissions;
const PI_PERMISSIONS: PiPermissions = PiPermissions;
const OMP_PERMISSIONS: OmpPermissions = OmpPermissions;

/// Return the dedicated permission provider for a given CLI.
pub const fn permission_provider(agent: AgentId) -> &'static dyn CliPermissions {
    match agent {
        AgentId::Codex => &CODEX_PERMISSIONS,
        AgentId::Claude => &CLAUDE_PERMISSIONS,
        AgentId::Pi => &PI_PERMISSIONS,
        AgentId::Omp => &OMP_PERMISSIONS,
    }
}

/// Return the permission options supported by a given CLI.
pub fn permission_options(agent: AgentId) -> &'static [PermissionOption] {
    permission_provider(agent).options()
}

/// Resolve a permission id to its argv fragment. `None` means the CLI default.
pub fn permission_args(
    agent: AgentId,
    permission: Option<&str>,
) -> Result<&'static [&'static str], String> {
    let Some(id) = permission else {
        return Ok(&[]);
    };
    permission_options(agent)
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.args)
        .ok_or_else(|| format!("{agent} 不支持权限档位 \"{id}\""))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::agent_ids;

    #[test]
    fn every_agent_provider_matches_agent_id_and_starts_with_default() {
        for agent in agent_ids() {
            let provider = permission_provider(agent);
            assert_eq!(provider.agent_id(), agent);

            let options = permission_options(agent);
            assert_eq!(options[0].id, DEFAULT_PERMISSION_ID);
            assert!(options[0].args.is_empty());
            for (index, item) in options.iter().enumerate() {
                assert!(options[..index].iter().all(|other| other.id != item.id));
            }
        }
    }

    #[test]
    fn maps_claude_plan_and_codex_read_only() {
        assert_eq!(
            permission_args(AgentId::Claude, Some("plan")).unwrap(),
            &["--permission-mode", "plan"]
        );
        assert_eq!(
            permission_args(AgentId::Codex, Some("read-only")).unwrap(),
            &["--sandbox", "read-only"]
        );
        assert_eq!(
            permission_args(AgentId::Omp, Some("yolo")).unwrap(),
            &["--approval-mode", "yolo"]
        );
    }

    #[test]
    fn pi_read_only_allows_only_non_mutating_tools() {
        let args = permission_args(AgentId::Pi, Some("read-only")).unwrap();
        assert_eq!(args, &["--tools", "read,grep,find,ls"]);
        for mutating in ["bash", "edit", "write", "powershell"] {
            assert!(!args[1].split(',').any(|tool| tool == mutating));
        }
    }

    #[test]
    fn none_and_default_add_no_args() {
        assert!(permission_args(AgentId::Codex, None).unwrap().is_empty());
        assert!(
            permission_args(AgentId::Claude, Some(DEFAULT_PERMISSION_ID))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn rejects_level_of_another_cli() {
        assert!(permission_args(AgentId::Codex, Some("plan")).is_err());
        assert!(permission_args(AgentId::Pi, Some("yolo")).is_err());
        assert!(permission_args(AgentId::Omp, Some("read-only")).is_err());
    }

    #[test]
    fn dangerous_flag_only_on_full_access_levels() {
        let dangerous: Vec<_> = permission_options(AgentId::Claude)
            .iter()
            .filter(|item| item.dangerous)
            .map(|item| item.id)
            .collect();
        assert_eq!(dangerous, vec!["bypassPermissions"]);
    }
}
