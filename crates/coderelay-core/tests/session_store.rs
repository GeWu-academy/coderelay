use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use coderelay_core::AgentId;
use coderelay_core::session::{
    AppendTurnInput, ListSessionsOptions, SessionStore, TurnContextSource, TurnProtocol,
    TurnRunStatus, apply_column_migration, default_session_db_path,
};
use rusqlite::Connection;
use tempfile::TempDir;

fn temp_db() -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("sessions.db");
    (dir, path)
}

#[test]
fn creates_sessions_and_preserves_non_empty_turn_metadata() {
    let (_dir, path) = temp_db();
    let mut store = SessionStore::open(&path).expect("open store");
    let workspace = PathBuf::from("/tmp/session-workspace");
    let session = store
        .create_session(AgentId::Claude, "修一个测试", Some(&workspace))
        .expect("create session");

    let turn = store
        .append_turn(AppendTurnInput {
            session_id: session.id.clone(),
            cli_id: AgentId::Claude,
            prompt: "第一问".to_owned(),
            output: "答案一".to_owned(),
            exit_code: Some(0),
            signal: None,
            duration_ms: 1200,
            model_id: Some("sonnet".to_owned()),
            protocol: Some(TurnProtocol::Structured),
            reused_native: Some(true),
            status: Some(TurnRunStatus::Completed),
            event_summary: Some("answer summary".to_owned()),
            context_source: Some(TurnContextSource::Native),
        })
        .expect("append turn");

    assert_eq!(turn.model_id.as_deref(), Some("sonnet"));
    assert_eq!(turn.protocol, Some(TurnProtocol::Structured));
    assert_eq!(turn.reused_native, Some(true));
    assert_eq!(turn.status, Some(TurnRunStatus::Completed));
    assert_eq!(turn.event_summary.as_deref(), Some("answer summary"));
    assert_eq!(turn.context_source, Some(TurnContextSource::Native));
    drop(store);

    let store = SessionStore::open(&path).expect("reopen store");
    assert_eq!(
        store
            .get_session(&session.id)
            .expect("get session")
            .expect("session")
            .title,
        "修一个测试"
    );
    let turns = store.list_turns(&session.id).expect("list turns");
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].output, "答案一");
    assert_eq!(turns[0].model_id.as_deref(), Some("sonnet"));
}

#[test]
fn stores_jev_api_key_in_sqlite_without_accepting_blank_values() {
    let (_dir, path) = temp_db();
    let mut store = SessionStore::open(&path).expect("open store");

    assert_eq!(store.get_jev_api_key().expect("initial key"), None);
    let error = store
        .set_jev_api_key("   ")
        .expect_err("blank key must be rejected");
    assert!(error.to_string().contains("must not be empty"));

    store
        .set_jev_api_key("  sk-live-example-123  ")
        .expect("save key");
    assert_eq!(
        store.get_jev_api_key().expect("stored key").as_deref(),
        Some("sk-live-example-123")
    );
    drop(store);

    let mut store = SessionStore::open(&path).expect("reopen store");
    assert_eq!(
        store.get_jev_api_key().expect("persisted key").as_deref(),
        Some("sk-live-example-123")
    );
    store.clear_jev_api_key().expect("clear key");
    assert_eq!(store.get_jev_api_key().expect("cleared key"), None);
}

#[test]
fn foreign_keys_reject_orphan_turns() {
    let mut store = SessionStore::open_in_memory().expect("open store");
    let error = store
        .append_turn(AppendTurnInput::new(
            "missing-session",
            AgentId::Claude,
            "orphan turn",
            "must not persist",
            Some(1),
            12,
        ))
        .expect_err("orphan turn must fail");

    assert!(error.to_string().contains("FOREIGN KEY") || error.to_string().contains("constraint"));
    assert!(
        store
            .list_turns("missing-session")
            .expect("turns")
            .is_empty()
    );
}

#[test]
fn pruning_uses_latest_activity_and_removes_old_turns() {
    let mut store = SessionStore::open_in_memory().expect("open store");
    let mut sessions = Vec::new();
    for index in 0..5 {
        let session = store
            .create_session(AgentId::Codex, format!("会话 {index}"), None)
            .expect("create session");
        store
            .append_turn(AppendTurnInput::new(
                &session.id,
                AgentId::Codex,
                format!("第 {index} 问"),
                format!("第 {index} 答"),
                Some(0),
                100,
            ))
            .expect("append");
        sessions.push(session);
        thread::sleep(Duration::from_millis(3));
    }

    store
        .append_turn(AppendTurnInput::new(
            &sessions[1].id,
            AgentId::Codex,
            "继续旧会话",
            "最近活跃",
            Some(0),
            100,
        ))
        .expect("touch old session");

    let removed = store.prune_sessions(2).expect("prune");
    assert_eq!(removed, 3);
    assert!(store.get_session(&sessions[1].id).expect("get").is_some());
    assert!(store.get_session(&sessions[4].id).expect("get").is_some());
    assert!(store.get_session(&sessions[0].id).expect("get").is_none());
    assert!(store.list_turns(&sessions[0].id).expect("turns").is_empty());
}

#[test]
fn workspace_queries_recent_workspaces_and_preferences_round_trip() {
    let mut store = SessionStore::open_in_memory().expect("open store");
    let alpha = PathBuf::from("/project/alpha");
    let beta = PathBuf::from("/project/beta");
    let first = store
        .create_session(AgentId::Codex, "Alpha task", Some(&alpha))
        .expect("alpha");
    thread::sleep(Duration::from_millis(3));
    let second = store
        .create_session(AgentId::Claude, "Beta task", Some(&beta))
        .expect("beta");
    thread::sleep(Duration::from_millis(3));
    store
        .create_session(AgentId::Codex, "Newer alpha", Some(&alpha))
        .expect("alpha again");

    let alpha_sessions = store
        .list_sessions(&ListSessionsOptions {
            workspace: Some(alpha.to_string_lossy().into_owned()),
            limit: None,
        })
        .expect("alpha sessions");
    assert_eq!(alpha_sessions.len(), 2);
    assert!(!alpha_sessions.iter().any(|session| session.id == second.id));

    let all = store
        .list_sessions(&ListSessionsOptions::default())
        .expect("all sessions");
    assert_eq!(all.len(), 3);
    assert_eq!(
        store.get_recent_workspaces(10).expect("workspaces"),
        vec![
            alpha.to_string_lossy().into_owned(),
            beta.to_string_lossy().into_owned()
        ]
    );

    // Recording an opened workspace without sessions persists to SQLite and shows in recent workspaces
    let opened_gamma = "/project/gamma-opened";
    store.record_workspace(opened_gamma).expect("record workspace");
    assert_eq!(
        store.get_recent_workspaces(10).expect("workspaces with gamma"),
        vec![
            opened_gamma.to_owned(),
            alpha.to_string_lossy().into_owned(),
            beta.to_string_lossy().into_owned()
        ]
    );

    store
        .set_preference("theme", "paper")
        .expect("set preference");
    assert_eq!(
        store
            .get_preference("theme")
            .expect("get preference")
            .as_deref(),
        Some("paper")
    );
    store
        .set_favorite_agent(AgentId::Pi)
        .expect("favorite agent");
    assert_eq!(
        store.get_favorite_agent().expect("favorite"),
        Some(AgentId::Pi)
    );
    store.clear_favorite_agent().expect("clear favorite");
    assert!(store.get_favorite_agent().expect("favorite").is_none());
    assert_eq!(first.workspace, Some(alpha.to_string_lossy().into_owned()));
}

#[test]
fn legacy_database_is_migrated_without_losing_rows() {
    let (_dir, path) = temp_db();
    let connection = Connection::open(&path).expect("legacy db");
    connection
        .execute_batch(
            r#"
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cli_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  created_at INTEGER NOT NULL
);
CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO sessions VALUES ('legacy', 'codex', 'Legacy session', 1, 2);
INSERT INTO turns (session_id, cli_id, prompt, output, exit_code, signal, duration_ms, created_at)
VALUES ('legacy', 'codex', 'legacy prompt', 'legacy output', 0, NULL, 15, 3);
"#,
        )
        .expect("legacy schema");

    let store = SessionStore::open(&path).expect("migrate legacy db");
    assert_eq!(
        store.schema_version().expect("schema version").as_deref(),
        Some("1")
    );
    let session = store.get_session("legacy").expect("get").expect("session");
    assert_eq!(session.title, "Legacy session");
    assert!(session.workspace.is_none());
    let turns = store.list_turns("legacy").expect("turns");
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].prompt, "legacy prompt");
    assert!(turns[0].model_id.is_none());
    drop(store);

    let connection = Connection::open(&path).expect("inspect migrated db");
    assert!(
        !apply_column_migration(
            &connection,
            "sessions",
            "workspace",
            "ALTER TABLE sessions ADD COLUMN workspace TEXT",
        )
        .expect("idempotent migration")
    );
    assert!(
        !apply_column_migration(
            &connection,
            "turns",
            "model_id",
            "ALTER TABLE turns ADD COLUMN model_id TEXT",
        )
        .expect("idempotent migration")
    );
}

#[test]
fn invalid_migration_reports_the_column_and_sql() {
    let connection = Connection::open_in_memory().expect("sqlite");
    connection
        .execute_batch("CREATE TABLE sessions (id TEXT PRIMARY KEY);")
        .expect("table");
    let error = apply_column_migration(
        &connection,
        "sessions",
        "workspace",
        "ALTER TABLE sessions ADD COLUMN",
    )
    .expect_err("invalid migration must fail");
    assert!(error.to_string().contains("workspace"));
    assert!(
        error
            .to_string()
            .contains("ALTER TABLE sessions ADD COLUMN")
    );
}

#[test]
fn two_open_instances_can_share_the_same_database() {
    let (_dir, path) = temp_db();
    let mut first = SessionStore::open(&path).expect("first store");
    let mut second = SessionStore::open(&path).expect("second store");
    let session = first
        .create_session(AgentId::Codex, "shared", None)
        .expect("create session");
    second
        .append_turn(AppendTurnInput::new(
            &session.id,
            AgentId::Codex,
            "from second instance",
            "saved",
            Some(0),
            10,
        ))
        .expect("second write");
    assert_eq!(
        first.list_turns(&session.id).expect("first read")[0].output,
        "saved"
    );
}

#[test]
fn default_session_path_follows_global_config_dir() {
    assert_eq!(
        default_session_db_path(Some(PathBuf::from("/tmp/coderelay-home").as_path()), None),
        Some(PathBuf::from("/tmp/coderelay-home/.coderelay/sessions.db"))
    );
}

#[test]
fn deletes_single_sessions_and_whole_workspace_groups() {
    let (_dir, path) = temp_db();
    let mut store = SessionStore::open(&path).expect("open store");
    let alpha = PathBuf::from("/project/alpha");
    let beta = PathBuf::from("/project/beta");
    let a1 = store
        .create_session(AgentId::Codex, "alpha one", Some(&alpha))
        .expect("a1");
    let a2 = store
        .create_session(AgentId::Claude, "alpha two", Some(&alpha))
        .expect("a2");
    let b1 = store
        .create_session(AgentId::Codex, "beta one", Some(&beta))
        .expect("b1");
    let loose1 = store
        .create_session(AgentId::Codex, "loose one", None)
        .expect("loose1");
    let loose2 = store
        .create_session(AgentId::Claude, "loose two", None)
        .expect("loose2");
    // create_session defaults to the cwd, so legacy folder-less rows are made directly.
    Connection::open(&path)
        .expect("raw connection")
        .execute(
            "UPDATE sessions SET workspace = NULL WHERE id IN (?1, ?2)",
            [&loose1.id, &loose2.id],
        )
        .expect("clear workspace");
    for session in [&a1, &a2, &b1, &loose1, &loose2] {
        store
            .append_turn(AppendTurnInput::new(
                &session.id,
                AgentId::Codex,
                format!("prompt {}", session.title),
                "answer",
                Some(0),
                30,
            ))
            .expect("turn");
    }

    assert!(store.delete_session(&a1.id).expect("delete one"));
    assert!(!store.delete_session(&a1.id).expect("delete again"));
    assert!(store.get_session(&a1.id).expect("get").is_none());
    assert!(store.list_turns(&a1.id).expect("turns").is_empty());
    assert!(store.get_session(&a2.id).expect("get").is_some());

    let removed = store
        .delete_workspace_sessions(Some(&alpha.to_string_lossy()))
        .expect("delete alpha");
    assert_eq!(removed, 1);
    assert!(store.list_turns(&a2.id).expect("turns").is_empty());
    assert!(store.get_session(&b1.id).expect("get").is_some());
    assert_eq!(store.list_turns(&b1.id).expect("turns").len(), 1);

    let removed = store.delete_workspace_sessions(None).expect("delete loose");
    assert_eq!(removed, 2);
    assert!(store.get_session(&loose1.id).expect("get").is_none());
    assert!(store.get_session(&loose2.id).expect("get").is_none());
    assert_eq!(
        store
            .list_sessions(&ListSessionsOptions::default())
            .expect("all")
            .len(),
        1
    );
}
