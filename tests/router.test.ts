import { describe, expect, test } from "bun:test";

import { ConfigSchema } from "../src/config/schema";
import { buildRouteCandidates, route } from "../src/router/router";
import { inferStrengths } from "../src/router/scorer";
import type { RouteCandidate } from "../src/router/types";

const baseConfig = ConfigSchema.parse({
  defaultAgent: "codex",
  agents: {
    codex: {
      models: [{ id: "large", contextWindow: 128_000, cost: 4, strengths: ["long-context"] }],
    },
  },
});

describe("routing issue regressions", () => {
  test("hybrid routing prefers the matching higher-priority rule over a larger low-priority score", () => {
    const config = ConfigSchema.parse({
      defaultAgent: "codex",
      routing: {
        strategy: "hybrid",
        rules: [
          { name: "critical", priority: 100, score: 1, when: { keywords: ["deploy"] }, use: { agent: "codex" } },
          { name: "fallback", priority: 0, score: 20, when: { keywords: ["deploy"] }, use: { agent: "claude" } },
        ],
      },
    });
    const candidates: RouteCandidate[] = [
      { agent: "codex", strengths: [], isDefault: false },
      { agent: "claude", strengths: [], isDefault: true },
    ];

    const decision = route({ prompt: "deploy" }, config, { candidates });
    expect(decision.agent).toBe("codex");
    expect(decision.matchedRule?.name).toBe("critical");
  });

  test("model context window reaches route candidates and informs context scoring", () => {
    const config = ConfigSchema.parse({
      ...baseConfig,
      agents: {
        codex: { models: [
          { id: "fits", contextWindow: 128_000, strengths: [], cost: 2 },
          { id: "small", contextWindow: 8_000, strengths: [], cost: 2 },
        ] },
      },
      defaultAgent: "codex",
      routing: { strategy: "score", weights: { context: 5, default: 0 } },
    });
    const candidates = buildRouteCandidates(config, { availableAgents: ["codex"] });
    expect(candidates.find((candidate) => candidate.model === "fits")?.contextWindow).toBe(128_000);
    expect(candidates.find((candidate) => candidate.model === "small")?.contextWindow).toBe(8_000);
    const decision = route({ prompt: "summarize", contextSize: 32_000 }, config, { candidates });
    expect(decision.model).toBe("fits");
  });

  test("available implicit agents remain candidates while explicitly disabled agents do not", () => {
    const config = ConfigSchema.parse({
      defaultAgent: "codex",
      agents: { pi: { enabled: false } },
    });
    const candidates = buildRouteCandidates(config, { availableAgents: ["codex", "claude", "pi"] });
    expect(candidates.map((candidate) => candidate.agent)).toContain("claude");
    expect(candidates.map((candidate) => candidate.agent)).not.toContain("pi");
  });

  test("strength keywords match tokens rather than substrings", () => {
    expect(inferStrengths({ prompt: "the quick brown fox" })).toContain("fast");
    expect(inferStrengths({ prompt: "We ate breakfast before the review" })).not.toContain("fast");
    expect(inferStrengths({ prompt: "design a system" })).toContain("reasoning");
    expect(inferStrengths({ prompt: "undesigned output" })).not.toContain("reasoning");
  });
});
