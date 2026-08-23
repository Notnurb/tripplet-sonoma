//! The Plugins catalogue.
//!
//! Two kinds share one list. **Built-ins** are the local capability groups —
//! Files, Terminal, Browser — always present, individually switchable, and the
//! reason the app is useful with no accounts connected. **Connectors** are
//! Composio toolkits: installing one runs an OAuth flow in the browser, after
//! which its operations appear as `composio_*` tools.
//!
//! The catalogue degrades cleanly. With no Composio key the connector half is
//! simply absent and the built-ins still list, so the Plugins page is never
//! empty and never an error state.

use serde::{Deserialize, Serialize};

use crate::composio::{ComposioClient, Toolkit};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginKind {
    Builtin,
    Connector,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plugin {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub kind: PluginKind,
    /// Icon key the UI maps to an inline SVG (built-ins) — empty for connectors.
    pub glyph: String,
    /// Remote logo URL (connectors) — empty for built-ins.
    pub logo: String,
    /// Section heading in the catalogue, e.g. "Featured", "Productivity".
    pub category: String,
    /// Built-ins are always installed; connectors once an account is ACTIVE.
    pub installed: bool,
    /// Installed but switched off by the user.
    pub enabled: bool,
    /// Present while a connector's OAuth flow is mid-flight.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connection_status: Option<String>,
}

/// `(slug, name, description, glyph, category)`
const BUILTINS: &[(&str, &str, &str, &str, &str)] = &[
    (
        "files",
        "Files",
        "Read, search, and edit files in your project",
        "file",
        "Built in",
    ),
    (
        "terminal",
        "Terminal",
        "Run builds, tests, and git in your project",
        "terminal",
        "Built in",
    ),
    (
        "browser",
        "Browser",
        "Search the web and read documentation",
        "globe",
        "Built in",
    ),
];

/// Toolkits promoted to the Featured row when Composio is configured. Anything
/// not listed falls into a category derived from Composio's own metadata.
const FEATURED: &[&str] = &["github", "gmail", "slack", "notion", "linear", "googledrive"];

pub fn builtins(disabled: &[String]) -> Vec<Plugin> {
    BUILTINS
        .iter()
        .map(|(slug, name, description, glyph, category)| Plugin {
            slug: (*slug).to_string(),
            name: (*name).to_string(),
            description: (*description).to_string(),
            kind: PluginKind::Builtin,
            glyph: (*glyph).to_string(),
            logo: String::new(),
            category: (*category).to_string(),
            installed: true,
            enabled: !disabled.iter().any(|d| d == slug),
            connection_status: None,
        })
        .collect()
}

/// Whether a built-in capability group is switched on. Unknown slugs default
/// to enabled so a future built-in is not silently off for existing users.
pub fn builtin_enabled(slug: &str, disabled: &[String]) -> bool {
    !disabled.iter().any(|d| d == slug)
}

/// The full catalogue: built-ins, then every Composio toolkit, with the user's
/// live connection state folded in.
pub async fn catalog(
    client: Option<&ComposioClient>,
    search: Option<&str>,
    disabled: &[String],
) -> Vec<Plugin> {
    let mut out = builtins(disabled);

    // Filter built-ins by the search box too — a search for "term" should find
    // Terminal, not just connectors.
    if let Some(query) = search.map(str::trim).filter(|q| !q.is_empty()) {
        let q = query.to_lowercase();
        out.retain(|p| {
            p.name.to_lowercase().contains(&q) || p.description.to_lowercase().contains(&q)
        });
    }

    let Some(client) = client else {
        return out;
    };

    // A connector listing that fails should cost the user the connectors, not
    // the page.
    let toolkits = match client.list_toolkits(search, 60).await {
        Ok(t) => t,
        Err(err) => {
            tracing::warn!(%err, "could not load the Composio catalogue");
            return out;
        }
    };
    let connections = client.list_connections().await.unwrap_or_else(|err| {
        tracing::warn!(%err, "could not load Composio connections");
        Vec::new()
    });

    for toolkit in toolkits {
        let connection = connections.iter().find(|c| c.toolkit_slug == toolkit.slug);
        out.push(Plugin {
            installed: connection.map(|c| c.is_active()).unwrap_or(false),
            enabled: !disabled.iter().any(|d| *d == toolkit.slug),
            connection_status: connection.map(|c| c.status.clone()),
            category: category_for(&toolkit),
            glyph: String::new(),
            logo: toolkit.logo.clone(),
            description: if toolkit.description.is_empty() {
                format!("Work with {} from Tripplet Computer", toolkit.name)
            } else {
                toolkit.description.chars().take(160).collect()
            },
            name: toolkit.name.clone(),
            slug: toolkit.slug.clone(),
            kind: PluginKind::Connector,
        });
    }

    out
}

fn category_for(toolkit: &Toolkit) -> String {
    if FEATURED.contains(&toolkit.slug.to_lowercase().as_str()) {
        return "Featured".into();
    }
    match toolkit.categories.first() {
        Some(c) if !c.is_empty() => title_case(c),
        _ => "Other".into(),
    }
}

fn title_case(input: &str) -> String {
    input
        .split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str().to_lowercase()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Group a flat catalogue into the sections the Plugins page renders.
/// "Built in" leads, then "Featured", then everything else alphabetically.
pub fn group(plugins: Vec<Plugin>) -> Vec<(String, Vec<Plugin>)> {
    let mut sections: std::collections::BTreeMap<String, Vec<Plugin>> = Default::default();
    for plugin in plugins {
        sections.entry(plugin.category.clone()).or_default().push(plugin);
    }

    let mut ordered: Vec<(String, Vec<Plugin>)> = Vec::with_capacity(sections.len());
    for lead in ["Built in", "Featured"] {
        if let Some(items) = sections.remove(lead) {
            ordered.push((lead.to_string(), items));
        }
    }
    ordered.extend(sections);
    ordered
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_are_always_installed() {
        let plugins = builtins(&[]);
        assert_eq!(plugins.len(), BUILTINS.len());
        assert!(plugins.iter().all(|p| p.installed));
        assert!(plugins.iter().all(|p| p.enabled));
        assert!(plugins.iter().all(|p| p.kind == PluginKind::Builtin));
        assert!(plugins.iter().all(|p| !p.glyph.is_empty()));
    }

    #[test]
    fn a_disabled_builtin_stays_installed_but_switches_off() {
        let plugins = builtins(&["terminal".into()]);
        let terminal = plugins.iter().find(|p| p.slug == "terminal").unwrap();
        assert!(terminal.installed, "disabling is not uninstalling");
        assert!(!terminal.enabled);
        assert!(plugins.iter().find(|p| p.slug == "files").unwrap().enabled);
    }

    #[test]
    fn unknown_builtins_default_to_enabled() {
        assert!(builtin_enabled("a-future-builtin", &["terminal".into()]));
        assert!(!builtin_enabled("terminal", &["terminal".into()]));
    }

    #[tokio::test]
    async fn without_composio_the_catalogue_is_the_builtins() {
        let plugins = catalog(None, None, &[]).await;
        assert_eq!(plugins.len(), BUILTINS.len());
        assert!(plugins.iter().all(|p| p.kind == PluginKind::Builtin));
    }

    #[tokio::test]
    async fn search_filters_builtins_too() {
        let plugins = catalog(None, Some("term"), &[]).await;
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].slug, "terminal");

        let none = catalog(None, Some("zzzz"), &[]).await;
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn a_blank_search_is_treated_as_no_search() {
        let plugins = catalog(None, Some("   "), &[]).await;
        assert_eq!(plugins.len(), BUILTINS.len());
    }

    #[test]
    fn featured_toolkits_are_categorised_ahead_of_their_own_tags() {
        let github = Toolkit {
            slug: "github".into(),
            name: "GitHub".into(),
            description: String::new(),
            logo: String::new(),
            categories: vec!["developer-tools".into()],
            no_auth: false,
        };
        assert_eq!(category_for(&github), "Featured");

        let other = Toolkit { slug: "obscure".into(), ..github.clone() };
        assert_eq!(category_for(&other), "Developer Tools");

        let uncategorised = Toolkit { slug: "x".into(), categories: vec![], ..github };
        assert_eq!(category_for(&uncategorised), "Other");
    }

    #[test]
    fn grouping_puts_builtins_first_then_featured() {
        let plugin = |slug: &str, category: &str| Plugin {
            slug: slug.into(),
            name: slug.into(),
            description: String::new(),
            kind: PluginKind::Connector,
            glyph: String::new(),
            logo: String::new(),
            category: category.into(),
            installed: false,
            enabled: true,
            connection_status: None,
        };
        let grouped = group(vec![
            plugin("z", "Productivity"),
            plugin("a", "Featured"),
            plugin("f", "Built in"),
            plugin("m", "Analytics"),
        ]);
        let order: Vec<&str> = grouped.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(order, vec!["Built in", "Featured", "Analytics", "Productivity"]);
    }

    #[test]
    fn grouping_omits_sections_that_have_no_members() {
        let grouped = group(builtins(&[]));
        assert_eq!(grouped.len(), 1);
        assert_eq!(grouped[0].0, "Built in");
        assert!(!grouped.iter().any(|(name, _)| name == "Featured"));
    }

    #[test]
    fn title_case_normalises_composio_category_slugs() {
        assert_eq!(title_case("developer-tools"), "Developer Tools");
        assert_eq!(title_case("CRM"), "Crm");
        assert_eq!(title_case("project_management"), "Project Management");
    }
}
