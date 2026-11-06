use serde::Serialize;

use crate::agent::AgentId;

/// Permission level id meaning "do not pass any permission flag; keep the CLI's own config".
pub const DEFAULT_PERMISSION_ID: &str = "default";

/// One user-selectable permission level of a CLI.
///
/// This table is the single source of truth: the UI lists `id`/`label`/
/// `description`, and `args` is what gets spliced into the CLI argv.
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

const fn option(
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

const DEFAULT_OPTION: PermissionOption = option(
    DEFAULT_PERMISSION_ID,
    "默认",
    "沿用该 CLI 自身的配置",
    &[],
    false,
);

// Codex `exec` has no plan mode (that is a TUI collaboration mode); `read-only`
// sandbox is the closest non-interactive equivalent.
const CODEX: &[PermissionOption] = &[
    DEFAULT_OPTION,
    option(
        "read-only",
        "只读",
        "沙箱只读，只分析不修改（最接近 plan）",
        &["--sandbox", "read-only"],
        false,
    ),
    option(
        "workspace-write",
        "工作区可写",
        "沙箱内可修改工作区文件",
        &["--sandbox", "workspace-write"],
        false,
    ),
    option(
        "approve-for-me",
        "自动审查",
        "审批请求交给自动审查，工作区可写沙箱",
        &["--approve-for-me"],
        false,
    ),
    option(
        "full-access",
        "完全放行",
        "跳过所有确认且不使用沙箱",
        &["--dangerously-bypass-approvals-and-sandbox"],
        true,
    ),
];

const CLAUDE: &[PermissionOption] = &[
    DEFAULT_OPTION,
    option(
        "plan",
        "Plan",
        "只规划，不修改文件",
        &["--permission-mode", "plan"],
        false,
    ),
    option(
        "acceptEdits",
        "自动接受编辑",
        "自动接受文件编辑，其余操作仍需许可",
        &["--permission-mode", "acceptEdits"],
        false,
    ),
    option(
        "auto",
        "Auto",
        "由分类器自动判断是否放行",
        &["--permission-mode", "auto"],
        false,
    ),
    option(
        "bypassPermissions",
        "完全放行",
        "跳过所有权限检查",
        &["--permission-mode", "bypassPermissions"],
        true,
    ),
];

// Pi has no approval/sandbox model, only tool allowlists. `grep`/`find`/`ls` are
// its read-only built-ins (off by default), so read-only = read + those three.
const PI: &[PermissionOption] = &[
    DEFAULT_OPTION,
    option(
        "read-only",
        "只读",
        "仅启用 read/grep/find/ls，禁用 bash、edit、write",
        &["--tools", "read,grep,find,ls"],
        false,
    ),
];

const OMP: &[PermissionOption] = &[
    DEFAULT_OPTION,
    option(
        "always-ask",
        "总是询问",
        "每次工具调用都需确认",
        &["--approval-mode", "always-ask"],
        false,
    ),
    option(
        "write",
        "写入需确认",
        "approvalMode=write",
        &["--approval-mode", "write"],
        false,
    ),
    option(
        "yolo",
        "完全放行",
        "自动批准所有工具调用",
        &["--approval-mode", "yolo"],
        true,
    ),
];

pub const fn permission_options(agent: AgentId) -> &'static [PermissionOption] {
    match agent {
        AgentId::Codex => CODEX,
        AgentId::Claude => CLAUDE,
        AgentId::Pi => PI,
        AgentId::Omp => OMP,
    }
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
    fn every_agent_starts_with_default_and_has_unique_ids() {
        for agent in agent_ids() {
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
