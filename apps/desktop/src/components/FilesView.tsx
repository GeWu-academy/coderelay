import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getCodeThemePalette, useThemeStore } from "../stores/themeStore";
import type { FileTreeEntry, WorkspaceFileContent } from "../types";
import { messageOf, workspaceName } from "../utils";
import { tokenColor, tokenizeCodeLines } from "../utils/codeHighlight";
import {
  CheckIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  FilesIcon,
  FolderIcon,
  RefreshIcon,
  TrashIcon,
} from "./icons";

export interface FilesViewProps {
  workspaceInput: string;
  recentWorkspaces?: string[];
  onSelectWorkspace?: (workspace: string) => void;
  onDeleteWorkspace?: (workspace: string) => void;
  onPickWorkspace?: () => void;
}

const EXTENSION_ACCENT: Record<string, string> = {
  ts: "text-sky-600 dark:text-sky-400",
  tsx: "text-sky-600 dark:text-sky-400",
  js: "text-amber-600 dark:text-amber-400",
  jsx: "text-amber-600 dark:text-amber-400",
  rs: "text-orange-600 dark:text-orange-400",
  py: "text-emerald-600 dark:text-emerald-400",
  json: "text-yellow-600 dark:text-yellow-400",
  md: "text-indigo-500 dark:text-indigo-400",
  css: "text-pink-600 dark:text-pink-400",
  html: "text-rose-600 dark:text-rose-400",
  toml: "text-zinc-500 dark:text-zinc-400",
  yaml: "text-purple-600 dark:text-purple-400",
  yml: "text-purple-600 dark:text-purple-400",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function fileAccentClass(extension: string | null): string {
  if (!extension) {
    return "text-muted";
  }
  return EXTENSION_ACCENT[extension] ?? "text-muted";
}

interface TreeRowsProps {
  parentPath: string;
  depth: number;
  childrenByPath: Record<string, FileTreeEntry[]>;
  expandedDirs: ReadonlySet<string>;
  loadingDirs: ReadonlySet<string>;
  selectedPath: string | null;
  filterQuery: string;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}

function hasMatchingDescendant(
  dirPath: string,
  query: string,
  childrenByPath: Record<string, FileTreeEntry[]>,
): boolean {
  const items = childrenByPath[dirPath];
  if (!items) {
    return false;
  }
  for (const item of items) {
    if (item.name.toLowerCase().includes(query)) {
      return true;
    }
    if (item.isDir && hasMatchingDescendant(item.path, query, childrenByPath)) {
      return true;
    }
  }
  return false;
}

function TreeRows({
  parentPath,
  depth,
  childrenByPath,
  expandedDirs,
  loadingDirs,
  selectedPath,
  filterQuery,
  onToggleDir,
  onSelectFile,
}: TreeRowsProps) {
  const entries = (childrenByPath[parentPath] ?? []).filter(
    (entry) => !entry.name.startsWith("."),
  );
  const normalizedQuery = filterQuery.trim().toLowerCase();

  const visibleEntries = normalizedQuery
    ? entries.filter(
        (entry) =>
          entry.name.toLowerCase().includes(normalizedQuery) ||
          (entry.isDir && hasMatchingDescendant(entry.path, normalizedQuery, childrenByPath)),
      )
    : entries;

  return (
    <>
      {visibleEntries.map((entry) => {
        const isExpanded = expandedDirs.has(entry.path);
        const isLoading = loadingDirs.has(entry.path);
        const isSelected = !entry.isDir && selectedPath === entry.path;

        return (
          <div key={entry.path}>
            <button
              type="button"
              onClick={() =>
                entry.isDir ? onToggleDir(entry.path) : onSelectFile(entry.path)
              }
              style={{ paddingLeft: `${depth * 14 + 10}px` }}
              className={`group flex h-[26px] w-full items-center gap-1.5 pr-2.5 text-left text-[12.5px] transition-colors duration-100 ${
                isSelected
                  ? "bg-surface-subtle font-medium text-ink"
                  : "text-ink-soft hover:bg-surface-subtle/70 hover:text-ink"
              }`}
              title={entry.path}
            >
              {entry.isDir ? (
                <ChevronRightIcon
                  size={12}
                  className={`shrink-0 text-muted transition-transform duration-150 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
              ) : (
                <span className="w-3 shrink-0" aria-hidden="true" />
              )}

              {entry.isDir ? (
                <FolderIcon
                  size={14}
                  className={isExpanded ? "text-ink" : "text-muted-strong"}
                />
              ) : (
                <FileIcon size={14} className={fileAccentClass(entry.extension)} />
              )}

              <span className="min-w-0 flex-1 truncate">{entry.name}</span>

              {isLoading ? (
                <span className="font-code text-[10px] text-muted">...</span>
              ) : null}
            </button>

            {entry.isDir && isExpanded ? (
              <div className="relative">
                <TreeRows
                  parentPath={entry.path}
                  depth={depth + 1}
                  childrenByPath={childrenByPath}
                  expandedDirs={expandedDirs}
                  loadingDirs={loadingDirs}
                  selectedPath={selectedPath}
                  filterQuery={filterQuery}
                  onToggleDir={onToggleDir}
                  onSelectFile={onSelectFile}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

interface OpenFileState {
  loading: boolean;
  content: WorkspaceFileContent | null;
  error: string | null;
}

export function closeFileTab(
  openTabs: readonly string[],
  activeTabPath: string | null,
  targetPath: string,
): { nextTabs: string[]; nextActiveTab: string | null } {
  const index = openTabs.indexOf(targetPath);
  if (index === -1) {
    return { nextTabs: [...openTabs], nextActiveTab: activeTabPath };
  }
  const nextTabs = openTabs.filter((path) => path !== targetPath);
  if (activeTabPath !== targetPath) {
    return { nextTabs, nextActiveTab: activeTabPath };
  }
  if (nextTabs.length === 0) {
    return { nextTabs, nextActiveTab: null };
  }
  return {
    nextTabs,
    nextActiveTab: nextTabs[Math.min(index, nextTabs.length - 1)] ?? null,
  };
}

function fileNameOf(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function extensionOf(path: string): string | null {
  const name = fileNameOf(path);
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) {
    return null;
  }
  return name.slice(dotIndex + 1).toLowerCase();
}

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

export function stepWorkspaceIndex(
  currentIndex: number,
  delta: number,
  total: number,
): number {
  if (total <= 1) {
    return 0;
  }
  return (currentIndex + delta + total) % total;
}

interface WorkspaceWheelProps {
  workspaces: readonly string[];
  currentWorkspace: string;
  onSelectWorkspace?: (workspace: string) => void;
  onDeleteWorkspace?: (workspace: string) => void;
  onPickWorkspace?: () => void;
}

const WHEEL_OFFSETS = [-2, -1, 0, 1, 2] as const;
const WHEEL_SLOT_HEIGHT = 24;
const WHEEL_DETENT_PX = 28;
const WHEEL_SETTLE_DELAY_MS = 480;
const WHEEL_SPRING = { type: "spring", stiffness: 460, damping: 34, mass: 0.7 } as const;

function WorkspaceWheel({
  workspaces,
  currentWorkspace,
  onSelectWorkspace,
  onDeleteWorkspace,
  onPickWorkspace,
}: WorkspaceWheelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelDeltaRef = useRef(0);
  const lastStepAtRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedCurrent = currentWorkspace.trim();
  const currentIndex = Math.max(0, workspaces.indexOf(trimmedCurrent));
  const total = workspaces.length;

  const [virtualStep, setVirtualStep] = useState(currentIndex);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const previewIndex = total > 0 ? ((virtualStep % total) + total) % total : 0;
  const previewWorkspace = workspaces[previewIndex] ?? trimmedCurrent;
  const isPendingCommit = total > 1 && previewWorkspace !== trimmedCurrent;

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  const commitWorkspace = useCallback(
    (target: string) => {
      clearSettleTimer();
      if (target && target !== trimmedCurrent && onSelectWorkspace) {
        onSelectWorkspace(target);
      }
    },
    [clearSettleTimer, onSelectWorkspace, trimmedCurrent],
  );

  // Sync virtualStep if currentWorkspace changes externally (e.g. Open Folder)
  useEffect(() => {
    clearSettleTimer();
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
  }, [clearSettleTimer, currentIndex, total]);

  // Deferred workspace loading: only load after the user stops rolling and settles
  useEffect(() => {
    clearSettleTimer();
    if (!isPendingCommit) {
      return;
    }
    settleTimerRef.current = setTimeout(() => {
      commitWorkspace(previewWorkspace);
    }, WHEEL_SETTLE_DELAY_MS);
    return clearSettleTimer;
  }, [clearSettleTimer, commitWorkspace, isPendingCommit, previewWorkspace]);

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

  // Command+K / Ctrl+K: focus the wheel, or cycle if already focused
  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (document.activeElement === containerRef.current) {
          stepBy(1);
        } else {
          containerRef.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
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
    }
  }

  const visibleSlots =
    total <= 1
      ? [{ offset: 0, virtualIndex: 0, workspace: workspaces[0] ?? trimmedCurrent }]
      : WHEEL_OFFSETS.map((offset) => {
          const virtualIndex = virtualStep + offset;
          const wsIndex = ((virtualIndex % total) + total) % total;
          return {
            offset,
            virtualIndex,
            workspace: workspaces[wsIndex] ?? trimmedCurrent,
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
      className="group/wheel relative h-[82px] overflow-hidden border-b border-line bg-sidebar select-none focus:outline-none"
      style={{ perspective: "420px" }}
    >
      {/* Top & bottom cylindrical drum fade */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-20 h-5 bg-gradient-to-b from-sidebar via-sidebar/70 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-5 bg-gradient-to-t from-sidebar via-sidebar/70 to-transparent"
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

            const isConfirmingDelete = isCenter && pendingDelete === workspace;

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
                className={`absolute inset-x-2 z-10 flex h-[28px] items-center justify-between gap-1.5 rounded-lg px-2.5 ${
                  isCenter ? "text-ink" : "text-muted hover:text-ink-soft"
                }`}
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
                      isCenter
                        ? "text-[11.5px] font-semibold text-ink"
                        : "text-[11px] font-normal"
                    }`}
                  >
                    {workspace ? workspaceName(workspace) : "未选择文件夹"}
                  </span>
                </button>

                {isCenter ? (
                  <span className="flex shrink-0 items-center gap-1">
                    {total > 1 ? (
                      isPendingCommit ? (
                        <span className="rounded bg-ink/10 px-1 py-0.5 font-code text-[9.5px] font-medium text-ink">
                          ↵
                        </span>
                      ) : (
                        <span className="rounded bg-surface px-1 py-0.5 font-code text-[9.5px] text-muted opacity-0 transition-opacity group-hover/wheel:opacity-100 group-focus-visible/wheel:opacity-100">
                          ⌘K
                        </span>
                      )
                    ) : null}
                    {total > 1 ? (
                      <span className="font-code text-[10px] text-muted">
                        {previewIndex + 1}/{total}
                      </span>
                    ) : null}
                    {onDeleteWorkspace && workspace ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isConfirmingDelete) {
                            setPendingDelete(null);
                            clearSettleTimer();
                            onDeleteWorkspace(workspace);
                          } else {
                            setPendingDelete(workspace);
                          }
                        }}
                        aria-label={
                          isConfirmingDelete
                            ? `Confirm remove workspace ${workspaceName(workspace)}`
                            : `Remove workspace ${workspaceName(workspace)}`
                        }
                        title={
                          isConfirmingDelete
                            ? "Click again to remove workspace & sessions"
                            : "Remove workspace"
                        }
                        className={`grid h-5 place-items-center rounded px-1 transition-all ${
                          isConfirmingDelete
                            ? "bg-rose-500/15 font-code text-[9.5px] font-medium text-rose-600 opacity-100 dark:text-rose-400"
                            : "w-5 text-muted opacity-0 group-hover/wheel:opacity-100 group-focus-visible/wheel:opacity-100 hover:bg-surface hover:text-rose-500"
                        }`}
                      >
                        {isConfirmingDelete ? "删除?" : <TrashIcon size={11} />}
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function FilesView({
  workspaceInput,
  recentWorkspaces = [],
  onSelectWorkspace,
  onDeleteWorkspace,
  onPickWorkspace,
}: FilesViewProps) {
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileTreeEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<ReadonlySet<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<ReadonlySet<string>>(new Set());
  const [filterQuery, setFilterQuery] = useState("");
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [filesByPath, setFilesByPath] = useState<Record<string, OpenFileState>>({});
  const [treeError, setTreeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const workspaceRequestId = useRef(0);

  const loadDirectory = useCallback(
    async (relativePath: string, requestToken: number) => {
      const trimmedWorkspace = workspaceInput.trim();
      if (!trimmedWorkspace) {
        return;
      }
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.add(relativePath);
        return next;
      });

      try {
        const entries = await invoke<FileTreeEntry[]>("list_directory", {
          request: {
            cwd: trimmedWorkspace,
            relativePath: relativePath || null,
          },
        });
        if (workspaceRequestId.current !== requestToken) {
          return;
        }
        setChildrenByPath((prev) => ({
          ...prev,
          [relativePath]: entries,
        }));
        setTreeError(null);
      } catch (error) {
        if (workspaceRequestId.current !== requestToken) {
          return;
        }
        setTreeError(messageOf(error));
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(relativePath);
          return next;
        });
      }
    },
    [workspaceInput],
  );

  const refreshRoot = useCallback(() => {
    const token = ++workspaceRequestId.current;
    setChildrenByPath({});
    setExpandedDirs(new Set());
    setTreeError(null);
    if (!workspaceInput.trim()) {
      return;
    }
    void loadDirectory("", token);
  }, [loadDirectory, workspaceInput]);

  useEffect(() => {
    setOpenTabs([]);
    setActiveTabPath(null);
    setFilesByPath({});
    setFilterQuery("");
    refreshRoot();
  }, [refreshRoot]);

  function handleToggleDir(dirPath: string): void {
    const isExpanded = expandedDirs.has(dirPath);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (isExpanded) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
    if (!isExpanded && !(dirPath in childrenByPath)) {
      void loadDirectory(dirPath, workspaceRequestId.current);
    }
  }

  async function handleSelectFile(filePath: string): Promise<void> {
    const requestToken = workspaceRequestId.current;
    setOpenTabs((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
    setActiveTabPath(filePath);
    setCopied(false);

    const existing = filesByPath[filePath];
    if (existing && (existing.loading || existing.content)) {
      return;
    }

    setFilesByPath((prev) => ({
      ...prev,
      [filePath]: { loading: true, content: null, error: null },
    }));

    try {
      const content = await invoke<WorkspaceFileContent>("read_workspace_file", {
        request: {
          cwd: workspaceInput.trim() || null,
          relativePath: filePath,
        },
      });
      if (workspaceRequestId.current !== requestToken) {
        return;
      }
      setFilesByPath((prev) => ({
        ...prev,
        [filePath]: { loading: false, content, error: null },
      }));
    } catch (error) {
      if (workspaceRequestId.current !== requestToken) {
        return;
      }
      setFilesByPath((prev) => ({
        ...prev,
        [filePath]: { loading: false, content: null, error: messageOf(error) },
      }));
    }
  }

  function handleCloseTab(targetPath: string): void {
    const { nextTabs, nextActiveTab } = closeFileTab(openTabs, activeTabPath, targetPath);
    setOpenTabs(nextTabs);
    setActiveTabPath(nextActiveTab);
    setFilesByPath((prev) => {
      if (!(targetPath in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[targetPath];
      return next;
    });
    setCopied(false);
  }

  const activeFileState = activeTabPath ? filesByPath[activeTabPath] : undefined;
  const fileContent = activeFileState?.content ?? null;
  const fileLoading = activeFileState?.loading ?? false;
  const fileError = activeFileState?.error ?? null;

  async function handleCopyPath(): Promise<void> {
    if (!fileContent || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(fileContent.path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  }

  const wheelWorkspaces = useMemo(
    () => buildWorkspaceWheelList(workspaceInput, recentWorkspaces),
    [workspaceInput, recentWorkspaces],
  );

  const rootEntries = (childrenByPath[""] ?? []).filter(
    (entry) => !entry.name.startsWith("."),
  );
  const rootLoading = loadingDirs.has("");
  const effectiveCodeTheme = useThemeStore((s) => s.effectiveCodeTheme);
  const codePalette = useMemo(
    () => getCodeThemePalette(effectiveCodeTheme),
    [effectiveCodeTheme],
  );

  const lines = useMemo(() => {
    if (!fileContent || fileContent.isBinary) {
      return [];
    }
    return fileContent.content.split("\n");
  }, [fileContent]);

  const tokenizedLines = useMemo(
    () => tokenizeCodeLines(lines, fileContent?.extension ?? null),
    [lines, fileContent?.extension],
  );

  return (
    <motion.section
      key="files"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="flex min-h-0 flex-1 overflow-hidden"
      aria-label="Project Files"
    >
      {/* VS Code-style Explorer Sidebar */}
      <aside className="flex min-h-0 w-[268px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-[10.5px] font-semibold tracking-[0.08em] text-muted uppercase">
              Explorer
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {onPickWorkspace ? (
              <button
                type="button"
                onClick={onPickWorkspace}
                className="grid h-6 w-6 place-items-center rounded-[6px] text-muted transition-colors hover:bg-surface-subtle hover:text-ink"
                title="Open Folder"
                aria-label="Open Folder"
              >
                <FolderIcon size={13} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setExpandedDirs(new Set())}
              className="grid h-6 w-6 place-items-center rounded-[6px] text-muted transition-colors hover:bg-surface-subtle hover:text-ink"
              title="Collapse All"
              aria-label="Collapse All"
            >
              <ChevronRightIcon size={13} />
            </button>
            <button
              type="button"
              onClick={refreshRoot}
              disabled={rootLoading}
              className="grid h-6 w-6 place-items-center rounded-[6px] text-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
              title="Refresh Explorer"
              aria-label="Refresh Explorer"
            >
              <RefreshIcon size={13} />
            </button>
          </div>
        </div>

        <WorkspaceWheel
          workspaces={wheelWorkspaces}
          currentWorkspace={workspaceInput}
          onSelectWorkspace={onSelectWorkspace}
          onDeleteWorkspace={onDeleteWorkspace}
          onPickWorkspace={onPickWorkspace}
        />

        <div className="border-b border-line px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 focus-within:border-line-strong">
            <input
              type="text"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Filter files..."
              aria-label="Filter files"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-muted focus:outline-none"
            />
            {filterQuery ? (
              <button
                type="button"
                onClick={() => setFilterQuery("")}
                className="text-muted hover:text-ink"
                aria-label="Clear filter"
              >
                <CloseIcon size={12} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {!workspaceInput.trim() ? (
            <div className="px-3 py-4 text-[12px] text-muted">
              未选择文件夹
            </div>
          ) : treeError ? (
            <div className="px-3 py-4 text-[12px] text-rose-500">{treeError}</div>
          ) : rootLoading && rootEntries.length === 0 ? (
            <div className="px-3 py-4 font-code text-[11.5px] text-muted">
              Loading files...
            </div>
          ) : rootEntries.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-muted">
              Empty directory
            </div>
          ) : (
            <TreeRows
              parentPath=""
              depth={0}
              childrenByPath={childrenByPath}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              selectedPath={activeTabPath}
              filterQuery={filterQuery}
              onToggleDir={handleToggleDir}
              onSelectFile={(path) => void handleSelectFile(path)}
            />
          )}
        </div>
      </aside>

      {/* File Preview Area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        {openTabs.length > 0 ? (
          <div
            role="tablist"
            aria-label="Open files"
            className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-sidebar/70"
          >
            {openTabs.map((tabPath) => {
              const isActive = tabPath === activeTabPath;
              const name = fileNameOf(tabPath);
              const ext = extensionOf(tabPath);
              return (
                <div
                  key={tabPath}
                  role="tab"
                  aria-selected={isActive}
                  title={tabPath}
                  onMouseDown={(event) => {
                    if (event.button === 1) {
                      event.preventDefault();
                      handleCloseTab(tabPath);
                    }
                  }}
                  className={`group flex max-w-[200px] shrink-0 items-center border-r border-line transition-colors ${
                    isActive
                      ? "border-b-2 border-b-ink bg-canvas text-ink"
                      : "bg-transparent text-muted hover:bg-surface-subtle/60 hover:text-ink"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleSelectFile(tabPath)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-1 pl-3 text-left text-[12px]"
                  >
                    <FileIcon size={13} className={fileAccentClass(ext)} />
                    <span className={`truncate ${isActive ? "font-medium" : ""}`}>
                      {name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseTab(tabPath);
                    }}
                    aria-label={`Close ${name}`}
                    title={`Close ${name}`}
                    className={`mr-1.5 grid h-4 w-4 shrink-0 place-items-center rounded-[4px] transition-opacity hover:bg-surface-subtle hover:text-ink ${
                      isActive ? "opacity-80" : "opacity-0 group-hover:opacity-80"
                    }`}
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {fileLoading ? (
          <div className="flex flex-1 items-center justify-center font-code text-xs text-muted">
            Loading file...
          </div>
        ) : fileError ? (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-rose-500">
            {fileError}
          </div>
        ) : fileContent ? (
          <>
            <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-line bg-sidebar/50 px-4">
              <div className="flex min-w-0 items-center gap-2">
                <FileIcon size={14} className={fileAccentClass(fileContent.extension)} />
                <span className="truncate font-code text-[12px] text-ink">
                  {fileContent.path}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-code text-[11px] text-muted">
                  {fileContent.isBinary
                    ? formatFileSize(fileContent.size)
                    : `${fileContent.lineCount} lines · ${formatFileSize(fileContent.size)}`}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyPath()}
                  className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-surface px-2 text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                  title="Copy relative path"
                >
                  {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  <span>{copied ? "Copied" : "Copy path"}</span>
                </button>
              </div>
            </div>

            {fileContent.truncated ? (
              <div className="border-b border-line bg-amber-500/10 px-4 py-1.5 font-code text-[11px] text-amber-700 dark:text-amber-300">
                File is larger than 512 KB — showing truncated preview.
              </div>
            ) : null}

            {fileContent.isBinary ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
                <FilesIcon size={28} />
                <p className="text-sm font-medium text-ink">Binary file</p>
                <p className="font-code text-xs text-muted">
                  {fileContent.name} ({formatFileSize(fileContent.size)}) cannot be previewed as text.
                </p>
              </div>
            ) : (
              <div
                className="min-h-0 flex-1 overflow-auto py-3 transition-colors duration-150"
                data-code-theme={effectiveCodeTheme}
                style={{
                  backgroundColor: codePalette.background,
                  color: codePalette.foreground,
                }}
              >
                <table className="w-full border-collapse font-code text-[12.5px] leading-[1.6]">
                  <tbody>
                    {tokenizedLines.map((tokens, index) => (
                      <tr
                        key={index}
                        style={{ ["--code-line-hover" as string]: codePalette.lineHover }}
                        className="hover:bg-[var(--code-line-hover)]"
                      >
                        <td
                          className="w-12 select-none pr-4 pl-4 text-right align-top text-[11px]"
                          style={{ color: codePalette.lineNumber }}
                        >
                          {index + 1}
                        </td>
                        <td className="pr-6 whitespace-pre">
                          {tokens.length === 0
                            ? " "
                            : tokens.map((token, tokenIdx) =>
                                token.type === "plain" ? (
                                  <span key={tokenIdx}>{token.text}</span>
                                ) : (
                                  <span
                                    key={tokenIdx}
                                    style={{ color: tokenColor(token.type, codePalette) }}
                                  >
                                    {token.text}
                                  </span>
                                ),
                              )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 text-center text-muted">
            <FilesIcon size={32} />
            <div className="text-sm font-medium text-ink-soft">
              {workspaceInput.trim() ? workspaceName(workspaceInput) : "未选择文件夹"}
            </div>
            <p className="max-w-xs text-xs text-muted">
              {workspaceInput.trim()
                ? "Select a file from the explorer sidebar to inspect its contents."
                : "Open a folder to browse and inspect its files."}
            </p>
          </div>
        )}
      </div>
    </motion.section>
  );
}
