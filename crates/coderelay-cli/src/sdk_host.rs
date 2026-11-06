use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use coderelay_core::config::{
    LoadConfigOptions, load_config, project_config_path, render_default_config_yaml,
    save_config_source,
};
use coderelay_core::router::jev;
use coderelay_core::{
    AgentAbortHandle, AgentRunOptions, AgentRunResult, AgentRunStatus, AppendTurnInput,
    CORE_VERSION, ListSessionsOptions, RoutingMode, SessionStore, SessionTurn, TurnContextSource,
    TurnProtocol, TurnRunStatus, build_prompt_with_context, default_session_db_path,
    start_agent_run,
};
use coderelay_protocol::{
    CancelRunParams, CancelRunResult, ConfigSourceResult, ErrorCode, EventEnvelope,
    GetModelCatalogParams, GetSessionParams, ListRecentWorkspacesParams, ListSessionsParams,
    PROTOCOL_VERSION, ProtocolError, ReadConfigParams, RequestEnvelope, ResponseEnvelope,
    RouteParams, RouteResult, RunCompletedEnvelope, SaveConfigParams, SaveConfigResult,
    SessionDetailResult, StartRunParams, StartRunResult, StatusResult, WorkspaceParams, method,
    validate_protocol_version,
};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use crate::context::{CliContext, RunSelection, load_context};
use crate::jev::JevHttpClient;

#[derive(Default)]
struct HostState {
    runs: Mutex<HashMap<String, AgentAbortHandle>>,
    sessions: Mutex<Option<SessionStore>>,
}

type Host = Arc<HostState>;
type Writer = mpsc::UnboundedSender<String>;

fn protocol_error(code: ErrorCode, message: impl Into<String>, retryable: bool) -> ProtocolError {
    ProtocolError::new(code, message, retryable)
}

fn error_response(request_id: &str, error: ProtocolError) -> ResponseEnvelope {
    ResponseEnvelope::error(request_id, error)
}

fn decode_params<T: DeserializeOwned>(params: Option<Value>) -> Result<T, ProtocolError> {
    let value = params.ok_or_else(|| {
        protocol_error(
            ErrorCode::InvalidRequest,
            "request params are required",
            false,
        )
    })?;
    serde_json::from_value(value).map_err(|error| {
        protocol_error(
            ErrorCode::InvalidRequest,
            format!("invalid request params: {error}"),
            false,
        )
    })
}

fn maybe_params<T: DeserializeOwned + Default>(params: Option<Value>) -> Result<T, ProtocolError> {
    match params {
        Some(value) => serde_json::from_value(value).map_err(|error| {
            protocol_error(
                ErrorCode::InvalidRequest,
                format!("invalid request params: {error}"),
                false,
            )
        }),
        None => Ok(T::default()),
    }
}

fn send_json<T: serde::Serialize>(writer: &Writer, value: &T) {
    if let Ok(message) = coderelay_protocol::encode_message(value) {
        let _ = writer.send(message);
    }
}

fn workspace_cwd(request: &WorkspaceParams) -> Result<PathBuf, String> {
    match request.cwd.as_ref().map(PathBuf::from) {
        Some(path) if path.is_absolute() => Ok(path),
        Some(path) => std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(|error| error.to_string()),
        None => dirs::home_dir().ok_or_else(|| "unable to resolve home directory".to_owned()),
    }
}

async fn context_for(request: &WorkspaceParams) -> Result<CliContext, String> {
    let cwd = workspace_cwd(request)?;
    let config_path = request.config_path.as_ref().map(PathBuf::from);
    tokio::task::spawn_blocking(move || {
        load_context(Some(&cwd), config_path.as_deref()).map_err(|error| format!("{error:#}"))
    })
    .await
    .map_err(|error| format!("context task failed: {error}"))?
}

fn config_path(request: &WorkspaceParams, cwd: &Path) -> Result<PathBuf, String> {
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

fn session_store_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "unable to resolve home directory".to_owned())?;
    let coderelay_home = std::env::var_os("CODERELAY_HOME").map(PathBuf::from);
    default_session_db_path(Some(&home), coderelay_home.as_deref())
        .ok_or_else(|| "unable to resolve session database path".to_owned())
}

fn with_session_store<T>(
    state: &HostState,
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

async fn select_for(context: &CliContext, request: &RouteParams) -> Result<RunSelection, String> {
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
            let client =
                JevHttpClient::from_config(context.config(), &context.cwd, &context.environment)
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

fn title_from_prompt(prompt: &str) -> String {
    let first_line = prompt.lines().next().unwrap_or(prompt).trim();
    let title: String = first_line.chars().take(80).collect();
    if title.is_empty() {
        "新任务".to_owned()
    } else {
        title
    }
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

#[allow(clippy::too_many_arguments)]
fn record_run(
    store: &mut SessionStore,
    session_id: &str,
    agent: coderelay_core::AgentId,
    model: Option<String>,
    prompt: String,
    protocol: TurnProtocol,
    context_source: Option<TurnContextSource>,
    result: &AgentRunResult,
) -> Result<SessionTurn, String> {
    store
        .append_turn(AppendTurnInput {
            session_id: session_id.to_owned(),
            cli_id: agent,
            prompt,
            output: result.text.clone(),
            exit_code: result.code,
            signal: result.signal.clone(),
            duration_ms: result.duration_ms,
            model_id: model,
            protocol: Some(protocol),
            reused_native: Some(false),
            status: Some(turn_status(result.status)),
            event_summary: Some(coderelay_core::runtime::summarize_events(&result.events)),
            context_source,
        })
        .map_err(|error| error.to_string())
}

fn spawn_run(
    state: Host,
    writer: Writer,
    context: CliContext,
    selection: RunSelection,
    params: StartRunParams,
    request_id: String,
) {
    let prompt = params.request.prompt.trim().to_owned();
    let title = title_from_prompt(&prompt);
    let workspace = context.cwd.clone();
    let selection_agent = selection.agent;
    let selection_model = selection.model.clone();
    let selection_reasons = selection.reasons;

    let session_result = with_session_store(&state, |store| {
        let session = match params.session_id.as_deref() {
            Some(session_id) => store
                .get_session(session_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| format!("session not found: {session_id}"))?,
            None => store
                .create_session(selection_agent, title, Some(&workspace))
                .map_err(|error| error.to_string())?,
        };
        let turns = store
            .list_turns(&session.id)
            .map_err(|error| error.to_string())?;
        Ok((session, turns))
    });

    let (session, history) = match session_result {
        Ok(value) => value,
        Err(message) => {
            send_json(
                &writer,
                &error_response(
                    &request_id,
                    protocol_error(ErrorCode::Internal, message, false),
                ),
            );
            return;
        }
    };
    let context_source = (!history.is_empty()).then_some(TurnContextSource::Transcript);
    let effective_prompt = build_prompt_with_context(&history, &prompt);
    let prepared = match context.prepare_agent(
        selection_agent,
        selection_model.clone(),
        &effective_prompt,
        None,
    ) {
        Ok(prepared) => prepared,
        Err(error) => {
            send_json(
                &writer,
                &error_response(
                    &request_id,
                    protocol_error(ErrorCode::Internal, format!("{error:#}"), false),
                ),
            );
            return;
        }
    };
    let protocol = if prepared.structured {
        TurnProtocol::Structured
    } else {
        TurnProtocol::Text
    };

    let mut options = AgentRunOptions::new(prepared.command);
    options.cwd = prepared.cwd;
    options.environment = prepared.environment;
    options.timeout = params.timeout_ms.map(std::time::Duration::from_millis);
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
    if let Ok(mut runs) = state.runs.lock() {
        runs.insert(run_id.clone(), abort_handle);
    }

    send_json(
        &writer,
        &ResponseEnvelope::ok(
            &request_id,
            serde_json::to_value(StartRunResult {
                run_id: run_id.clone(),
                session_id: session_id.clone(),
                agent: selection_agent,
                model: selection_model.clone(),
                reasons: selection_reasons,
            })
            .unwrap_or(Value::Null),
        ),
    );

    tokio::spawn(async move {
        let mut handle = handle;
        while let Some(event) = handle.events.recv().await {
            send_json(
                &writer,
                &EventEnvelope {
                    protocol_version: PROTOCOL_VERSION,
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
        let _ = with_session_store(&state, |store| {
            record_run(
                store,
                &session_id,
                selection_agent,
                selection_model,
                prompt,
                protocol,
                context_source,
                &result,
            )
        });
        send_json(
            &writer,
            &RunCompletedEnvelope {
                protocol_version: PROTOCOL_VERSION,
                run_id: run_id.clone(),
                session_id,
                result,
            },
        );
        if let Ok(mut runs) = state.runs.lock() {
            runs.remove(&run_id);
        }
    });
}

async fn handle_request(state: Host, writer: Writer, request: RequestEnvelope) {
    let request_id = request.request_id.clone();
    if let Err(error) = validate_protocol_version(request.protocol_version) {
        send_json(&writer, &error_response(&request_id, error));
        return;
    }

    match request.method.as_str() {
        method::STATUS => {
            send_json(
                &writer,
                &ResponseEnvelope::ok(
                    &request_id,
                    serde_json::to_value(StatusResult {
                        core_version: CORE_VERSION.to_owned(),
                        protocol_version: PROTOCOL_VERSION,
                        transport: "stdio".to_owned(),
                    })
                    .unwrap_or(Value::Null),
                ),
            );
        }
        method::DISCOVER_AGENTS => {
            let params = match maybe_params::<WorkspaceParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            match context_for(&params).await {
                Ok(context) => {
                    let result = coderelay_protocol::DiscoverAgentsResult {
                        cwd: context.cwd.to_string_lossy().into_owned(),
                        config_path: context
                            .loaded_config
                            .path
                            .as_ref()
                            .map(|path| path.to_string_lossy().into_owned()),
                        default_agent: context.config().default_agent,
                        routing_modes: coderelay_core::ROUTING_MODES.to_vec(),
                        detected: context.detected.clone(),
                    };
                    send_json(
                        &writer,
                        &ResponseEnvelope::ok(
                            &request_id,
                            serde_json::to_value(result).unwrap_or(Value::Null),
                        ),
                    );
                }
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::GET_MODEL_CATALOG => {
            let params = match maybe_params::<GetModelCatalogParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            match context_for(&params.workspace).await {
                Ok(context) => send_json(
                    &writer,
                    &ResponseEnvelope::ok(
                        &request_id,
                        serde_json::to_value(context.catalog).unwrap_or(Value::Null),
                    ),
                ),
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::ROUTE => {
            let params = match decode_params::<RouteParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            match context_for(&params.workspace).await {
                Ok(context) => match select_for(&context, &params).await {
                    Ok(selection) => send_json(
                        &writer,
                        &ResponseEnvelope::ok(
                            &request_id,
                            serde_json::to_value(RouteResult {
                                agent: selection.agent,
                                model: selection.model,
                                reasons: selection.reasons,
                            })
                            .unwrap_or(Value::Null),
                        ),
                    ),
                    Err(message) => send_json(
                        &writer,
                        &error_response(
                            &request_id,
                            protocol_error(ErrorCode::Internal, message, false),
                        ),
                    ),
                },
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::START_RUN => {
            let params = match decode_params::<StartRunParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            let route_params = RouteParams {
                workspace: params.workspace.clone(),
                request: params.request.clone(),
                mode: params.mode,
                agent: params.agent.clone(),
                model: params.model.clone(),
            };
            match context_for(&params.workspace).await {
                Ok(context) => match select_for(&context, &route_params).await {
                    Ok(selection) => {
                        spawn_run(state, writer, context, selection, params, request_id)
                    }
                    Err(message) => send_json(
                        &writer,
                        &error_response(
                            &request_id,
                            protocol_error(ErrorCode::Internal, message, false),
                        ),
                    ),
                },
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::CANCEL_RUN => {
            let params = match decode_params::<CancelRunParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            let cancelled = state
                .runs
                .lock()
                .ok()
                .and_then(|runs| {
                    runs.get(&params.run_id).map(|handle| {
                        handle.abort();
                        true
                    })
                })
                .unwrap_or(false);
            send_json(
                &writer,
                &ResponseEnvelope::ok(
                    &request_id,
                    serde_json::to_value(CancelRunResult { cancelled }).unwrap_or(Value::Null),
                ),
            );
        }
        method::LIST_RECENT_WORKSPACES => {
            let params = match maybe_params::<ListRecentWorkspacesParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            match with_session_store(&state, |store| {
                store
                    .get_recent_workspaces(params.limit.unwrap_or(8))
                    .map_err(|error| error.to_string())
            }) {
                Ok(workspaces) => send_json(
                    &writer,
                    &ResponseEnvelope::ok(
                        &request_id,
                        serde_json::to_value(workspaces).unwrap_or(Value::Null),
                    ),
                ),
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::LIST_SESSIONS => {
            let params = match maybe_params::<ListSessionsParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            match with_session_store(&state, |store| {
                store
                    .list_sessions(&ListSessionsOptions {
                        workspace: params.workspace,
                        limit: params.limit,
                    })
                    .map_err(|error| error.to_string())
            }) {
                Ok(sessions) => send_json(
                    &writer,
                    &ResponseEnvelope::ok(
                        &request_id,
                        serde_json::to_value(sessions).unwrap_or(Value::Null),
                    ),
                ),
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::GET_SESSION => {
            let params = match decode_params::<GetSessionParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            match with_session_store(&state, |store| {
                let session = store
                    .get_session(&params.session_id)
                    .map_err(|error| error.to_string())?
                    .ok_or_else(|| format!("session not found: {}", params.session_id))?;
                let turns = store
                    .list_turns(&params.session_id)
                    .map_err(|error| error.to_string())?;
                Ok(SessionDetailResult { session, turns })
            }) {
                Ok(detail) => send_json(
                    &writer,
                    &ResponseEnvelope::ok(
                        &request_id,
                        serde_json::to_value(detail).unwrap_or(Value::Null),
                    ),
                ),
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::NotFound, message, false),
                    ),
                ),
            }
        }
        method::READ_CONFIG => {
            let params = match maybe_params::<ReadConfigParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            let result = workspace_cwd(&params.workspace).and_then(|cwd| {
                let path = config_path(&params.workspace, &cwd)?;
                let exists = path.is_file();
                let raw = if exists {
                    std::fs::read_to_string(&path).map_err(|error| error.to_string())?
                } else {
                    render_default_config_yaml().map_err(|error| error.to_string())?
                };
                Ok(ConfigSourceResult {
                    path: path.to_string_lossy().into_owned(),
                    exists,
                    raw,
                })
            });
            match result {
                Ok(result) => send_json(
                    &writer,
                    &ResponseEnvelope::ok(
                        &request_id,
                        serde_json::to_value(result).unwrap_or(Value::Null),
                    ),
                ),
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::Internal, message, false),
                    ),
                ),
            }
        }
        method::SAVE_CONFIG => {
            let params = match decode_params::<SaveConfigParams>(request.params) {
                Ok(params) => params,
                Err(error) => {
                    send_json(&writer, &error_response(&request_id, error));
                    return;
                }
            };
            let result = workspace_cwd(&params.workspace).and_then(|cwd| {
                let path = config_path(&params.workspace, &cwd)?;
                save_config_source(&path, &params.raw).map_err(|error| error.to_string())?;
                Ok(SaveConfigResult {
                    path: path.to_string_lossy().into_owned(),
                })
            });
            match result {
                Ok(result) => send_json(
                    &writer,
                    &ResponseEnvelope::ok(
                        &request_id,
                        serde_json::to_value(result).unwrap_or(Value::Null),
                    ),
                ),
                Err(message) => send_json(
                    &writer,
                    &error_response(
                        &request_id,
                        protocol_error(ErrorCode::InvalidRequest, message, false),
                    ),
                ),
            }
        }
        other => send_json(
            &writer,
            &error_response(
                &request_id,
                protocol_error(
                    ErrorCode::InvalidRequest,
                    format!("unknown method: {other}"),
                    false,
                ),
            ),
        ),
    }
}

pub async fn run_stdio() -> i32 {
    let state: Host = Arc::new(HostState::default());
    let (writer, mut writer_rx) = mpsc::unbounded_channel::<String>();
    let writer_task = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(message) = writer_rx.recv().await {
            if stdout.write_all(message.as_bytes()).await.is_err()
                || stdout.write_all(b"\n").await.is_err()
                || stdout.flush().await.is_err()
            {
                break;
            }
        }
    });

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut tasks = tokio::task::JoinSet::new();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }
        let request: RequestEnvelope = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(error) => {
                let response = ResponseEnvelope::error(
                    "unknown",
                    protocol_error(
                        ErrorCode::InvalidRequest,
                        format!("invalid request envelope: {error}"),
                        false,
                    ),
                );
                send_json(&writer, &response);
                continue;
            }
        };
        let state = state.clone();
        let writer = writer.clone();
        tasks.spawn(async move {
            handle_request(state, writer, request).await;
        });
    }
    while tasks.join_next().await.is_some() {}
    drop(writer);
    let _ = writer_task.await;
    0
}
