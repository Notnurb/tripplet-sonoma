//! The runtime side of the approval gate.
//!
//! [`approval`](crate::approval) decides *whether* to ask; this module does
//! the asking. A prompt is a round trip through the webview: the agent emits
//! `approval-request`, the composer renders the sheet, and the user's answer
//! comes back through the `respond_to_approval` command and resolves the
//! oneshot the tool is parked on.
//!
//! Two failure modes are handled deliberately:
//!
//! * If the webview goes away mid-prompt the oneshot sender drops, and a
//!   dropped sender resolves to **deny**. An unanswerable prompt must never
//!   become an implicit yes.
//! * A prompt left sitting for [`APPROVAL_TIMEOUT`] also denies, so a turn the
//!   user has walked away from eventually releases its tool slot instead of
//!   pinning it forever.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tokio::sync::oneshot;

use crate::approval::ActionRequest;

/// How long an unanswered prompt waits before defaulting to deny.
pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(300);

/// Payload sent to the webview when the agent needs a decision.
#[derive(Debug, Clone, Serialize)]
pub struct ApprovalPrompt {
    pub id: String,
    pub thread_id: String,
    #[serde(flatten)]
    pub action: ActionRequest,
}

/// Emits prompts and matches answers back to the tool that is waiting.
#[derive(Default)]
pub struct PendingApprovals {
    waiting: Mutex<HashMap<String, oneshot::Sender<bool>>>,
}

impl PendingApprovals {
    pub fn register(&self, id: String) -> oneshot::Receiver<bool> {
        let (tx, rx) = oneshot::channel();
        self.waiting.lock().insert(id, tx);
        rx
    }

    /// Deliver a user's answer. Returns false when the id is unknown — a
    /// double-click on Allow, or an answer to a turn that was cancelled.
    pub fn resolve(&self, id: &str, allow: bool) -> bool {
        match self.waiting.lock().remove(id) {
            Some(tx) => tx.send(allow).is_ok(),
            None => false,
        }
    }

    pub fn forget(&self, id: &str) {
        self.waiting.lock().remove(id);
    }

    /// Deny every outstanding prompt. Called when a turn is cancelled so no
    /// tool is left parked on an answer that will never come.
    pub fn deny_all(&self) {
        let drained: Vec<_> = self.waiting.lock().drain().map(|(_, tx)| tx).collect();
        for tx in drained {
            let _ = tx.send(false);
        }
    }

    pub fn len(&self) -> usize {
        self.waiting.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// How a tool asks for permission.
#[derive(Clone)]
pub enum Approver {
    /// Answer every prompt the same way without involving a UI. Used by tests
    /// and by subagents, which run under a pre-approved read-only toolset and
    /// never get to ask for more.
    Auto(bool),
    /// Prompt the user through the webview.
    Interactive(Arc<InteractiveApprover>),
}

pub struct InteractiveApprover {
    pub pending: Arc<PendingApprovals>,
    pub thread_id: String,
    /// Emits the `approval-request` event. Boxed rather than holding an
    /// `AppHandle` directly so this module stays testable without a running
    /// Tauri runtime.
    pub emit: Box<dyn Fn(ApprovalPrompt) + Send + Sync>,
}

impl Approver {
    pub fn auto_allow() -> Self {
        Approver::Auto(true)
    }

    pub fn auto_deny() -> Self {
        Approver::Auto(false)
    }

    /// True when no human is behind this approver. A refusal from an automatic
    /// approver is a scope limit, not a decision the user made, and the two
    /// must read differently to the model — telling it "the user declined"
    /// when nobody was asked would be a lie it then repeats to the user.
    pub fn is_automatic(&self) -> bool {
        matches!(self, Approver::Auto(_))
    }

    /// Ask for permission. Resolves to `true` only on an explicit allow.
    pub async fn ask(&self, action: ActionRequest) -> bool {
        match self {
            Approver::Auto(answer) => *answer,
            Approver::Interactive(inner) => {
                let id = uuid::Uuid::new_v4().to_string();
                let rx = inner.pending.register(id.clone());
                (inner.emit)(ApprovalPrompt {
                    id: id.clone(),
                    thread_id: inner.thread_id.clone(),
                    action,
                });
                match tokio::time::timeout(APPROVAL_TIMEOUT, rx).await {
                    // Explicit answer from the user.
                    Ok(Ok(allow)) => allow,
                    // Sender dropped — window closed, or the turn was cancelled.
                    Ok(Err(_)) => false,
                    // Nobody answered in time.
                    Err(_) => {
                        inner.pending.forget(&id);
                        tracing::info!(%id, "approval prompt timed out — denying");
                        false
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approval::{ActionKind, Risk};

    fn action() -> ActionRequest {
        ActionRequest::new(ActionKind::Command, "Run", "ls", "reads only", Risk::Safe)
    }

    #[tokio::test]
    async fn auto_approver_answers_without_a_ui() {
        assert!(Approver::auto_allow().ask(action()).await);
        assert!(!Approver::auto_deny().ask(action()).await);
    }

    #[tokio::test]
    async fn an_explicit_allow_resolves_the_waiting_tool() {
        let pending = Arc::new(PendingApprovals::default());
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured = seen.clone();
        let approver = Approver::Interactive(Arc::new(InteractiveApprover {
            pending: pending.clone(),
            thread_id: "t1".into(),
            emit: Box::new(move |p| captured.lock().push(p.id)),
        }));

        let task = tokio::spawn(async move { approver.ask(action()).await });

        // Wait for the prompt to be registered, then answer it.
        let id = loop {
            if let Some(id) = seen.lock().first().cloned() {
                break id;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        };
        assert!(pending.resolve(&id, true));
        assert!(task.await.unwrap());
        assert!(pending.is_empty(), "resolved prompts must be removed");
    }

    #[tokio::test]
    async fn a_dropped_channel_denies_rather_than_allows() {
        let pending = Arc::new(PendingApprovals::default());
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured = seen.clone();
        let approver = Approver::Interactive(Arc::new(InteractiveApprover {
            pending: pending.clone(),
            thread_id: "t1".into(),
            emit: Box::new(move |p| captured.lock().push(p.id)),
        }));

        let task = tokio::spawn(async move { approver.ask(action()).await });
        loop {
            if !seen.lock().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        // Simulate the window closing mid-prompt.
        pending.deny_all();
        assert!(!task.await.unwrap(), "a lost prompt must deny");
    }

    #[test]
    fn resolving_an_unknown_id_is_a_no_op() {
        let pending = PendingApprovals::default();
        assert!(!pending.resolve("nope", true));
    }

    #[test]
    fn deny_all_clears_the_queue() {
        let pending = PendingApprovals::default();
        let _a = pending.register("a".into());
        let _b = pending.register("b".into());
        assert_eq!(pending.len(), 2);
        pending.deny_all();
        assert!(pending.is_empty());
    }
}
