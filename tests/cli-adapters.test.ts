import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  CLI_IDS,
  createCliAdapters,
  getCliAdapter,
  getCliAdapters,
} from "../src/agents/cli-adapters";

describe("CLI adapters", () => {
  test("registry preserves the canonical CLI order", () => {
    expect(Object.keys(getCliAdapters())).toEqual([...CLI_IDS]);
  });

  test("uses the documented config directories", () => {
    const adapters = createCliAdapters({
      homeDir: "/home/tester",
      env: {},
    });

    expect(adapters.codex.configDir).toBe("/home/tester/.codex");
    expect(adapters.claude.configDir).toBe("/home/tester/.claude");
    expect(adapters.pi.configDir).toBe("/home/tester/.pi/agent");
    expect(adapters.omp.configDir).toBe("/home/tester/.omp");
  });

  test("honors CLAUDE_CONFIG_DIR", () => {
    const adapter = getCliAdapter("claude", {
      homeDir: "/home/tester",
      env: { CLAUDE_CONFIG_DIR: "/custom/claude" },
    });

    expect(adapter.configDir).toBe("/custom/claude");
  });

  test("honors native config directory environment variables", () => {
    const adapters = createCliAdapters({
      homeDir: "/home/tester",
      env: {},
      agentEnvs: {
        codex: { CODEX_HOME: "/custom/codex" },
        pi: { PI_CODING_AGENT_DIR: "/custom/pi-agent" },
        omp: { PI_CONFIG_DIR: "/custom/omp" },
      },
    });

    expect(adapters.codex.configDir).toBe("/custom/codex");
    expect(adapters.pi.configDir).toBe("/custom/pi-agent");
    expect(adapters.omp.configDir).toBe("/custom/omp");
  });

  test("PI_CODING_AGENT_DIR takes precedence for OMP agent files", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-omp-env-test-"));
    try {
      const agentDir = join(tempDir, "custom-agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "config.yml"),
        "modelRoles:\n  default: custom/from-agent-dir\n",
      );

      const adapters = createCliAdapters({
        homeDir: tempDir,
        env: {},
        agentEnvs: {
          omp: {
            PI_CONFIG_DIR: join(tempDir, "wrong-root"),
            PI_CODING_AGENT_DIR: agentDir,
          },
        },
      });
      const result = await adapters.omp.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models).toEqual([
          { id: "custom/from-agent-dir", isDefault: true },
        ]);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("builds prompt arguments for all four CLIs", () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });

    expect(adapters.codex.promptArgs("hello")).toEqual(["exec", "hello"]);
    expect(adapters.claude.promptArgs("hello")).toEqual(["-p", "hello"]);
    expect(adapters.pi.promptArgs("hello")).toEqual(["-p", "hello"]);
    expect(adapters.omp.promptArgs("hello")).toEqual(["-p", "hello"]);
  });

  test("pi buildPromptArgs resumes with the specific native session", () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });

    const withResume = adapters.pi.buildPromptArgs?.({
      prompt: "continue work",
      nativeSessionId: "session-xyz-123",
    });
    expect(withResume).toEqual(["-p", "--session", "session-xyz-123", "continue work"]);
  });

  test("codex buildPromptArgs resumes with nativeSessionId without --last", () => {
    const adapters = createCliAdapters({ homeDir: "/home/tester", env: {} });

    const withoutResume = adapters.codex.buildPromptArgs?.({
      prompt: "do work",
    });
    expect(withoutResume).toEqual(["exec", "do work"]);

    const withResume = adapters.codex.buildPromptArgs?.({
      prompt: "continue work",
      nativeSessionId: "session-xyz-123",
    });
    expect(withResume).toEqual(["exec", "resume", "session-xyz-123", "continue work"]);
    expect(withResume).not.toContain("--last");
  });
});

describe("Codex model probing", () => {
  test("probes models from native models_cache.json and marks default from config.toml", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-codex-test-"));
    try {
      const codexDir = join(tempDir, ".codex");
      await mkdir(codexDir, { recursive: true });

      const modelsCache = {
        models: [
          { slug: "gpt-5.6-sol", display_name: "GPT 5.6" },
          { slug: "gpt-5.5", display_name: "GPT 5.5" },
        ],
      };
      await writeFile(join(codexDir, "models_cache.json"), JSON.stringify(modelsCache));
      await writeFile(join(codexDir, "config.toml"), 'model = "gpt-5.6-sol"\n');

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.codex.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models.length).toBe(2);
        expect(result.models[0]?.id).toBe("gpt-5.6-sol");
        expect(result.models[0]?.isDefault).toBe(true);
        expect(result.models[1]?.id).toBe("gpt-5.5");
        expect(result.models[1]?.isDefault).toBe(false);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("probes models from custom model_catalog_json specified in config.toml", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-codex-test-"));
    try {
      const codexDir = join(tempDir, ".codex");
      await mkdir(codexDir, { recursive: true });

      const customCatalog = {
        models: [{ slug: "custom-model", display_name: "Custom Model" }],
      };
      await writeFile(join(codexDir, "my-catalog.json"), JSON.stringify(customCatalog));
      await writeFile(join(codexDir, "config.toml"), 'model_catalog_json = "my-catalog.json"\n');

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.codex.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models[0]?.id).toBe("custom-model");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to model in config.toml when no catalog file exists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-codex-test-"));
    try {
      const codexDir = join(tempDir, ".codex");
      await mkdir(codexDir, { recursive: true });
      await writeFile(join(codexDir, "config.toml"), 'model = "o3-mini"\n');

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.codex.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models).toEqual([{ id: "o3-mini", isDefault: true }]);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns error when neither catalog nor model in config.toml is found", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-codex-test-"));
    try {
      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.codex.probeModels?.();

      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.reason).toContain("models_cache.json");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("Pi model probing", () => {
  test("probes provider-scoped models from models.json without dropping provider identity", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-pi-test-"));
    try {
      const piDir = join(tempDir, ".pi", "agent");
      await mkdir(piDir, { recursive: true });

      const modelsJson = {
        providers: {
          openai: {
            models: [{ id: "gpt-4o", name: "GPT-4o" }],
          },
          proxy: {
            models: [{ id: "gpt-4o", name: "Proxy GPT-4o" }],
          },
        },
      };
      await writeFile(join(piDir, "models.json"), JSON.stringify(modelsJson));

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.pi.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models.length).toBe(2);
        expect(result.models[0]).toEqual({ id: "openai/gpt-4o", label: "GPT-4o" });
        expect(result.models[1]).toEqual({ id: "proxy/gpt-4o", label: "Proxy GPT-4o" });
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("does not double-prefix if model id already has provider prefix", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-pi-test-"));
    try {
      const piDir = join(tempDir, ".pi", "agent");
      await mkdir(piDir, { recursive: true });

      const modelsJson = {
        providers: {
          anthropic: {
            models: [{ id: "anthropic/claude-3-5-sonnet" }],
          },
        },
      };
      await writeFile(join(piDir, "models.json"), JSON.stringify(modelsJson));

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.pi.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models[0]?.id).toBe("anthropic/claude-3-5-sonnet");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to Pi native default when models.json is missing", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-pi-test-"));
    try {
      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.pi.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models).toEqual([
          { id: "", label: "Pi 默认模型", isDefault: true },
        ]);
      }
      expect(
        adapters.pi.buildPromptArgs?.({ prompt: "hello", model: "" }),
      ).toEqual(["-p", "hello"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("returns error when models list is empty", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-pi-test-"));
    try {
      const piDir = join(tempDir, ".pi", "agent");
      await mkdir(piDir, { recursive: true });
      await writeFile(
        join(piDir, "models.json"),
        JSON.stringify({ providers: { openai: { models: [] } } }),
      );

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.pi.probeModels?.();

      expect(result?.ok).toBe(false);
      if (result && !result.ok) {
        expect(result.reason).toContain("pi 模型列表为空");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("OMP model probing", () => {
  test("reads model roles and explicit provider models without scanning unrelated YAML lists", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-omp-test-"));
    try {
      const agentDir = join(tempDir, ".omp", "agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "config.yml"),
        [
          "modelRoles:",
          "  default: anthropic/claude-sonnet-4-5",
          "  plan: custom/planner:high",
          "cycleOrder:",
          "  - unrelated/provider",
          "enabledModels:",
          "  - another/provider",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(agentDir, "models.yml"),
        [
          "providers:",
          "  custom:",
          "    models:",
          "      - id: local-fast",
          "        name: Local Fast",
          "",
        ].join("\n"),
      );

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.omp.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models).toEqual([
          { id: "anthropic/claude-sonnet-4-5", isDefault: true },
          { id: "custom/planner:high" },
          { id: "custom/local-fast", label: "Local Fast" },
        ]);
        expect(result.models.some((model) => model.id === "unrelated/provider")).toBe(false);
        expect(result.models.some((model) => model.id === "another/provider")).toBe(false);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("uses configured provider models when modelRoles is absent", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-omp-test-"));
    try {
      const agentDir = join(tempDir, ".omp", "agent");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, "models.yaml"),
        [
          "providers:",
          "  local:",
          "    models:",
          "      - id: only-model",
          "        name: Only Model",
          "",
        ].join("\n"),
      );

      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.omp.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models).toEqual([
          { id: "local/only-model", label: "Only Model" },
        ]);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("falls back to the OMP native default when no local model catalog is present", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "coderelay-omp-test-"));
    try {
      const adapters = createCliAdapters({ homeDir: tempDir });
      const result = await adapters.omp.probeModels?.();

      expect(result?.ok).toBe(true);
      if (result?.ok) {
        expect(result.models).toEqual([
          { id: "", label: "OMP 默认模型", isDefault: true },
        ]);
      }
      expect(
        adapters.omp.buildPromptArgs?.({ prompt: "hello", model: "" }),
      ).toEqual(["-p", "--mode", "json", "hello"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
