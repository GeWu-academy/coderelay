import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { workspaceName } from "../../utils";
import { ChevronDownIcon, FolderIcon, PlusIcon, TrashIcon } from "../icons";

export function buildWorkspaceWheelList(
  workspaceInput: string,
  recentWorkspaces: readonly string[],
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of recentWorkspaces) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  const current = workspaceInput.trim();
  if (current && !seen.has(current)) {
    result.unshift(current);
  }
  return result;
}

export function stabilizeWorkspaceOrder(
  prevOrder: readonly string[],
  nextWorkspaces: readonly string[],
): string[] {
  if (prevOrder.length === 0) {
    return [...nextWorkspaces];
  }
  const nextSet = new Set(nextWorkspaces);
  const kept = prevOrder.filter((ws) => nextSet.has(ws));
  const keptSet = new Set(kept);
  const added = nextWorkspaces.filter((ws) => !keptSet.has(ws));
  return [...added, ...kept];
}

export function stepWorkspaceIndex(currentIndex: number, delta: number, total: number): number {
  if (total <= 1) {
    return 0;
  }
  return (currentIndex + delta + total) % total;
}

export interface WorkspaceWheelProps {
  workspaces: readonly string[];
  currentWorkspace: string;
  onSelectWorkspace?: (workspace: string) => void;
  onDeleteWorkspace?: (workspace: string) => void;
  onPickWorkspace?: () => void;
  autoFocus?: boolean;
  onEscape?: () => void;
}

const WHEEL_OFFSETS = [-2, -1, 0, 1, 2] as const;
const WHEEL_SLOT_HEIGHT = 24;
const WHEEL_DETENT_PX = 28;
const WHEEL_SPRING = { type: "spring", stiffness: 460, damping: 34, mass: 0.7 } as const;

export function WorkspaceWheel({
  workspaces,
  currentWorkspace,
  onSelectWorkspace,
  onDeleteWorkspace,
  onPickWorkspace,
  autoFocus = false,
  onEscape,
}: WorkspaceWheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelDeltaRef = useRef(0);
  const lastStepAtRef = useRef(0);
  const stableOrderRef = useRef<readonly string[]>([]);

  const orderedWorkspaces = useMemo(() => {
    const next = stabilizeWorkspaceOrder(stableOrderRef.current, workspaces);
    stableOrderRef.current = next;
    return next;
  }, [workspaces]);

  const trimmedCurrent = currentWorkspace.trim();
  const currentIndex = Math.max(0, orderedWorkspaces.indexOf(trimmedCurrent));
  const total = orderedWorkspaces.length;

  const [virtualStep, setVirtualStep] = useState(currentIndex);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const previewIndex = total > 0 ? ((virtualStep % total) + total) % total : 0;
  const previewWorkspace = orderedWorkspaces[previewIndex] ?? trimmedCurrent;
  const isPendingCommit = total > 1 && previewWorkspace !== trimmedCurrent;

  const commitWorkspace = useCallback(
    (target: string) => {
      if (target && target !== trimmedCurrent && onSelectWorkspace) {
        onSelectWorkspace(target);
      }
    },
    [onSelectWorkspace, trimmedCurrent],
  );

  useEffect(() => {
    if (autoFocus) {
      containerRef.current?.focus();
    }
  }, [autoFocus]);

  // Sync virtualStep if currentWorkspace changes externally (e.g. Open Folder)
  useEffect(() => {
    if (total <= 1) {
      setVirtualStep(0);
      return;
    }
    setVirtualStep((prev) => {
      const normalizedPrev = ((prev % total) + total) % total;
      if (normalizedPrev === currentIndex) {
        return prev;
      }
      // Find shortest modular delta so external switches animate smoothly
      let diff = currentIndex - normalizedPrev;
      if (diff > total / 2) {
        diff -= total;
      } else if (diff < -total / 2) {
        diff += total;
      }
      return prev + diff;
    });
  }, [currentIndex, total, trimmedCurrent]);

  const stepBy = useCallback(
    (delta: number) => {
      if (total <= 1 || delta === 0) {
        return;
      }
      setPendingDelete(null);
      setVirtualStep((prev) => prev + delta);
    },
    [total],
  );

  useEffect(() => {
    if (!pendingDelete) {
      return;
    }
    const timer = setTimeout(() => setPendingDelete(null), 2500);
    return () => clearTimeout(timer);
  }, [pendingDelete]);

  // Command+K / Ctrl+K while wheel is mounted: cycle if focused, otherwise focus
  useEffect(() => {
    function handleKeyCycle(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.activeElement === containerRef.current) {
          stepBy(1);
        } else {
          containerRef.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKeyCycle);
    return () => window.removeEventListener("keydown", handleKeyCycle);
  }, [stepBy]);

  function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
    if (total <= 1) {
      return;
    }
    event.preventDefault();
    wheelDeltaRef.current += event.deltaY;
    if (Math.abs(wheelDeltaRef.current) < WHEEL_DETENT_PX) {
      return;
    }
    const now = Date.now();
    if (now - lastStepAtRef.current < 55) {
      return;
    }
    const direction = wheelDeltaRef.current > 0 ? 1 : -1;
    wheelDeltaRef.current = 0;
    lastStepAtRef.current = now;
    stepBy(direction);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      stepBy(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      stepBy(1);
    } else if ((event.key === "Enter" || event.key === " ") && isPendingCommit) {
      event.preventDefault();
      commitWorkspace(previewWorkspace);
    } else if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
    }
  }

  const visibleSlots =
    total <= 1
      ? [{ offset: 0, virtualIndex: 0, workspace: orderedWorkspaces[0] ?? trimmedCurrent }]
      : WHEEL_OFFSETS.map((offset) => {
          const virtualIndex = virtualStep + offset;
          const wsIndex = ((virtualIndex % total) + total) % total;
          return {
            offset,
            virtualIndex,
            workspace: orderedWorkspaces[wsIndex] ?? trimmedCurrent,
          };
        });

  return (
    <div
      ref={containerRef}
      role="listbox"
      tabIndex={0}
      aria-label="Workspace wheel switcher"
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      title="Scroll, use ↑/↓, or press ⌘K to switch workspace"
      className="group/wheel relative h-[86px] overflow-hidden bg-surface select-none focus:outline-none"
      style={{ perspective: "420px" }}
    >
      {/* Top & bottom cylindrical drum fade */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-gradient-to-b from-surface via-surface/75 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-gradient-to-t from-surface via-surface/75 to-transparent"
      />

      {/* Command-K style center selection band */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 top-1/2 z-0 h-[28px] -translate-y-1/2 rounded-lg border border-line-strong/65 bg-surface-subtle/90 shadow-[0_1px_4px_rgba(0,0,0,0.06)] transition-colors group-focus-visible/wheel:border-ink/40"
      />

      {/* Infinite rolling drum slots */}
      <div className="relative h-full w-full">
        <AnimatePresence initial={false}>
          {visibleSlots.map(({ offset, virtualIndex, workspace }) => {
            const isCenter = offset === 0;
            const distance = Math.abs(offset);
            const targetY = offset * WHEEL_SLOT_HEIGHT;
            const targetScale = isCenter ? 1 : distance === 1 ? 0.91 : 0.82;
            const targetOpacity = isCenter ? 1 : distance === 1 ? 0.52 : 0;
            const targetRotateX = offset * -18;

            return (
              <motion.div
                key={virtualIndex}
                initial={{
                  y: targetY + (offset >= 0 ? 12 : -12),
                  scale: 0.82,
                  opacity: 0,
                  rotateX: targetRotateX,
                }}
                animate={{
                  y: targetY,
                  scale: targetScale,
                  opacity: targetOpacity,
                  rotateX: targetRotateX,
                }}
                exit={{
                  y: targetY + (offset >= 0 ? 12 : -12),
                  scale: 0.82,
                  opacity: 0,
                }}
                transition={WHEEL_SPRING}
                style={{
                  top: "50%",
                  marginTop: "-14px",
                  transformStyle: "preserve-3d",
                }}
                className={`absolute inset-x-2 z-10 flex h-[28px] items-center rounded-lg pl-2.5 ${
                  isPendingCommit
                    ? "pr-[116px]"
                    : total > 1
                      ? "pr-[60px]"
                      : onDeleteWorkspace
                        ? "pr-8"
                        : "pr-2.5"
                } ${isCenter ? "text-ink" : "text-muted hover:text-ink-soft"}`}
                title={workspace || (onPickWorkspace ? "点击选择文件夹" : "Workspace")}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (offset !== 0) {
                      stepBy(offset);
                    } else if (isPendingCommit) {
                      commitWorkspace(workspace);
                    } else if (!workspace && onPickWorkspace) {
                      onPickWorkspace();
                    }
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${
                    isCenter && !isPendingCommit && (Boolean(workspace) || !onPickWorkspace)
                      ? "cursor-default"
                      : "cursor-pointer"
                  }`}
                >
                  <FolderIcon
                    size={12}
                    className={isCenter ? "shrink-0 text-ink" : "shrink-0 text-muted/70"}
                  />
                  <span
                    className={`truncate font-code ${
                      isCenter ? "text-[11.5px] font-semibold text-ink" : "text-[11px] font-normal"
                    }`}
                  >
                    {workspace ? workspaceName(workspace) : "未选择文件夹"}
                  </span>
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Fixed right-side actions anchored to the center workspace band */}
      {total > 1 || (onDeleteWorkspace && previewWorkspace) ? (
        <div className="absolute top-1/2 right-3 z-30 flex h-[28px] -translate-y-1/2 items-center gap-1">
          {onDeleteWorkspace && previewWorkspace ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (pendingDelete === previewWorkspace) {
                  setPendingDelete(null);
                  onDeleteWorkspace(previewWorkspace);
                } else {
                  setPendingDelete(previewWorkspace);
                }
              }}
              aria-label={
                pendingDelete === previewWorkspace
                  ? `Confirm remove workspace ${workspaceName(previewWorkspace)}`
                  : `Remove workspace ${workspaceName(previewWorkspace)}`
              }
              title={
                pendingDelete === previewWorkspace
                  ? "Click again to remove workspace & sessions"
                  : "Remove workspace"
              }
              className={`grid h-5 place-items-center rounded px-1 transition-all ${
                pendingDelete === previewWorkspace
                  ? "bg-rose-500/15 font-code text-[9.5px] font-medium text-rose-600 opacity-100 dark:text-rose-400"
                  : "w-5 text-muted opacity-0 group-hover/wheel:opacity-100 group-focus-visible/wheel:opacity-100 hover:bg-surface hover:text-rose-500"
              }`}
            >
              {pendingDelete === previewWorkspace ? "删除?" : <TrashIcon size={11} />}
            </button>
          ) : null}
          {total > 1 ? (
            <span className="font-code text-[10px] text-muted">
              {previewIndex + 1}/{total}
            </span>
          ) : null}
          {isPendingCommit ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                commitWorkspace(previewWorkspace);
              }}
              aria-label={`立即切换到 ${workspaceName(previewWorkspace)}`}
              title="立即切换工作区 (Enter)"
              className="inline-flex h-5 cursor-pointer items-center gap-0.5 rounded bg-ink px-1.5 text-[10px] font-medium text-surface transition-opacity hover:opacity-85"
            >
              <span>立即切换</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface WorkspaceSwitcherProps {
  currentWorkspace: string;
  recentWorkspaces?: readonly string[];
  onSelectWorkspace?: (workspace: string) => void;
  onDeleteWorkspace?: (workspace: string) => void;
  onPickWorkspace?: () => void;
  defaultOpen?: boolean;
}

export function WorkspaceSwitcher({
  currentWorkspace,
  recentWorkspaces = [],
  onSelectWorkspace,
  onDeleteWorkspace,
  onPickWorkspace,
  defaultOpen = false,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);

  const workspaces = useMemo(
    () => buildWorkspaceWheelList(currentWorkspace, recentWorkspaces),
    [currentWorkspace, recentWorkspaces],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Global ⌘K / Ctrl+K opens switcher when closed; Escape closes it
  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (!open) {
          event.preventDefault();
          setOpen(true);
        }
      } else if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open]);

  const trimmedWorkspace = currentWorkspace.trim();
  const displayLabel = trimmedWorkspace ? workspaceName(trimmedWorkspace) : "选择工作区";

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        type="button"
        aria-label="Switch workspace"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={trimmedWorkspace ? `${trimmedWorkspace} (⌘K)` : "选择工作区 (⌘K)"}
        onClick={() => setOpen((prev) => !prev)}
        className={`inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[7px] px-2 text-[12.5px] font-medium tracking-[-0.01em] transition-colors duration-140 ${
          open
            ? "bg-surface-subtle text-ink"
            : "bg-transparent text-ink-soft hover:bg-surface-subtle hover:text-ink"
        }`}
      >
        <FolderIcon size={14} className="shrink-0 text-muted-strong" />
        <span className="truncate">{displayLabel}</span>
        <ChevronDownIcon
          size={11}
          className={`shrink-0 text-muted transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            className="absolute top-[calc(100%+6px)] left-0 z-50 w-[272px] overflow-hidden rounded-[11px] border border-line-strong bg-surface shadow-[0_12px_28px_-6px_rgba(0,0,0,0.12),0_4px_10px_-4px_rgba(0,0,0,0.05)]"
          >
            <div className="flex items-center justify-between border-b border-line px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-muted">工作区</span>
              {onPickWorkspace ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPickWorkspace();
                  }}
                  className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium text-ink-soft transition-colors hover:bg-surface-subtle hover:text-ink"
                >
                  <PlusIcon size={12} />
                  <span>打开文件夹</span>
                </button>
              ) : null}
            </div>

            <WorkspaceWheel
              workspaces={workspaces}
              currentWorkspace={currentWorkspace}
              onSelectWorkspace={onSelectWorkspace}
              onDeleteWorkspace={onDeleteWorkspace}
              onPickWorkspace={
                onPickWorkspace
                  ? () => {
                      setOpen(false);
                      onPickWorkspace();
                    }
                  : undefined
              }
              autoFocus
              onEscape={() => setOpen(false)}
            />

            {workspaces.length > 1 ? (
              <div className="flex items-center justify-between border-t border-line px-2.5 py-1 text-[10px] text-muted">
                <span>滚轮或 ↑/↓ 切换工作区</span>
                <span className="font-code">⌘K</span>
              </div>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
