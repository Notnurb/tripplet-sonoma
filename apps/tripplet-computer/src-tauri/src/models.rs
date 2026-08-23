//! Model catalogue and effort tiers.
//!
//! The four personas are stable API identifiers — display names move
//! independently, exactly like `src/lib/ai/models.ts` on the web side, so a
//! rename can never orphan a saved thread. Persona ids are what travel on the
//! wire; Tripplet's gateway owns the persona → upstream mapping, so no real
//! provider model name is compiled into this app at all.
//!
//! Effort is the second axis. Low → Max scale reasoning budget and tool
//! patience on a *single* agent; **Ultra** changes the topology instead: it
//! fans the task out across a large pool of subagents that each attack it
//! from a different lens, then synthesises one answer from the survivors.

use serde::{Deserialize, Serialize};

/// A user-selectable persona. Ids are stable; `name` is free to change.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// True for the flagship — the UI badges it.
    pub flagship: bool,
}

pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "suzhou-4",
        name: "Suzhou 4",
        description: "Quick edits and everyday automation",
        flagship: false,
    },
    ModelInfo {
        id: "majuli-4",
        name: "Majuli 4",
        description: "Balanced reasoning with strong tool use",
        flagship: false,
    },
    ModelInfo {
        id: "taipei-4",
        name: "Taipei 4",
        description: "Deliberate, long-horizon problem solving",
        flagship: false,
    },
    ModelInfo {
        id: "astro-5.1",
        name: "Astro 5.1",
        description: "Flagship — deepest reasoning, widest fan-out",
        flagship: true,
    },
];

pub const DEFAULT_MODEL: &str = "astro-5.1";

pub fn model_by_id(id: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|m| m.id == id)
}

/// Display name for a persona id, falling back to the id itself so an unknown
/// value from an old config still renders as *something* in the UI.
pub fn model_display_name(id: &str) -> String {
    model_by_id(id)
        .map(|m| m.name.to_string())
        .unwrap_or_else(|| id.to_string())
}

/// The model name to put on the wire for a persona.
///
/// This is the persona id itself: the app talks to Tripplet's gateway, which
/// owns the persona → upstream mapping server-side. Keeping real provider
/// model names out of the client is the same rule the web app follows, and it
/// means a backend swap needs no desktop release.
///
/// An unknown persona falls back to the flagship rather than failing the
/// request, so a stale config.toml still gets an answer.
pub fn wire_model(persona_id: &str) -> &'static str {
    match model_by_id(persona_id) {
        Some(model) => model.id,
        None => DEFAULT_MODEL,
    }
}

/// Cheap, fast persona used for internal bookkeeping — thread titles and the
/// Ultra planner's decomposition. Never user-selectable.
pub const UTILITY_MODEL: &str = "suzhou-4";

// ─────────────────────────── Effort ───────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
    #[serde(rename = "xhigh")]
    XHigh,
    Max,
    Ultra,
}

impl Default for Effort {
    fn default() -> Self {
        Effort::Medium
    }
}

pub const EFFORTS: &[Effort] = &[
    Effort::Low,
    Effort::Medium,
    Effort::High,
    Effort::XHigh,
    Effort::Max,
    Effort::Ultra,
];

impl Effort {
    pub fn id(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::XHigh => "xhigh",
            Effort::Max => "max",
            Effort::Ultra => "ultra",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Effort::Low => "Low",
            Effort::Medium => "Medium",
            Effort::High => "High",
            Effort::XHigh => "XHigh",
            Effort::Max => "Max",
            Effort::Ultra => "Ultra",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Effort::Low => "Fastest. Short answers, minimal tool use.",
            Effort::Medium => "Everyday default. Balanced depth and speed.",
            Effort::High => "Thinks longer and keeps working through tool calls.",
            Effort::XHigh => "Long-horizon work with a small verification pool.",
            Effort::Max => "Deepest single-agent reasoning with parallel review.",
            Effort::Ultra => "Fans the task across a large subagent fleet, then synthesises.",
        }
    }

    pub fn from_id(id: &str) -> Option<Effort> {
        EFFORTS.iter().copied().find(|e| e.id() == id)
    }

    pub fn temperature(self) -> f32 {
        match self {
            Effort::Low => 0.2,
            Effort::Medium => 0.4,
            Effort::High => 0.5,
            Effort::XHigh => 0.6,
            Effort::Max => 0.7,
            Effort::Ultra => 0.8,
        }
    }

    pub fn max_tokens(self) -> u32 {
        match self {
            Effort::Low => 2_048,
            Effort::Medium => 4_096,
            Effort::High => 8_192,
            Effort::XHigh => 12_288,
            Effort::Max => 16_384,
            Effort::Ultra => 24_576,
        }
    }

    /// How many tool round-trips the loop will take before it stops and hands
    /// control back. Guards against a model that never converges.
    pub fn max_steps(self) -> u32 {
        match self {
            Effort::Low => 12,
            Effort::Medium => 24,
            Effort::High => 40,
            Effort::XHigh => 64,
            Effort::Max => 96,
            Effort::Ultra => 160,
        }
    }

    /// Size of the parallel subagent fleet. Zero means "run as a single
    /// agent" — the fan-out machinery is skipped entirely.
    pub fn subagents(self) -> usize {
        match self {
            Effort::Low | Effort::Medium | Effort::High => 0,
            Effort::XHigh => 3,
            Effort::Max => 6,
            Effort::Ultra => 16,
        }
    }

    /// How many subagents may be in flight at once. The Ultra fleet is larger
    /// than this, so the rest queue — this is the concurrency cap, not the
    /// fleet size.
    pub fn max_parallel(self) -> usize {
        match self {
            Effort::Ultra => 6,
            _ => 3,
        }
    }
}

/// Client-facing catalogue entry — what the effort picker renders.
#[derive(Debug, Clone, Serialize)]
pub struct EffortInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub subagents: usize,
}

pub fn effort_catalog() -> Vec<EffortInfo> {
    EFFORTS
        .iter()
        .map(|e| EffortInfo {
            id: e.id(),
            label: e.label(),
            description: e.description(),
            subagents: e.subagents(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_model_puts_its_own_id_on_the_wire() {
        for m in MODELS {
            assert_eq!(wire_model(m.id), m.id, "{} should send its persona id", m.id);
        }
    }

    #[test]
    fn unknown_persona_falls_back_instead_of_panicking() {
        assert_eq!(wire_model("does-not-exist"), DEFAULT_MODEL);
        assert_eq!(model_display_name("does-not-exist"), "does-not-exist");
    }

    #[test]
    fn no_upstream_provider_name_is_compiled_into_the_client() {
        // Real provider model names must stay server-side. If one of these
        // ever appears here again, the mapping has leaked back into the app.
        // Only the non-test half is scanned — this test necessarily spells the
        // names out, and would otherwise trip on itself.
        let full = include_str!("models.rs");
        let source = full.split("#[cfg(test)]").next().unwrap_or(full);
        for leaked in ["nemotron-3", "claude-sonnet", "glm-5"] {
            assert!(
                !source.contains(&format!("\"{leaked}")),
                "upstream model name `{leaked}` must not be hardcoded in the client"
            );
        }
    }

    #[test]
    fn the_utility_persona_is_a_real_persona() {
        assert!(model_by_id(UTILITY_MODEL).is_some());
    }

    #[test]
    fn effort_ids_round_trip() {
        for e in EFFORTS {
            assert_eq!(Effort::from_id(e.id()), Some(*e));
        }
        assert_eq!(Effort::from_id("nope"), None);
    }

    #[test]
    fn effort_budgets_increase_monotonically() {
        for pair in EFFORTS.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            assert!(b.max_tokens() > a.max_tokens(), "{:?} !> {:?}", b, a);
            assert!(b.max_steps() > a.max_steps(), "{:?} !> {:?}", b, a);
            assert!(b.subagents() >= a.subagents(), "{:?} !>= {:?}", b, a);
        }
    }

    #[test]
    fn ultra_is_the_fan_out_tier() {
        assert_eq!(Effort::Ultra.subagents(), 16);
        assert_eq!(Effort::Low.subagents(), 0);
        assert_eq!(Effort::Medium.subagents(), 0);
        assert_eq!(Effort::High.subagents(), 0);
    }
}
