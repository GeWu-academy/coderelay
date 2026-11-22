import { AnimatePresence, motion } from "motion/react";

import { ArrowUpIcon, HistoryIcon, RefreshIcon, TerminalIcon, ThinkingBar } from "../../components";
import type { SessionDetail, SessionRecord } from "../../types";
import { formatTimestamp, workspaceName } from "../../utils";
import { splitThinkingAndOutput } from "../../utils/thinking";

export interface SessionsViewProps {
  workspaceInput: string;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  sessionDetail: SessionDetail | null;
  onRefreshSessions: () => void;
  onOpenSession: (sessionId: string) => void;
  onContinueSession: () => void;
}

export function SessionsView({
  workspaceInput,
  sessions,
  activeSessionId,
  sessionDetail,
  onRefreshSessions,
  onOpenSession,
  onContinueSession,
}: SessionsViewProps) {
  return (
    <motion.section
      key="sessions"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="min-h-0 flex-1 overflow-auto px-10 py-7 max-[900px]:px-6 max-[900px]:py-5"
      aria-live="polite"
    >
      <div className="mx-auto w-[min(920px,100%)]">
        <div className="flex items-center justify-between gap-4 border-b border-line pb-3.5">
          <span className="truncate font-code text-xs text-muted-strong">
            {workspaceName(workspaceInput)}
          </span>
          <button
            aria-label="Refresh"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-transparent text-muted transition-colors duration-140 enabled:hover:bg-surface-subtle enabled:hover:text-ink disabled:opacity-35"
            onClick={onRefreshSessions}
            title="Refresh"
            type="button"
          >
            <RefreshIcon size={15} />
          </button>
        </div>

        <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-5 pt-[18px] max-[900px]:grid-cols-1">
          <div className="flex max-h-[calc(100dvh-150px)] flex-col gap-1.5 overflow-auto max-[900px]:max-h-[220px]">
            {sessions.length === 0 ? (
              <div className="flex min-h-[280px] items-center justify-center text-zinc-300">
                <HistoryIcon />
              </div>
            ) : (
              sessions.map((session) => (
                <button
                  className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-xl border px-3 py-[11px] text-left transition-all duration-140 ${
                    activeSessionId === session.id
                      ? "border-line-strong bg-surface-subtle text-ink"
                      : "border-line bg-surface text-ink-soft hover:border-line-strong hover:bg-surface-subtle hover:text-ink"
                  }`}
                  key={session.id}
                  onClick={() => onOpenSession(session.id)}
                  type="button"
                >
                  <span className="row-span-2 self-center rounded-[6px] bg-surface-hover px-1.5 py-[3px] font-code text-[10px] text-ink-soft uppercase">
                    {session.cliId}
                  </span>
                  <strong className="truncate text-[12.5px] font-[550]">{session.title}</strong>
                  <small className="font-code text-[10.5px] text-muted">
                    {formatTimestamp(session.updatedAt)}
                  </small>
                </button>
              ))
            )}
          </div>

          <div className="min-h-[400px] rounded-2xl border border-line bg-sidebar p-5">
            <AnimatePresence mode="wait">
              {sessionDetail ? (
                <motion.div
                  key={sessionDetail.session.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  <div className="flex items-center justify-between gap-4 border-b border-line pb-3.5">
                    <h3 className="m-0 truncate text-[15px] font-semibold tracking-[-0.015em]">
                      {sessionDetail.session.title}
                    </h3>
                    <button
                      aria-label="Continue"
                      className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-ink text-white transition-all duration-140 enabled:hover:bg-black"
                      onClick={onContinueSession}
                      title="Continue"
                      type="button"
                    >
                      <ArrowUpIcon size={15} />
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-3">
                    {sessionDetail.turns.map((turn) => {
                      const turnSplit = turn.output
                        ? splitThinkingAndOutput(turn.output)
                        : null;
                      return (
                        <article
                          className="rounded-xl border border-line bg-surface p-3.5"
                          key={turn.id}
                        >
                          <div className="flex flex-wrap gap-2 font-code text-[10px] text-muted uppercase">
                            <span>{turn.cliId}</span>
                            {turn.modelId ? <span>{turn.modelId}</span> : null}
                          </div>
                          <div className="mt-2 text-[13px] leading-[1.6] text-ink">
                            {turn.prompt}
                          </div>
                          {turnSplit?.thinking ? (
                            <div className="mt-2.5">
                              <ThinkingBar thinking={turnSplit.thinking} />
                            </div>
                          ) : null}
                          {turnSplit?.output ? (
                            <pre className="mt-2.5 max-h-[260px] overflow-auto rounded-[9px] border border-line bg-surface-subtle p-3 font-code text-[11.5px] leading-[1.65] whitespace-pre-wrap text-ink-soft">
                              {turnSplit.output}
                            </pre>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="session-empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex min-h-[280px] items-center justify-center text-zinc-300"
                >
                  <TerminalIcon />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
