import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

import {
  METHODS,
  PROTOCOL_VERSION,
  type AgentEvent,
  type AgentRunResult,
  type CancelRunResult,
  type ConfigSourceResult,
  type DiscoverAgentsResult,
  type EventEnvelope,
  type Method,
  type ModelCatalog,
  type ProtocolErrorBody,
  type RequestEnvelope,
  type ResponseEnvelope,
  type RouteParams,
  type RouteResult,
  type RunCompletedEnvelope,
  type SaveConfigParams,
  type SaveConfigResult,
  type SessionDetailResult,
  type SessionRecord,
  type StartRunParams,
  type StartRunResult,
  type StatusResult,
  type WorkspaceParams,
} from "./protocol";

export class CoderelayProtocolError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(error: ProtocolErrorBody) {
    super(error.message);
    this.name = "CoderelayProtocolError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

export interface CoderelayClientOptions {
  /** Host executable. Defaults to CODERELAY_BIN or `coderelay`. */
  command?: string;
  /** Host arguments. Defaults to `["sdk"]`. */
  args?: string[];
  /** Working directory for the host process. */
  cwd?: string;
  /** Extra environment passed to the host process. */
  env?: Record<string, string>;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type RunOutcome = { result: AgentRunResult } | { error: Error };

interface RunState {
  queue: AgentEvent[];
  waiters: ((event: AgentEvent | null) => void)[];
  outcome: RunOutcome | null;
  completionPromise: Promise<RunOutcome>;
  resolveCompletion: (outcome: RunOutcome) => void;
}

export type EventListener = (event: AgentEvent, envelope: EventEnvelope) => void;
export type RunCompletedListener = (
  result: AgentRunResult,
  envelope: RunCompletedEnvelope,
) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
  return (
    isRecord(value) &&
    (value["status"] === "ok" || value["status"] === "error") &&
    typeof value["requestId"] === "string" &&
    typeof value["protocolVersion"] === "number"
  );
}

function isEventEnvelope(value: unknown): value is EventEnvelope {
  return (
    isRecord(value) &&
    typeof value["runId"] === "string" &&
    typeof value["sessionId"] === "string" &&
    isRecord(value["event"]) &&
    typeof value["event"]["kind"] === "string"
  );
}

function isRunCompletedEnvelope(value: unknown): value is RunCompletedEnvelope {
  return (
    isRecord(value) &&
    typeof value["runId"] === "string" &&
    typeof value["sessionId"] === "string" &&
    isRecord(value["result"]) &&
    typeof value["result"]["status"] === "string"
  );
}

function createRunState(): RunState {
  let resolveCompletion: (outcome: RunOutcome) => void = () => undefined;
  const completionPromise = new Promise<RunOutcome>((resolve) => {
    resolveCompletion = resolve;
  });
  return {
    queue: [],
    waiters: [],
    outcome: null,
    completionPromise,
    resolveCompletion,
  };
}

function finishRun(state: RunState, outcome: RunOutcome): void {
  if (state.outcome !== null) {
    return;
  }
  state.outcome = outcome;
  state.resolveCompletion(outcome);
  for (const resolve of state.waiters.splice(0)) {
    resolve(null);
  }
}

export class CoderelayRun implements AsyncIterable<AgentEvent> {
  readonly runId: string;
  readonly sessionId: string;
  readonly agent: string;
  readonly model?: string;
  readonly reasons: string[];

  constructor(
    private readonly client: CoderelayClient,
    start: StartRunResult,
  ) {
    this.runId = start.runId;
    this.sessionId = start.sessionId;
    this.agent = start.agent;
    this.model = start.model;
    this.reasons = start.reasons;
  }

  get completed(): Promise<AgentRunResult> {
    return this.client.waitForRun(this.runId);
  }

  cancel(): Promise<CancelRunResult> {
    return this.client.cancelRun(this.runId);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.client.iterateRun(this.runId);
  }
}

export class CoderelayClient {
  private readonly options: Required<Pick<CoderelayClientOptions, "command" | "args">> &
    Omit<CoderelayClientOptions, "command" | "args">;
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private pending = new Map<string, PendingRequest>();
  private runs = new Map<string, RunState>();
  private eventListeners = new Set<EventListener>();
  private completedListeners = new Set<RunCompletedListener>();

  constructor(options: CoderelayClientOptions = {}) {
    this.options = {
      command: options.command ?? process.env.CODERELAY_BIN ?? "coderelay",
      args: options.args ?? ["sdk"],
      cwd: options.cwd,
      env: options.env,
      requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
    };
  }

  async start(): Promise<this> {
    if (this.child) {
      return this;
    }
    if (this.startPromise) {
      await this.startPromise;
      return this;
    }
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.startPromise = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) => {
        this.disconnect(child, error);
        reject(error);
      });
      let stderrTail = "";
      // "close" follows stdio drainage, so a final completion can still be read.
      child.once("close", (code, signal) => {
        const details = stderrTail.trim();
        this.disconnect(
          child,
          new Error(`CodeRelay host exited (${code ?? signal ?? "unknown"})${details ? `: ${details}` : ""}`),
        );
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-8_000);
      });
      // Failed writes are reported to their own request via the write callback.
      child.stdin.on("error", () => {});
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        if (this.child === child) {
          this.handleLine(line);
        }
      });
    });
    await this.startPromise;
    return this;
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onRunCompleted(listener: RunCompletedListener): () => void {
    this.completedListeners.add(listener);
    return () => this.completedListeners.delete(listener);
  }

  status(): Promise<StatusResult> {
    return this.request<StatusResult>(METHODS.status);
  }

  discoverAgents(workspace?: WorkspaceParams): Promise<DiscoverAgentsResult> {
    return this.request<DiscoverAgentsResult>(METHODS.discoverAgents, workspace ?? {});
  }

  getModelCatalog(workspace?: WorkspaceParams): Promise<ModelCatalog> {
    return this.request<ModelCatalog>(METHODS.getModelCatalog, {
      workspace: workspace ?? {},
    });
  }

  route(params: RouteParams): Promise<RouteResult> {
    return this.request<RouteResult>(METHODS.route, params);
  }

  async startRun(params: StartRunParams): Promise<CoderelayRun> {
    const result = await this.request<StartRunResult>(METHODS.startRun, params, (start) => {
      this.ensureRun(start.runId);
    });
    return new CoderelayRun(this, result);
  }

  async run(params: StartRunParams): Promise<CoderelayRun> {
    return this.startRun(params);
  }

  cancelRun(runId: string): Promise<CancelRunResult> {
    return this.request<CancelRunResult>(METHODS.cancelRun, { runId });
  }

  listRecentWorkspaces(limit?: number): Promise<string[]> {
    return this.request<string[]>(METHODS.listRecentWorkspaces, { limit });
  }

  listSessions(
    options: { workspace?: string; limit?: number } = {},
  ): Promise<SessionRecord[]> {
    return this.request<SessionRecord[]>(METHODS.listSessions, options);
  }

  getSession(sessionId: string): Promise<SessionDetailResult> {
    return this.request<SessionDetailResult>(METHODS.getSession, { sessionId });
  }

  readConfig(workspace?: WorkspaceParams): Promise<ConfigSourceResult> {
    return this.request<ConfigSourceResult>(METHODS.readConfig, {
      workspace: workspace ?? {},
    });
  }

  saveConfig(params: SaveConfigParams): Promise<SaveConfigResult> {
    return this.request<SaveConfigResult>(METHODS.saveConfig, params);
  }

  async close(): Promise<void> {
    const child = this.child;
    if (child) {
      this.disconnect(child, new Error("CodeRelay client closed"));
      if (!child.killed) {
        child.kill();
      }
    }
  }

  private disconnect(child: ChildProcessWithoutNullStreams, error: Error): void {
    if (this.child !== child) {
      return;
    }
    this.child = null;
    this.startPromise = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    for (const run of this.runs.values()) {
      finishRun(run, { error });
    }
  }

  async *iterateRun(runId: string): AsyncGenerator<AgentEvent> {
    const state = this.ensureRun(runId);
    while (true) {
      const queued = state.queue.shift();
      if (queued) {
        yield queued;
        continue;
      }
      if (state.outcome) {
        if ("error" in state.outcome) {
          throw state.outcome.error;
        }
        return;
      }
      const event = await new Promise<AgentEvent | null>((resolve) => {
        state.waiters.push(resolve);
      });
      if (event !== null) {
        yield event;
      }
    }
  }

  async waitForRun(runId: string): Promise<AgentRunResult> {
    const outcome = await this.ensureRun(runId).completionPromise;
    if ("error" in outcome) {
      throw outcome.error;
    }
    return outcome.result;
  }

  private ensureRun(runId: string): RunState {
    const existing = this.runs.get(runId);
    if (existing) {
      return existing;
    }
    const state = createRunState();
    this.runs.set(runId, state);
    return state;
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return;
    }

    if (isEventEnvelope(parsed)) {
      const state = this.ensureRun(parsed.runId);
      const waiter = state.waiters.shift();
      if (waiter) {
        waiter(parsed.event);
      } else {
        state.queue.push(parsed.event);
      }
      for (const listener of this.eventListeners) {
        listener(parsed.event, parsed);
      }
      return;
    }

    if (isRunCompletedEnvelope(parsed)) {
      const state = this.ensureRun(parsed.runId);
      finishRun(state, { result: parsed.result });
      for (const listener of this.completedListeners) {
        listener(parsed.result, parsed);
      }
      return;
    }

    if (!isResponseEnvelope(parsed)) {
      return;
    }
    const pending = this.pending.get(parsed.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(parsed.requestId);
    clearTimeout(pending.timer);
    if (
      parsed.protocolVersion !== PROTOCOL_VERSION
    ) {
      pending.reject(
        new CoderelayProtocolError({
          code: "unsupportedVersion",
          message: `unsupported protocol version ${parsed.protocolVersion}`,
          retryable: false,
        }),
      );
      return;
    }
    if (parsed.status === "error") {
      pending.reject(
        new CoderelayProtocolError(
          parsed.error ?? {
            code: "internal",
            message: "host returned an error without details",
            retryable: false,
          },
        ),
      );
      return;
    }
    pending.resolve(parsed.result);
  }

  private async request<T>(
    method: Method,
    params?: unknown,
    onResult?: (result: T) => void,
  ): Promise<T> {
    await this.start();
    const child = this.child;
    if (!child) {
      throw new Error("CodeRelay host is not running");
    }
    const requestId = randomUUID();
    const request: RequestEnvelope = {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      method,
      ...(params === undefined ? {} : { params }),
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`CodeRelay request timed out: ${method}`));
      }, this.options.requestTimeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => {
          const result = value as T;
          try {
            onResult?.(result);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        },
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (error && this.pending.delete(requestId)) {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }
}
