//! Per-install identity and request signing.
//!
//! The app has no user-supplied API key. Instead, on first run it generates an
//! Ed25519 keypair, registers the public half with Tripplet, and signs every
//! subsequent request with the private half. The server can then tell one
//! install from another: rate-limit them separately, revoke a bad one, and
//! refuse anything that is not a live Tripplet Computer build.
//!
//! ## What this is, and what it is not
//!
//! This is **abuse control, not authentication**. The bootstrap secret that
//! authorises a first registration is compiled into a binary we hand to users,
//! and anything in a distributed binary can be extracted. A determined
//! attacker can pull it and register a forged install.
//!
//! What the scheme does buy, which a shared static API key does not:
//!
//! * every install is individually identifiable, rate-limitable and revocable;
//! * a captured request cannot be replayed (timestamp + nonce + signature);
//! * a leaked key compromises one install, not the whole fleet;
//! * abuse can be traced to an install and cut off without shipping a release.
//!
//! The real fix for "prove this is genuinely our app" on macOS is Apple's App
//! Attest, which requires a Developer ID and app entitlements this build does
//! not yet have. Until then, treat install identity as a strong hint, never as
//! a trust boundary, and keep the server-side limits meaningful.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey, SECRET_KEY_LENGTH};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Shared secret proving a registration came from a Tripplet Computer build.
///
/// Set at build time (`TRIPPLET_COMPUTER_BOOTSTRAP=… cargo build`). The
/// fallback is a public development value: a deployment that leaves it unset
/// gets a build every developer can register against, which is correct for
/// local work and must not be what ships.
pub const BOOTSTRAP_SECRET: &str = match option_env!("TRIPPLET_COMPUTER_BOOTSTRAP") {
    Some(secret) => secret,
    None => "tripplet-computer-development-bootstrap",
};

pub fn bootstrap_is_development() -> bool {
    BOOTSTRAP_SECRET == "tripplet-computer-development-bootstrap"
}

/// Requests older than this are refused by the server, bounding replay.
pub const MAX_CLOCK_SKEW_SECS: u64 = 300;

/// On-disk form. Kept in its own file rather than `config.toml` so the private
/// key is never printed alongside settings a user might paste into a bug report.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredIdentity {
    install_id: String,
    /// base64 of the 32-byte Ed25519 seed.
    secret_key: String,
    /// Issued by the server at registration; absent until then.
    #[serde(default)]
    token: Option<String>,
}

pub struct Identity {
    pub install_id: String,
    signing_key: SigningKey,
    token: Option<String>,
}

impl Identity {
    pub fn path() -> PathBuf {
        crate::config::data_dir().join("identity.json")
    }

    /// Load the install identity, generating one on first run.
    ///
    /// A corrupt or truncated file is replaced rather than treated as fatal:
    /// the worst case is the install re-registers and gets a new id, which is
    /// strictly better than an app that will not start.
    pub fn load_or_create() -> Result<Self> {
        let path = Self::path();
        if let Ok(raw) = std::fs::read_to_string(&path) {
            match serde_json::from_str::<StoredIdentity>(&raw).ok().and_then(decode) {
                Some(identity) => return Ok(identity),
                None => {
                    tracing::warn!(?path, "identity file unreadable — generating a new install identity");
                }
            }
        }

        let signing_key = SigningKey::generate(&mut rand_core::OsRng);
        let identity = Identity {
            install_id: format!("ci_{}", uuid::Uuid::new_v4().simple()),
            signing_key,
            token: None,
        };
        identity.save()?;
        Ok(identity)
    }

    fn save(&self) -> Result<()> {
        let path = Self::path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let stored = StoredIdentity {
            install_id: self.install_id.clone(),
            secret_key: B64.encode(self.signing_key.to_bytes()),
            token: self.token.clone(),
        };
        // A unique temp name per write: a fixed one races when two saves land
        // together (two app instances, or concurrent tests), and the loser's
        // rename fails with ENOENT after the winner moved the file away.
        let tmp = path.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4().simple()));
        std::fs::write(&tmp, serde_json::to_string_pretty(&stored)?)?;
        restrict(&tmp)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn public_key_b64(&self) -> String {
        B64.encode(self.signing_key.verifying_key().to_bytes())
    }

    pub fn token(&self) -> Option<&str> {
        self.token.as_deref()
    }

    pub fn is_registered(&self) -> bool {
        self.token.is_some()
    }

    pub fn set_token(&mut self, token: String) -> Result<()> {
        self.token = Some(token);
        self.save()
    }

    /// Forget the server-issued token, forcing re-registration on next use.
    /// Called when the server rejects the token as unknown or revoked.
    pub fn clear_token(&mut self) -> Result<()> {
        self.token = None;
        self.save()
    }

    /// Proof that a registration request came from a Tripplet Computer build.
    ///
    /// Binds the install id, public key and a timestamp, so the value cannot be
    /// lifted from one registration and reused for another install.
    pub fn bootstrap_proof(&self, timestamp: u64) -> String {
        let message = format!("{}.{}.{}", self.install_id, self.public_key_b64(), timestamp);
        let mut mac = HmacSha256::new_from_slice(BOOTSTRAP_SECRET.as_bytes())
            .expect("HMAC accepts keys of any length");
        mac.update(message.as_bytes());
        B64.encode(mac.finalize().into_bytes())
    }

    /// Sign one request. Returns the headers to attach.
    pub fn sign(&self, method: &str, path: &str, body: &[u8]) -> Vec<(String, String)> {
        let timestamp = now_secs();
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let canonical = canonical_string(method, path, timestamp, &nonce, body);
        let signature = B64.encode(self.signing_key.sign(canonical.as_bytes()).to_bytes());

        let mut headers = vec![
            ("X-Tripplet-Install".into(), self.install_id.clone()),
            ("X-Tripplet-Timestamp".into(), timestamp.to_string()),
            ("X-Tripplet-Nonce".into(), nonce),
            ("X-Tripplet-Signature".into(), signature),
            (
                "X-Tripplet-Client".into(),
                format!("tripplet-computer/{}", env!("CARGO_PKG_VERSION")),
            ),
        ];
        if let Some(token) = &self.token {
            headers.push(("X-Tripplet-Token".into(), token.clone()));
        }
        headers
    }
}

fn decode(stored: StoredIdentity) -> Option<Identity> {
    let bytes = B64.decode(stored.secret_key.as_bytes()).ok()?;
    let seed: [u8; SECRET_KEY_LENGTH] = bytes.try_into().ok()?;
    if stored.install_id.trim().is_empty() {
        return None;
    }
    Some(Identity {
        install_id: stored.install_id,
        signing_key: SigningKey::from_bytes(&seed),
        token: stored.token,
    })
}

/// The exact bytes both sides sign over.
///
/// Newline-separated with a hashed body: the body may be megabytes, and the
/// server should be able to verify the signature before deciding to read it.
pub fn canonical_string(method: &str, path: &str, timestamp: u64, nonce: &str, body: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(body);
    let body_hash = hex(&hasher.finalize());
    format!("{}\n{}\n{}\n{}\n{}", method.to_uppercase(), path, timestamp, nonce, body_hash)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(unix)]
fn restrict(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Verifier, VerifyingKey};

    fn identity() -> Identity {
        Identity {
            install_id: "ci_test".into(),
            signing_key: SigningKey::generate(&mut rand_core::OsRng),
            token: None,
        }
    }

    fn header<'a>(headers: &'a [(String, String)], name: &str) -> &'a str {
        headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
            .unwrap_or_default()
    }

    #[test]
    fn a_signature_verifies_against_the_public_key() {
        let id = identity();
        let body = br#"{"model":"suzhou-4"}"#;
        let headers = id.sign("POST", "/api/computer/chat/completions", body);

        let timestamp: u64 = header(&headers, "X-Tripplet-Timestamp").parse().unwrap();
        let nonce = header(&headers, "X-Tripplet-Nonce");
        let canonical = canonical_string("POST", "/api/computer/chat/completions", timestamp, nonce, body);

        let key_bytes: [u8; 32] = B64.decode(id.public_key_b64()).unwrap().try_into().unwrap();
        let verifying = VerifyingKey::from_bytes(&key_bytes).unwrap();
        let sig_bytes: [u8; 64] = B64
            .decode(header(&headers, "X-Tripplet-Signature"))
            .unwrap()
            .try_into()
            .unwrap();
        let signature = ed25519_dalek::Signature::from_bytes(&sig_bytes);

        assert!(verifying.verify(canonical.as_bytes(), &signature).is_ok());
    }

    #[test]
    fn a_tampered_body_breaks_the_signature() {
        let id = identity();
        let headers = id.sign("POST", "/x", b"original");
        let timestamp: u64 = header(&headers, "X-Tripplet-Timestamp").parse().unwrap();
        let nonce = header(&headers, "X-Tripplet-Nonce");

        let honest = canonical_string("POST", "/x", timestamp, nonce, b"original");
        let tampered = canonical_string("POST", "/x", timestamp, nonce, b"tampered");
        assert_ne!(honest, tampered, "the body hash must be part of what is signed");
    }

    #[test]
    fn the_method_and_path_are_bound_into_the_signature() {
        let a = canonical_string("POST", "/a", 1, "n", b"");
        assert_ne!(a, canonical_string("GET", "/a", 1, "n", b""));
        assert_ne!(a, canonical_string("POST", "/b", 1, "n", b""));
    }

    #[test]
    fn method_case_does_not_change_the_signature() {
        assert_eq!(
            canonical_string("post", "/a", 1, "n", b""),
            canonical_string("POST", "/a", 1, "n", b""),
        );
    }

    #[test]
    fn every_request_gets_a_fresh_nonce() {
        let id = identity();
        let a = id.sign("POST", "/x", b"{}");
        let b = id.sign("POST", "/x", b"{}");
        assert_ne!(
            header(&a, "X-Tripplet-Nonce"),
            header(&b, "X-Tripplet-Nonce"),
            "a reused nonce would make replay detection useless"
        );
    }

    #[test]
    fn the_token_header_appears_only_once_registered() {
        let mut id = identity();
        assert!(header(&id.sign("POST", "/x", b""), "X-Tripplet-Token").is_empty());
        assert!(!id.is_registered());

        id.token = Some("tok_123".into());
        assert!(id.is_registered());
        assert_eq!(header(&id.sign("POST", "/x", b""), "X-Tripplet-Token"), "tok_123");
    }

    #[test]
    fn bootstrap_proof_binds_install_key_and_time() {
        let id = identity();
        let at = 1_700_000_000;
        let proof = id.bootstrap_proof(at);
        assert!(!proof.is_empty());
        // A different timestamp must not reuse the same proof.
        assert_ne!(proof, id.bootstrap_proof(at + 1));
        // Nor may a different install produce it.
        let other = identity();
        assert_ne!(proof, other.bootstrap_proof(at));
    }

    #[test]
    fn a_corrupt_identity_file_is_rejected_rather_than_loaded() {
        assert!(decode(StoredIdentity {
            install_id: "ci_x".into(),
            secret_key: "not-base64!!".into(),
            token: None,
        })
        .is_none());

        assert!(decode(StoredIdentity {
            install_id: "ci_x".into(),
            secret_key: B64.encode([0u8; 8]), // wrong length
            token: None,
        })
        .is_none());

        assert!(decode(StoredIdentity {
            install_id: "  ".into(),
            secret_key: B64.encode([7u8; 32]),
            token: None,
        })
        .is_none());
    }

    #[test]
    fn a_valid_identity_file_round_trips() {
        let id = identity();
        let stored = StoredIdentity {
            install_id: id.install_id.clone(),
            secret_key: B64.encode(id.signing_key.to_bytes()),
            token: Some("tok".into()),
        };
        let back = decode(stored).unwrap();
        assert_eq!(back.install_id, id.install_id);
        assert_eq!(back.public_key_b64(), id.public_key_b64());
        assert_eq!(back.token(), Some("tok"));
    }

    #[test]
    fn the_development_bootstrap_is_detectable() {
        // The server refuses development proofs in production; this flag is how
        // the app knows to warn rather than silently fail to register.
        assert_eq!(bootstrap_is_development(), option_env!("TRIPPLET_COMPUTER_BOOTSTRAP").is_none());
    }
}
