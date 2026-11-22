import { CloseIcon, RefreshIcon, TrashIcon } from "../../components/icons";
import type { GitOutputEntry } from "../../types";

export interface ScmOutputPanelProps {
  entries: GitOutputEntry[];
  loading: boolean;
  onRefresh: () => void;
  onClear: () => void;
  onClose: () => void;
}

function formatClock(timestampMs: number): string {
  try {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ScmOutputPanel({
  entries,
  loading,
  onRefresh,
  onClear,
  onClose,
}: ScmOutputPanelProps) {
  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-line bg-sidebar">
      <header className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink">
            Git 输出
          </span>
          <span className="text-[10.5px] text-dim">({entries.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label="刷新 Git 输出"
            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-subtle hover:text-ink"
            onClick={onRefresh}
            title="刷新"
            type="button"
          >
            <RefreshIcon size={12} />
          </button>
          <button
            aria-label="清空 Git 输出"
            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-subtle hover:text-ink"
            onClick={onClear}
            title="清空日志"
            type="button"
          >
            <TrashIcon size={12} />
          </button>
          <button
            aria-label="关闭 Git 输出"
            className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-subtle hover:text-ink"
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5 font-mono text-[11px] leading-[1.5]">
        {loading && entries.length === 0 ? (
          <p className="text-muted">正在加载 Git 输出...</p>
        ) : entries.length === 0 ? (
          <p className="text-dim">暂无 Git 命令输出记录。</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                className="rounded-[7px] border border-line/70 bg-surface px-2.5 py-1.5"
                key={entry.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-ink">
                    &gt; {entry.command}
                  </span>
                  <div className="flex shrink-0 items-center gap-2 text-[10px]">
                    <span
                      className={
                        entry.exitCode === 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }
                    >
                      exit {entry.exitCode}
                    </span>
                    <span className="text-dim">{formatClock(entry.timestampMs)}</span>
                  </div>
                </div>
                {entry.stdout ? (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10.5px] text-muted">
                    {entry.stdout}
                  </pre>
                ) : null}
                {entry.stderr ? (
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[10.5px] text-rose-600 dark:text-rose-400">
                    {entry.stderr}
                  </pre>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
