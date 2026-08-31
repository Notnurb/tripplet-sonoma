//! The event contract between the agent and the webview.
//!
//! Everything the UI knows about a running turn arrives as one of these,
//! emitted on the `agent://event` channel. They are additive and ordered:
//! a `turn-started` opens a turn, any number of deltas and tool events follow,
//! and exactly one terminal event (`turn-finished`, `turn-failed`, or
//! `turn-cancelled`) closes it. The UI relies on that invariant to know when
//! to stop showing a spinner, so every exit path from the loop must emit one.

use serde::Serialize;

use crate::llm::Usage;

/// One subagent's slot in a fan-out fleet.
#[derive(Debug, Clone, Serialize)]
pub struct FleetTask {
    pub id: String,
    /// The lens this subagent was given, e.g. "correctness" or "prior art".
    pub lens: String,
    pub brief: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FleetStatus {
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AgentEvent {
    TurnStarted {
        thread_id: String,
        message_id: String,
        model: String,
        model_name: String,
        effort: String,
        /// Fleet size for this turn; 0 for the single-agent tiers.
        subagents: usize,
    },
    /// A fragment of the model's private reasoning.
    Reasoning {
        message_id: String,
        delta: String,
    },
    /// A fragment of the answer.
    Content {
        message_id: String,
        delta: String,
    },
    ToolStarted {
        message_id: String,
        call_id: String,
        name: String,
        /// Human label for the activity row, e.g. "Reading src/main.rs".
        label: String,
    },
    ToolFinished {
        message_id: String,
        call_id: String,
        ok: bool,
        summary: String,
    },
    /// The Ultra planner has decomposed the task.
    FleetPlanned {
        message_id: String,
        tasks: Vec<FleetTask>,
    },
    FleetProgress {
        message_id: String,
        task_id: String,
        status: FleetStatus,
        note: String,
    },
    FleetDone {
        message_id: String,
        completed: usize,
        failed: usize,
    },
    /// The loop hit its step ceiling and stopped rather than looping forever.
    StepLimit {
        message_id: String,
        steps: u32,
    },
    TurnFinished {
        thread_id: String,
        message_id: String,
        content: String,
        usage: Usage,
    },
    TurnFailed {
        thread_id: String,
        message_id: String,
        error: String,
    },
    TurnCancelled {
        thread_id: String,
        message_id: String,
    },
}

impl AgentEvent {
    /// True for the three events that close a turn. Used by the UI to clear
    /// its "running" state, and asserted in tests so no exit path forgets one.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            AgentEvent::TurnFinished { .. } | AgentEvent::TurnFailed { .. } | AgentEvent::TurnCancelled { .. }
        )
    }
}

/// How the agent hands events out. The Tauri app emits them to the webview;
/// tests collect them in a vector.
pub type EventSink = std::sync::Arc<dyn Fn(AgentEvent) + Send + Sync>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialise_with_a_kebab_case_tag() {
        let ev = AgentEvent::Content { message_id: "m1".into(), delta: "hi".into() };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "content");
        assert_eq!(json["message_id"], "m1");
        assert_eq!(json["delta"], "hi");
    }

    #[test]
    fn exactly_the_three_closers_are_terminal() {
        assert!(AgentEvent::TurnFinished {
            thread_id: "t".into(),
            message_id: "m".into(),
            content: String::new(),
            usage: Usage::default(),
        }
        .is_terminal());
        assert!(AgentEvent::TurnFailed {
            thread_id: "t".into(),
            message_id: "m".into(),
            error: "e".into(),
        }
        .is_terminal());
        assert!(AgentEvent::TurnCancelled { thread_id: "t".into(), message_id: "m".into() }.is_terminal());

        assert!(!AgentEvent::Content { message_id: "m".into(), delta: "x".into() }.is_terminal());
        assert!(!AgentEvent::StepLimit { message_id: "m".into(), steps: 5 }.is_terminal());
    }

    #[test]
    fn fleet_status_serialises_for_the_ui() {
        let ev = AgentEvent::FleetProgress {
            message_id: "m".into(),
            task_id: "t1".into(),
            status: FleetStatus::Done,
            note: "found it".into(),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["type"], "fleet-progress");
        assert_eq!(json["status"], "done");
    }
}
