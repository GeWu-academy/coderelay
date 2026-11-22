import { LayoutGroup } from "motion/react";
import { useState } from "react";

import {
  isNewChatRouteActive,
  isSessionRouteActive,
  useNavigationStore,
} from "../../stores/navigationStore";
import type { SessionRecord } from "../../types";
import { LiquidRouteIndicator } from "../common/LiquidRouteIndicator";
import { PanelLeftIcon, PlusIcon, RefreshIcon, TrashIcon } from "../icons";
import { WorkspaceDropdown } from "./WorkspaceDropdown";

export interface SidebarProps {
  collapsed?: boolean;
  onCollapse?: () => void;
  workspaceInput: string;
  recentWorkspaces: string[];
  workspaceDropdownOpen?: boolean;
  onToggleWorkspaceDropdown?: () => void;
  onSelectWorkspace: (workspace: string) => void;
  onPickWorkspace: () => void;
  loading: boolean;
  onRefreshDiscovery: () => void;
  onStartNewTask: () => void;
  sessions: SessionRecord[];
  activeSessionId?: string | null;
  onOpenSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  /** `null` targets the sessions that belong to no folder. */
  onDeleteWorkspaceSessions?: (workspace: string | null) => void;
}

const ICON_BTN_CLASS =
  "grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-transparent text-muted transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35";

export function Sidebar({
  collapsed: propCollapsed,
  onCollapse: propCollapse,
  workspaceInput,
  recentWorkspaces,
  workspaceDropdownOpen: propDropdownOpen,
  onToggleWorkspaceDropdown: propToggleDropdown,
  onSelectWorkspace,
  onPickWorkspace,
  loading,
  onRefreshDiscovery,
  onStartNewTask,
  sessions,
  activeSessionId: propActiveSessionId,
  onOpenSession,
  onDeleteSession,
}: SidebarProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const storeView = useNavigationStore((s) => s.view);
  const storeActiveSessionId = useNavigationStore((s) => s.activeSessionId);
  const storeCollapsed = useNavigationStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useNavigationStore((s) => s.setSidebarCollapsed);
  const storeDropdownOpen = useNavigationStore((s) => s.workspaceDropdownOpen);
  const toggleWorkspaceDropdown = useNavigationStore((s) => s.toggleWorkspaceDropdown);

  const collapsed = propCollapsed ?? storeCollapsed;
  const handleCollapse = propCollapse ?? (() => setSidebarCollapsed(true));
  const activeSessionId =
    propActiveSessionId !== undefined ? propActiveSessionId : storeActiveSessionId;
  const workspaceDropdownOpen = propDropdownOpen ?? storeDropdownOpen;
  const handleToggleDropdown = propToggleDropdown ?? toggleWorkspaceDropdown;
  const newChatActive = isNewChatRouteActive(storeView, activeSessionId);
  const activeWorkspace = workspaceInput.trim();
  const filteredSessions = sessions.filter((session) => {
    const sessionWorkspace = session.workspace?.trim() ?? "";
    return activeWorkspace ? sessionWorkspace === activeWorkspace : sessionWorkspace === "";
  });

  function confirmThen(key: string, action: () => void): void {
    if (pendingDelete === key) {
      setPendingDelete(null);
      action();
    } else {
      setPendingDelete(key);
    }
  }

  return (
    <aside
      aria-hidden={collapsed}
      className={`relative flex min-h-0 flex-col overflow-hidden bg-sidebar transition-[width,flex-basis,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[width,flex-basis] ${
        collapsed
          ? "pointer-events-none w-0 shrink-0 basis-0 border-r border-transparent opacity-0"
          : "w-[240px] shrink-0 basis-[240px] border-r border-line opacity-100"
      }`}
    >
      <div
        className={`flex min-h-0 h-full w-[240px] min-w-[240px] flex-1 flex-col transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
          collapsed ? "pointer-events-none -translate-x-3.5 opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        <div className="relative flex items-center justify-between gap-2 px-3 pt-3.5 pb-2.5">
        <WorkspaceDropdown
          isOpen={workspaceDropdownOpen}
          onToggle={handleToggleDropdown}
          currentWorkspace={workspaceInput}
          recentWorkspaces={recentWorkspaces}
          onSelectWorkspace={onSelectWorkspace}
          onPickWorkspace={onPickWorkspace}
        />

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            aria-label="New"
            className={ICON_BTN_CLASS}
            onClick={onStartNewTask}
            title="New"
            type="button"
          >
            <PlusIcon size={14} />
          </button>
          <button
            aria-label="Refresh"
            className={ICON_BTN_CLASS}
            disabled={loading}
            onClick={onRefreshDiscovery}
            title="Refresh"
            type="button"
          >
            <RefreshIcon size={14} />
          </button>
          <button
            aria-label="收起侧边栏"
            className={ICON_BTN_CLASS}
            onClick={handleCollapse}
            title="收起 (⌘B)"
            type="button"
          >
            <PanelLeftIcon size={14} />
          </button>
        </div>
      </div>

      <LayoutGroup id="sidebar-route-group">
        <div className="px-2.5 pt-0.5 pb-1.5">
          <button
            className={`relative flex h-[34px] w-full items-center gap-2 rounded-lg border px-2.5 text-left text-[12.5px] text-ink transition-all duration-140 [&>span]:relative [&>span]:z-1 [&>svg]:relative [&>svg]:z-1 ${
              newChatActive
                ? "border-transparent bg-transparent font-[550] shadow-none"
                : "border-line bg-surface font-medium shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-line-strong hover:bg-surface-subtle"
            }`}
            onClick={onStartNewTask}
            type="button"
          >
            {newChatActive ? (
              <LiquidRouteIndicator layoutId="sidebar-active-indicator" variant="glass" />
            ) : null}
            <PlusIcon size={14} weight="bold" />
            <span>新会话</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-[18px] [scrollbar-color:rgba(0,0,0,0.12)_transparent] [scrollbar-width:thin]">
          <div className="flex flex-col gap-0.5">
            {filteredSessions.length > 0 ? (
              filteredSessions.map((session) => {
                const isActive = isSessionRouteActive(storeView, activeSessionId, session.id);
                const deleteKey = `s:${session.id}`;
                const confirming = pendingDelete === deleteKey;
                return (
                  <div
                    className="group/session relative flex items-center"
                    key={session.id}
                    onMouseLeave={() => confirming && setPendingDelete(null)}
                  >
                    <button
                      className={`relative block w-full truncate rounded-lg bg-transparent py-[7px] pr-8 pl-2.5 text-left text-[12.5px] transition-all duration-120 ${
                        isActive
                          ? "font-[550] text-ink"
                          : "text-muted-strong hover:bg-black/4 hover:text-ink"
                      }`}
                      onClick={() => onOpenSession(session.id)}
                      title={session.title}
                      type="button"
                    >
                      {isActive ? (
                        <LiquidRouteIndicator layoutId="sidebar-active-indicator" variant="glass" />
                      ) : null}
                      <span className="relative z-1 block truncate">{session.title}</span>
                    </button>
                    <button
                      aria-label="删除会话"
                      className={`absolute right-1.5 z-2 flex h-6 items-center gap-1 rounded-[6px] bg-transparent px-1.5 text-[11px] transition-opacity duration-120 hover:text-red-500 ${
                        confirming
                          ? "text-red-500 opacity-100"
                          : "text-muted opacity-0 group-hover/session:opacity-100"
                      }`}
                      onClick={() => confirmThen(deleteKey, () => onDeleteSession(session.id))}
                      title={confirming ? "再次点击确认删除" : "删除会话"}
                      type="button"
                    >
                      <TrashIcon size={13} />
                      {confirming ? <span>确认</span> : null}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="px-2.5 py-1.5 text-[11.5px] text-muted-soft select-none">
                暂无会话
              </div>
            )}
          </div>
        </div>
      </LayoutGroup>
      </div>
    </aside>
  );
}
