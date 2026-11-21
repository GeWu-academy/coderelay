use crate::agent::AgentId;

use super::{CliPermissions, DEFAULT_OPTION, PermissionOption, option};

// Pi has no approval/sandbox model, only tool allowlists. `grep`/`find`/`ls` are
// its read-only built-ins (off by default), so read-only = read + those three.
const OPTIONS: &[PermissionOption] = &[
    DEFAULT_OPTION,
    option(
        "read-only",
        "只读",
        "仅启用 read/grep/find/ls，禁用 bash、edit、write",
        &["--tools", "read,grep,find,ls"],
        false,
    ),
];

/// Permission specification for Pi CLI.
pub struct PiPermissions;

impl CliPermissions for PiPermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Pi
    }

    fn options(&self) -> &'static [PermissionOption] {
        OPTIONS
    }
}
