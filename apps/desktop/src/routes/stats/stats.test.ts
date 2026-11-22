import { describe, expect, it } from "bun:test";

import {
  aggregateCliStats,
  aggregateModelStats,
  buildContributionHeatmap,
  buildDailyTrendPoints,
  computeOverview,
  computeStreaks,
  formatDateKey,
  formatDisplayDate,
  getHeatmapLevel,
} from "./stats";
import type { AgentEntry, ModelOption, SessionRecord, SessionTurn } from "./types";

const mockAgents: AgentEntry[] = [
  {
    id: "codex",
    label: "Codex CLI",
    enabled: true,
    isDefault: true,
    available: true,
    command: "codex",
    path: "/usr/local/bin/codex",
    version: "0.9.1",
    models: ["qwen-3.8-flash", "deepseek-v4-flash"],
    runtime: "local",
    source: "path",
    candidates: [],
    diagnostics: [],
  },
  {
    id: "claude",
    label: "Claude Code",
    enabled: true,
    isDefault: false,
    available: true,
    command: "claude",
    path: "/usr/local/bin/claude",
    version: "1.0.2",
    models: ["claude-3-7-sonnet", "claude-3-5-haiku"],
    runtime: "local",
    source: "path",
    candidates: [],
    diagnostics: [],
  },
];

const mockCatalog: ModelOption[] = [
  {
    cliId: "codex",
    modelId: "qwen-3.8-flash",
    label: "Qwen 3.8 Flash",
    isDefault: true,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["fast", "chat"],
    cost: 0.001,
    contextWindow: 128000,
    available: true,
  },
  {
    cliId: "codex",
    modelId: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    isDefault: false,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["reasoning", "coding"],
    cost: 0.002,
    contextWindow: 64000,
    available: true,
  },
  {
    cliId: "claude",
    modelId: "claude-3-7-sonnet",
    label: "Claude 3.7 Sonnet",
    isDefault: true,
    capabilities: {
      structuredEvents: true,
      nativeResume: true,
      nonInteractivePrompt: true,
      explicitModel: true,
      toolEvents: true,
    },
    strengths: ["architecture", "refactor"],
    cost: 0.015,
    contextWindow: 200000,
    available: true,
  },
];

describe("Stats calculation algorithms & data structures", () => {
  const baseTime = new Date("2026-11-06T12:00:00Z").getTime();

  const mockSessions: SessionRecord[] = [
    {
      id: "sess-1",
      cliId: "codex",
      title: "Codex session 1",
      createdAt: baseTime - 86400000 * 2,
      updatedAt: baseTime - 86400000 * 2 + 10000,
      workspace: "/test",
    },
    {
      id: "sess-2",
      cliId: "codex",
      title: "Codex session 2",
      createdAt: baseTime - 86400000,
      updatedAt: baseTime - 86400000 + 20000,
      workspace: "/test",
    },
    {
      id: "sess-3",
      cliId: "claude",
      title: "Claude session 1",
      createdAt: baseTime,
      updatedAt: baseTime + 5000,
      workspace: "/test",
    },
  ];

  const mockTurnsMap: Record<string, SessionTurn[]> = {
    "sess-1": [
      {
        id: 1,
        sessionId: "sess-1",
        cliId: "codex",
        prompt: "Fix bug 1",
        output: "Fixed",
        exitCode: 0,
        signal: null,
        durationMs: 1200,
        createdAt: baseTime - 86400000 * 2,
        modelId: "qwen-3.8-flash",
      },
      {
        id: 2,
        sessionId: "sess-1",
        cliId: "codex",
        prompt: "Add tests",
        output: "Tests added",
        exitCode: 0,
        signal: null,
        durationMs: 1400,
        createdAt: baseTime - 86400000 * 2 + 5000,
        modelId: "qwen-3.8-flash",
      },
      {
        id: 3,
        sessionId: "sess-1",
        cliId: "codex",
        prompt: "Refactor",
        output: "Done",
        exitCode: 0,
        signal: null,
        durationMs: 1900,
        createdAt: baseTime - 86400000 * 2 + 10000,
        modelId: "deepseek-v4-flash",
      },
    ],
    "sess-2": [
      {
        id: 4,
        sessionId: "sess-2",
        cliId: "codex",
        prompt: "Review PR",
        output: "Approved",
        exitCode: 0,
        signal: null,
        durationMs: 900,
        createdAt: baseTime - 86400000,
        modelId: "qwen-3.8-flash",
      },
    ],
    "sess-3": [
      {
        id: 5,
        sessionId: "sess-3",
        cliId: "claude",
        prompt: "Architecture plan",
        output: "Plan written",
        exitCode: 0,
        signal: null,
        durationMs: 3100,
        createdAt: baseTime,
        modelId: "claude-3-7-sonnet",
      },
    ],
  };

  it("formatDateKey and formatDisplayDate produce correct date strings", () => {
    const testDate = new Date("2026-11-06T00:00:00Z");
    const key = formatDateKey(testDate);
    expect(key).toBe("2026-11-06");
    expect(formatDisplayDate(key)).toBe("11/06");
  });

  it("getHeatmapLevel correctly maps thresholds", () => {
    expect(getHeatmapLevel(0)).toBe(0);
    expect(getHeatmapLevel(-1)).toBe(0);
    expect(getHeatmapLevel(1)).toBe(1);
    expect(getHeatmapLevel(2)).toBe(1);
    expect(getHeatmapLevel(3)).toBe(2);
    expect(getHeatmapLevel(5)).toBe(2);
    expect(getHeatmapLevel(6)).toBe(3);
    expect(getHeatmapLevel(8)).toBe(3);
    expect(getHeatmapLevel(9)).toBe(4);
    expect(getHeatmapLevel(50)).toBe(4);
  });

  it("aggregateCliStats calculates accurate turn/session counts, shares, and models", () => {
    const stats = aggregateCliStats(mockSessions, mockTurnsMap, mockAgents);

    expect(stats.length).toBe(2);

    // Codex has 2 sessions, 4 turns (3 in sess-1, 1 in sess-2)
    const codex = stats.find((s) => s.cliId === "codex");
    expect(codex).toBeDefined();
    expect(codex!.label).toBe("Codex CLI");
    expect(codex!.sessionCount).toBe(2);
    expect(codex!.turnCount).toBe(4);
    expect(codex!.sessionShare).toBeCloseTo(2 / 3);
    expect(codex!.turnShare).toBeCloseTo(4 / 5);
    expect(codex!.models).toEqual([
      { modelId: "qwen-3.8-flash", count: 3 },
      { modelId: "deepseek-v4-flash", count: 1 },
    ]);

    // Claude has 1 session, 1 turn
    const claude = stats.find((s) => s.cliId === "claude");
    expect(claude).toBeDefined();
    expect(claude!.label).toBe("Claude Code");
    expect(claude!.sessionCount).toBe(1);
    expect(claude!.turnCount).toBe(1);
    expect(claude!.sessionShare).toBeCloseTo(1 / 3);
    expect(claude!.turnShare).toBeCloseTo(1 / 5);
    expect(claude!.models).toEqual([{ modelId: "claude-3-7-sonnet", count: 1 }]);

    // Top ranked should be codex
    expect(stats[0]!.cliId).toBe("codex");
  });

  it("aggregateModelStats computes usage and shares for each model option", () => {
    const modelStats = aggregateModelStats(mockSessions, mockTurnsMap, mockCatalog);

    expect(modelStats.length).toBe(3);

    const qwen = modelStats.find((m) => m.modelId === "qwen-3.8-flash");
    expect(qwen).toBeDefined();
    expect(qwen!.label).toBe("Qwen 3.8 Flash");
    expect(qwen!.count).toBe(3);
    expect(qwen!.share).toBeCloseTo(3 / 5);

    const deepseek = modelStats.find((m) => m.modelId === "deepseek-v4-flash");
    expect(deepseek).toBeDefined();
    expect(deepseek!.count).toBe(1);
    expect(deepseek!.share).toBeCloseTo(1 / 5);

    const sonnet = modelStats.find((m) => m.modelId === "claude-3-7-sonnet");
    expect(sonnet).toBeDefined();
    expect(sonnet!.count).toBe(1);
    expect(sonnet!.share).toBeCloseTo(1 / 5);
  });

  it("buildDailyTrendPoints aggregates chronological data points across days", () => {
    const refDate = new Date(baseTime);
    const trendPoints = buildDailyTrendPoints(mockSessions, mockTurnsMap, 7, refDate);

    expect(trendPoints.length).toBe(7);

    // The last point corresponds to baseTime (2026-11-06)
    const todayPoint = trendPoints[trendPoints.length - 1]!;
    expect(todayPoint.totalUpdates).toBe(1); // 1 turn on claude
    expect(todayPoint.byCli["claude"]).toBe(1);
    expect(todayPoint.byModel["claude-3-7-sonnet"]).toBe(1);

    // 2 days ago point
    const twoDaysAgoPoint = trendPoints[trendPoints.length - 3]!;
    expect(twoDaysAgoPoint.totalUpdates).toBe(3);
    expect(twoDaysAgoPoint.byCli["codex"]).toBe(3);
    expect(twoDaysAgoPoint.byModel["qwen-3.8-flash"]).toBe(2);
    expect(twoDaysAgoPoint.byModel["deepseek-v4-flash"]).toBe(1);
  });

  it("buildContributionHeatmap generates 7-day grid weeks with accurate levels", () => {
    const refDate = new Date(baseTime);
    const heatmap = buildContributionHeatmap(mockSessions, mockTurnsMap, 10, refDate);

    expect(heatmap.weeks.length).toBeGreaterThanOrEqual(10);
    // Every week must have 7 days
    for (const week of heatmap.weeks) {
      expect(week.length).toBe(7);
    }

    // Total updates across the heatmap should match turns
    expect(heatmap.totalUpdates).toBe(5);
    expect(heatmap.monthLabels.length).toBeGreaterThan(0);
  });

  it("computeStreaks accurately determines consecutive days and total active days", () => {
    const refDate = new Date(baseTime);
    const streaks = computeStreaks(mockSessions, mockTurnsMap, refDate);

    // Days active: 3 consecutive days (baseTime - 2 days, baseTime - 1 day, baseTime)
    expect(streaks.totalActiveDays).toBe(3);
    expect(streaks.currentStreak).toBe(3);
    expect(streaks.longestStreak).toBe(3);
  });

  it("computeOverview combines summary, cliStats, modelStats, trendPoints, and heatmap", () => {
    const refDate = new Date(baseTime);
    const overview = computeOverview(mockSessions, mockTurnsMap, mockAgents, mockCatalog, refDate);

    expect(overview.summary.totalSessions).toBe(3);
    expect(overview.summary.totalTurns).toBe(5);
    expect(overview.summary.totalClis).toBe(2);
    expect(overview.summary.mostUsedCli?.cliId).toBe("codex");
    expect(overview.summary.mostUsedModel?.modelId).toBe("qwen-3.8-flash");
    expect(overview.summary.currentStreak).toBe(3);
    expect(overview.summary.longestStreak).toBe(3);
    expect(overview.summary.totalActiveDays).toBe(3);

    expect(overview.cliStats.length).toBe(2);
    expect(overview.modelStats.length).toBe(3);
    expect(overview.trendPoints.length).toBe(14);
    expect(overview.heatmap.weeks.length).toBeGreaterThanOrEqual(20);
  });

  it("handles empty or boundary states without errors", () => {
    const overview = computeOverview([], {}, [], []);

    expect(overview.summary.totalSessions).toBe(0);
    expect(overview.summary.totalTurns).toBe(0);
    expect(overview.summary.totalClis).toBe(0);
    expect(overview.summary.mostUsedCli).toBeNull();
    expect(overview.summary.mostUsedModel).toBeNull();
    expect(overview.summary.currentStreak).toBe(0);
    expect(overview.summary.longestStreak).toBe(0);
    expect(overview.summary.totalActiveDays).toBe(0);
    expect(overview.cliStats).toEqual([]);
    expect(overview.modelStats).toEqual([]);
  });
});
