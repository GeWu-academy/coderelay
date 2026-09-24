/**
 * 统一 Agent 事件流：子 CLI 的 stdout/stderr 被各适配器解析为这些事件，
 * TUI、run 命令和会话记录都只消费这一层，不再直接解析原始输出。
 */
import { z } from "zod";

export const AgentEventKindSchema = z.enum([
  "session_started",
  "status",
  "assistant_text",
  "tool_started",
  "tool_finished",
  "stderr",
  "completed",
  "failed",
  "aborted",
]);

export type AgentEventKind = z.infer<typeof AgentEventKindSchema>;

export interface SessionStartedEvent {
  readonly kind: "session_started";
  readonly cliId: string;
  readonly model?: string;
  readonly protocol: "structured" | "text";
  readonly nativeSessionId?: string;
}

export interface StatusEvent {
  readonly kind: "status";
  readonly text: string;
}

export interface AssistantTextEvent {
  readonly kind: "assistant_text";
  readonly text: string;
}

export interface ToolStartedEvent {
  readonly kind: "tool_started";
  readonly tool: string;
}

export interface ToolFinishedEvent {
  readonly kind: "tool_finished";
  readonly tool: string;
  readonly ok: boolean;
}

export interface StderrEvent {
  readonly kind: "stderr";
  readonly text: string;
}

export interface CompletedEvent {
  readonly kind: "completed";
  readonly text: string;
  readonly exitCode: number | null;
}

export interface FailedEvent {
  readonly kind: "failed";
  readonly message: string;
  readonly exitCode: number | null;
}

export interface AbortedEvent {
  readonly kind: "aborted";
  readonly reason: string;
}

export type AgentEvent =
  | SessionStartedEvent
  | StatusEvent
  | AssistantTextEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | StderrEvent
  | CompletedEvent
  | FailedEvent
  | AbortedEvent;

/** 运行结束状态：完成 / 失败 / 超时 / 取消 / 启动失败。 */
export type AgentRunStatus =
  | "completed"
  | "failed"
  | "timeout"
  | "aborted"
  | "spawn-error";

export interface AgentRunResult {
  readonly status: AgentRunStatus;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly text: string;
  readonly stderrTail: string;
}

const BaseStructuredEventSchema = z.object({
  type: z.string(),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 尝试把一行结构化输出解析为统一事件。返回 null 表示不是结构化事件，
 * 调用方应将其作为 assistant_text / stderr 文本回退。
 */
export function parseStructuredLine(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
  const base = BaseStructuredEventSchema.safeParse(parsed);
  if (!base.success || !isRecord(parsed)) {
    return null;
  }
  const type = base.data.type;
  if (type === "assistant_text" || type === "text" || type === "message") {
    const text = asString(parsed["text"]) ?? asString(parsed["content"]) ?? asString(parsed["delta"]);
    return text ? { kind: "assistant_text", text } : null;
  }
  if (type === "status") {
    const text = asString(parsed["text"]) ?? asString(parsed["message"]) ?? type;
    return { kind: "status", text };
  }
  if (type === "tool_started" || type === "tool_use") {
    const tool = asString(parsed["tool"]) ?? asString(parsed["name"]) ?? "tool";
    return { kind: "tool_started", tool };
  }
  if (type === "tool_finished" || type === "tool_result") {
    const tool = asString(parsed["tool"]) ?? asString(parsed["name"]) ?? "tool";
    const ok = parsed["ok"] !== false && parsed["error"] === undefined;
    return { kind: "tool_finished", tool, ok };
  }
  if (type === "result" || type === "completed") {
    const text = asString(parsed["text"]) ?? asString(parsed["result"]) ?? "";
    return { kind: "completed", text, exitCode: 0 };
  }
  if (type === "error" || type === "failed") {
    const message = asString(parsed["message"]) ?? asString(parsed["error"]) ?? "cli failed";
    return { kind: "failed", message, exitCode: 1 };
  }
  return null;
}

/** 把事件流折叠为可存入 SQLite 的摘要文本。 */
export function summarizeEvents(events: readonly AgentEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    if (event.kind === "assistant_text") {
      parts.push(event.text);
    } else if (event.kind === "tool_started") {
      parts.push(`[tool:${event.tool}]`);
    }
  }
  const joined = parts.join("").trim();
  return joined.length > 4000 ? `…${joined.slice(-4000)}` : joined;
}
