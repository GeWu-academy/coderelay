import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";

import { Database } from "bun:sqlite";

import {
  crossPlatformDirname,
  crossPlatformJoin,
  globalConfigDir,
} from "../config/loader";
import { CLI_IDS, type CliId } from "../models/cli";
import type {
  SessionRecord,
  SessionTurn,
  TurnContextSource,
  TurnRunStatus,
} from "../models/session";

export interface AppendTurnInput {
  readonly sessionId: string;
  readonly cliId: CliId;
  readonly prompt: string;
  readonly output: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly modelId?: string;
  readonly protocol?: "structured" | "text";
  readonly reusedNative?: boolean;
  readonly status?: TurnRunStatus;
  readonly eventSummary?: string;
  readonly contextSource?: TurnContextSource;
}

export interface SessionStore {
  createSession(cliId: CliId, title: string, workspace?: string): SessionRecord;
  getSession(id: string): SessionRecord | null;
  listSessions(options?: { workspace?: string; limit?: number }): readonly SessionRecord[];
  listTurns(sessionId: string): readonly SessionTurn[];
  appendTurn(input: AppendTurnInput): SessionTurn;
  pruneSessions(keep: number): number;
  getPreference(key: string): string | null;
  setPreference(key: string, value: string): void;
  deletePreference(key: string): void;
  getFavoriteAgent(): CliId | null;
  setFavoriteAgent(cliId: CliId): void;
  clearFavoriteAgent(): void;
  recordWorkspace(workspace: string): void;
  getRecentWorkspaces(limit?: number): readonly string[];
  close(): void;
}

interface SessionRow {
  readonly id: string;
  readonly cli_id: string;
  readonly title: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly workspace?: string | null;
}

interface TurnRow {
  readonly id: number;
  readonly session_id: string;
  readonly cli_id: string;
  readonly prompt: string;
  readonly output: string;
  readonly exit_code: number | null;
  readonly signal: string | null;
  readonly duration_ms: number;
  readonly created_at: number;
  readonly model_id?: string | null;
  readonly protocol?: string | null;
  readonly reused_native?: number | null;
  readonly status?: string | null;
  readonly event_summary?: string | null;
  readonly context_source?: string | null;
}

export const SCHEMA_VERSION = 2;

const SESSION_COLUMNS =
  "id, cli_id, title, created_at, updated_at, workspace";
const TURN_COLUMNS =
  "id, session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at, model_id, protocol, reused_native, status, event_summary, context_source";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  path TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at DESC);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cli_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  workspace TEXT REFERENCES workspaces(path) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
  ON sessions(workspace, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_updated
  ON sessions(updated_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, id);
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

export const SESSION_RETENTION = 20;

/** Session database lives in the global .coderelay directory so history is shared across workspaces. */
export function defaultSessionDbPath(
  homeDir?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  return crossPlatformJoin(globalConfigDir(homeDir, env, platform), "sessions.db");
}

function rowToSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    cliId: row.cli_id as CliId,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    workspace: row.workspace ?? undefined,
  };
}

function asTurnStatus(value: string | null | undefined): TurnRunStatus | undefined {
  return value === "completed" ||
    value === "failed" ||
    value === "timeout" ||
    value === "aborted" ||
    value === "spawn-error"
    ? value
    : undefined;
}

function asContextSource(value: string | null | undefined): TurnContextSource | undefined {
  return value === "native" || value === "transcript" || value === "none"
    ? value
    : undefined;
}

function rowToTurn(row: TurnRow): SessionTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    cliId: row.cli_id as CliId,
    prompt: row.prompt,
    output: row.output,
    exitCode: row.exit_code,
    signal: row.signal,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    modelId: row.model_id ?? undefined,
    protocol: row.protocol === "structured" || row.protocol === "text" ? row.protocol : undefined,
    reusedNative: row.reused_native === null || row.reused_native === undefined
      ? undefined
      : row.reused_native === 1,
    status: asTurnStatus(row.status),
    eventSummary: row.event_summary ?? undefined,
    contextSource: asContextSource(row.context_source),
  };
}

const SESSION_MIGRATIONS: readonly string[] = [
  "ALTER TABLE sessions ADD COLUMN workspace TEXT",
];

const TURN_MIGRATIONS: readonly string[] = [
  "ALTER TABLE turns ADD COLUMN model_id TEXT",
  "ALTER TABLE turns ADD COLUMN protocol TEXT",
  "ALTER TABLE turns ADD COLUMN reused_native INTEGER",
  "ALTER TABLE turns ADD COLUMN status TEXT",
  "ALTER TABLE turns ADD COLUMN event_summary TEXT",
  "ALTER TABLE turns ADD COLUMN context_source TEXT",
];

function extractColumnName(sql: string): string | undefined {
  return sql.match(/ADD\s+COLUMN\s+["`\[]?([a-zA-Z0-9_]+)["`\]]?/i)?.[1];
}

export function isDuplicateColumnError(err: unknown, column?: string): boolean {
  if (!(err instanceof Error) && typeof err !== "string") {
    return false;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (!/duplicate column name/i.test(message)) {
    return false;
  }
  if (!column) {
    return true;
  }
  return new RegExp(`duplicate column name:\\s*["'\`\\[]?${column}\\b`, "i").test(message);
}

export function applyColumnMigration(
  db: { exec: (sql: string) => void },
  sql: string,
): void {
  const column = extractColumnName(sql);
  try {
    db.exec(sql);
  } catch (err) {
    if (isDuplicateColumnError(err, column)) {
      return;
    }
    const details = column ? `column "${column}"` : "column";
    const message = err instanceof Error ? err.message : String(err);
    // ponytail: regex column check covers SQLite standard duplicate column error; upgrade if engine-specific error codes needed.
    throw new Error(`Migration failed for ${details} (${sql}): ${message}`, {
      cause: err,
    });
  }
}

function migrateSessionColumns(db: { exec: (sql: string) => void }): void {
  for (const sql of SESSION_MIGRATIONS) {
    applyColumnMigration(db, sql);
  }
}

function migrateTurnColumns(db: { exec: (sql: string) => void }): void {
  for (const sql of TURN_MIGRATIONS) {
    applyColumnMigration(db, sql);
  }
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query<{ found: number }, [string]>(
      "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .get(table);
  return row !== null;
}

function getUserVersion(db: Database): number {
  const row = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  return row?.user_version ?? 0;
}

function migrateLegacyToV2(db: Database): void {
  migrateSessionColumns(db);
  migrateTurnColumns(db);

  const hasRecentWorkspaces = tableExists(db, "recent_workspaces");
  db.exec("PRAGMA foreign_keys = OFF;");
  try {
    const migrateTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          path TEXT PRIMARY KEY,
          updated_at INTEGER NOT NULL
        );
      `);

      if (hasRecentWorkspaces) {
        db.exec(`
          INSERT INTO workspaces (path, updated_at)
          SELECT TRIM(workspace), MAX(updated_at)
          FROM recent_workspaces
          WHERE workspace IS NOT NULL AND TRIM(workspace) != ''
          GROUP BY TRIM(workspace)
          ON CONFLICT(path) DO UPDATE SET
            updated_at = MAX(workspaces.updated_at, excluded.updated_at);
        `);
      }

      db.exec(`
        INSERT INTO workspaces (path, updated_at)
        SELECT TRIM(workspace), MAX(updated_at)
        FROM sessions
        WHERE workspace IS NOT NULL AND TRIM(workspace) != ''
        GROUP BY TRIM(workspace)
        ON CONFLICT(path) DO UPDATE SET
          updated_at = MAX(workspaces.updated_at, excluded.updated_at);

        CREATE TABLE sessions_v2 (
          id TEXT PRIMARY KEY,
          cli_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          workspace TEXT REFERENCES workspaces(path) ON DELETE CASCADE
        );
        INSERT INTO sessions_v2 (id, cli_id, title, created_at, updated_at, workspace)
        SELECT
          id,
          cli_id,
          title,
          created_at,
          updated_at,
          CASE
            WHEN workspace IS NULL OR TRIM(workspace) = '' THEN NULL
            ELSE TRIM(workspace)
          END
        FROM sessions;

        CREATE TABLE turns_v2 (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
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
        INSERT INTO turns_v2 (
          id, session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at,
          model_id, protocol, reused_native, status, event_summary, context_source
        )
        SELECT
          id, session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at,
          model_id, protocol, reused_native, status, event_summary, context_source
        FROM turns
        WHERE session_id IN (SELECT id FROM sessions_v2);

        DROP TABLE turns;
        DROP TABLE sessions;
        ALTER TABLE sessions_v2 RENAME TO sessions;
        ALTER TABLE turns_v2 RENAME TO turns;
        DROP TABLE IF EXISTS recent_workspaces;
        DROP TABLE IF EXISTS schema_meta;

        CREATE TABLE IF NOT EXISTS preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_workspace_updated
          ON sessions(workspace, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_updated
          ON sessions(updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, id);
        PRAGMA user_version = ${SCHEMA_VERSION};
      `);
    });
    migrateTx();
  } finally {
    db.exec("PRAGMA foreign_keys = ON;");
  }
}

function initializeSchema(db: Database): void {
  const version = getUserVersion(db);
  if (version >= SCHEMA_VERSION) {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    return;
  }

  if (tableExists(db, "sessions")) {
    migrateLegacyToV2(db);
  } else {
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(SCHEMA);
    db.exec("DROP TABLE IF EXISTS recent_workspaces; DROP TABLE IF EXISTS schema_meta;");
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  }
}

export function createSessionStore(dbPath: string): SessionStore {
  mkdirSync(crossPlatformDirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  initializeSchema(db);

  const insertSession = db.query<
    unknown,
    [string, string, string, number, number, string | null]
  >(
    `INSERT INTO sessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const selectSession = db.query<SessionRow, [string]>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ?`,
  );
  const selectSessionsByWorkspace = db.query<SessionRow, [string, number]>(
    `SELECT ${SESSION_COLUMNS} FROM sessions WHERE workspace = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
  );
  const selectAllSessions = db.query<SessionRow, [number]>(
    `SELECT ${SESSION_COLUMNS} FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ?`,
  );
  const selectRecentWorkspaces = db.query<{ path: string }, [number]>(
    `SELECT path FROM workspaces
     ORDER BY updated_at DESC, path ASC
     LIMIT ?`,
  );
  const upsertWorkspace = db.query<unknown, [string, number]>(
    `INSERT INTO workspaces (path, updated_at) VALUES (?, ?)
     ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at`,
  );
  const touchSession = db.query<unknown, [number, string]>(
    "UPDATE sessions SET updated_at = ? WHERE id = ?",
  );
  const touchWorkspaceForSession = db.query<unknown, [number, string]>(
    `UPDATE workspaces SET updated_at = ?
     WHERE path = (SELECT workspace FROM sessions WHERE id = ?)`,
  );
  const insertTurn = db.query<
    unknown,
    [
      string,
      string,
      string,
      string,
      number | null,
      string | null,
      number,
      number,
      string | null,
      string | null,
      number | null,
      string | null,
      string | null,
      string | null,
    ]
  >(
    "INSERT INTO turns (session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at, model_id, protocol, reused_native, status, event_summary, context_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const selectTurn = db.query<TurnRow, [number]>(
    `SELECT ${TURN_COLUMNS} FROM turns WHERE id = ?`,
  );
  const selectTurns = db.query<TurnRow, [string]>(
    `SELECT ${TURN_COLUMNS} FROM turns WHERE session_id = ? ORDER BY id ASC`,
  );
  const deleteOldSessions = db.query<unknown, [number]>(
    `DELETE FROM sessions
     WHERE id IN (
       SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET ?
     )`,
  );
  const createSessionTx = db.transaction(
    (
      id: string,
      cliId: CliId,
      title: string,
      now: number,
      workspace: string | null,
    ): SessionRow | null => {
      if (workspace) {
        upsertWorkspace.run(workspace, now);
      }
      insertSession.run(id, cliId, title, now, now, workspace);
      return selectSession.get(id);
    },
  );
  const appendTurnTx = db.transaction(
    (input: AppendTurnInput, now: number): TurnRow | null => {
      const result = insertTurn.run(
        input.sessionId,
        input.cliId,
        input.prompt,
        input.output,
        input.exitCode,
        input.signal,
        input.durationMs,
        now,
        input.modelId ?? null,
        input.protocol ?? null,
        input.reusedNative === undefined ? null : input.reusedNative ? 1 : 0,
        input.status ?? null,
        input.eventSummary ?? null,
        input.contextSource ?? null,
      );
      touchSession.run(now, input.sessionId);
      touchWorkspaceForSession.run(now, input.sessionId);
      return selectTurn.get(Number(result.lastInsertRowid));
    },
  );

  const selectPreference = db.query<{ value: string }, [string]>(
    "SELECT value FROM preferences WHERE key = ?",
  );
  const upsertPreference = db.query<unknown, [string, string, number]>(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const deletePreference = db.query<unknown, [string]>(
    "DELETE FROM preferences WHERE key = ?",
  );

  return {
    createSession(cliId, title, workspace = process.cwd()) {
      const now = Date.now();
      const id = randomUUID();
      const normalizedWorkspace = workspace?.trim() ? workspace.trim() : null;
      const row = createSessionTx(id, cliId, title, now, normalizedWorkspace);
      if (!row) {
        throw new Error(`session insert failed: ${id}`);
      }
      return rowToSession(row);
    },

    getSession(id) {
      const row = selectSession.get(id);
      return row ? rowToSession(row) : null;
    },

    listSessions(options) {
      const limit = options?.limit ?? 50;
      if (options?.workspace) {
        return selectSessionsByWorkspace.all(options.workspace, limit).map(rowToSession);
      }
      return selectAllSessions.all(limit).map(rowToSession);
    },

    listTurns(sessionId) {
      return selectTurns.all(sessionId).map(rowToTurn);
    },

    appendTurn(input) {
      const now = Date.now();
      const row = appendTurnTx(input, now);
      if (!row) {
        throw new Error(`turn insert failed in session ${input.sessionId}`);
      }
      return rowToTurn(row);
    },

    pruneSessions(keep) {
      const removed = deleteOldSessions.run(Math.max(0, Math.floor(keep))).changes;
      if (removed > 0) {
        // VACUUM 会重写数据库文件，让删除后的空间真正归还磁盘。
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        db.exec("VACUUM;");
      }
      return removed;
    },

    getPreference(key) {
      const row = selectPreference.get(key);
      return row ? row.value : null;
    },

    setPreference(key, value) {
      upsertPreference.run(key, value, Date.now());
    },

    deletePreference(key) {
      deletePreference.run(key);
    },

    getFavoriteAgent() {
      const val = this.getPreference("favorite_agent");
      if (val && (CLI_IDS as readonly string[]).includes(val)) {
        return val as CliId;
      }
      return null;
    },

    setFavoriteAgent(cliId) {
      this.setPreference("favorite_agent", cliId);
    },

    clearFavoriteAgent() {
      this.deletePreference("favorite_agent");
    },

    recordWorkspace(workspace: string) {
      const trimmed = workspace.trim();
      if (!trimmed) {
        return;
      }
      upsertWorkspace.run(trimmed, Date.now());
    },

    getRecentWorkspaces(limit = 10) {
      return selectRecentWorkspaces.all(limit).map((r: { path: string }) => r.path);
    },

    close() {
      db.close();
    },
  };
}
