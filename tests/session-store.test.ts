import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Database } from "bun:sqlite";

import {
  SCHEMA_VERSION,
  applyColumnMigration,
  createSessionStore,
  defaultSessionDbPath,
  isDuplicateColumnError,
} from "../src/session/store";

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "coderelay-sessions-")), "sessions.db");
}

describe("session store", () => {
  test("creates sessions and appends turns in order", () => {
    const store = createSessionStore(tempDbPath());

    const session = store.createSession("claude", "修一个测试");
    expect(session.cliId).toBe("claude");
    expect(session.title).toBe("修一个测试");
    expect(store.getSession(session.id)?.title).toBe("修一个测试");

    store.appendTurn({
      sessionId: session.id,
      cliId: "claude",
      prompt: "第一问",
      output: "答案一",
      exitCode: 0,
      signal: null,
      durationMs: 1200,
    });
    store.appendTurn({
      sessionId: session.id,
      cliId: "codex",
      prompt: "第二问",
      output: "",
      exitCode: 2,
      signal: null,
      durationMs: 300,
    });

    const turns = store.listTurns(session.id);
    expect(turns.length).toBe(2);
    expect(turns[0]?.prompt).toBe("第一问");
    expect(turns[0]?.cliId).toBe("claude");
    expect(turns[1]?.cliId).toBe("codex");
    expect(turns[1]?.exitCode).toBe(2);
    store.close();
  });

  test("rejects turns that reference a missing session", () => {
    const store = createSessionStore(tempDbPath());

    expect(() =>
      store.appendTurn({
        sessionId: "missing-session",
        cliId: "claude",
        prompt: "orphan turn",
        output: "must not persist",
        exitCode: 0,
        signal: null,
        durationMs: 12,
      }),
    ).toThrow();
    expect(store.listTurns("missing-session")).toEqual([]);
    store.close();
  });

  test("reopening the same database reads sessions across processes", () => {
    const path = tempDbPath();
    const first = createSessionStore(path);
    const session = first.createSession("codex", "跨进程接力");
    first.appendTurn({
      sessionId: session.id,
      cliId: "codex",
      prompt: "上一棒",
      output: "产出",
      exitCode: 0,
      signal: null,
      durationMs: 100,
    });
    first.close();

    const second = createSessionStore(path);
    expect(second.getSession(session.id)?.title).toBe("跨进程接力");
    const turns = second.listTurns(session.id);
    expect(turns.length).toBe(1);
    expect(turns[0]?.output).toBe("产出");
    second.close();
  });

  test("prunes oldest sessions together with their turns", async () => {
    const store = createSessionStore(tempDbPath());
    const sessions = [];

    for (let index = 0; index < 5; index += 1) {
      const session = store.createSession("codex", `会话 ${index}`);
      store.appendTurn({
        sessionId: session.id,
        cliId: "codex",
        prompt: `第 ${index} 问`,
        output: `第 ${index} 答`,
        exitCode: 0,
        signal: null,
        durationMs: 100,
      });
      sessions.push(session);
      await sleep(3);
    }

    expect(store.pruneSessions(3)).toBe(2);
    for (const [index, session] of sessions.entries()) {
      if (index < 2) {
        expect(store.getSession(session.id)).toBeNull();
        expect(store.listTurns(session.id)).toEqual([]);
      } else {
        expect(store.getSession(session.id)?.id).toBe(session.id);
      }
    }
    store.close();
  });

  test("keeps every session when the database is below the limit", () => {
    const store = createSessionStore(tempDbPath());
    const first = store.createSession("codex", "第一会话");
    const second = store.createSession("claude", "第二会话");

    expect(store.pruneSessions(5)).toBe(0);
    expect(store.getSession(first.id)?.id).toBe(first.id);
    expect(store.getSession(second.id)?.id).toBe(second.id);
    store.close();
  });

  test("keeps the most recently active session instead of the newest created", async () => {
    const store = createSessionStore(tempDbPath());
    const older = store.createSession("codex", "旧会话");
    await sleep(3);
    const newer = store.createSession("claude", "新会话");
    await sleep(3);
    store.appendTurn({
      sessionId: older.id,
      cliId: "codex",
      prompt: "继续旧会话",
      output: "最近活跃",
      exitCode: 0,
      signal: null,
      durationMs: 100,
    });

    expect(store.pruneSessions(1)).toBe(1);
    expect(store.getSession(older.id)?.id).toBe(older.id);
    expect(store.listTurns(older.id)).toHaveLength(1);
    expect(store.getSession(newer.id)).toBeNull();
    store.close();
  });

  test("persists preferences and favorite agent across store instances", () => {
    const path = tempDbPath();
    const first = createSessionStore(path);

    expect(first.getFavoriteAgent()).toBeNull();
    first.setFavoriteAgent("claude");
    expect(first.getFavoriteAgent()).toBe("claude");
    expect(first.getPreference("favorite_agent")).toBe("claude");
    first.close();

    const second = createSessionStore(path);
    expect(second.getFavoriteAgent()).toBe("claude");

    // update preference
    second.setFavoriteAgent("codex");
    expect(second.getFavoriteAgent()).toBe("codex");

    // clear preference
    second.clearFavoriteAgent();
    expect(second.getFavoriteAgent()).toBeNull();
    second.close();
  });

  test("resolves default session db to global .coderelay directory across platforms", () => {
    expect(defaultSessionDbPath()).toBe(join(homedir(), ".coderelay", "sessions.db"));

    const customHome = "/tmp/mock-home";
    expect(defaultSessionDbPath(customHome)).toBe(join(customHome, ".coderelay", "sessions.db"));

    // Windows paths with backslashes
    expect(defaultSessionDbPath("C:\\Users\\tester")).toBe(
      "C:\\Users\\tester\\.coderelay\\sessions.db",
    );
    expect(defaultSessionDbPath(undefined, { USERPROFILE: "C:\\Users\\winuser" }, "win32")).toBe(
      "C:\\Users\\winuser\\.coderelay\\sessions.db",
    );

    // Linux
    expect(defaultSessionDbPath(undefined, { HOME: "/home/linuxuser" }, "linux")).toBe(
      "/home/linuxuser/.coderelay/sessions.db",
    );

    // macOS
    expect(defaultSessionDbPath(undefined, { HOME: "/Users/macuser" }, "darwin")).toBe(
      "/Users/macuser/.coderelay/sessions.db",
    );

    // CODERELAY_HOME override
    expect(defaultSessionDbPath(undefined, { CODERELAY_HOME: "/custom/global" })).toBe(
      "/custom/global/.coderelay/sessions.db",
    );
  });

  test("persists workspace info on sessions and queries by workspace", async () => {
    const store = createSessionStore(tempDbPath());

    const sessionA = store.createSession("codex", "Workspace A task", "/workspace/a");
    await sleep(3);
    const sessionB = store.createSession("claude", "Workspace B task", "/workspace/b");
    await sleep(3);
    const sessionA2 = store.createSession("pi", "Workspace A second task", "/workspace/a");

    expect(sessionA.workspace).toBe("/workspace/a");
    expect(sessionB.workspace).toBe("/workspace/b");
    expect(store.getSession(sessionA.id)?.workspace).toBe("/workspace/a");

    const sessionsForA = store.listSessions({ workspace: "/workspace/a" });
    expect(sessionsForA.length).toBe(2);
    expect(sessionsForA.map((s) => s.id)).toEqual([sessionA2.id, sessionA.id]);

    const sessionsForB = store.listSessions({ workspace: "/workspace/b" });
    expect(sessionsForB.length).toBe(1);
    expect(sessionsForB[0]?.id).toBe(sessionB.id);

    const allSessions = store.listSessions();
    expect(allSessions.length).toBe(3);

    store.close();
  });

  test("retrieves recent workspaces from sessions", async () => {
    const path = tempDbPath();
    const first = createSessionStore(path);

    first.createSession("codex", "Task 1", "/projects/alpha");
    await sleep(3);
    first.createSession("claude", "Task 2", "/projects/beta");
    await sleep(3);
    first.createSession("pi", "Task 3", "/projects/alpha");

    const recent = first.getRecentWorkspaces();
    expect(recent).toEqual(["/projects/alpha", "/projects/beta"]);

    // Opening an empty folder persists to SQLite and shows in recent workspaces
    first.recordWorkspace("/projects/gamma-opened");
    expect(first.getRecentWorkspaces()).toEqual([
      "/projects/gamma-opened",
      "/projects/alpha",
      "/projects/beta",
    ]);

    first.close();
  });

  test("migration ignores duplicate column error", () => {
    let executed = false;
    const db = {
      exec: () => {
        executed = true;
        throw new Error("duplicate column name: workspace");
      },
    };
    expect(() =>
      applyColumnMigration(db, "ALTER TABLE sessions ADD COLUMN workspace TEXT"),
    ).not.toThrow();
    expect(executed).toBe(true);
  });

  test("migration throws and includes SQL and column info on non-duplicate error", () => {
    const db = {
      exec: () => {
        throw new Error("attempt to write a readonly database");
      },
    };
    const sql = "ALTER TABLE sessions ADD COLUMN workspace TEXT";
    expect(() => applyColumnMigration(db, sql)).toThrowError(
      /Migration failed for column "workspace" \(ALTER TABLE sessions ADD COLUMN workspace TEXT\): attempt to write a readonly database/,
    );
  });

  test("migration preserves cause on error", () => {
    const originalError = new Error("database is locked");
    const db = {
      exec: () => {
        throw originalError;
      },
    };
    try {
      applyColumnMigration(db, "ALTER TABLE turns ADD COLUMN model_id TEXT");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("model_id");
      expect((err as Error).message).toContain("ALTER TABLE turns ADD COLUMN model_id TEXT");
      expect((err as { cause?: unknown }).cause).toBe(originalError);
    }
  });

  test("isDuplicateColumnError accurately identifies duplicate column errors", () => {
    expect(isDuplicateColumnError(new Error("duplicate column name: workspace"), "workspace")).toBe(
      true,
    );
    expect(isDuplicateColumnError(new Error("duplicate column name: WORKSPACE"), "workspace")).toBe(
      true,
    );
    expect(isDuplicateColumnError(new Error("duplicate column name: model_id"), "workspace")).toBe(
      false,
    );
    expect(
      isDuplicateColumnError(new Error("attempt to write a readonly database"), "workspace"),
    ).toBe(false);
    expect(isDuplicateColumnError(new Error("database is locked"), "workspace")).toBe(false);
    expect(isDuplicateColumnError(new Error("disk I/O error"), "workspace")).toBe(false);
    expect(isDuplicateColumnError(new Error("database disk image is malformed"), "workspace")).toBe(
      false,
    );
    expect(isDuplicateColumnError(null)).toBe(false);
  });

  test("migration handles real SQLite database duplicate columns and syntax errors", () => {
    const path = tempDbPath();
    const store = createSessionStore(path);
    store.close();

    // Reopening runs migrations on already migrated database without throwing
    const reopened = createSessionStore(path);
    expect(reopened.listSessions()).toEqual([]);
    reopened.close();

    const db = new Database(path);
    try {
      expect(() => applyColumnMigration(db, "ALTER TABLE sessions ADD COLUMN")).toThrowError(
        /Migration failed for column/,
      );
    } finally {
      db.close();
    }
  });

  test("fresh database exposes only normalized v2 tables and indexes", () => {
    const path = tempDbPath();
    const store = createSessionStore(path);
    store.close();

    const db = new Database(path);
    try {
      const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
      expect(version?.user_version).toBe(SCHEMA_VERSION);

      const tables = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(["preferences", "sessions", "turns", "workspaces"]);

      const indexes = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name);
      expect(indexes).toEqual([
        "idx_sessions_updated",
        "idx_sessions_workspace_updated",
        "idx_turns_session",
        "idx_workspaces_updated",
      ]);
    } finally {
      db.close();
    }
  });

  test("migrates v1 database with orphan tables to v2 without data loss", () => {
    const path = tempDbPath();
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        cli_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        workspace TEXT
      );
      CREATE TABLE turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        cli_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        output TEXT NOT NULL DEFAULT '',
        exit_code INTEGER,
        signal TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        model_id TEXT,
        protocol TEXT,
        reused_native INTEGER,
        status TEXT,
        event_summary TEXT,
        context_source TEXT
      );
      CREATE TABLE preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE recent_workspaces (
        workspace TEXT PRIMARY KEY,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO schema_meta VALUES ('schema_version', '1');
      INSERT INTO preferences VALUES ('favorite_agent', 'claude', 100);
      INSERT INTO recent_workspaces VALUES ('/ws/empty-opened', 500);
      INSERT INTO sessions VALUES ('s1', 'claude', 'Migrated session', 100, 400, '/ws/from-session');
      INSERT INTO turns (
        session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at,
        model_id, protocol, reused_native, status, event_summary, context_source
      ) VALUES (
        's1', 'claude', 'p1', 'o1', 0, NULL, 250, 400,
        'claude-sonnet-4', 'structured', 0, 'completed', 'done', 'transcript'
      );
    `);
    legacy.close();

    const store = createSessionStore(path);
    expect(store.getFavoriteAgent()).toBe("claude");
    expect(store.getRecentWorkspaces(10)).toEqual(["/ws/empty-opened", "/ws/from-session"]);
    const turns = store.listTurns("s1");
    expect(turns).toHaveLength(1);
    expect(turns[0]?.modelId).toBe("claude-sonnet-4");
    expect(turns[0]?.protocol).toBe("structured");
    expect(turns[0]?.reusedNative).toBe(false);
    expect(turns[0]?.status).toBe("completed");
    expect(turns[0]?.eventSummary).toBe("done");
    expect(turns[0]?.contextSource).toBe("transcript");
    store.close();

    const db = new Database(path);
    try {
      const orphans = db
        .query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('schema_meta', 'recent_workspaces')",
        )
        .get();
      expect(orphans?.count).toBe(0);
    } finally {
      db.close();
    }
  });
});
