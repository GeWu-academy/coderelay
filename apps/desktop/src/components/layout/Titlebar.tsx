import type { RightPanelMode } from "../../stores/navigationStore";
import { AgentsIcon, PanelLeftIcon, TerminalIcon } from "../icons";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export interface TitlebarProps {
  workspaceInput?: string;
  recentWorkspaces?: readonly string[];
  onSelectWorkspace?: (workspace: string) => void;
  onDeleteWorkspace?: (workspace: string) => void;
  onPickWorkspace?: () => void;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  rightSidebarOpen: boolean;
  rightPanelMode?: RightPanelMode;
  onToggleRightSidebar: () => void;
  onToggleRightPanelMode?: (mode: RightPanelMode) => void;
}

export function Titlebar({
  workspaceInput,
  recentWorkspaces,
  onSelectWorkspace,
  onDeleteWorkspace,
  onPickWorkspace,
  sidebarCollapsed = false,
  onToggleSidebar,
  rightSidebarOpen,
  rightPanelMode = "agents",
  onToggleRightSidebar,
  onToggleRightPanelMode,
}: TitlebarProps) {
  const showWorkspaceSwitcher =
    workspaceInput !== undefined ||
    onSelectWorkspace !== undefined ||
    onPickWorkspace !== undefined;
  const agentsActive = rightSidebarOpen && rightPanelMode === "agents";
  const terminalActive = rightSidebarOpen && rightPanelMode === "terminal";

  function handleToggleAgents() {
    if (onToggleRightPanelMode) {
      onToggleRightPanelMode("agents");
    } else {
      onToggleRightSidebar();
    }
  }

  function handleToggleTerminal() {
    if (onToggleRightPanelMode) {
      onToggleRightPanelMode("terminal");
    } else {
      onToggleRightSidebar();
    }
  }

  return (
    <header
      className="relative z-20 flex min-h-[38px] shrink-0 basis-[38px] items-center justify-between border-b border-line bg-canvas pr-3.5 pl-[76px] select-none"
      data-tauri-drag-region
    >
      {showWorkspaceSwitcher ? (
        <WorkspaceSwitcher
          currentWorkspace={workspaceInput ?? ""}
          recentWorkspaces={recentWorkspaces}
          onSelectWorkspace={onSelectWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
          onPickWorkspace={onPickWorkspace}
        />
      ) : (
        <div className="h-full w-12" data-tauri-drag-region />
      )}
      <div className="h-full flex-1" data-tauri-drag-region />
      <div className="flex items-center gap-2">
        {onToggleSidebar ? (
          <button
            aria-label="Toggle sidebar"
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35 ${
              !sidebarCollapsed ? "bg-surface-subtle text-ink" : "bg-transparent text-muted"
            }`}
            onClick={onToggleSidebar}
            title="Sidebar (⌘B)"
            type="button"
          >
            <PanelLeftIcon size={15} />
          </button>
        ) : null}
        <button
          aria-label="Agents"
          aria-pressed={agentsActive}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35 ${
            agentsActive ? "bg-surface-subtle text-ink" : "bg-transparent text-muted"
          }`}
          onClick={handleToggleAgents}
          title="Agents"
          type="button"
        >
          <AgentsIcon size={15} />
        </button>
        <button
          aria-label="Terminal"
          aria-pressed={terminalActive}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35 ${
            terminalActive ? "bg-surface-subtle text-ink" : "bg-transparent text-muted"
          }`}
          onClick={handleToggleTerminal}
          title="Terminal"
          type="button"
        >
          <TerminalIcon size={15} />
        </button>
      </div>
    </header>
  );
}
