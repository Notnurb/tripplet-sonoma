//! The agent's toolset: filesystem, shell, web, and Composio connectors.
//!
//! Every tool follows the same contract — it never returns `Err` to the agent
//! loop. A failure, a denial, or a malformed argument all come back as a
//! [`ToolOutcome`] with `ok: false` and a message written *for the model*, so
//! the agent can read what went wrong and try something else. Only a genuinely
//! unrecoverable condition would end a turn, and none of these are.

pub mod fs;
pub mod shell;
pub mod web;

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

use crate::approval::{decide, ActionRequest, Decision};
use crate::approver::Approver;
use crate::composio::ComposioTools;
use crate::config::{ApprovalPolicy, Permissions};
use crate::llm::{ToolCall, ToolDef};

/// Result of one tool call.
#[derive(Debug, Clone, Serialize)]
pub struct ToolOutcome {
    /// What goes back to the model as the `tool` message body.
    pub body: String,
    /// One-line human summary for the activity feed, e.g. "Read 42 lines".
    pub summary: String,
    pub ok: bool,
}

impl ToolOutcome {
    pub fn ok(summary: impl Into<String>, body: impl Into<String>) -> Self {
        Self { body: body.into(), summary: summary.into(), ok: true }
    }

    /// A failure the model is expected to read and recover from.
    pub fn err(summary: impl Into<String>, body: impl Into<String>) -> Self {
        let summary = summary.into();
        Self { body: format!("Error: {}", body.into()), summary, ok: false }
    }

    pub fn denied(what: &str) -> Self {
        Self {
            body: format!(
                "Error: the user declined this action ({what}). Do not retry it. \
                 Explain what you were trying to do and ask how they would like to proceed."
            ),
            summary: "Declined by user".into(),
            ok: false,
        }
    }

    /// Refused without anyone being asked — a subagent reaching past its
    /// read-only scope. Distinct from [`ToolOutcome::denied`] so the model
    /// does not tell the user they declined something they never saw.
    pub fn out_of_scope(what: &str) -> Self {
        Self {
            body: format!(
                "Error: this action is outside your permitted scope ({what}). No one was asked. \
                 Work within your scope, or report that this step needs the lead agent."
            ),
            summary: "Out of scope".into(),
            ok: false,
        }
    }
}

/// Which built-in capability groups are switched on, mirroring the three
/// built-in entries on the Plugins page. A group that is off has its tools
/// removed from the model's toolset entirely — a toggle the user can see must
/// actually take the capability away, not merely hide it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToolGroups {
    pub files: bool,
    pub terminal: bool,
    pub browser: bool,
}

impl Default for ToolGroups {
    fn default() -> Self {
        Self { files: true, terminal: true, browser: true }
    }
}

impl ToolGroups {
    /// Read the three groups out of the user's disabled-plugins list.
    pub fn from_disabled(disabled: &[String]) -> Self {
        let on = |slug: &str| !disabled.iter().any(|d| d == slug);
        Self { files: on("files"), terminal: on("terminal"), browser: on("browser") }
    }

    /// The group a built-in tool belongs to, or `None` for tools that are not
    /// part of a switchable group.
    pub fn group_of(tool: &str) -> Option<&'static str> {
        match tool {
            "read_file" | "write_file" | "edit_file" | "list_dir" | "search_files" => Some("files"),
            "run_command" => Some("terminal"),
            "fetch_url" | "web_search" => Some("browser"),
            _ => None,
        }
    }

    pub fn allows(&self, tool: &str) -> bool {
        match Self::group_of(tool) {
            Some("files") => self.files,
            Some("terminal") => self.terminal,
            Some("browser") => self.browser,
            // Connector tools and anything unrecognised are governed elsewhere.
            _ => true,
        }
    }
}

/// Everything a tool needs to run one call.
#[derive(Clone)]
pub struct ToolContext {
    pub project_root: Option<PathBuf>,
    pub policy: ApprovalPolicy,
    pub permissions: Permissions,
    pub approver: Approver,
    pub http: reqwest::Client,
    pub composio: Option<Arc<ComposioTools>>,
    /// Subagents run read-only. A sixteen-strong Ultra fleet exploring the
    /// same working tree in parallel must not be able to write to it — the
    /// lead agent applies the changes once the fleet reports back.
    pub read_only: bool,
    pub groups: ToolGroups,
}

impl ToolContext {
    /// Run an action past the approval gate. `Ok(())` means proceed.
    pub async fn gate(&self, action: ActionRequest) -> Result<(), ToolOutcome> {
        match decide(self.policy, &self.permissions, self.project_root.as_deref(), &action) {
            Decision::Allow => Ok(()),
            Decision::Ask => {
                let what = action.detail.clone();
                let automatic = self.approver.is_automatic();
                if self.approver.ask(action).await {
                    Ok(())
                } else if automatic {
                    Err(ToolOutcome::out_of_scope(&what))
                } else {
                    Err(ToolOutcome::denied(&what))
                }
            }
        }
    }

    pub fn root(&self) -> Result<&std::path::Path, ToolOutcome> {
        self.project_root.as_deref().ok_or_else(|| {
            ToolOutcome::err(
                "No project open",
                "no project folder is open. Ask the user to choose one from the project picker \
                 before using filesystem or shell tools.",
            )
        })
    }
}

/// Built-in tool definitions offered to the model.
///
/// `read_only` drops the mutating tools entirely rather than defining them and
/// refusing at call time — a tool the model cannot see is a tool it cannot
/// waste a turn on.
pub fn builtin_defs(read_only: bool, groups: ToolGroups) -> Vec<ToolDef> {
    let mut defs = vec![
        ToolDef::new(
            "read_file",
            "Read a UTF-8 text file from the open project. Returns the contents with 1-based line \
             numbers. Use `offset` and `limit` to page through a large file rather than reading it all.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to the project root, or an absolute path." },
                    "offset": { "type": "integer", "description": "1-based line to start at.", "minimum": 1 },
                    "limit": { "type": "integer", "description": "How many lines to return (default 400).", "minimum": 1 }
                },
                "required": ["path"]
            }),
        ),
        ToolDef::new(
            "list_dir",
            "List the entries of a directory in the open project, marking directories with a trailing slash. \
             Respects .gitignore.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path; defaults to the project root." }
                }
            }),
        ),
        ToolDef::new(
            "search_files",
            "Search the project for a regular expression and return matching lines with their file and line \
             number. This is the fastest way to find where something is defined or used.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Rust-flavoured regular expression." },
                    "path": { "type": "string", "description": "Subdirectory to limit the search to." },
                    "glob": { "type": "string", "description": "Only search files whose name matches this glob, e.g. `*.rs`." },
                    "max_results": { "type": "integer", "description": "Cap on matches returned (default 80).", "minimum": 1 }
                },
                "required": ["pattern"]
            }),
        ),
        ToolDef::new(
            "run_command",
            "Run a shell command in the project directory and return its stdout, stderr and exit code. \
             Prefer the dedicated file tools for reading and editing; use this for builds, tests and git.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "The full command line to run." },
                    "cwd": { "type": "string", "description": "Working directory, relative to the project root." },
                    "timeout_seconds": { "type": "integer", "description": "Kill the command after this long (default 120, max 600).", "minimum": 1 }
                },
                "required": ["command"]
            }),
        ),
        ToolDef::new(
            "fetch_url",
            "Fetch a public web page and return it as readable text with the markup stripped. \
             Use this to read documentation the answer depends on.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "An absolute https:// URL." }
                },
                "required": ["url"]
            }),
        ),
        ToolDef::new(
            "web_search",
            "Search the web and return titles, URLs and snippets. Follow up with fetch_url to read a result in full.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "The search query." }
                },
                "required": ["query"]
            }),
        ),
    ];

    if !read_only {
        defs.push(ToolDef::new(
            "write_file",
            "Create a file, or replace one entirely. For a change to part of an existing file prefer \
             edit_file — it is far less likely to lose surrounding work.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to the project root." },
                    "content": { "type": "string", "description": "The complete new contents of the file." }
                },
                "required": ["path", "content"]
            }),
        ));
        defs.push(ToolDef::new(
            "edit_file",
            "Replace an exact string in a file. `old_string` must match the file byte-for-byte, including \
             indentation, and must appear exactly once unless replace_all is true.",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to the project root." },
                    "old_string": { "type": "string", "description": "The exact text to replace." },
                    "new_string": { "type": "string", "description": "What to replace it with." },
                    "replace_all": { "type": "boolean", "description": "Replace every occurrence instead of requiring a unique match." }
                },
                "required": ["path", "old_string", "new_string"]
            }),
        ));
    }

    // A switched-off capability group is removed outright, so the model never
    // sees a tool it is not allowed to call.
    defs.retain(|def| groups.allows(&def.function.name));
    defs
}

/// Full toolset for a turn: built-ins plus the user's connected Composio apps.
pub fn all_defs(ctx: &ToolContext) -> Vec<ToolDef> {
    let mut defs = builtin_defs(ctx.read_only, ctx.groups);
    if let Some(composio) = &ctx.composio {
        defs.extend(composio.defs().iter().cloned());
    }
    defs
}

/// Dispatch one tool call.
pub async fn execute(ctx: &ToolContext, call: &ToolCall) -> ToolOutcome {
    let name = call.function_name().to_string();

    let args = match call.parsed_arguments() {
        Ok(args) => args,
        Err(err) => {
            return ToolOutcome::err(
                format!("{name}: bad arguments"),
                format!("{err}. Re-send the call with valid JSON arguments."),
            )
        }
    };

    // Connector tools are namespaced, so they can never shadow a built-in.
    if let Some(composio) = &ctx.composio {
        if composio.handles(&name) {
            return composio.execute(ctx, call).await;
        }
    }

    // Defence in depth: the definition was withheld, but a model that invents
    // the name must still not reach the implementation.
    if !ctx.groups.allows(&name) {
        let group = ToolGroups::group_of(&name).unwrap_or("that");
        return ToolOutcome::err(
            format!("{name} is switched off"),
            format!(
                "the `{group}` capability is switched off in Plugins, so `{name}` is unavailable. \
                 Tell the user it is off rather than trying another route."
            ),
        );
    }

    match name.as_str() {
        "read_file" => fs::read_file(ctx, &args).await,
        "list_dir" => fs::list_dir(ctx, &args).await,
        "search_files" => fs::search_files(ctx, &args).await,
        "write_file" => fs::write_file(ctx, &args).await,
        "edit_file" => fs::edit_file(ctx, &args).await,
        "run_command" => shell::run_command(ctx, &args).await,
        "fetch_url" => web::fetch_url(ctx, &args).await,
        "web_search" => web::web_search(ctx, &args).await,
        other => ToolOutcome::err(
            format!("Unknown tool {other}"),
            format!("there is no tool called `{other}`. Use only the tools you were given."),
        ),
    }
}

/// Read a required string argument.
pub fn arg_str(args: &serde_json::Value, key: &str) -> Result<String, ToolOutcome> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            ToolOutcome::err(
                format!("Missing `{key}`"),
                format!("the `{key}` argument is required and must be a non-empty string."),
            )
        })
}

/// Read an optional string argument, treating empty strings as absent.
pub fn arg_str_opt(args: &serde_json::Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn arg_usize(args: &serde_json::Value, key: &str, default: usize, max: usize) -> usize {
    args.get(key)
        .and_then(|v| v.as_u64())
        .map(|v| v as usize)
        .filter(|v| *v > 0)
        .unwrap_or(default)
        .min(max)
}

pub fn arg_bool(args: &serde_json::Value, key: &str) -> bool {
    args.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
}

/// Trim a tool result so a single call cannot blow out the context window.
/// The head is what matters, so the tail is what goes.
pub fn cap(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let kept: String = text.chars().take(max_chars).collect();
    format!("{kept}\n\n… truncated at {max_chars} characters. Narrow the request to see more.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approver::Approver;

    fn names_for(read_only: bool, groups: ToolGroups) -> Vec<String> {
        builtin_defs(read_only, groups)
            .into_iter()
            .map(|d| d.function.name)
            .collect()
    }

    #[test]
    fn every_group_is_on_by_default() {
        let groups = ToolGroups::default();
        assert!(groups.files && groups.terminal && groups.browser);
        assert_eq!(ToolGroups::from_disabled(&[]), groups);
    }

    #[test]
    fn disabling_terminal_removes_run_command_and_nothing_else() {
        let groups = ToolGroups::from_disabled(&["terminal".into()]);
        let names = names_for(false, groups);
        assert!(!names.contains(&"run_command".to_string()), "terminal toggle must actually work");
        assert!(names.contains(&"read_file".to_string()));
        assert!(names.contains(&"fetch_url".to_string()));
    }

    #[test]
    fn disabling_files_removes_every_file_tool() {
        let names = names_for(false, ToolGroups::from_disabled(&["files".into()]));
        for tool in ["read_file", "write_file", "edit_file", "list_dir", "search_files"] {
            assert!(!names.contains(&tool.to_string()), "{tool} should be gone");
        }
        assert!(names.contains(&"run_command".to_string()));
    }

    #[test]
    fn disabling_browser_removes_the_network_tools() {
        let names = names_for(false, ToolGroups::from_disabled(&["browser".into()]));
        assert!(!names.contains(&"fetch_url".to_string()));
        assert!(!names.contains(&"web_search".to_string()));
        assert!(names.contains(&"read_file".to_string()));
    }

    #[test]
    fn disabling_everything_leaves_no_builtins() {
        let groups = ToolGroups::from_disabled(&["files".into(), "terminal".into(), "browser".into()]);
        assert!(names_for(false, groups).is_empty());
    }

    #[test]
    fn every_builtin_belongs_to_a_switchable_group() {
        for def in builtin_defs(false, ToolGroups::default()) {
            assert!(
                ToolGroups::group_of(&def.function.name).is_some(),
                "{} is in no group, so no toggle can reach it",
                def.function.name
            );
        }
    }

    #[tokio::test]
    async fn a_disabled_group_refuses_the_call_even_if_the_model_invents_it() {
        let ctx = ToolContext {
            project_root: None,
            policy: ApprovalPolicy::ApproveForMe,
            permissions: Permissions::default(),
            approver: Approver::auto_allow(),
            http: reqwest::Client::new(),
            composio: None,
            read_only: false,
            groups: ToolGroups::from_disabled(&["terminal".into()]),
        };
        let call = ToolCall {
            id: "1".into(),
            kind: "function".into(),
            function: crate::llm::FunctionCall {
                name: "run_command".into(),
                arguments: "{\"command\":\"ls\"}".into(),
            },
        };
        let out = execute(&ctx, &call).await;
        assert!(!out.ok);
        assert!(out.body.contains("switched off"), "{}", out.body);
    }

    #[test]
    fn read_only_context_hides_the_mutating_tools() {
        let names = |ro| names_for(ro, ToolGroups::default());
        let rw = names(false);
        assert!(rw.contains(&"write_file".to_string()));
        assert!(rw.contains(&"edit_file".to_string()));

        let ro = names(true);
        assert!(!ro.contains(&"write_file".to_string()));
        assert!(!ro.contains(&"edit_file".to_string()));
        assert!(ro.contains(&"read_file".to_string()), "reads must survive");
    }

    #[test]
    fn every_builtin_declares_an_object_schema() {
        for def in builtin_defs(false, ToolGroups::default()) {
            assert_eq!(def.function.parameters["type"], "object", "{}", def.function.name);
            assert!(!def.function.description.is_empty(), "{}", def.function.name);
        }
    }

    #[test]
    fn arg_helpers_reject_blank_and_missing_values() {
        let args = serde_json::json!({ "a": "x", "blank": "   ", "n": 5, "flag": true });
        assert_eq!(arg_str(&args, "a").unwrap(), "x");
        assert!(arg_str(&args, "blank").is_err());
        assert!(arg_str(&args, "absent").is_err());
        assert_eq!(arg_str_opt(&args, "blank"), None);
        assert_eq!(arg_usize(&args, "n", 1, 100), 5);
        assert_eq!(arg_usize(&args, "n", 1, 3), 3, "must clamp to max");
        assert_eq!(arg_usize(&args, "absent", 7, 100), 7);
        assert!(arg_bool(&args, "flag"));
        assert!(!arg_bool(&args, "absent"));
    }

    #[test]
    fn cap_truncates_with_an_explanatory_tail() {
        assert_eq!(cap("short", 100), "short");
        let out = cap(&"x".repeat(500), 100);
        assert!(out.starts_with(&"x".repeat(100)));
        assert!(out.contains("truncated"));
    }

    #[test]
    fn denial_tells_the_model_not_to_retry() {
        let outcome = ToolOutcome::denied("rm -rf /");
        assert!(!outcome.ok);
        assert!(outcome.body.contains("Do not retry"));
    }
}
