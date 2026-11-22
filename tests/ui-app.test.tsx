import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import type { DetectedCli } from "../src/models/cli";
import type { SessionTurn } from "../src/models/session";
import { App, type LaunchRequest, type RunningTask } from "../src/ui/App";

const CLIS: DetectedCli[] = [
  {
    id: "codex",
    bin: "codex",
    path: "/opt/bin/codex",
    version: "codex-cli 0.1.0",
    available: true,
  },
  {
    id: "claude",
    bin: "claude",
    path: "/opt/bin/claude",
    version: "1.2.3",
    available: true,
  },
  {
    id: "pi",
    bin: "pi",
    path: "/opt/bin/pi",
    version: null,
    available: true,
  },
  {
    id: "omp",
    bin: "omp",
    path: "",
    version: null,
    available: false,
  },
];

function turn(overrides: Partial<SessionTurn> = {}): SessionTurn {
  return {
    id: 1,
    sessionId: "session-1",
    cliId: "codex",
    prompt: "fix lint",
    output: "hello\nworld",
    exitCode: 0,
    signal: null,
    durationMs: 1200,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function afterEscapeFlush(): Promise<void> {
  // Ink buffers a lone ESC for 20ms so it can distinguish it from an ANSI key sequence.
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function renderApp(
  overrides: Partial<{
    clis: readonly DetectedCli[];
    isScanning: boolean;
    initialId: DetectedCli["id"];
    turns: readonly SessionTurn[];
    running: RunningTask | null;
    onLaunch: (request: LaunchRequest) => void;
    onAbort: () => void;
    onNewSession: () => void;
    onExit: () => void;
  }> = {},
) {
  let launches: LaunchRequest[] = [];
  let aborts = 0;
  let newSessions = 0;
  let exits = 0;

  const instance = render(
    <App
      clis={overrides.clis ?? CLIS}
      isScanning={overrides.isScanning ?? false}
      initialId={overrides.initialId}
      turns={overrides.turns ?? []}
      running={overrides.running ?? null}
      onLaunch={(request) => {
        launches.push(request);
        overrides.onLaunch?.(request);
      }}
      onAbort={() => {
        aborts += 1;
        overrides.onAbort?.();
      }}
      onNewSession={() => {
        newSessions += 1;
        overrides.onNewSession?.();
      }}
      onExit={() => {
        exits += 1;
        overrides.onExit?.();
      }}
    />,
  );

  return {
    ...instance,
    launches: () => launches,
    aborts: () => aborts,
    newSessions: () => newSessions,
    exits: () => exits,
  };
}

describe("App UI", () => {
  test("shows the scanning message while discovery is running", () => {
    const instance = renderApp({ clis: [], isScanning: true });

    expect(instance.lastFrame()).toContain("正在扫描本机编码代理");
    instance.cleanup();
  });

  test("starts on the mode screen with manual and auto options", () => {
    const instance = renderApp();
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("先选个开场方式？");
    expect(frame).toContain("手动选择");
    expect(frame).toContain("自动路由");
    expect(frame).toContain("自己挑用哪个 CLI 干活");
    instance.cleanup();
  });

  test("manual mode enters the picker", async () => {
    const instance = renderApp();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.lastFrame()).toContain("这一棒交给谁？");
    instance.cleanup();
  });

  test("auto mode skips the picker with the first available CLI", async () => {
    const instance = renderApp();
    instance.stdin.write("\u001B[C");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.lastFrame()).toContain("将任务交给 Codex");
    instance.cleanup();
  });

  test("auto mode picks the first available CLI when the first is missing", async () => {
    const custom: DetectedCli[] = CLIS.map((cli, index) =>
      index === 0 ? { ...cli, available: false, path: "" } : cli,
    );
    const instance = renderApp({ clis: custom });
    instance.stdin.write("\u001B[C");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.lastFrame()).toContain("将任务交给 Claude Code");
    instance.cleanup();
  });

  test("renders the horizontal CLI rail with one underline and selected detail", async () => {
    const instance = renderApp();
    instance.stdin.write("\r");
    await nextTick();
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("这一棒交给谁？");
    expect(frame).toContain("● Codex");
    expect(frame).toContain("● Claude Code");
    expect(frame).toContain("● Pi");
    expect(frame).toContain("○ OMP");
    expect(frame).toContain("v0.1.0");
    expect(frame.match(/─+/g)).toHaveLength(1);
    instance.cleanup();
  });

  test("shows the focused CLI detail line while moving the rail", async () => {
    const instance = renderApp();
    instance.stdin.write("\r");
    await nextTick();

    for (let i = 0; i < 3; i += 1) {
      instance.stdin.write("\u001B[C");
      await nextTick();
    }

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("未发现 omp");
    expect(frame.match(/─+/g)).toEqual(["─────"]);
    instance.cleanup();
  });

  test("moves with → and enters chat, then accepts text input", async () => {
    const instance = renderApp();
    instance.stdin.write("\r");
    await nextTick();

    instance.stdin.write("\u001B[C");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.lastFrame()).toContain("将任务交给 Claude Code");

    instance.stdin.write("hello agent");
    await nextTick();

    expect(instance.lastFrame()).toContain("hello agent");
    instance.cleanup();
  });

  test("Enter launches prompt mode and tab launches interactive mode", async () => {
    const first = renderApp();
    first.stdin.write("\r");
    await nextTick();
    first.stdin.write("\r");
    await nextTick();
    first.stdin.write("do work");
    await nextTick();
    first.stdin.write("\r");
    await nextTick();

    expect(first.launches()).toEqual([{ id: "codex", mode: "prompt", prompt: "do work" }]);
    first.cleanup();

    const second = renderApp();
    second.stdin.write("\r");
    await nextTick();
    second.stdin.write("\r");
    await nextTick();
    second.stdin.write("ignored");
    await nextTick();
    second.stdin.write("\t");
    await nextTick();

    expect(second.launches()).toEqual([{ id: "codex", mode: "interactive" }]);
    second.cleanup();
  });

  test("esc walks back one screen at a time and ctrl+c exits", async () => {
    const instance = renderApp();

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();
    expect(instance.lastFrame()).toContain("将任务交给 Codex");

    instance.stdin.write("\u001B");
    await afterEscapeFlush();
    expect(instance.lastFrame()).toContain("Claude Code");

    instance.stdin.write("\u001B");
    await afterEscapeFlush();
    expect(instance.lastFrame()).toContain("先选个开场方式？");
    expect(instance.exits()).toBe(0);

    instance.stdin.write("\u0003");
    await nextTick();
    expect(instance.exits()).toBe(1);
    instance.cleanup();
  });

  test("q is no longer an exit key", async () => {
    const instance = renderApp();

    instance.stdin.write("q");
    await nextTick();

    expect(instance.exits()).toBe(0);
    expect(instance.lastFrame()).toContain("先选个开场方式？");
    instance.cleanup();
  });

  test("esc aborts a running task instead of quitting", async () => {
    const instance = renderApp({
      initialId: "claude",
      running: { id: "claude", prompt: "x", startedAt: Date.now() },
    });

    instance.stdin.write("\u001B");
    await afterEscapeFlush();

    expect(instance.aborts()).toBe(1);
    expect(instance.exits()).toBe(0);
    instance.cleanup();
  });

  test("submit clears the input so the next turn starts fresh", async () => {
    const instance = renderApp();

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("do work");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.launches()).toEqual([{ id: "codex", mode: "prompt", prompt: "do work" }]);
    expect(instance.lastFrame()).toContain("写下任务");
    instance.cleanup();
  });

  test("typing a slash shows the live command menu", async () => {
    const instance = renderApp();

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("/m");
    await nextTick();

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("/model");
    expect(frame).toContain("切换 agent");
    instance.cleanup();
  });

  test("/model returns to the picker and keeps the session", async () => {
    const instance = renderApp({ turns: [turn()] });

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("/model");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.lastFrame()).toContain("这一棒交给谁？");
    instance.cleanup();
  });

  test("/new starts a fresh session via the callback", async () => {
    const instance = renderApp({ turns: [turn()] });

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("/new");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.newSessions()).toBe(1);
    instance.cleanup();
  });

  test("unknown slash command shows a notice", async () => {
    const instance = renderApp();

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("/foo");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(instance.lastFrame()).toContain("未知命令");
    instance.cleanup();
  });

  test("renders session turns with prompt, output tail and status", () => {
    const instance = renderApp({
      initialId: "codex",
      turns: [
        turn(),
        turn({
          id: 2,
          cliId: "claude",
          prompt: "继续",
          output: "done",
          exitCode: 0,
          durationMs: 2400,
        }),
      ],
    });

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("会话 · 2 轮");
    expect(frame).toContain("fix lint");
    expect(frame).toMatch(/\s{20,}❯ fix lint/);
    expect(frame).toContain("hello");
    expect(frame).toMatch(/\s{20,}✓ Codex · exit 0 · 1\.2s/);
    expect(frame).toContain("✓ Claude Code · exit 0 · 2.4s");
    instance.cleanup();
  });

  test("failed turn shows the signal status and red output", () => {
    const instance = renderApp({
      initialId: "pi",
      turns: [
        turn({
          cliId: "pi",
          prompt: "explode",
          output: "bad input",
          exitCode: 2,
          durationMs: 300,
        }),
      ],
    });

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("× Pi · exit 2 · 0.3s");
    expect(frame).toContain("bad input");
    instance.cleanup();
  });

  test("result stage shows the loop-back arrow pointing at selection", () => {
    const instance = renderApp({ initialId: "codex", turns: [turn()] });

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("▸ 结果");
    expect(frame).toMatch(/→\s*选择/);
    instance.cleanup();
  });

  test("loop-back arrow only appears on the result stage", () => {
    const picker = renderApp();
    expect(picker.lastFrame() ?? "").not.toMatch(/→\s*选择/);
    picker.cleanup();

    const composing = renderApp({ initialId: "codex" });
    expect(composing.lastFrame() ?? "").not.toMatch(/→\s*选择/);
    composing.cleanup();

    const runningChat = renderApp({
      initialId: "codex",
      turns: [turn()],
      running: { id: "codex", prompt: "x", startedAt: Date.now() },
    });
    expect(runningChat.lastFrame() ?? "").not.toMatch(/→\s*选择/);
    runningChat.cleanup();
  });

  test("running shows a waiting placeholder, keeps the input visible, ctrl+c aborts", () => {
    const instance = renderApp({
      initialId: "claude",
      turns: [turn()],
      running: {
        id: "claude",
        prompt: "write tests",
        startedAt: Date.now(),
      },
    });

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("▸ 执行");
    expect(frame).toContain("等待 Claude Code 的回复");
    expect(frame).toMatch(/[◆●•·]{4}/);
    expect(frame).toContain("write tests");
    expect(frame).toMatch(/\s{20,}write tests/);
    expect(frame).toContain("中止任务");
    expect(frame).toContain("写下任务");

    instance.stdin.write("\u0003");
    instance.cleanup();
  });

  test("ctrl+c aborts while running and exits while idle", async () => {
    const runningInstance = renderApp({
      initialId: "claude",
      running: { id: "claude", prompt: "x", startedAt: Date.now() },
    });
    runningInstance.stdin.write("\u0003");
    await nextTick();
    expect(runningInstance.aborts()).toBe(1);
    expect(runningInstance.exits()).toBe(0);
    runningInstance.cleanup();

    const idleInstance = renderApp({ initialId: "claude" });
    idleInstance.stdin.write("\u0003");
    await nextTick();
    expect(idleInstance.exits()).toBe(1);
    idleInstance.cleanup();
  });
});
