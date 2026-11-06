use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use coderelay_cli::commands::{AgentListEntry, build_agent_entries};
use coderelay_cli::context::{CliContext, RunSelection, load_context};
use coderelay_cli::jev::JevHttpClient;
use coderelay_core::config::{
    LoadConfigOptions, load_config, project_config_path, render_default_config_yaml,
    save_config_source as write_config_source,
};
use coderelay_core::router::jev::{self, TYPESAFE_ENV_KEY};
use coderelay_core::{
    AgentAbortHandle, AgentEvent, AgentRunOptions, AgentRunResult, AgentRunStatus, AppendTurnInput,
    CORE_VERSION, ListSessionsOptions, ModelCatalog, ROUTING_MODES, RouteRequest, RoutingMode,
    SessionRecord, SessionStore, SessionTurn, TurnContextSource, TurnProtocol, TurnRunStatus,
    build_prompt_with_context, default_session_db_path, start_agent_run,
};
use coderelay_protocol::PROTOCOL_VERSION;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const RUN_EVENT: &str = "run-event";
const RUN_COMPLETED: &str = "run-completed";
const SESSION_UPDATED: &str = "session-updated";

#[derive(Default)]
struct DesktopState {
    runs: Mutex<HashMap<String, AgentAbortHandle>>,
    sessions: Mutex<Option<SessionStore>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    core_version: &'static str,
    protocol_version: u32,
    transport: &'static str,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct WorkspaceRequest {
    cwd: Option<String>,
    config_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveryPayload {
    cwd: String,
    config_path: Option<String>,
    default_agent: coderelay_core::AgentId,
    routing_modes: Vec<RoutingMode>,
    agents: Vec<AgentListEntry>,
    catalog: ModelCatalog,
    permissions: Vec<AgentPermissions>,
    recent_workspaces: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentPermissions {
    cli_id: coderelay_core::AgentId,
    options: &'static [coderelay_core::PermissionOption],
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SelectionRequest {
    #[serde(default)]
    workspace: WorkspaceRequest,
    request: RouteRequest,
    mode: Option<RoutingMode>,
    agent: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RoutePreview {
    agent: coderelay_core::AgentId,
    model: Option<String>,
    reasons: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRunRequest {
    #[serde(default)]
    workspace: WorkspaceRequest,
    request: RouteRequest,
    mode: Option<RoutingMode>,
    agent: Option<String>,
    model: Option<String>,
    permission: Option<String>,
    timeout_ms: Option<u64>,
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartRunResponse {
    run_id: String,
    session_id: String,
    agent: coderelay_core::AgentId,
    model: Option<String>,
    reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunEventPayload {
    run_id: String,
    session_id: String,
    event: AgentEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunCompletedPayload {
    run_id: String,
    session_id: String,
    result: AgentRunResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionUpdatedPayload {
    session_id: String,
    turn_id: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SessionListRequest {
    workspace: Option<String>,
    limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionDetail {
    session: SessionRecord,
    turns: Vec<SessionTurn>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigSourcePayload {
    path: String,
    exists: bool,
    raw: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct JevSettingsPayload {
    stored: bool,
    environment_configured: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConfigRequest {
    #[serde(default)]
    workspace: WorkspaceRequest,
    raw: String,
}

#[tauri::command]
fn runtime_status() -> RuntimeStatus {
    RuntimeStatus {
        core_version: CORE_VERSION,
        protocol_version: PROTOCOL_VERSION,
        transport: "in-process",
    }
}

fn workspace_cwd(request: &WorkspaceRequest) -> Result<PathBuf, String> {
    match request.cwd.as_ref().map(PathBuf::from) {
        Some(path) if path.is_absolute() => Ok(path),
        Some(path) => std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(|error| error.to_string()),
        None => dirs::home_dir().ok_or_else(|| "unable to resolve home directory".to_owned()),
    }
}

fn config_path(request: &WorkspaceRequest, cwd: &Path) -> Result<PathBuf, String> {
    if let Some(path) = request.config_path.as_ref().map(PathBuf::from) {
        return Ok(if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        });
    }
    let environment: BTreeMap<String, String> = std::env::vars().collect();
    let mut options = LoadConfigOptions::new(cwd);
    options.home_dir = dirs::home_dir();
    options.coderelay_home = environment.get("CODERELAY_HOME").map(PathBuf::from);
    let loaded = load_config(&options).map_err(|error| format!("{error:#}"))?;
    Ok(loaded.path.unwrap_or_else(|| project_config_path(cwd)))
}

async fn context_for(request: &WorkspaceRequest) -> Result<CliContext, String> {
    let cwd = workspace_cwd(request)?;
    let config_path = request.config_path.as_ref().map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || {
        load_context(Some(&cwd), config_path.as_deref()).map_err(|error| format!("{error:#}"))
    })
    .await
    .map_err(|error| format!("context task failed: {error}"))?
}

fn session_store_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "unable to resolve home directory".to_owned())?;
    let coderelay_home = std::env::var_os("CODERELAY_HOME").map(PathBuf::from);
    default_session_db_path(Some(&home), coderelay_home.as_deref())
        .ok_or_else(|| "unable to resolve session database path".to_owned())
}

fn with_session_store<T>(
    state: &DesktopState,
    action: impl FnOnce(&mut SessionStore) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .sessions
        .lock()
        .map_err(|_| "session store lock poisoned".to_owned())?;
    if guard.is_none() {
        *guard =
            Some(SessionStore::open(session_store_path()?).map_err(|error| error.to_string())?);
    }
    action(guard.as_mut().expect("session store initialized"))
}

fn stored_jev_api_key(app: &AppHandle) -> Result<Option<String>, String> {
    with_session_store(&app.state::<DesktopState>(), |store| {
        store.get_jev_api_key().map_err(|error| error.to_string())
    })
}

fn jev_settings_payload(app: &AppHandle) -> Result<JevSettingsPayload, String> {
    let stored = stored_jev_api_key(app)?.is_some();
    let environment_configured = std::env::var(TYPESAFE_ENV_KEY)
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    Ok(JevSettingsPayload {
        stored,
        environment_configured,
    })
}

fn title_from_prompt(prompt: &str) -> String {
    let first_line = prompt.lines().next().unwrap_or(prompt).trim();
    let title: String = first_line.chars().take(80).collect();
    if title.is_empty() {
        "新任务".to_owned()
    } else {
        title
    }
}

#[tauri::command]
async fn discover(app: AppHandle, request: WorkspaceRequest) -> Result<DiscoveryPayload, String> {
    let context = context_for(&request).await?;
    let cwd_string = context.cwd.to_string_lossy().into_owned();
    let _ = with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .record_workspace(&cwd_string)
            .map_err(|error| error.to_string())
    });
    let recent_workspaces = with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .get_recent_workspaces(8)
            .map_err(|error| error.to_string())
    })?;
    Ok(DiscoveryPayload {
        cwd: cwd_string,
        config_path: context
            .loaded_config
            .path
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
        default_agent: context.config().default_agent,
        routing_modes: ROUTING_MODES.to_vec(),
        agents: build_agent_entries(&context),
        catalog: context.catalog.clone(),
        permissions: coderelay_core::agent_ids()
            .map(|cli_id| AgentPermissions {
                cli_id,
                options: coderelay_core::permission_options(cli_id),
            })
            .collect(),
        recent_workspaces,
    })
}

async fn select_for(
    context: &CliContext,
    request: &SelectionRequest,
    stored_jev_api_key: Option<&str>,
) -> Result<RunSelection, String> {
    if request.agent.is_some() || request.model.is_some() {
        return context
            .select(
                &request.request,
                request.agent.as_deref(),
                request.model.as_deref(),
                request.mode,
            )
            .map_err(|error| format!("{error:#}"));
    }

    match request.mode.unwrap_or(context.config().routing.mode) {
        RoutingMode::Jev => {
            let candidates = context.route_candidates();
            if candidates.is_empty() {
                return Err("没有可用的已探测模型".to_owned());
            }
            let client = JevHttpClient::from_config_with_stored_key(
                context.config(),
                &context.cwd,
                &context.environment,
                stored_jev_api_key,
            )
            .await
            .map_err(|error| error.to_string())?;
            let decision = jev::route_with_jev(&request.request, &candidates, &client)
                .await
                .map_err(|error| error.to_string())?;
            Ok(RunSelection {
                agent: decision.agent,
                model: decision.model,
                candidate: Some(decision.candidate),
                reasons: decision.reasons,
            })
        }
        mode => context
            .select(&request.request, None, None, Some(mode))
            .map_err(|error| format!("{error:#}")),
    }
}

#[tauri::command]
async fn route_preview(app: AppHandle, request: SelectionRequest) -> Result<RoutePreview, String> {
    let context = context_for(&request.workspace).await?;
    let stored_api_key = stored_jev_api_key(&app)?;
    let selection = select_for(&context, &request, stored_api_key.as_deref()).await?;
    Ok(RoutePreview {
        agent: selection.agent,
        model: selection.model,
        reasons: selection.reasons,
    })
}

fn turn_status(status: AgentRunStatus) -> TurnRunStatus {
    match status {
        AgentRunStatus::Completed => TurnRunStatus::Completed,
        AgentRunStatus::Failed => TurnRunStatus::Failed,
        AgentRunStatus::Timeout => TurnRunStatus::Timeout,
        AgentRunStatus::Aborted => TurnRunStatus::Aborted,
        AgentRunStatus::SpawnError => TurnRunStatus::SpawnError,
    }
}

struct RunRecordContext {
    session_id: String,
    agent: coderelay_core::AgentId,
    model: Option<String>,
    prompt: String,
    protocol: TurnProtocol,
    context_source: Option<TurnContextSource>,
}

fn record_run(
    store: &mut SessionStore,
    context: RunRecordContext,
    result: &AgentRunResult,
) -> Result<SessionTurn, String> {
    store
        .append_turn(AppendTurnInput {
            session_id: context.session_id,
            cli_id: context.agent,
            prompt: context.prompt,
            output: result.text.clone(),
            exit_code: result.code,
            signal: result.signal.clone(),
            duration_ms: result.duration_ms,
            model_id: context.model,
            protocol: Some(context.protocol),
            reused_native: Some(false),
            status: Some(turn_status(result.status)),
            event_summary: Some(coderelay_core::runtime::summarize_events(&result.events)),
            context_source: context.context_source,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_run(app: AppHandle, request: StartRunRequest) -> Result<StartRunResponse, String> {
    let context = context_for(&request.workspace).await?;
    let selection_request = SelectionRequest {
        workspace: request.workspace.clone(),
        request: request.request.clone(),
        mode: request.mode,
        agent: request.agent.clone(),
        model: request.model.clone(),
    };
    let stored_api_key = stored_jev_api_key(&app)?;
    let selection = select_for(&context, &selection_request, stored_api_key.as_deref()).await?;
    let prompt = request.request.prompt.trim().to_owned();
    let title = title_from_prompt(&prompt);
    let workspace = context.cwd.clone();

    let (session, history) = with_session_store(&app.state::<DesktopState>(), |store| {
        let session = match request.session_id.as_deref() {
            Some(session_id) => store
                .get_session(session_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("session not found: {session_id}"))?,
            None => store
                .create_session(selection.agent, title, Some(&workspace))
                .map_err(|error| error.to_string())?,
        };
        let turns = store
            .list_turns(&session.id)
            .map_err(|error| error.to_string())?;
        Ok((session, turns))
    })?;
    let _ = app.emit(
        SESSION_UPDATED,
        SessionUpdatedPayload {
            session_id: session.id.clone(),
            turn_id: None,
        },
    );

    let context_source = (!history.is_empty()).then_some(TurnContextSource::Transcript);
    let effective_prompt = build_prompt_with_context(&history, &prompt);
    let prepared = context
        .prepare_agent(
            selection.agent,
            selection.model.clone(),
            &effective_prompt,
            request.permission.as_deref(),
        )
        .map_err(|error| format!("{error:#}"))?;
    let protocol = if prepared.structured {
        TurnProtocol::Structured
    } else {
        TurnProtocol::Text
    };

    let mut options = AgentRunOptions::new(prepared.command);
    options.cwd = prepared.cwd;
    options.environment = prepared.environment;
    options.timeout = request.timeout_ms.map(std::time::Duration::from_millis);
    options.protocol = if prepared.structured {
        coderelay_core::AgentProtocol::Structured
    } else {
        coderelay_core::AgentProtocol::Text
    };
    options.target = Some(prepared.target);
    let handle = start_agent_run(options);
    let run_id = handle.run_id.clone();
    let session_id = session.id.clone();
    let abort_handle = handle.abort_handle();
    app.state::<DesktopState>()
        .runs
        .lock()
        .map_err(|_| "run registry lock poisoned".to_owned())?
        .insert(run_id.clone(), abort_handle);

    let response = StartRunResponse {
        run_id: run_id.clone(),
        session_id: session_id.clone(),
        agent: selection.agent,
        model: selection.model.clone(),
        reasons: selection.reasons,
    };
    let app_handle = app.clone();
    let run_agent = selection.agent;
    let run_model = selection.model;
    tauri::async_runtime::spawn(async move {
        let mut handle = handle;
        while let Some(event) = handle.events.recv().await {
            let _ = app_handle.emit(
                RUN_EVENT,
                RunEventPayload {
                    run_id: run_id.clone(),
                    session_id: session_id.clone(),
                    event,
                },
            );
        }
        let result = match handle.done.await {
            Ok(result) => result,
            Err(error) => AgentRunResult {
                status: AgentRunStatus::SpawnError,
                code: None,
                signal: None,
                duration_ms: 0,
                timed_out: false,
                text: String::new(),
                stderr_tail: error.to_string(),
                events: Vec::new(),
            },
        };

        let record = RunRecordContext {
            session_id: session_id.clone(),
            agent: run_agent,
            model: run_model,
            prompt,
            protocol,
            context_source,
        };
        let turn_id = with_session_store(&app_handle.state::<DesktopState>(), |store| {
            record_run(store, record, &result)
        })
        .ok()
        .map(|turn| turn.id);

        let _ = app_handle.emit(
            SESSION_UPDATED,
            SessionUpdatedPayload {
                session_id: session_id.clone(),
                turn_id,
            },
        );
        let _ = app_handle.emit(
            RUN_COMPLETED,
            RunCompletedPayload {
                run_id: run_id.clone(),
                session_id: session_id.clone(),
                result,
            },
        );
        if let Ok(mut runs) = app_handle.state::<DesktopState>().runs.lock() {
            runs.remove(&run_id);
        }
    });

    Ok(response)
}

#[tauri::command]
fn cancel_run(app: AppHandle, run_id: String) -> Result<bool, String> {
    let state: State<'_, DesktopState> = app.state();
    let runs = state
        .runs
        .lock()
        .map_err(|_| "run registry lock poisoned".to_owned())?;
    if let Some(handle) = runs.get(&run_id) {
        handle.abort();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn list_recent_workspaces(app: AppHandle, limit: Option<u32>) -> Result<Vec<String>, String> {
    with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .get_recent_workspaces(limit.unwrap_or(8))
            .map_err(|error| error.to_string())
    })
}

fn resolve_dialog_initial_dir(initial_dir: Option<&str>) -> Option<PathBuf> {
    let raw = initial_dir?.trim();
    if raw.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(raw);
    if candidate.is_dir() {
        Some(candidate)
    } else {
        candidate
            .parent()
            .filter(|parent| parent.is_dir())
            .map(Path::to_path_buf)
    }
}

#[tauri::command]
async fn pick_workspace(app: AppHandle, initial_dir: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(dir) = resolve_dialog_initial_dir(initial_dir.as_deref()) {
        dialog = dialog.set_directory(&dir);
    }
    let picked = dialog
        .pick_folder()
        .await
        .map(|handle| handle.path().to_string_lossy().into_owned());
    if let Some(ref path) = picked {
        let _ = with_session_store(&app.state::<DesktopState>(), |store| {
            store
                .record_workspace(path)
                .map_err(|error| error.to_string())
        });
    }
    Ok(picked)
}

#[tauri::command]
fn record_workspace(app: AppHandle, workspace: String) -> Result<(), String> {
    with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .record_workspace(&workspace)
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn list_sessions(
    app: AppHandle,
    request: SessionListRequest,
) -> Result<Vec<SessionRecord>, String> {
    with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .list_sessions(&ListSessionsOptions {
                workspace: request.workspace,
                limit: request.limit,
            })
            .map_err(|error| error.to_string())
    })
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct DeleteWorkspaceSessionsRequest {
    workspace: Option<String>,
}

#[tauri::command]
fn delete_session(app: AppHandle, session_id: String) -> Result<bool, String> {
    let removed = with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .delete_session(&session_id)
            .map_err(|error| error.to_string())
    })?;
    let _ = app.emit(
        SESSION_UPDATED,
        SessionUpdatedPayload {
            session_id,
            turn_id: None,
        },
    );
    Ok(removed)
}

#[tauri::command]
fn delete_workspace_sessions(
    app: AppHandle,
    request: DeleteWorkspaceSessionsRequest,
) -> Result<usize, String> {
    let removed = with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .delete_workspace_sessions(request.workspace.as_deref())
            .map_err(|error| error.to_string())
    })?;
    let _ = app.emit(
        SESSION_UPDATED,
        SessionUpdatedPayload {
            session_id: String::new(),
            turn_id: None,
        },
    );
    Ok(removed)
}

#[tauri::command]
fn get_session(app: AppHandle, session_id: String) -> Result<SessionDetail, String> {
    with_session_store(&app.state::<DesktopState>(), |store| {
        let session = store
            .get_session(&session_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("session not found: {session_id}"))?;
        let turns = store
            .list_turns(&session_id)
            .map_err(|error| error.to_string())?;
        Ok(SessionDetail { session, turns })
    })
}

#[tauri::command]
async fn read_config_source(request: WorkspaceRequest) -> Result<ConfigSourcePayload, String> {
    let cwd = workspace_cwd(&request)?;
    let path = config_path(&request, &cwd)?;
    let exists = path.is_file();
    let raw = if exists {
        std::fs::read_to_string(&path).map_err(|error| error.to_string())?
    } else {
        render_default_config_yaml().map_err(|error| error.to_string())?
    };
    Ok(ConfigSourcePayload {
        path: path.to_string_lossy().into_owned(),
        exists,
        raw,
    })
}

#[tauri::command]
async fn save_config(request: SaveConfigRequest) -> Result<String, String> {
    let cwd = workspace_cwd(&request.workspace)?;
    let path = config_path(&request.workspace, &cwd)?;
    write_config_source(&path, &request.raw).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_jev_settings(app: AppHandle) -> Result<JevSettingsPayload, String> {
    jev_settings_payload(&app)
}

#[tauri::command]
fn save_jev_api_key(app: AppHandle, api_key: String) -> Result<JevSettingsPayload, String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key must not be empty".to_owned());
    }
    with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .set_jev_api_key(api_key)
            .map_err(|error| error.to_string())
    })?;
    jev_settings_payload(&app)
}

#[tauri::command]
fn clear_jev_api_key(app: AppHandle) -> Result<JevSettingsPayload, String> {
    with_session_store(&app.state::<DesktopState>(), |store| {
        store.clear_jev_api_key().map_err(|error| error.to_string())
    })?;
    jev_settings_payload(&app)
}

#[tauri::command]
fn supported_agents() -> Vec<coderelay_core::AgentDescriptor> {
    coderelay_core::supported_agents()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            runtime_status,
            supported_agents,
            discover,
            route_preview,
            start_run,
            cancel_run,
            list_recent_workspaces,
            pick_workspace,
            list_sessions,
            get_session,
            delete_session,
            delete_workspace_sessions,
            get_jev_settings,
            save_jev_api_key,
            clear_jev_api_key,
            read_config_source,
            save_config,
            record_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running CodeRelay desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_completed_and_failed_runs_with_full_metadata() {
        let mut store = SessionStore::open_in_memory().expect("store");
        let session = store
            .create_session(coderelay_core::AgentId::Codex, "desktop run", None)
            .expect("session");
        let completed = AgentRunResult {
            status: AgentRunStatus::Completed,
            code: Some(0),
            signal: None,
            duration_ms: 42,
            timed_out: false,
            text: "desktop output".to_owned(),
            stderr_tail: String::new(),
            events: vec![AgentEvent::AssistantText {
                text: "desktop output".to_owned(),
            }],
        };
        let turn = record_run(
            &mut store,
            RunRecordContext {
                session_id: session.id.clone(),
                agent: coderelay_core::AgentId::Codex,
                model: Some("gpt-5".to_owned()),
                prompt: "fix it".to_owned(),
                protocol: TurnProtocol::Text,
                context_source: Some(TurnContextSource::Transcript),
            },
            &completed,
        )
        .expect("record completed");
        assert_eq!(turn.status, Some(TurnRunStatus::Completed));
        assert_eq!(turn.model_id.as_deref(), Some("gpt-5"));
        assert_eq!(turn.context_source, Some(TurnContextSource::Transcript));
        assert_eq!(turn.event_summary.as_deref(), Some("desktop output"));

        let failed = AgentRunResult {
            status: AgentRunStatus::Timeout,
            code: None,
            signal: Some("SIGKILL".to_owned()),
            duration_ms: 120,
            timed_out: true,
            text: "partial".to_owned(),
            stderr_tail: "timed out".to_owned(),
            events: Vec::new(),
        };
        let turn = record_run(
            &mut store,
            RunRecordContext {
                session_id: session.id.clone(),
                agent: coderelay_core::AgentId::Codex,
                model: None,
                prompt: "slow".to_owned(),
                protocol: TurnProtocol::Structured,
                context_source: None,
            },
            &failed,
        )
        .expect("record failed");
        assert_eq!(turn.status, Some(TurnRunStatus::Timeout));
        assert_eq!(turn.exit_code, None);
        assert_eq!(turn.signal.as_deref(), Some("SIGKILL"));
        assert_eq!(turn.protocol, Some(TurnProtocol::Structured));
    }

    #[test]
    fn resolves_dialog_initial_dir_from_directory_file_or_invalid_inputs() {
        let temp = tempfile::tempdir().expect("tempdir");
        let dir_path = temp.path();
        let file_path = dir_path.join("Cargo.toml");
        std::fs::write(&file_path, "[package]\nname = \"demo\"\n").expect("write file");

        assert_eq!(
            resolve_dialog_initial_dir(dir_path.to_str()),
            Some(dir_path.to_path_buf())
        );
        assert_eq!(
            resolve_dialog_initial_dir(file_path.to_str()),
            Some(dir_path.to_path_buf())
        );
        assert_eq!(resolve_dialog_initial_dir(None), None);
        assert_eq!(resolve_dialog_initial_dir(Some("   ")), None);
        assert_eq!(
            resolve_dialog_initial_dir(Some("/nonexistent_root_dir_99999/missing_sub")),
            None
        );
    }
}
