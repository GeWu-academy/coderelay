use crate::agent::AgentId;

use super::{CliPermissions, DEFAULT_OPTION, PermissionOption, option};

const OPTIONS: &[PermissionOption] = &[
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

/// Permission specification for Claude Code CLI.
pub struct ClaudePermissions;

impl CliPermissions for ClaudePermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Claude
    }

    fn options(&self) -> &'static [PermissionOption] {
        OPTIONS
    }
}
