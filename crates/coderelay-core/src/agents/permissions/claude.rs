use std::borrow::Cow;

use crate::agent::AgentId;

use super::{CliPermissions, PermissionOption, default_option, static_option};

fn known_options() -> Vec<PermissionOption> {
    vec![
        default_option(),
        static_option(
            "plan",
            "Plan",
            "只规划，不修改文件",
            &["--permission-mode", "plan"],
            false,
        ),
        static_option(
            "acceptEdits",
            "自动接受编辑",
            "自动接受文件编辑，其余操作仍需许可",
            &["--permission-mode", "acceptEdits"],
            false,
        ),
        static_option(
            "auto",
            "Auto",
            "由分类器自动判断是否放行",
            &["--permission-mode", "auto"],
            false,
        ),
        static_option(
            "manual",
            "手动确认",
            "所有需要权限的操作均手动确认",
            &["--permission-mode", "manual"],
            false,
        ),
        static_option(
            "dontAsk",
            "不主动询问",
            "未预先允许的操作直接拒绝而不弹窗询问",
            &["--permission-mode", "dontAsk"],
            false,
        ),
        static_option(
            "bypassPermissions",
            "完全放行",
            "跳过所有权限检查",
            &["--permission-mode", "bypassPermissions"],
            true,
        ),
    ]
}

fn extract_permission_modes(help_text: &str) -> Vec<String> {
    let Some(flag_pos) = help_text.find("--permission-mode") else {
        return Vec::new();
    };
    let tail = &help_text[flag_pos..];
    let Some(choices_pos) = tail.find("(choices:") else {
        return Vec::new();
    };
    let after_prefix = &tail[choices_pos + "(choices:".len()..];
    let Some(end_pos) = after_prefix.find(')') else {
        return Vec::new();
    };
    let block = &after_prefix[..end_pos];

    let mut modes = Vec::new();
    let mut rest = block;
    while let Some(start_quote) = rest.find('"') {
        let after_start = &rest[start_quote + 1..];
        let Some(end_quote) = after_start.find('"') else {
            break;
        };
        let choice = after_start[..end_quote].trim();
        if !choice.is_empty() && !modes.iter().any(|existing| existing == choice) {
            modes.push(choice.to_owned());
        }
        rest = &after_start[end_quote + 1..];
    }
    modes
}

/// Permission specification and `--help` scanner for Claude Code CLI.
pub struct ClaudePermissions;

impl CliPermissions for ClaudePermissions {
    fn agent_id(&self) -> AgentId {
        AgentId::Claude
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
        let discovered = extract_permission_modes(help_text);

        for mode in discovered {
            if let Some(known_opt) = known.iter().find(|opt| opt.id == mode) {
                options.push(known_opt.clone());
            } else {
                let dangerous = mode.to_ascii_lowercase().contains("bypass");
                options.push(PermissionOption {
                    id: Cow::Owned(mode.clone()),
                    label: Cow::Owned(mode.clone()),
                    description: Cow::Owned(format!("Claude --permission-mode {mode}")),
                    args: vec![Cow::Borrowed("--permission-mode"), Cow::Owned(mode)],
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
