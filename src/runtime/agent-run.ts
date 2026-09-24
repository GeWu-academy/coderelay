/**
 * 统一进程生命周期：可捕获、可取消、可流式的事件流运行接口。
 *
 * - stdin/stdout/stderr 全部 pipe，实时消费防止缓冲区死锁；
 * - 优先结构化事件流，不支持时走文本解析器；
 * - Ctrl-C / 超时终止整个子进程组（Unix 独立进程组 SIGTERM→SIGKILL，
 *   Windows 进程树终止），关闭管道并记录 aborted；
 * - 结束时统一关闭 stdin、解除监听器、释放流。
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import {
  parseStructuredLine,
  summarizeEvents,
  type AgentEvent,
} from "../models/agent-events";
import type { LaunchTarget } from "../models/cli";

export type AgentSpawnRunner = (
  file: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly stdio: ["pipe", "pipe", "pipe"];
    readonly detached: boolean;
    readonly windowsHide: boolean;
    readonly shell: boolean;
  },
) => ChildProcess;

export interface AgentRunDependencies {
  readonly spawn: AgentSpawnRunner;
  readonly platform: NodeJS.Platform;
}

export interface AgentRunOptions {
  readonly cmd: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** 结构化优先；text 直接按文本事件透出。 */
  readonly protocol: "structured" | "text";
  readonly onEvent: (event: AgentEvent) => void;
  /**
   * 适配器声明的文本解析器（structured 解析失败时的回退也经过它，
   * 未提供时默认按 assistant_text/stderr 透出）。
   */
  readonly parseChunk?: (
    chunk: string,
    source: "stdout" | "stderr",
  ) => readonly AgentEvent[];
  readonly target?: LaunchTarget;
  readonly shell?: boolean;
  readonly dependencies?: Partial<AgentRunDependencies>;
}

export interface AgentRunResult {
  readonly status: "completed" | "failed" | "timeout" | "aborted" | "spawn-error";
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly text: string;
  readonly stderrTail: string;
  readonly events: readonly AgentEvent[];
}

export interface AgentRunHandle {
  readonly child: ChildProcess;
  readonly done: Promise<AgentRunResult>;
  readonly abort: () => void;
}

const STDERR_TAIL_CHARS = 8_000;
const MAX_RETAINED_EVENTS = 2_000;
const KILL_GRACE_MS = 2_000;

function defaultParse(
  chunk: string,
  source: "stdout" | "stderr",
): readonly AgentEvent[] {
  if (!chunk) {
    return [];
  }
  return source === "stderr"
    ? [{ kind: "stderr", text: chunk }]
    : [{ kind: "assistant_text", text: chunk }];
}

/** 终止整个进程组；绝不只杀 CLI 主进程。 */
function killProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    child.kill?.("SIGKILL");
    return;
  }
  if (process.platform === "win32") {
    // Windows：taskkill 带 /t 结束整棵进程树。
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error ?? result.status !== 0) {
      child.kill("SIGKILL");
    }
    return;
  }
  try {
    // Unix：独立进程组启动（detached），负 pid 发给整组。
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // 进程可能已退出，忽略。
    }
  }
}

function forceKill(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined) {
    try {
      child.kill("SIGKILL");
    } catch {
      // 忽略：进程可能已退出。
    }
    return;
  }
  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error ?? result.status !== 0) {
      try {
        child.kill("SIGKILL");
      } catch {
        // 忽略：进程可能已退出。
      }
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // 忽略：进程可能已退出。
    }
  }
}

function tail(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

const defaultSpawn: AgentSpawnRunner = (file, args, options) =>
  spawn(file, [...args], options);

/**
 * Determine if spawn requires shell execution.
 * Windows .cmd/.bat shims (e.g. npm global binaries) require cmd.exe to launch.
 * WSL targets must spawn wsl.exe directly without cmd.exe re-parsing.
 */
export function resolveAgentShell(
  options: {
    readonly shell?: boolean;
    readonly target?: LaunchTarget;
  },
  bin: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (options.shell !== undefined) {
    return options.shell;
  }
  if (platform !== "win32") {
    return false;
  }
  if (options.target?.runtime === "wsl") {
    return false;
  }
  const normalized = bin.toLowerCase();
  return (
    normalized !== "wsl.exe" &&
    !normalized.endsWith("\\wsl.exe") &&
    !normalized.endsWith("/wsl.exe")
  );
}

/**
 * 以事件流方式运行一条 agent 命令。prompt 应已由调用方编码进 cmd
 *（适配器 buildPromptArgs），本函数只负责进程组生命周期与流式解析。
 */
export function runAgentStream(options: AgentRunOptions): AgentRunHandle {
  const startedAt = Date.now();
  const events: AgentEvent[] = [];
  const outputParts: string[] = [];
  let terminalStatus: "completed" | "failed" | null = null;
  const emit = (event: AgentEvent): void => {
    if (event.kind === "assistant_text") {
      outputParts.push(event.text);
    } else if (event.kind === "completed") {
      terminalStatus = "completed";
      if (outputParts.length === 0 && event.text) {
        outputParts.push(event.text);
      }
    } else if (event.kind === "failed") {
      terminalStatus = "failed";
    }
    events.push(event);
    if (events.length > MAX_RETAINED_EVENTS) {
      events.shift();
    }
    options.onEvent(event);
  };
  const parse = options.parseChunk ?? defaultParse;
  const spawnFn = options.dependencies?.spawn ?? defaultSpawn;
  const platform = options.dependencies?.platform ?? process.platform;

  const [bin, ...args] = options.cmd;
  if (options.signal?.aborted) {
    const child = new EventEmitter() as ChildProcess;
    const event: AgentEvent = { kind: "aborted", reason: "用户取消，已终止进程组" };
    emit(event);
    return {
      child,
      done: Promise.resolve({
        status: "aborted",
        code: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        text: "",
        stderrTail: "",
        events,
      }),
      abort: () => undefined,
    };
  }
  const result = ((): AgentRunHandle | { readonly spawnError: Error } => {
    try {
      if (!bin) {
        throw new Error("runAgentStream requires a non-empty cmd array");
      }
      const shell = resolveAgentShell(options, bin, platform);
      const child = spawnFn(bin, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ["pipe", "pipe", "pipe"],
        // Unix detached process group; Windows process tree kill via taskkill /t.
        detached: platform !== "win32",
        windowsHide: true,
        shell,
      });
      return { child } as AgentRunHandle;
    } catch (error) {
      return {
        spawnError: error instanceof Error ? error : new Error(String(error)),
      };
    }
  })();

  if ("spawnError" in result) {
    const message = result.spawnError.message;
    emit({ kind: "failed", message, exitCode: null });
    const done = Promise.resolve({
      status: "spawn-error",
      code: null,
      signal: null,
      durationMs: Date.now() - startedAt,
      timedOut: false,
      text: "",
      stderrTail: message,
      events,
    } as const);
    return {
      // 启动失败时没有真实子进程：返回一个已被终止的占位进程句柄。
      child: spawn(process.execPath, ["--eval", ""], { stdio: "ignore" }),
      done: done as Promise<AgentRunResult>,
      abort: () => undefined,
    };
  }

  const { child } = result;
  let settled = false;
  let abortReason: "timeout" | "abort" | null = null;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const finish = (
    status: AgentRunResult["status"],
    code: number | null,
    signal: NodeJS.Signals | null,
    timedOut: boolean,
    stderrTail: string,
  ): AgentRunResult => {
    const text = outputParts.length > 0
      ? outputParts.join("").trim()
      : summarizeEvents(events);
    if (status === "completed") {
      emit({ kind: "completed", text, exitCode: code });
    } else if (status === "aborted" || status === "timeout") {
      emit({
        kind: "aborted",
        reason: status === "timeout" ? "执行超时，已终止进程组" : "用户取消，已终止进程组",
      });
    } else {
      emit({ kind: "failed", message: stderrTail || `进程退出 code=${code}`, exitCode: code });
    }
    return {
      status,
      code,
      signal,
      durationMs: Date.now() - startedAt,
      timedOut,
      text,
      stderrTail,
      events,
    };
  };

  const cleanup = (): void => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = undefined;
    }
    options.signal?.removeEventListener("abort", onAbort);
    try {
      child.stdin?.end();
    } catch {
      // 管道可能已关闭，忽略。
    }
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.removeAllListeners();
  };

  const terminate = (reason: "timeout" | "abort"): void => {
    if (settled || abortReason !== null) {
      return;
    }
    abortReason = reason;
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
    killProcessTree(child);
    killTimer = setTimeout(() => {
      forceKill(child);
    }, KILL_GRACE_MS);
    killTimer.unref?.();
  };

  function onAbort(): void {
    terminate("abort");
  }
  if (options.signal?.aborted) {
    terminate("abort");
  } else {
    options.signal?.addEventListener("abort", onAbort, { once: true });
  }

  if (options.timeoutMs !== undefined && options.timeoutMs > 0 && abortReason === null) {
    timeoutTimer = setTimeout(() => {
      terminate("timeout");
    }, options.timeoutMs);
    timeoutTimer.unref?.();
  }

  // 分块 JSON 跨 chunk 拼接：按流各自缓存未成行部分。
  let stdoutRest = "";
  let stderrTail = "";

  const handleStdout = (data: Buffer | string): void => {
    const chunk = data.toString();
    if (options.protocol === "text") {
      emit({ kind: "assistant_text", text: chunk });
      return;
    }
    const text = stdoutRest + chunk;
    const lines = text.split("\n");
    stdoutRest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      if (options.protocol === "structured") {
        const structured = parseStructuredLine(line);
        if (structured) {
          emit(structured);
          continue;
        }
        // 结构化解析失败：回退文本事件并记录诊断，不丢失用户可见输出。
        for (const event of parse(`${line}\n`, "stdout")) {
          emit(event);
        }
        emit({ kind: "status", text: "structured parse fallback: raw text" });
      }
    }
  };

  const handleStderr = (data: Buffer | string): void => {
    const text = data.toString();
    stderrTail = tail(stderrTail + text, STDERR_TAIL_CHARS);
    // stderr 实时消费，绝不阻塞 stdout。
    for (const event of parse(text, "stderr")) {
      emit(event);
    }
  };

  const done = new Promise<AgentRunResult>((resolve) => {
    const settle = (
      status: AgentRunResult["status"],
      code: number | null,
      signal: NodeJS.Signals | null,
      timedOut: boolean,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      // Flush any trailing structured line after stdout has closed.
      if (stdoutRest) {
        const structured = parseStructuredLine(stdoutRest);
        if (structured) {
          emit(structured);
        } else {
          for (const event of parse(stdoutRest, "stdout")) {
            emit(event);
          }
        }
        stdoutRest = "";
      }
      cleanup();
      resolve(finish(status, code, signal, timedOut, tail(stderrTail, STDERR_TAIL_CHARS)));
    };

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.once("error", (error: Error) => {
      stderrTail = tail(`${stderrTail}\n${error.message}`, STDERR_TAIL_CHARS);
      settle("spawn-error", null, null, false);
    });
    // close 在 stdio 排空后触发，比 exit 更适合结算。
    child.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
      const finalReason = abortReason ?? (options.signal?.aborted ? "abort" : null);
      if (finalReason === "timeout") {
        settle("timeout", code, signal, true);
        return;
      }
      if (finalReason === "abort") {
        settle("aborted", code, signal, false);
        return;
      }
      if (terminalStatus === "failed" || signal !== null || (code !== null && code !== 0)) {
        settle("failed", code, signal, false);
        return;
      }
      if (terminalStatus === "completed" || code === 0 || code === null) {
        settle("completed", code, signal, false);
      }
    });
  });

  return {
    child,
    done,
    abort: () => {
      terminate("abort");
    },
  };
}
