//! Host capabilities injected into scanners and model probes.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use wait_timeout::ChildExt;

/// Host operating system used for path and executable resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Darwin,
    Linux,
    Win32,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Win32
        } else if cfg!(target_os = "macos") {
            Self::Darwin
        } else {
            Self::Linux
        }
    }

    pub const fn path_separator(self) -> char {
        match self {
            Self::Win32 => '\\',
            Self::Darwin | Self::Linux => '/',
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecRequest {
    pub file: String,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub env: BTreeMap<String, String>,
    pub timeout: Option<Duration>,
}

impl ExecRequest {
    pub fn new(file: impl Into<String>, args: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            file: file.into(),
            args: args.into_iter().map(Into::into).collect(),
            cwd: None,
            env: BTreeMap::new(),
            timeout: None,
        }
    }

    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    pub fn with_env(mut self, env: BTreeMap<String, String>) -> Self {
        self.env = env;
        self
    }

    pub fn with_cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = Some(cwd.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub enum CommandError {
    NotFound {
        file: String,
    },
    Io(std::io::Error),
    Timeout {
        timeout: Duration,
    },
    Exit {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { file } => write!(formatter, "command not found: {file}"),
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Timeout { timeout } => {
                write!(
                    formatter,
                    "command timed out after {}ms",
                    timeout.as_millis()
                )
            }
            Self::Exit {
                code,
                stdout,
                stderr,
            } => write!(
                formatter,
                "command exited with {code:?}: {}{}",
                stderr.trim(),
                if stdout.trim().is_empty() {
                    String::new()
                } else {
                    format!(" ({})", stdout.trim())
                }
            ),
        }
    }
}

impl std::error::Error for CommandError {}

#[derive(Debug)]
pub enum FsError {
    NotFound {
        path: PathBuf,
    },
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl fmt::Display for FsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound { path } => write!(formatter, "path not found: {}", path.display()),
            Self::Io { path, source } => write!(formatter, "{}: {source}", path.display()),
        }
    }
}

impl std::error::Error for FsError {}

impl FsError {
    pub fn is_not_found(&self) -> bool {
        matches!(self, Self::NotFound { .. })
    }
}

pub trait CommandRunner {
    fn exec(&self, request: &ExecRequest) -> Result<ExecOutput, CommandError>;
}

pub trait FileSystem {
    fn is_executable(&self, path: &Path) -> bool;
    fn read_to_string(&self, path: &Path) -> Result<String, FsError>;
    fn read_dir(&self, path: &Path) -> Result<Vec<String>, FsError>;
}

/// The production host used by CLI and Tauri when no test adapter is supplied.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemHost;

impl CommandRunner for SystemHost {
    fn exec(&self, request: &ExecRequest) -> Result<ExecOutput, CommandError> {
        let mut command = std::process::Command::new(&request.file);
        command
            .args(&request.args)
            .envs(&request.env)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(cwd) = &request.cwd {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CommandError::NotFound {
                    file: request.file.clone(),
                }
            } else {
                CommandError::Io(error)
            }
        })?;

        if let Some(timeout) = request.timeout {
            match child.wait_timeout(timeout) {
                Ok(Some(_)) => {}
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(CommandError::Timeout { timeout });
                }
                Err(error) => return Err(CommandError::Io(error)),
            }
        }

        let output = child.wait_with_output().map_err(CommandError::Io)?;
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

        if output.status.success() {
            Ok(ExecOutput { stdout, stderr })
        } else {
            Err(CommandError::Exit {
                code: output.status.code(),
                stdout,
                stderr,
            })
        }
    }
}

impl FileSystem for SystemHost {
    fn is_executable(&self, path: &Path) -> bool {
        let Ok(metadata) = fs::metadata(path) else {
            return false;
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
        }

        #[cfg(not(unix))]
        {
            metadata.is_file()
        }
    }

    fn read_to_string(&self, path: &Path) -> Result<String, FsError> {
        fs::read_to_string(path).map_err(|source| {
            if source.kind() == std::io::ErrorKind::NotFound {
                FsError::NotFound {
                    path: path.to_path_buf(),
                }
            } else {
                FsError::Io {
                    path: path.to_path_buf(),
                    source,
                }
            }
        })
    }

    fn read_dir(&self, path: &Path) -> Result<Vec<String>, FsError> {
        fs::read_dir(path)
            .map_err(|source| {
                if source.kind() == std::io::ErrorKind::NotFound {
                    FsError::NotFound {
                        path: path.to_path_buf(),
                    }
                } else {
                    FsError::Io {
                        path: path.to_path_buf(),
                        source,
                    }
                }
            })?
            .map(|entry| {
                entry
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .map_err(|source| FsError::Io {
                        path: path.to_path_buf(),
                        source,
                    })
            })
            .collect()
    }
}

pub trait Host: CommandRunner + FileSystem {}
impl<T: CommandRunner + FileSystem> Host for T {}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::*;

    #[cfg(unix)]
    #[test]
    fn system_host_exec_captures_stdout_and_stderr() {
        let host = SystemHost;
        let output = host
            .exec(
                &ExecRequest::new("sh", ["-c", "printf 'codex 1.2.3'; printf 'warn' >&2"])
                    .with_timeout(Duration::from_secs(2)),
            )
            .expect("run sh");
        assert_eq!(output.stdout, "codex 1.2.3");
        assert_eq!(output.stderr, "warn");
    }

    #[cfg(unix)]
    #[test]
    fn system_host_exec_enforces_timeout() {
        let host = SystemHost;
        let error = host
            .exec(
                &ExecRequest::new("sh", ["-c", "sleep 1"]).with_timeout(Duration::from_millis(10)),
            )
            .expect_err("sleep must time out");
        assert!(matches!(error, CommandError::Timeout { .. }));
    }
}
