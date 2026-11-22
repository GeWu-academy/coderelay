import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import type { ModelOption, ProbeDisplay } from "../src/agents/model-catalog";
import type { CliCapabilities } from "../src/agents/capabilities";
import type { DetectedCli } from "../src/models/cli";
import { App } from "../src/ui/App";

const CLIS: DetectedCli[] = [
  { id: "codex", bin: "codex", path: "/bin/codex", version: "1", available: true },
  { id: "claude", bin: "claude", path: "/bin/claude", version: "1", available: true },
  { id: "pi", bin: "pi", path: "", version: null, available: false },
  { id: "omp", bin: "omp", path: "/bin/omp", version: "1", available: true },
];

const CAPS: CliCapabilities = {
  structuredEvents: true,
  nativeResume: false,
  nonInteractivePrompt: true,
  explicitModel: true,
  toolEvents: true,
};

function option(
  overrides: Partial<ModelOption> & {
    readonly cliId: ModelOption["cliId"];
    readonly modelId: string;
  },
): ModelOption {
  return {
    label: overrides.modelId,
    isDefault: false,
    capabilities: CAPS,
    strengths: [],
    available: true,
    ...overrides,
  };
}

const PROBES: ProbeDisplay[] = [
  { cliId: "codex", status: "found", models: [] },
  { cliId: "claude", status: "scanning", models: [] },
  { cliId: "pi", status: "not-installed", models: [], reason: "未安装" },
  { cliId: "omp", status: "unprobed", models: [], reason: "auth missing" },
];

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("unified lifecycle TUI phases", () => {
  test("probing shows each CLI status independently", () => {
    const instance = render(
      <App
        clis={CLIS}
        initialId="codex"
        phase="probing"
        probes={PROBES}
        onLaunch={() => undefined}
        onExit={() => undefined}
      />,
    );
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("正在探测本机模型");
    expect(frame).toContain("已找到");
    expect(frame).toContain("扫描中");
    expect(frame).toContain("未安装");
    expect(frame).toContain("无法探测");
    instance.cleanup();
  });

  test("selecting shows unprobed probe reasons", () => {
    const options = [option({ cliId: "codex", modelId: "gpt-5" })];
    const instance = render(
      <App
        clis={CLIS}
        initialId="codex"
        phase="selecting"
        probes={PROBES}
        modelOptions={options}
        onLaunch={() => undefined}
        onExit={() => undefined}
      />,
    );
    expect(instance.lastFrame()).toContain("auth missing");
    instance.cleanup();
  });

  test("selecting only submits available models on Enter", async () => {
    const options = [
      option({ cliId: "codex", modelId: "bad", available: false, reason: "无法探测" }),
      option({ cliId: "codex", modelId: "good" }),
    ];
    let selected: ModelOption | undefined;
    // selectedModelIndex 同时圈定 CLI 步的落点：CLI 现在必须与模型同一个，
    // 选择器不会再展示其他 CLI 的模型。
    const bad = render(
      <App
        clis={CLIS}
        initialId="codex"
        phase="selecting"
        probes={PROBES}
        modelOptions={options}
        selectedModelIndex={0}
        onSelectModel={(o) => {
          selected = o;
        }}
        onLaunch={() => undefined}
        onExit={() => undefined}
      />,
    );
    await settle();
    bad.stdin.write("\r");
    await settle();
    expect(selected).toBeUndefined();
    bad.cleanup();

    const good = render(
      <App
        clis={CLIS}
        initialId="codex"
        phase="selecting"
        probes={PROBES}
        modelOptions={options}
        selectedModelIndex={1}
        onSelectModel={(o) => {
          selected = o;
        }}
        onLaunch={() => undefined}
        onExit={() => undefined}
      />,
    );
    await settle();
    good.stdin.write("\r");
    await settle();
    expect(selected?.modelId).toBe("good");
    good.cleanup();
  });

  test("ctrl-c in probing/selecting cancels, in starting/running aborts, idle exits", async () => {
    async function ctrlC(
      phase: "probing" | "selecting" | "starting" | "running" | "idle",
    ): Promise<{ cancelled: number; aborted: number; exited: number }> {
      let cancelled = 0;
      let aborted = 0;
      let exited = 0;
      const instance = render(
        <App
          clis={CLIS}
          initialId="codex"
          phase={phase}
          probes={PROBES}
          modelOptions={[option({ cliId: "codex", modelId: "gpt-5" })]}
          onLaunch={() => undefined}
          onExit={() => {
            exited += 1;
          }}
          onAbort={() => {
            aborted += 1;
          }}
          onCancelSelecting={() => {
            cancelled += 1;
          }}
        />,
      );
      instance.stdin.write("\x03");
      await settle();
      instance.cleanup();
      return { cancelled, aborted, exited };
    }

    expect(await ctrlC("probing")).toEqual({ cancelled: 1, aborted: 0, exited: 0 });
    expect(await ctrlC("selecting")).toEqual({ cancelled: 1, aborted: 0, exited: 0 });
    expect(await ctrlC("starting")).toEqual({ cancelled: 0, aborted: 1, exited: 0 });
    expect(await ctrlC("running")).toEqual({ cancelled: 0, aborted: 1, exited: 0 });
    expect(await ctrlC("idle")).toEqual({ cancelled: 0, aborted: 0, exited: 1 });
  });
});
