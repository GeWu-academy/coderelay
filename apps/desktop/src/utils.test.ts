import { describe, expect, it } from "bun:test";
import type { AgentEntry, ModelOption } from "./types";
import { isTimePeriod, TIME_PERIODS } from "./types";
import {
  ENCOURAGEMENT_MESSAGES,
  formatModeLabel,
  formatTimestamp,
  getAvailableModelsForCli,
  getTimePeriod,
  getWelcomeTimeSnapshot,
  groupSessionsByWorkspace,
  loadPermission,
  PERMISSION_STORAGE_KEY,
  sanitizePermission,
  savePermission,
  mergeRecentWorkspaces,
  PERIOD_GREETINGS,
  resolveRouteSelection,
  workspaceName,
} from "./utils";

describe("dayjs time formatting & welcome encouragement utilities", () => {
  it("validates TIME_PERIODS SSOT and isTimePeriod type guard with valid and boundary values", () => {
    expect(TIME_PERIODS).toEqual(["morning", "afternoon", "evening", "late_night"]);

    for (const period of TIME_PERIODS) {
      expect(isTimePeriod(period)).toBe(true);
      expect(PERIOD_GREETINGS[period].length).toBeGreaterThan(0);
    }

    expect(isTimePeriod("")).toBe(false);
    expect(isTimePeriod("noon")).toBe(false);
    expect(isTimePeriod(null)).toBe(false);
    expect(isTimePeriod(undefined)).toBe(false);
    expect(isTimePeriod(2026)).toBe(false);
  });

  it("classifies time periods across hour boundaries accurately", () => {
    // Boundary assertions for morning [05:00, 11:59]
    expect(getTimePeriod("2026-11-04T04:59:59")).toBe("late_night");
    expect(getTimePeriod("2026-11-04T05:00:00")).toBe("morning");
    expect(getTimePeriod("2026-11-04T11:59:59")).toBe("morning");

    // Boundary assertions for afternoon [12:00, 17:59]
    expect(getTimePeriod("2026-11-04T12:00:00")).toBe("afternoon");
    expect(getTimePeriod("2026-11-04T15:34:08")).toBe("afternoon");
    expect(getTimePeriod("2026-11-04T17:59:59")).toBe("afternoon");

    // Boundary assertions for evening [18:00, 22:59]
    expect(getTimePeriod("2026-11-04T18:00:00")).toBe("evening");
    expect(getTimePeriod("2026-11-04T22:59:59")).toBe("evening");

    // Boundary assertions for late_night [23:00, 04:59]
    expect(getTimePeriod("2026-11-04T23:00:00")).toBe("late_night");
    expect(getTimePeriod("2026-11-04T00:00:00")).toBe("late_night");
  });

  it("builds complete non-empty WelcomeTimeSnapshot via dayjs", () => {
    const snapshot = getWelcomeTimeSnapshot("2026-11-04T15:34:08", 0);

    expect(snapshot).toEqual({
      period: "afternoon",
      greeting: "下午好",
      formattedTime: "15:34:08",
      formattedDate: "2026年11月04日 星期三",
      encouragement: ENCOURAGEMENT_MESSAGES[0],
    });

    // Boundary index wrapping (negative & overflow indices)
    const wrappedSnapshot = getWelcomeTimeSnapshot(
      "2026-11-04T08:05:09",
      ENCOURAGEMENT_MESSAGES.length + 2,
    );
    expect(wrappedSnapshot.period).toBe("morning");
    expect(wrappedSnapshot.greeting).toBe("早上好");
    expect(wrappedSnapshot.formattedTime).toBe("08:05:09");
    expect(wrappedSnapshot.encouragement).toBe(ENCOURAGEMENT_MESSAGES[2]);
  });

  it("formats session timestamps with dayjs", () => {
    const ts = new Date("2026-11-04T15:34:08").getTime();
    expect(formatTimestamp(ts)).toBe("11/04 15:34");
  });

  it("merges picked workspace with discovered and existing recent workspaces without duplicates", () => {
    const merged = mergeRecentWorkspaces(
      "/Users/allure/Desktop/new-folder",
      ["/Users/allure/Desktop/coderelay", "/Users/allure/Desktop/new-folder"],
      ["/Users/allure/Desktop/archive-repo", "   ", "/Users/allure/Desktop/coderelay"],
      3,
    );

    expect(merged).toEqual([
      "/Users/allure/Desktop/new-folder",
      "/Users/allure/Desktop/coderelay",
      "/Users/allure/Desktop/archive-repo",
    ]);
    expect(workspaceName("/Users/allure/Desktop/new-folder/")).toBe("new-folder");
    expect(workspaceName("C:\\Projects\\coderelay\\")).toBe("coderelay");
    expect(workspaceName("   ")).toBe("—");
  });

  describe("three-tier route cascading selection (mode / cli / agent-model)", () => {
    const mockAgents: AgentEntry[] = [
      {
        id: "codex",
        label: "Codex",
        enabled: true,
        isDefault: true,
        available: true,
        command: "codex",
        path: "/usr/local/bin/codex",
        version: "0.9.1",
        models: ["qwen-3.8-flash", "deepseek-v4-flash"],
        runtime: "local",
        source: "path",
        candidates: [
          {
            path: "/usr/local/bin/codex",
            runtime: "local",
            source: "path",
            version: "0.9.1",
          },
        ],
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
        models: ["claude-3-7-sonnet"],
        runtime: "local",
        source: "path",
        candidates: [],
        diagnostics: [],
      },
    ];

    const mockCatalogOptions: ModelOption[] = [
      {
        cliId: "codex",
        modelId: "qwen-3.8-flash",
        label: "Qwen 3.8 Flash",
        isDefault: true,
        available: true,
        strengths: ["fast", "chat"],
        cost: 0.001,
        contextWindow: 128000,
        capabilities: {
          structuredEvents: true,
          nativeResume: true,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: true,
        },
      },
      {
        cliId: "codex",
        modelId: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        isDefault: false,
        available: true,
        strengths: ["coding", "reasoning"],
        cost: 0.002,
        contextWindow: 64000,
        capabilities: {
          structuredEvents: true,
          nativeResume: true,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: true,
        },
      },
      {
        cliId: "claude",
        modelId: "claude-3-7-sonnet",
        label: "Claude 3.7 Sonnet",
        isDefault: true,
        available: true,
        strengths: ["coding", "complex"],
        cost: 0.015,
        contextWindow: 200000,
        capabilities: {
          structuredEvents: true,
          nativeResume: false,
          nonInteractivePrompt: true,
          explicitModel: true,
          toolEvents: true,
        },
      },
    ];

    it("formats mode labels correctly", () => {
      expect(formatModeLabel("local")).toBe("Local");
      expect(formatModeLabel("manual")).toBe("Manual");
      expect(formatModeLabel("jev")).toBe("Jev");
      expect(formatModeLabel("custom_mode")).toBe("Custom_mode");
      expect(formatModeLabel("")).toBe("Local");
    });

    it("filters available models for a given CLI", () => {
      const codexModels = getAvailableModelsForCli(mockCatalogOptions, "codex");
      expect(codexModels.map((m) => m.modelId)).toEqual(["qwen-3.8-flash", "deepseek-v4-flash"]);
      expect(codexModels[0]?.strengths).toEqual(["fast", "chat"]);
      expect(codexModels[0]?.cost).toBe(0.001);

      const claudeModels = getAvailableModelsForCli(mockCatalogOptions, "claude");
      expect(claudeModels.map((m) => m.modelId)).toEqual(["claude-3-7-sonnet"]);

      expect(getAvailableModelsForCli(mockCatalogOptions, "")).toEqual([]);
      expect(getAvailableModelsForCli(mockCatalogOptions, "non_existent")).toEqual([]);
    });

    it("defaults to the first option across all 3 tiers when nothing is selected", () => {
      const resolved = resolveRouteSelection(
        { mode: "", agent: "", model: "" },
        ["local", "manual", "jev"],
        mockAgents,
        mockCatalogOptions,
      );

      expect(resolved).toEqual({
        mode: "local",
        agent: "codex",
        model: "qwen-3.8-flash",
      });
    });

    it("preserves valid selections when they are available", () => {
      const resolved = resolveRouteSelection(
        { mode: "jev", agent: "codex", model: "deepseek-v4-flash" },
        ["local", "manual", "jev"],
        mockAgents,
        mockCatalogOptions,
      );

      expect(resolved).toEqual({
        mode: "jev",
        agent: "codex",
        model: "deepseek-v4-flash",
      });
    });

    it("falls back to the first available model when agent switches or current model is invalid", () => {
      const resolved = resolveRouteSelection(
        { mode: "manual", agent: "claude", model: "non-existent-model" },
        ["local", "manual", "jev"],
        mockAgents,
        mockCatalogOptions,
      );

      expect(resolved).toEqual({
        mode: "manual",
        agent: "claude",
        model: "claude-3-7-sonnet",
      });
    });

    it("gracefully handles empty collections with safe fallbacks", () => {
      const resolved = resolveRouteSelection(
        { mode: "unknown", agent: "unknown", model: "unknown" },
        [],
        [],
        [],
      );

      expect(resolved).toEqual({
        mode: "local",
        agent: "",
        model: "",
      });
    });
  });
});

describe("groupSessionsByWorkspace", () => {
  const make = (id: string, workspace?: string) => ({
    id,
    cliId: "codex",
    title: `title ${id}`,
    createdAt: 1,
    updatedAt: 2,
    workspace,
  });

  it("archives sessions by folder and preserves opened workspaces even when empty", () => {
    const groups = groupSessionsByWorkspace(
      [make("a", "/p/alpha"), make("x"), make("b", "/p/beta"), make("c", "/p/alpha"), make("y", "")],
      ["/p/beta", "/p/alpha", "/p/empty"],
    );
    expect(groups.map((g) => g.workspace)).toEqual(["/p/beta", "/p/alpha", "/p/empty", null]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(["a", "c"]);
    expect(groups[2]?.sessions).toEqual([]);
    expect(groups[3]?.sessions.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("adds folders only known from sessions and omits the loose group when unused", () => {
    const groups = groupSessionsByWorkspace([make("a", "/p/new")], []);
    expect(groups).toEqual([{ workspace: "/p/new", sessions: [make("a", "/p/new")] }]);
  });
});

describe("permission persistence", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
  }

  it("remembers levels per workspace and CLI independently", () => {
    const storage = fakeStorage();
    savePermission("/repo/a", "claude", "plan", storage);
    savePermission("/repo/a", "codex", "read-only", storage);
    savePermission("/repo/b", "claude", "auto", storage);
    expect(loadPermission("/repo/a", "claude", storage)).toBe("plan");
    expect(loadPermission("/repo/a", "codex", storage)).toBe("read-only");
    expect(loadPermission("/repo/b", "claude", storage)).toBe("auto");
    expect(loadPermission("/repo/b", "codex", storage)).toBe("");
  });

  it("overwrites a previous choice and falls back on corrupt data", () => {
    const storage = fakeStorage();
    savePermission("/repo", "pi", "read-only", storage);
    savePermission("/repo", "pi", "default", storage);
    expect(loadPermission("/repo", "pi", storage)).toBe("default");
    const corrupt = fakeStorage({ [PERMISSION_STORAGE_KEY]: "{not json" });
    expect(loadPermission("/repo", "pi", corrupt)).toBe("");
    const wrongShape = fakeStorage({ [PERMISSION_STORAGE_KEY]: "[1,2]" });
    expect(loadPermission("/repo", "pi", wrongShape)).toBe("");
  });

  it("returns empty without storage or CLI id", () => {
    expect(loadPermission("/repo", "claude", null)).toBe("");
    expect(loadPermission("/repo", "", fakeStorage())).toBe("");
  });

  it("sanitizes levels the CLI does not offer", () => {
    const options = [{ id: "default" }, { id: "plan" }];
    expect(sanitizePermission("plan", options)).toBe("plan");
    expect(sanitizePermission("yolo", options)).toBe("");
    expect(sanitizePermission("plan", [])).toBe("");
  });
});
