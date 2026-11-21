import type { RightPanelMode } from "../stores/navigationStore";
import type { AgentEntry } from "../types";
import { AgentsIcon, TerminalIcon } from "./icons";
import { TerminalPanel } from "./TerminalPanel";

export interface RightSidebarProps {
  open: boolean;
  mode: RightPanelMode;
  onChangeMode: (mode: RightPanelMode) => void;
  agents: AgentEntry[];
  selectedAgentId: string;
  onSelectAgent: (agent: AgentEntry) => void;
  workspaceCwd: string;
}

export function RightSidebar({
  open,
  mode,
  onChangeMode,
  agents,
  selectedAgentId,
  onSelectAgent,
  workspaceCwd,
}: RightSidebarProps) {
  const panelWidthClass = !open
    ? "pointer-events-none w-0 shrink-0 basis-0 border-l border-transparent opacity-0"
    : mode === "terminal"
      ? "w-[420px] max-w-[48vw] shrink-0 basis-[420px] border-l border-line opacity-100"
      : "w-[220px] shrink-0 basis-[220px] border-l border-line opacity-100";

  return (
    <aside
      aria-hidden={!open}
      aria-label={mode === "terminal" ? "Terminal" : "Agents"}
      className={`relative flex min-h-0 flex-col overflow-hidden bg-sidebar transition-[width,flex-basis,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[width,flex-basis] ${panelWidthClass}`}
    >
      <div
        className={`flex min-h-0 h-full w-full flex-1 flex-col transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3.5 opacity-0"
        }`}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-line px-2.5 py-2">
          <button
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === "agents"
                ? "bg-surface-subtle text-ink"
                : "text-muted hover:bg-surface-subtle/60 hover:text-ink"
            }`}
            onClick={() => onChangeMode("agents")}
            type="button"
          >
            <AgentsIcon size={13} />
            <span>Agents</span>
          </button>
          <button
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              mode === "terminal"
                ? "bg-surface-subtle text-ink"
                : "text-muted hover:bg-surface-subtle/60 hover:text-ink"
            }`}
            onClick={() => onChangeMode("terminal")}
            type="button"
          >
            <TerminalIcon size={13} />
            <span>Terminal</span>
          </button>
        </div>

        <div
          className={`min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-[18px] [scrollbar-color:rgba(0,0,0,0.12)_transparent] [scrollbar-width:thin] ${
            mode === "agents" ? "block" : "hidden"
          }`}
        >
          <div className="flex flex-col gap-[3px] pt-2">
            {agents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              const toneClass = agent.available
                ? isSelected
                  ? "bg-[#3b6e5c]/[0.12] text-[#24493b]"
                  : "bg-transparent text-[#3b6e5c] hover:bg-[#3b6e5c]/[0.07] hover:text-[#2a5445]"
                : isSelected
                  ? "bg-[#9e5350]/[0.12] text-[#783734]"
                  : "bg-transparent text-[#9e5350] hover:bg-[#9e5350]/[0.07] hover:text-[#823e3b]";

              return (
                <button
                  className={`relative flex w-full items-center rounded-lg px-2.5 py-2 text-left transition-colors duration-140 ${toneClass}`}
                  key={agent.id}
                  onClick={() => onSelectAgent(agent)}
                  title={agent.version ?? agent.command}
                  type="button"
                >
                  <span className="flex min-w-0 flex-col">
                    <strong className="truncate text-xs font-medium">{agent.label}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div
          className={`min-h-0 flex-1 flex-col ${
            mode === "terminal" ? "flex" : "hidden"
          }`}
        >
          <TerminalPanel
            active={open && mode === "terminal"}
            workspaceCwd={workspaceCwd}
          />
        </div>
      </div>
    </aside>
  );
}
