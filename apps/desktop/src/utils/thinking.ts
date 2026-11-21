import type { AgentEvent } from "../types";

export const THINKING_TAG_PAIRS = [
  ["<thinking>", "</thinking>"],
  ["<thought>", "</thought>"],
  ["<think>", "</think>"],
] as const;

export interface SplitThinkingResult {
  thinking: string;
  output: string;
  isThinkingOpen: boolean;
}

interface TagMatch {
  index: number;
  openLength: number;
  closeTag: string;
}

function findNextOpenTag(text: string, fromIndex: number): TagMatch | null {
  const lower = text.toLowerCase();
  let earliest: TagMatch | null = null;

  for (const [openTag, closeTag] of THINKING_TAG_PAIRS) {
    const idx = lower.indexOf(openTag, fromIndex);
    if (idx !== -1 && (earliest === null || idx < earliest.index)) {
      earliest = { index: idx, openLength: openTag.length, closeTag };
    }
  }

  return earliest;
}

/**
 * Separate inline thinking tag blocks (<thinking>, <thought>, <think>) from visible assistant output.
 * Supports streaming unclosed tags so partial thinking stays out of the main output field.
 */
export function splitThinkingAndOutput(rawText: string): SplitThinkingResult {
  if (!rawText) {
    return { thinking: "", output: "", isThinkingOpen: false };
  }

  const thinkingParts: string[] = [];
  const outputParts: string[] = [];
  let cursor = 0;
  let isThinkingOpen = false;
  const lower = rawText.toLowerCase();

  while (cursor < rawText.length) {
    const match = findNextOpenTag(rawText, cursor);
    if (!match) {
      outputParts.push(rawText.slice(cursor));
      break;
    }

    if (match.index > cursor) {
      outputParts.push(rawText.slice(cursor, match.index));
    }

    const contentStart = match.index + match.openLength;
    const closeIndex = lower.indexOf(match.closeTag, contentStart);
    if (closeIndex === -1) {
      const partial = rawText.slice(contentStart).trim();
      if (partial) {
        thinkingParts.push(partial);
      }
      isThinkingOpen = true;
      cursor = rawText.length;
      break;
    }

    const block = rawText.slice(contentStart, closeIndex).trim();
    if (block) {
      thinkingParts.push(block);
    }
    cursor = closeIndex + match.closeTag.length;
  }

  const output = outputParts.join("").replace(/^\n+/, "");
  const thinking = thinkingParts.join("\n\n");
  return { thinking, output, isThinkingOpen };
}

/**
 * Combine structured thinking events with any inline extracted thinking without duplicating content.
 */
export function mergeThinkingContent(
  structuredThinking: string,
  inlineThinking: string,
): string {
  const structured = structuredThinking.trim();
  const inline = inlineThinking.trim();
  if (!structured) {
    return inline;
  }
  if (!inline || structured === inline) {
    return structured;
  }
  return `${structured}\n\n${inline}`;
}

/**
 * Collect all thinking text from a completed run's structured event list.
 */
export function collectThinkingFromEvents(events: readonly AgentEvent[]): string {
  return events
    .filter((event) => event.kind === "thinking" && typeof event.text === "string")
    .map((event) => event.text ?? "")
    .join("");
}

/**
 * Return the latest non-empty line of thinking normalized to a single line for the collapsed bar.
 */
export function summarizeThinkingLine(thinking: string): string {
  const lines = thinking
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * Count non-empty lines in thinking content for display in the collapsed bar.
 */
export function countThinkingLines(thinking: string): number {
  if (!thinking.trim()) {
    return 0;
  }
  return thinking
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}
