import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import type { ActivationOption } from "../src/config/activation";
import type { DetectedCli } from "../src/models/cli";
import { App } from "../src/ui/App";

const CLIS: DetectedCli[] = [
  { id: "codex", bin: "codex", path: "/bin/codex", version: "1", available: true },
  { id: "claude", bin: "claude", path: "/bin/claude", version: "1", available: true },
  { id: "pi", bin: "pi", path: "", version: null, available: false },
  { id: "omp", bin: "omp", path: "/bin/omp", version: "1", available: true },
];

function option(
  overrides: Partial<ActivationOption> & { readonly cliId: ActivationOption["cliId"] },
): ActivationOption {
  return { available: true, enabled: true, decided: false, ...overrides };
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

interface Harness {
  readonly saves: ActivationOption[][];
  readonly cancels: { count: number };
  readonly frame: () => string;
  readonly press: (key: string) => Promise<void>;
  readonly cleanup: () => void;
}

async function renderActivation(
  rows: readonly ActivationOption[],
  mode: "confirm" | "manage" = "confirm",
): Promise<Harness> {
  const saves: ActivationOption[][] = [];
  const cancels = { count: 0 };
  const instance = render(
    <App
      clis={CLIS}
      initialId="codex"
      phase="activating"
      activationOptions={rows}
      activationMode={mode}
      onSaveActivation={(next) => {
        saves.push([...next]);
      }}
      onCancelActivation={() => {
        cancels.count += 1;
      }}
      onLaunch={() => undefined}
      onExit={() => undefined}
    />,
  );
  await settle();
  return {
    saves,
    cancels,
    frame: () => instance.lastFrame() ?? "",
    press: async (key: string) => {
      instance.stdin.write(key);
      await settle();
    },
    cleanup: () => instance.cleanup(),
  };
}

/** Last saved set, as a cliId → enabled map, for terse assertions. */
function savedStates(harness: Harness): Record<string, boolean> {
  const last = harness.saves.at(-1) ?? [];
  return Object.fromEntries(last.map((row) => [row.cliId, row.enabled]));
}

describe("activation page", () => {
  test("lists each CLI with its install state and where the choice is saved", async () => {
    const view = await renderActivation([
      option({ cliId: "codex" }),
      option({ cliId: "claude", enabled: false }),
      option({ cliId: "pi", available: false }),
    ]);
    const frame = view.frame();
    expect(frame).toContain("激活 CLI");
    expect(frame).toContain("已激活");
    expect(frame).toContain("已禁用");
    expect(frame).toContain("未安装");
    expect(frame).toContain(".coderelay/config.yaml");
    view.cleanup();
  });

  test("the manager page uses its own title", async () => {
    const view = await renderActivation([option({ cliId: "codex", decided: true })], "manage");
    expect(view.frame()).toContain("管理 CLI 激活状态");
    view.cleanup();
  });

  test("space toggles the focused row and Enter saves the changed set", async () => {
    const view = await renderActivation([option({ cliId: "codex" }), option({ cliId: "claude" })]);
    // 光标初始落在首个可切换行；下移一格后切换，改的应当是 claude。
    await view.press("j");
    await view.press(" ");
    await view.press("\r");

    expect(view.saves).toHaveLength(1);
    expect(savedStates(view)).toEqual({ codex: true, claude: false });
    view.cleanup();
  });

  test("toggling twice returns the row to its original state", async () => {
    const view = await renderActivation([option({ cliId: "codex" })]);
    await view.press(" ");
    expect(view.frame()).toContain("已禁用");
    await view.press(" ");
    expect(view.frame()).toContain("已激活");
    view.cleanup();
  });

  test("an uninstalled CLI is written back unchanged", async () => {
    const view = await renderActivation([
      option({ cliId: "pi", available: false, enabled: false }),
      option({ cliId: "codex" }),
    ]);
    // 光标初始落在可切换的 codex；pi 既进不去也切不动，保存时按原样回写。
    await view.press("k");
    await view.press(" ");
    await view.press("\r");
    expect(savedStates(view)).toEqual({ pi: false, codex: false });
    view.cleanup();
  });

  test("the cursor skips uninstalled rows", async () => {
    const view = await renderActivation([
      option({ cliId: "codex" }),
      option({ cliId: "pi", available: false, enabled: false }),
      option({ cliId: "omp" }),
    ]);
    // 从 codex 下移一格应直接落在 omp，跳过中间的 pi。
    await view.press("j");
    await view.press(" ");
    await view.press("\r");
    expect(savedStates(view)).toEqual({ codex: true, pi: false, omp: false });
    view.cleanup();
  });

  test("saving with every CLI off is allowed and warns about auto-routing", async () => {
    const view = await renderActivation([
      option({ cliId: "codex", enabled: false }),
      option({ cliId: "claude", enabled: false }),
    ]);
    expect(view.frame()).toContain("当前没有已激活的 CLI");
    await view.press("\r");
    expect(view.saves).toHaveLength(1);
    expect(savedStates(view)).toEqual({ codex: false, claude: false });
    view.cleanup();
  });

  test("esc cancels without writing anything", async () => {
    const view = await renderActivation([option({ cliId: "codex" }), option({ cliId: "claude" })]);
    await view.press(" ");
    await view.press("\x1b");
    expect(view.cancels.count).toBe(1);
    expect(view.saves).toHaveLength(0);
    view.cleanup();
  });

  test("leaving the activating phase lands on an interactive screen", async () => {
    // 激活页退出后 screen 必须跟着走，否则没有任何 useInput 处于激活状态，界面卡死。
    const common = {
      clis: CLIS,
      initialId: "codex" as const,
      activationOptions: [option({ cliId: "codex" })],
      onLaunch: () => undefined,
      onExit: () => undefined,
    };
    const instance = render(<App {...common} phase="activating" />);
    await settle();
    expect(instance.lastFrame() ?? "").toContain("激活 CLI");

    instance.rerender(<App {...common} phase="idle" />);
    await settle();
    expect(instance.lastFrame() ?? "").toContain("写下任务");

    // 键位重新生效：esc 能一路退回首屏（卡死的界面到不了首屏）。
    instance.stdin.write("\x1b");
    await settle();
    instance.stdin.write("\x1b");
    await settle();
    expect(instance.lastFrame() ?? "").toContain("先选个开场方式？");
    instance.cleanup();
  });

  test("a write failure stays on the activation page and shows the reason", async () => {
    // 保存失败时页面不能跳走，否则用户既看不到错误也无法重试。
    const instance = render(
      <App
        clis={CLIS}
        initialId="codex"
        phase="activating"
        activationOptions={[option({ cliId: "codex" })]}
        lastResult={{ phase: "failed", message: "× 保存失败：EACCES" }}
        onLaunch={() => undefined}
        onExit={() => undefined}
      />,
    );
    await settle();
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("激活 CLI");
    expect(frame).toContain("× 保存失败：EACCES");
    instance.cleanup();
  });
});
