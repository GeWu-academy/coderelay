import type { AgentEntry } from "../types";

export interface RightSidebarProps {
  open: boolean;
  agents: AgentEntry[];
  selectedAgentId: string;
  onSelectAgent: (agent: AgentEntry) => void;
}

export function RightSidebar({
  open,
  agents,
  selectedAgentId,
  onSelectAgent,
}: RightSidebarProps) {
  return (
    <aside
      aria-hidden={!open}
      aria-label="Agents"
      className={`relative flex min-h-0 flex-col overflow-hidden bg-sidebar transition-[width,flex-basis,opacity,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[width,flex-basis] ${
        open
          ? "w-[220px] shrink-0 basis-[220px] border-l border-line opacity-100"
          : "pointer-events-none w-0 shrink-0 basis-0 border-l border-transparent opacity-0"
      }`}
    >
      <div
        className={`flex min-h-0 h-full w-[220px] min-w-[220px] flex-1 flex-col transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
          open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3.5 opacity-0"
        }`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-[18px] [scrollbar-color:rgba(0,0,0,0.12)_transparent] [scrollbar-width:thin]">
          <div className="flex flex-col gap-[3px] pt-2.5">
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
      </div>
    </aside>
  );
}
