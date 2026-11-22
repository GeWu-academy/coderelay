#![cfg(unix)]

use std::time::Duration;

use coderelay_core::host::Platform;
use coderelay_core::runtime::{
    AgentEvent, AgentProtocol, AgentRunHandle, AgentRunOptions, AgentRunResult, AgentRunStatus,
    start_agent_run,
};
use coderelay_core::scanner::{CliRuntime, LaunchTarget};
use tokio::sync::mpsc;
use tokio::time::sleep;

fn shell(script: &str) -> AgentRunOptions {
    AgentRunOptions::new(["sh", "-c", script])
}

async fn collect_events(handle: &mut AgentRunHandle) -> Vec<AgentEvent> {
    let mut events = Vec::new();
    while let Some(event) = handle.events.recv().await {
        events.push(event);
    }
    events
}

async fn run(options: AgentRunOptions) -> AgentRunResult {
    let mut handle = start_agent_run(options);
    let events = collect_events(&mut handle).await;
    let mut result = handle.done.await.expect("run task");
    result.events = events;
    result
}

fn assistant_text(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::AssistantText { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn text_protocol_streams_stdout_and_completes() {
    let result = run(shell(
        "printf 'hel'; sleep 0.03; printf 'lo\\n'; sleep 0.03; printf 'world\\n'",
    ))
    .await;
    assert_eq!(result.status, AgentRunStatus::Completed);
    assert!(assistant_text(&result.events).contains("hello"));
    assert!(assistant_text(&result.events).contains("world"));
    assert!(matches!(
        result.events.last(),
        Some(AgentEvent::Completed { .. })
    ));
}

#[tokio::test]
async fn stderr_flood_does_not_block_stdout_completion() {
    let result = run(shell(
        r#"i=0; while [ $i -lt 300 ]; do printf 'noise-%s\n' "$i" >&2; i=$((i+1)); done; printf 'done\n'"#,
    ))
    .await;

    assert_eq!(result.status, AgentRunStatus::Completed);
    assert!(assistant_text(&result.events).contains("done"));
    assert!(result.events.iter().any(|event| matches!(
        event,
        AgentEvent::Stderr { text } if text.contains("noise-")
    )));
    assert!(result.stderr_tail.contains("noise-299"));
}

#[tokio::test]
async fn structured_json_can_span_reader_chunks() {
    let mut options = shell(
        "printf '{\"type\":\"tool_st'; sleep 0.05; printf 'arted\",\"tool\":\"splitter\"}\\n'",
    );
    options.protocol = AgentProtocol::Structured;
    let result = run(options).await;

    assert_eq!(result.status, AgentRunStatus::Completed);
    assert!(result.events.iter().any(|event| matches!(
        event,
        AgentEvent::ToolStarted { tool } if tool == "splitter"
    )));
}

#[tokio::test]
async fn structured_parse_failure_falls_back_to_visible_text() {
    let mut options = shell("printf '{not json\\n'");
    options.protocol = AgentProtocol::Structured;
    let result = run(options).await;

    assert_eq!(result.status, AgentRunStatus::Completed);
    assert!(assistant_text(&result.events).contains("{not json"));
    assert!(result.events.iter().any(|event| matches!(
        event,
        AgentEvent::Status { text } if text == "structured parse fallback: raw text"
    )));
}

#[tokio::test]
async fn trailing_structured_line_is_flushed_without_newline() {
    let mut options = shell("printf '{\"type\":\"assistant_text\",\"text\":\"tail\"}'");
    options.protocol = AgentProtocol::Structured;
    let result = run(options).await;

    assert_eq!(result.status, AgentRunStatus::Completed);
    assert_eq!(result.text, "tail");
}

#[tokio::test]
async fn nonzero_exit_and_structured_failure_map_to_failed() {
    let failed = run(shell("printf 'boom\\n' >&2; exit 2")).await;
    assert_eq!(failed.status, AgentRunStatus::Failed);
    assert_eq!(failed.code, Some(2));
    assert!(failed.stderr_tail.contains("boom"));

    let mut structured = shell("printf '{\"type\":\"error\",\"message\":\"rejected\"}\\n'");
    structured.protocol = AgentProtocol::Structured;
    let failed_event = run(structured).await;
    assert_eq!(failed_event.status, AgentRunStatus::Failed);
    assert!(failed_event.events.iter().any(|event| matches!(
        event,
        AgentEvent::Failed { message, .. } if message == "rejected"
    )));
}

#[tokio::test]
async fn missing_binary_returns_spawn_error() {
    let result = run(AgentRunOptions::new(["__coderelay_missing_fixture__"])).await;
    assert_eq!(result.status, AgentRunStatus::SpawnError);
    assert!(
        result
            .events
            .iter()
            .any(|event| matches!(event, AgentEvent::Failed { .. }))
    );
}

#[tokio::test]
async fn timeout_terminates_the_process_group() {
    let mut options = shell("sleep 30");
    options.timeout = Some(Duration::from_millis(120));
    let result = run(options).await;

    assert_eq!(result.status, AgentRunStatus::Timeout);
    assert!(result.timed_out);
    assert!(result.events.iter().any(|event| matches!(
        event,
        AgentEvent::Aborted { reason } if reason.contains("执行超时")
    )));
}

#[tokio::test]
async fn timeout_terminates_descendants_after_the_group_leader_exits() {
    let mut options = shell("sleep 6 & exit 0");
    options.timeout = Some(Duration::from_millis(300));

    let result = tokio::time::timeout(Duration::from_secs(3), run(options))
        .await
        .expect("timeout must close pipes held by the descendant");

    assert_eq!(result.status, AgentRunStatus::Timeout);
}

#[tokio::test]
async fn user_abort_wins_over_a_later_timeout() {
    let mut options = shell("sleep 30");
    options.timeout = Some(Duration::from_millis(120));
    let mut handle = start_agent_run(options);
    let (_, placeholder) = mpsc::unbounded_channel();
    let mut event_stream = std::mem::replace(&mut handle.events, placeholder);

    let events_task = tokio::spawn(async move {
        let mut events = Vec::new();
        while let Some(event) = event_stream.recv().await {
            events.push(event);
        }
        events
    });
    sleep(Duration::from_millis(20)).await;
    handle.abort();
    let mut result = handle.done.await.expect("run task");
    result.events = events_task.await.expect("events task");

    assert_eq!(result.status, AgentRunStatus::Aborted);
    assert!(!result.timed_out);
    assert!(result.events.iter().any(|event| matches!(
        event,
        AgentEvent::Aborted { reason } if reason.contains("用户取消")
    )));
}

#[tokio::test]
async fn abort_kills_the_descendant_process_group() {
    let mut handle = start_agent_run(shell(
        "sleep 30 & child=$!; printf 'child:%s\\n' \"$child\"; wait",
    ));
    let mut child_pid = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);

    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_millis(100), handle.events.recv()).await {
            Ok(Some(AgentEvent::AssistantText { text })) => {
                if let Some(rest) = text.strip_prefix("child:") {
                    child_pid = rest
                        .split_whitespace()
                        .next()
                        .and_then(|value| value.parse::<i32>().ok());
                    if child_pid.is_some() {
                        break;
                    }
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => {}
        }
    }

    let child_pid = child_pid.expect("descendant pid");
    handle.abort();
    let result = handle.done.await.expect("run task");
    assert_eq!(result.status, AgentRunStatus::Aborted);
    sleep(Duration::from_millis(500)).await;

    let alive = unsafe { libc::kill(child_pid, 0) } == 0;
    assert!(!alive, "descendant process {child_pid} is still alive");
}

#[test]
fn shell_resolution_matches_platform_rules() {
    let local = LaunchTarget {
        path: "C:\\fixture\\claude.cmd".to_owned(),
        runtime: CliRuntime::Local,
    };

    assert!(coderelay_core::runtime::resolve_agent_shell(
        None,
        Some(&local),
        "C:\\fixture\\claude.cmd",
        Platform::Win32,
    ));
    assert!(!coderelay_core::runtime::resolve_agent_shell(
        None,
        None,
        "/usr/bin/claude",
        Platform::Linux,
    ));
    assert!(!coderelay_core::runtime::resolve_agent_shell(
        Some(false),
        Some(&local),
        "C:\\fixture\\claude.cmd",
        Platform::Win32,
    ));
}
