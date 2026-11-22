import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StatsView } from "./StatsView";

describe("StatsView", () => {
  it("renders StatsView with CLI usage ranking, minimalist line chart, and GitHub heatmap", () => {
    const testAgents = [
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
        models: ["claude-3-7-sonnet"],
        runtime: "local",
        source: "path",
        candidates: [],
        diagnostics: [],
      },
    ];

    const testCatalog = [
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
        strengths: ["reasoning", "coding"],
        cost: 0.015,
        contextWindow: 200000,
        available: true,
      },
    ];

    const testSessions = [
      {
        id: "sess-stat-1",
        cliId: "codex",
        title: "自适应智能路由开发",
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 43200000,
        workspace: "/Users/allure/Desktop/coderelay",
      },
      {
        id: "sess-stat-2",
        cliId: "claude",
        title: "重构 SQLite 会话索引",
        createdAt: Date.now() - 3600000 * 4,
        updatedAt: Date.now() - 3600000,
        workspace: "/Users/allure/Desktop/coderelay",
      },
    ];

    const testTurnsMap = {
      "sess-stat-1": [
        {
          id: 1,
          sessionId: "sess-stat-1",
          cliId: "codex",
          prompt: "分析路由逻辑",
          output: "分析完毕",
          exitCode: 0,
          signal: null,
          durationMs: 1200,
          createdAt: Date.now() - 86400000,
          modelId: "qwen-3.8-flash",
        },
        {
          id: 2,
          sessionId: "sess-stat-1",
          cliId: "codex",
          prompt: "补全单测覆盖",
          output: "测试通过",
          exitCode: 0,
          signal: null,
          durationMs: 900,
          createdAt: Date.now() - 43200000,
          modelId: "qwen-3.8-flash",
        },
      ],
      "sess-stat-2": [
        {
          id: 3,
          sessionId: "sess-stat-2",
          cliId: "claude",
          prompt: "优化持久化 schema",
          output: "完成优化",
          exitCode: 0,
          signal: null,
          durationMs: 2100,
          createdAt: Date.now() - 3600000 * 4,
          modelId: "claude-3-7-sonnet",
        },
      ],
    };

    const statsHtml = renderToStaticMarkup(
      <StatsView
        workspaceInput="/Users/allure/Desktop/coderelay"
        sessions={testSessions}
        agents={testAgents}
        catalogOptions={testCatalog}
        turnsMap={testTurnsMap}
        onRefreshSessions={() => {}}
        onOpenSession={() => {}}
      />,
    );

    // 1. Header & KPIs
    expect(statsHtml).toContain("效能统计与数据看板");
    expect(statsHtml).toContain("coderelay");
    expect(statsHtml).toContain("累计对话与交互");
    expect(statsHtml).toContain("主力 CLI Agent");
    expect(statsHtml).toContain("高频选择模型");
    expect(statsHtml).toContain("连续活跃天数");

    // 2. Requirement 1: CLI usage & conversation ranking
    expect(statsHtml).toContain("CLI 使用频率与对话排行");
    expect(statsHtml).toContain("Codex CLI");
    expect(statsHtml).toContain("Claude Code");
    expect(statsHtml).toContain('data-cli-icon="codex"');
    expect(statsHtml).toContain('data-cli-icon="claude"');
    expect(statsHtml).not.toContain("#1</span>");
    expect(statsHtml).not.toContain("#2</span>");
    expect(statsHtml).toContain("最高频使用");
    expect(statsHtml).toContain("qwen-3.8-flash");

    // 3. Requirement 2: Model & CLI statistics with line chart
    expect(statsHtml).toContain("智能模型选择与活跃趋势");
    expect(statsHtml).toContain("按 CLI 统计");
    expect(statsHtml).toContain("按模型统计");
    expect(statsHtml).toContain("总交互量");
    expect(statsHtml).toContain("<svg");
    expect(statsHtml).toContain("Qwen 3.8 Flash");
    expect(statsHtml).toContain("Claude 3.7 Sonnet");

    // 4. Requirement 3: GitHub-style contribution heatmap
    expect(statsHtml).toContain("对话更新活跃热力图");
    expect(statsHtml).toContain("周一");
    expect(statsHtml).toContain("周三");
    expect(statsHtml).toContain("周五");
    expect(statsHtml).toContain("少");
    expect(statsHtml).toContain("多");
  });
});
