use std::path::{Path, PathBuf};
use std::process::Command;

use coderelay_core::{
    AgentProtocol, AgentRunOptions, AgentRunStatus, RouteRequest, start_agent_run,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{
    SelectionRequest, WorkspaceRequest, context_for, resolve_workspace_subpath, select_for,
    stored_jev_api_key,
};

const MAX_DIFF_PREVIEW_BYTES: usize = 512 * 1024;
const MAX_AI_DIFF_CHARS: usize = 10_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    pub conflicted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    pub is_repo: bool,
    pub repo_root: Option<String>,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
    pub entries: Vec<GitStatusEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub path: String,
    pub staged: bool,
    pub diff: String,
    pub is_binary: bool,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub full_name: String,
    pub is_remote: bool,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub last_commit_oid: Option<String>,
    pub committer_date: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitActionResult {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceRequest {
    pub cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRequest {
    pub cwd: Option<String>,
    pub path: String,
    pub staged: bool,
    pub untracked: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStageRequest {
    pub cwd: Option<String>,
    pub paths: Vec<String>,
    pub all: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiscardRequest {
    pub cwd: Option<String>,
    pub paths: Vec<String>,
    pub untracked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    pub cwd: Option<String>,
    pub message: String,
    pub amend: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCheckoutRequest {
    pub cwd: Option<String>,
    pub branch: String,
    pub create: Option<bool>,
    pub start_point: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDeleteBranchRequest {
    pub cwd: Option<String>,
    pub branch: String,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncRequest {
    pub cwd: Option<String>,
    pub action: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGenerateCommitMessageRequest {
    pub cwd: Option<String>,
    pub agent: Option<String>,
    pub model: Option<String>,
}

struct GitCommandOutput {
    status_code: i32,
    stdout: String,
    stderr: String,
}

fn run_git_raw(cwd: &Path, args: &[&str]) -> Result<GitCommandOutput, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|error| format!("failed to execute git: {error}"))?;

    Ok(GitCommandOutput {
        status_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = run_git_raw(cwd, args)?;
    if out.status_code == 0 {
        Ok(out.stdout)
    } else {
        let detail = out.stderr.trim();
        let fallback = out.stdout.trim();
        let message = if !detail.is_empty() {
            detail
        } else if !fallback.is_empty() {
            fallback
        } else {
            "git command failed"
        };
        Err(message.to_owned())
    }
}

fn resolve_workspace_root(cwd: Option<String>) -> Result<PathBuf, String> {
    let (workspace_root, _) = resolve_workspace_subpath(cwd, None)?;
    Ok(workspace_root)
}

fn resolve_git_repo_root(cwd: Option<String>) -> Result<Option<PathBuf>, String> {
    let workspace_root = resolve_workspace_root(cwd)?;
    let out = run_git_raw(&workspace_root, &["rev-parse", "--show-toplevel"])?;
    if out.status_code != 0 {
        return Ok(None);
    }
    let trimmed = out.stdout.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(trimmed)))
}

fn require_git_repo_root(cwd: Option<String>) -> Result<PathBuf, String> {
    resolve_git_repo_root(cwd)?.ok_or_else(|| "当前工作区不是 Git 仓库".to_owned())
}

fn validate_relative_repo_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("未指定文件路径".to_owned());
    }
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("文件路径不能为空".to_owned());
        }
        if Path::new(trimmed).is_absolute() || trimmed.split(['/', '\\']).any(|seg| seg == "..") {
            return Err(format!("非法文件路径: {trimmed}"));
        }
    }
    Ok(())
}

fn unquote_git_path(raw: &str) -> String {
    let trimmed = raw.trim_end_matches('\r');
    if !(trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2) {
        return trimmed.to_owned();
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    let mut bytes = Vec::with_capacity(inner.len());
    let raw_bytes = inner.as_bytes();
    let mut i = 0;
    while i < raw_bytes.len() {
        if raw_bytes[i] == b'\\' && i + 1 < raw_bytes.len() {
            match raw_bytes[i + 1] {
                b'n' => {
                    bytes.push(b'\n');
                    i += 2;
                }
                b't' => {
                    bytes.push(b'\t');
                    i += 2;
                }
                b'r' => {
                    bytes.push(b'\r');
                    i += 2;
                }
                b'\\' => {
                    bytes.push(b'\\');
                    i += 2;
                }
                b'"' => {
                    bytes.push(b'"');
                    i += 2;
                }
                c if (b'0'..=b'7').contains(&c) && i + 3 < raw_bytes.len() => {
                    let oct = std::str::from_utf8(&raw_bytes[i + 1..i + 4]).unwrap_or("");
                    if let Ok(val) = u8::from_str_radix(oct, 8) {
                        bytes.push(val);
                        i += 4;
                    } else {
                        bytes.push(raw_bytes[i]);
                        i += 1;
                    }
                }
                other => {
                    bytes.push(other);
                    i += 2;
                }
            }
        } else {
            bytes.push(raw_bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn parse_porcelain_v2_status(output: &str, repo_root: &Path) -> GitStatusResult {
    let mut branch = String::from("HEAD");
    let mut upstream: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut detached = false;
    let mut entries = Vec::new();

    for line in output.lines() {
        if let Some(rest) = line.strip_prefix("# branch.head ") {
            let trimmed = rest.trim();
            if trimmed == "(detached)" {
                detached = true;
                branch = "HEAD (detached)".to_owned();
            } else {
                branch = trimmed.to_owned();
            }
        } else if let Some(rest) = line.strip_prefix("# branch.upstream ") {
            let trimmed = rest.trim();
            if !trimmed.is_empty() {
                upstream = Some(trimmed.to_owned());
            }
        } else if let Some(rest) = line.strip_prefix("# branch.ab ") {
            for part in rest.split_whitespace() {
                if let Some(val) = part.strip_prefix('+') {
                    ahead = val.parse::<u32>().unwrap_or(0);
                } else if let Some(val) = part.strip_prefix('-') {
                    behind = val.parse::<u32>().unwrap_or(0);
                }
            }
        } else if let Some(rest) = line.strip_prefix("1 ") {
            // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
            let mut parts = rest.splitn(8, ' ');
            let xy = parts.next().unwrap_or("..");
            for _ in 0..6 {
                let _ = parts.next();
            }
            if let Some(raw_path) = parts.next() {
                let mut chars = xy.chars();
                let x = chars.next().unwrap_or('.');
                let y = chars.next().unwrap_or('.');
                entries.push(GitStatusEntry {
                    path: unquote_git_path(raw_path),
                    orig_path: None,
                    index_status: x.to_string(),
                    worktree_status: y.to_string(),
                    staged: x != '.',
                    unstaged: y != '.',
                    untracked: false,
                    conflicted: false,
                });
            }
        } else if let Some(rest) = line.strip_prefix("2 ") {
            // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
            let mut parts = rest.splitn(9, ' ');
            let xy = parts.next().unwrap_or("..");
            for _ in 0..7 {
                let _ = parts.next();
            }
            if let Some(paths_part) = parts.next() {
                let mut chars = xy.chars();
                let x = chars.next().unwrap_or('.');
                let y = chars.next().unwrap_or('.');
                let (new_path, orig_path) = match paths_part.split_once('\t') {
                    Some((new_p, orig_p)) => {
                        (unquote_git_path(new_p), Some(unquote_git_path(orig_p)))
                    }
                    None => (unquote_git_path(paths_part), None),
                };
                entries.push(GitStatusEntry {
                    path: new_path,
                    orig_path,
                    index_status: x.to_string(),
                    worktree_status: y.to_string(),
                    staged: x != '.',
                    unstaged: y != '.',
                    untracked: false,
                    conflicted: false,
                });
            }
        } else if let Some(rest) = line.strip_prefix("u ") {
            // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
            let mut parts = rest.splitn(10, ' ');
            let xy = parts.next().unwrap_or("UU");
            for _ in 0..8 {
                let _ = parts.next();
            }
            if let Some(raw_path) = parts.next() {
                let mut chars = xy.chars();
                let x = chars.next().unwrap_or('U');
                let y = chars.next().unwrap_or('U');
                entries.push(GitStatusEntry {
                    path: unquote_git_path(raw_path),
                    orig_path: None,
                    index_status: x.to_string(),
                    worktree_status: y.to_string(),
                    staged: false,
                    unstaged: true,
                    untracked: false,
                    conflicted: true,
                });
            }
        } else if let Some(raw_path) = line.strip_prefix("? ") {
            entries.push(GitStatusEntry {
                path: unquote_git_path(raw_path),
                orig_path: None,
                index_status: "?".to_owned(),
                worktree_status: "?".to_owned(),
                staged: false,
                unstaged: false,
                untracked: true,
                conflicted: false,
            });
        }
    }

    GitStatusResult {
        is_repo: true,
        repo_root: Some(repo_root.to_string_lossy().into_owned()),
        branch,
        upstream,
        ahead,
        behind,
        detached,
        entries,
    }
}

pub fn count_diff_stats(diff: &str) -> (u32, u32) {
    let mut additions = 0u32;
    let mut deletions = 0u32;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            additions = additions.saturating_add(1);
        } else if line.starts_with('-') {
            deletions = deletions.saturating_add(1);
        }
    }
    (additions, deletions)
}

pub fn parse_for_each_ref_branches(output: &str) -> Vec<GitBranchInfo> {
    let mut branches = Vec::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 6 {
            continue;
        }
        let head_marker = parts[0].trim();
        let short_name = parts[1].trim();
        let full_name = parts[2].trim();
        let upstream = parts[3].trim();
        let date_str = parts[4].trim();
        let oid = parts[5].trim();

        if short_name.is_empty() || short_name.ends_with("/HEAD") {
            continue;
        }
        let is_remote = full_name.starts_with("remotes/");
        branches.push(GitBranchInfo {
            name: short_name.to_owned(),
            full_name: full_name.to_owned(),
            is_remote,
            is_current: head_marker == "*",
            upstream: if upstream.is_empty() {
                None
            } else {
                Some(upstream.to_owned())
            },
            last_commit_oid: if oid.is_empty() {
                None
            } else {
                Some(oid.to_owned())
            },
            committer_date: date_str.parse::<i64>().ok(),
        });
    }
    branches
}

fn has_head_commit(repo_root: &Path) -> bool {
    run_git_raw(repo_root, &["rev-parse", "--verify", "HEAD"]).is_ok_and(|out| out.status_code == 0)
}

#[tauri::command]
pub fn git_status(request: GitWorkspaceRequest) -> Result<GitStatusResult, String> {
    let Some(repo_root) = resolve_git_repo_root(request.cwd)? else {
        return Ok(GitStatusResult {
            is_repo: false,
            repo_root: None,
            branch: String::new(),
            upstream: None,
            ahead: 0,
            behind: 0,
            detached: false,
            entries: Vec::new(),
        });
    };
    let output = run_git(
        &repo_root,
        &[
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=all",
        ],
    )?;
    Ok(parse_porcelain_v2_status(&output, &repo_root))
}

#[tauri::command]
pub fn git_diff(request: GitDiffRequest) -> Result<GitDiffResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let path = request.path.trim();
    validate_relative_repo_paths(&[path.to_owned()])?;

    let diff_text = if request.untracked == Some(true) && !request.staged {
        let out = run_git_raw(
            &repo_root,
            &["diff", "--no-color", "--no-index", "--", "/dev/null", path],
        )?;
        // `git diff --no-index` returns exit code 1 when differences exist
        if out.status_code != 0 && out.status_code != 1 {
            return Err(out.stderr.trim().to_owned());
        }
        out.stdout
    } else if request.staged {
        run_git(&repo_root, &["diff", "--no-color", "--cached", "--", path])?
    } else {
        run_git(&repo_root, &["diff", "--no-color", "--", path])?
    };

    let is_binary = diff_text.contains("Binary files ") && diff_text.contains(" differ");
    let truncated_diff = if diff_text.len() > MAX_DIFF_PREVIEW_BYTES {
        let mut end = MAX_DIFF_PREVIEW_BYTES;
        while !diff_text.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!(
            "{}\n... (diff 已截断，超过 {} KB)",
            &diff_text[..end],
            MAX_DIFF_PREVIEW_BYTES / 1024
        )
    } else {
        diff_text
    };
    let (additions, deletions) = count_diff_stats(&truncated_diff);
    Ok(GitDiffResult {
        path: path.to_owned(),
        staged: request.staged,
        diff: truncated_diff,
        is_binary,
        additions,
        deletions,
    })
}

#[tauri::command]
pub fn git_stage(request: GitStageRequest) -> Result<(), String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    if request.all == Some(true) {
        run_git(&repo_root, &["add", "-A"])?;
        return Ok(());
    }
    validate_relative_repo_paths(&request.paths)?;
    let mut args = vec!["add", "--"];
    for p in &request.paths {
        args.push(p.as_str());
    }
    run_git(&repo_root, &args)?;
    Ok(())
}

#[tauri::command]
pub fn git_unstage(request: GitStageRequest) -> Result<(), String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let has_head = has_head_commit(&repo_root);
    if request.all == Some(true) {
        if has_head {
            run_git(&repo_root, &["reset", "HEAD", "--"])?;
        } else {
            run_git(
                &repo_root,
                &["rm", "--cached", "-r", "--ignore-unmatch", "."],
            )?;
        }
        return Ok(());
    }
    validate_relative_repo_paths(&request.paths)?;
    if has_head {
        let mut args = vec!["restore", "--staged", "--"];
        for p in &request.paths {
            args.push(p.as_str());
        }
        if run_git(&repo_root, &args).is_err() {
            let mut fallback = vec!["reset", "HEAD", "--"];
            for p in &request.paths {
                fallback.push(p.as_str());
            }
            run_git(&repo_root, &fallback)?;
        }
    } else {
        let mut args = vec!["rm", "--cached", "--ignore-unmatch", "--"];
        for p in &request.paths {
            args.push(p.as_str());
        }
        run_git(&repo_root, &args)?;
    }
    Ok(())
}

#[tauri::command]
pub fn git_discard(request: GitDiscardRequest) -> Result<(), String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    validate_relative_repo_paths(&request.paths)?;
    if request.untracked {
        let mut args = vec!["clean", "-f", "--"];
        for p in &request.paths {
            args.push(p.as_str());
        }
        run_git(&repo_root, &args)?;
    } else {
        let mut args = vec!["restore", "--worktree", "--"];
        for p in &request.paths {
            args.push(p.as_str());
        }
        if run_git(&repo_root, &args).is_err() {
            let mut fallback = vec!["checkout", "--"];
            for p in &request.paths {
                fallback.push(p.as_str());
            }
            run_git(&repo_root, &fallback)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn git_commit(request: GitCommitRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let message = request.message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空".to_owned());
    }
    let out = if request.amend == Some(true) {
        run_git(&repo_root, &["commit", "--amend", "-m", message])?
    } else {
        run_git(&repo_root, &["commit", "-m", message])?
    };
    Ok(GitActionResult {
        ok: true,
        message: out.trim().to_owned(),
    })
}

#[tauri::command]
pub fn git_branches(request: GitWorkspaceRequest) -> Result<Vec<GitBranchInfo>, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = run_git(
        &repo_root,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(HEAD)\t%(refname:short)\t%(refname:lstrip=1)\t%(upstream:short)\t%(committerdate:unix)\t%(objectname:short)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    Ok(parse_for_each_ref_branches(&out))
}

#[tauri::command]
pub fn git_checkout(request: GitCheckoutRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err("分支名称不能为空".to_owned());
    }
    let out = if request.create == Some(true) {
        match request
            .start_point
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(start) => run_git(&repo_root, &["checkout", "-b", branch, start])?,
            None => run_git(&repo_root, &["checkout", "-b", branch])?,
        }
    } else {
        run_git(&repo_root, &["checkout", branch])?
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("已切换到分支 {branch}")
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_delete_branch(request: GitDeleteBranchRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err("分支名称不能为空".to_owned());
    }
    let flag = if request.force == Some(true) {
        "-D"
    } else {
        "-d"
    };
    let out = run_git(&repo_root, &["branch", flag, branch])?;
    Ok(GitActionResult {
        ok: true,
        message: out.trim().to_owned(),
    })
}

#[tauri::command]
pub fn git_sync(request: GitSyncRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let action = request.action.trim();
    let out = match action {
        "fetch" => run_git(&repo_root, &["fetch", "--prune"])?,
        "pull" => run_git(&repo_root, &["pull"])?,
        "push" => {
            let upstream = run_git_raw(&repo_root, &["rev-parse", "--abbrev-ref", "@{u}"]);
            if upstream.is_ok_and(|res| res.status_code == 0) {
                run_git(&repo_root, &["push"])?
            } else {
                let branch = run_git(&repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
                let branch = branch.trim();
                if branch.is_empty() || branch == "HEAD" {
                    return Err("当前处于游离 HEAD 状态，无法自动推送".to_owned());
                }
                run_git(&repo_root, &["push", "-u", "origin", branch])?
            }
        }
        other => return Err(format!("不支持的同步操作: {other}")),
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("{action} 完成")
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_init(request: GitWorkspaceRequest) -> Result<GitActionResult, String> {
    let workspace_root = resolve_workspace_root(request.cwd)?;
    let out = run_git(&workspace_root, &["init"])?;
    Ok(GitActionResult {
        ok: true,
        message: out.trim().to_owned(),
    })
}

#[tauri::command]
pub async fn git_generate_commit_message(
    app: AppHandle,
    request: GitGenerateCommitMessageRequest,
) -> Result<String, String> {
    let repo_root = require_git_repo_root(request.cwd.clone())?;
    let mut diff_context = run_git(&repo_root, &["diff", "--cached", "--no-color"])?;
    if diff_context.trim().is_empty() {
        let unstaged = run_git(&repo_root, &["diff", "--no-color"])?;
        let status = run_git(&repo_root, &["status", "--short"])?;
        diff_context = format!("Git status:\n{status}\n\nDiff:\n{unstaged}");
    }
    if diff_context.trim().is_empty() {
        return Err("当前没有可用于生成提交信息的变更".to_owned());
    }
    if diff_context.len() > MAX_AI_DIFF_CHARS {
        let mut end = MAX_AI_DIFF_CHARS;
        while !diff_context.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        diff_context.truncate(end);
        diff_context.push_str("\n... (truncated)");
    }

    let prompt = format!(
        "Generate a concise Conventional Commits message (e.g., `feat: ...`, `fix: ...`, `refactor: ...`) for the following git diff. Return ONLY the commit message text without markdown fences, quotes, or extra commentary.\n\n{diff_context}"
    );

    let ws_request = WorkspaceRequest {
        cwd: request.cwd,
        config_path: None,
    };
    let context = context_for(&ws_request).await?;
    let selection_request = SelectionRequest {
        workspace: ws_request,
        request: RouteRequest {
            prompt: prompt.clone(),
            ..RouteRequest::default()
        },
        mode: None,
        agent: request.agent,
        model: request.model,
    };
    let stored_api_key = stored_jev_api_key(&app)?;
    let selection = select_for(&context, &selection_request, stored_api_key.as_deref()).await?;
    let prepared = context
        .prepare_agent(selection.agent, selection.model, &prompt, None)
        .map_err(|error| format!("{error:#}"))?;

    let mut options = AgentRunOptions::new(prepared.command);
    options.cwd = prepared.cwd;
    options.environment = prepared.environment;
    options.timeout = Some(std::time::Duration::from_secs(60));
    options.protocol = if prepared.structured {
        AgentProtocol::Structured
    } else {
        AgentProtocol::Text
    };
    options.target = Some(prepared.target);

    let mut handle = start_agent_run(options);
    while handle.events.recv().await.is_some() {}
    let result = handle
        .done
        .await
        .map_err(|error| format!("AI 生成失败: {error}"))?;

    if result.status != AgentRunStatus::Completed {
        let detail = if result.stderr_tail.trim().is_empty() {
            "AI 运行未正常完成".to_owned()
        } else {
            result.stderr_tail.trim().to_owned()
        };
        return Err(detail);
    }

    let cleaned = result
        .text
        .trim()
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_owned();
    if cleaned.is_empty() {
        return Err("AI 未返回有效的提交信息".to_owned());
    }
    Ok(cleaned)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2_status_with_branch_and_entries() {
        let sample = "\
# branch.oid 1234567890abcdef
# branch.head feat/scm-view
# branch.upstream origin/feat/scm-view
# branch.ab +2 -1
1 M. N... 100644 100644 100644 abcdef1 abcdef2 src/App.tsx
1 .M N... 100644 100644 100644 abcdef1 abcdef1 src/types.ts
2 R. N... 100644 100644 100644 abcdef1 abcdef2 R100 src/new.ts\tsrc/old.ts
u UU N... 100644 100644 100644 100644 abcdef1 abcdef2 abcdef3 src/conflict.ts
? src/untracked.ts
";
        let root = Path::new("/tmp/coderelay");
        let parsed = parse_porcelain_v2_status(sample, root);
        assert!(parsed.is_repo);
        assert_eq!(parsed.branch, "feat/scm-view");
        assert_eq!(parsed.upstream.as_deref(), Some("origin/feat/scm-view"));
        assert_eq!(parsed.ahead, 2);
        assert_eq!(parsed.behind, 1);
        assert!(!parsed.detached);
        assert_eq!(parsed.entries.len(), 5);

        assert!(parsed.entries[0].staged);
        assert!(!parsed.entries[0].unstaged);
        assert_eq!(parsed.entries[0].path, "src/App.tsx");

        assert!(!parsed.entries[1].staged);
        assert!(parsed.entries[1].unstaged);

        assert_eq!(parsed.entries[2].path, "src/new.ts");
        assert_eq!(parsed.entries[2].orig_path.as_deref(), Some("src/old.ts"));

        assert!(parsed.entries[3].conflicted);
        assert!(parsed.entries[4].untracked);
    }

    #[test]
    fn parses_for_each_ref_branches() {
        let sample = "\
*\tmain\theads/main\torigin/main\t1763700000\ta1b2c3d
 \tfeat/scm\theads/feat/scm\t\t1763690000\td4e5f6a
 \torigin/HEAD\tremotes/origin/HEAD\t\t1763680000\ta1b2c3d
 \torigin/main\tremotes/origin/main\t\t1763680000\ta1b2c3d
";
        let branches = parse_for_each_ref_branches(sample);
        assert_eq!(branches.len(), 3);
        assert!(branches[0].is_current);
        assert!(!branches[0].is_remote);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));
        assert!(!branches[1].is_current);
        assert!(branches[2].is_remote);
    }

    #[test]
    fn counts_diff_additions_and_deletions() {
        let diff = "\
diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
";
        assert_eq!(count_diff_stats(diff), (2, 1));
    }
}
