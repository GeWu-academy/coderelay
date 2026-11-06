import { beforeEach, describe, expect, it } from "bun:test";
import {
  getActiveSidebarRoute,
  isApiKeysRouteActive,
  isConfigRouteActive,
  isConversationRouteActive,
  isNewChatRouteActive,
  isSessionRouteActive,
  isSessionsRouteActive,
  isStatsRouteActive,
  useNavigationStore,
} from "./navigationStore";
import {
  CONVERSATION_VIEWS,
  isConversationView,
  isWorkspaceView,
  WORKSPACE_VIEWS,
} from "../types";

describe("useNavigationStore & sidebar activation state", () => {
  beforeEach(() => {
    // Reset store before each test
    useNavigationStore.setState({
      view: "workspace",
      activeSessionId: null,
      sidebarCollapsed: false,
      rightSidebarOpen: false,
      projectExpanded: true,
      workspaceDropdownOpen: false,
    });
  });

  it("maintains SSOT with WORKSPACE_VIEWS and validates views correctly", () => {
    expect(WORKSPACE_VIEWS).toEqual(["workspace", "sessions", "stats", "config", "apikeys"]);

    // Test valid views (non-empty real values)
    expect(isWorkspaceView("workspace")).toBe(true);
    expect(isWorkspaceView("sessions")).toBe(true);
    expect(isWorkspaceView("stats")).toBe(true);
    expect(isWorkspaceView("config")).toBe(true);
    expect(isWorkspaceView("apikeys")).toBe(true);

    // Test boundary / invalid values
    expect(isWorkspaceView("")).toBe(false);
    expect(isWorkspaceView("dashboard")).toBe(false);
    expect(isWorkspaceView(null)).toBe(false);
    expect(isWorkspaceView(undefined)).toBe(false);
    expect(isWorkspaceView(123)).toBe(false);
  });

  it("maintains SSOT with CONVERSATION_VIEWS and correctly identifies conversation routes", () => {
    expect(CONVERSATION_VIEWS).toEqual(["workspace"]);

    // Test valid conversation view
    expect(isConversationView("workspace")).toBe(true);
    expect(isConversationRouteActive("workspace")).toBe(true);

    // Test non-conversation views (valid workspace views but not conversation routes)
    expect(isConversationView("sessions")).toBe(false);
    expect(isConversationRouteActive("sessions")).toBe(false);
    expect(isConversationView("stats")).toBe(false);
    expect(isConversationRouteActive("stats")).toBe(false);
    expect(isConversationView("config")).toBe(false);
    expect(isConversationRouteActive("config")).toBe(false);
    expect(isConversationView("apikeys")).toBe(false);
    expect(isConversationRouteActive("apikeys")).toBe(false);

    // Test boundary / invalid values
    expect(isConversationView("")).toBe(false);
    expect(isConversationView("chat")).toBe(false);
    expect(isConversationView(null)).toBe(false);
    expect(isConversationView(undefined)).toBe(false);
    expect(isConversationView({})).toBe(false);
  });

  it("starts in new chat mode on workspace with no active session", () => {
    const state = useNavigationStore.getState();
    expect(state.view).toBe("workspace");
    expect(state.activeSessionId).toBeNull();

    expect(isNewChatRouteActive(state.view, state.activeSessionId)).toBe(true);
    expect(isSessionRouteActive(state.view, state.activeSessionId, "session-alpha-1")).toBe(false);
    expect(isSessionsRouteActive(state.view)).toBe(false);
    expect(isConfigRouteActive(state.view)).toBe(false);
    expect(getActiveSidebarRoute(state.view, state.activeSessionId)).toBe("new-chat");
  });

  it("correctly activates a session route when navigating to a session", () => {
    const { navigateToSession } = useNavigationStore.getState();
    const testSessionId = "sess-code-review-101";

    navigateToSession(testSessionId);

    const state = useNavigationStore.getState();
    expect(state.view).toBe("workspace");
    expect(state.activeSessionId).toBe(testSessionId);

    // New chat should no longer be active
    expect(isNewChatRouteActive(state.view, state.activeSessionId)).toBe(false);
    // The specific session should be active
    expect(isSessionRouteActive(state.view, state.activeSessionId, testSessionId)).toBe(true);
    // Other sessions should NOT be active
    expect(isSessionRouteActive(state.view, state.activeSessionId, "sess-unrelated-999")).toBe(false);
    expect(getActiveSidebarRoute(state.view, state.activeSessionId)).toBe(`session:${testSessionId}`);
  });

  it("fixes the bug: session does NOT remain active when navigating to config, sessions, or apikeys", () => {
    const { navigateToSession, navigateToConfig, navigateToSessions, navigateToStats, navigateToApiKeys } = useNavigationStore.getState();
    const testSessionId = "sess-debug-task-55";

    // 1. Open a session first
    navigateToSession(testSessionId);
    expect(isSessionRouteActive(useNavigationStore.getState().view, useNavigationStore.getState().activeSessionId, testSessionId)).toBe(true);

    // 2. Switch to config view
    navigateToConfig();
    const configState = useNavigationStore.getState();
    expect(configState.view).toBe("config");
    // BUG FIX: even if activeSessionId was set previously, session item in sidebar must NOT show as active!
    expect(isSessionRouteActive(configState.view, configState.activeSessionId, testSessionId)).toBe(false);
    expect(isNewChatRouteActive(configState.view, configState.activeSessionId)).toBe(false);
    expect(isConfigRouteActive(configState.view)).toBe(true);
    expect(isApiKeysRouteActive(configState.view)).toBe(false);
    expect(getActiveSidebarRoute(configState.view, configState.activeSessionId)).toBe("config");

    // 3. Switch to stats view
    navigateToStats();
    const statsState = useNavigationStore.getState();
    expect(statsState.view).toBe("stats");
    expect(isSessionRouteActive(statsState.view, statsState.activeSessionId, testSessionId)).toBe(false);
    expect(isNewChatRouteActive(statsState.view, statsState.activeSessionId)).toBe(false);
    expect(isStatsRouteActive(statsState.view)).toBe(true);
    expect(getActiveSidebarRoute(statsState.view, statsState.activeSessionId)).toBe("stats");

    // 4. Switch to sessions view
    navigateToSessions();
    const sessionsState = useNavigationStore.getState();
    expect(sessionsState.view).toBe("sessions");
    expect(isSessionRouteActive(sessionsState.view, sessionsState.activeSessionId, testSessionId)).toBe(false);
    expect(isNewChatRouteActive(sessionsState.view, sessionsState.activeSessionId)).toBe(false);
    expect(isSessionsRouteActive(sessionsState.view)).toBe(true);
    expect(isApiKeysRouteActive(sessionsState.view)).toBe(false);
    expect(getActiveSidebarRoute(sessionsState.view, sessionsState.activeSessionId)).toBe("sessions");

    // 4. Switch to apikeys view
    navigateToApiKeys();
    const apiKeysState = useNavigationStore.getState();
    expect(apiKeysState.view).toBe("apikeys");
    expect(isSessionRouteActive(apiKeysState.view, apiKeysState.activeSessionId, testSessionId)).toBe(false);
    expect(isNewChatRouteActive(apiKeysState.view, apiKeysState.activeSessionId)).toBe(false);
    expect(isConfigRouteActive(apiKeysState.view)).toBe(false);
    expect(isSessionsRouteActive(apiKeysState.view)).toBe(false);
    expect(isApiKeysRouteActive(apiKeysState.view)).toBe(true);
    expect(getActiveSidebarRoute(apiKeysState.view, apiKeysState.activeSessionId)).toBe("apikeys");
  });

  it("returns to new chat mode via navigateToNewChat", () => {
    const { navigateToSession, navigateToNewChat } = useNavigationStore.getState();
    navigateToSession("sess-existing-888");

    navigateToNewChat();

    const state = useNavigationStore.getState();
    expect(state.view).toBe("workspace");
    expect(state.activeSessionId).toBeNull();
    expect(isNewChatRouteActive(state.view, state.activeSessionId)).toBe(true);
    expect(isSessionRouteActive(state.view, state.activeSessionId, "sess-existing-888")).toBe(false);
  });

  it("toggles sidebar, right sidebar, project expanded, and workspace dropdown", () => {
    const store = useNavigationStore.getState();

    // Sidebar collapsed
    expect(store.sidebarCollapsed).toBe(false);
    store.toggleSidebar();
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(true);
    store.setSidebarCollapsed(false);
    expect(useNavigationStore.getState().sidebarCollapsed).toBe(false);

    // Right sidebar open
    expect(store.rightSidebarOpen).toBe(false);
    store.toggleRightSidebar();
    expect(useNavigationStore.getState().rightSidebarOpen).toBe(true);
    store.setRightSidebarOpen(false);
    expect(useNavigationStore.getState().rightSidebarOpen).toBe(false);

    // Project expanded
    expect(store.projectExpanded).toBe(true);
    store.toggleProjectExpanded();
    expect(useNavigationStore.getState().projectExpanded).toBe(false);
    store.setProjectExpanded(true);
    expect(useNavigationStore.getState().projectExpanded).toBe(true);

    // Workspace dropdown
    expect(store.workspaceDropdownOpen).toBe(false);
    store.toggleWorkspaceDropdown();
    expect(useNavigationStore.getState().workspaceDropdownOpen).toBe(true);
    store.setWorkspaceDropdownOpen(false);
    expect(useNavigationStore.getState().workspaceDropdownOpen).toBe(false);
  });
});
