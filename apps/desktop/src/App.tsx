import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ApiKeyView } from "./components/ApiKeyView";
import { Composer } from "./components/Composer";
import { ConfigView } from "./components/ConfigView";
import { IconRail } from "./components/IconRail";
import { RightSidebar } from "./components/RightSidebar";
import { SessionsView } from "./components/SessionsView";
import { Sidebar } from "./components/Sidebar";
import { StatsView } from "./components/StatsView";
import { Titlebar } from "./components/Titlebar";
import { WorkspaceView } from "./components/WorkspaceView";
import { isConversationRouteActive, useNavigationStore } from "./stores/navigationStore";
import { useThemeStore } from "./stores/themeStore";
import type {
  AgentEntry,
  ConfigSource,
  DiscoveryPayload,
  JevSettings,
  RouteForm,
  RoutePreview,
  RunCompletedPayload,
  RunEventPayload,
  RuntimeStatus,
  SessionDetail,
  SessionRecord,
  SessionUpdatedPayload,
  StartRunResponse,
  WorkbenchState,
  WorkspaceView as WorkspaceViewType,
} from "./types";
import {
  eventActivity,
  getAvailableModelsForCli,
  loadPermission,
  mergeRecentWorkspaces,
  messageOf,
  resolveRouteSelection,
  sanitizePermission,
  savePermission,
} from "./utils";

const INITIAL_STATE: WorkbenchState = {
  discovery: null,
  runtime: null,
  loading: true,
  error: null,
  running: false,
  runId: null,
  output: "",
  activity: [],
  result: null,
  preview: null,
  view: "workspace",
  recentWorkspaces: [],
  sessions: [],
  sessionDetail: null,
  activeSessionId: null,
  configSource: null,
  configDraft: "",
  configBusy: false,
  jevSettings: null,
  jevApiKeyInput: "",
  jevBusy: false,
  configNotice: null,
};

export function App() {
  const [state, setState] = useState<WorkbenchState>(INITIAL_STATE);
  const [form, setForm] = useState<RouteForm>({
    prompt: "",
    mode: "local",
    agent: "",
    model: "",
    permission: "",
  });
  const [workspaceInput, setWorkspaceInput] = useState("");

  // Restore the remembered permission whenever the workspace or CLI changes.
  useEffect(() => {
    const permission = loadPermission(workspaceInput.trim(), form.agent);
    setForm((current) =>
      current.permission === permission ? current : { ...current, permission },
    );
  }, [workspaceInput, form.agent]);

  const activeRunId = useRef<string | null>(null);
  const currentWorkspace = useRef("");

  // Navigation store
  const view = useNavigationStore((s) => s.view);
  const setView = useNavigationStore((s) => s.setView);
  const activeSessionId = useNavigationStore((s) => s.activeSessionId);
  const setActiveSessionId = useNavigationStore((s) => s.setActiveSessionId);
  const sidebarCollapsed = useNavigationStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useNavigationStore((s) => s.toggleSidebar);
  const rightSidebarOpen = useNavigationStore((s) => s.rightSidebarOpen);
  const toggleRightSidebar = useNavigationStore((s) => s.toggleRightSidebar);
  const workspaceDropdownOpen = useNavigationStore((s) => s.workspaceDropdownOpen);
  const setWorkspaceDropdownOpen = useNavigationStore((s) => s.setWorkspaceDropdownOpen);
  const toggleWorkspaceDropdown = useNavigationStore((s) => s.toggleWorkspaceDropdown);
  const navigateToNewChat = useNavigationStore((s) => s.navigateToNewChat);
  const navigateToSession = useNavigationStore((s) => s.navigateToSession);
  const navigateToConfig = useNavigationStore((s) => s.navigateToConfig);
  const navigateToApiKeys = useNavigationStore((s) => s.navigateToApiKeys);

  const customBackground = useThemeStore((s) => s.customBackground);
  const customBackgroundOpacity = useThemeStore((s) => s.customBackgroundOpacity);

  const isConversationRoute = isConversationRouteActive(view);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        if (isConversationRouteActive(view)) {
          toggleSidebar();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar, view]);

  async function refreshRecentWorkspaces(): Promise<void> {
    const recentWorkspaces = await invoke<string[]>("list_recent_workspaces", {
      limit: 8,
    });
    setState((current) => ({
      ...current,
      recentWorkspaces: mergeRecentWorkspaces(
        currentWorkspace.current,
        recentWorkspaces,
        current.recentWorkspaces,
      ),
    }));
  }

  async function refreshSessions(cwd: string): Promise<SessionRecord[]> {
    const sessions = await invoke<SessionRecord[]>("list_sessions", {
      request: {
        workspace: null,
        limit: 200,
      },
    });
    setState((current) => ({ ...current, sessions }));
    return sessions;
  }

  async function loadDiscovery(cwd?: string): Promise<void> {
    setState((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const [runtime, discovery] = await Promise.all([
        invoke<RuntimeStatus>("runtime_status"),
        invoke<DiscoveryPayload>("discover", {
          request: {
            cwd: cwd?.trim() || null,
            configPath: null,
          },
        }),
      ]);
      currentWorkspace.current = discovery.cwd;
      setWorkspaceInput(discovery.cwd);
      setForm((current) => {
        const resolved = resolveRouteSelection(
          current,
          discovery.routingModes,
          discovery.agents,
          discovery.catalog.options,
        );
        return {
          ...current,
          mode: resolved.mode,
          agent: resolved.agent,
          model: resolved.model,
        };
      });
      const sessions = await invoke<SessionRecord[]>("list_sessions", {
        request: {
          workspace: null,
          limit: 200,
        },
      });
      setState((current) => ({
        ...current,
        runtime,
        discovery,
        sessions,
        recentWorkspaces: mergeRecentWorkspaces(
          discovery.cwd,
          discovery.recentWorkspaces,
          current.recentWorkspaces,
        ),
        sessionDetail: null,
        activeSessionId: null,
        loading: false,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: messageOf(error),
      }));
    }
  }

  async function handleDeleteSession(sessionId: string): Promise<void> {
    try {
      await invoke<boolean>("delete_session", { sessionId });
      if (activeSessionId === sessionId) {
        startNewTask();
      }
      await refreshSessions(currentWorkspace.current);
      await refreshRecentWorkspaces();
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  async function handleDeleteWorkspaceSessions(workspace: string | null): Promise<void> {
    try {
      await invoke<number>("delete_workspace_sessions", { request: { workspace } });
      const remaining = await refreshSessions(currentWorkspace.current);
      if (activeSessionId && !remaining.some((session) => session.id === activeSessionId)) {
        startNewTask();
      }
      await refreshRecentWorkspaces();
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  async function openSession(sessionId: string): Promise<void> {
    try {
      const detail = await invoke<SessionDetail>("get_session", { sessionId });
      setActiveSessionId(sessionId);
      setState((current) => ({
        ...current,
        sessionDetail: detail,
        activeSessionId: sessionId,
        error: null,
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  async function loadJevSettings(): Promise<void> {
    try {
      const settings = await invoke<JevSettings>("get_jev_settings");
      setState((current) => ({
        ...current,
        jevSettings: settings,
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  async function saveJevApiKey(): Promise<void> {
    const apiKey = state.jevApiKeyInput.trim();
    if (!apiKey) {
      return;
    }
    setState((current) => ({
      ...current,
      jevBusy: true,
      error: null,
      configNotice: null,
    }));
    try {
      const settings = await invoke<JevSettings>("save_jev_api_key", { apiKey });
      setState((current) => ({
        ...current,
        jevSettings: settings,
        jevApiKeyInput: "",
        jevBusy: false,
        configNotice: "API Key 已保存到本地 SQLite。",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        jevBusy: false,
        error: messageOf(error),
      }));
    }
  }

  async function clearJevApiKey(): Promise<void> {
    setState((current) => ({
      ...current,
      jevBusy: true,
      error: null,
      configNotice: null,
    }));
    try {
      const settings = await invoke<JevSettings>("clear_jev_api_key");
      setState((current) => ({
        ...current,
        jevSettings: settings,
        jevApiKeyInput: "",
        jevBusy: false,
        configNotice: "已从本地 SQLite 清除 API Key。",
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        jevBusy: false,
        error: messageOf(error),
      }));
    }
  }

  async function loadConfigSource(): Promise<void> {
    setState((current) => ({ ...current, configBusy: true, error: null }));
    try {
      const source = await invoke<ConfigSource>("read_config_source", {
        request: {
          cwd: workspaceInput.trim() || null,
          configPath: null,
        },
      });
      setState((current) => ({
        ...current,
        configSource: source,
        configDraft: source.raw,
        configBusy: false,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        configBusy: false,
        error: messageOf(error),
      }));
    }
  }

  async function saveConfig(): Promise<void> {
    setState((current) => ({ ...current, configBusy: true, error: null }));
    try {
      const path = await invoke<string>("save_config", {
        request: {
          workspace: {
            cwd: workspaceInput.trim() || null,
            configPath: null,
          },
          raw: state.configDraft,
        },
      });
      setState((current) => ({
        ...current,
        configBusy: false,
        configSource: current.configSource
          ? { ...current.configSource, path, exists: true, raw: current.configDraft }
          : { path, exists: true, raw: current.configDraft },
      }));
      await loadDiscovery(workspaceInput);
      setView("config");
      setState((current) => ({ ...current, view: "config" }));
    } catch (error) {
      setState((current) => ({
        ...current,
        configBusy: false,
        error: messageOf(error),
      }));
    }
  }

  function startNewTask(): void {
    setForm((current) => ({ ...current, prompt: "" }));
    navigateToNewChat();
    setState((current) => ({
      ...current,
      view: "workspace",
      activeSessionId: null,
      sessionDetail: null,
      output: "",
      activity: [],
      result: null,
      preview: null,
      error: null,
    }));
  }

  useEffect(() => {
    void loadDiscovery();
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    void Promise.all([
      listen<RunEventPayload>("run-event", ({ payload }) => {
        if (payload.runId !== activeRunId.current) {
          return;
        }
        setState((current) => {
          const nextActivity = eventActivity(payload.event);
          return {
            ...current,
            output:
              payload.event.kind === "assistant_text"
                ? current.output + (payload.event.text ?? "")
                : current.output,
            activity: nextActivity
              ? [...current.activity.slice(-99), nextActivity]
              : current.activity,
          };
        });
      }),
      listen<RunCompletedPayload>("run-completed", ({ payload }) => {
        if (payload.runId !== activeRunId.current) {
          return;
        }
        activeRunId.current = null;
        setActiveSessionId(payload.sessionId);
        setState((current) => ({
          ...current,
          running: false,
          runId: null,
          activeSessionId: payload.sessionId,
          result: payload.result,
          output: payload.result.text || current.output,
        }));
        void refreshSessions(currentWorkspace.current);
      }),
      listen<SessionUpdatedPayload>("session-updated", () => {
        void refreshSessions(currentWorkspace.current);
        void refreshRecentWorkspaces();
      }),
    ]).then((registered) => {
      if (disposed) {
        registered.forEach((unlisten) => unlisten());
      } else {
        unlisteners.push(...registered);
      }
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [setActiveSessionId]);

  const discovery = state.discovery;
  const agents = discovery?.agents ?? [];
  const selectedAgent = agents.find((agent) => agent.id === form.agent);

  async function previewRoute(): Promise<void> {
    const prompt = form.prompt.trim();
    if (!prompt) {
      return;
    }
    try {
      const preview = await invoke<RoutePreview>("route_preview", {
        request: {
          workspace: {
            cwd: workspaceInput.trim() || null,
            configPath: null,
          },
          request: { prompt },
          mode: form.mode,
          agent: form.agent || null,
          model: form.model || null,
        },
      });
      setState((current) => ({ ...current, preview, error: null }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  async function startRun(): Promise<void> {
    const prompt = form.prompt.trim();
    if (!prompt || state.running) {
      return;
    }
    try {
      const response = await invoke<StartRunResponse>("start_run", {
        request: {
          workspace: {
            cwd: workspaceInput.trim() || null,
            configPath: null,
          },
          request: { prompt },
          mode: form.mode,
          agent: form.agent || null,
          model: form.model || null,
          permission:
            sanitizePermission(
              form.permission,
              discovery?.permissions.find((item) => item.cliId === form.agent)
                ?.options ?? [],
            ) || null,
          timeoutMs: null,
          sessionId: activeSessionId,
        },
      });
      activeRunId.current = response.runId;
      setActiveSessionId(response.sessionId);
      setState((current) => ({
        ...current,
        running: true,
        runId: response.runId,
        activeSessionId: response.sessionId,
        output: "",
        activity: [],
        result: null,
        preview: {
          agent: response.agent,
          model: response.model,
          reasons: response.reasons,
        },
        error: null,
      }));
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  async function cancelRun(): Promise<void> {
    if (!state.runId) {
      return;
    }
    try {
      await invoke<boolean>("cancel_run", { runId: state.runId });
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  function selectAgent(agent: AgentEntry): void {
    const nextModels = getAvailableModelsForCli(
      discovery?.catalog.options ?? [],
      agent.id,
    );
    setForm((current) => ({
      ...current,
      agent: agent.id,
      model: nextModels[0]?.modelId ?? "",
    }));
  }

  function handleSelectView(nextView: WorkspaceViewType): void {
    setView(nextView);
    setState((current) => ({ ...current, view: nextView }));
    if (nextView === "sessions" || nextView === "stats") {
      void refreshSessions(currentWorkspace.current);
    } else if (nextView === "config") {
      void loadConfigSource();
    } else if (nextView === "apikeys") {
      void loadJevSettings();
    }
  }

  function handleSelectWorkspace(ws: string): void {
    setWorkspaceDropdownOpen(false);
    void loadDiscovery(ws);
  }

  async function handlePickWorkspace(): Promise<void> {
    try {
      const selected = await invoke<string | null>("pick_workspace", {
        initialDir: currentWorkspace.current || workspaceInput.trim() || null,
      });
      if (selected) {
        setWorkspaceDropdownOpen(false);
        await loadDiscovery(selected);
      }
    } catch (error) {
      setState((current) => ({ ...current, error: messageOf(error) }));
    }
  }

  function handleOpenSession(sessionId: string): void {
    navigateToSession(sessionId);
    setState((current) => ({ ...current, view: "workspace" }));
    void openSession(sessionId);
  }

  function handleContinueSession(): void {
    setView("workspace");
    setState((current) => ({ ...current, view: "workspace" }));
    setForm((current) => ({ ...current, prompt: "" }));
  }

  const showThread = Boolean(
    state.preview || state.output || state.activity.length > 0 || state.result || state.running,
  );

  function renderComposer(compact = false): ReactNode {
    return (
      <Composer
        compact={compact}
        prompt={form.prompt}
        onPromptChange={(val) => setForm((c) => ({ ...c, prompt: val }))}
        running={state.running}
        onStartRun={() => void startRun()}
        onCancelRun={() => void cancelRun()}
        workspaceInput={workspaceInput}
        onPickWorkspace={() => void handlePickWorkspace()}
        mode={form.mode}
        routingModes={discovery?.routingModes ?? ["local"]}
        onModeChange={(nextMode) => setForm((c) => ({ ...c, mode: nextMode }))}
        onPreviewRoute={() => void previewRoute()}
        agent={form.agent}
        model={form.model}
        onAgentModelChange={(agentId, modelId) =>
          setForm((c) => ({
            ...c,
            agent: agentId,
            model: modelId,
          }))
        }
        permission={form.permission}
        permissions={discovery?.permissions ?? []}
        onPermissionChange={(permission) => {
          savePermission(workspaceInput.trim(), form.agent, permission);
          setForm((c) => ({ ...c, permission }));
        }}
        agents={agents}
        catalogOptions={discovery?.catalog.options ?? []}
        selectedAgentLabel={selectedAgent?.label}
      />
    );
  }

  return (
    <div className="relative flex h-dvh min-h-[600px] flex-col overflow-hidden bg-canvas">
      {customBackground ? (
        <div
          data-testid="custom-background-layer"
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center bg-no-repeat transition-opacity duration-300"
          style={{
            backgroundImage: `url(${customBackground})`,
            opacity: customBackgroundOpacity,
          }}
        />
      ) : null}
      <Titlebar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={isConversationRoute ? toggleSidebar : undefined}
        rightSidebarOpen={rightSidebarOpen}
        onToggleRightSidebar={toggleRightSidebar}
      />

      <div
        className="flex min-h-0 flex-1 overflow-hidden bg-canvas"
        data-sidebar-collapsed={!isConversationRoute || sidebarCollapsed}
        data-right-sidebar-open={rightSidebarOpen}
      >
        <IconRail
          currentView={view}
          onSelectView={handleSelectView}
        />

        {isConversationRoute ? (
          <Sidebar
            collapsed={sidebarCollapsed}
            workspaceInput={workspaceInput}
            recentWorkspaces={state.recentWorkspaces}
            workspaceDropdownOpen={workspaceDropdownOpen}
            onToggleWorkspaceDropdown={toggleWorkspaceDropdown}
            onSelectWorkspace={handleSelectWorkspace}
            onPickWorkspace={() => void handlePickWorkspace()}
            loading={state.loading}
            onRefreshDiscovery={() => void loadDiscovery(workspaceInput)}
            onStartNewTask={startNewTask}
            sessions={state.sessions}
            activeSessionId={activeSessionId}
            onOpenSession={handleOpenSession}
            onDeleteSession={(id) => void handleDeleteSession(id)}
            onDeleteWorkspaceSessions={(ws) => void handleDeleteWorkspaceSessions(ws)}
          />
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas" data-view={view}>
          <AnimatePresence mode="wait">
            {view === "workspace" ? (
              <WorkspaceView
                key="workspace"
                error={state.error}
                showThread={showThread}
                running={state.running}
                result={state.result}
                preview={state.preview}
                output={state.output}
                activity={state.activity}
                renderComposer={renderComposer}
              />
            ) : view === "sessions" ? (
              <SessionsView
                key="sessions"
                workspaceInput={workspaceInput}
                sessions={state.sessions}
                activeSessionId={activeSessionId}
                sessionDetail={state.sessionDetail}
                onRefreshSessions={() => void refreshSessions(currentWorkspace.current)}
                onOpenSession={handleOpenSession}
                onContinueSession={handleContinueSession}
              />
            ) : view === "stats" ? (
              <StatsView
                key="stats"
                workspaceInput={workspaceInput}
                sessions={state.sessions}
                agents={agents}
                catalogOptions={discovery?.catalog.options ?? []}
                onRefreshSessions={() => void refreshSessions(currentWorkspace.current)}
                onOpenSession={handleOpenSession}
                loadSessionTurns={async (sessionId) => {
                  const detail = await invoke<SessionDetail>("get_session", { sessionId });
                  return detail.turns;
                }}
              />
            ) : view === "apikeys" ? (
              <ApiKeyView
                key="apikeys"
                jevBusy={state.jevBusy}
                jevSettings={state.jevSettings}
                jevApiKeyInput={state.jevApiKeyInput}
                notice={state.configNotice}
                onJevApiKeyInputChange={(val) =>
                  setState((current) => ({ ...current, jevApiKeyInput: val }))
                }
                onSaveJevApiKey={() => void saveJevApiKey()}
                onClearJevApiKey={() => void clearJevApiKey()}
              />
            ) : (
              <ConfigView
                key="config"
                configPath={state.configSource?.path}
                configBusy={state.configBusy}
                configDraft={state.configDraft}
                onConfigDraftChange={(val) =>
                  setState((current) => ({ ...current, configDraft: val }))
                }
                onLoadConfigSource={() => void loadConfigSource()}
                onSaveConfig={() => void saveConfig()}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {view === "workspace" && showThread ? (
              <motion.div
                key="composer-dock"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                className="relative z-5 shrink-0 bg-[linear-gradient(180deg,transparent_0%,var(--color-canvas)_28%)] px-8 pt-2.5 pb-[18px]"
              >
                {renderComposer(true)}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </main>

        <RightSidebar
          open={rightSidebarOpen}
          agents={agents}
          selectedAgentId={form.agent}
          onSelectAgent={selectAgent}
        />
      </div>
    </div>
  );
}
