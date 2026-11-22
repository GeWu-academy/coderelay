import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import {
  countThinkingLines,
  summarizeThinkingLine,
} from "../../utils/thinking";
import { ChevronDownIcon, ChevronRightIcon } from "../icons";

export interface ThinkingBarProps {
  thinking: string;
  isThinking?: boolean;
  defaultExpanded?: boolean;
}

/**
 * Collapsible thinking layer: renders as a single compact one-line bar when collapsed,
 * and reveals the full thinking content only when expanded.
 */
export function ThinkingBar({
  thinking,
  isThinking = false,
  defaultExpanded = false,
}: ThinkingBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const trimmed = thinking.trim();

  if (!trimmed && !isThinking) {
    return null;
  }

  const summary = summarizeThinkingLine(trimmed);
  const lineCount = countThinkingLines(trimmed);

  return (
    <div
      className="mb-3.5 overflow-hidden rounded-xl border border-line bg-surface-subtle text-muted-strong"
      data-testid="thinking-bar"
      data-expanded={expanded}
    >
      <button
        aria-expanded={expanded}
        className="flex h-8 w-full cursor-pointer items-center gap-2 px-3 text-left transition-colors duration-140 hover:bg-surface-hover/60"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400 data-[active=true]:animate-breathe data-[active=true]:bg-ink data-[active=true]:shadow-[0_0_0_3px_rgba(17,18,21,0.08)]"
          data-active={isThinking}
        />
        <span className="shrink-0 font-code text-[11px] font-medium text-ink-soft">
          {isThinking ? "Thinking..." : "Thinking"}
        </span>
        {!expanded && summary ? (
          <span className="min-w-0 flex-1 truncate font-code text-[11px] text-muted">
            {summary}
          </span>
        ) : (
          <span className="flex-1" />
        )}
        {lineCount > 0 ? (
          <span className="shrink-0 font-code text-[10px] text-muted">
            {lineCount}L
          </span>
        ) : null}
        <span className="shrink-0 text-muted">
          {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && trimmed ? (
          <motion.div
            key="thinking-detail"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden border-t border-line"
          >
            <div
              className="max-h-[240px] overflow-y-auto px-3 py-2.5 font-code text-[11.5px] leading-[1.65] break-words whitespace-pre-wrap text-muted-strong [scrollbar-color:rgba(17,18,21,0.12)_transparent] [scrollbar-width:thin]"
              data-testid="thinking-detail"
            >
              {trimmed}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
