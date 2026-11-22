import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";

import type { DetectedCli } from "../src/models/cli";
import { App } from "../src/ui/App";
import { CliList } from "../src/ui/components/CliList";

const ESC = String.fromCharCode(27);
const ARROW_RIGHT = `${ESC}[C`;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A path whose length is stable regardless of the machine running the test. */
const LOCAL_PATH = "/opt/bin/codex";

const LABELLED: DetectedCli[] = [
  {
    id: "codex",
    bin: "codex",
    path: LOCAL_PATH,
    version: "codex-cli 0.154.0",
    available: true,
    runtime: "local",
    source: "installer",
  },
  {
    id: "claude",
    bin: "claude",
    path: "/home/me/.local/bin/claude",
    version: "2.0.1",
    available: true,
    runtime: "local",
    source: "npm",
  },
  {
    id: "pi",
    bin: "pi",
    path: "/usr/bin/pi",
    version: null,
    available: true,
    runtime: "local",
    source: "path",
  },
  {
    id: "omp",
    bin: "omp",
    path: "",
    version: null,
    available: false,
    diagnostics: [
      {
        level: "info",
        message: "未发现 omp。已检查 PATH 与常见安装目录：/home/me/.local/bin",
      },
    ],
  },
];

function detailLineFor(index: number): string {
  const instance = render(<CliList clis={LABELLED} selectedIndex={index} />);
  const frame = instance.lastFrame() ?? "";
  instance.cleanup();
  return frame;
}

describe("CLI rail labels", () => {
  test("a local CLI shows its version, its path and its install channel", () => {
    const frame = detailLineFor(0);

    expect(frame).toContain("v0.154.0");
    expect(frame).toContain(LOCAL_PATH);
    expect(frame).toContain("· installer");
  });

  test("an npm CLI shows its npm install channel", () => {
    const frame = detailLineFor(1);

    expect(frame).toContain("v2.0.1");
    expect(frame).toContain("· npm");
  });

  test("a CLI without a version says so rather than showing a blank", () => {
    expect(detailLineFor(2)).toContain("版本未知");
  });

  test("an unavailable CLI points at doctor instead of only saying it is missing", () => {
    const frame = detailLineFor(3);

    expect(frame).toContain("未发现 omp");
    expect(frame).toContain("运行 coderelay doctor 查看安装方式");
  });

  test("availability is legible without colour", () => {
    const frame = detailLineFor(0);

    expect(frame).toContain("● Codex");
    expect(frame).toContain("○ OMP");
  });
});

async function renderApp(clis: readonly DetectedCli[]) {
  const instance = render(
    <App clis={clis} onLaunch={() => undefined} onExit={() => undefined} />,
  );
  await nextTick();
  return instance;
}

describe("missing-CLI detail screen", () => {
  test("lists what was searched, how to install, and to reopen the terminal", async () => {
    const instance = await renderApp(LABELLED);

    instance.stdin.write("\r"); // 手动选择 → 轨道
    await nextTick();
    for (let i = 0; i < 3; i += 1) {
      instance.stdin.write(ARROW_RIGHT);
      await nextTick();
    }
    instance.stdin.write("\r"); // 未安装 → 详情
    await nextTick();

    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("OMP 还没就位");
    expect(frame).toContain("当前环境未发现 omp。");
    expect(frame).toContain("已检查 PATH 与常见安装目录");
    expect(frame).toContain("coderelay 不会代跑");
    expect(frame).toContain("装好后重新打开终端");
    instance.cleanup();
  });

  test("a WSL CLI is labelled by its distribution on the rail", async () => {
    const instance = await renderApp(LABELLED);

    instance.stdin.write("\r");
    await nextTick();
    instance.stdin.write(ARROW_RIGHT);
    await nextTick();

    expect(instance.lastFrame()).toContain("WSL: Ubuntu");
    instance.cleanup();
  });
});
