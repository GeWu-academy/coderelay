import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runFavoriteCommand } from "../src/commands/favorite";
import { createProgram } from "../src/cli.ts";
import { createSessionStore } from "../src/session/store";

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "coderelay-fav-test-")), "sessions.db");
}

describe("favorite command", () => {
  test("shows not set message when no favorite is configured", async () => {
    let output = "";
    const store = createSessionStore(tempDbPath());
    const exitCode = await runFavoriteCommand(
      {},
      {
        store,
        write: (text) => {
          output += text;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("尚未设置最喜欢的初始化 agent");
    store.close();
  });

  test("sets favorite agent successfully and persists it", async () => {
    let output = "";
    const store = createSessionStore(tempDbPath());
    const exitCode = await runFavoriteCommand(
      { agent: "claude" },
      {
        store,
        write: (text) => {
          output += text;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("Claude Code (claude)");
    expect(store.getFavoriteAgent()).toBe("claude");

    // Query without arguments to see current
    output = "";
    const queryCode = await runFavoriteCommand(
      {},
      {
        store,
        write: (text) => {
          output += text;
        },
      },
    );
    expect(queryCode).toBe(0);
    expect(output).toContain("当前最喜欢的初始化 agent: Claude Code (claude)");
    store.close();
  });

  test("clears favorite agent with 'clear'", async () => {
    let output = "";
    const store = createSessionStore(tempDbPath());
    store.setFavoriteAgent("codex");

    const exitCode = await runFavoriteCommand(
      { agent: "clear" },
      {
        store,
        write: (text) => {
          output += text;
        },
      },
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("已清除最喜欢的初始化 agent 偏好");
    expect(store.getFavoriteAgent()).toBeNull();
    store.close();
  });


  test("does not expose the unused cwd option", () => {
    const favorite = createProgram().commands.find((command) => command.name() === "favorite");

    expect(favorite?.options.some((option) => option.long === "--cwd")).toBe(false);
  });

  test("rejects unknown agent with exit code 1", async () => {
    let output = "";
    const store = createSessionStore(tempDbPath());
    const exitCode = await runFavoriteCommand(
      { agent: "unknown_agent" },
      {
        store,
        write: (text) => {
          output += text;
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(output).toContain("无效的 agent");
    store.close();
  });
});
