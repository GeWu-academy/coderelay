import { create } from "zustand";
import { isConversationView, WORKSPACE_VIEWS, type WorkspaceView } from "../types";

export type SidebarRouteId =
  | "new-chat"
  | `session:${string}`
  | "sessions"
  | "stats"
  | "config"
  | "apikeys";

export interface NavigationState {
  view: WorkspaceView;
  activeSessionId: string | null;
  sidebarCollapsed: boolean;
  rightSidebarOpen: boolean;
  projectExpanded: boolean;
  workspaceDropdownOpen: boolean;

  // Actions
  setView: (view: WorkspaceView) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  navigateToNewChat: () => void;
  navigateToSession: (sessionId: string) => void;
  navigateToSessions: () => void;
  navigateToStats: () => void;
  navigateToConfig: () => void;
  navigateToApiKeys: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleRightSidebar: () => void;
  setRightSidebarOpen: (open: boolean) => void;
  toggleProjectExpanded: () => void;
  setProjectExpanded: (expanded: boolean) => void;
  toggleWorkspaceDropdown: () => void;
  setWorkspaceDropdownOpen: (open: boolean) => void;
}

export function getActiveSidebarRoute(
  view: WorkspaceView,
  activeSessionId: string | null,
): SidebarRouteId {
  if (view === "workspace") {
    return activeSessionId ? `session:${activeSessionId}` : "new-chat";
  }
  if (view === "sessions") {
    return "sessions";
  }
  if (view === "stats") {
    return "stats";
  }
  if (view === "apikeys") {
    return "apikeys";
  }
  return "config";
}

export function isSessionRouteActive(
  view: WorkspaceView,
  activeSessionId: string | null,
  sessionId: string,
): boolean {
  return view === "workspace" && activeSessionId === sessionId;
}

export function isNewChatRouteActive(
  view: WorkspaceView,
  activeSessionId: string | null,
): boolean {
  return view === "workspace" && activeSessionId === null;
}

export function isSessionsRouteActive(view: WorkspaceView): boolean {
  return view === "sessions";
}

export function isStatsRouteActive(view: WorkspaceView): boolean {
  return view === "stats";
}

export function isConfigRouteActive(view: WorkspaceView): boolean {
  return view === "config";
}

export function isApiKeysRouteActive(view: WorkspaceView): boolean {
  return view === "apikeys";
}

export function isConversationRouteActive(view: WorkspaceView): boolean {
  return isConversationView(view);
}

function getInitialSidebarCollapsed(): boolean {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }
  try {
    return localStorage.getItem("coderelay_sidebar_collapsed") === "true";
  } catch {
    return false;
  }
}

function persistSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    localStorage.setItem("coderelay_sidebar_collapsed", String(collapsed));
  } catch {
    // ignore
  }
}

export const useNavigationStore = create<NavigationState>((set) => ({
  view: "workspace",
  activeSessionId: null,
  sidebarCollapsed: getInitialSidebarCollapsed(),
  rightSidebarOpen: false,
  projectExpanded: true,
  workspaceDropdownOpen: false,

  setView: (view) => set({ view }),
  setActiveSessionId: (activeSessionId) => set({ activeSessionId }),

  navigateToNewChat: () =>
    set({
      view: "workspace",
      activeSessionId: null,
    }),

  navigateToSession: (sessionId: string) =>
    set({
      view: "workspace",
      activeSessionId: sessionId,
    }),

  navigateToSessions: () =>
    set({
      view: "sessions",
    }),

  navigateToStats: () =>
    set({
      view: "stats",
    }),

  navigateToConfig: () =>
    set({
      view: "config",
    }),

  navigateToApiKeys: () =>
    set({
      view: "apikeys",
    }),

  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      persistSidebarCollapsed(next);
      return { sidebarCollapsed: next };
    }),

  setSidebarCollapsed: (collapsed: boolean) => {
    persistSidebarCollapsed(collapsed);
    set({ sidebarCollapsed: collapsed });
  },

  toggleRightSidebar: () =>
    set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),

  setRightSidebarOpen: (open: boolean) => set({ rightSidebarOpen: open }),

  toggleProjectExpanded: () =>
    set((state) => ({ projectExpanded: !state.projectExpanded })),

  setProjectExpanded: (expanded: boolean) => set({ projectExpanded: expanded }),

  toggleWorkspaceDropdown: () =>
    set((state) => ({ workspaceDropdownOpen: !state.workspaceDropdownOpen })),

  setWorkspaceDropdownOpen: (open: boolean) =>
    set({ workspaceDropdownOpen: open }),
}));
