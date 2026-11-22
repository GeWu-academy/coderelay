import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  GitBranchIcon,
  GitCommitIcon,
  MinusIcon,
  PlusIcon,
  RefreshIcon,
  SparkleIcon,
  TrashIcon,
  UndoIcon,
} from "../../components/icons";
import type {
  GitActionResult,
  GitBranchInfo,
  GitDiffResult,
  GitOutputEntry,
  GitSortMode,
  GitStatusEntry,
  GitStatusResult,
  GitSyncAction,
  GitViewMode,
} from "../../types";
import { messageOf, workspaceName } from "../../utils";
import {
  applyCommitTypePrefix,
  COMMIT_MESSAGE_PRESETS,
  COMMIT_TYPE_PRESETS,
  type CommitType,
  detectCommitType,
} from "./commitPresets";
import { ScmActionDialog, type ScmDialogState } from "./ScmActionDialog";
import { ScmMoreMenu } from "./ScmMoreMenu";
import { ScmOutputPanel } from "./ScmOutputPanel";
import { buildGitEntryTree, type ScmTreeNode, sortGitEntries, splitPathParts } from "./scmTree";

export interface ScmViewProps {
  workspaceInput: string;
  selectedAgentId?: string | null;
  selectedModelId?: string | null;
  onPickWorkspace?: () => void;
  onSelectWorkspace?: (path: string) => void;
}

interface SelectedDiffTarget {
  path: string;
  staged: boolean;
  untracked: boolean;
}

interface ParsedDiffLine {
  key: string;
  kind: "meta" | "hunk" | "add" | "del" | "context";
  text: string;
}

function parseDiffLines(diff: string): ParsedDiffLine[] {
  if (!diff) {
    return [];
  }
  return diff.split("\n").map((line, index) => {
    let kind: ParsedDiffLine["kind"] = "context";
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode")
    ) {
      kind = "meta";
    } else if (line.startsWith("@@")) {
      kind = "hunk";
    } else if (line.startsWith("+")) {
      kind = "add";
    } else if (line.startsWith("-")) {
      kind = "del";
    }
    return { key: `${index}-${line.slice(0, 16)}`, kind, text: line };
  });
}

function statusBadge(
  entry: GitStatusEntry,
  staged: boolean,
): { label: string; colorClass: string } {
  if (entry.conflicted) {
    return { label: "C", colorClass: "text-rose-600 dark:text-rose-400" };
  }
  if (entry.untracked && !staged) {
    return { label: "U", colorClass: "text-emerald-600 dark:text-emerald-400" };
  }
  const code = staged ? entry.indexStatus : entry.worktreeStatus;
  if (code === "A") {
    return { label: "A", colorClass: "text-emerald-600 dark:text-emerald-400" };
  }
  if (code === "D") {
    return { label: "D", colorClass: "text-rose-600 dark:text-rose-400" };
  }
  if (code === "R") {
    return { label: "R", colorClass: "text-sky-600 dark:text-sky-400" };
  }
  return { label: "M", colorClass: "text-amber-600 dark:text-amber-400" };
}

function diffLineClass(kind: ParsedDiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300";
    case "del":
      return "bg-rose-500/12 text-rose-700 dark:text-rose-300";
    case "hunk":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "meta":
      return "text-dim";
    default:
      return "text-ink/90";
  }
}

export function ScmView({
  workspaceInput,
  selectedAgentId,
  selectedModelId,
  onPickWorkspace,
  onSelectWorkspace,
}: ScmViewProps) {
  const cwd = workspaceInput.trim();

  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [selectedTarget, setSelectedTarget] = useState<SelectedDiffTarget | null>(null);
  const [diffResult, setDiffResult] = useState<GitDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [commitMessage, setCommitMessage] = useState("");
  const [generatingCommit, setGeneratingCommit] = useState(false);
  const [openCommitMenu, setOpenCommitMenu] = useState<"type" | "preset" | null>(null);
  const commitTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const commitMenuRef = useRef<HTMLDivElement | null>(null);
  const activeCommitType = useMemo(() => detectCommitType(commitMessage), [commitMessage]);

  useEffect(() => {
    if (!openCommitMenu) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (commitMenuRef.current && !commitMenuRef.current.contains(event.target as Node)) {
        setOpenCommitMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenCommitMenu(null);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openCommitMenu]);

  const [branchPanelOpen, setBranchPanelOpen] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [pendingDeleteBranch, setPendingDeleteBranch] = useState<string | null>(null);
  const [pendingDiscardPath, setPendingDiscardPath] = useState<string | null>(null);
  const newBranchInputRef = useRef<HTMLInputElement | null>(null);

  const [viewMode, setViewMode] = useState<GitViewMode>("list");
  const [sortMode, setSortMode] = useState<GitSortMode>("path");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [activeDialog, setActiveDialog] = useState<ScmDialogState | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputEntries, setOutputEntries] = useState<GitOutputEntry[]>([]);
  const [outputLoading, setOutputLoading] = useState(false);

  const loadOutputLog = useCallback(async () => {
    setOutputLoading(true);
    try {
      const entries = await invoke<GitOutputEntry[]>("git_output_log");
      setOutputEntries(entries);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setOutputLoading(false);
    }
  }, []);

  useEffect(() => {
    if (outputOpen) {
      void loadOutputLog();
    }
  }, [outputOpen, loadOutputLog]);

  const loadDiff = useCallback(
    async (target: SelectedDiffTarget | null) => {
      if (!cwd || !target) {
        setDiffResult(null);
        return;
      }
      setDiffLoading(true);
      try {
        const res = await invoke<GitDiffResult>("git_diff", {
          request: {
            cwd,
            path: target.path,
            staged: target.staged,
            untracked: target.untracked,
          },
        });
        setDiffResult(res);
      } catch (err) {
        setError(messageOf(err));
        setDiffResult(null);
      } finally {
        setDiffLoading(false);
      }
    },
    [cwd],
  );

  const refreshAll = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      setBranches([]);
      setSelectedTarget(null);
      setDiffResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextStatus = await invoke<GitStatusResult>("git_status", {
        request: { cwd },
      });
      setStatus(nextStatus);
      if (nextStatus.isRepo) {
        const nextBranches = await invoke<GitBranchInfo[]>("git_branches", {
          request: { cwd },
        });
        setBranches(nextBranches);
      } else {
        setBranches([]);
        setSelectedTarget(null);
        setDiffResult(null);
      }
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void loadDiff(selectedTarget);
  }, [loadDiff, selectedTarget]);

  const stagedEntries = useMemo(
    () =>
      sortGitEntries(
        (status?.entries ?? []).filter((e) => e.staged),
        sortMode,
        true,
      ),
    [status, sortMode],
  );

  const unstagedEntries = useMemo(
    () =>
      sortGitEntries(
        (status?.entries ?? []).filter((e) => e.unstaged || e.untracked || e.conflicted),
        sortMode,
        false,
      ),
    [status, sortMode],
  );

  const stagedTree = useMemo(
    () => buildGitEntryTree(stagedEntries, sortMode, true),
    [stagedEntries, sortMode],
  );

  const unstagedTree = useMemo(
    () => buildGitEntryTree(unstagedEntries, sortMode, false),
    [unstagedEntries, sortMode],
  );

  const localBranches = useMemo(() => {
    const q = branchFilter.trim().toLowerCase();
    return branches.filter((b) => !b.isRemote && (!q || b.name.toLowerCase().includes(q)));
  }, [branches, branchFilter]);

  const remoteBranches = useMemo(() => {
    const q = branchFilter.trim().toLowerCase();
    return branches.filter((b) => b.isRemote && (!q || b.name.toLowerCase().includes(q)));
  }, [branches, branchFilter]);

  const parsedDiffLines = useMemo(() => parseDiffLines(diffResult?.diff ?? ""), [diffResult]);

  async function runAction(label: string, fn: () => Promise<void>) {
    setBusyAction(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      await refreshAll();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (outputOpen) {
        void loadOutputLog();
      }
      setBusyAction(null);
    }
  }

  function toggleFolder(folderKey: string) {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderKey]: !prev[folderKey],
    }));
  }

  function handleCommitWithOptions(options: { all?: boolean; amend?: boolean }) {
    const trimmed = commitMessage.trim();
    if (!trimmed && !options.amend) {
      setError("请输入提交信息");
      return;
    }
    void runAction("commit", async () => {
      const res = await invoke<GitActionResult>("git_commit", {
        request: {
          cwd,
          message: trimmed,
          amend: Boolean(options.amend),
          all: Boolean(options.all),
        },
      });
      setCommitMessage("");
      setSelectedTarget(null);
      setNotice(res.message || "提交成功");
    });
  }

  function handleUndoLastCommit() {
    void runAction("undo-commit", async () => {
      const res = await invoke<GitActionResult>("git_undo_last_commit", {
        request: { cwd },
      });
      setNotice(res.message || "已撤销上次提交");
    });
  }

  function handleStashPopLatest() {
    void runAction("stash-pop", async () => {
      const res = await invoke<GitActionResult>("git_stash_pop", {
        request: { cwd, reference: null },
      });
      setNotice(res.message || "已弹出最新存储");
    });
  }

  function handleStashApplyLatest() {
    void runAction("stash-apply", async () => {
      const res = await invoke<GitActionResult>("git_stash_apply", {
        request: { cwd, reference: null },
      });
      setNotice(res.message || "已应用最新存储");
    });
  }

  async function handleClearOutputLog() {
    try {
      await invoke("git_clear_output_log");
      setOutputEntries([]);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  function handleStage(paths: string[], all = false) {
    void runAction("stage", async () => {
      await invoke("git_stage", { request: { cwd, paths, all } });
      if (
        selectedTarget &&
        !selectedTarget.staged &&
        (all || paths.includes(selectedTarget.path))
      ) {
        setSelectedTarget({ path: selectedTarget.path, staged: true, untracked: false });
      }
    });
  }

  function handleUnstage(paths: string[], all = false) {
    void runAction("unstage", async () => {
      await invoke("git_unstage", { request: { cwd, paths, all } });
      if (selectedTarget && selectedTarget.staged && (all || paths.includes(selectedTarget.path))) {
        setSelectedTarget({ path: selectedTarget.path, staged: false, untracked: false });
      }
    });
  }

  function handleDiscard(entry: GitStatusEntry) {
    if (pendingDiscardPath !== entry.path) {
      setPendingDiscardPath(entry.path);
      return;
    }
    setPendingDiscardPath(null);
    void runAction("discard", async () => {
      await invoke("git_discard", {
        request: { cwd, paths: [entry.path], untracked: entry.untracked },
      });
      if (selectedTarget?.path === entry.path && !selectedTarget.staged) {
        setSelectedTarget(null);
      }
      setNotice(`已放弃更改: ${entry.path}`);
    });
  }

  function focusCommitInputAtEnd(nextLength: number) {
    requestAnimationFrame(() => {
      const textarea = commitTextareaRef.current;
      if (!textarea) {
        return;
      }
      textarea.focus();
      textarea.setSelectionRange(nextLength, nextLength);
    });
  }

  function handleSelectCommitType(type: CommitType) {
    const next = applyCommitTypePrefix(commitMessage, type);
    setCommitMessage(next);
    setOpenCommitMenu(null);
    focusCommitInputAtEnd(next.length);
  }

  function handleApplyCommitPreset(message: string) {
    setCommitMessage(message);
    setOpenCommitMenu(null);
    focusCommitInputAtEnd(message.length);
  }

  function handleCommit() {
    const trimmed = commitMessage.trim();
    if (!trimmed) {
      setError("请输入提交信息");
      return;
    }
    void runAction("commit", async () => {
      const res = await invoke<GitActionResult>("git_commit", {
        request: { cwd, message: trimmed, amend: false },
      });
      setCommitMessage("");
      setSelectedTarget(null);
      setNotice(res.message || "提交成功");
    });
  }

  async function handleGenerateCommitMessage() {
    if (!cwd) {
      return;
    }
    setGeneratingCommit(true);
    setError(null);
    setNotice(null);
    try {
      const generated = await invoke<string>("git_generate_commit_message", {
        request: {
          cwd,
          agent: selectedAgentId || null,
          model: selectedModelId || null,
        },
      });
      setCommitMessage(generated);
      setNotice("已生成提交信息");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setGeneratingCommit(false);
    }
  }

  function handleSync(action: GitSyncAction) {
    void runAction(action, async () => {
      const res = await invoke<GitActionResult>("git_sync", {
        request: { cwd, action },
      });
      setNotice(res.message);
    });
  }

  function handleCheckout(branch: string, create = false) {
    void runAction("checkout", async () => {
      const res = await invoke<GitActionResult>("git_checkout", {
        request: { cwd, branch, create },
      });
      setBranchPanelOpen(false);
      setNewBranchName("");
      setSelectedTarget(null);
      setNotice(res.message);
    });
  }

  function handleDeleteBranch(branch: string) {
    if (pendingDeleteBranch !== branch) {
      setPendingDeleteBranch(branch);
      return;
    }
    setPendingDeleteBranch(null);
    void runAction("delete-branch", async () => {
      const res = await invoke<GitActionResult>("git_delete_branch", {
        request: { cwd, branch, force: false },
      });
      setNotice(res.message || `已删除分支 ${branch}`);
    });
  }

  function handleInitRepo() {
    void runAction("init", async () => {
      const res = await invoke<GitActionResult>("git_init", {
        request: { cwd },
      });
      setNotice(res.message || "Git 仓库初始化成功");
    });
  }

  if (!cwd) {
    return (
      <motion.div
        animate={{ opacity: 1 }}
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
      >
        <GitBranchIcon size={32} className="text-muted" />
        <p className="text-sm font-medium text-ink">尚未选择工作区</p>
        <p className="max-w-sm text-xs text-muted">
          选择一个本地项目目录后，即可查看 Git 变更、对比 Diff、管理分支并提交代码。
        </p>
        {onPickWorkspace ? (
          <button
            className="mt-1 rounded-[8px] border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle"
            onClick={onPickWorkspace}
            type="button"
          >
            选择工作区目录
          </button>
        ) : null}
      </motion.div>
    );
  }

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex min-h-0 flex-1 overflow-hidden bg-canvas"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      {/* Left Pane: Branch bar, Commit box, Staged & Changes */}
      <aside className="flex min-h-0 w-[330px] shrink-0 flex-col border-r border-line bg-sidebar">
        {/* Header: Workspace + Branch + Sync actions */}
        <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold tracking-tight text-ink">
                {workspaceName(cwd)}
              </p>
              <p className="text-[11px] text-muted">源代码管理</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label="Fetch"
                className="grid h-7 w-7 place-items-center rounded-[7px] text-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
                disabled={!status?.isRepo || Boolean(busyAction)}
                onClick={() => handleSync("fetch")}
                title="Fetch (--prune)"
                type="button"
              >
                <RefreshIcon
                  className={
                    busyAction === "fetch"
                      ? "origin-center animate-spin [animation-duration:750ms]"
                      : ""
                  }
                  size={14}
                />
              </button>
              <button
                aria-label="Pull"
                className="grid h-7 w-7 place-items-center rounded-[7px] text-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
                disabled={!status?.isRepo || Boolean(busyAction)}
                onClick={() => handleSync("pull")}
                title={`Pull${status?.behind ? ` (${status.behind} behind)` : ""}`}
                type="button"
              >
                <ArrowDownIcon size={14} />
              </button>
              <button
                aria-label="Push"
                className="grid h-7 w-7 place-items-center rounded-[7px] text-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
                disabled={!status?.isRepo || Boolean(busyAction)}
                onClick={() => handleSync("push")}
                title={`Push${status?.ahead ? ` (${status.ahead} ahead)` : ""}`}
                type="button"
              >
                <ArrowUpIcon size={14} />
              </button>
              <ScmMoreMenu
                busy={Boolean(busyAction)}
                hasCommitMessage={Boolean(commitMessage.trim())}
                hasStaged={stagedEntries.length > 0}
                hasUnstaged={unstagedEntries.length > 0}
                isRepo={Boolean(status?.isRepo)}
                onChangeSortMode={setSortMode}
                onCommitAll={() => handleCommitWithOptions({ all: true })}
                onCommitAmend={() => handleCommitWithOptions({ amend: true })}
                onCommitStaged={handleCommit}
                onOpenCheckout={() => setBranchPanelOpen(true)}
                onOpenClone={() => setActiveDialog({ kind: "clone" })}
                onOpenCreateBranch={() => {
                  setBranchPanelOpen(true);
                  requestAnimationFrame(() => newBranchInputRef.current?.focus());
                }}
                onOpenDeleteBranch={() => setBranchPanelOpen(true)}
                onOpenDiscardAll={() => setActiveDialog({ kind: "discard-all" })}
                onOpenMergeBranch={() => setActiveDialog({ kind: "merge-branch" })}
                onOpenRebaseBranch={() => setActiveDialog({ kind: "rebase-branch" })}
                onOpenRemotes={() => setActiveDialog({ kind: "remotes" })}
                onOpenRenameBranch={() => setActiveDialog({ kind: "rename-branch" })}
                onOpenStashCreate={(includeUntracked) =>
                  setActiveDialog({ kind: "stash-create", includeUntracked })
                }
                onOpenStashList={() => setActiveDialog({ kind: "stash-list" })}
                onOpenTagCreate={() => setActiveDialog({ kind: "tag-create" })}
                onOpenTagList={() => setActiveDialog({ kind: "tag-list" })}
                onStageAll={() => handleStage([], true)}
                onStashApplyLatest={handleStashApplyLatest}
                onStashPopLatest={handleStashPopLatest}
                onSync={handleSync}
                onToggleOutput={() => setOutputOpen((prev) => !prev)}
                onToggleViewMode={() => setViewMode((prev) => (prev === "tree" ? "list" : "tree"))}
                onUndoLastCommit={handleUndoLastCommit}
                onUnstageAll={() => handleUnstage([], true)}
                outputOpen={outputOpen}
                sortMode={sortMode}
                viewMode={viewMode}
              />
            </div>
          </div>

          {status?.isRepo ? (
            <div className="relative">
              <button
                aria-expanded={branchPanelOpen}
                className="flex w-full items-center justify-between gap-2 rounded-[8px] border border-line bg-surface px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-subtle"
                onClick={() => setBranchPanelOpen((prev) => !prev)}
                type="button"
              >
                <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
                  <GitBranchIcon size={14} className="text-muted" />
                  <span className="truncate">{status.branch}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                  {status.ahead > 0 ? <span>↑{status.ahead}</span> : null}
                  {status.behind > 0 ? <span>↓{status.behind}</span> : null}
                  <ChevronDownIcon size={11} />
                </span>
              </button>

              <AnimatePresence>
                {branchPanelOpen ? (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute right-0 left-0 z-20 mt-1.5 flex max-h-[340px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface shadow-lg"
                    exit={{ opacity: 0, y: -4 }}
                    initial={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                  >
                    <div className="border-b border-line p-2">
                      <input
                        aria-label="搜索分支"
                        className="w-full rounded-[6px] border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-ink/40"
                        onChange={(e) => setBranchFilter(e.target.value)}
                        placeholder="搜索本地或远程分支..."
                        value={branchFilter}
                      />
                      <div className="mt-1.5 flex items-center gap-1">
                        <input
                          aria-label="新分支名称"
                          className="min-w-0 flex-1 rounded-[6px] border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-ink/40"
                          onChange={(e) => setNewBranchName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && newBranchName.trim()) {
                              handleCheckout(newBranchName.trim(), true);
                            }
                          }}
                          placeholder="新建分支名..."
                          ref={newBranchInputRef}
                          value={newBranchName}
                        />
                        <button
                          className="rounded-[6px] bg-ink px-2 py-1 text-[11px] font-medium text-canvas disabled:opacity-40"
                          disabled={!newBranchName.trim() || Boolean(busyAction)}
                          onClick={() => handleCheckout(newBranchName.trim(), true)}
                          type="button"
                        >
                          创建
                        </button>
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                      <p className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                        本地分支 ({localBranches.length})
                      </p>
                      {localBranches.map((b) => (
                        <div
                          key={b.fullName}
                          className="group flex items-center justify-between gap-1 rounded-[6px] px-2 py-1 text-xs hover:bg-surface-subtle"
                        >
                          <button
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            onClick={() => {
                              if (!b.isCurrent) {
                                handleCheckout(b.name, false);
                              } else {
                                setBranchPanelOpen(false);
                              }
                            }}
                            type="button"
                          >
                            {b.isCurrent ? (
                              <CheckIcon size={12} className="shrink-0 text-emerald-500" />
                            ) : (
                              <span className="w-3 shrink-0" />
                            )}
                            <span className="truncate font-medium text-ink">{b.name}</span>
                          </button>
                          {!b.isCurrent ? (
                            <button
                              aria-label={`删除分支 ${b.name}`}
                              className={`rounded px-1 py-0.5 text-[10px] transition-colors ${
                                pendingDeleteBranch === b.name
                                  ? "bg-rose-500 text-white"
                                  : "text-muted opacity-0 group-hover:opacity-100 hover:text-rose-500"
                              }`}
                              onClick={() => handleDeleteBranch(b.name)}
                              title={
                                pendingDeleteBranch === b.name ? "再次点击确认删除" : "删除分支"
                              }
                              type="button"
                            >
                              {pendingDeleteBranch === b.name ? "确认" : <TrashIcon size={12} />}
                            </button>
                          ) : null}
                        </div>
                      ))}

                      {remoteBranches.length > 0 ? (
                        <>
                          <p className="mt-2 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                            远程分支 ({remoteBranches.length})
                          </p>
                          {remoteBranches.map((b) => (
                            <button
                              key={b.fullName}
                              className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-left text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                              onClick={() => handleCheckout(b.name, false)}
                              type="button"
                            >
                              <GitBranchIcon size={12} />
                              <span className="truncate">{b.name}</span>
                            </button>
                          ))}
                        </>
                      ) : null}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : null}
        </div>

        {/* Commit Box */}
        {status?.isRepo ? (
          <div className="border-b border-line p-3">
            <textarea
              aria-label="提交信息"
              className="w-full resize-none rounded-[8px] border border-line bg-surface px-2.5 py-2 text-xs text-ink outline-none placeholder:text-dim focus:border-ink/40"
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  handleCommit();
                }
              }}
              placeholder="输入提交信息 (⌘+Enter 提交)..."
              ref={commitTextareaRef}
              rows={3}
              value={commitMessage}
            />
            <div className="relative mt-1.5" ref={commitMenuRef}>
              <div className="flex items-center gap-1.5">
                <button
                  aria-expanded={openCommitMenu === "type"}
                  aria-haspopup="menu"
                  className={`flex flex-1 items-center justify-between gap-1 rounded-[7px] border px-2 py-1 text-[11px] transition-colors ${
                    openCommitMenu === "type" || activeCommitType
                      ? "border-ink/35 bg-surface-subtle text-ink"
                      : "border-line bg-surface text-muted hover:bg-surface-subtle hover:text-ink"
                  }`}
                  onClick={() => setOpenCommitMenu((prev) => (prev === "type" ? null : "type"))}
                  type="button"
                >
                  <span className="truncate">
                    {activeCommitType ? (
                      <>
                        类型:{" "}
                        <span className="font-mono font-medium text-ink">{activeCommitType}</span>
                      </>
                    ) : (
                      "选择类型"
                    )}
                  </span>
                  <ChevronDownIcon
                    className={`shrink-0 transition-transform ${openCommitMenu === "type" ? "rotate-180" : ""}`}
                    size={10}
                  />
                </button>
                <button
                  aria-expanded={openCommitMenu === "preset"}
                  aria-haspopup="menu"
                  className={`flex flex-1 items-center justify-between gap-1 rounded-[7px] border px-2 py-1 text-[11px] transition-colors ${
                    openCommitMenu === "preset"
                      ? "border-ink/35 bg-surface-subtle text-ink"
                      : "border-line bg-surface text-muted hover:bg-surface-subtle hover:text-ink"
                  }`}
                  onClick={() => setOpenCommitMenu((prev) => (prev === "preset" ? null : "preset"))}
                  type="button"
                >
                  <span className="truncate">常用预设</span>
                  <ChevronDownIcon
                    className={`shrink-0 transition-transform ${openCommitMenu === "preset" ? "rotate-180" : ""}`}
                    size={10}
                  />
                </button>
              </div>

              <AnimatePresence>
                {openCommitMenu === "type" ? (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    aria-label="提交类型快捷前缀"
                    className="absolute right-0 left-0 z-20 mt-1.5 grid grid-cols-2 gap-1 rounded-[10px] border border-line bg-surface p-1.5 shadow-lg"
                    exit={{ opacity: 0, y: -4 }}
                    initial={{ opacity: 0, y: -4 }}
                    role="menu"
                    transition={{ duration: 0.12 }}
                  >
                    {COMMIT_TYPE_PRESETS.map((item) => {
                      const selected = activeCommitType === item.type;
                      return (
                        <button
                          className={`flex items-center justify-between gap-1.5 rounded-[6px] px-2 py-1.5 text-left transition-colors ${
                            selected ? "bg-ink text-canvas" : "text-ink hover:bg-surface-subtle"
                          }`}
                          key={item.type}
                          onClick={() => handleSelectCommitType(item.type)}
                          role="menuitem"
                          type="button"
                        >
                          <span className="font-mono text-[11px] font-medium">{item.label}</span>
                          <span
                            className={`truncate text-[10.5px] ${
                              selected ? "text-canvas/75" : "text-muted"
                            }`}
                          >
                            {item.description}
                          </span>
                        </button>
                      );
                    })}
                  </motion.div>
                ) : null}

                {openCommitMenu === "preset" ? (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    aria-label="常用提交预设"
                    className="absolute right-0 left-0 z-20 mt-1.5 flex flex-col gap-0.5 rounded-[10px] border border-line bg-surface p-1.5 shadow-lg"
                    exit={{ opacity: 0, y: -4 }}
                    initial={{ opacity: 0, y: -4 }}
                    role="menu"
                    transition={{ duration: 0.12 }}
                  >
                    {COMMIT_MESSAGE_PRESETS.map((preset) => {
                      const active = commitMessage.trim() === preset.message;
                      return (
                        <button
                          className={`flex items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors ${
                            active
                              ? "bg-surface-subtle font-medium text-ink"
                              : "text-ink hover:bg-surface-subtle"
                          }`}
                          key={preset.id}
                          onClick={() => handleApplyCommitPreset(preset.message)}
                          role="menuitem"
                          type="button"
                        >
                          <span className="shrink-0 text-[11px] font-medium">{preset.label}</span>
                          <span className="truncate font-mono text-[10.5px] text-muted">
                            {preset.message}
                          </span>
                        </button>
                      );
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                className="flex items-center justify-center gap-1 rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-subtle disabled:opacity-45"
                disabled={
                  generatingCommit || Boolean(busyAction) || (status?.entries.length ?? 0) === 0
                }
                onClick={() => void handleGenerateCommitMessage()}
                title="根据当前变更调用默认 Agent 生成 Commit Message"
                type="button"
              >
                <SparkleIcon size={13} />
                <span>{generatingCommit ? "生成中..." : "AI 生成"}</span>
              </button>
              <button
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
                disabled={
                  !commitMessage.trim() || stagedEntries.length === 0 || Boolean(busyAction)
                }
                onClick={handleCommit}
                type="button"
              >
                <GitCommitIcon size={14} />
                <span>提交 ({stagedEntries.length})</span>
              </button>
            </div>
            {(() => {
              const needsPublish = !status.detached && !status.upstream;
              const isSyncing = busyAction === "sync";
              const syncCounts = [
                status.behind > 0 ? `↓${status.behind}` : null,
                status.ahead > 0 ? `↑${status.ahead}` : null,
              ]
                .filter(Boolean)
                .join(" ");
              const highlightSync =
                stagedEntries.length === 0 && (needsPublish || Boolean(syncCounts));
              const syncLabel = isSyncing
                ? "正在同步远程分支..."
                : needsPublish
                  ? "发布并同步远程分支"
                  : syncCounts
                    ? `同步远程分支 (${syncCounts})`
                    : "同步远程分支";
              return (
                <button
                  aria-busy={isSyncing}
                  className={`relative mt-1.5 flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-[7px] px-3 py-1.5 text-xs font-medium transition-all ${
                    isSyncing ? "cursor-wait" : "disabled:opacity-40"
                  } ${
                    highlightSync
                      ? "bg-ink text-canvas hover:opacity-90"
                      : isSyncing
                        ? "border border-line-strong bg-surface-subtle text-ink"
                        : "border border-line bg-surface text-ink hover:bg-surface-subtle"
                  }`}
                  disabled={Boolean(busyAction) || status.detached}
                  onClick={() => handleSync("sync")}
                  title={
                    status.detached
                      ? "当前处于游离 HEAD 状态，无法同步远程分支"
                      : needsPublish
                        ? "将当前分支推送到远程并关联上游 (git push -u origin)"
                        : "拉取并推送远程分支变更 (git pull && git push)"
                  }
                  type="button"
                >
                  {isSyncing ? (
                    <>
                      <motion.span
                        animate={{ x: ["-100%", "260%"] }}
                        aria-hidden="true"
                        className={`pointer-events-none absolute inset-y-0 left-0 w-1/2 -skew-x-12 ${
                          highlightSync
                            ? "bg-gradient-to-r from-transparent via-canvas/25 to-transparent"
                            : "bg-gradient-to-r from-transparent via-ink/12 to-transparent"
                        }`}
                        initial={{ x: "-100%" }}
                        transition={{
                          duration: 1.1,
                          ease: "easeInOut",
                          repeat: Infinity,
                        }}
                      />
                      <motion.span
                        animate={{ x: ["-100%", "260%"] }}
                        aria-hidden="true"
                        className={`pointer-events-none absolute bottom-0 left-0 h-[2px] w-2/5 rounded-full ${
                          highlightSync ? "bg-canvas/70" : "bg-ink/45"
                        }`}
                        initial={{ x: "-100%" }}
                        transition={{
                          duration: 1.1,
                          ease: "easeInOut",
                          repeat: Infinity,
                        }}
                      />
                    </>
                  ) : null}
                  <RefreshIcon
                    className={`relative z-10 origin-center ${isSyncing ? "animate-spin [animation-duration:750ms]" : ""}`.trim()}
                    size={13}
                  />
                  <span className="relative z-10">{syncLabel}</span>
                </button>
              );
            })()}
          </div>
        ) : null}

        {/* Error / Notice banner */}
        {error ? (
          <div className="mx-3 mt-2 flex items-start justify-between gap-2 rounded-[8px] border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
            <span className="break-all">{error}</span>
            <button onClick={() => setError(null)} type="button">
              <CloseIcon size={12} />
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="mx-3 mt-2 flex items-start justify-between gap-2 rounded-[8px] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
            <span className="line-clamp-2 break-words" title={notice}>
              {notice}
            </span>
            <button className="shrink-0" onClick={() => setNotice(null)} type="button">
              <CloseIcon size={12} />
            </button>
          </div>
        ) : null}

        {/* Changes Scroll Area */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading && !status ? (
            <p className="px-2 py-4 text-xs text-muted">正在读取 Git 状态...</p>
          ) : null}

          {status?.isRepo ? (
            <>
              {/* Staged Changes */}
              <div className="mb-3">
                <div className="flex items-center justify-between px-1.5 py-1">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted">
                    <ChevronRightIcon size={11} className="rotate-90" />
                    已暂存的更改 ({stagedEntries.length})
                  </span>
                  {stagedEntries.length > 0 ? (
                    <button
                      aria-label="全部取消暂存"
                      className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-surface-subtle hover:text-ink"
                      onClick={() => handleUnstage([], true)}
                      title="全部取消暂存"
                      type="button"
                    >
                      <MinusIcon size={12} />
                    </button>
                  ) : null}
                </div>
                {viewMode === "tree"
                  ? (() => {
                      const renderTree = (nodes: ScmTreeNode[], depth: number): ReactElement[] =>
                        nodes.flatMap((node) => {
                          if (node.kind === "folder") {
                            const folderKey = `staged:${node.path}`;
                            const collapsed = Boolean(collapsedFolders[folderKey]);
                            return [
                              <button
                                className="flex w-full items-center gap-1.5 rounded-[7px] py-1 pr-2 text-left text-xs text-muted hover:bg-surface-subtle/60 hover:text-ink"
                                key={folderKey}
                                onClick={() => toggleFolder(folderKey)}
                                style={{ paddingLeft: `${8 + depth * 12}px` }}
                                type="button"
                              >
                                <ChevronRightIcon
                                  className={`shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
                                  size={10}
                                />
                                <FolderIcon size={13} className="shrink-0 text-muted" />
                                <span className="truncate font-medium">{node.name}</span>
                              </button>,
                              ...(collapsed ? [] : renderTree(node.children, depth + 1)),
                            ];
                          }
                          const entry = node.entry;
                          const badge = statusBadge(entry, true);
                          const active =
                            selectedTarget?.path === entry.path && selectedTarget.staged;
                          return [
                            <div
                              key={`staged-${entry.path}`}
                              className={`group flex items-center gap-1.5 rounded-[7px] py-1 pr-2 text-xs ${
                                active
                                  ? "bg-surface-subtle text-ink"
                                  : "text-ink/85 hover:bg-surface-subtle/60"
                              }`}
                              style={{ paddingLeft: `${8 + depth * 12}px` }}
                            >
                              <button
                                className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                                onClick={() =>
                                  setSelectedTarget({
                                    path: entry.path,
                                    staged: true,
                                    untracked: false,
                                  })
                                }
                                type="button"
                              >
                                <span className="truncate font-medium">{node.name}</span>
                              </button>
                              <button
                                aria-label={`取消暂存 ${entry.path}`}
                                className="hidden h-5 w-5 place-items-center rounded text-muted group-hover:grid hover:bg-surface hover:text-ink"
                                onClick={() => handleUnstage([entry.path])}
                                title="取消暂存"
                                type="button"
                              >
                                <MinusIcon size={12} />
                              </button>
                              <span
                                className={`w-4 shrink-0 text-center text-[11px] font-semibold ${badge.colorClass}`}
                              >
                                {badge.label}
                              </span>
                            </div>,
                          ];
                        });
                      return renderTree(stagedTree, 0);
                    })()
                  : stagedEntries.map((entry) => {
                      const { name, dir } = splitPathParts(entry.path);
                      const badge = statusBadge(entry, true);
                      const active = selectedTarget?.path === entry.path && selectedTarget.staged;
                      return (
                        <div
                          key={`staged-${entry.path}`}
                          className={`group flex items-center gap-1.5 rounded-[7px] px-2 py-1 text-xs ${
                            active
                              ? "bg-surface-subtle text-ink"
                              : "text-ink/85 hover:bg-surface-subtle/60"
                          }`}
                        >
                          <button
                            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                            onClick={() =>
                              setSelectedTarget({
                                path: entry.path,
                                staged: true,
                                untracked: false,
                              })
                            }
                            type="button"
                          >
                            <span className="truncate font-medium">{name}</span>
                            {dir ? (
                              <span className="truncate text-[10.5px] text-dim">{dir}</span>
                            ) : null}
                          </button>
                          <button
                            aria-label={`取消暂存 ${entry.path}`}
                            className="hidden h-5 w-5 place-items-center rounded text-muted group-hover:grid hover:bg-surface hover:text-ink"
                            onClick={() => handleUnstage([entry.path])}
                            title="取消暂存"
                            type="button"
                          >
                            <MinusIcon size={12} />
                          </button>
                          <span
                            className={`w-4 shrink-0 text-center text-[11px] font-semibold ${badge.colorClass}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
              </div>

              {/* Unstaged / Untracked Changes */}
              <div>
                <div className="flex items-center justify-between px-1.5 py-1">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-muted">
                    <ChevronRightIcon size={11} className="rotate-90" />
                    更改 ({unstagedEntries.length})
                  </span>
                  {unstagedEntries.length > 0 ? (
                    <button
                      aria-label="全部暂存"
                      className="grid h-5 w-5 place-items-center rounded text-muted hover:bg-surface-subtle hover:text-ink"
                      onClick={() => handleStage([], true)}
                      title="全部暂存"
                      type="button"
                    >
                      <PlusIcon size={12} />
                    </button>
                  ) : null}
                </div>
                {viewMode === "tree"
                  ? (() => {
                      const renderTree = (nodes: ScmTreeNode[], depth: number): ReactElement[] =>
                        nodes.flatMap((node) => {
                          if (node.kind === "folder") {
                            const folderKey = `changes:${node.path}`;
                            const collapsed = Boolean(collapsedFolders[folderKey]);
                            return [
                              <button
                                className="flex w-full items-center gap-1.5 rounded-[7px] py-1 pr-2 text-left text-xs text-muted hover:bg-surface-subtle/60 hover:text-ink"
                                key={folderKey}
                                onClick={() => toggleFolder(folderKey)}
                                style={{ paddingLeft: `${8 + depth * 12}px` }}
                                type="button"
                              >
                                <ChevronRightIcon
                                  className={`shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
                                  size={10}
                                />
                                <FolderIcon size={13} className="shrink-0 text-muted" />
                                <span className="truncate font-medium">{node.name}</span>
                              </button>,
                              ...(collapsed ? [] : renderTree(node.children, depth + 1)),
                            ];
                          }
                          const entry = node.entry;
                          const badge = statusBadge(entry, false);
                          const active =
                            selectedTarget?.path === entry.path && !selectedTarget.staged;
                          return [
                            <div
                              key={`changes-${entry.path}`}
                              className={`group flex items-center gap-1 rounded-[7px] py-1 pr-2 text-xs ${
                                active
                                  ? "bg-surface-subtle text-ink"
                                  : "text-ink/85 hover:bg-surface-subtle/60"
                              }`}
                              style={{ paddingLeft: `${8 + depth * 12}px` }}
                            >
                              <button
                                className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                                onClick={() =>
                                  setSelectedTarget({
                                    path: entry.path,
                                    staged: false,
                                    untracked: entry.untracked,
                                  })
                                }
                                type="button"
                              >
                                <span className="truncate font-medium">{node.name}</span>
                              </button>
                              <button
                                aria-label={`放弃更改 ${entry.path}`}
                                className={`h-5 place-items-center rounded px-1 text-[10px] ${
                                  pendingDiscardPath === entry.path
                                    ? "grid bg-rose-500 text-white"
                                    : "hidden w-5 text-muted group-hover:grid hover:bg-surface hover:text-rose-500"
                                }`}
                                onClick={() => handleDiscard(entry)}
                                title={
                                  pendingDiscardPath === entry.path
                                    ? "再次点击确认放弃更改"
                                    : "放弃更改"
                                }
                                type="button"
                              >
                                {pendingDiscardPath === entry.path ? (
                                  "确认"
                                ) : (
                                  <UndoIcon size={12} />
                                )}
                              </button>
                              <button
                                aria-label={`暂存 ${entry.path}`}
                                className="hidden h-5 w-5 place-items-center rounded text-muted group-hover:grid hover:bg-surface hover:text-ink"
                                onClick={() => handleStage([entry.path])}
                                title="暂存更改"
                                type="button"
                              >
                                <PlusIcon size={12} />
                              </button>
                              <span
                                className={`w-4 shrink-0 text-center text-[11px] font-semibold ${badge.colorClass}`}
                              >
                                {badge.label}
                              </span>
                            </div>,
                          ];
                        });
                      return renderTree(unstagedTree, 0);
                    })()
                  : unstagedEntries.map((entry) => {
                      const { name, dir } = splitPathParts(entry.path);
                      const badge = statusBadge(entry, false);
                      const active = selectedTarget?.path === entry.path && !selectedTarget.staged;
                      return (
                        <div
                          key={`changes-${entry.path}`}
                          className={`group flex items-center gap-1 rounded-[7px] px-2 py-1 text-xs ${
                            active
                              ? "bg-surface-subtle text-ink"
                              : "text-ink/85 hover:bg-surface-subtle/60"
                          }`}
                        >
                          <button
                            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
                            onClick={() =>
                              setSelectedTarget({
                                path: entry.path,
                                staged: false,
                                untracked: entry.untracked,
                              })
                            }
                            type="button"
                          >
                            <span className="truncate font-medium">{name}</span>
                            {dir ? (
                              <span className="truncate text-[10.5px] text-dim">{dir}</span>
                            ) : null}
                          </button>
                          <button
                            aria-label={`放弃更改 ${entry.path}`}
                            className={`h-5 place-items-center rounded px-1 text-[10px] ${
                              pendingDiscardPath === entry.path
                                ? "grid bg-rose-500 text-white"
                                : "hidden w-5 text-muted group-hover:grid hover:bg-surface hover:text-rose-500"
                            }`}
                            onClick={() => handleDiscard(entry)}
                            title={
                              pendingDiscardPath === entry.path
                                ? "再次点击确认放弃更改"
                                : "放弃更改"
                            }
                            type="button"
                          >
                            {pendingDiscardPath === entry.path ? "确认" : <UndoIcon size={12} />}
                          </button>
                          <button
                            aria-label={`暂存 ${entry.path}`}
                            className="hidden h-5 w-5 place-items-center rounded text-muted group-hover:grid hover:bg-surface hover:text-ink"
                            onClick={() => handleStage([entry.path])}
                            title="暂存更改"
                            type="button"
                          >
                            <PlusIcon size={12} />
                          </button>
                          <span
                            className={`w-4 shrink-0 text-center text-[11px] font-semibold ${badge.colorClass}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
                {status.entries.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-dim">
                    工作区干净，没有未提交的更改
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </aside>

      {/* Right Pane: Diff Viewer or Non-Repo Empty State */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
        {status && !status.isRepo ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <GitBranchIcon size={32} className="text-muted" />
            <p className="text-sm font-medium text-ink">当前目录尚未初始化 Git 仓库</p>
            <p className="max-w-sm text-xs text-muted">{cwd}</p>
            <button
              className="mt-1 rounded-[8px] bg-ink px-4 py-1.5 text-xs font-medium text-canvas transition-opacity hover:opacity-90 disabled:opacity-45"
              disabled={Boolean(busyAction)}
              onClick={handleInitRepo}
              type="button"
            >
              初始化 Git 仓库 (git init)
            </button>
          </div>
        ) : !selectedTarget ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <GitBranchIcon size={28} className="text-dim" />
            <p className="text-xs font-medium text-muted">在左侧选择任意变更文件以查看 Diff 对比</p>
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-xs font-medium text-ink">
                  {selectedTarget.path}
                </span>
                <span className="shrink-0 rounded-full border border-line bg-surface px-2 py-0.5 text-[10.5px] font-medium text-muted">
                  {selectedTarget.staged ? "已暂存" : "工作区"}
                </span>
              </div>
              {diffResult ? (
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                    +{diffResult.additions}
                  </span>
                  <span className="font-mono text-[11px] text-rose-600 dark:text-rose-400">
                    -{diffResult.deletions}
                  </span>
                  {selectedTarget.staged ? (
                    <button
                      className="rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-subtle"
                      onClick={() => handleUnstage([selectedTarget.path])}
                      type="button"
                    >
                      取消暂存
                    </button>
                  ) : (
                    <button
                      className="rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-subtle"
                      onClick={() => handleStage([selectedTarget.path])}
                      type="button"
                    >
                      暂存
                    </button>
                  )}
                </div>
              ) : null}
            </header>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {diffLoading ? (
                <p className="text-xs text-muted">正在加载 Diff...</p>
              ) : diffResult?.isBinary ? (
                <p className="text-xs text-muted">二进制文件暂不支持文本 Diff 预览。</p>
              ) : parsedDiffLines.length === 0 ? (
                <p className="text-xs text-muted">该文件暂无文本差异。</p>
              ) : (
                <pre className="overflow-x-auto rounded-[10px] border border-line bg-surface p-2 font-mono text-[12px] leading-[1.55]">
                  {parsedDiffLines.map((line) => (
                    <div
                      key={line.key}
                      className={`px-2 whitespace-pre ${diffLineClass(line.kind)}`}
                    >
                      {line.text || " "}
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </>
        )}

        {outputOpen ? (
          <ScmOutputPanel
            entries={outputEntries}
            loading={outputLoading}
            onClear={() => void handleClearOutputLog()}
            onClose={() => setOutputOpen(false)}
            onRefresh={() => void loadOutputLog()}
          />
        ) : null}
      </section>

      <ScmActionDialog
        branches={branches}
        currentBranch={status?.branch ?? ""}
        cwd={cwd}
        dialog={activeDialog}
        onClose={() => setActiveDialog(null)}
        onPushTags={() => handleSync("push_tags")}
        onSuccess={(message, options) => {
          setNotice(message);
          if (options?.openWorkspace && onSelectWorkspace) {
            onSelectWorkspace(options.openWorkspace);
          } else {
            void refreshAll();
          }
          if (outputOpen) {
            void loadOutputLog();
          }
        }}
      />
    </motion.div>
  );
}
