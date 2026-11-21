import { describe, expect, test } from "bun:test";

import {
  THINKING_TAG_PAIRS,
  collectThinkingFromEvents,
  countThinkingLines,
  mergeThinkingContent,
  splitThinkingAndOutput,
  summarizeThinkingLine,
} from "./thinking";

describe("thinking layer utilities", () => {
  test("maintains SSOT THINKING_TAG_PAIRS with standard thinking tags", () => {
    expect(THINKING_TAG_PAIRS.length).toBeGreaterThanOrEqual(3);
    expect(THINKING_TAG_PAIRS).toContainEqual(["<thinking>", "</thinking>"]);
    expect(THINKING_TAG_PAIRS).toContainEqual(["<thought>", "</thought>"]);
    expect(THINKING_TAG_PAIRS).toContainEqual(["<think>", "</think>"]);
  });

  test("separates closed <thinking> blocks from visible assistant output", () => {
    const raw =
      "<thinking>\n1. Inspect files\n2. Plan edit\n</thinking>\n\nHere is the final answer.";
    const result = splitThinkingAndOutput(raw);

    expect(result.thinking).toBe("1. Inspect files\n2. Plan edit");
    expect(result.output).toBe("Here is the final answer.");
    expect(result.isThinkingOpen).toBe(false);
  });

  test("handles streaming unclosed thinking tags without leaking into output", () => {
    const raw = "<thought>Analyzing module dependencies\nChecking types";
    const result = splitThinkingAndOutput(raw);

    expect(result.thinking).toBe("Analyzing module dependencies\nChecking types");
    expect(result.output).toBe("");
    expect(result.isThinkingOpen).toBe(true);
  });

  test("handles multiple thinking blocks and mixed tag variants", () => {
    const raw =
      "Intro\n<think>first step</think>\nMiddle\n<thinking>second step</thinking>\nEnd";
    const result = splitThinkingAndOutput(raw);

    expect(result.thinking).toBe("first step\n\nsecond step");
    expect(result.output).toBe("Intro\n\nMiddle\n\nEnd");
    expect(result.isThinkingOpen).toBe(false);
  });

  test("merges structured thinking and inline thinking without duplication", () => {
    expect(mergeThinkingContent("step 1\nstep 2", "step 1\nstep 2")).toBe(
      "step 1\nstep 2",
    );
    expect(mergeThinkingContent("structured", "inline")).toBe(
      "structured\n\ninline",
    );
    expect(mergeThinkingContent("", "inline only")).toBe("inline only");
  });

  test("collects thinking events separately from assistant_text and tool events", () => {
    const collected = collectThinkingFromEvents([
      { kind: "thinking", text: "first " },
      { kind: "assistant_text", text: "visible reply" },
      { kind: "tool_started", tool: "rg" },
      { kind: "thinking", text: "second" },
    ]);

    expect(collected).toBe("first second");
  });

  test("summarizes latest non-empty line and counts non-empty lines", () => {
    const thinking = "First line\n\n  Second   line  \n";
    expect(summarizeThinkingLine(thinking)).toBe("Second line");
    expect(countThinkingLines(thinking)).toBe(2);
    expect(countThinkingLines("   \n  ")).toBe(0);
  });
});
