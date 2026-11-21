use crate::agent::AgentId;

use super::{CliPermissions, PermissionOption, default_option, static_option};

fn known_options() -> Vec<PermissionOption> {
    vec![
        default_option(),
        // Pi has no approval/sandbox model, only tool allowlists. `grep`/`find`/`ls` are
        // its read-only built-ins (off by default), so read-only = read + those three.
        static_option(
            "read-only",
            "只读",
            "仅启用 read/grep/find/ls，禁用 bash、edit、write",
            &["--tools", "read,grep,find,ls"],
            false,
        ),
    ]
}

/// Permission specification and `--help` scanner for Pi CLI.
pub struct PiPermissions;

impl CliPermissions for PiPermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Pi
    }

    fn options(&self) -> Vec<PermissionOption> {
        known_options()
    }

    fn help_args(&self) -> &'static [&'static str] {
        &["--help"]
    }

    fn scan_from_help(&self, help_text: &str) -> Vec<PermissionOption> {
        let mut options = vec![default_option()];
        if help_text.contains("--tools")
            && let Some(read_only) = known_options()
                .into_iter()
                .find(|opt| opt.id == "read-only")
        {
            options.push(read_only);
        }
        options
    }

    fn resolve_args(&self, id: &str) -> Result<Vec<String>, String> {
        if let Some(found) = known_options().into_iter().find(|item| item.id == id) {
            return Ok(found.args.into_iter().map(|arg| arg.into_owned()).collect());
        }
        Err(format!("{} 不支持权限档位 \"{id}\"", self.agent_id()))
    }
}
