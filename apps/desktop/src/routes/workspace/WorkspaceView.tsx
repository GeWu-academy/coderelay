import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { RouteIcon, TerminalIcon, ThinkingBar } from "../../components";
import type { AgentRunResult, RoutePreview } from "../../types";
import { formatDuration, getWelcomeTimeSnapshot } from "../../utils";
import { mergeThinkingContent, splitThinkingAndOutput } from "../../utils/thinking";

export interface WorkspaceViewProps {
  error: string | null;
  showThread: boolean;
  running: boolean;
  result: AgentRunResult | null;
  preview: RoutePreview | null;
  thinking?: string;
  output: string;
  activity: string[];
  renderComposer: (compact?: boolean) => ReactNode;
}

export function WorkspaceView({
  error,
  showThread,
  running,
  result,
  preview,
  thinking = "",
  output,
  activity,
  renderComposer,
}: WorkspaceViewProps) {
  const [timeSnapshot, setTimeSnapshot] = useState(() => getWelcomeTimeSnapshot());
  const inlineSplit = splitThinkingAndOutput(output);
  const combinedThinking = mergeThinkingContent(thinking, inlineSplit.thinking);
  const visibleOutput = inlineSplit.output;
  const isThinkingActive =
    running &&
    (inlineSplit.isThinkingOpen || (Boolean(combinedThinking) && !visibleOutput));

  useEffect(() => {
    if (showThread) {
      return;
    }
    setTimeSnapshot(getWelcomeTimeSnapshot());
    const timer = window.setInterval(() => {
      setTimeSnapshot(getWelcomeTimeSnapshot());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [showThread]);

  return (
    <motion.section
      key="workspace"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgba(17,18,21,0.12)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
      aria-live="polite"
    >
      <div className="mx-auto min-h-full w-[min(760px,calc(100%-64px))] pt-9 pb-7">
        <AnimatePresence>
          {error ? (
            <motion.div
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={{ duration: 0.18 }}
              className="mb-5 flex items-center rounded-[10px] border border-red-600/16 bg-danger-soft px-3.5 py-2.5 font-code text-[11px] leading-[1.5] text-red-800"
              role="alert"
            >
              <span>{error}</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {!showThread ? (
            <motion.div
              key="welcome-hero"
              initial={{ opacity: 0, scale: 0.985, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985, y: -10 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="flex min-h-[calc(100dvh-130px)] flex-col items-center justify-center pt-6 pb-16"
            >
              <div className="mb-9 flex flex-col items-center text-center select-none">
                <h1 className="m-0 mb-3 font-display text-[32px] leading-[1.2] font-semibold tracking-[-0.03em] text-ink">
                  {timeSnapshot.greeting}
                </h1>
                <p className="m-0 max-w-[480px] text-[15px] leading-[1.6] text-muted">
                  {timeSnapshot.encouragement}
                </p>
              </div>
              {renderComposer(false)}
            </motion.div>
          ) : (
            <motion.article
              key="assistant-message"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="animate-rise-in"
            >
              <div className="mb-3.5 flex items-center gap-2">
                <span
                  className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300 data-[tone=ready]:bg-success data-[tone=running]:animate-breathe data-[tone=running]:bg-ink data-[tone=running]:shadow-[0_0_0_3px_rgba(17,18,21,0.08)]"
                  data-tone={running ? "running" : "ready"}
                />
                {result ? (
                  <span className="font-code text-[11px] text-muted">
                    {formatDuration(result.durationMs)}
                  </span>
                ) : null}
                {result?.code !== undefined &&
                result.code !== null &&
                result.code !== 0 ? (
                  <span className="ml-auto rounded-full border border-line bg-danger-soft px-[7px] py-0.5 font-code text-[10px] text-danger">
                    {result.code}
                  </span>
                ) : null}
              </div>

              <AnimatePresence>
                {preview ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.16 }}
                    className="mb-[18px] inline-flex items-center gap-[7px] rounded-full border border-line bg-surface-subtle px-2.5 py-[5px] font-code text-[11px] text-muted-strong"
                  >
                    <RouteIcon size={13} />
                    <strong className="font-medium text-ink-soft">
                      {preview.agent}
                      {preview.model ? ` · ${preview.model}` : ""}
                    </strong>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <ThinkingBar
                thinking={combinedThinking}
                isThinking={isThinkingActive}
              />

              <div className="min-h-[44px] text-sm leading-[1.85] break-words whitespace-pre-wrap text-ink">
                {visibleOutput}
                {running && !visibleOutput && !isThinkingActive ? (
                  <span className="inline-flex items-center gap-1 align-middle" aria-hidden="true">
                    <i className="h-[5px] w-[5px] animate-typing rounded-full bg-ink" />
                    <i className="h-[5px] w-[5px] animate-typing rounded-full bg-ink [animation-delay:150ms]" />
                    <i className="h-[5px] w-[5px] animate-typing rounded-full bg-ink [animation-delay:300ms]" />
                  </span>
                ) : null}
              </div>

              <AnimatePresence>
                {activity.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.18 }}
                    className="mt-[22px] overflow-hidden rounded-xl border border-line bg-surface-subtle text-muted-strong"
                  >
                    <div className="flex items-center justify-between border-b border-line px-3 py-[7px] font-code text-[10px] text-muted">
                      <span className="inline-flex items-center text-muted-strong">
                        <TerminalIcon size={13} />
                      </span>
                      <span>{activity.length}</span>
                    </div>
                    <div className="max-h-[120px] overflow-y-auto py-1.5">
                      {activity.map((entry, index) => (
                        <div
                          className="flex items-start gap-1.5 px-3 py-[3px] font-code text-[11px] leading-[1.55] text-muted-strong"
                          key={`${index}-${entry}`}
                        >
                          <span className="text-muted">›</span>
                          <span>{entry}</span>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.article>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
