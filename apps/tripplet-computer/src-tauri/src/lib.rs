//! Tripplet Computer — a local agent workstation for macOS.
//!
//! The Rust side owns everything that matters: the agent loop, model routing,
//! the approval gate, the tool sandbox, Composio, and persistence. The webview
//! is a view layer — it renders state and sends intents, and holds no secrets
//! and no policy. Every command below is the full extent of what it can ask
//! for.

pub mod agent;
pub mod approval;
pub mod approver;
pub mod attest;
pub mod composio;
pub mod config;
pub mod gateway;
pub mod llm;
pub mod models;
pub mod plugins;
pub mod skills;
pub mod state;
pub mod store;
pub mod tools;

use std::sync::Arc;

use tauri::{Emitter, Manager, State};

use agent::events::{AgentEvent, EventSink};
use agent::turn::Cancel;
use approver::{Approver, InteractiveApprover};
use config::{ApprovalPolicy, Config};
use models::Effort;
use state::{AppState, Bootstrap, ProjectView};
use store::{Project, StoredMessage, Thread};

/// The single channel every agent event travels on.
const EVENT_CHANNEL: &str = "agent-event";

/// Commands return `Result<T, String>`: Tauri serialises the error straight to
/// the webview, so it must already be a sentence a user can read.
type CmdResult<T> = Result<T, String>;

fn fail(err: impl std::fmt::Display) -> String {
    err.to_string()
}

// ─────────────────────────── Bootstrap & settings ───────────────────────────

#[tauri::command]
fn bootstrap(state: State<'_, AppState>) -> Bootstrap {
    Bootstrap {
        config: state.config_view(),
        install_id: state.identity.lock().install_id.clone(),
        models: state::model_catalog(),
        efforts: models::effort_catalog(),
        approvals: state::approval_catalog(),
        project: state.project_path().map(|path| ProjectView {
            name: store::project_name(&path),
            path: path.to_string_lossy().to_string(),
        }),
        app_version: env!("CARGO_PKG_VERSION"),
    }
}

#[tauri::command]
fn set_model(state: State<'_, AppState>, model: String) -> CmdResult<config::ConfigView> {
    if models::model_by_id(&model).is_none() {
        return Err(format!("`{model}` is not a known model."));
    }
    Ok(state.update_config(|c| c.model = model))
}

#[tauri::command]
fn set_effort(state: State<'_, AppState>, effort: String) -> CmdResult<config::ConfigView> {
    let parsed = Effort::from_id(&effort).ok_or_else(|| format!("`{effort}` is not a known effort."))?;
    Ok(state.update_config(|c| c.effort = parsed))
}

#[tauri::command]
fn set_approval(state: State<'_, AppState>, approval: String) -> CmdResult<config::ConfigView> {
    let parsed = ApprovalPolicy::from_id(&approval)
        .ok_or_else(|| format!("`{approval}` is not a known approval mode."))?;
    Ok(state.update_config(|c| c.approval = parsed))
}

#[tauri::command]
fn set_api_base_url(state: State<'_, AppState>, url: String) -> config::ConfigView {
    state.update_config(|c| {
        let trimmed = url.trim();
        c.api_base_url = if trimmed.is_empty() {
            Config::default().api_base_url
        } else {
            trimmed.trim_end_matches('/').to_string()
        };
    })
}

#[tauri::command]
fn open_config_file(app: tauri::AppHandle) -> CmdResult<()> {
    let path = config::config_path();
    if !path.exists() {
        // Write the current settings out so there is something to open.
        Config::load().save().map_err(fail)?;
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(path.to_string_lossy().to_string(), None::<&str>)
        .map_err(fail)
}

// ─────────────────────────── Projects ───────────────────────────

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> CmdResult<Vec<Project>> {
    state.store.list_projects(40).map_err(fail)
}

#[tauri::command]
fn open_project(state: State<'_, AppState>, path: String) -> CmdResult<ProjectView> {
    let resolved = store::normalise_project_path(&path);
    if !resolved.is_dir() {
        return Err(format!("`{}` is not a folder.", resolved.display()));
    }
    state.store.remember_project(&resolved).map_err(fail)?;
    state.set_project(Some(resolved.clone()));
    Ok(ProjectView {
        name: store::project_name(&resolved),
        path: resolved.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn choose_project(app: tauri::AppHandle) -> CmdResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked.map(|p| p.to_string()));
    });
    rx.await.map_err(|_| "The folder picker was dismissed.".to_string())
}

#[tauri::command]
fn forget_project(state: State<'_, AppState>, path: String) -> CmdResult<()> {
    state.store.forget_project(&path).map_err(fail)
}

#[tauri::command]
fn close_project(state: State<'_, AppState>) {
    state.set_project(None);
}

// ─────────────────────────── Threads ───────────────────────────

#[tauri::command]
fn list_threads(state: State<'_, AppState>) -> CmdResult<Vec<Thread>> {
    state.store.list_threads(200).map_err(fail)
}

#[tauri::command]
fn create_thread(state: State<'_, AppState>) -> CmdResult<Thread> {
    let project = state.project_path().map(|p| p.to_string_lossy().to_string());
    state.store.create_thread(project.as_deref()).map_err(fail)
}

#[tauri::command]
fn get_thread(state: State<'_, AppState>, thread_id: String) -> CmdResult<Vec<StoredMessage>> {
    state.store.list_messages(&thread_id).map_err(fail)
}

#[tauri::command]
fn delete_thread(state: State<'_, AppState>, thread_id: String) -> CmdResult<()> {
    state.cancel_turn(&thread_id);
    state.store.delete_thread(&thread_id).map_err(fail)
}

#[tauri::command]
fn rename_thread(state: State<'_, AppState>, thread_id: String, title: String) -> CmdResult<()> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A thread needs a title.".into());
    }
    state
        .store
        .rename_thread(&thread_id, &title.chars().take(120).collect::<String>())
        .map_err(fail)
}

// ─────────────────────────── Skills & plugins ───────────────────────────

#[tauri::command]
fn list_skills(state: State<'_, AppState>) -> Vec<skills::Skill> {
    skills::list(&state.config_snapshot().disabled_skills)
}

#[tauri::command]
fn set_skill_enabled(state: State<'_, AppState>, slug: String, enabled: bool) -> Vec<skills::Skill> {
    state.update_config(|c| toggle(&mut c.disabled_skills, &slug, enabled));
    skills::list(&state.config_snapshot().disabled_skills)
}

#[tauri::command]
fn open_skills_folder(app: tauri::AppHandle) -> CmdResult<()> {
    let dir = skills::skills_dir();
    std::fs::create_dir_all(&dir).map_err(fail)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(fail)
}

#[tauri::command]
async fn list_plugins(
    state: State<'_, AppState>,
    search: Option<String>,
) -> CmdResult<Vec<plugins::Plugin>> {
    let (client, disabled) = {
        let cfg = state.config_snapshot();
        (state.composio(), cfg.disabled_plugins.clone())
    };
    Ok(plugins::catalog(client.as_ref(), search.as_deref(), &disabled).await)
}

#[tauri::command]
fn set_plugin_enabled(state: State<'_, AppState>, slug: String, enabled: bool) -> config::ConfigView {
    state.update_config(|c| toggle(&mut c.disabled_plugins, &slug, enabled))
}

/// Start a connector's OAuth flow and open the hosted page in the browser.
#[tauri::command]
async fn connect_plugin(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    slug: String,
) -> CmdResult<String> {
    let client = state
        .composio()
        .ok_or_else(|| "Connectors are unavailable.".to_string())?;

    let initiated = client.initiate_connection(&slug).await.map_err(fail)?;

    if initiated.redirect_url.is_empty() {
        // No-auth toolkits connect immediately and have nothing to visit.
        return Ok(String::new());
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(initiated.redirect_url.clone(), None::<&str>)
        .map_err(fail)?;
    Ok(initiated.redirect_url)
}

#[tauri::command]
async fn disconnect_plugin(state: State<'_, AppState>, slug: String) -> CmdResult<()> {
    let Some(client) = state.composio() else { return Ok(()) };

    let connections = client.list_connections().await.map_err(fail)?;
    for connection in connections.iter().filter(|c| c.toolkit_slug == slug) {
        client.delete_connection(&connection.id).await.map_err(fail)?;
    }
    Ok(())
}

fn toggle(list: &mut Vec<String>, slug: &str, enabled: bool) {
    if enabled {
        list.retain(|s| s != slug);
    } else if !list.iter().any(|s| s == slug) {
        list.push(slug.to_string());
    }
}

// ─────────────────────────── Turns ───────────────────────────

#[tauri::command]
fn respond_to_approval(state: State<'_, AppState>, id: String, allow: bool) -> bool {
    state.pending.resolve(&id, allow)
}

#[tauri::command]
fn cancel_turn(state: State<'_, AppState>, thread_id: String) -> bool {
    state.cancel_turn(&thread_id)
}

#[tauri::command]
fn send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    text: String,
) -> CmdResult<StoredMessage> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Nothing to send.".into());
    }
    if state.is_running(&thread_id) {
        return Err("This thread is already working. Stop it first.".into());
    }
    let cfg = state.config_snapshot();
    agent::readiness(&cfg)?;

    // Persist the user's message before anything can fail, so it is never lost.
    let user_message = state
        .store
        .add_message(&thread_id, "user", &text, &serde_json::json!({}))
        .map_err(fail)?;

    let cancel = state.begin_turn(&thread_id);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_turn_task(handle, thread_id, text, cancel).await;
    });

    Ok(user_message)
}

/// The whole background half of a turn. Any early return still emits a
/// terminal event first — the UI has no other way to learn the turn ended.
async fn run_turn_task(app: tauri::AppHandle, thread_id: String, text: String, cancel: Cancel) {
    let state = app.state::<AppState>();
    let message_id = uuid::Uuid::new_v4().to_string();
    let sink = event_sink(&app);

    let finish = |state: &AppState| state.end_turn(&thread_id);

    let llm = match state.llm() {
        Ok(llm) => llm,
        Err(err) => {
            sink(AgentEvent::TurnFailed {
                thread_id: thread_id.clone(),
                message_id,
                error: err.to_string(),
            });
            finish(&state);
            return;
        }
    };

    let cfg = state.config_snapshot();
    let project = state.project_path();

    // Connectors, when configured. A failure here is silent by design.
    let composio_tools = match state.composio() {
        Some(client) => composio::ComposioTools::load(client, &cfg.disabled_plugins).await,
        None => None,
    };
    let connected_apps: Vec<String> = composio_tools
        .as_ref()
        .map(|t| t.apps().to_vec())
        .unwrap_or_default();

    let approver = Approver::Interactive(Arc::new(InteractiveApprover {
        pending: state.pending.clone(),
        thread_id: thread_id.clone(),
        emit: {
            let app = app.clone();
            Box::new(move |prompt| {
                let _ = app.emit("approval-request", &prompt);
            })
        },
    }));

    // Switched-off built-ins drop their tools for the whole turn; the group
    // set is derived inside `tool_context` from the same disabled list the
    // Plugins page writes.
    let tool_ctx = agent::tool_context(
        &cfg,
        project.as_deref(),
        approver,
        state.http.clone(),
        composio_tools,
    );

    let skills = skills::list(&cfg.disabled_skills);
    let project_name = project.as_deref().map(store::project_name);
    let history = load_history(&state, &thread_id);

    let output = agent::run_turn(
        agent::AgentDeps {
            llm: &llm,
            tools: &tool_ctx,
            config: &cfg,
            project_root: project.as_deref(),
            project_name: project_name.as_deref(),
            skills: &skills,
            connected_apps: &connected_apps,
        },
        agent::TurnRequest {
            thread_id: thread_id.clone(),
            message_id: message_id.clone(),
            user_message: text.clone(),
            history,
        },
        sink,
        cancel,
    )
    .await;

    // Persist whatever was produced, including a partial answer from a
    // cancelled turn — losing the user's work because they pressed Stop would
    // be worse than keeping a half-finished message.
    if !output.content.trim().is_empty() {
        let message = StoredMessage {
            id: message_id,
            thread_id: thread_id.clone(),
            role: "assistant".into(),
            content: output.content.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            meta: serde_json::json!({
                "usage": output.usage,
                "steps": output.steps,
                "cancelled": output.cancelled,
                "hit_step_limit": output.hit_step_limit,
            }),
        };
        if let Err(err) = state.store.upsert_message(&message) {
            tracing::error!(%err, "could not persist the assistant message");
        }
    }

    // Name the thread from its first exchange.
    if let Ok(Some(thread)) = state.store.get_thread(&thread_id) {
        if thread.title == "New thread" {
            let title = agent::generate_title(&llm, &text).await;
            if state.store.rename_thread(&thread_id, &title).is_ok() {
                let _ = app.emit("thread-renamed", serde_json::json!({
                    "thread_id": thread_id, "title": title,
                }));
            }
        }
    }

    finish(&state);
}

/// Rebuild the model-facing history from the stored transcript.
fn load_history(state: &AppState, thread_id: &str) -> Vec<llm::ChatMessage> {
    let stored = state.store.list_messages(thread_id).unwrap_or_default();
    stored
        .iter()
        // The message just added is passed separately as the request.
        .take(stored.len().saturating_sub(1))
        .filter(|m| !m.content.trim().is_empty())
        .map(|m| llm::ChatMessage {
            role: m.role.clone(),
            content: Some(m.content.clone()),
            ..Default::default()
        })
        .collect()
}

fn event_sink(app: &tauri::AppHandle) -> EventSink {
    let app = app.clone();
    Arc::new(move |event: AgentEvent| {
        if let Err(err) = app.emit(EVENT_CHANNEL, &event) {
            tracing::warn!(%err, "could not emit an agent event");
        }
    })
}

// ─────────────────────────── Entry point ───────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tripplet_computer_lib=info,warn".into()),
        )
        .init();

    let config = Config::load();
    // A database that will not open is fatal — without it there are no threads
    // and nothing to show — but say so in plain language rather than panicking
    // with a backtrace.
    let store = match store::Store::open_default() {
        Ok(store) => store,
        Err(err) => {
            eprintln!("Tripplet Computer could not open its database: {err}");
            std::process::exit(1);
        }
    };
    let state = match AppState::new(config, store) {
        Ok(state) => state,
        Err(err) => {
            eprintln!("Tripplet Computer could not start: {err}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            set_model,
            set_effort,
            set_approval,
            set_api_base_url,
            open_config_file,
            list_projects,
            open_project,
            choose_project,
            forget_project,
            close_project,
            list_threads,
            create_thread,
            get_thread,
            delete_thread,
            rename_thread,
            list_skills,
            set_skill_enabled,
            open_skills_folder,
            list_plugins,
            set_plugin_enabled,
            connect_plugin,
            disconnect_plugin,
            respond_to_approval,
            cancel_turn,
            send_message,
        ])
        .on_window_event(|window, event| {
            // Closing the window must not leave a fleet of subagents running.
            if let tauri::WindowEvent::Destroyed = event {
                window.app_handle().state::<AppState>().cancel_all();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tripplet Computer");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggling_adds_and_removes_without_duplicating() {
        let mut list = Vec::new();
        toggle(&mut list, "files", false);
        toggle(&mut list, "files", false);
        assert_eq!(list, vec!["files".to_string()], "disabling twice must not duplicate");

        toggle(&mut list, "files", true);
        assert!(list.is_empty());

        toggle(&mut list, "files", true);
        assert!(list.is_empty(), "enabling something already enabled is a no-op");
    }

    #[test]
    fn history_excludes_the_message_being_answered() {
        let state = AppState::new(Config::default(), store::Store::open_in_memory().unwrap()).unwrap();
        let thread = state.store.create_thread(None).unwrap();
        state.store.add_message(&thread.id, "user", "first", &serde_json::json!({})).unwrap();
        state.store.add_message(&thread.id, "assistant", "reply", &serde_json::json!({})).unwrap();
        state.store.add_message(&thread.id, "user", "second", &serde_json::json!({})).unwrap();

        let history = load_history(&state, &thread.id);
        let contents: Vec<&str> = history.iter().filter_map(|m| m.content.as_deref()).collect();
        assert_eq!(
            contents,
            vec!["first", "reply"],
            "the newest message is sent as the request, not as history"
        );
    }

    #[test]
    fn history_of_a_fresh_thread_is_empty() {
        let state = AppState::new(Config::default(), store::Store::open_in_memory().unwrap()).unwrap();
        let thread = state.store.create_thread(None).unwrap();
        assert!(load_history(&state, &thread.id).is_empty());
        state.store.add_message(&thread.id, "user", "only", &serde_json::json!({})).unwrap();
        assert!(load_history(&state, &thread.id).is_empty());
    }
}
