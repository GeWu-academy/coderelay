use crate::agent::AgentId;

use super::{CliPermissions, DEFAULT_OPTION, PermissionOption, option};

// Codex `exec` has no plan mode (that is a TUI collaboration mode); `read-only`
// sandbox is the closest non-interactive equivalent.
const OPTIONS: &[PermissionOption] = &[
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

/// Permission specification for Codex CLI.
pub struct CodexPermissions;

impl CliPermissions for CodexPermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Codex
    }

    fn options(&self) -> &'static [PermissionOption] {
        OPTIONS
    }
}
