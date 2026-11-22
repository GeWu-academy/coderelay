use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::{Sleep, sleep};
use uuid::Uuid;

use crate::host::Platform;
use crate::runtime::events::{
    AgentEvent, AgentProtocol, AgentRunResult, AgentRunStatus, OutputSource, default_parse_chunk,
    parse_structured_line, summarize_events,
};
use crate::scanner::types::LaunchTarget;

const STDERR_TAIL_CHARS: usize = 8_000;
const MAX_RETAINED_EVENTS: usize = 2_000;
const KILL_GRACE: Duration = Duration::from_secs(2);

pub type ChunkParser = Arc<dyn Fn(&str, OutputSource) -> Vec<AgentEvent> + Send + Sync + 'static>;

#[derive(Clone)]
pub struct AgentRunOptions {
    pub cmd: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub environment: BTreeMap<String, String>,
    pub timeout: Option<Duration>,
    pub protocol: AgentProtocol,
    pub parse_chunk: Option<ChunkParser>,
    pub target: Option<LaunchTarget>,
    pub shell: Option<bool>,
    pub platform: Platform,
    pub run_id: Option<String>,
}

impl AgentRunOptions {
    pub fn new(cmd: impl IntoIterator<Item = impl Into<String>>) -> Self {
        Self {
            cmd: cmd.into_iter().map(Into::into).collect(),
            cwd: None,
            environment: BTreeMap::new(),
            timeout: None,
            protocol: AgentProtocol::Text,
            parse_chunk: None,
            target: None,
            shell: None,
            platform: Platform::current(),
            run_id: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AbortReason {
    User,
    Timeout,
}

#[derive(Clone)]
pub struct AgentAbortHandle {
    abort_tx: watch::Sender<Option<AbortReason>>,
}

impl AgentAbortHandle {
    pub fn abort(&self) {
        self.abort_tx.send_replace(Some(AbortReason::User));
    }
}

pub struct AgentRunHandle {
    pub run_id: String,
    pub events: mpsc::UnboundedReceiver<AgentEvent>,
    pub done: JoinHandle<AgentRunResult>,
    abort_tx: watch::Sender<Option<AbortReason>>,
}

impl AgentRunHandle {
    pub fn abort(&self) {
        self.abort_tx.send_replace(Some(AbortReason::User));
    }

    pub fn abort_handle(&self) -> AgentAbortHandle {
        AgentAbortHandle {
            abort_tx: self.abort_tx.clone(),
        }
    }
}

/// Determine whether a command needs a Windows shell wrapper.
pub fn resolve_agent_shell(
    shell_override: Option<bool>,
    _target: Option<&LaunchTarget>,
    _bin: &str,
    platform: Platform,
) -> bool {
    if let Some(shell) = shell_override {
        return shell;
    }
    platform == Platform::Win32
}

fn quote_posix_arg(value: &str) -> String {
    if !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_@%+=:,./-".contains(character))
    {
        return value.to_owned();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn quote_windows_arg(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || "\"&|<>^".contains(character))
    {
        return value.to_owned();
    }
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn build_command(options: &AgentRunOptions) -> Result<Command, String> {
    let Some(bin) = options.cmd.first() else {
        return Err("start_agent_run requires a non-empty cmd array".to_owned());
    };
    let args = &options.cmd[1..];
    let use_shell = resolve_agent_shell(
        options.shell,
        options.target.as_ref(),
        bin,
        options.platform,
    );

    let mut command = if use_shell {
        let command_line = if options.platform == Platform::Win32 {
            std::iter::once(bin.as_str())
                .chain(args.iter().map(String::as_str))
                .map(quote_windows_arg)
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            std::iter::once(bin.as_str())
                .chain(args.iter().map(String::as_str))
                .map(quote_posix_arg)
                .collect::<Vec<_>>()
                .join(" ")
        };
        if options.platform == Platform::Win32 {
            let mut command = Command::new("cmd.exe");
            command.args(["/C", &command_line]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", &command_line]);
            command
        }
    } else {
        let mut command = Command::new(bin);
        command.args(args);
        command
    };

    command
        .envs(std::env::vars())
        .envs(&options.environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(cwd) = &options.cwd {
        command.current_dir(cwd);
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }

    Ok(command)
}

#[cfg(unix)]
fn signal_name(signal: i32) -> String {
    match signal {
        2 => "SIGINT".to_owned(),
        9 => "SIGKILL".to_owned(),
        15 => "SIGTERM".to_owned(),
        other => format!("SIG{other}"),
    }
}

fn exit_details(status: &std::process::ExitStatus) -> (Option<i32>, Option<String>) {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        (status.code(), status.signal().map(signal_name))
    }
    #[cfg(not(unix))]
    {
        (status.code(), None)
    }
}

fn kill_process_tree(child: &mut Child, force: bool) {
    let Some(pid) = child.id() else {
        return;
    };

    #[cfg(unix)]
    {
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        let result = unsafe { libc::kill(-(pid as i32), signal) };
        if result != 0 {
            let _ = child.start_kill();
        }
    }

    #[cfg(windows)]
    {
        let _ = force;
        let status = std::process::Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/t", "/f"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if status.is_err() {
            let _ = child.start_kill();
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        let _ = force;
        let _ = child.start_kill();
    }
}

fn tail(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    if count > max_chars {
        text.chars().skip(count - max_chars).collect()
    } else {
        text.to_owned()
    }
}

async fn read_stream<R>(mut reader: R, source: OutputSource, sender: mpsc::Sender<RawChunk>)
where
    R: AsyncRead + Unpin,
{
    let mut buffer = vec![0_u8; 8192];
    let mut pending: Vec<u8> = Vec::new();

    loop {
        match reader.read(&mut buffer).await {
            Ok(0) => break,
            Ok(read) => {
                pending.extend_from_slice(&buffer[..read]);
                match std::str::from_utf8(&pending) {
                    Ok(text) => {
                        if !text.is_empty()
                            && sender
                                .send(RawChunk {
                                    source,
                                    text: text.to_owned(),
                                })
                                .await
                                .is_err()
                        {
                            return;
                        }
                        pending.clear();
                    }
                    Err(error) if error.error_len().is_none() => {
                        let valid = error.valid_up_to();
                        if valid > 0 {
                            let text = std::str::from_utf8(&pending[..valid])
                                .expect("validated UTF-8 prefix")
                                .to_owned();
                            if sender.send(RawChunk { source, text }).await.is_err() {
                                return;
                            }
                            pending.drain(..valid);
                        }
                    }
                    Err(_) => {
                        let text = String::from_utf8_lossy(&pending).into_owned();
                        if !text.is_empty() && sender.send(RawChunk { source, text }).await.is_err()
                        {
                            return;
                        }
                        pending.clear();
                    }
                }
            }
            Err(_) => break,
        }
    }

    if !pending.is_empty() {
        let text = String::from_utf8_lossy(&pending).into_owned();
        let _ = sender.send(RawChunk { source, text }).await;
    }
}

struct RawChunk {
    source: OutputSource,
    text: String,
}

struct RunState {
    sender: mpsc::UnboundedSender<AgentEvent>,
    events: VecDeque<AgentEvent>,
    output_parts: Vec<String>,
    terminal_status: Option<AgentRunStatus>,
    stderr_tail: String,
}

impl RunState {
    fn new(sender: mpsc::UnboundedSender<AgentEvent>) -> Self {
        Self {
            sender,
            events: VecDeque::new(),
            output_parts: Vec::new(),
            terminal_status: None,
            stderr_tail: String::new(),
        }
    }

    fn emit(&mut self, event: AgentEvent) {
        match &event {
            AgentEvent::AssistantText { text } => self.output_parts.push(text.clone()),
            AgentEvent::Completed { text, .. } => {
                self.terminal_status = Some(AgentRunStatus::Completed);
                if self.output_parts.is_empty() && !text.is_empty() {
                    self.output_parts.push(text.clone());
                }
            }
            AgentEvent::Failed { .. } => {
                self.terminal_status = Some(AgentRunStatus::Failed);
            }
            _ => {}
        }

        self.events.push_back(event.clone());
        if self.events.len() > MAX_RETAINED_EVENTS {
            self.events.pop_front();
        }
        let _ = self.sender.send(event);
    }

    fn output_text(&self) -> String {
        if self.output_parts.is_empty() {
            summarize_events(&self.events.iter().cloned().collect::<Vec<_>>())
        } else {
            self.output_parts.join("")
        }
    }

    fn retained_events(&self) -> Vec<AgentEvent> {
        self.events.iter().cloned().collect()
    }
}

fn process_stdout_chunk(
    state: &mut RunState,
    chunk: &str,
    protocol: AgentProtocol,
    parser: &ChunkParser,
    stdout_rest: &mut String,
) {
    if protocol == AgentProtocol::Text {
        state.emit(AgentEvent::AssistantText {
            text: chunk.to_owned(),
        });
        return;
    }

    stdout_rest.push_str(chunk);
    while let Some(index) = stdout_rest.find('\n') {
        let line = stdout_rest[..index].to_owned();
        stdout_rest.drain(..=index);
        if line.trim().is_empty() {
            continue;
        }
        if let Some(event) = parse_structured_line(&line) {
            state.emit(event);
        } else {
            for event in parser(&format!("{line}\n"), OutputSource::Stdout) {
                state.emit(event);
            }
            state.emit(AgentEvent::Status {
                text: "structured parse fallback: raw text".to_owned(),
            });
        }
    }
}

fn flush_stdout(
    state: &mut RunState,
    protocol: AgentProtocol,
    parser: &ChunkParser,
    stdout_rest: &mut String,
) {
    if stdout_rest.is_empty() {
        return;
    }
    let rest = std::mem::take(stdout_rest);
    if let Some(event) = parse_structured_line(&rest) {
        state.emit(event);
    } else if protocol == AgentProtocol::Structured {
        for event in parser(&rest, OutputSource::Stdout) {
            state.emit(event);
        }
    } else {
        state.emit(AgentEvent::AssistantText { text: rest });
    }
}

fn finalize(
    state: &mut RunState,
    status: AgentRunStatus,
    code: Option<i32>,
    signal: Option<String>,
    timed_out: bool,
    duration: Duration,
) -> AgentRunResult {
    let text = state.output_text();
    match status {
        AgentRunStatus::Completed => state.emit(AgentEvent::Completed {
            text: text.clone(),
            exit_code: code,
        }),
        AgentRunStatus::Timeout => state.emit(AgentEvent::Aborted {
            reason: "执行超时，已终止进程组".to_owned(),
        }),
        AgentRunStatus::Aborted => state.emit(AgentEvent::Aborted {
            reason: "用户取消，已终止进程组".to_owned(),
        }),
        AgentRunStatus::Failed | AgentRunStatus::SpawnError => {
            state.emit(AgentEvent::Failed {
                message: if state.stderr_tail.is_empty() {
                    format!("进程退出 code={code:?}")
                } else {
                    state.stderr_tail.clone()
                },
                exit_code: code,
            });
        }
    }

    AgentRunResult {
        status,
        code,
        signal,
        duration_ms: duration.as_millis() as u64,
        timed_out,
        text,
        stderr_tail: tail(&state.stderr_tail, STDERR_TAIL_CHARS),
        events: state.retained_events(),
    }
}

async fn run_agent(
    options: AgentRunOptions,
    abort_rx: watch::Receiver<Option<AbortReason>>,
    event_tx: mpsc::UnboundedSender<AgentEvent>,
) -> AgentRunResult {
    let started = Instant::now();
    let mut state = RunState::new(event_tx);
    let mut command = match build_command(&options) {
        Ok(command) => command,
        Err(message) => {
            state.stderr_tail = message;
            return finalize(
                &mut state,
                AgentRunStatus::SpawnError,
                None,
                None,
                false,
                started.elapsed(),
            );
        }
    };

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            state.stderr_tail = error.to_string();
            return finalize(
                &mut state,
                AgentRunStatus::SpawnError,
                None,
                None,
                false,
                started.elapsed(),
            );
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (raw_tx, mut raw_rx) = mpsc::channel::<RawChunk>(256);
    let stdout_task = stdout.map(|stdout| {
        let sender = raw_tx.clone();
        tokio::spawn(read_stream(stdout, OutputSource::Stdout, sender))
    });
    let stderr_task = stderr.map(|stderr| {
        let sender = raw_tx.clone();
        tokio::spawn(read_stream(stderr, OutputSource::Stderr, sender))
    });
    drop(raw_tx);

    let parser: ChunkParser = options
        .parse_chunk
        .clone()
        .unwrap_or_else(|| Arc::new(default_parse_chunk));
    let mut stdout_rest = String::new();
    let mut abort_rx = abort_rx;
    let mut abort_reason: Option<AbortReason> = None;
    let mut timeout_sleep: Option<Pin<Box<Sleep>>> = options
        .timeout
        .filter(|timeout| !timeout.is_zero())
        .map(|timeout| Box::pin(sleep(timeout)));
    let mut kill_deadline: Option<Pin<Box<Sleep>>> = None;
    let mut child_exit = None;
    let mut streams_closed = false;

    loop {
        tokio::select! {
            changed = abort_rx.changed() => {
                if changed.is_ok() && abort_reason.is_none() && abort_rx.borrow().is_some() {
                    abort_reason = Some(AbortReason::User);
                    timeout_sleep = None;
                    kill_process_tree(&mut child, false);
                    kill_deadline = Some(Box::pin(sleep(KILL_GRACE)));
                }
            }
            _ = async {
                if let Some(timeout) = timeout_sleep.as_mut() {
                    timeout.as_mut().await;
                }
            }, if timeout_sleep.is_some() => {
                timeout_sleep = None;
                if abort_reason.is_none() {
                    abort_reason = Some(AbortReason::Timeout);
                    kill_process_tree(&mut child, false);
                    kill_deadline = Some(Box::pin(sleep(KILL_GRACE)));
                }
            }
            _ = async {
                if let Some(deadline) = kill_deadline.as_mut() {
                    deadline.as_mut().await;
                }
            }, if kill_deadline.is_some() => {
                kill_deadline = None;
                kill_process_tree(&mut child, true);
            }
            chunk = raw_rx.recv(), if !streams_closed => {
                match chunk {
                    Some(chunk) => match chunk.source {
                        OutputSource::Stdout => process_stdout_chunk(
                            &mut state,
                            &chunk.text,
                            options.protocol,
                            &parser,
                            &mut stdout_rest,
                        ),
                        OutputSource::Stderr => {
                            state.stderr_tail = tail(
                                &(state.stderr_tail + &chunk.text),
                                STDERR_TAIL_CHARS,
                            );
                            for event in parser(&chunk.text, OutputSource::Stderr) {
                                state.emit(event);
                            }
                        }
                    },
                    None => streams_closed = true,
                }
            }
            // On Unix, keep the process group leader unreaped until its output
            // pipes close. Descendants may still hold them after the leader exits.
            status = child.wait(), if child_exit.is_none() && (!cfg!(unix) || streams_closed) => {
                if let Ok(status) = status {
                    child_exit = Some(status);
                }
            }
        }

        if child_exit.is_some() && streams_closed {
            break;
        }
    }

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }
    flush_stdout(&mut state, options.protocol, &parser, &mut stdout_rest);

    let (code, signal) = child_exit
        .as_ref()
        .map(exit_details)
        .unwrap_or((None, None));
    let status = match abort_reason {
        Some(AbortReason::Timeout) => AgentRunStatus::Timeout,
        Some(AbortReason::User) => AgentRunStatus::Aborted,
        None if state.terminal_status == Some(AgentRunStatus::Failed)
            || signal.is_some()
            || code.is_some_and(|code| code != 0) =>
        {
            AgentRunStatus::Failed
        }
        None if state.terminal_status == Some(AgentRunStatus::Completed) || code == Some(0) => {
            AgentRunStatus::Completed
        }
        None if code.is_none() => AgentRunStatus::Completed,
        None => AgentRunStatus::Failed,
    };

    finalize(
        &mut state,
        status,
        code,
        signal,
        abort_reason == Some(AbortReason::Timeout),
        started.elapsed(),
    )
}

/// Start an agent command and return an event stream plus completion handle.
pub fn start_agent_run(options: AgentRunOptions) -> AgentRunHandle {
    let run_id = options
        .run_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let (abort_tx, abort_rx) = watch::channel(None);
    let done = tokio::spawn(run_agent(options, abort_rx, event_tx));

    AgentRunHandle {
        run_id,
        events: event_rx,
        done,
        abort_tx,
    }
}
