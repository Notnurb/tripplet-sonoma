//! Connector access, proxied through Tripplet.
//!
//! Composio hosts the OAuth flows and token vault for hundreds of SaaS apps
//! ("toolkits") and exposes each app's operations as LLM-callable tools. The
//! desktop app never talks to Composio directly and holds no Composio key:
//! every call goes to Tripplet over the signed gateway, and the server — which
//! owns the key — scopes the real request to this install.
//!
//! The integration stays optional. If the server reports connectors off, the
//! app degrades to "no connectors" and everything else keeps working.

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Toolkit {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub logo: String,
    pub categories: Vec<String>,
    pub no_auth: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Connection {
    pub id: String,
    pub toolkit_slug: String,
    /// INITIALIZING | INITIATED | ACTIVE | FAILED | EXPIRED | INACTIVE | REVOKED
    pub status: String,
    pub status_reason: Option<String>,
    pub created_at: String,
    pub is_disabled: bool,
}

impl Connection {
    pub fn is_active(&self) -> bool {
        self.status.eq_ignore_ascii_case("ACTIVE") && !self.is_disabled
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Tool {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub toolkit_slug: String,
    /// JSON Schema for the arguments (OpenAI function-parameters shape).
    pub input_parameters: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct InitiatedConnection {
    pub id: String,
    /// Hosted OAuth page to open. Empty for no-auth toolkits.
    pub redirect_url: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct ExecuteResult {
    pub successful: bool,
    pub data: serde_json::Value,
    pub error: Option<String>,
}

/// Connector access, proxied through Tripplet.
///
/// The app holds no Composio credential of its own. Every call goes to
/// Tripplet over the signed gateway, and the server — which owns the Composio
/// API key — performs the real request scoped to this install. That keeps the
/// key off every user's disk and makes connector access revocable per install.
#[derive(Clone)]
pub struct ComposioClient {
    gateway: crate::gateway::Gateway,
}

impl ComposioClient {
    pub fn new(gateway: crate::gateway::Gateway) -> Self {
        Self { gateway }
    }

    async fn call(&self, action: &str, payload: serde_json::Value) -> Result<serde_json::Value> {
        let res = self
            .gateway
            .post(&format!("/composio/{action}"), &payload)
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let raw = res.text().await.unwrap_or_default();
            let detail = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .and_then(|e| e.get("message").or(Some(e)))
                        .and_then(|m| m.as_str().map(str::to_string))
                })
                .unwrap_or_else(|| raw.chars().take(200).collect());
            return Err(if detail.is_empty() {
                anyhow!("Connectors are unavailable ({status})")
            } else {
                anyhow!("Connectors are unavailable: {detail}")
            });
        }

        res.json::<serde_json::Value>()
            .await
            .context("Tripplet returned a malformed connector response")
    }

    /// List available toolkits, most-used first.
    pub async fn list_toolkits(&self, search: Option<&str>, limit: u32) -> Result<Vec<Toolkit>> {
        let body = self
            .call(
                "toolkits",
                serde_json::json!({ "search": search.unwrap_or_default(), "limit": limit }),
            )
            .await?;
        Ok(items(&body).iter().filter_map(parse_toolkit).collect())
    }

    /// Connected accounts for this install.
    pub async fn list_connections(&self) -> Result<Vec<Connection>> {
        let body = self.call("connections", serde_json::json!({})).await?;
        Ok(items(&body)
            .iter()
            .filter_map(parse_connection)
            .filter(|c| !c.id.is_empty())
            .collect())
    }

    pub async fn delete_connection(&self, id: &str) -> Result<()> {
        self.call("disconnect", serde_json::json!({ "connection_id": id })).await?;
        Ok(())
    }

    /// Start connecting a toolkit; returns the hosted OAuth URL to open.
    pub async fn initiate_connection(&self, toolkit_slug: &str) -> Result<InitiatedConnection> {
        let body = self
            .call("connect", serde_json::json!({ "toolkit_slug": toolkit_slug }))
            .await?;
        let id = body
            .get("connected_account_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow!("Tripplet returned no connection id"))?;
        Ok(InitiatedConnection {
            id: id.to_string(),
            redirect_url: body
                .get("redirect_url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            status: "INITIATED".into(),
        })
    }

    /// A toolkit's tools, most-used first.
    pub async fn list_toolkit_tools(&self, toolkit_slug: &str, limit: u32) -> Result<Vec<Tool>> {
        let body = self
            .call(
                "tools",
                serde_json::json!({ "toolkit_slug": toolkit_slug, "limit": limit }),
            )
            .await?;
        Ok(items(&body)
            .iter()
            .filter_map(|t| parse_tool(t, toolkit_slug))
            .collect())
    }

    /// Execute one tool. Tripplet resolves this install's connected account
    /// server-side, which is what enforces scoping.
    pub async fn execute_tool(
        &self,
        tool_slug: &str,
        arguments: &serde_json::Value,
    ) -> Result<ExecuteResult> {
        let body = self
            .call(
                "execute",
                serde_json::json!({ "tool_slug": tool_slug, "arguments": arguments }),
            )
            .await?;
        Ok(ExecuteResult {
            successful: body.get("successful").and_then(|v| v.as_bool()).unwrap_or(false),
            data: body.get("data").cloned().unwrap_or(serde_json::Value::Null),
            error: body
                .get("error")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string),
        })
    }
}

/// `items` array from a proxied response, or empty when absent.
fn items(body: &serde_json::Value) -> Vec<serde_json::Value> {
    body.get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

// ─────────────────────────── Parsing ───────────────────────────

fn str_at(value: &serde_json::Value, path: &[&str]) -> String {
    let mut cursor = value;
    for key in path {
        match cursor.get(key) {
            Some(next) => cursor = next,
            None => return String::new(),
        }
    }
    cursor.as_str().unwrap_or_default().to_string()
}

pub(crate) fn parse_toolkit(value: &serde_json::Value) -> Option<Toolkit> {
    let slug = str_at(value, &["slug"]);
    let name = str_at(value, &["name"]);
    if slug.is_empty() || name.is_empty() {
        return None;
    }
    let categories = value
        .get("meta")
        .and_then(|m| m.get("categories"))
        .and_then(|c| c.as_array())
        .map(|items| {
            items
                .iter()
                .map(|c| match c {
                    serde_json::Value::String(s) => s.clone(),
                    other => str_at(other, &["name"]),
                })
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    Some(Toolkit {
        slug,
        name,
        description: str_at(value, &["meta", "description"]),
        logo: str_at(value, &["meta", "logo"]),
        categories,
        no_auth: value.get("no_auth").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

pub(crate) fn parse_connection(value: &serde_json::Value) -> Option<Connection> {
    let id = str_at(value, &["id"]);
    if id.is_empty() {
        return None;
    }
    let status = str_at(value, &["status"]);
    Some(Connection {
        id,
        toolkit_slug: str_at(value, &["toolkit", "slug"]),
        status: if status.is_empty() { "INITIALIZING".into() } else { status },
        status_reason: value
            .get("status_reason")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        created_at: str_at(value, &["created_at"]),
        is_disabled: value.get("is_disabled").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

pub(crate) fn parse_tool(value: &serde_json::Value, fallback_toolkit: &str) -> Option<Tool> {
    let slug = str_at(value, &["slug"]);
    if slug.is_empty() {
        return None;
    }
    let name = str_at(value, &["name"]);
    let toolkit_slug = str_at(value, &["toolkit", "slug"]);
    let params = value
        .get("input_parameters")
        .filter(|p| p.is_object())
        .cloned()
        .unwrap_or_else(|| serde_json::json!({ "type": "object", "properties": {} }));
    Some(Tool {
        name: if name.is_empty() { slug.clone() } else { name },
        slug,
        description: str_at(value, &["description"]),
        toolkit_slug: if toolkit_slug.is_empty() { fallback_toolkit.to_string() } else { toolkit_slug },
        input_parameters: params,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_toolkit_with_object_categories() {
        let value = serde_json::json!({
            "slug": "github",
            "name": "GitHub",
            "no_auth": false,
            "meta": {
                "description": "Code hosting",
                "logo": "https://cdn.test/gh.png",
                "categories": [{ "name": "developer-tools" }, { "name": "vcs" }]
            }
        });
        let tk = parse_toolkit(&value).unwrap();
        assert_eq!(tk.slug, "github");
        assert_eq!(tk.name, "GitHub");
        assert_eq!(tk.categories, vec!["developer-tools", "vcs"]);
        assert!(!tk.no_auth);
    }

    #[test]
    fn parses_a_toolkit_with_string_categories() {
        let value = serde_json::json!({
            "slug": "gmail", "name": "Gmail",
            "meta": { "categories": ["productivity"] }
        });
        assert_eq!(parse_toolkit(&value).unwrap().categories, vec!["productivity"]);
    }

    #[test]
    fn a_toolkit_without_a_slug_is_dropped() {
        assert!(parse_toolkit(&serde_json::json!({ "name": "Nameless" })).is_none());
        assert!(parse_toolkit(&serde_json::json!({ "slug": "x" })).is_none());
    }

    #[test]
    fn missing_meta_does_not_panic() {
        let tk = parse_toolkit(&serde_json::json!({ "slug": "s", "name": "S" })).unwrap();
        assert_eq!(tk.description, "");
        assert_eq!(tk.logo, "");
        assert!(tk.categories.is_empty());
    }

    #[test]
    fn connection_status_defaults_and_active_check() {
        let c = parse_connection(&serde_json::json!({
            "id": "c1", "status": "ACTIVE",
            "toolkit": { "slug": "github" }, "is_disabled": false
        }))
        .unwrap();
        assert!(c.is_active());
        assert_eq!(c.toolkit_slug, "github");

        let disabled = parse_connection(&serde_json::json!({
            "id": "c2", "status": "ACTIVE",
            "toolkit": { "slug": "gmail" }, "is_disabled": true
        }))
        .unwrap();
        assert!(!disabled.is_active(), "a disabled connection is not active");

        let pending = parse_connection(&serde_json::json!({ "id": "c3" })).unwrap();
        assert_eq!(pending.status, "INITIALIZING");
        assert!(!pending.is_active());
    }

    #[test]
    fn a_connection_carries_no_upstream_account_identifier() {
        // Scoping is the install identity now; nothing account-shaped from
        // Composio should be modelled here at all.
        let c = parse_connection(&serde_json::json!({
            "id": "c1", "user_id": "secret-user", "toolkit": { "slug": "x" }
        }))
        .unwrap();
        let json = serde_json::to_string(&c).unwrap();
        assert!(!json.contains("secret-user"));
        assert!(!json.contains("user_id"));
    }

    #[test]
    fn tool_parsing_falls_back_for_missing_fields() {
        let t = parse_tool(&serde_json::json!({ "slug": "GITHUB_GET_REPO" }), "github").unwrap();
        assert_eq!(t.name, "GITHUB_GET_REPO", "name falls back to the slug");
        assert_eq!(t.toolkit_slug, "github");
        assert_eq!(t.input_parameters["type"], "object");
    }

    #[test]
    fn a_non_object_schema_is_replaced_with_an_empty_one() {
        let t = parse_tool(
            &serde_json::json!({ "slug": "X_DO", "input_parameters": "not-an-object" }),
            "x",
        )
        .unwrap();
        assert_eq!(t.input_parameters["type"], "object");
    }
}
