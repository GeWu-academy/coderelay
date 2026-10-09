import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { AgentEvent } from "../src/models/agent-events";
import type { LaunchTarget } from "../src/models/cli";
import { resolveAgentShell, runAgentStream } from "../src/runtime/agent-run";

const FIXTURE = new URL("./fixtures/mock-cli.ts", import.meta.url).pathname;
const NODE = process.execPath;

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = (() => true) as unknown as ChildProcess["kill"];
  return child;
}

function collect(
  cmd: readonly string[],
  opts?: { readonly protocol?: "structured" | "text"; readonly timeoutMs?: number },
): { readonly events: AgentEvent[]; readonly done: Promise<Awaited<ReturnType<typeof runAgentStream>["done"]>>; readonly handle: ReturnType<typeof runAgentStream> } {
  const events: AgentEvent[] = [];
  const handle = runAgentStream({
    cmd,
    protocol: opts?.protocol ?? "text",
    timeoutMs: opts?.timeoutMs,
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { events, done: handle.done, handle };
}

function assistantText(events: readonly AgentEvent[]): string {
  return events
    .filter((e) => e.kind === "assistant_text")
    .map((e) => (e.kind === "assistant_text" ? e.text : ""))
    .join("");
}

describe("runAgentStream", () => {
  test("emits assistant_text as stdout chunks arrive", async () => {
    const { events, done } = collect([NODE, FIXTURE, "chunked"]);
    const result = await done;
    expect(result.status).toBe("completed");
    const text = assistantText(events);
    expect(text).toContain("hello");
    expect(text).toContain("world");
  });

  test("stderr does not block stdout and still completes", async () => {
    const { events, done } = collect([NODE, FIXTURE, "stderr-flood"]);
    const result = await done;
    expect(result.status).toBe("completed");
    expect(events.some((e) => e.kind === "stderr")).toBe(true);
    expect(assistantText(events)).toContain("done");
  });

  test("joins JSON split across chunks into a tool event", async () => {
    const { events, done } = collect([NODE, FIXTURE, "split-json"], { protocol: "structured" });
    const result = await done;
    expect(result.status).toBe("completed");
    expect(events).toContainEqual({ kind: "tool_started", tool: "splitter" });
  });

  test("falls back to text events when structured parse fails", async () => {
    const { events, done } = collect([NODE, FIXTURE, "invalid-json"], { protocol: "structured" });
    const result = await done;
    expect(result.status).toBe("completed");
    expect(assistantText(events)).toContain("{not json");
    expect(events.some((e) => e.kind === "status")).toBe(true);
  });

  test("maps non-zero exit to failed", async () => {
    const { done } = collect([NODE, FIXTURE, "fail"]);
    const result = await done;
    expect(result.status).toBe("failed");
    expect(result.code).toBe(2);
  });

  test("maps missing binary to spawn-error", async () => {
    const { done } = collect(["__coderelay_no_such_bin__"]);
    const result = await done;
    expect(result.status).toBe("spawn-error");
  });

  test("maps timeout to timeout status", async () => {
    const { done } = collect([NODE, FIXTURE, "sleep"], { timeoutMs: 300 });
    const result = await done;
    expect(result.status).toBe("timeout");
    expect(result.timedOut).toBe(true);
  });

  test("abort settles as aborted and pushes no further events", async () => {
    const { events, done, handle } = collect([NODE, FIXTURE, "sleep"]);
    setTimeout(() => {
      handle.abort();
    }, 150);
    const result = await done;
    expect(result.status).toBe("aborted");
    const countAfterSettle = events.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(events.length).toBe(countAfterSettle);
  });

  test("user abort is not overwritten by subsequent timeout before process close", async () => {
    const child = fakeChild();
    const events: AgentEvent[] = [];
    const handle = runAgentStream({
      cmd: ["dummy"],
      protocol: "text",
      timeoutMs: 40,
      onEvent: (event) => events.push(event),
      dependencies: {
        spawn: () => child,
      },
    });

    handle.abort();
    // 等待 timeoutMs 定时器触发窗口
    await new Promise((resolve) => setTimeout(resolve, 80));
    child.emit("close", null, "SIGTERM");

    const result = await handle.done;
    expect(result.status).toBe("aborted");
    expect(result.timedOut).toBe(false);
    expect(events.some((e) => e.kind === "aborted" && e.reason.includes("用户取消"))).toBe(true);
    expect(events.some((e) => e.kind === "aborted" && e.reason.includes("执行超时"))).toBe(false);
  });

  test("timeout termination is not overwritten by subsequent abort before process close", async () => {
    const child = fakeChild();
    const events: AgentEvent[] = [];
    const handle = runAgentStream({
      cmd: ["dummy"],
      protocol: "text",
      timeoutMs: 30,
      onEvent: (event) => events.push(event),
      dependencies: {
        spawn: () => child,
      },
    });

    // 等待 timeout 先行触发
    await new Promise((resolve) => setTimeout(resolve, 60));
    handle.abort();
    child.emit("close", null, "SIGTERM");

    const result = await handle.done;
    expect(result.status).toBe("timeout");
    expect(result.timedOut).toBe(true);
    expect(events.some((e) => e.kind === "aborted" && e.reason.includes("执行超时"))).toBe(true);
    expect(events.some((e) => e.kind === "aborted" && e.reason.includes("用户取消"))).toBe(false);
  });

  test("pre-aborted signal terminates as aborted and ignores timeout", async () => {
    const controller = new AbortController();
    controller.abort();
    const events: AgentEvent[] = [];
    let spawnCount = 0;
    const handle = runAgentStream({
      cmd: ["dummy"],
      protocol: "text",
      signal: controller.signal,
      timeoutMs: 40,
      onEvent: (event) => events.push(event),
      dependencies: {
        spawn: () => {
          spawnCount += 1;
          return fakeChild();
        },
      },
    });

    const result = await handle.done;
    expect(spawnCount).toBe(0);
    expect(result.status).toBe("aborted");
    expect(result.timedOut).toBe(false);
    expect(events.some((e) => e.kind === "aborted" && e.reason.includes("用户取消"))).toBe(true);
  });

  test("text protocol preserves JSON-looking answers and blank lines", async () => {
    const child = fakeChild();
    const handle = runAgentStream({
      cmd: ["dummy"],
      protocol: "text",
      onEvent: () => undefined,
      dependencies: { spawn: () => child },
    });
    child.stdout?.emit("data", Buffer.from('{"type":"error","message":"example"}\n\nnext'));
    child.emit("close", 0, null);
    const result = await handle.done;
    expect(result.status).toBe("completed");
    expect(result.text).toBe('{"type":"error","message":"example"}\n\nnext');
    expect(result.events.some((event) => event.kind === "failed")).toBe(false);
  });

  test("keeps complete output beyond the event summary limit", async () => {
    const child = fakeChild();
    const payload = "x".repeat(5_000);
    const handle = runAgentStream({
      cmd: ["dummy"],
      protocol: "text",
      onEvent: () => undefined,
      dependencies: { spawn: () => child },
    });
    child.stdout?.emit("data", Buffer.from(payload));
    child.emit("close", 0, null);
    const result = await handle.done;
    expect(result.text).toBe(payload);
  });

  test("structured failure event wins over a zero exit code", async () => {
    const child = fakeChild();
    const handle = runAgentStream({
      cmd: ["dummy"],
      protocol: "structured",
      onEvent: () => undefined,
      dependencies: { spawn: () => child },
    });
    child.stdout?.emit("data", Buffer.from('{"type":"error","message":"rejected"}\n'));
    child.emit("close", 0, null);
    expect((await handle.done).status).toBe("failed");
  });

  test("cleans up streams and listeners after exit", async () => {
    const { done, handle } = collect([NODE, FIXTURE, "chunked"]);
    const result = await done;
    expect(result.status).toBe("completed");
    expect(handle.child.stdout?.listenerCount("data")).toBe(0);
    expect(handle.child.stderr?.listenerCount("data")).toBe(0);
    const stdin = handle.child.stdin;
    expect(stdin === null || stdin.destroyed || stdin.writableEnded).toBe(true);
  });

  test("abort terminates the whole process tree", async () => {
    if (process.platform === "win32") {
      return;
    }
    const { events, done, handle } = collect([NODE, FIXTURE, "child"]);
    // 等孙进程 pid 行到达后再取消，避免竞态。
    const deadline = Date.now() + 5000;
    let grandchildPid = -1;
    while (Date.now() < deadline) {
      const text = assistantText(events);
      const match = /grandchild:(\d+)/.exec(text);
      if (match?.[1]) {
        grandchildPid = Number(match[1]);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(grandchildPid).toBeGreaterThan(0);
    handle.abort();
    const result = await done;
    expect(result.status).toBe("aborted");
    await new Promise((resolve) => setTimeout(resolve, 500));
    let alive = true;
    try {
      process.kill(grandchildPid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });
});

describe("resolveAgentShell", () => {
  const localTarget: LaunchTarget = {
    path: "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
    runtime: "local",
  };
  const wslTarget: LaunchTarget = {
    path: "/usr/bin/claude",
    runtime: "wsl",
  };

  test("uses shell for local .cmd target on Windows", () => {
    expect(resolveAgentShell({ target: localTarget }, localTarget.path, "win32")).toBe(true);
  });

  test("does not use shell for WSL target on Windows", () => {
    expect(resolveAgentShell({ target: wslTarget }, "wsl.exe", "win32")).toBe(false);
  });

  test("does not use shell when binary is wsl.exe without target", () => {
    expect(resolveAgentShell({}, "wsl.exe", "win32")).toBe(false);
    expect(resolveAgentShell({}, "C:\\Windows\\System32\\wsl.exe", "win32")).toBe(false);
  });

  test("uses shell on Windows when target is omitted for local binaries", () => {
    expect(resolveAgentShell({}, "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd", "win32")).toBe(true);
    expect(resolveAgentShell({}, "claude.cmd", "win32")).toBe(true);
    expect(resolveAgentShell({}, "codex.exe", "win32")).toBe(true);
  });

  test("does not use shell on Unix platforms", () => {
    expect(resolveAgentShell({ target: localTarget }, localTarget.path, "darwin")).toBe(false);
    expect(resolveAgentShell({ target: localTarget }, localTarget.path, "linux")).toBe(false);
  });

  test("honours explicit shell override", () => {
    expect(resolveAgentShell({ shell: false, target: localTarget }, localTarget.path, "win32")).toBe(false);
    expect(resolveAgentShell({ shell: true }, "/usr/bin/tool", "linux")).toBe(true);
  });
});

describe("runAgentStream shell handling", () => {
  test("spawns with shell: true and windowsHide: true on Windows for local .cmd target", () => {
    let captured: { file: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
    const target: LaunchTarget = {
      path: "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
      runtime: "local",
    };

    runAgentStream({
      cmd: [target.path, "-p", "hi"],
      target,
      protocol: "text",
      onEvent: () => undefined,
      dependencies: {
        platform: "win32",
        spawn: (file, args, options) => {
          captured = { file, args, options };
          return fakeChild();
        },
      },
    });

    expect(captured).toBeDefined();
    expect(captured?.file).toBe("C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd");
    expect(captured?.args).toEqual(["-p", "hi"]);
    expect(captured?.options).toMatchObject({
      shell: true,
      windowsHide: true,
      detached: false,
    });
  });

  test("spawns with shell: false on Windows for WSL target", () => {
    let captured: { file: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
    const target: LaunchTarget = {
      path: "/usr/bin/claude",
      runtime: "wsl",
      distro: "Ubuntu",
    };

    runAgentStream({
      cmd: ["wsl.exe", "-d", "Ubuntu", "--", target.path, "-p", "hi"],
      target,
      protocol: "text",
      onEvent: () => undefined,
      dependencies: {
        platform: "win32",
        spawn: (file, args, options) => {
          captured = { file, args, options };
          return fakeChild();
        },
      },
    });

    expect(captured).toBeDefined();
    expect(captured?.file).toBe("wsl.exe");
    expect(captured?.options).toMatchObject({
      shell: false,
      windowsHide: true,
      detached: false,
    });
  });

  test("spawns with shell: false and detached: true on Unix", () => {
    let captured: { file: string; args: readonly string[]; options: Record<string, unknown> } | undefined;

    runAgentStream({
      cmd: ["/usr/local/bin/claude", "-p", "hi"],
      protocol: "text",
      onEvent: () => undefined,
      dependencies: {
        platform: "darwin",
        spawn: (file, args, options) => {
          captured = { file, args, options };
          return fakeChild();
        },
      },
    });

    expect(captured).toBeDefined();
    expect(captured?.file).toBe("/usr/local/bin/claude");
    expect(captured?.options).toMatchObject({
      shell: false,
      windowsHide: true,
      detached: true,
    });
  });
});
