import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CONFIG_DIR,
  CONFIG_FILE_NAMES,
  ConfigError,
  defaultConfigPath,
  findConfigPath,
  globalConfigDir,
  loadConfig,
  resolveConfigPath,
  saveActivationDecisions,
} from "../src/config/loader";
import { ConfigSchema } from "../src/config/schema";
import { toActivationOptions, pendingActivation } from "../src/config/activation";
import { CLI_IDS, type DetectedCli } from "../src/models/cli";

const DETECTED: DetectedCli[] = [
  { id: "codex", bin: "codex", path: "/bin/codex", version: "1", available: true },
  { id: "claude", bin: "claude", path: "/bin/claude", version: "1", available: true },
  { id: "pi", bin: "pi", path: "/bin/pi", version: "1", available: true },
  { id: "omp", bin: "omp", path: "", version: null, available: false },
];

/** Every test gets its own cwd and isolated global home so nothing lands in the repository or uses user config. */
async function withTempDir<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "coderelay-activation-"));
  const isolatedHome = await mkdtemp(join(tmpdir(), "coderelay-isolated-home-"));
  const prevHome = process.env.CODERELAY_HOME;
  process.env.CODERELAY_HOME = isolatedHome;
  try {
    return await run(cwd);
  } finally {
    if (prevHome === undefined) {
      delete process.env.CODERELAY_HOME;
    } else {
      process.env.CODERELAY_HOME = prevHome;
    }
    await rm(isolatedHome, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

async function readYaml(cwd: string): Promise<string> {
  return readFile(join(cwd, CONFIG_FILE_NAMES[0]), "utf8");
}

/** Seed a config file the way a user would have it on disk (parent dir first). */
async function writeConfig(cwd: string, text: string): Promise<void> {
  const path = join(cwd, CONFIG_FILE_NAMES[0]);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

describe("first-run detection", () => {
  test("with no config file, installed CLIs are undecided and need confirming", async () => {
    await withTempDir(async (cwd) => {
      const loaded = await loadConfig({ cwd });
      expect(loaded.path).toBeNull();
      const options = toActivationOptions(DETECTED, loaded.config);
      expect(pendingActivation(options).map((item) => item.cliId)).toEqual([
        "codex",
        "claude",
        "pi",
      ]);
    });
  });

  test("a CLI persisted as disabled is not asked about again", async () => {
    await withTempDir(async (cwd) => {
      await saveActivationDecisions([{ cliId: "pi", enabled: false }], { cwd });
      const loaded = await loadConfig({ cwd });
      const options = toActivationOptions(DETECTED, loaded.config);
      expect(pendingActivation(options).map((item) => item.cliId)).toEqual([
        "codex",
        "claude",
      ]);
    });
  });

  test("an enabled, decided CLI is not asked about again", async () => {
    await withTempDir(async (cwd) => {
      await saveActivationDecisions([{ cliId: "codex", enabled: true }], { cwd });
      const loaded = await loadConfig({ cwd });
      const options = toActivationOptions(DETECTED, loaded.config);
      expect(pendingActivation(options).map((item) => item.cliId)).toEqual([
        "claude",
        "pi",
      ]);
    });
  });

  test("individually deactivated CLIs stay disabled across a reload", async () => {
    await withTempDir(async (cwd) => {
      await saveActivationDecisions(
        [
          { cliId: "codex", enabled: true },
          { cliId: "claude", enabled: false },
          { cliId: "pi", enabled: false },
        ],
        { cwd },
      );
      const loaded = await loadConfig({ cwd });
      expect(loaded.config.agents["codex"]?.enabled).toBe(true);
      expect(loaded.config.agents["claude"]?.enabled).toBe(false);
      expect(loaded.config.agents["pi"]?.enabled).toBe(false);
      expect(loaded.config.agents["claude"]?.activationDecided).toBe(true);
    });
  });
});

describe("saveActivationDecisions", () => {
  test("creates .coderelay/config.yaml when the file does not exist", async () => {
    await withTempDir(async (cwd) => {
      const path = await saveActivationDecisions(
        [{ cliId: "codex", enabled: true }],
        { cwd },
      );
      expect(path).toBe(join(cwd, CONFIG_DIR, "config.yaml"));
      expect(path).toBe(defaultConfigPath(cwd));
      expect(await readYaml(cwd)).toContain("enabled: true");
    });
  });

  test("round-trips enabled and activationDecided through the schema", async () => {
    await withTempDir(async (cwd) => {
      await saveActivationDecisions(
        [
          { cliId: "codex", enabled: true },
          { cliId: "claude", enabled: false },
        ],
        { cwd },
      );
      const loaded = await loadConfig({ cwd });
      expect(loaded.config.agents["codex"]?.enabled).toBe(true);
      expect(loaded.config.agents["codex"]?.activationDecided).toBe(true);
      expect(loaded.config.agents["claude"]?.enabled).toBe(false);
      expect(loaded.config.agents["claude"]?.activationDecided).toBe(true);
    });
  });

  test("re-enabling a disabled CLI only touches that CLI", async () => {
    await withTempDir(async (cwd) => {
      await saveActivationDecisions(
        [
          { cliId: "codex", enabled: true },
          { cliId: "claude", enabled: false },
          { cliId: "pi", enabled: false },
        ],
        { cwd },
      );
      const before = await readYaml(cwd);
      await saveActivationDecisions([{ cliId: "pi", enabled: true }], { cwd });
      const after = await loadConfig({ cwd });
      expect(after.config.agents["pi"]?.enabled).toBe(true);
      // 其他 CLI 的既有决定必须原样保留。
      expect(after.config.agents["codex"]?.enabled).toBe(true);
      expect(after.config.agents["claude"]?.enabled).toBe(false);
      expect(before).toContain("claude:");
    });
  });

  test("saving with every CLI disabled is allowed and persists", async () => {
    await withTempDir(async (cwd) => {
      await saveActivationDecisions(
        CLI_IDS.map((cliId) => ({ cliId, enabled: false })),
        { cwd },
      );
      const loaded = await loadConfig({ cwd });
      for (const cliId of CLI_IDS) {
        expect(loaded.config.agents[cliId]?.enabled).toBe(false);
      }
    });
  });

  test("preserves models, routing, commands, env and unknown keys", async () => {
    await withTempDir(async (cwd) => {
      const seeded = [
        "version: 1",
        "agents:",
        "  codex:",
        "    enabled: true",
        "    activationDecided: true",
        "    extraArgs:",
        "      - --profile",
        "    env:",
        "      OPENAI_API_KEY: sk-test",
        "    models:",
        "      - id: gpt-5-mini",
        "        label: Mini!",
        "routing:",
        "  rules:",
        "    - name: 快问快答",
        "      use:",
        "        agent: codex",
        "futureSection:",
        "  keepMe: true",
        "",
      ].join("\n");
      await writeConfig(cwd, seeded);

      await saveActivationDecisions([{ cliId: "claude", enabled: false }], { cwd });
      const text = await readYaml(cwd);
      const loaded = await loadConfig({ cwd });

      expect(loaded.config.agents["codex"]?.models.map((model) => model.id)).toEqual([
        "gpt-5-mini",
      ]);
      expect(loaded.config.agents["codex"]?.extraArgs).toEqual(["--profile"]);
      expect(loaded.config.agents["codex"]?.env["OPENAI_API_KEY"]).toBe("sk-test");
      expect(loaded.config.routing.rules).toHaveLength(1);
      expect(loaded.config.routing.rules[0]?.name).toBe("快问快答");
      expect(text).toContain("futureSection:");
      expect(text).toContain("keepMe: true");
      // 只有目标 CLI 被写入，其余 agents 条目的内容原样。
      expect(text).toContain("--profile");
    });
  });

  test("an explicit path wins over the cwd default", async () => {
    await withTempDir(async (cwd) => {
      const explicit = join(cwd, "custom.yaml");
      await saveActivationDecisions([{ cliId: "codex", enabled: false }], {
        path: explicit,
      });
      expect(await readFile(explicit, "utf8")).toContain("enabled: false");
      expect(await Bun.file(join(cwd, CONFIG_FILE_NAMES[0])).exists()).toBe(false);
    });
  });

  test("rejects a config file that is not a mapping", async () => {
    await withTempDir(async (cwd) => {
      await writeConfig(cwd, "- just\n- a list\n");
      expect(
        saveActivationDecisions([{ cliId: "codex", enabled: true }], { cwd }),
      ).rejects.toBeInstanceOf(ConfigError);
    });
  });

  test("reports unparseable YAML instead of clobbering the file", async () => {
    await withTempDir(async (cwd) => {
      const broken = "agents:\n  codex: [unclosed\n";
      await writeConfig(cwd, broken);
      expect(
        saveActivationDecisions([{ cliId: "codex", enabled: true }], { cwd }),
      ).rejects.toBeInstanceOf(ConfigError);
      expect(await readYaml(cwd)).toBe(broken);
    });
  });

  test("resolves default config path to global .coderelay directory", () => {
    expect(defaultConfigPath()).toBe(join(homedir(), ".coderelay", "config.yaml"));

    const customHome = "/tmp/mock-home";
    expect(defaultConfigPath(customHome)).toBe(join(customHome, ".coderelay", "config.yaml"));
  });

  test("saves activation decisions to global .coderelay by default", async () => {
    await withTempDir(async (mockHome) => {
      const savedPath = await saveActivationDecisions(
        [{ cliId: "claude", enabled: true }],
        { homeDir: mockHome },
      );
      expect(savedPath).toBe(join(mockHome, ".coderelay", "config.yaml"));
      const content = await readFile(savedPath, "utf8");
      expect(content).toContain("claude:");
      expect(content).toContain("enabled: true");
    });
  });

  test("loadConfig falls back to global .coderelay when workspace has no config", async () => {
    await withTempDir(async (mockHome) => {
      await withTempDir(async (workspaceCwd) => {
        // Seed config in global directory only
        const globalPath = join(mockHome, ".coderelay", "config.yaml");
        await mkdir(dirname(globalPath), { recursive: true });
        await writeFile(globalPath, "agents:\n  pi:\n    enabled: false\n", "utf8");

        const loaded = await loadConfig({ cwd: workspaceCwd, homeDir: mockHome });
        expect(loaded.path).toBe(globalPath);
        expect(loaded.config.agents["pi"]?.enabled).toBe(false);
      });
    });
  });

  test("loadConfig falls back to global .coderelay by default without homeDir", async () => {
    await withTempDir(async (workspaceCwd) => {
      const mockHome = await mkdtemp(join(tmpdir(), "coderelay-global-"));
      try {
        const globalPath = join(mockHome, ".coderelay", "config.yaml");
        await mkdir(dirname(globalPath), { recursive: true });
        await writeFile(globalPath, "agents:\n  pi:\n    enabled: false\n", "utf8");

        const loaded = await loadConfig({
          cwd: workspaceCwd,
          env: { CODERELAY_HOME: mockHome },
        });
        expect(loaded.path).toBe(globalPath);
        expect(loaded.config.agents["pi"]?.enabled).toBe(false);

        const resolved = await resolveConfigPath(workspaceCwd, undefined, {
          CODERELAY_HOME: mockHome,
        });
        expect(resolved).toBe(globalPath);
      } finally {
        await rm(mockHome, { recursive: true, force: true });
      }
    });
  });

  test("loadConfig discovers global config via HOME without explicit homeDir", async () => {
    await withTempDir(async (workspaceCwd) => {
      const mockHome = await mkdtemp(join(tmpdir(), "coderelay-home-"));
      try {
        const globalPath = join(mockHome, ".coderelay", "config.yaml");
        await mkdir(dirname(globalPath), { recursive: true });
        await writeFile(globalPath, "defaultAgent: pi\n", "utf8");

        const loaded = await loadConfig({
          cwd: workspaceCwd,
          env: { HOME: mockHome },
          platform: "darwin",
        });
        expect(loaded.path).toBe(globalPath);
        expect(loaded.config.defaultAgent).toBe("pi");
      } finally {
        await rm(mockHome, { recursive: true, force: true });
      }
    });
  });

  test("adapts storage location to Windows paths and environment", () => {
    // Windows path directly passed
    expect(defaultConfigPath("C:\\Users\\tester")).toBe("C:\\Users\\tester\\.coderelay\\config.yaml");
    expect(globalConfigDir("C:\\Users\\tester")).toBe("C:\\Users\\tester\\.coderelay");

    // Windows resolved via USERPROFILE
    expect(
      defaultConfigPath(undefined, { USERPROFILE: "C:\\Users\\winuser" }, "win32"),
    ).toBe("C:\\Users\\winuser\\.coderelay\\config.yaml");

    // Windows resolved via HOMEDRIVE + HOMEPATH
    expect(
      defaultConfigPath(undefined, { HOMEDRIVE: "D:", HOMEPATH: "\\Users\\winuser" }, "win32"),
    ).toBe("D:\\Users\\winuser\\.coderelay\\config.yaml");
  });

  test("adapts storage location to Linux environments", () => {
    expect(
      defaultConfigPath(undefined, { HOME: "/home/linuxuser" }, "linux"),
    ).toBe("/home/linuxuser/.coderelay/config.yaml");
  });

  test("supports CODERELAY_HOME override across all platforms", () => {
    // Custom path without .coderelay suffix appends it
    expect(
      globalConfigDir(undefined, { CODERELAY_HOME: "/opt/custom_storage" }),
    ).toBe("/opt/custom_storage/.coderelay");

    // Custom path already having .coderelay suffix keeps it intact
    expect(
      globalConfigDir(undefined, { CODERELAY_HOME: "C:\\custom\\.coderelay" }),
    ).toBe("C:\\custom\\.coderelay");

    expect(
      defaultConfigPath(undefined, { CODERELAY_HOME: "C:\\custom\\.coderelay" }),
    ).toBe("C:\\custom\\.coderelay\\config.yaml");
  });

  test("ConfigSchema rejects duplicate model ids for an agent", () => {
    const result = ConfigSchema.safeParse({
      agents: {
        claude: {
          models: [
            { id: "opus", name: "Opus" },
            { id: "opus", name: "Opus Duplicate" },
          ],
        },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('duplicate model id "opus"'))).toBe(true);
    }
  });
});
