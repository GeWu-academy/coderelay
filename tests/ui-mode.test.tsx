import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import type { DetectedCli } from "../src/models/cli";
import { App } from "../src/ui/App";

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
];

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("App Mode & Jev Integration", () => {
  test("shows 3 decision modes on mode screen including Jev", () => {
    const instance = render(<App clis={CLIS} onLaunch={() => {}} onExit={() => {}} />);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("手动选择");
    expect(frame).toContain("自动路由");
    expect(frame).toContain("Jev 决策");
    instance.cleanup();
  });

  test("can navigate to Jev mode using arrow keys on mode screen", async () => {
    let selectedMode: string | undefined;
    const instance = render(
      <App
        clis={CLIS}
        onLaunch={() => {}}
        onExit={() => {}}
        onModeChange={(m) => {
          selectedMode = m;
        }}
      />,
    );

    // Right arrow twice -> Jev 决策
    instance.stdin.write("\u001B[C");
    await nextTick();
    instance.stdin.write("\u001B[C");
    await nextTick();

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("调用 TypeSafe Jev 模型做第三方决策");

    // Enter to select Jev mode
    instance.stdin.write("\r");
    await nextTick();

    expect(selectedMode).toBe("jev");
    instance.cleanup();
  });

  test("switches mode via /mode slash command in chat screen", async () => {
    let modeState: string | undefined = "local";
    const instance = render(
      <App
        clis={CLIS}
        initialId="codex"
        routingMode="local"
        onLaunch={() => {}}
        onExit={() => {}}
        onModeChange={(m) => {
          modeState = m;
        }}
      />,
    );

    // Enter picker, then enter chat
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    // Type /mode jev and submit
    instance.stdin.write("/mode jev");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(modeState).toBe("jev");
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("决策模式已切换为：Jev 模型决策");
    expect(frame).toContain("[决策: JEV]");
    instance.cleanup();
  });

  test("handles /favorite command to set and query favorite agent", async () => {
    let favorite: string | undefined;
    let cleared = false;
    const instance = render(
      <App
        clis={CLIS}
        initialId="codex"
        favoriteAgent="codex"
        onLaunch={() => {}}
        onExit={() => {}}
        onSetFavoriteAgent={(agent) => {
          favorite = agent;
        }}
        onClearFavoriteAgent={() => {
          cleared = true;
        }}
      />,
    );

    // Enter picker, then enter chat
    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    // Query current favorite
    instance.stdin.write("/favorite");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    let frame = instance.lastFrame() ?? "";
    expect(frame).toContain("当前最喜欢的初始化 agent 是: Codex (codex)");

    // Set favorite to claude
    instance.stdin.write("/favorite claude");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(favorite).toBe("claude");
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("已将 Claude Code (claude) 设为最喜欢的初始化 agent");

    // Clear favorite
    instance.stdin.write("/favorite clear");
    await nextTick();
    instance.stdin.write("\r");
    await nextTick();

    expect(cleared).toBe(true);
    frame = instance.lastFrame() ?? "";
    expect(frame).toContain("已清除最喜欢的初始化 agent 偏好设置");
    instance.cleanup();
  });
});
