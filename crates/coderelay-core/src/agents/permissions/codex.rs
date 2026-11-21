use std::borrow::Cow;

use crate::agent::AgentId;

use super::{CliPermissions, PermissionOption, default_option, static_option};

fn known_options() -> Vec<PermissionOption> {
    vec![
        default_option(),
        static_option(
            "read-only",
            "只读",
            "沙箱只读，只分析不修改（最接近 plan）",
            &["--sandbox", "read-only"],
            false,
        ),
        static_option(
            "workspace-write",
            "工作区可写",
            "沙箱内可修改工作区文件",
            &["--sandbox", "workspace-write"],
            false,
        ),
        static_option(
            "approve-for-me",
            "自动审查",
            "审批请求交给自动审查，工作区可写沙箱",
            &["--approve-for-me"],
            false,
        ),
        static_option(
            "full-access",
            "完全放行",
            "跳过所有确认且不使用沙箱",
            &["--dangerously-bypass-approvals-and-sandbox"],
            true,
        ),
    ]
}

fn extract_sandbox_values(help_text: &str) -> Vec<String> {
    let Some(sandbox_pos) = help_text.find("--sandbox") else {
        return Vec::new();
    };
    let tail = &help_text[sandbox_pos..];
    let Some(values_pos) = tail.find("[possible values:") else {
        return Vec::new();
    };
    let after_prefix = &tail[values_pos + "[possible values:".len()..];
    let Some(end_pos) = after_prefix.find(']') else {
        return Vec::new();
    };
    after_prefix[..end_pos]
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

/// Permission specification and `--help` scanner for Codex CLI.
pub struct CodexPermissions;

impl CliPermissions for CodexPermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Codex
    }

    fn options(&self) -> Vec<PermissionOption> {
        known_options()
    }

    fn help_args(&self) -> &'static [&'static str] {
        &["exec", "--help"]
    }

    fn scan_from_help(&self, help_text: &str) -> Vec<PermissionOption> {
        let mut options = vec![default_option()];
        let sandbox_values = extract_sandbox_values(help_text);
        let known = known_options();

        for sandbox_id in ["read-only", "workspace-write"] {
            let mentioned = if sandbox_values.is_empty() {
                help_text.contains(sandbox_id)
            } else {
                sandbox_values.iter().any(|value| value == sandbox_id)
            };
            if mentioned && let Some(item) = known.iter().find(|opt| opt.id == sandbox_id) {
                options.push(item.clone());
            }
        }

        if help_text.contains("--approve-for-me")
            && let Some(item) = known.iter().find(|opt| opt.id == "approve-for-me")
        {
            options.push(item.clone());
        }

        if help_text.contains("--dangerously-bypass-approvals-and-sandbox") {
            if let Some(item) = known.iter().find(|opt| opt.id == "full-access") {
                options.push(item.clone());
            }
        } else if sandbox_values
            .iter()
            .any(|value| value == "danger-full-access")
        {
            options.push(PermissionOption {
                id: Cow::Borrowed("danger-full-access"),
                label: Cow::Borrowed("完全放行"),
                description: Cow::Borrowed("沙箱完全放行（danger-full-access）"),
                args: vec![
                    Cow::Borrowed("--sandbox"),
                    Cow::Borrowed("danger-full-access"),
                ],
                dangerous: true,
            });
        }

        options
    }

    fn resolve_args(&self, id: &str) -> Result<Vec<String>, String> {
        if let Some(found) = known_options().into_iter().find(|item| item.id == id) {
            return Ok(found.args.into_iter().map(|arg| arg.into_owned()).collect());
        }
        if id == "danger-full-access" {
            return Ok(vec![
                "--sandbox".to_owned(),
                "danger-full-access".to_owned(),
            ]);
        }
        Err(format!("{} 不支持权限档位 \"{id}\"", self.agent_id()))
    }
}
