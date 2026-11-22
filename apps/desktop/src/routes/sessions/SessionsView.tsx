import { motion } from "motion/react";
import { useMemo, useState } from "react";

import { CliIcon, CloseIcon, HistoryIcon, RefreshIcon } from "../../components";
import { CLI_IDS, isCliId, type CliId, type SessionRecord } from "../../types";
import { formatTimestamp, workspaceName } from "../../utils";

export interface SessionsViewProps {
  workspaceInput: string;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  onRefreshSessions: () => void;
  onOpenSession: (sessionId: string) => void;
}

export interface CliSessionWorkspace {
  cliId: CliId;
  label: string;
  sessions: SessionRecord[];
  totalCount: number;
}

export const CLI_WORKSPACE_LABELS: Record<CliId, string> = {
  codex: "Codex",
  claude: "Claude",
  pi: "Pi",
  omp: "OMP",
};

export function groupSessionsByCli(
  sessions: readonly SessionRecord[],
  query = "",
): CliSessionWorkspace[] {
  const normalizedQuery = query.trim().toLowerCase();
  const totals = new Map<CliId, number>(CLI_IDS.map((id) => [id, 0]));
  const buckets = new Map<CliId, SessionRecord[]>(CLI_IDS.map((id) => [id, []]));

  for (const session of sessions) {
    const cliKey = session.cliId.trim().toLowerCase();
    if (!isCliId(cliKey)) {
      continue;
    }
    totals.set(cliKey, (totals.get(cliKey) ?? 0) + 1);

    if (normalizedQuery) {
      const titleMatch = session.title.toLowerCase().includes(normalizedQuery);
      const workspaceMatch = (session.workspace ?? "").toLowerCase().includes(normalizedQuery);
      if (!titleMatch && !workspaceMatch) {
        continue;
      }
    }
    buckets.get(cliKey)?.push(session);
  }

  return CLI_IDS.map((cliId) => {
    const list = buckets.get(cliId) ?? [];
    return {
      cliId,
      label: CLI_WORKSPACE_LABELS[cliId],
      sessions: [...list].sort((a, b) => b.updatedAt - a.updatedAt),
      totalCount: totals.get(cliId) ?? 0,
    };
  });
}

export function SessionsView({
  workspaceInput,
  sessions,
  activeSessionId,
  onRefreshSessions,
  onOpenSession,
}: SessionsViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const trimmedQuery = searchQuery.trim();

  const cliWorkspaces = useMemo(
    () => groupSessionsByCli(sessions, trimmedQuery),
    [sessions, trimmedQuery],
  );

  const matchedCount = useMemo(
    () => cliWorkspaces.reduce((sum, item) => sum + item.sessions.length, 0),
    [cliWorkspaces],
  );

  const totalCount = useMemo(
    () => cliWorkspaces.reduce((sum, item) => sum + item.totalCount, 0),
    [cliWorkspaces],
  );

  return (
    <motion.section
      key="sessions"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden px-8 py-6 max-[900px]:px-5 max-[900px]:py-4"
      aria-live="polite"
    >
      <div className="mx-auto flex h-full min-h-0 w-[min(1080px,100%)] flex-col gap-5">
        {/* Header Bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line pb-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">
              会话路由
            </h2>
            <span className="truncate font-code text-xs text-muted-strong">
              {workspaceName(workspaceInput)}
            </span>
            <span className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 font-code text-[10.5px] text-muted">
              {trimmedQuery ? `${matchedCount} / ${totalCount}` : `${totalCount} 条`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex items-center">
              <input
                aria-label="搜索历史会话"
                className="h-7 w-52 rounded-[8px] border border-line bg-surface px-2.5 pr-7 text-[12px] text-ink placeholder:text-muted/70 transition-colors duration-140 focus:border-line-strong max-[560px]:w-36"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索标题或工作区..."
                type="text"
                value={searchQuery}
              />
              {searchQuery ? (
                <button
                  aria-label="清除搜索"
                  className="absolute right-1.5 grid h-4 w-4 place-items-center rounded text-muted transition-colors hover:text-ink"
                  onClick={() => setSearchQuery("")}
                  title="清除搜索"
                  type="button"
                >
                  <CloseIcon size={11} />
                </button>
              ) : null}
            </div>

            <button
              aria-label="Refresh"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-transparent text-muted transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35"
              onClick={onRefreshSessions}
              title="刷新会话列表"
              type="button"
            >
              <RefreshIcon size={15} />
            </button>
          </div>
        </div>

        {/* Fixed 4 CLI Workspaces Grid */}
        <div
          className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-4 overflow-hidden max-[760px]:grid-cols-1 max-[760px]:grid-rows-none max-[760px]:overflow-y-auto"
          data-testid="cli-workspaces-grid"
        >
          {cliWorkspaces.map((workspace) => (
            <section
              aria-label={`${workspace.label} 会话工作区`}
              className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-sidebar transition-colors duration-150 hover:border-line-strong max-[760px]:min-h-[220px] max-[760px]:max-h-[260px]"
              data-cli-workspace={workspace.cliId}
              key={workspace.cliId}
            >
              {/* CLI Workspace Header */}
              <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/60 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line bg-surface">
                    <CliIcon cliId={workspace.cliId} size={15} />
                  </span>
                  <div className="flex min-w-0 items-baseline gap-2">
                    <h3 className="m-0 truncate text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                      {workspace.label}
                    </h3>
                    <span className="font-code text-[10px] tracking-wide text-muted uppercase">
                      {workspace.cliId}
                    </span>
                  </div>
                </div>

                <span
                  className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 font-code text-[10.5px] text-muted-strong"
                  data-cli-count={workspace.cliId}
                >
                  {trimmedQuery
                    ? `${workspace.sessions.length} / ${workspace.totalCount}`
                    : workspace.totalCount}
                </span>
              </header>

              {/* Bounded Session List (clipped to workspace height, quiet internal scroll) */}
              <div className="min-h-0 flex-1 overflow-hidden">
                {workspace.sessions.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1.5 px-4 text-muted/65">
                    <HistoryIcon size={18} />
                    <span className="text-[12px]">
                      {trimmedQuery ? "无匹配会话" : "暂无会话记录"}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full flex-col gap-1 overflow-y-auto px-2.5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {workspace.sessions.map((session) => {
                      const active = activeSessionId === session.id;
                      const sessionWorkspaceLabel = session.workspace?.trim()
                        ? workspaceName(session.workspace)
                        : null;
                      return (
                        <button
                          className={`group flex w-full shrink-0 items-center gap-2.5 overflow-hidden rounded-xl border px-3 py-2 text-left transition-all duration-140 ${
                            active
                              ? "border-line-strong bg-surface text-ink shadow-2xs"
                              : "border-transparent bg-transparent text-ink-soft hover:border-line hover:bg-surface hover:text-ink"
                          }`}
                          key={session.id}
                          onClick={() => onOpenSession(session.id)}
                          title={session.title}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                              active ? "bg-ink" : "bg-line-strong group-hover:bg-muted"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12.5px] font-[520]">
                            {session.title}
                          </span>
                          {sessionWorkspaceLabel ? (
                            <span className="max-w-[96px] shrink-0 truncate rounded-md bg-surface-subtle px-1.5 py-0.5 font-code text-[10px] text-muted">
                              {sessionWorkspaceLabel}
                            </span>
                          ) : null}
                          <time className="shrink-0 font-code text-[10.5px] text-muted">
                            {formatTimestamp(session.updatedAt)}
                          </time>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
