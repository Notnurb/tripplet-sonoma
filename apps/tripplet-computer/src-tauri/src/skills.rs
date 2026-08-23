//! Skills — task-specific playbooks that steer the agent.
//!
//! A skill is a Markdown file with a small YAML-ish front-matter header. The
//! built-ins ship compiled into the binary; user skills live in
//! `~/Library/Application Support/ai.tripplet.computer/skills/*.md` and are
//! re-read on every list, so editing one takes effect on the next turn without
//! a restart.
//!
//! Only a skill's `name` and `description` reach the system prompt. The `body`
//! is injected on demand, which keeps a dozen installed skills from crowding
//! out the actual conversation.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Skill {
    pub slug: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub body: String,
    pub enabled: bool,
    /// Built-ins ship with the app and cannot be deleted, only disabled.
    pub builtin: bool,
}

/// `(slug, name, description, body)` for each shipped skill.
const BUILTIN: &[(&str, &str, &str, &str)] = &[
    (
        "code-review",
        "Code Review",
        "Find actionable bugs in code changes",
        "Review the current changes for defects that would actually bite.\n\
         1. Run `git diff` (or `git diff --cached`) to see exactly what changed.\n\
         2. For each hunk, read enough surrounding code to judge it in context.\n\
         3. Report only defects you can state a concrete failure case for — inputs, and the wrong \
            output or crash that results. Skip style opinions.\n\
         4. Rank by severity. If nothing is wrong, say so rather than inventing findings.",
    ),
    (
        "write-tests",
        "Test Writer",
        "Write tests that cover the code you just changed",
        "Add tests for the current changes.\n\
         1. Identify the project's test framework and conventions by reading an existing test file.\n\
         2. Cover the behaviour that changed, its error paths, and at least one boundary case.\n\
         3. Match the surrounding style — naming, setup helpers, assertion library.\n\
         4. Run the suite and report the real result. A test you did not run is not a test.",
    ),
    (
        "debug",
        "Debugger",
        "Reproduce, isolate, and fix a bug",
        "Work the bug systematically rather than guessing.\n\
         1. Reproduce it first. If you cannot, say so and ask for the steps.\n\
         2. Form one hypothesis at a time and test it with a command or a log line.\n\
         3. Find the root cause before touching anything — a fix at the symptom will come back.\n\
         4. Fix it, re-run the reproduction, and confirm it is gone.\n\
         5. Remove any debugging scaffolding you added.",
    ),
    (
        "refactor",
        "Refactor",
        "Restructure code without changing behaviour",
        "Refactor with behaviour held constant.\n\
         1. Establish a green baseline: run the tests before you start.\n\
         2. Make one structural change at a time.\n\
         3. Re-run the tests after each step; never batch several changes into one unverified edit.\n\
         4. If no tests cover the code, say so and offer to write them first.",
    ),
    (
        "explain",
        "Explain Codebase",
        "Map an unfamiliar project and explain how it works",
        "Build an accurate picture of the project before explaining it.\n\
         1. Read the README, the manifest (package.json / Cargo.toml / pyproject.toml), and the entry point.\n\
         2. Trace one real request or command end to end through the code.\n\
         3. Explain the architecture in terms of what the code actually does, citing `file:line`.\n\
         4. Flag anything that looks stale or contradicts the docs.",
    ),
    (
        "release-notes",
        "Release Notes",
        "Draft a changelog from the commit history",
        "Turn the commit history into notes a user would want to read.\n\
         1. `git log --oneline <last-tag>..HEAD` for the range.\n\
         2. Group by what changed for the user: added, changed, fixed, removed.\n\
         3. Write each entry in terms of user-visible effect, not commit subject.\n\
         4. Match the existing CHANGELOG format exactly if one is present.",
    ),
    (
        "dep-audit",
        "Dependency Audit",
        "Check dependencies for staleness and known issues",
        "Audit the project's dependencies.\n\
         1. Read the manifest and lockfile to establish what is actually installed.\n\
         2. Run the ecosystem's audit command (`npm audit`, `cargo audit`, `pip-audit`) if available.\n\
         3. Separate genuinely exploitable issues from noise, and say which is which.\n\
         4. Propose upgrades in order of risk-reduction per unit of breakage. Do not upgrade anything \
            unless the user asks.",
    ),
    (
        "skill-creator",
        "Skill Creator",
        "Create or update a skill",
        "Write a new skill file for this app.\n\
         Skills live in the app's `skills/` directory as Markdown with front-matter:\n\
         ```\n\
         ---\n\
         name: Human Readable Name\n\
         description: One line, shown in the Skills list\n\
         ---\n\
         Numbered instructions the agent should follow.\n\
         ```\n\
         Keep the body imperative and specific. A skill that merely says \"be careful\" earns nothing.",
    ),
];

pub fn skills_dir() -> PathBuf {
    crate::config::data_dir().join("skills")
}

/// Built-ins plus anything in the skills directory, with the user's
/// disabled-list applied. User skills override a built-in of the same slug,
/// which is how someone customises a shipped playbook.
pub fn list(disabled: &[String]) -> Vec<Skill> {
    let mut skills: Vec<Skill> = BUILTIN
        .iter()
        .map(|(slug, name, description, body)| Skill {
            slug: (*slug).to_string(),
            name: (*name).to_string(),
            description: (*description).to_string(),
            body: (*body).to_string(),
            enabled: !disabled.iter().any(|d| d == slug),
            builtin: true,
        })
        .collect();

    for skill in load_user_skills(disabled) {
        match skills.iter_mut().find(|s| s.slug == skill.slug) {
            Some(existing) => *existing = skill,
            None => skills.push(skill),
        }
    }

    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    skills
}

fn load_user_skills(disabled: &[String]) -> Vec<Skill> {
    let dir = skills_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(slug) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let Ok(raw) = std::fs::read_to_string(&path) else {
            tracing::warn!(?path, "could not read skill file");
            continue;
        };
        let (name, description, body) = parse(&raw, slug);
        out.push(Skill {
            enabled: !disabled.iter().any(|d| d == slug),
            slug: slug.to_string(),
            name,
            description,
            body,
            builtin: false,
        });
    }
    out
}

pub fn by_slug(slug: &str, disabled: &[String]) -> Option<Skill> {
    list(disabled).into_iter().find(|s| s.slug == slug)
}

/// Split front-matter from body. A file without front-matter is still a valid
/// skill — the slug becomes the name and the first line the description — so a
/// user can drop in a plain Markdown file and have it work.
fn parse(raw: &str, slug: &str) -> (String, String, String) {
    let mut name = title_case(slug);
    let mut description = String::new();

    let body = if let Some(rest) = raw.strip_prefix("---") {
        match rest.find("\n---") {
            Some(end) => {
                for line in rest[..end].lines() {
                    let Some((key, value)) = line.split_once(':') else { continue };
                    let value = value.trim().trim_matches('"').to_string();
                    if value.is_empty() {
                        continue;
                    }
                    match key.trim().to_lowercase().as_str() {
                        "name" => name = value,
                        "description" => description = value,
                        _ => {}
                    }
                }
                rest[end + 4..].trim_start_matches('\n').to_string()
            }
            // Unterminated front-matter — treat the whole file as body rather
            // than swallowing it.
            None => raw.to_string(),
        }
    } else {
        raw.to_string()
    };

    if description.is_empty() {
        description = body
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with('#'))
            .unwrap_or("Custom skill")
            .chars()
            .take(120)
            .collect();
    }

    (name, description, body.trim().to_string())
}

fn title_case(slug: &str) -> String {
    slug.split(['-', '_'])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(c) => format!("{}{}", c.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_are_listed_and_enabled_by_default() {
        let skills = list(&[]);
        assert!(skills.len() >= BUILTIN.len());
        assert!(skills.iter().all(|s| s.enabled || !s.builtin));
        let review = skills.iter().find(|s| s.slug == "code-review").unwrap();
        assert_eq!(review.name, "Code Review");
        assert!(review.builtin);
        assert!(!review.body.is_empty());
    }

    #[test]
    fn the_disabled_list_switches_a_skill_off_without_removing_it() {
        let skills = list(&["code-review".to_string()]);
        let review = skills.iter().find(|s| s.slug == "code-review").unwrap();
        assert!(!review.enabled);
        assert!(
            skills.iter().any(|s| s.slug == "debug" && s.enabled),
            "disabling one skill must not affect the others"
        );
    }

    #[test]
    fn skills_are_listed_alphabetically_by_name() {
        let skills = list(&[]);
        let names: Vec<String> = skills.iter().map(|s| s.name.to_lowercase()).collect();
        let mut sorted = names.clone();
        sorted.sort();
        assert_eq!(names, sorted);
    }

    #[test]
    fn every_builtin_has_a_unique_slug_and_a_real_body() {
        let mut seen = std::collections::HashSet::new();
        for (slug, name, description, body) in BUILTIN {
            assert!(seen.insert(*slug), "duplicate slug {slug}");
            assert!(!name.is_empty() && !description.is_empty(), "{slug}");
            assert!(body.len() > 80, "{slug} body is too thin to be useful");
        }
    }

    #[test]
    fn front_matter_supplies_name_and_description() {
        let raw = "---\nname: My Skill\ndescription: Does a thing\n---\nStep one.\nStep two.\n";
        let (name, description, body) = parse(raw, "my-skill");
        assert_eq!(name, "My Skill");
        assert_eq!(description, "Does a thing");
        assert_eq!(body, "Step one.\nStep two.");
    }

    #[test]
    fn quoted_front_matter_values_are_unwrapped() {
        let (name, description, _) = parse("---\nname: \"Quoted\"\ndescription: \"Also quoted\"\n---\nx\n", "s");
        assert_eq!(name, "Quoted");
        assert_eq!(description, "Also quoted");
    }

    #[test]
    fn a_plain_markdown_file_is_still_a_valid_skill() {
        let (name, description, body) = parse("Do the thing carefully.\n", "my-custom-skill");
        assert_eq!(name, "My Custom Skill", "slug should title-case into a name");
        assert_eq!(description, "Do the thing carefully.");
        assert_eq!(body, "Do the thing carefully.");
    }

    #[test]
    fn a_leading_heading_is_skipped_when_deriving_a_description() {
        let (_, description, _) = parse("# Title\n\nThe actual summary line.\n", "s");
        assert_eq!(description, "The actual summary line.");
    }

    #[test]
    fn unterminated_front_matter_is_kept_as_body_not_swallowed() {
        let raw = "---\nname: Broken\nno closing fence here\n";
        let (_, _, body) = parse(raw, "broken");
        assert!(body.contains("no closing fence here"));
    }

    #[test]
    fn an_empty_file_still_produces_a_usable_skill() {
        let (name, description, body) = parse("", "empty-one");
        assert_eq!(name, "Empty One");
        assert_eq!(description, "Custom skill");
        assert!(body.is_empty());
    }

    #[test]
    fn title_case_handles_both_separators() {
        assert_eq!(title_case("code-review"), "Code Review");
        assert_eq!(title_case("my_custom_thing"), "My Custom Thing");
        assert_eq!(title_case("single"), "Single");
    }
}
