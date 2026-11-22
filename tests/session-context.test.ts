import { describe, expect, test } from "bun:test";

import type { SessionTurn } from "../src/models/session";
import { buildPromptWithContext } from "../src/session/context";

function turn(overrides: Partial<SessionTurn> = {}): SessionTurn {
  return {
    id: 1,
    sessionId: "session-1",
    cliId: "codex",
    prompt: "上一问",
    output: "上一答",
    exitCode: 0,
    signal: null,
    durationMs: 100,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("buildPromptWithContext", () => {
  test("returns the prompt untouched when there is no history", () => {
    expect(buildPromptWithContext([], "do work")).toBe("do work");
  });

  test("replays history so a new CLI can pick up the context", () => {
    const history = [
      turn({ id: 1, cliId: "codex", prompt: "先做 A", output: "A 完成" }),
      turn({ id: 2, cliId: "claude", prompt: "再做 B", output: "B 完成" }),
    ];

    const prompt = buildPromptWithContext(history, "继续做 C");

    expect(prompt).toContain("协作记录");
    expect(prompt).toContain("[#1] 用户:");
    expect(prompt).toContain("先做 A");
    expect(prompt).toContain("[#2] claude 输出:");
    expect(prompt).toContain("B 完成");
    expect(prompt).toContain("用户新请求：");
    expect(prompt.endsWith("继续做 C")).toBe(true);
  });

  test("caps oversized turn outputs to their tail", () => {
    const longOutput = "x".repeat(4_000);
    const prompt = buildPromptWithContext([turn({ output: longOutput })], "继续");

    expect(prompt).toContain("…");
    expect(prompt).toContain("x".repeat(1_500));
    expect(prompt).not.toContain("x".repeat(1_600));
  });

  test("drops the oldest turns when the total budget is exceeded", () => {
    // 每轮输出约 1.5k 字符，预算 8k：最新的约 5 轮保留，更旧的被丢弃。
    const history = Array.from({ length: 10 }, (_, index) =>
      turn({
        id: index + 1,
        prompt: `第 ${index + 1} 问`,
        output: "z".repeat(1_500),
      }),
    );

    const prompt = buildPromptWithContext(history, "继续");

    expect(prompt).not.toContain("第 1 问");
    expect(prompt).not.toContain("第 4 问");
    expect(prompt).toContain("第 6 问");
    expect(prompt).toContain("第 10 问");
  });
});
