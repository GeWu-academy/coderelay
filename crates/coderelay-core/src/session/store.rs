use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use crate::agent::AgentId;
use crate::config::global_config_dir;
use crate::router::jev::TYPESAFE_API_KEY_PREFERENCE;
use crate::session::types::{
    AppendTurnInput, ListSessionsOptions, SessionRecord, SessionTurn, TurnContextSource,
    TurnProtocol, TurnRunStatus,
};

pub const SESSION_RETENTION: usize = 20;
const SESSION_COLUMNS: &str = "id, cli_id, title, created_at, updated_at, workspace";
const TURN_COLUMNS: &str = "id, session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at, model_id, protocol, reused_native, status, event_summary, context_source";

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cli_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  workspace TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  cli_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  signal TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, id);
CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recent_workspaces (
  workspace TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"#;

const SESSION_MIGRATIONS: [(&str, &str); 1] = [(
    "workspace",
    "ALTER TABLE sessions ADD COLUMN workspace TEXT",
)];
const TURN_MIGRATIONS: [(&str, &str); 6] = [
    ("model_id", "ALTER TABLE turns ADD COLUMN model_id TEXT"),
    ("protocol", "ALTER TABLE turns ADD COLUMN protocol TEXT"),
    (
        "reused_native",
        "ALTER TABLE turns ADD COLUMN reused_native INTEGER",
    ),
    ("status", "ALTER TABLE turns ADD COLUMN status TEXT"),
    (
        "event_summary",
        "ALTER TABLE turns ADD COLUMN event_summary TEXT",
    ),
    (
        "context_source",
        "ALTER TABLE turns ADD COLUMN context_source TEXT",
    ),
];

#[derive(Debug, thiserror::Error)]
pub enum SessionStoreError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("migration failed for column \"{column}\" ({sql}): {message}")]
    Migration {
        column: String,
        sql: String,
        message: String,
    },
    #[error("invalid {field} value in session database: {value}")]
    InvalidStoredValue { field: String, value: String },
    #[error("session insert failed: {0}")]
    SessionInsert(String),
    #[error("turn insert failed in session {0}")]
    TurnInsert(String),
    #[error("preference \"{key}\" must not be empty")]
    EmptyPreference { key: String },
}

pub fn default_session_db_path(
    home_dir: Option<&Path>,
    coderelay_home: Option<&Path>,
) -> Option<PathBuf> {
    global_config_dir(home_dir, coderelay_home).map(|dir| dir.join("sessions.db"))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn table_columns(connection: &Connection, table: &str) -> Result<Vec<String>, SessionStoreError> {
    let sql = format!("PRAGMA table_info({table})");
    let mut statement = connection.prepare(&sql)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

/// Add a column only when the table does not already expose it.
pub fn apply_column_migration(
    connection: &Connection,
    table: &str,
    column: &str,
    sql: &str,
) -> Result<bool, SessionStoreError> {
    if table_columns(connection, table)?
        .iter()
        .any(|existing| existing.eq_ignore_ascii_case(column))
    {
        return Ok(false);
    }

    connection
        .execute_batch(sql)
        .map_err(|error| SessionStoreError::Migration {
            column: column.to_owned(),
            sql: sql.to_owned(),
            message: error.to_string(),
        })?;
    Ok(true)
}

fn run_migrations(connection: &Connection) -> Result<(), SessionStoreError> {
    for (column, sql) in SESSION_MIGRATIONS {
        apply_column_migration(connection, "sessions", column, sql)?;
    }
    for (column, sql) in TURN_MIGRATIONS {
        apply_column_migration(connection, "turns", column, sql)?;
    }

    connection.execute(
        "INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )?;
    Ok(())
}

fn stored_agent(row: usize, value: String) -> rusqlite::Result<AgentId> {
    value
        .parse()
        .map_err(|error: crate::agent::InvalidAgentId| {
            rusqlite::Error::FromSqlConversionFailure(
                row,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn turn_status(value: Option<String>) -> Option<TurnRunStatus> {
    match value.as_deref() {
        Some("completed") => Some(TurnRunStatus::Completed),
        Some("failed") => Some(TurnRunStatus::Failed),
        Some("timeout") => Some(TurnRunStatus::Timeout),
        Some("aborted") => Some(TurnRunStatus::Aborted),
        Some("spawn-error") => Some(TurnRunStatus::SpawnError),
        _ => None,
    }
}

fn context_source(value: Option<String>) -> Option<TurnContextSource> {
    match value.as_deref() {
        Some("native") => Some(TurnContextSource::Native),
        Some("transcript") => Some(TurnContextSource::Transcript),
        Some("none") => Some(TurnContextSource::None),
        _ => None,
    }
}

fn protocol(value: Option<String>) -> Option<TurnProtocol> {
    match value.as_deref() {
        Some("structured") => Some(TurnProtocol::Structured),
        Some("text") => Some(TurnProtocol::Text),
        _ => None,
    }
}

fn row_to_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRecord> {
    Ok(SessionRecord {
        id: row.get(0)?,
        cli_id: stored_agent(1, row.get(1)?)?,
        title: row.get(2)?,
        created_at: row.get::<_, i64>(3)? as u64,
        updated_at: row.get::<_, i64>(4)? as u64,
        workspace: row.get(5)?,
    })
}

fn row_to_turn(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionTurn> {
    let reused_native = row.get::<_, Option<i64>>(11)?.map(|value| value == 1);
    Ok(SessionTurn {
        id: row.get(0)?,
        session_id: row.get(1)?,
        cli_id: stored_agent(2, row.get(2)?)?,
        prompt: row.get(3)?,
        output: row.get(4)?,
        exit_code: row.get(5)?,
        signal: row.get(6)?,
        duration_ms: row.get::<_, i64>(7)? as u64,
        created_at: row.get::<_, i64>(8)? as u64,
        model_id: row.get(9)?,
        protocol: protocol(row.get(10)?),
        reused_native,
        status: turn_status(row.get(12)?),
        event_summary: row.get(13)?,
        context_source: context_source(row.get(14)?),
    })
}

pub struct SessionStore {
    connection: Connection,
}

impl SessionStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SessionStoreError> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent)?;
        }
        Self::from_connection(Connection::open(path)?)
    }

    pub fn open_in_memory() -> Result<Self, SessionStoreError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> Result<Self, SessionStoreError> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
        )?;
        connection.execute_batch(SCHEMA)?;
        run_migrations(&connection)?;
        Ok(Self { connection })
    }

    pub fn create_session(
        &mut self,
        cli_id: AgentId,
        title: impl Into<String>,
        workspace: Option<&Path>,
    ) -> Result<SessionRecord, SessionStoreError> {
        let now = now_ms();
        let id = Uuid::new_v4().to_string();
        let workspace = workspace
            .map(|path| path.to_string_lossy().into_owned())
            .or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
            });
        self.connection.execute(
            "INSERT INTO sessions (id, cli_id, title, created_at, updated_at, workspace)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            params![&id, cli_id.as_str(), title.into(), now as i64, &workspace],
        )?;
        if let Some(ref ws) = workspace {
            let _ = self.record_workspace(ws);
        }
        self.get_session(&id)?
            .ok_or(SessionStoreError::SessionInsert(id))
    }

    pub fn get_session(&self, id: &str) -> Result<Option<SessionRecord>, SessionStoreError> {
        let sql = format!("SELECT {SESSION_COLUMNS} FROM sessions WHERE id = ?1");
        Ok(self
            .connection
            .query_row(&sql, [id], row_to_session)
            .optional()?)
    }

    pub fn list_sessions(
        &self,
        options: &ListSessionsOptions,
    ) -> Result<Vec<SessionRecord>, SessionStoreError> {
        let limit = options.limit.unwrap_or(50);
        let mut sessions = Vec::new();
        if let Some(workspace) = &options.workspace {
            let sql = format!(
                "SELECT {SESSION_COLUMNS} FROM sessions WHERE workspace = ?1
                 ORDER BY updated_at DESC, id DESC LIMIT ?2"
            );
            let mut statement = self.connection.prepare(&sql)?;
            let rows = statement.query_map(params![workspace, limit], row_to_session)?;
            for row in rows {
                sessions.push(row?);
            }
        } else {
            let sql = format!(
                "SELECT {SESSION_COLUMNS} FROM sessions ORDER BY updated_at DESC, id DESC LIMIT ?1"
            );
            let mut statement = self.connection.prepare(&sql)?;
            let rows = statement.query_map([limit], row_to_session)?;
            for row in rows {
                sessions.push(row?);
            }
        }
        Ok(sessions)
    }

    pub fn list_turns(&self, session_id: &str) -> Result<Vec<SessionTurn>, SessionStoreError> {
        let sql = format!("SELECT {TURN_COLUMNS} FROM turns WHERE session_id = ?1 ORDER BY id ASC");
        let mut statement = self.connection.prepare(&sql)?;
        let rows = statement.query_map([session_id], row_to_turn)?;
        let mut turns = Vec::new();
        for row in rows {
            turns.push(row?);
        }
        Ok(turns)
    }

    pub fn append_turn(
        &mut self,
        input: AppendTurnInput,
    ) -> Result<SessionTurn, SessionStoreError> {
        let transaction = self.connection.transaction()?;
        let now = now_ms();
        transaction.execute(
            "INSERT INTO turns (
                session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at,
                model_id, protocol, reused_native, status, event_summary, context_source
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                input.session_id,
                input.cli_id.as_str(),
                input.prompt,
                input.output,
                input.exit_code,
                input.signal,
                input.duration_ms as i64,
                now as i64,
                input.model_id,
                input.protocol.map(|value| match value {
                    TurnProtocol::Structured => "structured",
                    TurnProtocol::Text => "text",
                }),
                input.reused_native.map(|value| if value { 1 } else { 0 }),
                input.status.map(|value| match value {
                    TurnRunStatus::Completed => "completed",
                    TurnRunStatus::Failed => "failed",
                    TurnRunStatus::Timeout => "timeout",
                    TurnRunStatus::Aborted => "aborted",
                    TurnRunStatus::SpawnError => "spawn-error",
                }),
                input.event_summary,
                input.context_source.map(|value| match value {
                    TurnContextSource::Native => "native",
                    TurnContextSource::Transcript => "transcript",
                    TurnContextSource::None => "none",
                }),
            ],
        )?;
        let id = transaction.last_insert_rowid();
        transaction.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now as i64, input.session_id],
        )?;
        let sql = format!("SELECT {TURN_COLUMNS} FROM turns WHERE id = ?1");
        let turn = transaction
            .query_row(&sql, [id], row_to_turn)
            .optional()?
            .ok_or_else(|| SessionStoreError::TurnInsert(input.session_id.clone()))?;
        transaction.commit()?;
        Ok(turn)
    }

    pub fn prune_sessions(&mut self, keep: usize) -> Result<usize, SessionStoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "DELETE FROM turns WHERE session_id IN (
                SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET ?1
             )",
            [keep as i64],
        )?;
        let removed = transaction.execute(
            "DELETE FROM sessions WHERE id IN (
                SELECT id FROM sessions ORDER BY updated_at DESC, id DESC LIMIT -1 OFFSET ?1
             )",
            [keep as i64],
        )?;
        transaction.commit()?;

        if removed > 0 {
            self.connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        }
        Ok(removed)
    }

    /// Deletes one session together with its turns. Returns whether it existed.
    pub fn delete_session(&mut self, id: &str) -> Result<bool, SessionStoreError> {
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM turns WHERE session_id = ?1", [id])?;
        let removed = transaction.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(removed > 0)
    }

    /// Deletes every session (and turns) of a workspace; `None` targets sessions
    /// that belong to no workspace. Returns the number of removed sessions.
    pub fn delete_workspace_sessions(
        &mut self,
        workspace: Option<&str>,
    ) -> Result<usize, SessionStoreError> {
        let transaction = self.connection.transaction()?;
        let removed = match workspace {
            Some(workspace) => {
                transaction.execute(
                    "DELETE FROM turns WHERE session_id IN (SELECT id FROM sessions WHERE workspace = ?1)",
                    [workspace],
                )?;
                transaction.execute("DELETE FROM sessions WHERE workspace = ?1", [workspace])?
            }
            None => {
                transaction.execute(
                    "DELETE FROM turns WHERE session_id IN (
                        SELECT id FROM sessions WHERE workspace IS NULL OR workspace = ''
                     )",
                    [],
                )?;
                transaction.execute(
                    "DELETE FROM sessions WHERE workspace IS NULL OR workspace = ''",
                    [],
                )?
            }
        };
        transaction.commit()?;
        Ok(removed)
    }

    pub fn schema_version(&self) -> Result<Option<String>, SessionStoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM schema_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn get_preference(&self, key: &str) -> Result<Option<String>, SessionStoreError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM preferences WHERE key = ?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_preference(&mut self, key: &str, value: &str) -> Result<(), SessionStoreError> {
        self.connection.execute(
            "INSERT INTO preferences (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now_ms() as i64],
        )?;
        Ok(())
    }

    pub fn delete_preference(&mut self, key: &str) -> Result<(), SessionStoreError> {
        self.connection
            .execute("DELETE FROM preferences WHERE key = ?1", [key])?;
        Ok(())
    }

    pub fn get_favorite_agent(&self) -> Result<Option<AgentId>, SessionStoreError> {
        Ok(self
            .get_preference("favorite_agent")?
            .and_then(|value| value.parse().ok()))
    }

    pub fn set_favorite_agent(&mut self, cli_id: AgentId) -> Result<(), SessionStoreError> {
        self.set_preference("favorite_agent", cli_id.as_str())
    }

    pub fn clear_favorite_agent(&mut self) -> Result<(), SessionStoreError> {
        self.delete_preference("favorite_agent")
    }

    /// Reads the TypeSafe API key stored by a host UI.
    pub fn get_jev_api_key(&self) -> Result<Option<String>, SessionStoreError> {
        Ok(self
            .get_preference(TYPESAFE_API_KEY_PREFERENCE)?
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty()))
    }

    /// Stores the TypeSafe API key in the shared local SQLite database.
    pub fn set_jev_api_key(&mut self, api_key: &str) -> Result<(), SessionStoreError> {
        let api_key = api_key.trim();
        if api_key.is_empty() {
            return Err(SessionStoreError::EmptyPreference {
                key: TYPESAFE_API_KEY_PREFERENCE.to_owned(),
            });
        }
        self.set_preference(TYPESAFE_API_KEY_PREFERENCE, api_key)
    }

    pub fn clear_jev_api_key(&mut self) -> Result<(), SessionStoreError> {
        self.delete_preference(TYPESAFE_API_KEY_PREFERENCE)
    }

    pub fn record_workspace(&mut self, workspace: &str) -> Result<(), SessionStoreError> {
        let workspace = workspace.trim();
        if workspace.is_empty() {
            return Ok(());
        }
        let now = now_ms();
        self.connection.execute(
            "INSERT INTO recent_workspaces (workspace, updated_at)
             VALUES (?1, ?2)
             ON CONFLICT(workspace) DO UPDATE SET updated_at = excluded.updated_at",
            params![workspace, now as i64],
        )?;
        Ok(())
    }

    pub fn remove_recent_workspace(&mut self, workspace: &str) -> Result<bool, SessionStoreError> {
        let count = self.connection.execute(
            "DELETE FROM recent_workspaces WHERE workspace = ?1",
            [workspace],
        )?;
        Ok(count > 0)
    }

    pub fn get_recent_workspaces(&self, limit: u32) -> Result<Vec<String>, SessionStoreError> {
        let mut statement = self.connection.prepare(
            "SELECT workspace FROM (
                 SELECT workspace, updated_at FROM recent_workspaces
                 WHERE workspace IS NOT NULL AND workspace != ''
                 UNION ALL
                 SELECT workspace, MAX(updated_at) AS updated_at FROM sessions
                 WHERE workspace IS NOT NULL AND workspace != ''
                 GROUP BY workspace
             )
             GROUP BY workspace
             ORDER BY MAX(updated_at) DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map([limit], |row| row.get(0))?;
        let mut workspaces = Vec::new();
        for row in rows {
            workspaces.push(row?);
        }
        Ok(workspaces)
    }
}
