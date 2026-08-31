//! The signed transport to Tripplet.
//!
//! Everything the app sends to Tripplet — inference and connector calls alike
//! — goes through here, so request signing, registration and token refresh
//! live in exactly one place.
//!
//! Registration is lazy and self-healing: the first call that needs a token
//! obtains one, and any later 401 clears the stored token and retries once.
//! That means a server-side revocation, a wiped install table, or a rotated
//! bootstrap secret all recover on the next request instead of requiring the
//! user to do anything.

use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use serde::Deserialize;

use crate::attest::{bootstrap_is_development, now_secs, Identity};

#[derive(Deserialize)]
struct RegisterResponse {
    token: String,
}

#[derive(Clone)]
pub struct Gateway {
    http: reqwest::Client,
    /// e.g. `https://tripplet.lol/api/computer`
    base_url: String,
    identity: Arc<Mutex<Identity>>,
}

impl Gateway {
    pub fn new(http: reqwest::Client, base_url: impl Into<String>, identity: Arc<Mutex<Identity>>) -> Self {
        let mut base_url = base_url.into();
        while base_url.ends_with('/') {
            base_url.pop();
        }
        Self { http, base_url, identity }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn install_id(&self) -> String {
        self.identity.lock().install_id.clone()
    }

    pub fn is_registered(&self) -> bool {
        self.identity.lock().is_registered()
    }

    /// The path component the signature is computed over. Both sides must
    /// derive it identically, so it comes from parsing the URL rather than
    /// from string concatenation.
    fn signed_path(url: &str) -> String {
        match reqwest::Url::parse(url) {
            Ok(parsed) => parsed.path().to_string(),
            // Should not happen for URLs we built, but signing *something*
            // deterministic beats panicking on a malformed override.
            Err(_) => url.to_string(),
        }
    }

    /// Register this install and store the issued token.
    pub async fn register(&self) -> Result<()> {
        let (install_id, public_key, timestamp, proof) = {
            let identity = self.identity.lock();
            let timestamp = now_secs();
            (
                identity.install_id.clone(),
                identity.public_key_b64(),
                timestamp,
                identity.bootstrap_proof(timestamp),
            )
        };

        let url = format!("{}/register", self.base_url);
        let body = serde_json::json!({
            "install_id": install_id,
            "public_key": public_key,
            "timestamp": timestamp,
            "bootstrap": proof,
            "app_version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
        });

        let res = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("could not reach Tripplet to register this install")?;

        if !res.status().is_success() {
            let status = res.status();
            let raw = res.text().await.unwrap_or_default();

            // A 404 that returns a web page means we are pointed at a Tripplet
            // deployment without the Computer routes, not that registration was
            // rejected. Say that, rather than pasting a doctype into the UI.
            if status.as_u16() == 404 {
                return Err(anyhow!(
                    "{} has no Tripplet Computer API. Either that deployment is missing the \
                     /api/computer routes, or the gateway URL in Settings is wrong.",
                    host_of(&url).unwrap_or_else(|| self.base_url.clone())
                ));
            }
            if status.as_u16() == 403 && bootstrap_is_development() {
                return Err(anyhow!(
                    "This build was compiled without a release bootstrap secret, so Tripplet \
                     refused to register it. Rebuild with TRIPPLET_COMPUTER_BOOTSTRAP set."
                ));
            }
            return Err(anyhow!(
                "Tripplet refused to register this install ({status}): {}",
                summarise(&raw)
            ));
        }

        let parsed: RegisterResponse = res
            .json()
            .await
            .context("Tripplet returned a malformed registration response")?;
        self.identity.lock().set_token(parsed.token)?;
        tracing::info!(%install_id, "registered this install with Tripplet");
        Ok(())
    }

    async fn ensure_registered(&self) -> Result<()> {
        if self.is_registered() {
            return Ok(());
        }
        self.register().await
    }

    /// POST a JSON body with a fresh signature, registering first if needed and
    /// retrying once if the server rejects our token.
    pub async fn post(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response> {
        self.ensure_registered().await?;

        let res = self.send(path, body).await?;
        if res.status().as_u16() != 401 {
            return Ok(res);
        }

        // Token unknown or revoked — drop it, register again, try once more.
        // A second 401 is a real failure and is returned to the caller.
        tracing::info!("gateway rejected our install token — re-registering");
        self.identity.lock().clear_token()?;
        self.register().await?;
        self.send(path, body).await
    }

    async fn send(&self, path: &str, body: &serde_json::Value) -> Result<reqwest::Response> {
        let url = format!("{}{}", self.base_url, path);
        let bytes = serde_json::to_vec(body)?;
        let headers = self.identity.lock().sign("POST", &Self::signed_path(&url), &bytes);

        let mut request = self
            .http
            .post(&url)
            .header(reqwest::header::CONTENT_TYPE, "application/json");
        for (name, value) in headers {
            request = request.header(name, value);
        }

        request
            .body(bytes)
            .send()
            .await
            .context("could not reach Tripplet")
    }
}

/// Reduce a server error body to one readable line.
///
/// A JSON error becomes its message; an HTML page becomes a short note rather
/// than several kilobytes of markup, which is what a raw passthrough produced.
fn summarise(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with('<') || trimmed.to_ascii_lowercase().starts_with("<!doctype") {
        return "the server returned a web page instead of an API response".into();
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let message = value
            .get("error")
            .and_then(|e| e.get("message").or(Some(e)))
            .and_then(|m| m.as_str())
            .or_else(|| value.get("message").and_then(|m| m.as_str()));
        if let Some(message) = message {
            return message.chars().take(200).collect();
        }
    }
    trimmed.chars().take(200).collect()
}

fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gateway(base: &str) -> Gateway {
        let identity = Arc::new(Mutex::new(
            Identity::load_or_create().expect("identity should be creatable in tests"),
        ));
        Gateway::new(reqwest::Client::new(), base, identity)
    }

    #[test]
    fn trailing_slashes_are_trimmed_from_the_base() {
        assert_eq!(gateway("https://tripplet.lol/api/computer///").base_url(), "https://tripplet.lol/api/computer");
    }

    #[test]
    fn the_signed_path_excludes_scheme_host_and_query() {
        assert_eq!(
            Gateway::signed_path("https://tripplet.lol/api/computer/chat/completions?x=1"),
            "/api/computer/chat/completions",
        );
    }

    #[test]
    fn a_malformed_url_still_yields_a_deterministic_path() {
        let path = Gateway::signed_path("not a url");
        assert_eq!(path, "not a url");
        assert_eq!(path, Gateway::signed_path("not a url"), "must be stable");
    }

    #[test]
    fn an_html_error_page_is_summarised_not_pasted() {
        let page = "<!DOCTYPE html><html lang=\"en\" class=\"outfit_9f4f9187\"><body>404</body></html>";
        let out = summarise(page);
        assert!(!out.contains("DOCTYPE"), "markup must not reach the user: {out}");
        assert!(!out.contains("<html"));
        assert!(out.contains("web page"));
    }

    #[test]
    fn a_json_error_is_reduced_to_its_message() {
        assert_eq!(
            summarise(r#"{"error":{"message":"Install registration is not configured."}}"#),
            "Install registration is not configured.",
        );
        assert_eq!(summarise(r#"{"message":"nope"}"#), "nope");
    }

    #[test]
    fn an_unrecognised_body_is_passed_through_bounded() {
        assert_eq!(summarise("  plain trouble  "), "plain trouble");
        assert!(summarise(&"x".repeat(900)).chars().count() <= 200);
    }

    #[test]
    fn an_install_id_is_stable_across_reads() {
        let g = gateway("https://example.test");
        assert_eq!(g.install_id(), g.install_id());
        assert!(g.install_id().starts_with("ci_"));
    }
}
