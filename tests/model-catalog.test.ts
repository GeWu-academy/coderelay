import { describe, expect, test } from "bun:test";

import { defaultConfig } from "../src/config/schema";
import type { CliCapabilities, ProbeResult } from "../src/agents/capabilities";
import {
  probeModelCatalog,
  toRouteCandidates,
  validateExplicitTarget,
  type ModelOption,
} from "../src/agents/model-catalog";
import { CLI_IDS, type CliAdapter, type CliId, type DetectedCli } from "../src/models/cli";
import { MODEL_STRENGTHS, type ModelStrength } from "../src/models/types";

const CAPS: CliCapabilities = {
  structuredEvents: true,
  nativeResume: true,
  nonInteractivePrompt: true,
  explicitModel: true,
  toolEvents: true,
};

function baseAdapter(id: CliId): CliAdapter {
  return {
    id,
    bin: id,
    configDir: `/home/tester/.${id}`,
    versionArgs: [["--version"]],
    interactiveArgs: [],
    promptArgs: (prompt: string) => ["-p", prompt],
  };
}

function fakeAdapters(probes: Record<CliId, ProbeResult | "unsupported">): Record<CliId, CliAdapter> {
  const out = {} as Record<CliId, CliAdapter>;
  for (const id of CLI_IDS) {
    const probe = probes[id];
    const adapter = baseAdapter(id);
    out[id] =
      probe === "unsupported"
        ? adapter
        : { ...adapter, probeModels: async (): Promise<ProbeResult> => probe };
  }
  return out;
}

const DETECTED: DetectedCli[] = [
  { id: "codex", bin: "codex", path: "/bin/codex", version: "1", available: true },
  { id: "claude", bin: "claude", path: "/bin/claude", version: "1", available: true },
  { id: "pi", bin: "pi", path: "", version: null, available: false },
  { id: "omp", bin: "omp", path: "/bin/omp", version: "1", available: true },
];

/** A probed model option, for catalogs built by hand rather than by probing. */
function modelOption(cliId: CliId, modelId: string): ModelOption {
  return {
    cliId,
    modelId,
    label: modelId,
    isDefault: false,
    capabilities: CAPS,
    strengths: [],
    available: true,
  };
}

describe("probeModelCatalog", () => {
  test("returns a unified catalog; failures carry reasons and no candidates", async () => {
    const config = defaultConfig();
    config.agents["omp"] = { enabled: false, activationDecided: true, models: [], extraArgs: [], env: {} };
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }, { id: "gpt-5-mini" }], capabilities: CAPS },
      claude: { ok: false, reason: "auth missing" },
      pi: { ok: true, models: [], capabilities: CAPS },
      omp: { ok: true, models: [{ id: "m" }], capabilities: CAPS },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    expect(catalog.probes).toHaveLength(4);
    expect(catalog.probes.find((p) => p.cliId === "codex")?.status).toBe("found");
    expect(catalog.probes.find((p) => p.cliId === "claude")?.status).toBe("unprobed");
    expect(catalog.probes.find((p) => p.cliId === "claude")?.reason).toBe("auth missing");
    expect(catalog.probes.find((p) => p.cliId === "pi")?.status).toBe("not-installed");
    expect(catalog.probes.find((p) => p.cliId === "omp")?.status).toBe("disabled");
    expect(catalog.options.map((o) => o.modelId)).toEqual(["gpt-5", "gpt-5-mini"]);
  });

  test("keeps native defaults separate from the CodeRelay global default", async () => {
    const config = defaultConfig();
    const adapters = fakeAdapters({
      codex: {
        ok: true,
        models: [{ id: "codex-native", isDefault: true }],
        capabilities: CAPS,
      },
      claude: {
        ok: true,
        models: [{ id: "claude-native", isDefault: true }],
        capabilities: CAPS,
      },
      pi: { ok: false, reason: "x" },
      omp: { ok: false, reason: "x" },
    });

    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    const codex = catalog.options.find((option) => option.modelId === "codex-native");
    const claude = catalog.options.find((option) => option.modelId === "claude-native");
    expect(codex?.isDefault).toBe(false);
    expect(codex?.isNativeDefault).toBe(true);
    expect(claude?.isDefault).toBe(false);
    expect(claude?.isNativeDefault).toBe(true);
    expect(toRouteCandidates(catalog, config).every((candidate) => !candidate.isDefault)).toBe(true);
  });

  test("config overlays metadata and order but cannot invent models", async () => {
    const config = defaultConfig();
    config.agents["codex"] = {
      enabled: true,
      activationDecided: true,
      models: [
        { id: "gpt-5-mini", label: "Mini!", strengths: [], cost: 1, contextWindow: 64_000 },
        { id: "ghost-model", label: "Ghost", strengths: [], cost: 1 },
      ],
      extraArgs: [],
      env: {},
    };
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }, { id: "gpt-5-mini" }], capabilities: CAPS },
      claude: { ok: false, reason: "x" },
      pi: { ok: false, reason: "x" },
      omp: { ok: false, reason: "x" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    // ghost-model 不在探测结果中：不能被增补进来。
    expect(catalog.options.some((o) => o.modelId === "ghost-model")).toBe(false);
    // 真实模型的 label/cost 被覆盖，且按 config 数组顺序排在前面。
    expect(catalog.options.map((o) => o.modelId)).toEqual(["gpt-5-mini", "gpt-5"]);
    expect(catalog.options.find((o) => o.modelId === "gpt-5-mini")?.label).toBe("Mini!");
    expect(catalog.options.find((o) => o.modelId === "gpt-5-mini")?.cost).toBe(1);
    expect(catalog.options.find((o) => o.modelId === "gpt-5-mini")?.contextWindow).toBe(64_000);
    const candidate = toRouteCandidates(catalog, config).find((item) => item.model === "gpt-5-mini");
    expect(candidate?.contextWindow).toBe(64_000);
  });

  test("config strengths preserves all valid MODEL_STRENGTHS and filters invalid entries", async () => {
    const config = defaultConfig();
    config.agents["codex"] = {
      enabled: true,
      activationDecided: true,
      models: [
        {
          id: "gpt-5",
          label: "GPT-5",
          strengths: [
            ...MODEL_STRENGTHS,
            "invalid-strength",
            "code",
          ] as unknown as ModelStrength[],
          cost: 3,
        },
      ],
      extraArgs: [],
      env: {},
    };
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }], capabilities: CAPS },
      claude: { ok: false, reason: "x" },
      pi: { ok: false, reason: "x" },
      omp: { ok: false, reason: "x" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    const option = catalog.options.find((o) => o.modelId === "gpt-5");
    expect(option?.strengths).toEqual([...MODEL_STRENGTHS]);

    const candidates = toRouteCandidates(catalog, config);
    const candidate = candidates.find((c) => c.model === "gpt-5");
    expect(candidate?.strengths).toEqual([...MODEL_STRENGTHS]);
  });

  test("validateExplicitTarget rejects unprobed and unknown models with reasons", async () => {
    const config = defaultConfig();
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }], capabilities: CAPS },
      claude: { ok: false, reason: "auth missing" },
      pi: { ok: false, reason: "nope" },
      omp: { ok: false, reason: "nope" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    expect(() => validateExplicitTarget(catalog, "claude", undefined, "codex")).toThrow("auth missing");
    expect(() => validateExplicitTarget(catalog, "codex", "codex:nope", "codex")).toThrow("gpt-5");
    expect(validateExplicitTarget(catalog, "codex", "codex:gpt-5", "codex")).toEqual({
      cliId: "codex",
      modelId: "gpt-5",
    });
  });

  test("preserves colon-containing model ids when agent is explicit", async () => {
    const config = defaultConfig();
    const adapters = fakeAdapters({
      codex: { ok: false, reason: "down" },
      claude: { ok: false, reason: "down" },
      pi: { ok: false, reason: "down" },
      omp: { ok: true, models: [{ id: "ollama/qwen3:8b" }], capabilities: CAPS },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);

    expect(
      validateExplicitTarget(catalog, "omp", "ollama/qwen3:8b", "codex"),
    ).toEqual({ cliId: "omp", modelId: "ollama/qwen3:8b" });
  });

  test("toRouteCandidates only exposes available options", async () => {
    const config = defaultConfig();
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }], capabilities: CAPS },
      claude: { ok: false, reason: "down" },
      pi: { ok: false, reason: "down" },
      omp: { ok: false, reason: "down" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    const candidates = toRouteCandidates(catalog, config);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ agent: "codex", model: "gpt-5" });
  });

  test("a disabled CLI contributes no candidates even if its models probed fine", async () => {
    const config = defaultConfig();
    config.agents["codex"] = {
      enabled: false,
      activationDecided: true,
      models: [],
      extraArgs: [],
      env: {},
    };
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }], capabilities: CAPS },
      claude: { ok: true, models: [{ id: "claude-sonnet-4-5" }], capabilities: CAPS },
      pi: { ok: false, reason: "down" },
      omp: { ok: false, reason: "down" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    expect(catalog.probes.find((p) => p.cliId === "codex")?.status).toBe("disabled");
    const candidates = toRouteCandidates(catalog, config);
    expect(candidates.map((candidate) => candidate.agent)).toEqual(["claude"]);
  });

  test("available: false options are filtered out of routing", () => {
    // probeModelCatalog 只会产出 available 的模型；这里直接构造 catalog，
    // 锁住 toRouteCandidates 自己的过滤，避免以后把判断挪到别处时悄悄放开。
    const catalog = {
      probes: [],
      options: [
        { ...modelOption("codex", "gpt-5"), available: false },
        modelOption("codex", "gpt-5-mini"),
      ],
    };
    const candidates = toRouteCandidates(catalog, defaultConfig());
    expect(candidates.map((candidate) => candidate.model)).toEqual(["gpt-5-mini"]);
  });

  test("the same model name on two CLIs stays two distinct candidates", async () => {
    const config = defaultConfig();
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "shared" }], capabilities: CAPS },
      claude: { ok: true, models: [{ id: "shared" }], capabilities: CAPS },
      pi: { ok: false, reason: "down" },
      omp: { ok: false, reason: "down" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    expect(catalog.options).toHaveLength(2);
    expect(catalog.options.map((o) => `${o.cliId}:${o.modelId}`)).toEqual([
      "codex:shared",
      "claude:shared",
    ]);
    const candidates = toRouteCandidates(catalog, config);
    expect(candidates.map((candidate) => `${candidate.agent}:${candidate.model}`)).toEqual([
      "codex:shared",
      "claude:shared",
    ]);
  });

  test("validateExplicitTarget rejects a model that belongs to a different CLI", async () => {
    const config = defaultConfig();
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }], capabilities: CAPS },
      claude: { ok: true, models: [{ id: "claude-sonnet-4-5" }], capabilities: CAPS },
      pi: { ok: false, reason: "down" },
      omp: { ok: false, reason: "down" },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    // 模型确实存在，但不是 codex 的：不能借用别的 CLI 的同名/任意模型。
    expect(() =>
      validateExplicitTarget(catalog, "codex", "codex:claude-sonnet-4-5", "codex"),
    ).toThrow("模型不存在于 codex");
    expect(
      validateExplicitTarget(catalog, "claude", "claude:claude-sonnet-4-5", "codex"),
    ).toEqual({ cliId: "claude", modelId: "claude-sonnet-4-5" });
  });

  test("validateExplicitTarget refuses a disabled CLI", async () => {
    const config = defaultConfig();
    config.agents["omp"] = {
      enabled: false,
      activationDecided: true,
      models: [],
      extraArgs: [],
      env: {},
    };
    const adapters = fakeAdapters({
      codex: { ok: true, models: [{ id: "gpt-5" }], capabilities: CAPS },
      claude: { ok: false, reason: "down" },
      pi: { ok: false, reason: "down" },
      omp: { ok: true, models: [{ id: "m" }], capabilities: CAPS },
    });
    const catalog = await probeModelCatalog(DETECTED, adapters, config);
    expect(() => validateExplicitTarget(catalog, "omp", "omp:m", "codex")).toThrow(
      "agent 已禁用：omp",
    );
  });
});
