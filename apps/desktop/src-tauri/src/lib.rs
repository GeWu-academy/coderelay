use std::collections::{BTreeMap, HashMap};
use std::io::Read;
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
    AgentAbortHandle, AgentEvent, AgentId, AgentRunOptions, AgentRunResult, AgentRunStatus,
    AppendTurnInput, CORE_VERSION, DetectedCli, ListSessionsOptions, ModelCatalog, ROUTING_MODES,
    RouteRequest, RoutingMode, SessionRecord, SessionStore, SessionTurn, TurnContextSource,
    TurnProtocol, TurnRunStatus, build_prompt_with_context, default_session_db_path,
    start_agent_run,
};
use coderelay_protocol::PROTOCOL_VERSION;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

mod git;
mod terminal;
use git::{
    git_branches, git_checkout, git_commit, git_delete_branch, git_diff, git_discard,
    git_generate_commit_message, git_init, git_stage, git_status, git_sync, git_unstage,
};
use terminal::{TerminalRegistry, terminal_close, terminal_create, terminal_resize, terminal_write};

const RUN_EVENT: &str = "run-event";
const RUN_COMPLETED: &str = "run-completed";
const SESSION_UPDATED: &str = "session-updated";

type PermissionsCacheKey = Vec<(AgentId, String, Option<String>, bool)>;

struct CachedPermissions {
    key: PermissionsCacheKey,
    permissions: Vec<AgentPermissions>,
}

#[derive(Default)]
struct DesktopState {
    runs: Mutex<HashMap<String, AgentAbortHandle>>,
    sessions: Mutex<Option<SessionStore>>,
    permissions_cache: Mutex<Option<CachedPermissions>>,
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
pub(crate) struct WorkspaceRequest {
    pub(crate) cwd: Option<String>,
    pub(crate) config_path: Option<String>,
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
    options: Vec<coderelay_core::PermissionOption>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectionRequest {
    #[serde(default)]
    pub(crate) workspace: WorkspaceRequest,
    pub(crate) request: RouteRequest,
    pub(crate) mode: Option<RoutingMode>,
    pub(crate) agent: Option<String>,
    pub(crate) model: Option<String>,
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
    match request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
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

pub(crate) async fn context_for(request: &WorkspaceRequest) -> Result<CliContext, String> {
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

pub(crate) fn stored_jev_api_key(app: &AppHandle) -> Result<Option<String>, String> {
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
    let has_explicit_cwd = request
        .cwd
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let context = context_for(&request).await?;
    let cwd_string = if has_explicit_cwd {
        let cwd_string = context.cwd.to_string_lossy().into_owned();
        let _ = with_session_store(&app.state::<DesktopState>(), |store| {
            store
                .record_workspace(&cwd_string)
                .map_err(|error| error.to_string())
        });
        cwd_string
    } else {
        String::new()
    };
    let recent_workspaces = with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .get_recent_workspaces(8)
            .map_err(|error| error.to_string())
    })?;
    let permissions_key: PermissionsCacheKey = context
        .detected
        .iter()
        .map(|cli: &DetectedCli| {
            (
                cli.id,
                cli.path.clone(),
                cli.version.clone(),
                cli.available,
            )
        })
        .collect();
    let cached_permissions = app
        .state::<DesktopState>()
        .permissions_cache
        .lock()
        .ok()
        .and_then(|guard| {
            guard
                .as_ref()
                .filter(|cached| cached.key == permissions_key)
                .map(|cached| cached.permissions.clone())
        });
    let permissions = match cached_permissions {
        Some(cached) => cached,
        None => {
            let detected = context.detected.clone();
            let environment = context.environment.clone();
            let scanned_permissions = tauri::async_runtime::spawn_blocking(move || {
                coderelay_core::scan_permissions(
                    &coderelay_core::SystemHost,
                    &detected,
                    &environment,
                    coderelay_core::DEFAULT_PERMISSION_SCAN_TIMEOUT,
                )
            })
            .await
            .map_err(|error| format!("扫描 CLI 权限失败: {error}"))?;
            let mapped: Vec<AgentPermissions> = scanned_permissions
                .into_iter()
                .map(|(cli_id, options)| AgentPermissions { cli_id, options })
                .collect();
            if let Ok(mut guard) = app.state::<DesktopState>().permissions_cache.lock() {
                *guard = Some(CachedPermissions {
                    key: permissions_key,
                    permissions: mapped.clone(),
                });
            }
            mapped
        }
    };
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
        permissions,
        recent_workspaces,
    })
}

pub(crate) async fn select_for(
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
    let has_explicit_cwd = request
        .workspace
        .cwd
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
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
    let session_workspace = has_explicit_cwd.then_some(workspace.as_path());

    let (session, history) = with_session_store(&app.state::<DesktopState>(), |store| {
        let session = match request.session_id.as_deref() {
            Some(session_id) => store
                .get_session(session_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("session not found: {session_id}"))?,
            None => store
                .create_session(selection.agent, title, session_workspace)
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
async fn pick_workspace(
    app: AppHandle,
    initial_dir: Option<String>,
) -> Result<Option<String>, String> {
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteWorkspaceRequest {
    workspace: String,
}

#[tauri::command]
fn delete_workspace(app: AppHandle, request: DeleteWorkspaceRequest) -> Result<bool, String> {
    let trimmed = request.workspace.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }
    let removed = with_session_store(&app.state::<DesktopState>(), |store| {
        store
            .delete_workspace_sessions(Some(trimmed))
            .map_err(|error| error.to_string())?;
        store
            .remove_recent_workspace(trimmed)
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

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ListDirectoryRequest {
    cwd: Option<String>,
    relative_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileTreeEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    extension: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadWorkspaceFileRequest {
    cwd: Option<String>,
    relative_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileContent {
    path: String,
    name: String,
    content: String,
    size: u64,
    line_count: usize,
    is_binary: bool,
    truncated: bool,
    extension: Option<String>,
}

const MAX_FILE_PREVIEW_BYTES: usize = 512 * 1024;

pub(crate) fn resolve_workspace_subpath(
    cwd: Option<String>,
    relative_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), String> {
    let trimmed_cwd = cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "no workspace selected".to_owned())?;
    let base = workspace_cwd(&WorkspaceRequest {
        cwd: Some(trimmed_cwd.to_owned()),
        config_path: None,
    })?;
    let workspace_root =
        std::fs::canonicalize(&base).map_err(|error| format!("invalid workspace: {error}"))?;
    let trimmed = relative_path.unwrap_or("").trim();
    let candidate = if trimmed.is_empty() || trimmed == "." {
        workspace_root.clone()
    } else {
        workspace_root.join(trimmed.trim_start_matches(['/', '\\']))
    };
    let target =
        std::fs::canonicalize(&candidate).map_err(|error| format!("path not found: {error}"))?;
    if !target.starts_with(&workspace_root) {
        return Err("path escapes workspace root".to_owned());
    }
    Ok((workspace_root, target))
}

fn to_relative_slash_path(workspace_root: &Path, target: &Path) -> String {
    target
        .strip_prefix(workspace_root)
        .unwrap_or(target)
        .to_string_lossy()
        .replace('\\', "/")
}

#[tauri::command]
fn list_directory(request: ListDirectoryRequest) -> Result<Vec<FileTreeEntry>, String> {
    let (workspace_root, target) =
        resolve_workspace_subpath(request.cwd, request.relative_path.as_deref())?;
    if !target.is_dir() {
        return Err("target path is not a directory".to_owned());
    }
    let read_dir = std::fs::read_dir(&target).map_err(|error| error.to_string())?;
    let mut entries = Vec::new();
    for item in read_dir {
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let is_dir = metadata.is_dir();
        let size = if is_dir { 0 } else { metadata.len() };
        let extension = if is_dir {
            None
        } else {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_lowercase())
        };
        entries.push(FileTreeEntry {
            name,
            path: to_relative_slash_path(&workspace_root, &path),
            is_dir,
            size,
            extension,
        });
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn read_workspace_file(request: ReadWorkspaceFileRequest) -> Result<WorkspaceFileContent, String> {
    let (workspace_root, target) =
        resolve_workspace_subpath(request.cwd, Some(request.relative_path.as_str()))?;
    if !target.is_file() {
        return Err("target path is not a file".to_owned());
    }
    let metadata = std::fs::metadata(&target).map_err(|error| error.to_string())?;
    let size = metadata.len();
    let file = std::fs::File::open(&target).map_err(|error| error.to_string())?;
    let mut buf = Vec::new();
    file.take((MAX_FILE_PREVIEW_BYTES + 1) as u64)
        .read_to_end(&mut buf)
        .map_err(|error| error.to_string())?;
    let truncated = buf.len() > MAX_FILE_PREVIEW_BYTES;
    if truncated {
        buf.truncate(MAX_FILE_PREVIEW_BYTES);
    }
    let has_nul = buf.iter().take(8192).any(|&byte| byte == 0);
    let (is_binary, content, line_count) =
        if has_nul || (!truncated && std::str::from_utf8(&buf).is_err()) {
            (true, String::new(), 0)
        } else {
            let text = String::from_utf8_lossy(&buf).into_owned();
            let lines = text.lines().count();
            (false, text, lines)
        };
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = target
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());
    Ok(WorkspaceFileContent {
        path: to_relative_slash_path(&workspace_root, &target),
        name,
        content,
        size,
        line_count,
        is_binary,
        truncated,
        extension,
    })
}

#[tauri::command]
fn supported_agents() -> Vec<coderelay_core::AgentDescriptor> {
    coderelay_core::supported_agents()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .manage(TerminalRegistry::default())
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
            delete_workspace,
            delete_workspace_sessions,
            get_jev_settings,
            save_jev_api_key,
            clear_jev_api_key,
            read_config_source,
            save_config,
            record_workspace,
            list_directory,
            read_workspace_file,
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_close,
            git_status,
            git_diff,
            git_stage,
            git_unstage,
            git_discard,
            git_commit,
            git_branches,
            git_checkout,
            git_delete_branch,
            git_sync,
            git_init,
            git_generate_commit_message
        ])
        .build(tauri::generate_context!())
        .expect("error while building CodeRelay desktop")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                app_handle.state::<TerminalRegistry>().kill_all();
            }
        });
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

    #[test]
    fn lists_workspace_directory_and_reads_file_with_traversal_guard() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        std::fs::create_dir_all(root.join("src")).expect("create src");
        std::fs::write(root.join("README.md"), "# Hello\nWorld\n").expect("write readme");
        std::fs::write(root.join("src").join("main.ts"), "export const x = 1;\n")
            .expect("write main.ts");
        std::fs::write(root.join(".DS_Store"), "junk").expect("write ds_store");
        std::fs::write(root.join(".env"), "SECRET=1").expect("write env");
        std::fs::create_dir_all(root.join(".git")).expect("create .git");

        let root_entries = list_directory(ListDirectoryRequest {
            cwd: Some(root.to_string_lossy().into_owned()),
            relative_path: None,
        })
        .expect("list root");

        assert_eq!(root_entries.len(), 2);
        assert!(root_entries[0].is_dir);
        assert_eq!(root_entries[0].name, "src");
        assert_eq!(root_entries[0].path, "src");
        assert!(!root_entries[1].is_dir);
        assert_eq!(root_entries[1].name, "README.md");
        assert_eq!(root_entries[1].extension.as_deref(), Some("md"));

        let src_entries = list_directory(ListDirectoryRequest {
            cwd: Some(root.to_string_lossy().into_owned()),
            relative_path: Some("src".to_owned()),
        })
        .expect("list src");
        assert_eq!(src_entries.len(), 1);
        assert_eq!(src_entries[0].path, "src/main.ts");

        let file = read_workspace_file(ReadWorkspaceFileRequest {
            cwd: Some(root.to_string_lossy().into_owned()),
            relative_path: "src/main.ts".to_owned(),
        })
        .expect("read main.ts");
        assert_eq!(file.name, "main.ts");
        assert_eq!(file.line_count, 1);
        assert!(!file.is_binary);
        assert!(file.content.contains("export const x = 1;"));

        let escape_err = list_directory(ListDirectoryRequest {
            cwd: Some(root.to_string_lossy().into_owned()),
            relative_path: Some("..".to_owned()),
        })
        .expect_err("should block parent traversal");
        assert!(escape_err.contains("escapes workspace root"));
    }

    #[test]
    fn removes_workspace_and_its_sessions_from_sqlite_store() {
        let mut store = SessionStore::open_in_memory().expect("store");
        let ws = "/Users/allure/Projects/demo-cleanup";
        store.record_workspace(ws).expect("record workspace");
        store
            .create_session(
                coderelay_core::AgentId::Codex,
                "cleanup task",
                Some(Path::new(ws)),
            )
            .expect("create session");

        assert!(
            store
                .get_recent_workspaces(10)
                .expect("list")
                .contains(&ws.to_owned())
        );

        store
            .delete_workspace_sessions(Some(ws))
            .expect("delete sessions");
        let removed = store.remove_recent_workspace(ws).expect("remove recent");
        assert!(removed);
        assert!(
            !store
                .get_recent_workspaces(10)
                .expect("list")
                .contains(&ws.to_owned())
        );
    }

    #[test]
    fn rejects_directory_and_file_access_when_no_workspace_is_selected() {
        for empty_cwd in [None, Some(String::new()), Some("   ".to_owned())] {
            let dir_err = list_directory(ListDirectoryRequest {
                cwd: empty_cwd.clone(),
                relative_path: None,
            })
            .expect_err("list_directory should require an explicit workspace");
            assert_eq!(dir_err, "no workspace selected");

            let file_err = read_workspace_file(ReadWorkspaceFileRequest {
                cwd: empty_cwd,
                relative_path: "README.md".to_owned(),
            })
            .expect_err("read_workspace_file should require an explicit workspace");
            assert_eq!(file_err, "no workspace selected");
        }
    }
}
