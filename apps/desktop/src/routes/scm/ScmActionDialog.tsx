import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

import { CloseIcon, TrashIcon } from "../../components/icons";
import type {
  GitActionResult,
  GitBranchInfo,
  GitCloneResult,
  GitRemoteInfo,
  GitStashEntry,
  GitTagInfo,
} from "../../types";
import { messageOf } from "../../utils";

export const SCM_DIALOG_KINDS = [
  "clone",
  "rename-branch",
  "merge-branch",
  "rebase-branch",
  "remotes",
  "stash-create",
  "stash-list",
  "tag-create",
  "tag-list",
  "discard-all",
] as const;

export type ScmDialogKind = (typeof SCM_DIALOG_KINDS)[number];

export interface ScmDialogState {
  kind: ScmDialogKind;
  includeUntracked?: boolean;
}

export interface ScmActionDialogProps {
  dialog: ScmDialogState | null;
  cwd: string;
  currentBranch: string;
  branches: GitBranchInfo[];
  onClose: () => void;
  onSuccess: (message: string, options?: { openWorkspace?: string }) => void;
  onPushTags: () => void;
}

function defaultParentDir(cwd: string): string {
  const normalized = cwd.replace(/[\\/]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (idx <= 0) {
    return normalized;
  }
  return normalized.slice(0, idx);
}

function formatUnixTime(ts: number | null): string {
  if (!ts) {
    return "";
  }
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return "";
  }
}

export function ScmActionDialog({
  dialog,
  cwd,
  currentBranch,
  branches,
  onClose,
  onSuccess,
  onPushTags,
}: ScmActionDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Clone state
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneParentDir, setCloneParentDir] = useState("");
  const [cloneDirName, setCloneDirName] = useState("");
  const [switchAfterClone, setSwitchAfterClone] = useState(true);

  // Branch rename / merge / rebase
  const [newBranchName, setNewBranchName] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");

  // Remotes
  const [remotes, setRemotes] = useState<GitRemoteInfo[]>([]);
  const [remotesLoading, setRemotesLoading] = useState(false);
  const [remoteName, setRemoteName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");

  // Stash
  const [stashMessage, setStashMessage] = useState("");
  const [stashUntracked, setStashUntracked] = useState(false);
  const [stashes, setStashes] = useState<GitStashEntry[]>([]);
  const [stashesLoading, setStashesLoading] = useState(false);

  // Tags
  const [tagName, setTagName] = useState("");
  const [tagMessage, setTagMessage] = useState("");
  const [tags, setTags] = useState<GitTagInfo[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  const selectableBranches = branches.filter((b) => !b.isCurrent);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    setDialogError(null);
    setSubmitting(false);

    if (dialog.kind === "clone") {
      setCloneUrl("");
      setCloneParentDir(defaultParentDir(cwd));
      setCloneDirName("");
      setSwitchAfterClone(true);
    } else if (dialog.kind === "rename-branch") {
      setNewBranchName(currentBranch);
    } else if (dialog.kind === "merge-branch" || dialog.kind === "rebase-branch") {
      setSelectedBranch(selectableBranches[0]?.name ?? "");
    } else if (dialog.kind === "remotes") {
      setRemoteName("");
      setRemoteUrl("");
      setRemotesLoading(true);
      void invoke<GitRemoteInfo[]>("git_remotes", { request: { cwd } })
        .then((res) => setRemotes(res))
        .catch((err) => setDialogError(messageOf(err)))
        .finally(() => setRemotesLoading(false));
    } else if (dialog.kind === "stash-create") {
      setStashMessage("");
      setStashUntracked(Boolean(dialog.includeUntracked));
    } else if (dialog.kind === "stash-list") {
      setStashesLoading(true);
      void invoke<GitStashEntry[]>("git_stashes", { request: { cwd } })
        .then((res) => setStashes(res))
        .catch((err) => setDialogError(messageOf(err)))
        .finally(() => setStashesLoading(false));
    } else if (dialog.kind === "tag-create") {
      setTagName("");
      setTagMessage("");
    } else if (dialog.kind === "tag-list") {
      setTagsLoading(true);
      void invoke<GitTagInfo[]>("git_tags", { request: { cwd } })
        .then((res) => setTags(res))
        .catch((err) => setDialogError(messageOf(err)))
        .finally(() => setTagsLoading(false));
    }
  }, [dialog, cwd, currentBranch]);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dialog, submitting, onClose]);

  async function runDialogAction(fn: () => Promise<void>) {
    setSubmitting(true);
    setDialogError(null);
    try {
      await fn();
    } catch (err) {
      setDialogError(messageOf(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function reloadRemotes() {
    const res = await invoke<GitRemoteInfo[]>("git_remotes", { request: { cwd } });
    setRemotes(res);
  }

  async function reloadStashes() {
    const res = await invoke<GitStashEntry[]>("git_stashes", { request: { cwd } });
    setStashes(res);
  }

  async function reloadTags() {
    const res = await invoke<GitTagInfo[]>("git_tags", { request: { cwd } });
    setTags(res);
  }

  function titleOf(kind: ScmDialogKind): string {
    switch (kind) {
      case "clone":
        return "克隆 Git 仓库";
      case "rename-branch":
        return "重命名当前分支";
      case "merge-branch":
        return "合并分支到当前分支";
      case "rebase-branch":
        return "变基当前分支";
      case "remotes":
        return "管理远程仓库";
      case "stash-create":
        return "存储当前更改 (Stash)";
      case "stash-list":
        return "管理存储列表 (Stash)";
      case "tag-create":
        return "创建标记 (Tag)";
      case "tag-list":
        return "管理标记 (Tags)";
      case "discard-all":
        return "放弃所有更改";
    }
  }

  return (
    <AnimatePresence>
      {dialog ? (
        <motion.div
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              onClose();
            }
          }}
          transition={{ duration: 0.14 }}
        >
          <motion.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-md overflow-hidden rounded-[12px] border border-line bg-surface shadow-2xl"
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            initial={{ opacity: 0, scale: 0.98, y: 6 }}
            role="dialog"
            transition={{ duration: 0.14 }}
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-xs font-semibold text-ink">{titleOf(dialog.kind)}</h3>
              <button
                aria-label="关闭弹窗"
                className="grid h-6 w-6 place-items-center rounded-[6px] text-muted hover:bg-surface-subtle hover:text-ink disabled:opacity-40"
                disabled={submitting}
                onClick={onClose}
                type="button"
              >
                <CloseIcon size={13} />
              </button>
            </header>

            <div className="space-y-3 p-4 text-xs">
              {dialogError ? (
                <div className="rounded-[8px] border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">
                  {dialogError}
                </div>
              ) : null}

              {dialog.kind === "clone" ? (
                <form
                  className="space-y-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runDialogAction(async () => {
                      const res = await invoke<GitCloneResult>("git_clone", {
                        request: {
                          cwd,
                          url: cloneUrl.trim(),
                          parentDir: cloneParentDir.trim() || null,
                          directoryName: cloneDirName.trim() || null,
                        },
                      });
                      onSuccess(res.message, {
                        openWorkspace: switchAfterClone ? res.clonedPath : undefined,
                      });
                      onClose();
                    });
                  }}
                >
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">仓库 URL</span>
                    <input
                      autoFocus
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setCloneUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      required
                      value={cloneUrl}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">目标父目录</span>
                    <input
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setCloneParentDir(e.target.value)}
                      placeholder="/path/to/parent"
                      value={cloneParentDir}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">目录名 (可选，默认从 URL 推导)</span>
                    <input
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setCloneDirName(e.target.value)}
                      placeholder="留空自动使用仓库名"
                      value={cloneDirName}
                    />
                  </label>
                  <label className="flex items-center gap-2 pt-0.5 text-[11px] text-ink">
                    <input
                      checked={switchAfterClone}
                      onChange={(e) => setSwitchAfterClone(e.target.checked)}
                      type="checkbox"
                    />
                    <span>克隆完成后切换到该工作区</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      disabled={submitting}
                      onClick={onClose}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
                      disabled={submitting || !cloneUrl.trim()}
                      type="submit"
                    >
                      {submitting ? "克隆中..." : "开始克隆"}
                    </button>
                  </div>
                </form>
              ) : null}

              {dialog.kind === "rename-branch" ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runDialogAction(async () => {
                      const res = await invoke<GitActionResult>("git_rename_branch", {
                        request: {
                          cwd,
                          oldName: null,
                          newName: newBranchName.trim(),
                        },
                      });
                      onSuccess(res.message);
                      onClose();
                    });
                  }}
                >
                  <p className="text-[11px] text-muted">
                    当前分支: <span className="font-mono text-ink">{currentBranch}</span>
                  </p>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">新分支名称</span>
                    <input
                      autoFocus
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setNewBranchName(e.target.value)}
                      required
                      value={newBranchName}
                    />
                  </label>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      disabled={submitting}
                      onClick={onClose}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
                      disabled={
                        submitting ||
                        !newBranchName.trim() ||
                        newBranchName.trim() === currentBranch
                      }
                      type="submit"
                    >
                      {submitting ? "重命名中..." : "确认重命名"}
                    </button>
                  </div>
                </form>
              ) : null}

              {dialog.kind === "merge-branch" || dialog.kind === "rebase-branch" ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const cmd =
                      dialog.kind === "merge-branch"
                        ? "git_merge_branch"
                        : "git_rebase_branch";
                    void runDialogAction(async () => {
                      const res = await invoke<GitActionResult>(cmd, {
                        request: { cwd, branch: selectedBranch },
                      });
                      onSuccess(res.message);
                      onClose();
                    });
                  }}
                >
                  <p className="text-[11px] text-muted">
                    {dialog.kind === "merge-branch"
                      ? `选择要合并到 ${currentBranch} 的源分支：`
                      : `选择要将 ${currentBranch} 变基到的目标分支：`}
                  </p>
                  {selectableBranches.length === 0 ? (
                    <p className="py-2 text-dim">没有其他可选分支。</p>
                  ) : (
                    <select
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      value={selectedBranch}
                    >
                      {selectableBranches.map((b) => (
                        <option key={b.fullName} value={b.name}>
                          {b.name} {b.isRemote ? "(远程)" : "(本地)"}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      disabled={submitting}
                      onClick={onClose}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
                      disabled={submitting || !selectedBranch}
                      type="submit"
                    >
                      {submitting
                        ? "执行中..."
                        : dialog.kind === "merge-branch"
                          ? "合并分支"
                          : "执行变基"}
                    </button>
                  </div>
                </form>
              ) : null}

              {dialog.kind === "remotes" ? (
                <div className="space-y-3">
                  <div className="max-h-44 space-y-1.5 overflow-y-auto">
                    {remotesLoading ? (
                      <p className="text-muted">正在读取远程列表...</p>
                    ) : remotes.length === 0 ? (
                      <p className="text-dim">当前仓库未配置远程仓库。</p>
                    ) : (
                      remotes.map((remote) => (
                        <div
                          className="flex items-center justify-between gap-2 rounded-[8px] border border-line bg-canvas px-2.5 py-2"
                          key={remote.name}
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-ink">
                              {remote.name}
                            </p>
                            <p className="truncate font-mono text-[10.5px] text-muted">
                              {remote.fetchUrl}
                            </p>
                          </div>
                          <button
                            aria-label={`移除远程 ${remote.name}`}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                            disabled={submitting}
                            onClick={() =>
                              void runDialogAction(async () => {
                                const res = await invoke<GitActionResult>(
                                  "git_remove_remote",
                                  { request: { cwd, name: remote.name } },
                                );
                                await reloadRemotes();
                                onSuccess(res.message);
                              })
                            }
                            title="移除远程"
                            type="button"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <form
                    className="space-y-2 border-t border-line pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runDialogAction(async () => {
                        const res = await invoke<GitActionResult>("git_add_remote", {
                          request: {
                            cwd,
                            name: remoteName.trim(),
                            url: remoteUrl.trim(),
                          },
                        });
                        setRemoteName("");
                        setRemoteUrl("");
                        await reloadRemotes();
                        onSuccess(res.message);
                      });
                    }}
                  >
                    <p className="text-[11px] font-medium text-muted">添加新远程</p>
                    <div className="flex gap-1.5">
                      <input
                        className="w-24 rounded-[7px] border border-line bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                        onChange={(e) => setRemoteName(e.target.value)}
                        placeholder="origin"
                        required
                        value={remoteName}
                      />
                      <input
                        className="min-w-0 flex-1 rounded-[7px] border border-line bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                        onChange={(e) => setRemoteUrl(e.target.value)}
                        placeholder="https://github.com/user/repo.git"
                        required
                        value={remoteUrl}
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                        onClick={onClose}
                        type="button"
                      >
                        关闭
                      </button>
                      <button
                        className="rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
                        disabled={submitting || !remoteName.trim() || !remoteUrl.trim()}
                        type="submit"
                      >
                        添加远程
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}

              {dialog.kind === "stash-create" ? (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runDialogAction(async () => {
                      const res = await invoke<GitActionResult>("git_stash_push", {
                        request: {
                          cwd,
                          message: stashMessage.trim() || null,
                          includeUntracked: stashUntracked,
                        },
                      });
                      onSuccess(res.message);
                      onClose();
                    });
                  }}
                >
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">存储说明 (可选)</span>
                    <input
                      autoFocus
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setStashMessage(e.target.value)}
                      placeholder="例如: WIP 登录页重构"
                      value={stashMessage}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-[11px] text-ink">
                    <input
                      checked={stashUntracked}
                      onChange={(e) => setStashUntracked(e.target.checked)}
                      type="checkbox"
                    />
                    <span>包括未跟踪的文件 (-u)</span>
                  </label>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      disabled={submitting}
                      onClick={onClose}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
                      disabled={submitting}
                      type="submit"
                    >
                      {submitting ? "存储中..." : "存储更改"}
                    </button>
                  </div>
                </form>
              ) : null}

              {dialog.kind === "stash-list" ? (
                <div className="space-y-3">
                  <div className="max-h-60 space-y-1.5 overflow-y-auto">
                    {stashesLoading ? (
                      <p className="text-muted">正在读取存储列表...</p>
                    ) : stashes.length === 0 ? (
                      <p className="py-3 text-center text-dim">当前没有任何存储记录。</p>
                    ) : (
                      stashes.map((stash) => (
                        <div
                          className="rounded-[8px] border border-line bg-canvas p-2.5"
                          key={stash.reference}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[11px] font-semibold text-ink">
                              {stash.reference}
                            </span>
                            {stash.timestamp ? (
                              <span className="text-[10px] text-dim">
                                {formatUnixTime(stash.timestamp)}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted">
                            {stash.message}
                          </p>
                          <div className="mt-2 flex items-center gap-1.5">
                            <button
                              className="rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-subtle disabled:opacity-40"
                              disabled={submitting}
                              onClick={() =>
                                void runDialogAction(async () => {
                                  const res = await invoke<GitActionResult>(
                                    "git_stash_apply",
                                    { request: { cwd, reference: stash.reference } },
                                  );
                                  onSuccess(res.message);
                                })
                              }
                              type="button"
                            >
                              应用
                            </button>
                            <button
                              className="rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] text-ink hover:bg-surface-subtle disabled:opacity-40"
                              disabled={submitting}
                              onClick={() =>
                                void runDialogAction(async () => {
                                  const res = await invoke<GitActionResult>(
                                    "git_stash_pop",
                                    { request: { cwd, reference: stash.reference } },
                                  );
                                  await reloadStashes();
                                  onSuccess(res.message);
                                })
                              }
                              type="button"
                            >
                              弹出
                            </button>
                            <button
                              className="rounded-[6px] border border-line bg-surface px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-400"
                              disabled={submitting}
                              onClick={() =>
                                void runDialogAction(async () => {
                                  const res = await invoke<GitActionResult>(
                                    "git_stash_drop",
                                    { request: { cwd, reference: stash.reference } },
                                  );
                                  await reloadStashes();
                                  onSuccess(res.message);
                                })
                              }
                              type="button"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-line pt-2.5">
                    <button
                      className="rounded-[7px] border border-rose-500/30 px-2.5 py-1.5 text-[11px] text-rose-600 hover:bg-rose-500/10 disabled:opacity-40 dark:text-rose-400"
                      disabled={submitting || stashes.length === 0}
                      onClick={() =>
                        void runDialogAction(async () => {
                          const res = await invoke<GitActionResult>("git_stash_clear", {
                            request: { cwd },
                          });
                          await reloadStashes();
                          onSuccess(res.message);
                        })
                      }
                      type="button"
                    >
                      清空全部
                    </button>
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      onClick={onClose}
                      type="button"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : null}

              {dialog.kind === "tag-create" ? (
                <form
                  className="space-y-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runDialogAction(async () => {
                      const res = await invoke<GitActionResult>("git_create_tag", {
                        request: {
                          cwd,
                          name: tagName.trim(),
                          message: tagMessage.trim() || null,
                        },
                      });
                      onSuccess(res.message);
                      onClose();
                    });
                  }}
                >
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">标记名称</span>
                    <input
                      autoFocus
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setTagName(e.target.value)}
                      placeholder="v1.0.0"
                      required
                      value={tagName}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted">附注说明 (可选，填写后创建 Annotated Tag)</span>
                    <input
                      className="w-full rounded-[7px] border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-ink/40"
                      onChange={(e) => setTagMessage(e.target.value)}
                      placeholder="Release v1.0.0"
                      value={tagMessage}
                    />
                  </label>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      disabled={submitting}
                      onClick={onClose}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="rounded-[7px] bg-ink px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
                      disabled={submitting || !tagName.trim()}
                      type="submit"
                    >
                      {submitting ? "创建中..." : "创建标记"}
                    </button>
                  </div>
                </form>
              ) : null}

              {dialog.kind === "tag-list" ? (
                <div className="space-y-3">
                  <div className="max-h-60 space-y-1.5 overflow-y-auto">
                    {tagsLoading ? (
                      <p className="text-muted">正在读取标记列表...</p>
                    ) : tags.length === 0 ? (
                      <p className="py-3 text-center text-dim">当前仓库没有标记。</p>
                    ) : (
                      tags.map((tag) => (
                        <div
                          className="flex items-center justify-between gap-2 rounded-[8px] border border-line bg-canvas px-2.5 py-2"
                          key={tag.name}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs font-semibold text-ink">
                                {tag.name}
                              </span>
                              <span className="font-mono text-[10.5px] text-dim">
                                {tag.oid}
                              </span>
                            </div>
                            {tag.message ? (
                              <p className="truncate text-[11px] text-muted">
                                {tag.message}
                              </p>
                            ) : null}
                          </div>
                          <button
                            aria-label={`删除标记 ${tag.name}`}
                            className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-40"
                            disabled={submitting}
                            onClick={() =>
                              void runDialogAction(async () => {
                                const res = await invoke<GitActionResult>(
                                  "git_delete_tag",
                                  { request: { cwd, name: tag.name } },
                                );
                                await reloadTags();
                                onSuccess(res.message);
                              })
                            }
                            title="删除本地标记"
                            type="button"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex items-center justify-between border-t border-line pt-2.5">
                    <button
                      className="rounded-[7px] border border-line bg-surface px-2.5 py-1.5 text-[11px] text-ink hover:bg-surface-subtle disabled:opacity-40"
                      disabled={submitting || tags.length === 0}
                      onClick={() => {
                        onPushTags();
                        onClose();
                      }}
                      type="button"
                    >
                      推送全部标记
                    </button>
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      onClick={onClose}
                      type="button"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              ) : null}

              {dialog.kind === "discard-all" ? (
                <div className="space-y-3">
                  <p className="leading-relaxed text-muted">
                    确定要放弃工作区中的所有未暂存修改并删除所有未跟踪文件吗？此操作无法撤销。
                  </p>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      className="rounded-[7px] border border-line px-3 py-1.5 text-xs text-muted hover:bg-surface-subtle hover:text-ink"
                      disabled={submitting}
                      onClick={onClose}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      className="rounded-[7px] bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-40"
                      disabled={submitting}
                      onClick={() =>
                        void runDialogAction(async () => {
                          const res = await invoke<GitActionResult>("git_discard_all", {
                            request: { cwd },
                          });
                          onSuccess(res.message);
                          onClose();
                        })
                      }
                      type="button"
                    >
                      {submitting ? "放弃中..." : "确认放弃所有更改"}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
