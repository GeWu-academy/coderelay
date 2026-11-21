import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";

import { RunEvents } from "../runEvents";
import type {
  AgentEntry,
  AgentRunResult,
  DiscoveryPayload,
  RouteForm,
  RoutePreview,
  RunCompletedPayload,
  RunEventPayload,
  RuntimeStatus,
  SessionDetail,
  SessionRecord,
  SessionUpdatedPayload,
  StartRunResponse,
  WorkspaceView,
} from "../types";
import {
  eventActivity,
  getAvailableModelsForCli,
  loadPermission,
  mergeRecentWorkspaces,
  messageOf,
  resolveRouteSelection,
  sanitizePermission,
  savePermission,
} from "../utils";
import { useNavigationStore } from "./navigationStore";

const runEvents = new RunEvents();
let runListenersReady: Promise<void[]> | null = null;
let currentWorkspace = "";
let discoveryRequestId = 0;

export interface WorkbenchStoreState {
  discovery: DiscoveryPayload | null;
  runtime: RuntimeStatus | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  runId: string | null;
  output: string;
  activity: string[];
  result: AgentRunResult | null;
  preview: RoutePreview | null;
  recentWorkspaces: string[];
  sessions: SessionRecord[];
  sessionDetail: SessionDetail | null;
  workspaceInput: string;
  form: RouteForm;

  setPrompt: (prompt: string) => void;
  setMode: (mode: string) => void;
  setAgentModel: (agentId: string, modelId: string) => void;
  setPermission: (permission: string) => void;
  selectAgent: (agent: AgentEntry) => void;
  refreshRecentWorkspaces: () => Promise<void>;
  refreshSessions: () => Promise<SessionRecord[]>;
  loadDiscovery: (cwd?: string) => Promise<void>;
  openSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteWorkspaceSessions: (workspace: string | null) => Promise<void>;
  removeWorkspace: (workspace: string) => Promise<void>;
  startNewTask: () => void;
  selectView: (nextView: WorkspaceView) => void;
  selectWorkspace: (ws: string) => void;
  pickWorkspace: () => Promise<void>;
  openSessionAndNavigate: (sessionId: string) => void;
  continueSession: () => void;
  previewRoute: () => Promise<void>;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;
  subscribeRunEvents: () => () => void;
}

const INITIAL_FORM: RouteForm = {
  prompt: "",
  mode: "local",
  agent: "",
  model: "",
  permission: "",
};

function syncPermissionForForm(workspace: string, form: RouteForm): RouteForm {
  const permission = loadPermission(workspace.trim(), form.agent);
  return form.permission === permission ? form : { ...form, permission };
}

function switchWorkspaceOptimistically(
  ws: string,
  set: (partial: Partial<WorkbenchStoreState> | ((s: WorkbenchStoreState) => Partial<WorkbenchStoreState>)) => void,
  loadDiscovery: (cwd?: string) => Promise<void>,
): void {
  const target = ws.trim();
  useNavigationStore.getState().setWorkspaceDropdownOpen(false);
  if (!target || target === currentWorkspace.trim()) {
    return;
  }
  currentWorkspace = target;
  set((current) => ({
    workspaceInput: target,
    form: syncPermissionForForm(target, current.form),
    recentWorkspaces: mergeRecentWorkspaces(target, current.recentWorkspaces),
    sessionDetail: null,
    error: null,
  }));
  void loadDiscovery(target);
}

export const useWorkbenchStore = create<WorkbenchStoreState>((set, get) => ({
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
  recentWorkspaces: [],
  sessions: [],
  sessionDetail: null,
  workspaceInput: "",
  form: INITIAL_FORM,

  setPrompt: (prompt) =>
    set((current) => ({ form: { ...current.form, prompt } })),

  setMode: (mode) =>
    set((current) => ({ form: { ...current.form, mode } })),

  setAgentModel: (agentId, modelId) =>
    set((current) => ({
      form: syncPermissionForForm(current.workspaceInput, {
        ...current.form,
        agent: agentId,
        model: modelId,
      }),
    })),

  setPermission: (permission) =>
    set((current) => {
      savePermission(current.workspaceInput.trim(), current.form.agent, permission);
      return { form: { ...current.form, permission } };
    }),

  selectAgent: (agent) =>
    set((current) => {
      const nextModels = getAvailableModelsForCli(
        current.discovery?.catalog.options ?? [],
        agent.id,
      );
      return {
        form: syncPermissionForForm(current.workspaceInput, {
          ...current.form,
          agent: agent.id,
          model: nextModels[0]?.modelId ?? "",
        }),
      };
    }),

  refreshRecentWorkspaces: async () => {
    const recentWorkspaces = await invoke<string[]>("list_recent_workspaces", {
      limit: 8,
    });
    set({
      recentWorkspaces: mergeRecentWorkspaces(currentWorkspace, recentWorkspaces),
    });
  },

  refreshSessions: async () => {
    const sessions = await invoke<SessionRecord[]>("list_sessions", {
      request: {
        workspace: null,
        limit: 200,
      },
    });
    set({ sessions });
    return sessions;
  },

  loadDiscovery: async (cwd) => {
    const requestId = ++discoveryRequestId;
    set({ loading: true, error: null });
    try {
      const existingRuntime = get().runtime;
      const [runtime, discovery, sessions] = await Promise.all([
        existingRuntime
          ? Promise.resolve(existingRuntime)
          : invoke<RuntimeStatus>("runtime_status"),
        invoke<DiscoveryPayload>("discover", {
          request: {
            cwd: cwd?.trim() || null,
            configPath: null,
          },
        }),
        invoke<SessionRecord[]>("list_sessions", {
          request: {
            workspace: null,
            limit: 200,
          },
        }),
      ]);
      if (requestId !== discoveryRequestId) {
        return;
      }
      currentWorkspace = discovery.cwd;
      set((current) => {
        const resolved = resolveRouteSelection(
          current.form,
          discovery.routingModes,
          discovery.agents,
          discovery.catalog.options,
        );
        const nextForm = syncPermissionForForm(discovery.cwd, {
          ...current.form,
          mode: resolved.mode,
          agent: resolved.agent,
          model: resolved.model,
        });
        return {
          workspaceInput: discovery.cwd,
          form: nextForm,
          runtime,
          discovery,
          sessions,
          recentWorkspaces: mergeRecentWorkspaces(
            discovery.cwd,
            discovery.recentWorkspaces,
          ),
          sessionDetail: null,
          loading: false,
          error: null,
        };
      });
    } catch (error) {
      if (requestId !== discoveryRequestId) {
        return;
      }
      set({
        loading: false,
        error: messageOf(error),
      });
    }
  },

  openSession: async (sessionId) => {
    try {
      const detail = await invoke<SessionDetail>("get_session", { sessionId });
      const navigation = useNavigationStore.getState();
      if (
        navigation.view !== "workspace" ||
        navigation.activeSessionId !== sessionId
      ) {
        return;
      }
      navigation.setActiveSessionId(sessionId);
      set({
        sessionDetail: detail,
        error: null,
      });
    } catch (error) {
      const navigation = useNavigationStore.getState();
      if (
        navigation.view !== "workspace" ||
        navigation.activeSessionId !== sessionId
      ) {
        return;
      }
      set({ error: messageOf(error) });
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await invoke<boolean>("delete_session", { sessionId });
      if (useNavigationStore.getState().activeSessionId === sessionId) {
        get().startNewTask();
      }
      await get().refreshSessions();
      await get().refreshRecentWorkspaces();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  deleteWorkspaceSessions: async (workspace) => {
    try {
      await invoke<number>("delete_workspace_sessions", { request: { workspace } });
      const remaining = await get().refreshSessions();
      const activeSessionId = useNavigationStore.getState().activeSessionId;
      if (activeSessionId && !remaining.some((session) => session.id === activeSessionId)) {
        get().startNewTask();
      }
      await get().refreshRecentWorkspaces();
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  removeWorkspace: async (workspace) => {
    const trimmed = workspace.trim();
    if (!trimmed) {
      return;
    }
    const wasCurrent = currentWorkspace === trimmed;
    if (wasCurrent) {
      currentWorkspace = "";
      set((current) => ({
        workspaceInput: "",
        form: syncPermissionForForm("", current.form),
      }));
    }
    try {
      await invoke<boolean>("delete_workspace", { request: { workspace: trimmed } });
      const remainingSessions = await get().refreshSessions();
      const activeSessionId = useNavigationStore.getState().activeSessionId;
      if (activeSessionId && !remainingSessions.some((session) => session.id === activeSessionId)) {
        get().startNewTask();
      }
      const fetchedRecent = await invoke<string[]>("list_recent_workspaces", {
        limit: 8,
      });
      const nextRecent = mergeRecentWorkspaces(
        currentWorkspace,
        fetchedRecent.filter((item) => item !== trimmed),
      );
      set({ recentWorkspaces: nextRecent });
      if (wasCurrent && nextRecent[0]) {
        get().selectWorkspace(nextRecent[0]);
      }
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  startNewTask: () => {
    useNavigationStore.getState().navigateToNewChat();
    set((current) => ({
      form: { ...current.form, prompt: "" },
      sessionDetail: null,
      output: "",
      activity: [],
      result: null,
      preview: null,
      error: null,
    }));
  },

  selectView: (nextView) => {
    useNavigationStore.getState().setView(nextView);
    if (nextView === "sessions" || nextView === "stats") {
      void get().refreshSessions();
    }
  },

  selectWorkspace: (ws) => {
    switchWorkspaceOptimistically(ws, set, get().loadDiscovery);
  },

  pickWorkspace: async () => {
    try {
      const selected = await invoke<string | null>("pick_workspace", {
        initialDir: currentWorkspace || get().workspaceInput.trim() || null,
      });
      if (selected) {
        switchWorkspaceOptimistically(selected, set, get().loadDiscovery);
      }
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  openSessionAndNavigate: (sessionId) => {
    useNavigationStore.getState().navigateToSession(sessionId);
    void get().openSession(sessionId);
  },

  continueSession: () => {
    useNavigationStore.getState().setView("workspace");
    set((current) => ({
      form: { ...current.form, prompt: "" },
    }));
  },

  previewRoute: async () => {
    const { form, workspaceInput } = get();
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
      set({ preview, error: null });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  startRun: async () => {
    const { form, workspaceInput, discovery } = get();
    const prompt = form.prompt.trim();
    const ready = runListenersReady;
    if (!prompt || !ready || !runEvents.begin()) {
      return;
    }
    set((current) => ({ form: { ...current.form, prompt: "" } }));
    try {
      await ready;
      if (runListenersReady !== ready) {
        runEvents.reset();
        return;
      }
      const activeSessionId = useNavigationStore.getState().activeSessionId;
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
      useNavigationStore.getState().setActiveSessionId(response.sessionId);
      set({
        running: true,
        runId: response.runId,
        output: "",
        activity: [],
        result: null,
        preview: {
          agent: response.agent,
          model: response.model,
          reasons: response.reasons,
        },
        error: null,
      });
      runEvents.activate(response.runId);
    } catch (error) {
      runEvents.reset();
      set({ error: messageOf(error) });
    }
  },

  cancelRun: async () => {
    const { runId } = get();
    if (!runId) {
      return;
    }
    try {
      await invoke<boolean>("cancel_run", { runId });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  subscribeRunEvents: () => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    function track(unlisten: UnlistenFn): void {
      if (disposed) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    }

    function reportListenerError(error: unknown): void {
      if (!disposed) {
        set({ error: messageOf(error) });
      }
    }

    const ready = Promise.all([
      listen<RunEventPayload>("run-event", ({ payload }) => {
        runEvents.dispatch(payload.runId, () => {
          set((current) => {
            const nextActivity = eventActivity(payload.event);
            return {
              output:
                payload.event.kind === "assistant_text"
                  ? current.output + (payload.event.text ?? "")
                  : current.output,
              activity: nextActivity
                ? [...current.activity.slice(-99), nextActivity]
                : current.activity,
            };
          });
        });
      }).then(track),
      listen<RunCompletedPayload>("run-completed", ({ payload }) => {
        runEvents.dispatch(payload.runId, () => {
          runEvents.reset();
          useNavigationStore.getState().setActiveSessionId(payload.sessionId);
          set((current) => ({
            running: false,
            runId: null,
            result: payload.result,
            output: payload.result.text || current.output,
          }));
          void get().refreshSessions();
        });
      }).then(track),
    ]);

    runListenersReady = ready;
    void ready.catch(reportListenerError);
    void listen<SessionUpdatedPayload>("session-updated", () => {
      void get().refreshSessions();
      void get().refreshRecentWorkspaces();
    })
      .then(track)
      .catch(reportListenerError);

    return () => {
      disposed = true;
      runListenersReady = null;
      unlisteners.forEach((unlisten) => unlisten());
    };
  },
}));
