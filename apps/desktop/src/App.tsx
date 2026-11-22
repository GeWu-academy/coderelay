import { invoke } from "@tauri-apps/api/core";
import { useEffect, type ReactNode } from "react";

import {
  IconRail,
  RightSidebar,
  Sidebar,
  Titlebar,
  WorkbenchComposer,
} from "./components";
import { WorkbenchLayout } from "./layouts/WorkbenchLayout";
import {
  ApiKeyView,
  ConfigView,
  FilesView,
  ScmView,
  SessionsView,
  StatsView,
  WorkspaceView,
} from "./routes";
import { isConversationRouteActive, useNavigationStore } from "./stores/navigationStore";
import { useThemeStore } from "./stores/themeStore";
import { useWorkbenchStore } from "./stores/workbenchStore";
import type { SessionDetail } from "./types";

function renderComposer(compact = false): ReactNode {
  return <WorkbenchComposer compact={compact} />;
}

export function App() {
  const view = useNavigationStore((s) => s.view);
  const activeSessionId = useNavigationStore((s) => s.activeSessionId);
  const sidebarCollapsed = useNavigationStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useNavigationStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useNavigationStore((s) => s.setSidebarCollapsed);
  const rightSidebarOpen = useNavigationStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useNavigationStore((s) => s.toggleRightSidebar);
  const rightPanelMode = useNavigationStore((s) => s.rightPanelMode);
  const toggleRightPanelMode = useNavigationStore((s) => s.toggleRightPanelMode);
  const setRightPanelMode = useNavigationStore((s) => s.setRightPanelMode);
  const workspaceDropdownOpen = useNavigationStore((s) => s.workspaceDropdownOpen);
  const toggleWorkspaceDropdown = useNavigationStore((s) => s.toggleWorkspaceDropdown);

  const customBackground = useThemeStore((s) => s.customBackground);
  const customBackgroundOpacity = useThemeStore((s) => s.customBackgroundOpacity);

  const discovery = useWorkbenchStore((s) => s.discovery);
  const loading = useWorkbenchStore((s) => s.loading);
  const error = useWorkbenchStore((s) => s.error);
  const running = useWorkbenchStore((s) => s.running);
  const output = useWorkbenchStore((s) => s.output);
  const activity = useWorkbenchStore((s) => s.activity);
  const result = useWorkbenchStore((s) => s.result);
  const preview = useWorkbenchStore((s) => s.preview);
  const recentWorkspaces = useWorkbenchStore((s) => s.recentWorkspaces);
  const sessions = useWorkbenchStore((s) => s.sessions);
  const workspaceInput = useWorkbenchStore((s) => s.workspaceInput);
  const selectedAgentId = useWorkbenchStore((s) => s.form.agent);
  const selectedModelId = useWorkbenchStore((s) => s.form.model);

  const loadDiscovery = useWorkbenchStore((s) => s.loadDiscovery);
  const subscribeRunEvents = useWorkbenchStore((s) => s.subscribeRunEvents);
  const refreshSessions = useWorkbenchStore((s) => s.refreshSessions);
  const selectView = useWorkbenchStore((s) => s.selectView);
  const selectWorkspace = useWorkbenchStore((s) => s.selectWorkspace);
  const pickWorkspace = useWorkbenchStore((s) => s.pickWorkspace);
  const removeWorkspace = useWorkbenchStore((s) => s.removeWorkspace);
  const startNewTask = useWorkbenchStore((s) => s.startNewTask);
  const openSessionAndNavigate = useWorkbenchStore((s) => s.openSessionAndNavigate);
  const deleteSession = useWorkbenchStore((s) => s.deleteSession);
  const deleteWorkspaceSessions = useWorkbenchStore((s) => s.deleteWorkspaceSessions);
  const selectAgent = useWorkbenchStore((s) => s.selectAgent);

  useEffect(() => {
    void loadDiscovery();
    return subscribeRunEvents();
  }, [loadDiscovery, subscribeRunEvents]);

  const isConversationRoute = isConversationRouteActive(view);
  const agents = discovery?.agents ?? [];
  const showThread = Boolean(
    preview || output || activity.length > 0 || result || running,
  );

  function renderMainView(): ReactNode {
    switch (view) {
      case "workspace":
        return (
          <WorkspaceView
            key="workspace"
            error={error}
            showThread={showThread}
            running={running}
            result={result}
            preview={preview}
            output={output}
            activity={activity}
            renderComposer={renderComposer}
          />
        );
      case "files":
        return (
          <FilesView
            key="files"
            workspaceInput={workspaceInput}
            onPickWorkspace={() => void pickWorkspace()}
          />
        );
      case "scm":
        return (
          <ScmView
            key="scm"
            workspaceInput={workspaceInput}
            selectedAgentId={selectedAgentId}
            selectedModelId={selectedModelId}
            onPickWorkspace={() => void pickWorkspace()}
          />
        );
      case "sessions":
        return (
          <SessionsView
            key="sessions"
            workspaceInput={workspaceInput}
            sessions={sessions}
            activeSessionId={activeSessionId}
            onRefreshSessions={() => void refreshSessions()}
            onOpenSession={openSessionAndNavigate}
          />
        );
      case "stats":
        return (
          <StatsView
            key="stats"
            workspaceInput={workspaceInput}
            sessions={sessions}
            agents={agents}
            catalogOptions={discovery?.catalog.options ?? []}
            onRefreshSessions={() => void refreshSessions()}
            onOpenSession={openSessionAndNavigate}
            loadSessionTurns={async (sessionId) => {
              const detail = await invoke<SessionDetail>("get_session", { sessionId });
              return detail.turns;
            }}
          />
        );
      case "apikeys":
        return <ApiKeyView key="apikeys" />;
      case "config":
        return <ConfigView key="config" />;
    }
  }

  return (
    <WorkbenchLayout
      view={view}
      showLeftSidebar={isConversationRoute}
      sidebarCollapsed={sidebarCollapsed}
      rightSidebarOpen={rightSidebarOpen}
      showBottomDock={view === "workspace" && showThread}
      customBackground={customBackground}
      customBackgroundOpacity={customBackgroundOpacity}
      onToggleSidebarShortcut={toggleSidebar}
      onExpandSidebar={() => setSidebarCollapsed(false)}
      titlebar={
        <Titlebar
          workspaceInput={workspaceInput}
          recentWorkspaces={recentWorkspaces}
          onSelectWorkspace={selectWorkspace}
          onDeleteWorkspace={(ws) => void removeWorkspace(ws)}
          onPickWorkspace={() => void pickWorkspace()}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={isConversationRoute ? toggleSidebar : undefined}
          rightSidebarOpen={rightSidebarOpen}
          rightPanelMode={rightPanelMode}
          onToggleRightSidebar={toggleRightSidebar}
          onToggleRightPanelMode={toggleRightPanelMode}
        />
      }
      iconRail={<IconRail currentView={view} onSelectView={selectView} />}
      leftSidebar={
        <Sidebar
          collapsed={sidebarCollapsed}
          onCollapse={() => setSidebarCollapsed(true)}
          workspaceInput={workspaceInput}
          recentWorkspaces={recentWorkspaces}
          workspaceDropdownOpen={workspaceDropdownOpen}
          onToggleWorkspaceDropdown={toggleWorkspaceDropdown}
          onSelectWorkspace={selectWorkspace}
          onPickWorkspace={() => void pickWorkspace()}
          loading={loading}
          onRefreshDiscovery={() => void loadDiscovery(workspaceInput)}
          onStartNewTask={startNewTask}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onOpenSession={openSessionAndNavigate}
          onDeleteSession={(id) => void deleteSession(id)}
          onDeleteWorkspaceSessions={(ws) => void deleteWorkspaceSessions(ws)}
        />
      }
      main={renderMainView()}
      bottomDock={<WorkbenchComposer compact />}
      rightSidebar={
        <RightSidebar
          open={rightSidebarOpen}
          mode={rightPanelMode}
          onChangeMode={setRightPanelMode}
          agents={agents}
          selectedAgentId={selectedAgentId}
          onSelectAgent={selectAgent}
          workspaceCwd={workspaceInput || discovery?.cwd || ""}
        />
      }
    />
  );
}
