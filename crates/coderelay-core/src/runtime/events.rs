use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentProtocol {
    Structured,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    #[serde(rename_all = "camelCase")]
    SessionStarted {
        cli_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        protocol: AgentProtocol,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        native_session_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Status { text: String },
    #[serde(rename_all = "camelCase")]
    Thinking { text: String },
    #[serde(rename_all = "camelCase")]
    AssistantText { text: String },
    #[serde(rename_all = "camelCase")]
    ToolStarted { tool: String },
    #[serde(rename_all = "camelCase")]
    ToolFinished { tool: String, ok: bool },
    #[serde(rename_all = "camelCase")]
    Stderr { text: String },
    #[serde(rename_all = "camelCase")]
    Completed {
        text: String,
        exit_code: Option<i32>,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        message: String,
        exit_code: Option<i32>,
    },
    #[serde(rename_all = "camelCase")]
    Aborted { reason: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentRunStatus {
    Completed,
    Failed,
    Timeout,
    Aborted,
    SpawnError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunResult {
    pub status: AgentRunStatus,
    pub code: Option<i32>,
    pub signal: Option<String>,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub text: String,
    pub stderr_tail: String,
    pub events: Vec<AgentEvent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputSource {
    Stdout,
    Stderr,
}

fn text_value(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_owned)
}

/// Parse one structured JSON line. `None` means callers should fall back to raw text.
pub fn parse_structured_line(line: &str) -> Option<AgentEvent> {
    let trimmed = line.trim();
    if !trimmed.starts_with('{') {
        return None;
    }
    let value: Value = serde_json::from_str(trimmed).ok()?;
    let kind = value.get("type")?.as_str()?;

    match kind {
        "thinking" | "reasoning" | "thought" | "thinking_delta" | "reasoning_delta" => {
            let text = text_value(
                &value,
                &["thinking", "text", "content", "delta", "reasoning"],
            )?;
            (!text.is_empty()).then_some(AgentEvent::Thinking { text })
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            let delta_type = delta.get("type").and_then(Value::as_str)?;
            match delta_type {
                "thinking_delta" => {
                    let text = text_value(delta, &["thinking", "text"])?;
                    (!text.is_empty()).then_some(AgentEvent::Thinking { text })
                }
                "text_delta" => {
                    let text = text_value(delta, &["text"])?;
                    (!text.is_empty()).then_some(AgentEvent::AssistantText { text })
                }
                _ => None,
            }
        }
        "item.completed" | "item.updated" => {
            let item = value.get("item")?;
            if item.get("type").and_then(Value::as_str) == Some("reasoning") {
                let text = text_value(item, &["text", "thinking", "content"])?;
                (!text.is_empty()).then_some(AgentEvent::Thinking { text })
            } else {
                None
            }
        }
        "assistant_text" | "text" | "message" => {
            let text = text_value(&value, &["text", "content", "delta"])?;
            (!text.is_empty()).then_some(AgentEvent::AssistantText { text })
        }
        "status" => Some(AgentEvent::Status {
            text: text_value(&value, &["text", "message"]).unwrap_or_else(|| kind.to_owned()),
        }),
        "tool_started" | "tool_use" => Some(AgentEvent::ToolStarted {
            tool: text_value(&value, &["tool", "name"]).unwrap_or_else(|| "tool".to_owned()),
        }),
        "tool_finished" | "tool_result" => Some(AgentEvent::ToolFinished {
            tool: text_value(&value, &["tool", "name"]).unwrap_or_else(|| "tool".to_owned()),
            ok: value.get("ok").and_then(Value::as_bool) != Some(false)
                && value.get("error").is_none(),
        }),
        "result" | "completed" => Some(AgentEvent::Completed {
            text: text_value(&value, &["text", "result"]).unwrap_or_default(),
            exit_code: Some(0),
        }),
        "error" | "failed" => Some(AgentEvent::Failed {
            message: text_value(&value, &["message", "error"])
                .unwrap_or_else(|| "cli failed".to_owned()),
            exit_code: Some(1),
        }),
        _ => None,
    }
}

/// Default chunk parser used when an adapter does not supply one.
pub fn default_parse_chunk(chunk: &str, source: OutputSource) -> Vec<AgentEvent> {
    if chunk.is_empty() {
        return Vec::new();
    }
    match source {
        OutputSource::Stdout => vec![AgentEvent::AssistantText {
            text: chunk.to_owned(),
        }],
        OutputSource::Stderr => vec![AgentEvent::Stderr {
            text: chunk.to_owned(),
        }],
    }
}

/// Fold events into a bounded transcript summary.
pub fn summarize_events(events: &[AgentEvent]) -> String {
    let mut parts = Vec::new();
    for event in events {
        match event {
            AgentEvent::AssistantText { text } => parts.push(text.clone()),
            AgentEvent::ToolStarted { tool } => parts.push(format!("[tool:{tool}]")),
            _ => {}
        }
    }

    let joined = parts.join("").trim().to_owned();
    let count = joined.chars().count();
    if count > 4000 {
        format!("…{}", joined.chars().skip(count - 4000).collect::<String>())
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_structured_thinking_variants_separately_from_assistant_text() {
        assert_eq!(
            parse_structured_line(r#"{"type":"thinking","text":"step 1"}"#),
            Some(AgentEvent::Thinking {
                text: "step 1".to_owned()
            })
        );
        assert_eq!(
            parse_structured_line(r#"{"type":"reasoning","content":"analyzing"}"#),
            Some(AgentEvent::Thinking {
                text: "analyzing".to_owned()
            })
        );
        assert_eq!(
            parse_structured_line(
                r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"deep thought"}}"#
            ),
            Some(AgentEvent::Thinking {
                text: "deep thought".to_owned()
            })
        );
        assert_eq!(
            parse_structured_line(
                r#"{"type":"item.completed","item":{"type":"reasoning","text":"codex reason"}}"#
            ),
            Some(AgentEvent::Thinking {
                text: "codex reason".to_owned()
            })
        );
        assert_eq!(
            parse_structured_line(r#"{"type":"thinking","text":""}"#),
            None
        );
    }

    #[test]
    fn summarize_events_excludes_thinking_from_output_summary() {
        let events = vec![
            AgentEvent::Thinking {
                text: "secret reasoning".to_owned(),
            },
            AgentEvent::AssistantText {
                text: "final answer".to_owned(),
            },
        ];
        assert_eq!(summarize_events(&events), "final answer");
    }
}
