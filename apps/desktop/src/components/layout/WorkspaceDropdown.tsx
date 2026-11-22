import { AnimatePresence, motion } from "motion/react";

import { workspaceName } from "../../utils";
import { ChevronDownIcon, FolderIcon, PlusIcon } from "../icons";

export interface WorkspaceDropdownProps {
  isOpen: boolean;
  onToggle: () => void;
  currentWorkspace: string;
  recentWorkspaces: string[];
  onSelectWorkspace: (workspace: string) => void;
  onPickWorkspace: () => void;
}

export function WorkspaceDropdown({
  isOpen,
  onToggle,
  currentWorkspace,
  recentWorkspaces,
  onSelectWorkspace,
  onPickWorkspace,
}: WorkspaceDropdownProps) {
  const workspaces = Array.from(
    new Set([currentWorkspace, ...recentWorkspaces].filter(Boolean)),
  );

  return (
    <div className="relative min-w-0 flex-1">
      <button
        className="inline-flex max-w-full items-center gap-1.5 rounded-[7px] bg-transparent px-2 py-[5px] text-[13px] font-[550] tracking-[-0.01em] text-ink transition-colors duration-140 hover:bg-surface-subtle"
        type="button"
        onClick={onToggle}
        title={currentWorkspace || "选择文件夹"}
      >
        <FolderIcon size={15} />
        <span className="truncate">
          {currentWorkspace.trim() ? workspaceName(currentWorkspace) : "选择文件夹"}
        </span>
        <ChevronDownIcon size={11} />
      </button>
      <AnimatePresence>
        {isOpen ? (
          <motion.div
            className="absolute top-[calc(100%+6px)] left-0 z-50 min-w-[220px] rounded-[11px] border border-line-strong bg-surface p-1.5 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.1),0_4px_10px_-4px_rgba(0,0,0,0.04)]"
            initial={{ opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {workspaces.length > 0 ? (
              <div className="flex flex-col gap-0.5">
                {workspaces.map((ws) => (
                  <button
                    key={ws}
                    type="button"
                    className={`flex w-full items-center gap-[7px] rounded-[7px] px-2 py-1.5 text-left text-xs transition-all duration-120 ${
                      ws === currentWorkspace
                        ? "bg-surface-hover font-[550] text-ink"
                        : "bg-transparent text-ink-soft hover:bg-surface-subtle hover:text-ink"
                    }`}
                    onClick={() => onSelectWorkspace(ws)}
                    title={ws}
                  >
                    <FolderIcon size={14} />
                    <span className="truncate">{workspaceName(ws)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div className={workspaces.length > 0 ? "mt-1 border-t border-line pt-1" : ""}>
              <button
                type="button"
                className="flex w-full items-center gap-[7px] rounded-[7px] bg-transparent px-2 py-1.5 text-left text-xs font-medium text-ink-soft transition-all duration-120 hover:bg-surface-subtle hover:text-ink"
                onClick={onPickWorkspace}
              >
                <PlusIcon size={14} />
                <span>打开文件夹...</span>
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
