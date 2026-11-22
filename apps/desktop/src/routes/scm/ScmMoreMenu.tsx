import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import {
  CheckIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "../../components/icons";
import type { GitSortMode, GitSyncAction, GitViewMode } from "../../types";

export const SCM_MENU_SUBMENUS = [
  "view-sort",
  "commit",
  "changes",
  "pull-push",
  "branch",
  "remote",
  "stash",
  "tags",
] as const;
export type ScmSubmenuId = (typeof SCM_MENU_SUBMENUS)[number];

export interface ScmMoreMenuProps {
  isRepo: boolean;
  busy: boolean;
  viewMode: GitViewMode;
  sortMode: GitSortMode;
  outputOpen: boolean;
  hasStaged: boolean;
  hasUnstaged: boolean;
  hasCommitMessage: boolean;
  onToggleViewMode: () => void;
  onChangeSortMode: (mode: GitSortMode) => void;
  onSync: (action: GitSyncAction) => void;
  onOpenClone: () => void;
  onOpenCheckout: () => void;
  onCommitStaged: () => void;
  onCommitAll: () => void;
  onCommitAmend: () => void;
  onUndoLastCommit: () => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onOpenDiscardAll: () => void;
  onOpenCreateBranch: () => void;
  onOpenRenameBranch: () => void;
  onOpenDeleteBranch: () => void;
  onOpenMergeBranch: () => void;
  onOpenRebaseBranch: () => void;
  onOpenRemotes: () => void;
  onOpenStashCreate: (includeUntracked: boolean) => void;
  onStashPopLatest: () => void;
  onStashApplyLatest: () => void;
  onOpenStashList: () => void;
  onOpenTagCreate: () => void;
  onOpenTagList: () => void;
  onToggleOutput: () => void;
}

const SORT_LABELS: Record<GitSortMode, string> = {
  name: "按名称排序",
  path: "按路径排序",
  status: "按状态排序",
};

interface SubmenuItem {
  id: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export function ScmMoreMenu({
  isRepo,
  busy,
  viewMode,
  sortMode,
  outputOpen,
  hasStaged,
  hasUnstaged,
  hasCommitMessage,
  onToggleViewMode,
  onChangeSortMode,
  onSync,
  onOpenClone,
  onOpenCheckout,
  onCommitStaged,
  onCommitAll,
  onCommitAmend,
  onUndoLastCommit,
  onStageAll,
  onUnstageAll,
  onOpenDiscardAll,
  onOpenCreateBranch,
  onOpenRenameBranch,
  onOpenDeleteBranch,
  onOpenMergeBranch,
  onOpenRebaseBranch,
  onOpenRemotes,
  onOpenStashCreate,
  onStashPopLatest,
  onStashApplyLatest,
  onOpenStashList,
  onOpenTagCreate,
  onOpenTagList,
  onToggleOutput,
}: ScmMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<ScmSubmenuId | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setActiveSubmenu(null);
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function runAndClose(action: () => void) {
    setOpen(false);
    setActiveSubmenu(null);
    action();
  }

  const repoDisabled = !isRepo || busy;

  const submenuMap: Record<ScmSubmenuId, SubmenuItem[]> = {
    "view-sort": (["name", "path", "status"] as const).map((mode) => ({
      id: `sort-${mode}`,
      label: SORT_LABELS[mode],
      checked: sortMode === mode,
      onClick: () => onChangeSortMode(mode),
    })),
    commit: [
      {
        id: "commit-staged",
        label: "提交已暂存",
        disabled: repoDisabled || !hasStaged || !hasCommitMessage,
        onClick: onCommitStaged,
      },
      {
        id: "commit-all",
        label: "全部提交",
        disabled: repoDisabled || (!hasStaged && !hasUnstaged) || !hasCommitMessage,
        onClick: onCommitAll,
      },
      {
        id: "commit-amend",
        label: "修改上次提交 (Amend)",
        disabled: repoDisabled,
        onClick: onCommitAmend,
      },
      {
        id: "commit-undo",
        label: "撤销上次提交",
        disabled: repoDisabled,
        onClick: onUndoLastCommit,
      },
    ],
    changes: [
      {
        id: "stage-all",
        label: "暂存所有更改",
        disabled: repoDisabled || !hasUnstaged,
        onClick: onStageAll,
      },
      {
        id: "unstage-all",
        label: "取消暂存所有更改",
        disabled: repoDisabled || !hasStaged,
        onClick: onUnstageAll,
      },
      {
        id: "discard-all",
        label: "放弃所有更改...",
        disabled: repoDisabled || !hasUnstaged,
        danger: true,
        onClick: onOpenDiscardAll,
      },
    ],
    "pull-push": [
      {
        id: "pp-pull",
        label: "拉取",
        disabled: repoDisabled,
        onClick: () => onSync("pull"),
      },
      {
        id: "pp-pull-rebase",
        label: "拉取 (变基)",
        disabled: repoDisabled,
        onClick: () => onSync("pull_rebase"),
      },
      {
        id: "pp-push",
        label: "推送",
        disabled: repoDisabled,
        onClick: () => onSync("push"),
      },
      {
        id: "pp-push-force",
        label: "推送 (强制)",
        disabled: repoDisabled,
        danger: true,
        onClick: () => onSync("push_force"),
      },
      {
        id: "pp-fetch",
        label: "抓取",
        disabled: repoDisabled,
        onClick: () => onSync("fetch"),
      },
      {
        id: "pp-fetch-all",
        label: "抓取 (全部远程)",
        disabled: repoDisabled,
        onClick: () => onSync("fetch_all"),
      },
      {
        id: "pp-sync",
        label: "同步",
        disabled: repoDisabled,
        onClick: () => onSync("sync"),
      },
    ],
    branch: [
      {
        id: "branch-create",
        label: "创建分支...",
        disabled: repoDisabled,
        onClick: onOpenCreateBranch,
      },
      {
        id: "branch-rename",
        label: "重命名分支...",
        disabled: repoDisabled,
        onClick: onOpenRenameBranch,
      },
      {
        id: "branch-delete",
        label: "删除分支...",
        disabled: repoDisabled,
        onClick: onOpenDeleteBranch,
      },
      {
        id: "branch-merge",
        label: "合并分支...",
        disabled: repoDisabled,
        onClick: onOpenMergeBranch,
      },
      {
        id: "branch-rebase",
        label: "变基分支...",
        disabled: repoDisabled,
        onClick: onOpenRebaseBranch,
      },
    ],
    remote: [
      {
        id: "remote-add",
        label: "添加远程...",
        disabled: repoDisabled,
        onClick: onOpenRemotes,
      },
      {
        id: "remote-manage",
        label: "移除 / 管理远程...",
        disabled: repoDisabled,
        onClick: onOpenRemotes,
      },
    ],
    stash: [
      {
        id: "stash-push",
        label: "存储...",
        disabled: repoDisabled,
        onClick: () => onOpenStashCreate(false),
      },
      {
        id: "stash-push-untracked",
        label: "存储 (包括未跟踪)...",
        disabled: repoDisabled,
        onClick: () => onOpenStashCreate(true),
      },
      {
        id: "stash-pop",
        label: "弹出最新存储",
        disabled: repoDisabled,
        onClick: onStashPopLatest,
      },
      {
        id: "stash-apply",
        label: "应用最新存储",
        disabled: repoDisabled,
        onClick: onStashApplyLatest,
      },
      {
        id: "stash-list",
        label: "管理存储列表...",
        disabled: repoDisabled,
        onClick: onOpenStashList,
      },
    ],
    tags: [
      {
        id: "tag-create",
        label: "创建标记...",
        disabled: repoDisabled,
        onClick: onOpenTagCreate,
      },
      {
        id: "tag-delete",
        label: "删除 / 管理标记...",
        disabled: repoDisabled,
        onClick: onOpenTagList,
      },
      {
        id: "tag-push",
        label: "推送标记",
        disabled: repoDisabled,
        onClick: () => onSync("push_tags"),
      },
    ],
  };

  function renderSubmenuTrigger(id: ScmSubmenuId, label: string, disabled = false) {
    const isActive = activeSubmenu === id;
    const items = submenuMap[id];
    return (
      <div
        className="relative"
        key={id}
        onMouseEnter={() => {
          if (!disabled) {
            setActiveSubmenu(id);
          }
        }}
      >
        <button
          aria-expanded={isActive}
          aria-haspopup="menu"
          className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
            isActive
              ? "bg-surface-subtle text-ink"
              : "text-ink hover:bg-surface-subtle"
          }`}
          disabled={disabled}
          onClick={() => setActiveSubmenu((prev) => (prev === id ? null : id))}
          role="menuitem"
          type="button"
        >
          <span>{label}</span>
          <ChevronRightIcon size={11} className="text-muted" />
        </button>

        {isActive ? (
          <div
            className="absolute top-0 left-full z-40 ml-1 w-48 rounded-[10px] border border-line bg-surface p-1 shadow-xl"
            role="menu"
          >
            {items.map((item) => (
              <button
                className={`flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
                  item.danger
                    ? "text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
                    : "text-ink hover:bg-surface-subtle"
                }`}
                disabled={item.disabled}
                key={item.id}
                onClick={() => runAndClose(item.onClick)}
                role="menuitem"
                type="button"
              >
                <span className="truncate">{item.label}</span>
                {item.checked ? (
                  <CheckIcon size={12} className="shrink-0 text-emerald-500" />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="更多 Git 操作"
        className={`grid h-7 w-7 place-items-center rounded-[7px] transition-colors ${
          open
            ? "bg-surface-subtle text-ink"
            : "text-muted hover:bg-surface-subtle hover:text-ink"
        }`}
        onClick={() => setOpen((prev) => !prev)}
        title="更多 Git 操作"
        type="button"
      >
        <MoreHorizontalIcon size={15} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            aria-label="Git 操作菜单"
            className="absolute top-full right-0 z-30 mt-1.5 w-48 rounded-[10px] border border-line bg-surface p-1 shadow-xl"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: -4 }}
            role="menu"
            transition={{ duration: 0.12 }}
          >
            {/* View & Sort */}
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle"
              onClick={() => runAndClose(onToggleViewMode)}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>{viewMode === "tree" ? "以列表形式查看" : "以树形式查看"}</span>
            </button>
            {renderSubmenuTrigger("view-sort", "查看和排序")}

            <div className="my-1 border-t border-line" />

            {/* Quick actions */}
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle disabled:opacity-40"
              disabled={repoDisabled}
              onClick={() => runAndClose(() => onSync("pull"))}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>拉取</span>
            </button>
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle disabled:opacity-40"
              disabled={repoDisabled}
              onClick={() => runAndClose(() => onSync("push"))}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>推送</span>
            </button>
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle disabled:opacity-40"
              disabled={busy}
              onClick={() => runAndClose(onOpenClone)}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>克隆</span>
            </button>
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle disabled:opacity-40"
              disabled={repoDisabled}
              onClick={() => runAndClose(onOpenCheckout)}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>签出到...</span>
            </button>
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle disabled:opacity-40"
              disabled={repoDisabled}
              onClick={() => runAndClose(() => onSync("fetch"))}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>抓取</span>
            </button>

            <div className="my-1 border-t border-line" />

            {/* Grouped submenus */}
            {renderSubmenuTrigger("commit", "提交", !isRepo)}
            {renderSubmenuTrigger("changes", "更改", !isRepo)}
            {renderSubmenuTrigger("pull-push", "拉取，推送", !isRepo)}
            {renderSubmenuTrigger("branch", "分支", !isRepo)}
            {renderSubmenuTrigger("remote", "远程", !isRepo)}
            {renderSubmenuTrigger("stash", "存储", !isRepo)}
            {renderSubmenuTrigger("tags", "标记", !isRepo)}

            <div className="my-1 border-t border-line" />

            {/* Git Output */}
            <button
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-subtle"
              onClick={() => runAndClose(onToggleOutput)}
              onMouseEnter={() => setActiveSubmenu(null)}
              role="menuitem"
              type="button"
            >
              <span>显示 GIT 输出</span>
              {outputOpen ? (
                <CheckIcon size={12} className="shrink-0 text-emerald-500" />
              ) : null}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
