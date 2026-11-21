use std::borrow::Cow;

use crate::agent::AgentId;

use super::{CliPermissions, PermissionOption, default_option, static_option};

fn known_options() -> Vec<PermissionOption> {
    vec![
        default_option(),
        static_option(
            "always-ask",
            "总是询问",
            "每次工具调用都需确认",
            &["--approval-mode", "always-ask"],
            false,
        ),
        static_option(
            "write",
            "写入需确认",
            "approvalMode=write",
            &["--approval-mode", "write"],
            false,
        ),
        static_option(
            "yolo",
            "完全放行",
            "自动批准所有工具调用",
            &["--approval-mode", "yolo"],
            true,
        ),
    ]
}

fn extract_approval_modes(help_text: &str) -> Vec<String> {
    let Some(line) = help_text
        .lines()
        .find(|line| line.contains("--approval-mode"))
    else {
        return Vec::new();
    };
    let Some(open_paren) = line.rfind('(') else {
        return Vec::new();
    };
    let after_open = &line[open_paren + 1..];
    let Some(close_paren) = after_open.find(')') else {
        return Vec::new();
    };
    after_open[..close_paren]
        .split('|')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Permission specification and `--help` scanner for OMP CLI.
pub struct OmpPermissions;

impl CliPermissions for OmpPermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Omp
    }

    fn options(&self) -> Vec<PermissionOption> {
        known_options()
    }

    fn help_args(&self) -> &'static [&'static str] {
        &["--help"]
    }

    fn scan_from_help(&self, help_text: &str) -> Vec<PermissionOption> {
        let mut options = vec![default_option()];
        let known = known_options();
        let discovered = extract_approval_modes(help_text);

        if discovered.is_empty() {
            if help_text.contains("--auto-approve")
                && let Some(yolo) = known.iter().find(|opt| opt.id == "yolo")
            {
                options.push(yolo.clone());
            }
            return options;
        }

        for mode in discovered {
            if let Some(known_opt) = known.iter().find(|opt| opt.id == mode) {
                options.push(known_opt.clone());
            } else {
                let dangerous = mode.eq_ignore_ascii_case("yolo");
                options.push(PermissionOption {
                    id: Cow::Owned(mode.clone()),
                    label: Cow::Owned(mode.clone()),
                    description: Cow::Owned(format!("OMP --approval-mode {mode}")),
                    args: vec![Cow::Borrowed("--approval-mode"), Cow::Owned(mode)],
                    dangerous,
                });
            }
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
