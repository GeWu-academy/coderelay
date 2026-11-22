import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { isConversationRouteActive } from "../../stores/navigationStore";
import type { AgentEntry, WorkspaceView } from "../../types";
import { IconRail } from "./IconRail";
import { RightSidebar } from "./RightSidebar";
import { Sidebar } from "./Sidebar";
import { TerminalPanel } from "./TerminalPanel";
import { Titlebar } from "./Titlebar";
import {
  buildWorkspaceWheelList,
  stepWorkspaceIndex,
  WorkspaceSwitcher,
} from "./WorkspaceSwitcher";

describe("Layout shell components", () => {
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
    expect(selectedView).toBeNull();
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
          onToggleRightSidebar={() => {}}
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

  it("renders unified WorkspaceSwitcher in Titlebar with wheel switching, removal, and empty state", () => {
    const titlebarHtml = renderToStaticMarkup(
      <Titlebar
        workspaceInput="/Users/allure/Desktop/coderelay"
        recentWorkspaces={[
          "/Users/allure/Desktop/coderelay",
          "/Users/allure/Projects/demo-app",
          "/Users/allure/Projects/api-server",
        ]}
        onSelectWorkspace={() => {}}
        onDeleteWorkspace={() => {}}
        onPickWorkspace={() => {}}
        rightSidebarOpen={false}
        onToggleRightSidebar={() => {}}
      />,
    );
    expect(titlebarHtml).toContain('aria-label="Switch workspace"');
    expect(titlebarHtml).toContain("coderelay");

    const openSwitcherHtml = renderToStaticMarkup(
      <WorkspaceSwitcher
        currentWorkspace="/Users/allure/Desktop/coderelay"
        recentWorkspaces={[
          "/Users/allure/Desktop/coderelay",
          "/Users/allure/Projects/demo-app",
          "/Users/allure/Projects/api-server",
        ]}
        onSelectWorkspace={() => {}}
        onDeleteWorkspace={() => {}}
        onPickWorkspace={() => {}}
        defaultOpen
      />,
    );
    expect(openSwitcherHtml).toContain("Workspace wheel switcher");
    expect(openSwitcherHtml).toContain('aria-label="Remove workspace coderelay"');
    expect(openSwitcherHtml).toContain("coderelay");
    expect(openSwitcherHtml).toContain("demo-app");
    expect(openSwitcherHtml).toContain("api-server");
    expect(openSwitcherHtml).toContain("1/3");
    expect(openSwitcherHtml).toContain("打开文件夹");

    const emptySwitcherHtml = renderToStaticMarkup(
      <WorkspaceSwitcher
        currentWorkspace=""
        recentWorkspaces={[]}
        onSelectWorkspace={() => {}}
        onDeleteWorkspace={() => {}}
        onPickWorkspace={() => {}}
        defaultOpen
      />,
    );
    expect(emptySwitcherHtml).toContain("选择工作区");
    expect(emptySwitcherHtml).toContain("未选择文件夹");
    expect(emptySwitcherHtml).not.toContain("Remove workspace");

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

  it("renders RightSidebar in agents, terminal, and closed states", () => {
    const sampleAgents: AgentEntry[] = [
      {
        id: "claude",
        label: "Claude Code",
        enabled: true,
        isDefault: true,
        available: true,
        command: "claude",
        path: "/usr/local/bin/claude",
        version: "2.1.0",
        models: ["claude-sonnet-4-5"],
        runtime: "native",
        source: "path",
        candidates: [],
        diagnostics: [],
      },
      {
        id: "codex",
        label: "Codex CLI",
        enabled: true,
        isDefault: false,
        available: false,
        command: "codex",
        path: "",
        version: null,
        models: ["gpt-5-codex"],
        runtime: "native",
        source: "config",
        candidates: [],
        diagnostics: [{ level: "warn", message: "codex executable not found in PATH" }],
      },
      {
        id: "pi",
        label: "Pi",
        enabled: true,
        isDefault: false,
        available: true,
        command: "pi",
        path: "/usr/local/bin/pi",
        version: "0.4.0",
        models: ["claude-sonnet-4-5"],
        runtime: "native",
        source: "path",
        candidates: [{ path: "/usr/local/bin/pi", runtime: "native", source: "path", version: "0.4.0" }],
        diagnostics: [],
      },
      {
        id: "omp",
        label: "OMP",
        enabled: true,
        isDefault: false,
        available: true,
        command: "omp",
        path: "/usr/local/bin/omp",
        version: "1.3.0",
        models: ["gpt-5-codex"],
        runtime: "native",
        source: "path",
        candidates: [{ path: "/usr/local/bin/omp", runtime: "native", source: "path", version: "1.3.0" }],
        diagnostics: [],
      },
    ];

    const agentsHtml = renderToStaticMarkup(
      <RightSidebar
        open={true}
        mode="agents"
        onChangeMode={() => {}}
        agents={sampleAgents}
        selectedAgentId="claude"
        onSelectAgent={() => {}}
        workspaceCwd="/Users/allure/Desktop/coderelay"
      />,
    );
    expect(agentsHtml).toContain('aria-label="Agents"');
    expect(agentsHtml).toContain('aria-hidden="false"');
    expect(agentsHtml).toContain("w-[220px]");
    expect(agentsHtml).toContain("Claude Code");
    expect(agentsHtml).toContain("Codex CLI");
    expect(agentsHtml).toContain("Pi");
    expect(agentsHtml).toContain("OMP");
    expect(agentsHtml).toContain('data-cli-icon="claude"');
    expect(agentsHtml).toContain('data-cli-icon="codex"');
    expect(agentsHtml).toContain('data-cli-icon="pi"');
    expect(agentsHtml).toContain('data-cli-icon="omp"');
    expect(agentsHtml.indexOf('data-cli-icon="codex"')).toBeLessThan(agentsHtml.indexOf("Codex CLI"));
    expect(agentsHtml.indexOf('data-cli-icon="claude"')).toBeLessThan(agentsHtml.indexOf("Claude Code"));

    const terminalHtml = renderToStaticMarkup(
      <RightSidebar
        open={true}
        mode="terminal"
        onChangeMode={() => {}}
        agents={sampleAgents}
        selectedAgentId="claude"
        onSelectAgent={() => {}}
        workspaceCwd="/Users/allure/Desktop/coderelay"
      />,
    );
    expect(terminalHtml).toContain('aria-label="Terminal"');
    expect(terminalHtml).toContain("w-[420px]");
    expect(terminalHtml).toContain("New terminal");
    expect(terminalHtml).toContain("暂无活动终端");

    const closedHtml = renderToStaticMarkup(
      <RightSidebar
        open={false}
        mode="terminal"
        onChangeMode={() => {}}
        agents={sampleAgents}
        selectedAgentId="claude"
        onSelectAgent={() => {}}
        workspaceCwd="/Users/allure/Desktop/coderelay"
      />,
    );
    expect(closedHtml).toContain('aria-hidden="true"');
    expect(closedHtml).toContain("w-0");
  });

  it("renders TerminalPanel empty state with create button", () => {
    const html = renderToStaticMarkup(
      <TerminalPanel active={false} workspaceCwd="/Users/allure/Desktop/coderelay" />,
    );
    expect(html).toContain("暂无活动终端");
    expect(html).toContain("新建终端");
    expect(html).toContain('aria-label="New terminal"');
  });

  it("renders Sidebar as collapsible docked panel with collapse button", () => {
    const expandedHtml = renderToStaticMarkup(
      <Sidebar
        collapsed={false}
        onCollapse={() => {}}
        workspaceInput="/Users/allure/Desktop/coderelay"
        recentWorkspaces={["/Users/allure/Desktop/coderelay"]}
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
      />,
    );
    expect(expandedHtml).toContain("basis-[240px]");
    expect(expandedHtml).toContain('aria-label="收起侧边栏"');
    expect(expandedHtml).toContain('aria-hidden="false"');

    const collapsedHtml = renderToStaticMarkup(
      <Sidebar
        collapsed={true}
        onCollapse={() => {}}
        workspaceInput="/Users/allure/Desktop/coderelay"
        recentWorkspaces={["/Users/allure/Desktop/coderelay"]}
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
      />,
    );
    expect(collapsedHtml).toContain("w-0 shrink-0 basis-0");
    expect(collapsedHtml).toContain('aria-hidden="true"');
  });
});
