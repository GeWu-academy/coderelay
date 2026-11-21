use crate::agent::AgentId;

use super::{CliPermissions, DEFAULT_OPTION, PermissionOption, option};

const OPTIONS: &[PermissionOption] = &[
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

/// Permission specification for OMP CLI.
pub struct OmpPermissions;

impl CliPermissions for OmpPermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Omp
    }

    fn options(&self) -> &'static [PermissionOption] {
        OPTIONS
    }
}
