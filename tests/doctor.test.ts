import { describe, expect, test } from "bun:test";

import {
  buildDoctorReport,
  formatDoctorReport,
  type DoctorCheck,
  type DoctorReport,
} from "../src/commands/doctor";
import { defaultConfig } from "../src/config/schema";
import type { CliId, DetectedCli } from "../src/models/cli";

function checkNamed(report: DoctorReport, name: string): DoctorCheck {
  const found = report.checks.find((check) => check.name === name);
  if (!found) {
    throw new Error(`no check named ${name}; got ${report.checks.map((c) => c.name).join(", ")}`);
  }
  return found;
}

function detectedCli(overrides: Partial<DetectedCli> & { id: CliId }): DetectedCli {
  return {
    bin: overrides.id,
    path: "",
    version: null,
    available: false,
    runtime: "local",
    source: "path",
    candidates: [],
    diagnostics: [],
    ...overrides,
  };
}

const LINUX_HOST = {
  platform: "linux" as const,
  homeDir: "/home/tester",
  env: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
};

describe("environment and PATH checks", () => {
  test("names the platform, the shell and whether it is native", () => {
    const report = buildDoctorReport(defaultConfig(), [], {
      ...LINUX_HOST,
      env: { PATH: "/usr/bin", SHELL: "/bin/zsh" },
    });

    expect(checkNamed(report, "environment")).toEqual({
      name: "environment",
      status: "ok",
      message: "Linux · zsh · 本机 shell",
    });
  });

  test("reports a PowerShell host as native Windows", () => {
    const report = buildDoctorReport(defaultConfig(), [], {
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: { PATH: "C:\\Windows", PSModulePath: "C:\\Modules" },
    });

    expect(checkNamed(report, "environment").message).toBe("Windows · PowerShell · 原生 Windows");
  });

  test("a PATH without any known install directory lists what it looked at", () => {
    const report = buildDoctorReport(defaultConfig(), [], LINUX_HOST);
    const path = checkNamed(report, "PATH");

    expect(path.status).toBe("warn");
    expect(path.message).toBe("未包含任何常见 CLI 安装目录");
    expect(path.details?.join("\n")).toContain("/home/tester/.local/bin");
    expect(path.details?.join("\n")).toContain("重新打开终端");
  });

  test("a PATH that already covers an install directory is fine", () => {
    const report = buildDoctorReport(defaultConfig(), [], {
      ...LINUX_HOST,
      env: { PATH: "/usr/bin:/home/tester/.local/bin" },
    });

    expect(checkNamed(report, "PATH")).toMatchObject({ status: "ok" });
  });
});

describe("per-CLI states", () => {
  test("installed, versioned and reachable from this shell", () => {
    const report = buildDoctorReport(
      defaultConfig(),
      [
        detectedCli({
          id: "codex",
          available: true,
          path: "/home/tester/.local/bin/codex",
          version: "codex-cli 0.139.0",
          source: "installer",
        }),
      ],
      { ...LINUX_HOST, env: { PATH: "/home/tester/.local/bin" } },
    );

    expect(checkNamed(report, "cli codex")).toMatchObject({
      status: "ok",
      message: "codex-cli 0.139.0 · /home/tester/.local/bin/codex · installer",
    });
  });

  test("installed but outside PATH warns instead of passing", () => {
    const report = buildDoctorReport(
      defaultConfig(),
      [
        detectedCli({
          id: "codex",
          available: true,
          path: "/home/tester/.local/bin/codex",
          version: "codex-cli 0.139.0",
          source: "installer",
        }),
      ],
      LINUX_HOST,
    );

    const check = checkNamed(report, "cli codex");
    expect(check.status).toBe("warn");
    expect(check.message).toContain("已安装但不在当前 PATH");
    expect(check.details?.join("\n")).toContain(
      "把 /home/tester/.local/bin 加入 PATH 并重新打开终端",
    );
  });

  test("candidates that all failed to launch carry the official install commands", () => {
    const report = buildDoctorReport(
      defaultConfig(),
      [
        detectedCli({
          id: "pi",
          candidates: [
            {
              path: "/home/tester/.bun/bin/pi",
              runtime: "local",
              source: "bun",
              version: null,
            },
          ],
        }),
      ],
      LINUX_HOST,
    );

    const check = checkNamed(report, "cli pi");
    expect(check.status).toBe("warn");
    expect(check.message).toBe("发现 1 个候选，但都不可启动");
    const details = check.details?.join("\n") ?? "";
    expect(details).toContain("/home/tester/.bun/bin/pi (bun)");
    expect(details).toContain("npm install -g --ignore-scripts");
    expect(details).toContain("coderelay 不会代跑");
  });

  test("a discovered CLI whose version probe failed is flagged, not accepted", () => {
    const report = buildDoctorReport(
      defaultConfig(),
      [
        detectedCli({
          id: "codex",
          available: true,
          path: "/home/tester/.local/bin/codex",
          version: null,
          source: "installer",
        }),
      ],
      { ...LINUX_HOST, env: { PATH: "/home/tester/.local/bin" } },
    );

    const check = checkNamed(report, "cli codex");
    expect(check.status).toBe("warn");
    expect(check.message).toContain("可发现但版本探测失败");
  });

  test("an unresolved configured command is an error, not a warning", () => {
    const config = defaultConfig();
    config.agents["claude"] = {
      enabled: true,
      activationDecided: true,
      command: "/opt/missing/claude",
      models: [],
      extraArgs: [],
      env: {},
    };

    const report = buildDoctorReport(config, [], {
      ...LINUX_HOST,
      resolve: () => null,
    });

    const check = checkNamed(report, "cli claude");
    expect(check.status).toBe("error");
    expect(check.message).toContain("配置的 command 不存在");
    expect(check.details?.join("\n")).toContain("agents.claude.command");
  });

  test("a resolved configured command is accepted verbatim", () => {
    const config = defaultConfig();
    config.agents["claude"] = {
      enabled: true,
      activationDecided: true,
      command: "claude-custom",
      models: [],
      extraArgs: [],
      env: {},
    };

    const report = buildDoctorReport(config, [], {
      ...LINUX_HOST,
      resolve: () => "/opt/claude-custom",
    });

    expect(checkNamed(report, "cli claude")).toMatchObject({
      status: "ok",
      message: "config 指定 · /opt/claude-custom",
    });
  });

  test("a missing required CLI errors while a missing optional one only warns", () => {
    const report = buildDoctorReport(defaultConfig(), [], LINUX_HOST);

    expect(checkNamed(report, "cli codex")).toMatchObject({
      status: "error",
      message: "未安装（当前配置需要它）",
    });
    expect(checkNamed(report, "cli pi")).toMatchObject({
      status: "warn",
      message: "未安装（可选）",
    });
    expect(report.ok).toBe(false);
  });
});

describe("install guidance", () => {
  test("Windows guidance names the official entry points", () => {
    const report = buildDoctorReport(defaultConfig(), [], {
      platform: "win32",
      homeDir: "C:\\Users\\tester",
      env: { PATH: "C:\\Windows" },
    });

    const details = checkNamed(report, "cli claude").details?.join("\n") ?? "";
    expect(details).toContain("irm https://claude.ai/install.ps1 | iex");
    expect(details).toContain("winget install Anthropic.ClaudeCode");
    expect(details).toContain("https://claude.com/claude-code");
  });

  test("macOS guidance offers the installer and Homebrew", () => {
    const report = buildDoctorReport(defaultConfig(), [], {
      platform: "darwin",
      homeDir: "/Users/tester",
      env: { PATH: "/usr/bin" },
    });

    const details = checkNamed(report, "cli omp").details?.join("\n") ?? "";
    expect(details).toContain("brew install can1357/tap/omp");
    expect(details).toContain("https://omp.sh/install");
  });

  test("an installed CLI is not told how to install itself", () => {
    const report = buildDoctorReport(
      defaultConfig(),
      [
        detectedCli({
          id: "codex",
          available: true,
          path: "/home/tester/.local/bin/codex",
          version: "0.139.0",
        }),
      ],
      { ...LINUX_HOST, env: { PATH: "/home/tester/.local/bin" } },
    );

    expect(checkNamed(report, "cli codex").details).toBeUndefined();
  });
});

describe("formatDoctorReport", () => {
  test("pads the status and indents the details", () => {
    const report = buildDoctorReport(defaultConfig(), [], LINUX_HOST);
    const lines = formatDoctorReport(report).split("\n");

    expect(lines[0]).toStartWith("warn  config:");
    expect(lines.some((line) => line.startsWith("ok    environment:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("warn  PATH:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("      "))).toBe(true);
  });
});
