//! `config.toml` — the app's durable settings, and the source of truth for
//! the "Custom (config.toml)" approval mode shown in the composer.
//!
//! Everything here degrades: a missing file yields defaults, and a *malformed*
//! file also yields defaults rather than refusing to launch. A settings file
//! must never be able to take the app down — the same policy `config.md` has
//! on the web side.
//!
//! This file holds no credentials. The install's signing key lives beside it
//! in `identity.json`; keeping them apart means a user can paste their whole
//! config into a bug report without leaking anything. It is still written
//! `0600`, because `last_project` reveals where someone works.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::{Effort, DEFAULT_MODEL};

/// How tool calls that touch the world outside the project get approved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalPolicy {
    /// Always ask before editing files outside the project or using the network.
    AskForApproval,
    /// Only ask for actions the risk classifier flags as potentially unsafe.
    ApproveForMe,
    /// Use the explicit allow-lists in the `[permissions]` table below.
    Custom,
}

impl Default for ApprovalPolicy {
    fn default() -> Self {
        ApprovalPolicy::ApproveForMe
    }
}

impl ApprovalPolicy {
    pub fn id(self) -> &'static str {
        match self {
            ApprovalPolicy::AskForApproval => "ask-for-approval",
            ApprovalPolicy::ApproveForMe => "approve-for-me",
            ApprovalPolicy::Custom => "custom",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            ApprovalPolicy::AskForApproval => "Ask for approval",
            ApprovalPolicy::ApproveForMe => "Approve for me",
            ApprovalPolicy::Custom => "Custom (config.toml)",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            ApprovalPolicy::AskForApproval => {
                "Always ask to edit external files and use the internet"
            }
            ApprovalPolicy::ApproveForMe => "Only ask for actions detected as potentially unsafe",
            ApprovalPolicy::Custom => "Uses permissions defined in config.toml",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "ask-for-approval" => Some(ApprovalPolicy::AskForApproval),
            "approve-for-me" => Some(ApprovalPolicy::ApproveForMe),
            "custom" => Some(ApprovalPolicy::Custom),
            _ => None,
        }
    }
}

/// Explicit allow-lists consulted only under [`ApprovalPolicy::Custom`].
///
/// An empty list means "nothing is pre-approved in this category", which is
/// the safe reading — a user who selects Custom without writing any rules
/// gets prompted for everything rather than silently getting a blank cheque.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Permissions {
    /// Absolute path prefixes the agent may read without asking.
    #[serde(default)]
    pub allow_read: Vec<String>,
    /// Absolute path prefixes the agent may write without asking.
    #[serde(default)]
    pub allow_write: Vec<String>,
    /// Executable names (argv[0]) runnable without asking, e.g. `git`, `ls`.
    #[serde(default)]
    pub allow_commands: Vec<String>,
    /// Hostnames reachable without asking. `"*"` allows any host.
    #[serde(default)]
    pub allow_hosts: Vec<String>,
    /// Composio tool slugs runnable without asking. `"*"` allows any tool.
    #[serde(default)]
    pub allow_connectors: Vec<String>,
}

impl Permissions {
    /// Prefix match against a list of absolute path prefixes.
    pub fn path_allowed(list: &[String], path: &Path) -> bool {
        list.iter().any(|prefix| {
            let prefix = shellexpand_home(prefix);
            !prefix.as_os_str().is_empty() && path.starts_with(&prefix)
        })
    }

    pub fn command_allowed(&self, program: &str) -> bool {
        self.allow_commands.iter().any(|c| c == "*" || c == program)
    }

    pub fn host_allowed(&self, host: &str) -> bool {
        self.allow_hosts
            .iter()
            .any(|h| h == "*" || h.eq_ignore_ascii_case(host))
    }

    pub fn connector_allowed(&self, slug: &str) -> bool {
        self.allow_connectors
            .iter()
            .any(|s| s == "*" || s.eq_ignore_ascii_case(slug))
    }
}

/// Expand a leading `~` so users can write `~/code` in config.toml.
pub fn shellexpand_home(input: &str) -> PathBuf {
    if let Some(rest) = input.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    if input == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(input)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Persona id — see `models::MODELS`.
    pub model: String,
    pub effort: Effort,
    pub approval: ApprovalPolicy,

    /// Tripplet's gateway. Overridable so a team can point the app at their
    /// own deployment without a rebuild.
    pub api_base_url: String,

    /// Last project the user had open, restored at launch.
    pub last_project: Option<String>,

    /// Built-in plugins the user has switched off, by slug.
    #[serde(default)]
    pub disabled_plugins: Vec<String>,
    /// Skills the user has switched off, by slug.
    #[serde(default)]
    pub disabled_skills: Vec<String>,

    #[serde(default)]
    pub permissions: Permissions,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            model: DEFAULT_MODEL.to_string(),
            effort: Effort::default(),
            approval: ApprovalPolicy::default(),
            api_base_url: default_api_base_url(),
            last_project: None,
            disabled_plugins: Vec::new(),
            disabled_skills: Vec::new(),
            permissions: Permissions::default(),
        }
    }
}

/// Tripplet's own OpenAI-compatible gateway. The app talks to Tripplet, not to
/// a third-party provider — persona ids go up, and the server resolves which
/// upstream model actually serves them.
pub const DEFAULT_API_BASE_URL: &str = "https://tripplet.lol/api/computer";

fn default_api_base_url() -> String {
    std::env::var("TRIPPLET_API_BASE_URL").unwrap_or_else(|_| DEFAULT_API_BASE_URL.to_string())
}

/// `~/Library/Application Support/ai.tripplet.computer`
pub fn data_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".tripplet-computer")
    });
    base.join("ai.tripplet.computer")
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.toml")
}

impl Config {
    /// Read `config.toml`, falling back to defaults on absence *or* on a parse
    /// error. A broken config is logged loudly but never fatal.
    pub fn load() -> Self {
        let path = config_path();
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(err) => {
                if err.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(?path, %err, "could not read config.toml — using defaults");
                }
                return Self::seeded_default();
            }
        };
        match toml::from_str::<Config>(&raw) {
            Ok(mut cfg) => {
                cfg.normalise();
                cfg
            }
            Err(err) => {
                tracing::error!(?path, %err, "config.toml is malformed — using defaults");
                Self::seeded_default()
            }
        }
    }

    fn seeded_default() -> Self {
        let mut cfg = Config::default();
        cfg.normalise();
        cfg
    }

    /// Fill in anything that must exist but can be generated.
    fn normalise(&mut self) {
        if self.api_base_url.trim().is_empty() {
            self.api_base_url = default_api_base_url();
        }
        // Trailing slashes would double up when we join `/chat/completions`.
        while self.api_base_url.ends_with('/') {
            self.api_base_url.pop();
        }
        if crate::models::model_by_id(&self.model).is_none() {
            tracing::warn!(model = %self.model, "unknown model in config — resetting to default");
            self.model = DEFAULT_MODEL.to_string();
        }
    }

    pub fn save(&self) -> anyhow::Result<()> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let body = toml::to_string_pretty(self)?;
        // Write-then-rename so a crash mid-write can't truncate the config, and
        // a unique temp name so concurrent saves cannot clobber each other's.
        let tmp = path.with_extension(format!("toml.{}.tmp", uuid::Uuid::new_v4().simple()));
        std::fs::write(&tmp, body)?;
        restrict_permissions(&tmp)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// The shape the webview sees. There are no user credentials any more — the
/// install identity lives in `identity.json` and never crosses the IPC
/// boundary, not even as a boolean about its contents.
#[derive(Debug, Clone, Serialize)]
pub struct ConfigView {
    pub model: String,
    pub model_name: String,
    pub effort: String,
    pub effort_label: String,
    pub approval: String,
    pub api_base_url: String,
    pub config_path: String,
    pub last_project: Option<String>,
    pub disabled_plugins: Vec<String>,
    pub disabled_skills: Vec<String>,
}

impl From<&Config> for ConfigView {
    fn from(c: &Config) -> Self {
        Self {
            model: c.model.clone(),
            model_name: crate::models::model_display_name(&c.model),
            effort: c.effort.id().to_string(),
            effort_label: c.effort.label().to_string(),
            approval: c.approval.id().to_string(),
            api_base_url: c.api_base_url.clone(),
            config_path: config_path().to_string_lossy().to_string(),
            last_project: c.last_project.clone(),
            disabled_plugins: c.disabled_plugins.clone(),
            disabled_skills: c.disabled_skills.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_toml_falls_back_to_defaults() {
        let parsed = toml::from_str::<Config>("this is not toml at all {{{");
        assert!(parsed.is_err(), "expected the parse itself to fail");
        // `load()` turns that error into defaults; assert the default is sane.
        let cfg = Config::seeded_default();
        assert_eq!(cfg.model, DEFAULT_MODEL);
        assert_eq!(cfg.approval, ApprovalPolicy::ApproveForMe);
    }

    #[test]
    fn partial_toml_keeps_defaults_for_absent_keys() {
        let cfg: Config = toml::from_str(r#"model = "suzhou-4""#).unwrap();
        assert_eq!(cfg.model, "suzhou-4");
        assert_eq!(cfg.effort, Effort::Medium);
        assert_eq!(cfg.approval, ApprovalPolicy::ApproveForMe);
    }

    #[test]
    fn the_config_holds_no_credentials_at_all() {
        // Credentials moved to identity.json. If a secret-shaped field ever
        // reappears here it will land in every pasted bug report.
        let text = toml::to_string_pretty(&Config::seeded_default()).unwrap();
        for forbidden in ["api_key", "secret", "composio_api_key", "token"] {
            assert!(!text.contains(forbidden), "config.toml must not carry `{forbidden}`");
        }
    }

    #[test]
    fn normalise_replaces_unknown_model_and_trims_base_url() {
        let mut cfg: Config = toml::from_str(
            r#"
            model = "not-a-real-model"
            api_base_url = "https://example.test/v1///"
        "#,
        )
        .unwrap();
        cfg.normalise();
        assert_eq!(cfg.model, DEFAULT_MODEL);
        assert_eq!(cfg.api_base_url, "https://example.test/v1");
    }

    #[test]
    fn config_round_trips_through_toml() {
        let mut cfg = Config::seeded_default();
        cfg.model = "taipei-4".into();
        cfg.effort = Effort::Ultra;
        cfg.approval = ApprovalPolicy::Custom;
        cfg.permissions.allow_commands = vec!["git".into()];
        let text = toml::to_string_pretty(&cfg).unwrap();
        let back: Config = toml::from_str(&text).unwrap();
        assert_eq!(back.model, "taipei-4");
        assert_eq!(back.effort, Effort::Ultra);
        assert_eq!(back.approval, ApprovalPolicy::Custom);
        assert!(back.permissions.command_allowed("git"));
        assert!(!back.permissions.command_allowed("rm"));
    }

    #[test]
    fn approval_ids_round_trip() {
        for p in [
            ApprovalPolicy::AskForApproval,
            ApprovalPolicy::ApproveForMe,
            ApprovalPolicy::Custom,
        ] {
            assert_eq!(ApprovalPolicy::from_id(p.id()), Some(p));
        }
    }

    #[test]
    fn empty_permission_lists_allow_nothing() {
        let p = Permissions::default();
        assert!(!p.command_allowed("ls"));
        assert!(!p.host_allowed("example.com"));
        assert!(!p.connector_allowed("GITHUB_CREATE_ISSUE"));
        assert!(!Permissions::path_allowed(&p.allow_read, Path::new("/tmp/x")));
    }

    #[test]
    fn wildcard_permissions_allow_everything_in_their_category() {
        let p = Permissions {
            allow_commands: vec!["*".into()],
            allow_hosts: vec!["*".into()],
            allow_connectors: vec!["*".into()],
            ..Default::default()
        };
        assert!(p.command_allowed("anything"));
        assert!(p.host_allowed("evil.test"));
        assert!(p.connector_allowed("ANY_SLUG"));
    }

    #[test]
    fn the_config_view_exposes_no_credential_fields() {
        let json = serde_json::to_string(&ConfigView::from(&Config::seeded_default())).unwrap();
        for forbidden in ["api_key", "secret", "token", "composio"] {
            assert!(!json.contains(forbidden), "ConfigView must not expose `{forbidden}`");
        }
    }
}
