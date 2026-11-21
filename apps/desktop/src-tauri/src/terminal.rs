use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
pub const TERMINAL_EXIT_EVENT: &str = "terminal-exit";

static TERMINAL_COUNTER: AtomicU64 = AtomicU64::new(1);

pub struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    sessions: Mutex<HashMap<String, TerminalSession>>,
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
        let mut guard = self
            .sessions
            .lock()
            .map_err(|_| "terminal registry lock poisoned".to_string())?;
        let session = guard
            .get_mut(id)
            .ok_or_else(|| format!("terminal session not found: {id}"))?;
        session
            .writer
            .write_all(data)
            .and_then(|_| session.writer.flush())
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

    pub fn remove_and_kill(&self, id: &str) -> Option<u32> {
        let mut guard = self.sessions.lock().ok()?;
        let mut session = guard.remove(id)?;
        let _ = session.child.kill();
        session.child.wait().ok().map(|status| status.exit_code())
    }

    pub fn remove_on_exit(&self, id: &str) -> Option<u32> {
        let mut guard = self.sessions.lock().ok()?;
        let mut session = guard.remove(id)?;
        session.child.wait().ok().map(|status| status.exit_code())
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

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("failed to spawn shell '{shell}': {err}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("failed to clone PTY reader: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("failed to acquire PTY writer: {err}"))?;

    let seq = TERMINAL_COUNTER.fetch_add(1, Ordering::Relaxed);
    let terminal_id = format!("term-{seq}");

    registry.insert(
        terminal_id.clone(),
        TerminalSession {
            master: pair.master,
            writer,
            child,
        },
    )?;

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
        let code = app.state::<TerminalRegistry>().remove_on_exit(&emit_id);
        let _ = app.emit(
            TERMINAL_EXIT_EVENT,
            TerminalExitPayload {
                terminal_id: emit_id,
                code,
            },
        );
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
    registry: State<'_, TerminalRegistry>,
    terminal_id: String,
) -> Result<(), String> {
    registry.remove_and_kill(&terminal_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::drain_utf8_chunks;

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
}
