use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
pub const TERMINAL_EXIT_EVENT: &str = "terminal-exit";

static TERMINAL_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

fn terminate_child_and_wait(child: &mut (dyn portable_pty::Child + Send + Sync)) -> Option<u32> {
    if let Some(pid) = child.process_id() {
        #[cfg(unix)]
        {
            // Kill the entire process group led by the PTY child so backgrounded
            // descendant processes do not survive terminal close.
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &format!("-{pid}")])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
    }
    let _ = child.kill();
    child.wait().ok().map(|status| status.exit_code())
}

#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl Drop for TerminalRegistry {
    fn drop(&mut self) {
        self.kill_all();
    }
}

impl TerminalRegistry {
    pub fn insert(&self, id: String, session: TerminalSession) -> Result<(), String> {
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| "terminal registry lock poisoned".to_string())?;
        guard.insert(id, session);
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let writer = {
            let guard = self
                .sessions
                .lock()
                .map_err(|_| "terminal registry lock poisoned".to_string())?;
            let session = guard
                .get(id)
                .ok_or_else(|| format!("terminal session not found: {id}"))?;
            Arc::clone(&session.writer)
        };
        let mut writer_guard = writer
            .lock()
            .map_err(|_| format!("terminal writer lock poisoned: {id}"))?;
        writer_guard
            .write_all(data)
            .and_then(|_| writer_guard.flush())
            .map_err(|err| format!("failed to write to terminal {id}: {err}"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let guard = self
            .sessions
            .lock()
            .map_err(|_| "terminal registry lock poisoned".to_string())?;
        let session = guard
            .get(id)
            .ok_or_else(|| format!("terminal session not found: {id}"))?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("failed to resize terminal {id}: {err}"))
    }

    pub fn remove_and_kill(&self, id: &str) -> Option<Option<u32>> {
        let mut session = {
            let mut guard = self.sessions.lock().ok()?;
            guard.remove(id)?
        };
        Some(terminate_child_and_wait(&mut *session.child))
    }

    pub fn remove_on_exit(&self, id: &str) -> Option<Option<u32>> {
        let mut session = {
            let mut guard = self.sessions.lock().ok()?;
            guard.remove(id)?
        };
        Some(session.child.wait().ok().map(|status| status.exit_code()))
    }

    pub fn kill_all(&self) {
        let drained: Vec<TerminalSession> = match self.sessions.lock() {
            Ok(mut guard) => guard.drain().map(|(_, session)| session).collect(),
            Err(poisoned) => poisoned
                .into_inner()
                .drain()
                .map(|(_, session)| session)
                .collect(),
        };
        for mut session in drained {
            let _ = terminate_child_and_wait(&mut *session.child);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateResponse {
    pub terminal_id: String,
    pub shell: String,
    pub cwd: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputPayload {
    terminal_id: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitPayload {
    terminal_id: String,
    code: Option<u32>,
}

fn resolve_shell() -> String {
    if let Ok(shell) = std::env::var("SHELL")
        && !shell.trim().is_empty()
    {
        return shell;
    }
    if cfg!(windows) {
        "powershell.exe".to_string()
    } else {
        "/bin/zsh".to_string()
    }
}

fn resolve_cwd(cwd: Option<String>) -> PathBuf {
    if let Some(raw) = cwd {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_dir() {
                return candidate;
            }
        }
    }
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Decode complete UTF-8 sequences from `pending`, leaving any trailing incomplete
/// multi-byte sequence in `pending` for the next read chunk.
fn drain_utf8_chunks(pending: &mut Vec<u8>) -> String {
    let mut output = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                output.push_str(valid);
                pending.clear();
                break;
            }
            Err(err) => {
                let valid_up_to = err.valid_up_to();
                if valid_up_to > 0 {
                    // Safety: `from_utf8` guaranteed `0..valid_up_to` is valid UTF-8.
                    let valid = std::str::from_utf8(&pending[..valid_up_to]).unwrap_or("");
                    output.push_str(valid);
                    pending.drain(..valid_up_to);
                }
                match err.error_len() {
                    Some(invalid_len) => {
                        output.push('\u{FFFD}');
                        pending.drain(..invalid_len);
                    }
                    None => {
                        // Incomplete multi-byte sequence at the end; wait for next chunk.
                        break;
                    }
                }
            }
        }
    }
    output
}

#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalCreateResponse, String> {
    let cols = cols.unwrap_or(80).max(1);
    let rows = rows.unwrap_or(24).max(1);
    let shell = resolve_shell();
    let work_dir = resolve_cwd(cwd);
    let cwd_display = work_dir.to_string_lossy().into_owned();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("failed to open PTY: {err}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&work_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("failed to spawn shell '{shell}': {err}"))?;
    drop(pair.slave);

    let mut reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(err) => {
            let _ = terminate_child_and_wait(&mut *child);
            return Err(format!("failed to clone PTY reader: {err}"));
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(err) => {
            let _ = terminate_child_and_wait(&mut *child);
            return Err(format!("failed to acquire PTY writer: {err}"));
        }
    };

    let seq = TERMINAL_COUNTER.fetch_add(1, Ordering::Relaxed);
    let terminal_id = format!("term-{seq}");

    if let Err(err) = registry.insert(
        terminal_id.clone(),
        TerminalSession {
            master: pair.master,
            writer: Arc::new(Mutex::new(writer)),
            child,
        },
    ) {
        let _ = registry.remove_and_kill(&terminal_id);
        return Err(err);
    }

    let emit_id = terminal_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0_u8; 4096];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = drain_utf8_chunks(&mut pending);
                    if !text.is_empty() {
                        let _ = app.emit(
                            TERMINAL_OUTPUT_EVENT,
                            TerminalOutputPayload {
                                terminal_id: emit_id.clone(),
                                data: text,
                            },
                        );
                    }
                }
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            let tail = String::from_utf8_lossy(&pending).into_owned();
            let _ = app.emit(
                TERMINAL_OUTPUT_EVENT,
                TerminalOutputPayload {
                    terminal_id: emit_id.clone(),
                    data: tail,
                },
            );
        }
        if let Some(code) = app.state::<TerminalRegistry>().remove_on_exit(&emit_id) {
            let _ = app.emit(
                TERMINAL_EXIT_EVENT,
                TerminalExitPayload {
                    terminal_id: emit_id,
                    code,
                },
            );
        }
    });

    Ok(TerminalCreateResponse {
        terminal_id,
        shell,
        cwd: cwd_display,
    })
}

#[tauri::command]
pub fn terminal_write(
    registry: State<'_, TerminalRegistry>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    registry.write(&terminal_id, data.as_bytes())
}

#[tauri::command]
pub fn terminal_resize(
    registry: State<'_, TerminalRegistry>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry.resize(&terminal_id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(
    app: AppHandle,
    registry: State<'_, TerminalRegistry>,
    terminal_id: String,
) -> Result<(), String> {
    if let Some(code) = registry.remove_and_kill(&terminal_id) {
        let _ = app.emit(
            TERMINAL_EXIT_EVENT,
            TerminalExitPayload { terminal_id, code },
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{TerminalRegistry, TerminalSession, drain_utf8_chunks, resolve_cwd, resolve_shell};
    use portable_pty::{CommandBuilder, PtySize, native_pty_system};
    use std::io::Read;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn drain_utf8_chunks_preserves_split_multibyte_characters() {
        let full = "你好世界🚀".as_bytes();
        // Split right in the middle of the second 3-byte Chinese character.
        let mut pending = full[..4].to_vec();
        assert_eq!(drain_utf8_chunks(&mut pending), "你");
        assert_eq!(pending.len(), 1);

        pending.extend_from_slice(&full[4..]);
        assert_eq!(drain_utf8_chunks(&mut pending), "好世界🚀");
        assert!(pending.is_empty());
    }

    #[test]
    fn drain_utf8_chunks_handles_empty_invalid_and_byte_by_byte_emoji() {
        let mut empty: Vec<u8> = Vec::new();
        assert_eq!(drain_utf8_chunks(&mut empty), "");
        assert!(empty.is_empty());

        // 4-byte emoji split 1 byte at a time must buffer without emitting replacement chars.
        let emoji = "🧪".as_bytes();
        let mut pending = Vec::new();
        for &byte in &emoji[..3] {
            pending.push(byte);
            assert_eq!(drain_utf8_chunks(&mut pending), "");
            assert!(!pending.is_empty());
        }
        pending.push(emoji[3]);
        assert_eq!(drain_utf8_chunks(&mut pending), "🧪");
        assert!(pending.is_empty());

        // Invalid UTF-8 bytes followed by valid ASCII must emit replacement char and drain pending.
        let mut invalid = vec![0xFF, 0xFE, b'O', b'K'];
        let decoded = drain_utf8_chunks(&mut invalid);
        assert_eq!(decoded, "\u{FFFD}\u{FFFD}OK");
        assert!(invalid.is_empty());
    }

    #[test]
    fn resolve_cwd_validates_directory_and_falls_back_safely() {
        let temp_dir = std::env::temp_dir();
        assert_eq!(
            resolve_cwd(Some(temp_dir.to_string_lossy().into_owned())),
            temp_dir
        );

        let missing = temp_dir.join("coderelay_non_existent_terminal_dir_99999");
        let fallback = resolve_cwd(Some(missing.to_string_lossy().into_owned()));
        assert_ne!(fallback, missing);
        assert!(fallback.is_dir());

        let blank_fallback = resolve_cwd(Some("   ".to_string()));
        assert!(blank_fallback.is_dir());
    }

    #[test]
    fn resolve_shell_returns_non_empty_executable() {
        let shell = resolve_shell();
        assert!(!shell.trim().is_empty());
    }

    #[test]
    fn registry_rejects_operations_on_missing_sessions() {
        let registry = TerminalRegistry::default();
        let write_err = registry.write("term-missing", b"ls\n").unwrap_err();
        assert!(write_err.contains("terminal session not found"));

        let resize_err = registry.resize("term-missing", 80, 24).unwrap_err();
        assert!(resize_err.contains("terminal session not found"));

        assert!(registry.remove_and_kill("term-missing").is_none());
        assert!(registry.remove_on_exit("term-missing").is_none());
    }

    #[test]
    fn registry_spawns_writes_resizes_and_kills_pty_without_leaking_session() {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = if cfg!(windows) {
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/C", "more"]);
            c
        } else {
            let mut c = CommandBuilder::new("/bin/sh");
            c.args(["-c", "cat"]);
            c
        };
        cmd.cwd(std::env::temp_dir());

        let child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let child_pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().expect("reader");
        let writer = pair.master.take_writer().expect("writer");

        let registry = TerminalRegistry::default();
        registry
            .insert(
                "term-test-1".to_string(),
                TerminalSession {
                    master: pair.master,
                    writer: Arc::new(Mutex::new(writer)),
                    child,
                },
            )
            .expect("insert");

        registry.resize("term-test-1", 100, 32).expect("resize");
        registry
            .write("term-test-1", b"__CODERELAY_PTY_ALIVE__\n")
            .expect("write");

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0_u8; 1024];
            let mut collected = String::new();
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 {
                    break;
                }
                collected.push_str(&String::from_utf8_lossy(&buf[..n]));
                if collected.contains("__CODERELAY_PTY_ALIVE__") {
                    break;
                }
            }
            let _ = tx.send(collected);
        });

        let output = rx
            .recv_timeout(Duration::from_secs(3))
            .expect("expected PTY echo output before timeout");
        assert!(output.contains("__CODERELAY_PTY_ALIVE__"));

        // Killing the session must remove it and reap the child process.
        let _exit_code = registry.remove_and_kill("term-test-1");
        assert!(registry.write("term-test-1", b"after\n").is_err());
        assert!(registry.resize("term-test-1", 80, 24).is_err());

        #[cfg(unix)]
        if let Some(pid) = child_pid {
            let status = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .status()
                .expect("invoke kill -0");
            assert!(
                !status.success(),
                "PTY child process {pid} should be terminated and reaped"
            );
        }
    }

    #[test]
    fn registry_handles_repeated_create_and_kill_cycles() {
        let registry = TerminalRegistry::default();
        let pty_system = native_pty_system();

        for i in 0..5 {
            let pair = pty_system
                .openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("openpty");
            let cmd = if cfg!(windows) {
                let mut c = CommandBuilder::new("cmd.exe");
                c.args(["/C", "timeout /t 30 >nul"]);
                c
            } else {
                let mut c = CommandBuilder::new("/bin/sh");
                c.args(["-c", "sleep 30"]);
                c
            };
            let child = pair.slave.spawn_command(cmd).expect("spawn");
            drop(pair.slave);
            let writer = pair.master.take_writer().expect("writer");
            let id = format!("term-cycle-{i}");
            registry
                .insert(
                    id.clone(),
                    TerminalSession {
                        master: pair.master,
                        writer: Arc::new(Mutex::new(writer)),
                        child,
                    },
                )
                .expect("insert");
            let _ = registry.remove_and_kill(&id);
            assert!(registry.write(&id, b"ping").is_err());
        }
    }

    #[test]
    fn registry_drop_kills_all_active_sessions() {
        let pty_system = native_pty_system();
        let mut child_pids = Vec::new();
        {
            let registry = TerminalRegistry::default();
            for i in 0..2 {
                let pair = pty_system
                    .openpty(PtySize {
                        rows: 24,
                        cols: 80,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .expect("openpty");
                let cmd = if cfg!(windows) {
                    let mut c = CommandBuilder::new("cmd.exe");
                    c.args(["/C", "timeout /t 30 >nul"]);
                    c
                } else {
                    let mut c = CommandBuilder::new("/bin/sh");
                    c.args(["-c", "sleep 30"]);
                    c
                };
                let child = pair.slave.spawn_command(cmd).expect("spawn");
                drop(pair.slave);
                if let Some(pid) = child.process_id() {
                    child_pids.push(pid);
                }
                let writer = pair.master.take_writer().expect("writer");
                registry
                    .insert(
                        format!("term-drop-{i}"),
                        TerminalSession {
                            master: pair.master,
                            writer: Arc::new(Mutex::new(writer)),
                            child,
                        },
                    )
                    .expect("insert");
            }
        }

        #[cfg(unix)]
        for pid in child_pids {
            let status = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .status()
                .expect("invoke kill -0");
            assert!(
                !status.success(),
                "PTY child process {pid} should be terminated on TerminalRegistry drop"
            );
        }
    }
}
