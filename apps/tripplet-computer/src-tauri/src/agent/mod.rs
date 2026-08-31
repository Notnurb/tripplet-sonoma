//! The agent entry point.
//!
//! [`run_turn`] owns one user turn end to end: it opens with a `turn-started`
//! event, optionally plans and runs a subagent fleet, drives the lead agent's
//! tool loop, and closes with exactly one terminal event. Callers get the
//! result through the sink, not the return value — the Tauri command that
//! invokes this spawns it and returns immediately so the UI never blocks.

pub mod events;
pub mod orchestrator;
pub mod prompt;
pub mod turn;

use std::path::Path;
use std::sync::Arc;

use events::{AgentEvent, EventSink};
use prompt::PromptContext;
use turn::{Cancel, TurnConfig, TurnOutput};

use crate::config::{ApprovalPolicy, Config};
use crate::llm::{ChatMessage, LlmClient};
use crate::models::{self, Effort};
use crate::skills::Skill;
use crate::tools::ToolContext;

/// Total conversation budget handed to the model, in characters. Older turns
/// are trimmed to fit; the fleet block and system prompt sit outside it.
const HISTORY_BUDGET_CHARS: usize = 90_000;

pub struct TurnRequest {
    pub thread_id: String,
    pub message_id: String,
    /// What the user just typed.
    pub user_message: String,
    /// Prior turns, oldest first, excluding the new message.
    pub history: Vec<ChatMessage>,
}

pub struct AgentDeps<'a> {
    pub llm: &'a LlmClient,
    pub tools: &'a ToolContext,
    pub config: &'a Config,
    pub project_root: Option<&'a Path>,
    pub project_name: Option<&'a str>,
    pub skills: &'a [Skill],
    pub connected_apps: &'a [String],
}

/// Run one turn. Never returns an error: every failure path emits a terminal
/// event and returns, because the UI's only signal that a turn ended is that
/// event arriving.
pub async fn run_turn(
    deps: AgentDeps<'_>,
    req: TurnRequest,
    sink: EventSink,
    cancel: Cancel,
) -> TurnOutput {
    let effort = deps.config.effort;
    let model_id = deps.config.model.clone();
    let wire = models::wire_model(&model_id);

    sink(AgentEvent::TurnStarted {
        thread_id: req.thread_id.clone(),
        message_id: req.message_id.clone(),
        model: model_id.clone(),
        model_name: models::model_display_name(&model_id),
        effort: effort.id().to_string(),
        subagents: effort.subagents(),
    });

    let base_prompt = PromptContext {
        model_id: &model_id,
        effort,
        project_root: deps.project_root,
        project_name: deps.project_name,
        approval: deps.config.approval,
        connected_apps: deps.connected_apps,
        skills: deps.skills,
        read_only: false,
    };

    // ── Fan out, when the tier calls for it ──
    let fleet_block = if effort.subagents() > 0 && !cancel.is_cancelled() {
        let tasks = orchestrator::plan(deps.llm, &req.user_message, effort.subagents()).await;
        if tasks.is_empty() {
            String::new()
        } else {
            sink(AgentEvent::FleetPlanned {
                message_id: req.message_id.clone(),
                tasks: tasks.clone(),
            });
            let findings = orchestrator::run_fleet(
                deps.llm,
                deps.tools,
                &base_prompt,
                &tasks,
                &req.user_message,
                wire,
                effort,
                &req.message_id,
                Some(sink.clone()),
                &cancel,
            )
            .await;
            orchestrator::synthesise(&findings)
        }
    } else {
        String::new()
    };

    if cancel.is_cancelled() {
        sink(AgentEvent::TurnCancelled {
            thread_id: req.thread_id.clone(),
            message_id: req.message_id.clone(),
        });
        return TurnOutput { cancelled: true, ..Default::default() };
    }

    // ── Lead agent ──
    let mut history = turn::trim_history(req.history, HISTORY_BUDGET_CHARS);
    // The fleet's report goes in as its own user-role message immediately
    // before the request, so it reads as context the user supplied rather than
    // as something the assistant claimed to have already done.
    if !fleet_block.is_empty() {
        history.push(ChatMessage::user(fleet_block));
    }
    history.push(ChatMessage::user(req.user_message.clone()));

    let system = prompt::build(&base_prompt);

    let result = turn::run(
        deps.llm,
        deps.tools,
        TurnConfig {
            system,
            history,
            model: wire.to_string(),
            temperature: effort.temperature(),
            max_tokens: effort.max_tokens(),
            max_steps: effort.max_steps(),
        },
        &req.message_id,
        Some(sink.clone()),
        &cancel,
    )
    .await;

    match result {
        Ok(out) if out.cancelled => {
            sink(AgentEvent::TurnCancelled {
                thread_id: req.thread_id.clone(),
                message_id: req.message_id.clone(),
            });
            out
        }
        Ok(out) => {
            sink(AgentEvent::TurnFinished {
                thread_id: req.thread_id.clone(),
                message_id: req.message_id.clone(),
                content: out.content.clone(),
                usage: out.usage.clone(),
            });
            out
        }
        Err(err) => {
            sink(AgentEvent::TurnFailed {
                thread_id: req.thread_id.clone(),
                message_id: req.message_id.clone(),
                error: friendly_error(&err),
            });
            TurnOutput::default()
        }
    }
}

/// Turn an internal error into something a user can act on.
fn friendly_error(err: &anyhow::Error) -> String {
    let text = err.to_string();
    if text.contains("refused to register") {
        return text.chars().take(300).collect();
    }
    if text.contains("Rate limited") {
        return "Rate limited by the model gateway. Try again in a moment.".into();
    }
    if text.contains("could not reach") || text.contains("dns") || text.contains("connect") {
        return "Could not reach the model gateway. Check your network connection.".into();
    }
    text.chars().take(300).collect()
}

/// Generate a short thread title from the opening exchange. Best-effort: a
/// failure just leaves the thread named after its first line.
pub async fn generate_title(llm: &LlmClient, user_message: &str) -> String {
    let fallback = || -> String {
        let line = user_message
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("New thread");
        let trimmed: String = line.chars().take(48).collect();
        if trimmed.len() < line.len() {
            format!("{trimmed}…")
        } else {
            trimmed
        }
    };

    let result = llm
        .complete(crate::llm::CompletionRequest {
            model: models::UTILITY_MODEL.to_string(),
            messages: vec![ChatMessage::user(format!(
                "Write a title of at most six words for a work session that starts with the message \
                 below. Reply with the title only — no quotes, no punctuation at the end.\n\n{user_message}"
            ))],
            tools: vec![],
            temperature: 0.3,
            max_tokens: 24,
        })
        .await;

    match result {
        Ok(out) => {
            let title: String = out
                .content
                .trim()
                .trim_matches(['"', '\'', '.'])
                .chars()
                .take(60)
                .collect();
            if title.is_empty() {
                fallback()
            } else {
                title
            }
        }
        Err(_) => fallback(),
    }
}

/// Build the tool context for a turn from the current config.
pub fn tool_context(
    config: &Config,
    project_root: Option<&Path>,
    approver: crate::approver::Approver,
    http: reqwest::Client,
    composio: Option<Arc<crate::composio::ComposioTools>>,
) -> ToolContext {
    ToolContext {
        project_root: project_root.map(Path::to_path_buf),
        policy: config.approval,
        permissions: config.permissions.clone(),
        approver,
        http,
        composio,
        read_only: false,
        groups: crate::tools::ToolGroups::from_disabled(&config.disabled_plugins),
    }
}

/// Effort tiers whose extra cost is only justified with a real task in hand.
pub fn is_fan_out(effort: Effort) -> bool {
    effort.subagents() > 0
}

/// Whether the current settings can actually run a turn.
///
/// There is no key to check any more — the install registers itself on first
/// use, and a registration failure surfaces as a turn error with a real
/// explanation rather than being pre-empted here.
pub fn readiness(config: &Config) -> Result<(), String> {
    if models::model_by_id(&config.model).is_none() {
        return Err(format!("`{}` is not a known model.", config.model));
    }
    if config.approval == ApprovalPolicy::Custom && config.permissions.allow_commands.is_empty() {
        // Not fatal — just worth knowing the agent will prompt constantly.
        tracing::info!("custom approval policy with no command allow-list — expect frequent prompts");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A client pointed at an unroutable host, so every call fails fast and
    /// the fallback paths are what get exercised.
    fn test_llm() -> LlmClient {
        let identity = std::sync::Arc::new(parking_lot::Mutex::new(
            crate::attest::Identity::load_or_create().unwrap(),
        ));
        LlmClient::new(crate::gateway::Gateway::new(
            reqwest::Client::new(),
            "https://example.invalid/api/computer",
            identity,
        ))
    }

    #[test]
    fn fan_out_tiers_are_exactly_the_ones_with_subagents() {
        assert!(!is_fan_out(Effort::Low));
        assert!(!is_fan_out(Effort::Medium));
        assert!(!is_fan_out(Effort::High));
        assert!(is_fan_out(Effort::XHigh));
        assert!(is_fan_out(Effort::Max));
        assert!(is_fan_out(Effort::Ultra));
    }

    #[test]
    fn a_default_config_is_ready_with_no_credentials() {
        assert!(readiness(&Config::default()).is_ok());
    }

    #[test]
    fn readiness_rejects_an_unknown_model() {
        let mut cfg = Config::default();
        cfg.model = "not-a-model".into();
        let err = readiness(&cfg).unwrap_err();
        assert!(err.contains("not-a-model"));
    }

    #[test]
    fn errors_are_rewritten_into_actionable_advice() {
        let cases = [
            ("Rate limited by the model gateway.", "Try again"),
            ("could not reach the model gateway", "network connection"),
        ];
        for (raw, expected) in cases {
            let out = friendly_error(&anyhow::anyhow!(raw.to_string()));
            assert!(out.contains(expected), "{raw} -> {out}");
        }
    }

    #[test]
    fn an_unrecognised_error_is_passed_through_bounded() {
        let out = friendly_error(&anyhow::anyhow!("x".repeat(1_000)));
        assert!(out.chars().count() <= 300);
    }

    #[tokio::test]
    async fn title_generation_falls_back_to_the_first_line() {
        // No API key, so `complete` fails and the fallback runs.
        let llm = test_llm();
        let title = generate_title(&llm, "Fix the login redirect bug\nmore detail here").await;
        assert_eq!(title, "Fix the login redirect bug");
    }

    #[tokio::test]
    async fn the_title_fallback_truncates_a_long_first_line() {
        let llm = test_llm();
        let title = generate_title(&llm, &"word ".repeat(50)).await;
        assert!(title.chars().count() <= 49, "got {} chars", title.chars().count());
        assert!(title.ends_with('…'));
    }

    #[tokio::test]
    async fn the_title_fallback_handles_an_empty_message() {
        let llm = test_llm();
        assert_eq!(generate_title(&llm, "   \n\n  ").await, "New thread");
    }
}
