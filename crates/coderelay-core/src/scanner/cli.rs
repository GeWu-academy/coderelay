use std::cmp::Ordering;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::agent::AgentId;
use crate::host::{CommandRunner, ExecRequest, FileSystem, Host, Platform};
use crate::scanner::paths::{
    InstallDir, candidate_paths_in_dir, classify_source_in, dedupe_paths, is_dir_on_path,
    standard_install_dirs, user_install_dirs,
};
use crate::scanner::types::{
    CliCandidate, CliDefinition, CliDiagnostic, CliRuntime, CliSource, DetectedCli,
    DiagnosticLevel, cli_definitions,
};
use crate::scanner::version::probe_version;

#[derive(Debug, Clone)]
pub struct ScannerOptions {
    pub platform: Platform,
    pub home_dir: PathBuf,
    pub environment: BTreeMap<String, String>,
    pub resolve_timeout: Duration,
    pub version_timeout: Duration,
    pub version_args: Vec<Vec<String>>,
}

impl Default for ScannerOptions {
    fn default() -> Self {
        let platform = Platform::current();
        Self {
            platform,
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            environment: std::env::vars().collect(),
            resolve_timeout: Duration::from_secs(3),
            version_timeout: Duration::from_secs(5),
            version_args: crate::scanner::types::DEFAULT_VERSION_ARGS
                .iter()
                .map(|args| args.iter().map(|arg| (*arg).to_owned()).collect())
                .collect(),
        }
    }
}

fn lines(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn platform_dirname(file_path: &str, platform: Platform) -> String {
    let separator = platform.path_separator();
    let trimmed = file_path.trim_end_matches(separator);
    trimmed
        .rfind(separator)
        .map(|index| trimmed[..index].to_owned())
        .unwrap_or_default()
}

fn is_file_reachable_from_shell(file_path: &str, options: &ScannerOptions) -> bool {
    is_dir_on_path(
        &platform_dirname(file_path, options.platform),
        options.platform,
        &options.environment,
    )
}

fn exec(
    runner: &dyn CommandRunner,
    options: &ScannerOptions,
    file: &str,
    args: Vec<String>,
    timeout: Duration,
) -> Result<crate::host::ExecOutput, crate::host::CommandError> {
    runner.exec(
        &ExecRequest::new(file, args)
            .with_timeout(timeout)
            .with_env(options.environment.clone()),
    )
}

fn resolve_all_on_path(
    runner: &dyn CommandRunner,
    bin: &str,
    options: &ScannerOptions,
) -> Vec<String> {
    let lookup = if options.platform == Platform::Win32 {
        "where"
    } else {
        "which"
    };

    if let Ok(output) = exec(
        runner,
        options,
        lookup,
        vec![bin.to_owned()],
        options.resolve_timeout,
    ) {
        let found = lines(&output.stdout);
        if !found.is_empty() {
            return found;
        }
    }

    if options.platform == Platform::Win32 {
        return Vec::new();
    }

    exec(
        runner,
        options,
        "sh",
        vec!["-lc".to_owned(), format!("command -v {bin}")],
        options.resolve_timeout,
    )
    .map(|output| lines(&output.stdout))
    .unwrap_or_default()
}

pub fn resolve_on_path(
    runner: &dyn CommandRunner,
    bin: &str,
    options: &ScannerOptions,
) -> Option<String> {
    resolve_all_on_path(runner, bin, options).into_iter().next()
}

pub fn cli_version(
    runner: &dyn CommandRunner,
    bin_path: &str,
    options: &ScannerOptions,
) -> Option<String> {
    probe_version(
        runner,
        &[bin_path.to_owned()],
        options.version_timeout,
        &options.version_args,
        &options.environment,
    )
}

fn get_windows_claude_fallback(fs: &dyn FileSystem, options: &ScannerOptions) -> Option<String> {
    if options.platform != Platform::Win32 {
        return None;
    }

    let home = options.home_dir.to_string_lossy();
    let mut candidates = vec![
        format!("{home}\\.local\\bin\\claude.exe"),
        format!("{home}\\.bun\\bin\\claude.exe"),
    ];
    if let Some(app_data) = options
        .environment
        .get("APPDATA")
        .filter(|value| !value.trim().is_empty())
    {
        candidates.insert(1, format!("{app_data}\\npm\\claude.cmd"));
    }

    candidates
        .into_iter()
        .find(|candidate| fs.is_executable(Path::new(candidate)))
}

fn get_codex_config_fallback(
    fs: &dyn FileSystem,
    options: &ScannerOptions,
) -> Result<Option<String>, String> {
    if let Some(env_path) = options
        .environment
        .get("CODEX_CLI_PATH")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        return if fs.is_executable(Path::new(env_path)) {
            Ok(Some(env_path.to_owned()))
        } else {
            Err(format!(
                "invalid CODEX_CLI_PATH: \"{env_path}\" does not exist or is not executable"
            ))
        };
    }

    if options.platform == Platform::Darwin {
        let home = options.home_dir.to_string_lossy();
        for candidate in [
            "/Applications/ChatGPT.app/Contents/Resources/codex".to_owned(),
            format!("{home}/Applications/ChatGPT.app/Contents/Resources/codex"),
        ] {
            if fs.is_executable(Path::new(&candidate)) {
                return Ok(Some(candidate));
            }
        }
    }

    Ok(None)
}

fn compare_version_names(left: &str, right: &str) -> Ordering {
    let left_parts: Vec<_> = left.split('.').collect();
    let right_parts: Vec<_> = right.split('.').collect();
    for (left_part, right_part) in left_parts.iter().zip(&right_parts) {
        let order = match (left_part.parse::<u64>(), right_part.parse::<u64>()) {
            (Ok(left), Ok(right)) => left.cmp(&right),
            _ => left_part.cmp(right_part),
        };
        if order != Ordering::Equal {
            return order;
        }
    }
    left_parts.len().cmp(&right_parts.len())
}

fn get_unix_claude_version_fallback(
    fs: &dyn FileSystem,
    options: &ScannerOptions,
) -> Option<String> {
    if options.platform == Platform::Win32 {
        return None;
    }
    let versions_dir = options.home_dir.join(".local/share/claude/versions");
    let mut entries = fs.read_dir(&versions_dir).ok()?;
    entries.sort_by(|left, right| compare_version_names(right, left));

    entries.into_iter().find_map(|entry| {
        let candidate = versions_dir.join(entry);
        let path = candidate.to_string_lossy().into_owned();
        fs.is_executable(&candidate).then_some(path)
    })
}

fn probe_package_bin_dirs(runner: &dyn CommandRunner, options: &ScannerOptions) -> Vec<InstallDir> {
    let mut probes = vec![
        ("npm", vec!["prefix", "-g"], CliSource::Npm, true),
        ("bun", vec!["pm", "bin", "-g"], CliSource::Bun, false),
        ("pnpm", vec!["bin", "-g"], CliSource::Pnpm, false),
        ("yarn", vec!["global", "bin"], CliSource::Yarn, false),
    ];
    if options.platform == Platform::Darwin {
        probes.push(("brew", vec!["--prefix"], CliSource::Brew, true));
    }

    probes
        .into_iter()
        .filter_map(|(command, args, source, add_bin)| {
            let output = exec(
                runner,
                options,
                command,
                args.into_iter().map(str::to_owned).collect(),
                options.resolve_timeout,
            )
            .ok()?;
            let first = lines(&output.stdout).into_iter().next()?;
            let dir = if add_bin && !(command == "npm" && options.platform == Platform::Win32) {
                format!("{}/bin", first.trim_end_matches('/'))
            } else {
                first
            };
            Some(InstallDir { dir, source })
        })
        .collect()
}

#[derive(Debug, Clone)]
struct LocalCandidate {
    path: String,
    source: CliSource,
}

fn accessible(fs: &dyn FileSystem, candidate: &str) -> bool {
    fs.is_executable(Path::new(candidate))
}

fn collect_local_candidates(
    fs: &dyn FileSystem,
    runner: &dyn CommandRunner,
    definition: &CliDefinition,
    options: &ScannerOptions,
    package_dirs: &[InstallDir],
    searched_dirs: &mut Vec<String>,
    diagnostics: &mut Vec<CliDiagnostic>,
) -> Vec<LocalCandidate> {
    let mut directories = package_dirs.to_vec();
    directories.extend(user_install_dirs(
        options.platform,
        &options.home_dir,
        &options.environment,
    ));
    directories.extend(standard_install_dirs(options.platform, &options.home_dir));
    searched_dirs.extend(directories.iter().map(|entry| entry.dir.clone()));

    let source_of = |path: &str| classify_source_in(path, &directories, options.platform);
    let mut ordered = Vec::new();

    for found in resolve_all_on_path(runner, &definition.bin, options) {
        let source = source_of(&found);
        ordered.push(LocalCandidate {
            path: found,
            source,
        });
    }

    if definition.id == AgentId::Codex {
        match get_codex_config_fallback(fs, options) {
            Ok(Some(fallback)) => ordered.push(LocalCandidate {
                path: fallback,
                source: CliSource::Installer,
            }),
            Ok(None) => {}
            Err(message) => diagnostics.push(CliDiagnostic {
                level: DiagnosticLevel::Warn,
                message,
            }),
        }
    }

    if definition.id == AgentId::Claude {
        if options.platform == Platform::Win32 {
            if let Some(fallback) = get_windows_claude_fallback(fs, options) {
                ordered.push(LocalCandidate {
                    path: fallback,
                    source: CliSource::Fallback,
                });
            }
        } else {
            let versions_dir = options.home_dir.join(".local/share/claude/versions");
            searched_dirs.push(versions_dir.to_string_lossy().into_owned());
            if let Some(fallback) = get_unix_claude_version_fallback(fs, options) {
                ordered.push(LocalCandidate {
                    path: fallback,
                    source: CliSource::Installer,
                });
            }
        }
    }

    let in_dirs = dedupe_paths(
        directories.iter().flat_map(|entry| {
            candidate_paths_in_dir(
                &entry.dir,
                &definition.bin,
                options.platform,
                &options.environment,
            )
        }),
        options.platform,
    );
    for candidate in in_dirs {
        let source = source_of(&candidate);
        ordered.push(LocalCandidate {
            path: candidate,
            source,
        });
    }

    let ordered_paths: Vec<String> = ordered.iter().map(|entry| entry.path.clone()).collect();
    let source_by_path: BTreeMap<String, CliSource> = ordered
        .into_iter()
        .map(|entry| (entry.path, entry.source))
        .collect();

    dedupe_paths(ordered_paths, options.platform)
        .into_iter()
        .filter(|candidate| accessible(fs, candidate))
        .map(|path| LocalCandidate {
            source: source_by_path
                .get(&path)
                .copied()
                .unwrap_or(CliSource::Path),
            path,
        })
        .collect()
}

fn to_local_candidates(
    runner: &dyn CommandRunner,
    local: &[LocalCandidate],
    options: &ScannerOptions,
) -> Vec<CliCandidate> {
    local
        .iter()
        .map(|entry| CliCandidate {
            path: entry.path.clone(),
            runtime: CliRuntime::Local,
            source: entry.source,
            version: probe_version(
                runner,
                std::slice::from_ref(&entry.path),
                options.version_timeout,
                &options.version_args,
                &options.environment,
            ),
        })
        .collect()
}

fn build_diagnostics(
    definition: &CliDefinition,
    options: &ScannerOptions,
    selected: Option<&CliCandidate>,
    searched_dirs: &[String],
    initial: Vec<CliDiagnostic>,
) -> Vec<CliDiagnostic> {
    let mut diagnostics = initial;

    let Some(selected) = selected else {
        let unique: Vec<_> = searched_dirs
            .iter()
            .cloned()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        diagnostics.push(CliDiagnostic {
            level: DiagnosticLevel::Info,
            message: format!(
                "未发现 {}。已检查 PATH 与常见安装目录：{}",
                definition.bin,
                unique.join(", ")
            ),
        });
        return diagnostics;
    };

    if selected.version.is_none() {
        diagnostics.push(CliDiagnostic {
            level: DiagnosticLevel::Warn,
            message: format!(
                "已找到 {}，但版本探测失败；该 CLI 可能未完整安装。",
                selected.path
            ),
        });
    }

    if !is_file_reachable_from_shell(&selected.path, options) {
        diagnostics.push(CliDiagnostic {
            level: DiagnosticLevel::Warn,
            message: format!(
                "已安装但不在当前 PATH：{}。若要在终端直接调用 {}，请把该目录加入 PATH 并重新打开终端。",
                platform_dirname(&selected.path, options.platform),
                definition.bin
            ),
        });
    }

    diagnostics
}

fn scan_cli(
    host: &dyn Host,
    definition: &CliDefinition,
    options: &ScannerOptions,
    package_dirs: &[InstallDir],
) -> DetectedCli {
    let mut searched_dirs = Vec::new();
    let mut diagnostics = Vec::new();
    let local = collect_local_candidates(
        host,
        host,
        definition,
        options,
        package_dirs,
        &mut searched_dirs,
        &mut diagnostics,
    );
    let candidates = to_local_candidates(host, &local, options);

    let selected = candidates.first().cloned();
    let diagnostics = build_diagnostics(
        definition,
        options,
        selected.as_ref(),
        &searched_dirs,
        diagnostics,
    );

    match selected {
        Some(selected) => DetectedCli {
            id: definition.id,
            bin: definition.bin.clone(),
            path: selected.path,
            version: selected.version,
            available: true,
            runtime: selected.runtime,
            source: selected.source,
            candidates,
            diagnostics,
        },
        None => DetectedCli {
            id: definition.id,
            bin: definition.bin.clone(),
            path: String::new(),
            version: None,
            available: false,
            runtime: CliRuntime::Local,
            source: CliSource::Path,
            candidates,
            diagnostics,
        },
    }
}

/// Scan supported CLIs while preserving canonical agent order.
pub fn scan_coding_clis(host: &dyn Host, options: &ScannerOptions) -> Vec<DetectedCli> {
    let package_dirs = probe_package_bin_dirs(host, options);

    cli_definitions()
        .iter()
        .map(|definition| scan_cli(host, definition, options, &package_dirs))
        .collect()
}
