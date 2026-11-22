import { describe, expect, test } from "bun:test";

import { buildAgentList, formatAgentList } from "../src/commands/agents";
import { defaultConfig } from "../src/config/schema";
import type { DetectedCli } from "../src/models/cli";

const ADAPTERS = { homeDir: "/home/tester", env: {} };

function detectedCli(overrides: Partial<DetectedCli> & { id: DetectedCli["id"] }): DetectedCli {
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

const DETECTED: readonly DetectedCli[] = [
  detectedCli({
    id: "codex",
    available: true,
    path: "/Users/me/.local/bin/codex",
    version: "0.154.0",
    source: "installer",
  }),
  detectedCli({
    id: "claude",
    available: true,
    path: "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd",
    version: "2.0.1",
    source: "npm",
  }),
  detectedCli({
    id: "pi",
    available: true,
    path: "/home/me/.local/bin/pi",
    version: "0.73.1",
    runtime: "local",
    source: "path",
  }),
  detectedCli({
    id: "omp",
    diagnostics: [
      {
        level: "info",
        message: "未发现 omp。已检查 PATH 与常见安装目录：/Users/me/.local/bin, /Users/me/.bun/bin",
      },
    ],
  }),
];

function entryFor(entries: ReturnType<typeof buildAgentList>, id: string) {
  const entry = entries.find((item) => item.id === id);
  if (!entry) {
    throw new Error(`no entry for ${id}`);
  }
  return entry;
}

describe("buildAgentList", () => {
  test("carries the runtime, source and candidates of every CLI", () => {
    const entries = buildAgentList(defaultConfig(), DETECTED, ADAPTERS);

    expect(entryFor(entries, "codex")).toMatchObject({
      runtime: "local",
      source: "installer",
      available: true,
      path: "/Users/me/.local/bin/codex",
    });
    expect(entryFor(entries, "pi")).toMatchObject({
      runtime: "local",
      source: "path",
    });
  });

  test("keeps canonical CLI order and reports disabled agents", () => {
    const config = defaultConfig();
    config.agents["pi"] = {
      enabled: false,
      activationDecided: true,
      models: [],
      extraArgs: [],
      env: {},
    };
    const entries = buildAgentList(config, DETECTED, ADAPTERS);

    expect(entries.map((entry) => entry.id)).toEqual(["codex", "claude", "pi", "omp"]);
    expect(entryFor(entries, "pi").enabled).toBe(false);
  });

  test("a configured command overrides the scanned path", () => {
    const config = defaultConfig();
    config.agents["codex"] = {
      enabled: true,
      activationDecided: true,
      command: "/opt/custom/codex",
      models: [],
      extraArgs: [],
      env: {},
    };

    expect(entryFor(buildAgentList(config, DETECTED, ADAPTERS), "codex")).toMatchObject({
      command: "/opt/custom/codex",
    });
  });

  test("survives a CLI the scan never returned", () => {
    const entries = buildAgentList(defaultConfig(), [], ADAPTERS);

    expect(entryFor(entries, "codex")).toMatchObject({
      available: false,
      path: "",
      version: null,
      runtime: "local",
      source: "path",
      candidates: [],
    });
  });
});

describe("formatAgentList", () => {
  test("shows the runtime, the source and the scanned path", () => {
    const output = formatAgentList(buildAgentList(defaultConfig(), DETECTED, ADAPTERS), {
      platform: "darwin",
    });

    expect(output).toContain("Codex (codex) [enabled default]");
    expect(output).toContain("  status: 0.154.0");
    expect(output).toContain("  runtime: local (installer)");
    expect(output).toContain("  path: /Users/me/.local/bin/codex");
    expect(output).toContain("  runtime: local (path)");
  });

  test("lists the alternatives only when more than one was found", () => {
    const twoCandidates = buildAgentList(
      defaultConfig(),
      [
        detectedCli({
          id: "codex",
          available: true,
          path: "/opt/bin/codex",
          version: "0.154.0",
          candidates: [
            { path: "/opt/bin/codex", runtime: "local", source: "path", version: "0.154.0" },
            {
              path: "/usr/local/bin/codex",
              runtime: "local",
              source: "npm",
              version: "0.150.0",
            },
          ],
        }),
      ],
      ADAPTERS,
    );

    const output = formatAgentList(twoCandidates, { platform: "linux" });
    expect(output).toContain("  candidates: /opt/bin/codex (path), /usr/local/bin/codex (npm)");
  });

  test("a single candidate is not repeated as an alternative list", () => {
    const output = formatAgentList(buildAgentList(defaultConfig(), DETECTED, ADAPTERS), {
      platform: "darwin",
    });

    expect(output).not.toContain("  candidates:");
  });

  test("an unavailable CLI gets copy-ready install commands and its diagnostics", () => {
    const output = formatAgentList(buildAgentList(defaultConfig(), DETECTED, ADAPTERS), {
      platform: "darwin",
    });

    expect(output).toContain("  info: 未发现 omp");
    expect(output).toContain("  install:");
    expect(output).toContain("brew install can1357/tap/omp");
    expect(output).toContain("https://omp.sh");
  });

  test("an available CLI is not told how to install itself", () => {
    const entries = buildAgentList(defaultConfig(), DETECTED, ADAPTERS).filter(
      (entry) => entry.id === "codex",
    );

    expect(formatAgentList(entries, { platform: "darwin" })).not.toContain("install:");
  });

  test("Windows guidance names the PowerShell and winget entry points", () => {
    const entries = buildAgentList(defaultConfig(), DETECTED, ADAPTERS).filter(
      (entry) => entry.id === "omp",
    );

    const output = formatAgentList(entries, { platform: "win32" });
    expect(output).toContain("irm https://omp.sh/install.ps1 | iex");
  });

  test("every CLI is separated by a blank line", () => {
    const output = formatAgentList(buildAgentList(defaultConfig(), DETECTED, ADAPTERS), {
      platform: "darwin",
    });

    expect(output.split("\n\n")).toHaveLength(4);
  });
});
