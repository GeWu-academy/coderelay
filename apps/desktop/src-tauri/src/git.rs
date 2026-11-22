use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

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
const MAX_GIT_OUTPUT_ENTRIES: usize = 200;
const MAX_GIT_OUTPUT_TEXT_BYTES: usize = 8 * 1024;

static GIT_OUTPUT_LOG: OnceLock<Mutex<VecDeque<GitOutputEntry>>> = OnceLock::new();
static NEXT_GIT_OUTPUT_ID: AtomicU64 = AtomicU64::new(1);

fn git_output_store() -> &'static Mutex<VecDeque<GitOutputEntry>> {
    GIT_OUTPUT_LOG.get_or_init(|| Mutex::new(VecDeque::with_capacity(MAX_GIT_OUTPUT_ENTRIES)))
}

fn truncate_utf8_bytes(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_owned();
    }
    let mut end = max_bytes;
    while !input.is_char_boundary(end) && end > 0 {
        end -= 1;
    }
    format!("{}...(truncated)", &input[..end])
}

fn now_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn record_git_output(cwd: &Path, args: &[&str], out: &GitCommandOutput) {
    let entry = GitOutputEntry {
        id: NEXT_GIT_OUTPUT_ID.fetch_add(1, Ordering::Relaxed),
        timestamp_ms: now_timestamp_ms(),
        cwd: cwd.to_string_lossy().into_owned(),
        command: format!("git {}", args.join(" ")),
        exit_code: out.status_code,
        stdout: truncate_utf8_bytes(out.stdout.trim_end(), MAX_GIT_OUTPUT_TEXT_BYTES),
        stderr: truncate_utf8_bytes(out.stderr.trim_end(), MAX_GIT_OUTPUT_TEXT_BYTES),
    };
    if let Ok(mut guard) = git_output_store().lock() {
        if guard.len() >= MAX_GIT_OUTPUT_ENTRIES {
            guard.pop_front();
        }
        guard.push_back(entry);
    }
}

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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOutputEntry {
    pub id: u64,
    pub timestamp_ms: u64,
    pub cwd: String,
    pub command: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneResult {
    pub ok: bool,
    pub message: String,
    pub cloned_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteInfo {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashEntry {
    pub reference: String,
    pub message: String,
    pub timestamp: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagInfo {
    pub name: String,
    pub oid: String,
    pub creator_date: Option<i64>,
    pub message: Option<String>,
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
    pub all: Option<bool>,
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
pub struct GitRenameBranchRequest {
    pub cwd: Option<String>,
    pub old_name: Option<String>,
    pub new_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchTargetRequest {
    pub cwd: Option<String>,
    pub branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCloneRequest {
    pub cwd: Option<String>,
    pub url: String,
    pub parent_dir: Option<String>,
    pub directory_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAddRemoteRequest {
    pub cwd: Option<String>,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoveRemoteRequest {
    pub cwd: Option<String>,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashPushRequest {
    pub cwd: Option<String>,
    pub message: Option<String>,
    pub include_untracked: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashRefRequest {
    pub cwd: Option<String>,
    pub reference: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateTagRequest {
    pub cwd: Option<String>,
    pub name: String,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDeleteTagRequest {
    pub cwd: Option<String>,
    pub name: String,
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

    let result = GitCommandOutput {
        status_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    };
    record_git_output(cwd, args, &result);
    Ok(result)
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

fn summarize_commit_output(out: &str) -> String {
    let mut lines = out.lines().map(str::trim).filter(|line| !line.is_empty());

    let Some(header) = lines.next() else {
        return "提交成功".to_owned();
    };

    let stat = lines.next().filter(|line| {
        !line.starts_with("create mode ")
            && !line.starts_with("delete mode ")
            && !line.starts_with("mode change ")
            && !line.starts_with("rename ")
            && !line.starts_with("copy ")
    });

    match stat {
        Some(summary) => format!("{header} · {summary}"),
        None => header.to_owned(),
    }
}

#[tauri::command]
pub fn git_commit(request: GitCommitRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let message = request.message.trim();
    let amend = request.amend == Some(true);
    let all = request.all == Some(true);

    if message.is_empty() && !amend {
        return Err("提交信息不能为空".to_owned());
    }
    let mut args = vec!["commit"];
    if all {
        args.push("-a");
    }
    if amend {
        args.push("--amend");
        if message.is_empty() {
            args.push("--no-edit");
        } else {
            args.push("-m");
            args.push(message);
        }
    } else {
        args.push("-m");
        args.push(message);
    }
    let out = run_git(&repo_root, &args)?;
    Ok(GitActionResult {
        ok: true,
        message: summarize_commit_output(&out),
    })
}

#[tauri::command]
pub fn git_undo_last_commit(request: GitWorkspaceRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = run_git(&repo_root, &["reset", "--soft", "HEAD~1"])?;
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            "已撤销上次提交，更改保留在暂存区".to_owned()
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_discard_all(request: GitWorkspaceRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    if has_head_commit(&repo_root) {
        if run_git(&repo_root, &["restore", "--worktree", "."]).is_err() {
            run_git(&repo_root, &["checkout", "--", "."])?;
        }
    }
    let clean_out = run_git(&repo_root, &["clean", "-fd"])?;
    Ok(GitActionResult {
        ok: true,
        message: if clean_out.trim().is_empty() {
            "已放弃工作区所有更改".to_owned()
        } else {
            format!("已放弃工作区所有更改 · {}", clean_out.trim())
        },
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

fn has_upstream(repo_root: &Path) -> bool {
    run_git_raw(repo_root, &["rev-parse", "--abbrev-ref", "@{u}"])
        .is_ok_and(|res| res.status_code == 0)
}

fn push_branch_with_upstream(repo_root: &Path) -> Result<(String, String), String> {
    let branch = run_git(repo_root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let branch = branch.trim().to_owned();
    if branch.is_empty() || branch == "HEAD" {
        return Err("当前处于游离 HEAD 状态，无法自动推送".to_owned());
    }
    let out = run_git(repo_root, &["push", "-u", "origin", &branch])?;
    Ok((branch, out))
}

#[tauri::command]
pub fn git_sync(request: GitSyncRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let action = request.action.trim();
    let (out, fallback_message) = match action {
        "fetch" => (run_git(&repo_root, &["fetch", "--prune"])?, "抓取完成".to_owned()),
        "fetch_all" => (
            run_git(&repo_root, &["fetch", "--all", "--prune"])?,
            "已抓取全部远程".to_owned(),
        ),
        "pull" => (run_git(&repo_root, &["pull"])?, "拉取完成".to_owned()),
        "pull_rebase" => (
            run_git(&repo_root, &["pull", "--rebase"])?,
            "变基拉取完成".to_owned(),
        ),
        "push" => {
            if has_upstream(&repo_root) {
                (run_git(&repo_root, &["push"])?, "推送完成".to_owned())
            } else {
                let (branch, out) = push_branch_with_upstream(&repo_root)?;
                (out, format!("已发布分支 {branch} 到远程"))
            }
        }
        "push_force" => {
            if has_upstream(&repo_root) {
                (
                    run_git(&repo_root, &["push", "--force-with-lease"])?,
                    "强制推送完成".to_owned(),
                )
            } else {
                let (branch, out) = push_branch_with_upstream(&repo_root)?;
                (out, format!("已发布分支 {branch} 到远程"))
            }
        }
        "push_tags" => (
            run_git(&repo_root, &["push", "--tags"])?,
            "已推送所有标记".to_owned(),
        ),
        "sync" => {
            if has_upstream(&repo_root) {
                let pull_out = run_git(&repo_root, &["pull"])?;
                let push_out = run_git(&repo_root, &["push"])?;
                let combined = [pull_out.trim(), push_out.trim()]
                    .into_iter()
                    .filter(|s| !s.is_empty() && *s != "Already up to date.")
                    .collect::<Vec<_>>()
                    .join(" · ");
                (combined, "已与远程分支同步".to_owned())
            } else {
                let (branch, out) = push_branch_with_upstream(&repo_root)?;
                (out, format!("已发布分支 {branch} 到远程"))
            }
        }
        other => return Err(format!("不支持的同步操作: {other}")),
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            fallback_message
        } else {
            out.trim().to_owned()
        },
    })
}

pub fn derive_clone_dir_name(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let after_slash = trimmed.rsplit(['/', ':']).next().unwrap_or("");
    let stripped = after_slash.strip_suffix(".git").unwrap_or(after_slash).trim();
    if stripped.is_empty() {
        "repository".to_owned()
    } else {
        stripped.to_owned()
    }
}

#[tauri::command]
pub fn git_clone(request: GitCloneRequest) -> Result<GitCloneResult, String> {
    let url = request.url.trim();
    if url.is_empty() {
        return Err("仓库 URL 不能为空".to_owned());
    }
    let parent_dir = match request
        .parent_dir
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(dir) => PathBuf::from(dir),
        None => {
            let ws = resolve_workspace_root(request.cwd)?;
            ws.parent().map(Path::to_path_buf).unwrap_or(ws)
        }
    };
    if !parent_dir.is_dir() {
        return Err(format!("目标父目录不存在: {}", parent_dir.display()));
    }

    let folder_name = match request
        .directory_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(name) => {
            if name.contains('/') || name.contains('\\') || name == "." || name == ".." {
                return Err(format!("非法目录名称: {name}"));
            }
            name.to_owned()
        }
        None => derive_clone_dir_name(url),
    };
    let target_path = parent_dir.join(&folder_name);
    if target_path.exists() {
        return Err(format!("目标目录已存在: {}", target_path.display()));
    }

    let out = run_git(&parent_dir, &["clone", "--", url, &folder_name])?;
    let cloned_path = target_path.to_string_lossy().into_owned();
    Ok(GitCloneResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("已克隆仓库到 {cloned_path}")
        } else {
            out.trim().to_owned()
        },
        cloned_path,
    })
}

#[tauri::command]
pub fn git_rename_branch(request: GitRenameBranchRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let new_name = request.new_name.trim();
    if new_name.is_empty() {
        return Err("新分支名称不能为空".to_owned());
    }
    let out = match request
        .old_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(old) => run_git(&repo_root, &["branch", "-m", old, new_name])?,
        None => run_git(&repo_root, &["branch", "-m", new_name])?,
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("分支已重命名为 {new_name}")
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_merge_branch(request: GitBranchTargetRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err("目标分支名称不能为空".to_owned());
    }
    let out = run_git(&repo_root, &["merge", branch])?;
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("已合并分支 {branch}")
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_rebase_branch(request: GitBranchTargetRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let branch = request.branch.trim();
    if branch.is_empty() {
        return Err("目标分支名称不能为空".to_owned());
    }
    let out = run_git(&repo_root, &["rebase", branch])?;
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("已变基到分支 {branch}")
        } else {
            out.trim().to_owned()
        },
    })
}

pub fn parse_git_remotes(output: &str) -> Vec<GitRemoteInfo> {
    let mut map: BTreeMap<String, (String, String)> = BTreeMap::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some((name, rest)) = trimmed.split_once('\t') else {
            continue;
        };
        let name = name.trim();
        let rest = rest.trim();
        if name.is_empty() || rest.is_empty() {
            continue;
        }
        let (url, kind) = match rest.rsplit_once(' ') {
            Some((u, k)) => (u.trim(), k.trim()),
            None => (rest, ""),
        };
        let entry = map
            .entry(name.to_owned())
            .or_insert_with(|| (String::new(), String::new()));
        if kind == "(push)" {
            entry.1 = url.to_owned();
        } else {
            entry.0 = url.to_owned();
            if entry.1.is_empty() {
                entry.1 = url.to_owned();
            }
        }
    }
    map.into_iter()
        .map(|(name, (fetch_url, push_url))| GitRemoteInfo {
            name,
            fetch_url,
            push_url,
        })
        .collect()
}

#[tauri::command]
pub fn git_remotes(request: GitWorkspaceRequest) -> Result<Vec<GitRemoteInfo>, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = run_git(&repo_root, &["remote", "-v"])?;
    Ok(parse_git_remotes(&out))
}

#[tauri::command]
pub fn git_add_remote(request: GitAddRemoteRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let name = request.name.trim();
    let url = request.url.trim();
    if name.is_empty() {
        return Err("远程名称不能为空".to_owned());
    }
    if url.is_empty() {
        return Err("远程 URL 不能为空".to_owned());
    }
    run_git(&repo_root, &["remote", "add", name, url])?;
    Ok(GitActionResult {
        ok: true,
        message: format!("已添加远程 {name} ({url})"),
    })
}

#[tauri::command]
pub fn git_remove_remote(request: GitRemoveRemoteRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("远程名称不能为空".to_owned());
    }
    run_git(&repo_root, &["remote", "remove", name])?;
    Ok(GitActionResult {
        ok: true,
        message: format!("已移除远程 {name}"),
    })
}

pub fn parse_git_stashes(output: &str) -> Vec<GitStashEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        let reference = parts.first().copied().unwrap_or("").trim();
        if reference.is_empty() {
            continue;
        }
        let message = parts.get(1).copied().unwrap_or("").trim().to_owned();
        let timestamp = parts
            .get(2)
            .copied()
            .and_then(|s| s.trim().parse::<i64>().ok());
        entries.push(GitStashEntry {
            reference: reference.to_owned(),
            message,
            timestamp,
        });
    }
    entries
}

#[tauri::command]
pub fn git_stashes(request: GitWorkspaceRequest) -> Result<Vec<GitStashEntry>, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = run_git(&repo_root, &["stash", "list", "--format=%gd%x09%gs%x09%ct"])?;
    Ok(parse_git_stashes(&out))
}

#[tauri::command]
pub fn git_stash_push(request: GitStashPushRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let mut args = vec!["stash", "push"];
    if request.include_untracked == Some(true) {
        args.push("-u");
    }
    let trimmed_msg = request.message.as_deref().map(str::trim).unwrap_or("");
    if !trimmed_msg.is_empty() {
        args.push("-m");
        args.push(trimmed_msg);
    }
    let out = run_git(&repo_root, &args)?;
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            "已存储当前更改".to_owned()
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_stash_apply(request: GitStashRefRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = match request
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(r) => run_git(&repo_root, &["stash", "apply", r])?,
        None => run_git(&repo_root, &["stash", "apply"])?,
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            "已应用存储".to_owned()
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_stash_pop(request: GitStashRefRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = match request
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(r) => run_git(&repo_root, &["stash", "pop", r])?,
        None => run_git(&repo_root, &["stash", "pop"])?,
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            "已弹出存储".to_owned()
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_stash_drop(request: GitStashRefRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = match request
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(r) => run_git(&repo_root, &["stash", "drop", r])?,
        None => run_git(&repo_root, &["stash", "drop"])?,
    };
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            "已删除存储".to_owned()
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_stash_clear(request: GitWorkspaceRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    run_git(&repo_root, &["stash", "clear"])?;
    Ok(GitActionResult {
        ok: true,
        message: "已清空所有存储".to_owned(),
    })
}

pub fn parse_git_tags(output: &str) -> Vec<GitTagInfo> {
    let mut tags = Vec::new();
    for line in output.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        let name = parts.first().copied().unwrap_or("").trim();
        if name.is_empty() {
            continue;
        }
        let oid = parts.get(1).copied().unwrap_or("").trim().to_owned();
        let creator_date = parts
            .get(2)
            .copied()
            .and_then(|s| s.trim().parse::<i64>().ok());
        let message = parts
            .get(3)
            .copied()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);
        tags.push(GitTagInfo {
            name: name.to_owned(),
            oid,
            creator_date,
            message,
        });
    }
    tags
}

#[tauri::command]
pub fn git_tags(request: GitWorkspaceRequest) -> Result<Vec<GitTagInfo>, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let out = run_git(
        &repo_root,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)\t%(objectname:short)\t%(creatordate:unix)\t%(contents:subject)",
            "refs/tags",
        ],
    )?;
    Ok(parse_git_tags(&out))
}

#[tauri::command]
pub fn git_create_tag(request: GitCreateTagRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("标记名称不能为空".to_owned());
    }
    let msg = request.message.as_deref().map(str::trim).unwrap_or("");
    if msg.is_empty() {
        run_git(&repo_root, &["tag", name])?;
    } else {
        run_git(&repo_root, &["tag", "-a", name, "-m", msg])?;
    }
    Ok(GitActionResult {
        ok: true,
        message: format!("已创建标记 {name}"),
    })
}

#[tauri::command]
pub fn git_delete_tag(request: GitDeleteTagRequest) -> Result<GitActionResult, String> {
    let repo_root = require_git_repo_root(request.cwd)?;
    let name = request.name.trim();
    if name.is_empty() {
        return Err("标记名称不能为空".to_owned());
    }
    let out = run_git(&repo_root, &["tag", "-d", name])?;
    Ok(GitActionResult {
        ok: true,
        message: if out.trim().is_empty() {
            format!("已删除标记 {name}")
        } else {
            out.trim().to_owned()
        },
    })
}

#[tauri::command]
pub fn git_output_log() -> Result<Vec<GitOutputEntry>, String> {
    let guard = git_output_store()
        .lock()
        .map_err(|_| "failed to lock git output log".to_owned())?;
    Ok(guard.iter().cloned().collect())
}

#[tauri::command]
pub fn git_clear_output_log() -> Result<(), String> {
    let mut guard = git_output_store()
        .lock()
        .map_err(|_| "failed to lock git output log".to_owned())?;
    guard.clear();
    Ok(())
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

    #[test]
    fn summarizes_verbose_commit_output() {
        let verbose = "\
[main a8f2d29] feat: 初始化项目目录
 19 files changed, 2068 insertions(+)
 create mode 100644 .gitignore
 create mode 100644 README.md
 create mode 100644 package.json
";
        assert_eq!(
            summarize_commit_output(verbose),
            "[main a8f2d29] feat: 初始化项目目录 · 19 files changed, 2068 insertions(+)"
        );
        assert_eq!(
            summarize_commit_output("[main a8f2d29] chore: empty\n create mode 100644 a.txt\n"),
            "[main a8f2d29] chore: empty"
        );
        assert_eq!(summarize_commit_output("   \n  "), "提交成功");
    }

    #[test]
    fn derives_clone_dir_name_from_https_and_ssh_urls() {
        assert_eq!(
            derive_clone_dir_name("https://github.com/google/coderelay.git"),
            "coderelay"
        );
        assert_eq!(
            derive_clone_dir_name("git@github.com:google/coderelay.git/"),
            "coderelay"
        );
        assert_eq!(derive_clone_dir_name("   "), "repository");
    }

    #[test]
    fn parses_git_remotes_output() {
        let sample = "\
origin\thttps://github.com/acme/app.git (fetch)
origin\tgit@github.com:acme/app.git (push)
upstream\thttps://github.com/upstream/app.git (fetch)
upstream\thttps://github.com/upstream/app.git (push)
";
        let remotes = parse_git_remotes(sample);
        assert_eq!(remotes.len(), 2);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(remotes[0].fetch_url, "https://github.com/acme/app.git");
        assert_eq!(remotes[0].push_url, "git@github.com:acme/app.git");
        assert_eq!(remotes[1].name, "upstream");
        assert_eq!(remotes[1].fetch_url, "https://github.com/upstream/app.git");
    }

    #[test]
    fn parses_git_stashes_output() {
        let sample = "\
stash@{0}\tOn main: WIP scm menu\t1763700000
stash@{1}\tWIP on feat/git: 1a2b3c4 initial\t1763690000
";
        let stashes = parse_git_stashes(sample);
        assert_eq!(stashes.len(), 2);
        assert_eq!(stashes[0].reference, "stash@{0}");
        assert_eq!(stashes[0].message, "On main: WIP scm menu");
        assert_eq!(stashes[0].timestamp, Some(1763700000));
        assert_eq!(stashes[1].reference, "stash@{1}");
    }

    #[test]
    fn parses_git_tags_output() {
        let sample = "\
v1.2.0\tabc1234\t1763700000\tRelease v1.2.0
v1.1.0\tdef5678\t1763600000\t
";
        let tags = parse_git_tags(sample);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0].name, "v1.2.0");
        assert_eq!(tags[0].oid, "abc1234");
        assert_eq!(tags[0].creator_date, Some(1763700000));
        assert_eq!(tags[0].message.as_deref(), Some("Release v1.2.0"));
        assert_eq!(tags[1].name, "v1.1.0");
        assert_eq!(tags[1].message, None);
    }
}
