import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ApiKeyView } from "./ApiKeyView";
import { ConfigView } from "./ConfigView";
import {
  buildWorkspaceWheelList,
  closeFileTab,
  FilesView,
  stepWorkspaceIndex,
} from "./FilesView";
import { IconRail } from "./IconRail";
import { Sidebar } from "./Sidebar";
import { StatsView } from "./StatsView";
import { Titlebar } from "./Titlebar";
import { isConversationRouteActive } from "../stores/navigationStore";
import type { JevSettings, WorkspaceView } from "../types";

describe("Decoupled ApiKeyView & ConfigView", () => {
  it("renders ApiKeyView with stored SQLite key and ensures no config yaml elements exist", () => {
    const jevSettings: JevSettings = {
      stored: true,
      environmentConfigured: false,
    };
    const html = renderToStaticMarkup(
      <ApiKeyView
        jevBusy={false}
        jevSettings={jevSettings}
        jevApiKeyInput="sk-live-real-user-test-key-12345"
        notice="API Key 已成功持久化到本地 SQLite"
        onJevApiKeyInputChange={() => {}}
        onSaveJevApiKey={() => {}}
        onClearJevApiKey={() => {}}
      />,
    );

    // Verify API Key management UI elements
    expect(html).toContain("API 密钥管理");
    expect(html).toContain("TypeSafe JEV 决策路由");
    expect(html).toContain("已存储在本地安全数据库 (SQLite)");
    expect(html).toContain("API Key 已成功持久化到本地 SQLite");
    expect(html).toContain("sk-live-real-user-test-key-12345");
    expect(html).toContain("清除已存 API Key");

    // Strictly ensure Decoupling: Config YAML elements must NOT exist in ApiKeyView
    expect(html).not.toContain("Config YAML");
    expect(html).not.toContain("textarea");
    expect(html).not.toContain("config.yaml");
  });

  it("renders ApiKeyView with environment-configured key state and unconfigured state", () => {
    const envSettings: JevSettings = {
      stored: false,
      environmentConfigured: true,
    };
    const envHtml = renderToStaticMarkup(
      <ApiKeyView
        jevBusy={false}
        jevSettings={envSettings}
        jevApiKeyInput=""
        onJevApiKeyInputChange={() => {}}
        onSaveJevApiKey={() => {}}
        onClearJevApiKey={() => {}}
      />,
    );

    expect(envHtml).toContain("已从环境变量 (TYPESAFE_API_KEY) 配置");
    expect(envHtml).not.toContain("清除已存 API Key");

    const unconfiguredSettings: JevSettings = {
      stored: false,
      environmentConfigured: false,
    };
    const unconfHtml = renderToStaticMarkup(
      <ApiKeyView
        jevBusy={false}
        jevSettings={unconfiguredSettings}
        jevApiKeyInput=""
        onJevApiKeyInputChange={() => {}}
        onSaveJevApiKey={() => {}}
        onClearJevApiKey={() => {}}
      />,
    );

    expect(unconfHtml).toContain("未配置");
    expect(unconfHtml).toContain("填入 TYPESAFE_API_KEY");
  });

  it("renders ConfigView focused solely on config YAML settings without any API key coupling", () => {
    const sampleConfigPath = "/home/developer/.coderelay/config.yaml";
    const sampleConfigDraft = [
      "routing:",
      "  mode: dynamic",
      "  fallbackAgent: claude",
      "  timeoutMs: 30000",
    ].join("\n");

    const html = renderToStaticMarkup(
      <ConfigView
        configPath={sampleConfigPath}
        configBusy={false}
        configDraft={sampleConfigDraft}
        onConfigDraftChange={() => {}}
        onLoadConfigSource={() => {}}
        onSaveConfig={() => {}}
      />,
    );

    // Verify Config UI elements
    expect(html).toContain(sampleConfigPath);
    expect(html).toContain("Config YAML");
    expect(html).toContain("fallbackAgent: claude");

    // Verify Theme Preset options including newly added themes
    expect(html).toContain("主题外观");
    expect(html).toContain("青色");
    expect(html).toContain("天蓝色");
    expect(html).toContain("粉色");
    expect(html).toContain("红色");
    expect(html).toContain("自定义背景图");
    expect(html).toContain("上传背景图片文件");

    // Verify Code Color Style options
    expect(html).toContain("代码颜色风格");
    expect(html).toContain("GitHub Light");
    expect(html).toContain("One Dark");
    expect(html).toContain("Dracula");
    expect(html).toContain("Tokyo Night");

    // Strictly ensure Decoupling: API Key elements must NOT be coupled into ConfigView
    expect(html).not.toContain("API Key");
    expect(html).not.toContain("jev-api-key");
    expect(html).not.toContain("TYPESAFE_API_KEY");
    expect(html).not.toContain("API 密钥管理");
  });

  it("renders IconRail with distinct navigation destinations for both API Keys and Settings without unused third route", () => {
    let selectedView: WorkspaceView | null = null;
    const handleSelectView = (view: WorkspaceView) => {
      selectedView = view;
    };

    // When viewing apikeys
    const apiKeyRailHtml = renderToStaticMarkup(
      <IconRail
        currentView="apikeys"
        onSelectView={handleSelectView}
      />,
    );

    expect(apiKeyRailHtml).toContain('aria-label="API Keys"');
    expect(apiKeyRailHtml).toContain('aria-label="Settings"');
    expect(apiKeyRailHtml).toContain('aria-label="Stats"');
    expect(apiKeyRailHtml).not.toContain('aria-label="New"');
    expect(apiKeyRailHtml).not.toContain('title="New"');

    // When viewing config
    const configRailHtml = renderToStaticMarkup(
      <IconRail
        currentView="config"
        onSelectView={handleSelectView}
      />,
    );

    expect(configRailHtml).toContain('aria-label="API Keys"');
    expect(configRailHtml).toContain('aria-label="Settings"');
    expect(configRailHtml).toContain('aria-label="Stats"');
    expect(configRailHtml).not.toContain('aria-label="New"');
    expect(configRailHtml).not.toContain('title="New"');

    // When viewing stats
    const statsRailHtml = renderToStaticMarkup(
      <IconRail
        currentView="stats"
        onSelectView={handleSelectView}
      />,
    );

    expect(statsRailHtml).toContain('aria-label="Stats"');
    expect(statsRailHtml).toContain('title="Stats"');
  });

  it("renders Sidebar and Titlebar toggle button only on conversation-related routes", () => {
    const mockSessions = [
      {
        id: "sess-abc-123",
        title: "重构对话路由",
        cliId: "claude",
        createdAt: 1729999999000,
        updatedAt: 1730000000000,
        workspace: "/Users/allure/Desktop/coderelay",
      },
    ];

    function renderLayout(view: WorkspaceView) {
      const isConversation = isConversationRouteActive(view);
      const titlebarHtml = renderToStaticMarkup(
        <Titlebar
          sidebarCollapsed={false}
          onToggleSidebar={isConversation ? () => {} : undefined}
          rightSidebarOpen={false}
          onToggleRightSidebar={() => {} }
        />,
      );

      const sidebarHtml = isConversation
        ? renderToStaticMarkup(
            <Sidebar
              collapsed={false}
              workspaceInput="/Users/allure/Desktop/coderelay"
              recentWorkspaces={["/Users/allure/Desktop/coderelay"]}
              workspaceDropdownOpen={false}
              onToggleWorkspaceDropdown={() => {}}
              onSelectWorkspace={() => {}}
              onPickWorkspace={() => {}}
              loading={false}
              onRefreshDiscovery={() => {}}
              onStartNewTask={() => {}}
              sessions={mockSessions}
              activeSessionId="sess-abc-123"
              onOpenSession={() => {}}
              onDeleteSession={() => {}}
              onDeleteWorkspaceSessions={() => {}}
            />,
          )
        : null;

      return { isConversation, titlebarHtml, sidebarHtml };
    }

    // 1. Conversation view ("workspace"): Sidebar is rendered, Titlebar includes toggle button
    const workspaceRoute = renderLayout("workspace");
    expect(workspaceRoute.isConversation).toBe(true);
    expect(workspaceRoute.titlebarHtml).toContain('aria-label="Toggle sidebar"');
    expect(workspaceRoute.titlebarHtml).toContain('title="Sidebar (⌘B)"');
    expect(workspaceRoute.sidebarHtml).not.toBeNull();
    expect(workspaceRoute.sidebarHtml).toContain("新会话");
    expect(workspaceRoute.sidebarHtml).toContain("coderelay");

    // 2. Sessions history view ("sessions"): Sidebar NOT rendered, Titlebar toggle NOT present
    const sessionsRoute = renderLayout("sessions");
    expect(sessionsRoute.isConversation).toBe(false);
    expect(sessionsRoute.titlebarHtml).not.toContain('aria-label="Toggle sidebar"');
    expect(sessionsRoute.sidebarHtml).toBeNull();

    // 3. Settings view ("config"): Sidebar NOT rendered, Titlebar toggle NOT present
    const configRoute = renderLayout("config");
    expect(configRoute.isConversation).toBe(false);
    expect(configRoute.titlebarHtml).not.toContain('aria-label="Toggle sidebar"');
    expect(configRoute.sidebarHtml).toBeNull();

    // 4. API Keys view ("apikeys"): Sidebar NOT rendered, Titlebar toggle NOT present
    const apiKeysRoute = renderLayout("apikeys");
    expect(apiKeysRoute.isConversation).toBe(false);
    expect(apiKeysRoute.titlebarHtml).not.toContain('aria-label="Toggle sidebar"');
    expect(apiKeysRoute.sidebarHtml).toBeNull();

    // 5. Stats view ("stats"): Sidebar NOT rendered, Titlebar toggle NOT present
    const statsRoute = renderLayout("stats");
    expect(statsRoute.isConversation).toBe(false);
    expect(statsRoute.titlebarHtml).not.toContain('aria-label="Toggle sidebar"');
    expect(statsRoute.sidebarHtml).toBeNull();
  });

  it("filters sidebar sessions strictly by the selected workspace in the top dropdown", () => {
    const sharedSessions = [
      {
        id: "sess-1",
        title: "现有项目任务",
        cliId: "codex",
        createdAt: 1729999999000,
        updatedAt: 1730000000000,
        workspace: "/Users/allure/Desktop/coderelay",
      },
      {
        id: "sess-2",
        title: "独立会话任务",
        cliId: "claude",
        createdAt: 1729999999000,
        updatedAt: 1730000001000,
        workspace: "",
      },
    ];

    const emptyProjectSidebarHtml = renderToStaticMarkup(
      <Sidebar
        collapsed={false}
        workspaceInput="/Users/allure/Projects/brand-new-project"
        recentWorkspaces={[
          "/Users/allure/Projects/brand-new-project",
          "/Users/allure/Desktop/coderelay",
        ]}
        workspaceDropdownOpen={false}
        onToggleWorkspaceDropdown={() => {}}
        onSelectWorkspace={() => {}}
        onPickWorkspace={() => {}}
        loading={false}
        onRefreshDiscovery={() => {}}
        onStartNewTask={() => {}}
        sessions={sharedSessions}
        activeSessionId="sess-1"
        onOpenSession={() => {}}
        onDeleteSession={() => {}}
        onDeleteWorkspaceSessions={() => {}}
      />,
    );

    // Selected workspace is shown in the top dropdown, and its empty state is shown below
    expect(emptyProjectSidebarHtml).toContain("brand-new-project");
    expect(emptyProjectSidebarHtml).toContain("暂无会话");
    // Other workspaces and their sessions are NOT shown in the session list
    expect(emptyProjectSidebarHtml).not.toContain("现有项目任务");
    expect(emptyProjectSidebarHtml).not.toContain("独立会话任务");
    expect(emptyProjectSidebarHtml).not.toContain("coderelay");

    const activeProjectSidebarHtml = renderToStaticMarkup(
      <Sidebar
        collapsed={false}
        workspaceInput="/Users/allure/Desktop/coderelay"
        recentWorkspaces={[
          "/Users/allure/Projects/brand-new-project",
          "/Users/allure/Desktop/coderelay",
        ]}
        workspaceDropdownOpen={false}
        onToggleWorkspaceDropdown={() => {}}
        onSelectWorkspace={() => {}}
        onPickWorkspace={() => {}}
        loading={false}
        onRefreshDiscovery={() => {}}
        onStartNewTask={() => {}}
        sessions={sharedSessions}
        activeSessionId="sess-1"
        onOpenSession={() => {}}
        onDeleteSession={() => {}}
        onDeleteWorkspaceSessions={() => {}}
      />,
    );

    expect(activeProjectSidebarHtml).toContain("coderelay");
    expect(activeProjectSidebarHtml).toContain("现有项目任务");
    expect(activeProjectSidebarHtml).not.toContain("brand-new-project");
    expect(activeProjectSidebarHtml).not.toContain("独立会话任务");
    expect(activeProjectSidebarHtml).not.toContain("暂无会话");
  });

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

  it("renders Files route in IconRail and VS Code-style Explorer in FilesView", () => {
    const railHtml = renderToStaticMarkup(
      <IconRail currentView="files" onSelectView={() => {}} />,
    );
    expect(railHtml).toContain('aria-label="Files"');

    const filesHtml = renderToStaticMarkup(
      <FilesView
        workspaceInput="/Users/allure/Desktop/coderelay"
        recentWorkspaces={[
          "/Users/allure/Desktop/coderelay",
          "/Users/allure/Projects/demo-app",
          "/Users/allure/Projects/api-server",
        ]}
        onSelectWorkspace={() => {}}
        onDeleteWorkspace={() => {}}
        onPickWorkspace={() => {}}
      />,
    );
    expect(filesHtml).toContain("Explorer");
    expect(filesHtml).toContain("Workspace wheel switcher");
    expect(filesHtml).toContain('aria-label="Remove workspace coderelay"');
    expect(filesHtml).toContain("coderelay");
    expect(filesHtml).toContain("demo-app");
    expect(filesHtml).toContain("api-server");
    expect(filesHtml).toContain("1/3");
    expect(filesHtml).toContain('placeholder="Filter files..."');
    expect(filesHtml).toContain("Select a file from the explorer sidebar");

    // Verify wheel list & wrap-around stepping helpers
    const wheelList = buildWorkspaceWheelList("/Users/allure/Projects/new-ws", [
      "/Users/allure/Desktop/coderelay",
      "/Users/allure/Projects/demo-app",
      "/Users/allure/Desktop/coderelay",
    ]);
    expect(wheelList).toEqual([
      "/Users/allure/Projects/new-ws",
      "/Users/allure/Desktop/coderelay",
      "/Users/allure/Projects/demo-app",
    ]);
    expect(stepWorkspaceIndex(0, -1, 3)).toBe(2);
    expect(stepWorkspaceIndex(2, 1, 3)).toBe(0);
    expect(stepWorkspaceIndex(1, 1, 3)).toBe(2);
  });

  it("manages VS Code-style multi-file tabs and closes individual files cleanly", () => {
    const tabs = ["src/App.tsx", "src/main.ts", "README.md"];

    // Closing an inactive tab keeps the current active tab
    const afterInactiveClose = closeFileTab(tabs, "src/main.ts", "src/App.tsx");
    expect(afterInactiveClose.nextTabs).toEqual(["src/main.ts", "README.md"]);
    expect(afterInactiveClose.nextActiveTab).toBe("src/main.ts");

    // Closing the active middle tab activates the next tab
    const afterActiveClose = closeFileTab(tabs, "src/main.ts", "src/main.ts");
    expect(afterActiveClose.nextTabs).toEqual(["src/App.tsx", "README.md"]);
    expect(afterActiveClose.nextActiveTab).toBe("README.md");

    // Closing the active last tab falls back to the previous tab
    const afterLastClose = closeFileTab(tabs, "README.md", "README.md");
    expect(afterLastClose.nextTabs).toEqual(["src/App.tsx", "src/main.ts"]);
    expect(afterLastClose.nextActiveTab).toBe("src/main.ts");

    // Closing the only remaining tab resets activeTab to null
    const afterFinalClose = closeFileTab(["README.md"], "README.md", "README.md");
    expect(afterFinalClose.nextTabs).toEqual([]);
    expect(afterFinalClose.nextActiveTab).toBeNull();
  });

  it("leaves workspace empty without showing home directory when no folder is selected", () => {
    const emptyFilesHtml = renderToStaticMarkup(
      <FilesView
        workspaceInput=""
        recentWorkspaces={[]}
        onSelectWorkspace={() => {}}
        onDeleteWorkspace={() => {}}
        onPickWorkspace={() => {}}
      />,
    );
    expect(emptyFilesHtml).toContain("未选择文件夹");
    expect(emptyFilesHtml).toContain("Open a folder to browse and inspect its files.");
    expect(emptyFilesHtml).not.toContain("Remove workspace");

    const emptySidebarHtml = renderToStaticMarkup(
      <Sidebar
        workspaceInput=""
        recentWorkspaces={[]}
        workspaceDropdownOpen={false}
        onToggleWorkspaceDropdown={() => {}}
        onSelectWorkspace={() => {}}
        onPickWorkspace={() => {}}
        loading={false}
        onRefreshDiscovery={() => {}}
        onStartNewTask={() => {}}
        sessions={[]}
        activeSessionId={null}
        onOpenSession={() => {}}
        onDeleteSession={() => {}}
        onDeleteWorkspaceSessions={() => {}}
      />,
    );
    expect(emptySidebarHtml).toContain("选择文件夹");
  });
});
