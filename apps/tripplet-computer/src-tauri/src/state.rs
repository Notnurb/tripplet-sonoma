//! Shared application state and the pieces of turn setup that are worth
//! testing without a Tauri runtime in the way.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::Serialize;

use crate::agent::turn::Cancel;
use crate::approver::PendingApprovals;
use crate::attest::Identity;
use crate::composio::ComposioClient;
use crate::config::{Config, ConfigView};
use crate::gateway::Gateway;
use crate::llm::LlmClient;
use crate::store::Store;

pub struct AppState {
    pub config: Mutex<Config>,
    pub store: Store,
    pub http: reqwest::Client,
    /// This install's signing identity. Shared with every gateway client.
    pub identity: Arc<Mutex<Identity>>,
    pub pending: Arc<PendingApprovals>,
    /// The open project folder, if any.
    pub project: Mutex<Option<PathBuf>>,
    /// In-flight turns, keyed by thread id, so Stop can reach the right one.
    pub running: Mutex<HashMap<String, Cancel>>,
}

impl AppState {
    pub fn new(config: Config, store: Store) -> anyhow::Result<Self> {
        let identity = Arc::new(Mutex::new(Identity::load_or_create()?));
        let http = reqwest::Client::builder()
            .user_agent(concat!("TrippletComputer/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(60))
            // Redirects are followed, but `fetch_url` re-checks the final URL:
            // a public link that redirects into private space must not slip by.
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()?;

        let project = config
            .last_project
            .as_deref()
            .map(crate::store::normalise_project_path)
            // Do not restore a project whose folder has since been deleted.
            .filter(|p| p.is_dir());

        Ok(Self {
            config: Mutex::new(config),
            store,
            http,
            identity,
            pending: Arc::new(PendingApprovals::default()),
            project: Mutex::new(project),
            running: Mutex::new(HashMap::new()),
        })
    }

    pub fn config_snapshot(&self) -> Config {
        self.config.lock().clone()
    }

    pub fn config_view(&self) -> ConfigView {
        ConfigView::from(&*self.config.lock())
    }

    /// Mutate the config and persist it. A failed write is logged, not
    /// propagated — the in-memory change still stands, and losing a setting on
    /// the next launch is a better outcome than a settings toggle that errors.
    pub fn update_config<F: FnOnce(&mut Config)>(&self, f: F) -> ConfigView {
        let mut guard = self.config.lock();
        f(&mut guard);
        if let Err(err) = guard.save() {
            tracing::error!(%err, "could not save config.toml");
        }
        ConfigView::from(&*guard)
    }

    /// A gateway bound to this install's identity and the configured base URL.
    pub fn gateway(&self) -> Gateway {
        let base = self.config.lock().api_base_url.clone();
        Gateway::new(self.http.clone(), base, self.identity.clone())
    }

    pub fn llm(&self) -> anyhow::Result<LlmClient> {
        Ok(LlmClient::new(self.gateway()))
    }

    /// Connectors are always available in principle — the server decides
    /// whether this install may use them, so there is nothing to check here.
    pub fn composio(&self) -> Option<ComposioClient> {
        Some(ComposioClient::new(self.gateway()))
    }

    pub fn project_path(&self) -> Option<PathBuf> {
        self.project.lock().clone()
    }

    pub fn set_project(&self, path: Option<PathBuf>) {
        *self.project.lock() = path.clone();
        self.update_config(|c| {
            c.last_project = path.as_ref().map(|p| p.to_string_lossy().to_string());
        });
    }

    /// Register a turn as running. Returns its cancel handle.
    pub fn begin_turn(&self, thread_id: &str) -> Cancel {
        let cancel = Cancel::new();
        self.running.lock().insert(thread_id.to_string(), cancel.clone());
        cancel
    }

    pub fn end_turn(&self, thread_id: &str) {
        self.running.lock().remove(thread_id);
    }

    pub fn is_running(&self, thread_id: &str) -> bool {
        self.running.lock().contains_key(thread_id)
    }

    /// Stop a turn. Also denies its outstanding approval prompts, so a tool
    /// parked on an answer is released instead of hanging until the timeout.
    pub fn cancel_turn(&self, thread_id: &str) -> bool {
        let cancelled = match self.running.lock().get(thread_id) {
            Some(cancel) => {
                cancel.cancel();
                true
            }
            None => false,
        };
        if cancelled {
            self.pending.deny_all();
        }
        cancelled
    }

    pub fn cancel_all(&self) {
        for cancel in self.running.lock().values() {
            cancel.cancel();
        }
        self.pending.deny_all();
    }
}

/// What the UI needs on launch, in one round trip.
#[derive(Debug, Serialize)]
pub struct Bootstrap {
    pub config: ConfigView,
    pub install_id: String,
    pub models: Vec<ModelView>,
    pub efforts: Vec<crate::models::EffortInfo>,
    pub approvals: Vec<ApprovalView>,
    pub project: Option<ProjectView>,
    pub app_version: &'static str,
}

#[derive(Debug, Serialize)]
pub struct ModelView {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub flagship: bool,
}

#[derive(Debug, Serialize)]
pub struct ApprovalView {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectView {
    pub path: String,
    pub name: String,
}

pub fn model_catalog() -> Vec<ModelView> {
    crate::models::MODELS
        .iter()
        .map(|m| ModelView {
            id: m.id,
            name: m.name,
            description: m.description,
            flagship: m.flagship,
        })
        .collect()
}

pub fn approval_catalog() -> Vec<ApprovalView> {
    use crate::config::ApprovalPolicy::*;
    [AskForApproval, ApproveForMe, Custom]
        .into_iter()
        .map(|p| ApprovalView {
            id: p.id(),
            label: p.label(),
            description: p.description(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Effort;

    fn state() -> AppState {
        AppState::new(Config::default(), Store::open_in_memory().unwrap()).unwrap()
    }

    #[test]
    fn the_model_catalogue_matches_the_four_personas() {
        let models = model_catalog();
        let names: Vec<&str> = models.iter().map(|m| m.name).collect();
        assert_eq!(names, vec!["Suzhou 4", "Majuli 4", "Taipei 4", "Astro 5.1"]);
        assert_eq!(models.iter().filter(|m| m.flagship).count(), 1);
    }

    #[test]
    fn the_effort_catalogue_has_all_six_tiers_in_order() {
        let labels: Vec<&str> = crate::models::effort_catalog().iter().map(|e| e.label).collect();
        assert_eq!(labels, vec!["Low", "Medium", "High", "XHigh", "Max", "Ultra"]);
    }

    #[test]
    fn the_approval_catalogue_matches_the_composer_menu() {
        let approvals = approval_catalog();
        assert_eq!(approvals.len(), 3);
        assert_eq!(approvals[0].label, "Ask for approval");
        assert_eq!(approvals[1].label, "Approve for me");
        assert_eq!(approvals[2].label, "Custom (config.toml)");
    }

    #[test]
    fn a_turn_can_be_started_cancelled_and_cleared() {
        let s = state();
        assert!(!s.is_running("t1"));
        let cancel = s.begin_turn("t1");
        assert!(s.is_running("t1"));
        assert!(!cancel.is_cancelled());

        assert!(s.cancel_turn("t1"));
        assert!(cancel.is_cancelled());

        s.end_turn("t1");
        assert!(!s.is_running("t1"));
    }

    #[test]
    fn cancelling_an_unknown_thread_is_a_no_op() {
        assert!(!state().cancel_turn("nope"));
    }

    #[test]
    fn cancel_all_stops_every_running_turn() {
        let s = state();
        let a = s.begin_turn("a");
        let b = s.begin_turn("b");
        s.cancel_all();
        assert!(a.is_cancelled());
        assert!(b.is_cancelled());
    }

    #[test]
    fn cancelling_releases_any_waiting_approval_prompt() {
        let s = state();
        s.begin_turn("t1");
        let rx = s.pending.register("prompt-1".into());
        s.cancel_turn("t1");
        assert!(s.pending.is_empty(), "a cancelled turn must release its prompts");
        drop(rx);
    }

    #[test]
    fn config_updates_are_visible_through_the_view() {
        let s = state();
        let view = s.update_config(|c| {
            c.model = "taipei-4".into();
            c.effort = Effort::Ultra;
        });
        assert_eq!(view.model, "taipei-4");
        assert_eq!(view.model_name, "Taipei 4");
        assert_eq!(view.effort, "ultra");
        assert_eq!(s.config_snapshot().effort, Effort::Ultra);
    }

    #[test]
    fn the_gateway_carries_this_installs_identity() {
        let s = state();
        let gateway = s.gateway();
        assert!(gateway.install_id().starts_with("ci_"));
        assert_eq!(gateway.install_id(), s.identity.lock().install_id);
    }

    #[test]
    fn connectors_need_no_local_key() {
        // The server owns the Composio credential, so the client always has a
        // usable connector client and the server decides what it may do.
        assert!(state().composio().is_some());
    }

    #[test]
    fn a_last_project_that_no_longer_exists_is_not_restored() {
        let mut config = Config::default();
        config.last_project = Some("/definitely/not/a/real/path".into());
        let s = AppState::new(config, Store::open_in_memory().unwrap()).unwrap();
        assert!(s.project_path().is_none());
    }

    #[test]
    fn an_existing_last_project_is_restored() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = Config::default();
        config.last_project = Some(dir.path().to_string_lossy().to_string());
        let s = AppState::new(config, Store::open_in_memory().unwrap()).unwrap();
        assert!(s.project_path().is_some());
    }

    #[test]
    fn setting_a_project_persists_it_to_config() {
        let s = state();
        let dir = tempfile::tempdir().unwrap();
        s.set_project(Some(dir.path().to_path_buf()));
        assert_eq!(s.project_path().as_deref(), Some(dir.path()));
        assert!(s.config_snapshot().last_project.is_some());

        s.set_project(None);
        assert!(s.project_path().is_none());
        assert!(s.config_snapshot().last_project.is_none());
    }
}
