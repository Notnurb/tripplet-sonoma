//! The tool loop.
//!
//! One function drives both the foreground agent and every subagent: call the
//! model, run whatever tools it asked for, feed the results back, repeat until
//! it stops asking. Subagents differ only in their [`ToolContext`] (read-only)
//! and in passing no event sink, so nothing they do reaches the UI.
//!
//! The loop is bounded on three axes — steps, cancellation, and the model's
//! own `finish_reason` — and every exit is a normal return rather than an
//! error, so the caller always gets whatever text was produced.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use anyhow::Result;

use super::events::{AgentEvent, EventSink};
use crate::llm::{ChatMessage, CompletionRequest, Delta, LlmClient, ToolCall, Usage};
use crate::tools::{self, ToolContext};

/// Cooperative cancellation. Checked between steps and between tool calls, so
/// a Stop press lands within one tool rather than at the end of the turn.
#[derive(Clone, Default)]
pub struct Cancel(Arc<AtomicBool>);

impl Cancel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub struct TurnConfig {
    pub system: String,
    /// Prior conversation plus the new user message. The system prompt is
    /// prepended here, not by the caller.
    pub history: Vec<ChatMessage>,
    /// Upstream model name, already resolved from a persona id.
    pub model: String,
    pub temperature: f32,
    pub max_tokens: u32,
    pub max_steps: u32,
}

#[derive(Debug, Default)]
pub struct TurnOutput {
    pub content: String,
    pub reasoning: String,
    pub usage: Usage,
    pub steps: u32,
    /// True when the loop stopped because it ran out of steps rather than
    /// because the model was finished.
    pub hit_step_limit: bool,
    pub cancelled: bool,
    /// The full message list including everything the loop appended, so a
    /// caller can persist the real transcript.
    pub messages: Vec<ChatMessage>,
}

pub async fn run(
    llm: &LlmClient,
    ctx: &ToolContext,
    cfg: TurnConfig,
    message_id: &str,
    sink: Option<EventSink>,
    cancel: &Cancel,
) -> Result<TurnOutput> {
    let mut messages = Vec::with_capacity(cfg.history.len() + 8);
    messages.push(ChatMessage::system(cfg.system));
    messages.extend(cfg.history);

    let defs = tools::all_defs(ctx);
    let mut out = TurnOutput::default();

    for step in 0..cfg.max_steps {
        if cancel.is_cancelled() {
            out.cancelled = true;
            break;
        }
        out.steps = step + 1;

        let emit = sink.clone();
        let mid = message_id.to_string();
        let result = llm
            .stream(
                CompletionRequest {
                    model: cfg.model.clone(),
                    messages: messages.clone(),
                    tools: defs.clone(),
                    temperature: cfg.temperature,
                    max_tokens: cfg.max_tokens,
                },
                move |delta| {
                    let Some(sink) = emit.as_ref() else { return };
                    match delta {
                        Delta::Content(text) => {
                            sink(AgentEvent::Content { message_id: mid.clone(), delta: text })
                        }
                        Delta::Reasoning(text) => {
                            sink(AgentEvent::Reasoning { message_id: mid.clone(), delta: text })
                        }
                        Delta::ToolCallStarted { id, name } => sink(AgentEvent::ToolStarted {
                            message_id: mid.clone(),
                            call_id: id,
                            label: pending_label(&name),
                            name,
                        }),
                    }
                },
            )
            .await?;

        out.usage.prompt_tokens += result.usage.prompt_tokens;
        out.usage.completion_tokens += result.usage.completion_tokens;
        out.usage.total_tokens += result.usage.total_tokens;
        if !result.reasoning.is_empty() {
            out.reasoning.push_str(&result.reasoning);
        }

        if result.tool_calls.is_empty() {
            // The model is done talking — this is the normal exit.
            out.content = result.content;
            messages.push(ChatMessage::assistant(out.content.clone()));
            out.messages = messages;
            return Ok(out);
        }

        // Keep whatever prose accompanied the tool calls; some models narrate
        // their plan in the same turn they call a tool, and dropping it loses
        // the only explanation the user gets.
        if !result.content.trim().is_empty() {
            out.content = result.content.clone();
        }
        messages.push(ChatMessage::assistant_tool_calls(
            result.content,
            result.tool_calls.clone(),
        ));

        for call in &result.tool_calls {
            if cancel.is_cancelled() {
                out.cancelled = true;
                out.messages = messages;
                return Ok(out);
            }
            let outcome = tools::execute(ctx, call).await;
            if let Some(sink) = sink.as_ref() {
                sink(AgentEvent::ToolFinished {
                    message_id: message_id.to_string(),
                    call_id: call.id.clone(),
                    ok: outcome.ok,
                    summary: outcome.summary.clone(),
                });
            }
            messages.push(ChatMessage::tool_result(
                call.id.clone(),
                call.function_name(),
                outcome.body,
            ));
        }
    }

    if !out.cancelled {
        out.hit_step_limit = true;
        if let Some(sink) = sink.as_ref() {
            sink(AgentEvent::StepLimit { message_id: message_id.to_string(), steps: out.steps });
        }
        // Give the caller something to show rather than an empty bubble.
        if out.content.trim().is_empty() {
            out.content = format!(
                "I stopped after {} tool steps without reaching a conclusion. \
                 Tell me which part to focus on and I'll continue from here.",
                out.steps
            );
        }
    }

    out.messages = messages;
    Ok(out)
}

/// Present-tense label shown the moment a tool call starts, before its
/// arguments have finished streaming.
fn pending_label(name: &str) -> String {
    match name {
        "read_file" => "Reading a file".into(),
        "write_file" => "Writing a file".into(),
        "edit_file" => "Editing a file".into(),
        "list_dir" => "Listing a directory".into(),
        "search_files" => "Searching the project".into(),
        "run_command" => "Running a command".into(),
        "fetch_url" => "Fetching a page".into(),
        "web_search" => "Searching the web".into(),
        other => match other.strip_prefix(crate::composio::TOOL_PREFIX) {
            Some(slug) => format!("Using {}", crate::composio::display_app(slug)),
            None => format!("Running {other}"),
        },
    }
}

/// Trim a conversation to fit a budget, oldest first, always keeping the most
/// recent exchanges. Tool results are the first thing to go — they are the
/// bulkiest and the least useful once acted on.
pub fn trim_history(messages: Vec<ChatMessage>, max_chars: usize) -> Vec<ChatMessage> {
    let size = |m: &ChatMessage| m.content.as_deref().map(str::len).unwrap_or(0) + 32;
    let total: usize = messages.iter().map(size).sum();
    if total <= max_chars {
        return messages;
    }

    // Walk backwards keeping messages until the budget is spent, then restore
    // chronological order.
    let mut kept: Vec<ChatMessage> = Vec::new();
    let mut used = 0usize;
    for msg in messages.into_iter().rev() {
        let cost = size(&msg);
        if used + cost > max_chars && !kept.is_empty() {
            continue;
        }
        used += cost;
        kept.push(msg);
    }
    kept.reverse();

    // A `tool` message whose originating assistant turn was trimmed away is
    // rejected by OpenAI-compatible backends; drop any orphans.
    let mut out: Vec<ChatMessage> = Vec::with_capacity(kept.len());
    for msg in kept {
        if msg.role == "tool" {
            let has_parent = out.iter().any(|m| {
                m.tool_calls
                    .as_ref()
                    .is_some_and(|calls| calls.iter().any(|c| Some(&c.id) == msg.tool_call_id.as_ref()))
            });
            if !has_parent {
                continue;
            }
        }
        out.push(msg);
    }
    out
}

/// Strip tool-call plumbing from a transcript, leaving the readable exchange.
pub fn readable_history(messages: &[ChatMessage]) -> Vec<ChatMessage> {
    messages
        .iter()
        .filter(|m| m.role != "tool" && m.tool_calls.is_none())
        .filter(|m| m.content.as_deref().is_some_and(|c| !c.trim().is_empty()))
        .cloned()
        .collect()
}

/// Summarise a set of tool calls for a one-line activity label.
pub fn describe_calls(calls: &[ToolCall]) -> String {
    match calls.len() {
        0 => String::new(),
        1 => pending_label(calls[0].function_name()),
        n => format!("Running {n} tools"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::{FunctionCall, ToolCall};

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage { role: role.into(), content: Some(content.into()), ..Default::default() }
    }

    #[test]
    fn cancel_is_observable_across_clones() {
        let a = Cancel::new();
        let b = a.clone();
        assert!(!b.is_cancelled());
        a.cancel();
        assert!(b.is_cancelled(), "cancellation must be shared, not copied");
    }

    #[test]
    fn pending_labels_are_human_readable() {
        assert_eq!(pending_label("read_file"), "Reading a file");
        assert_eq!(pending_label("run_command"), "Running a command");
        assert_eq!(pending_label("composio_GITHUB_GET_REPO"), "Using Github");
        assert_eq!(pending_label("mystery_tool"), "Running mystery_tool");
    }

    #[test]
    fn a_short_history_is_returned_untouched() {
        let history = vec![msg("user", "hi"), msg("assistant", "hello")];
        let out = trim_history(history.clone(), 10_000);
        assert_eq!(out.len(), history.len());
    }

    #[test]
    fn trimming_keeps_the_most_recent_messages() {
        let history = vec![
            msg("user", &"old".repeat(100)),
            msg("assistant", &"old".repeat(100)),
            msg("user", "the latest question"),
        ];
        let out = trim_history(history, 400);
        assert_eq!(out.last().unwrap().content.as_deref(), Some("the latest question"));
        assert!(out.len() < 3, "something must have been dropped");
    }

    #[test]
    fn trimming_never_leaves_an_orphan_tool_message() {
        let call = ToolCall {
            id: "call_1".into(),
            kind: "function".into(),
            function: FunctionCall { name: "read_file".into(), arguments: "{}".into() },
        };
        let history = vec![
            msg("user", &"filler".repeat(200)),
            ChatMessage::assistant_tool_calls("working".into(), vec![call.clone()]),
            ChatMessage::tool_result("call_1", "read_file", "x".repeat(300)),
            msg("user", "next"),
        ];
        let out = trim_history(history, 350);
        for m in &out {
            if m.role == "tool" {
                let id = m.tool_call_id.clone().unwrap();
                assert!(
                    out.iter().any(|p| p
                        .tool_calls
                        .as_ref()
                        .is_some_and(|c| c.iter().any(|c| c.id == id))),
                    "orphaned tool result survived trimming"
                );
            }
        }
    }

    #[test]
    fn trimming_always_keeps_at_least_the_last_message() {
        let history = vec![msg("user", &"x".repeat(10_000))];
        let out = trim_history(history, 10);
        assert_eq!(out.len(), 1, "never return an empty conversation");
    }

    #[test]
    fn readable_history_drops_tool_plumbing_and_blanks() {
        let call = ToolCall {
            id: "c1".into(),
            kind: "function".into(),
            function: FunctionCall { name: "read_file".into(), arguments: "{}".into() },
        };
        let messages = vec![
            msg("user", "do it"),
            ChatMessage::assistant_tool_calls(String::new(), vec![call]),
            ChatMessage::tool_result("c1", "read_file", "contents"),
            msg("assistant", "done"),
            msg("assistant", "   "),
        ];
        let out = readable_history(&messages);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].content.as_deref(), Some("do it"));
        assert_eq!(out[1].content.as_deref(), Some("done"));
    }

    #[test]
    fn call_descriptions_collapse_when_parallel() {
        let call = |name: &str| ToolCall {
            id: "c".into(),
            kind: "function".into(),
            function: FunctionCall { name: name.into(), arguments: "{}".into() },
        };
        assert_eq!(describe_calls(&[]), "");
        assert_eq!(describe_calls(&[call("read_file")]), "Reading a file");
        assert_eq!(describe_calls(&[call("read_file"), call("list_dir")]), "Running 2 tools");
    }
}
