//! Filesystem tools, sandboxed to the open project.
//!
//! Every path argument goes through [`resolve`], which normalises `..`,
//! resolves symlinks, and reports whether the result stayed inside the project.
//! Escaping the project is not forbidden outright — a user may legitimately
//! want the agent to read a file next door — but it is always classified and
//! sent through the approval gate.

use std::path::{Path, PathBuf};

use ignore::WalkBuilder;

use super::{arg_bool, arg_str, arg_str_opt, arg_usize, cap, ToolContext, ToolOutcome};
use crate::approval::{classify_path, resolve_within, ActionKind, ActionRequest};

/// Refuse to load anything larger than this into model context.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_READ_CHARS: usize = 120_000;
const DEFAULT_READ_LINES: usize = 400;
const MAX_READ_LINES: usize = 4_000;
const MAX_LIST_ENTRIES: usize = 500;
const MAX_SEARCH_RESULTS: usize = 400;

/// Resolve a user-supplied path against the project root and gate it.
async fn resolve(
    ctx: &ToolContext,
    raw: &str,
    write: bool,
) -> Result<PathBuf, ToolOutcome> {
    let root = ctx.root()?;
    let (path, _inside) = resolve_within(root, Path::new(raw));
    let (risk, reason) = classify_path(Some(root), &path, write);

    ctx.gate(ActionRequest::new(
        if write { ActionKind::FileWrite } else { ActionKind::FileRead },
        if write { "Write a file" } else { "Read a file" },
        path.to_string_lossy().to_string(),
        reason,
        risk,
    ))
    .await?;

    Ok(path)
}

/// Display a path relative to the project when possible — absolute paths are
/// noise in a transcript that is already scoped to one folder.
fn display(ctx: &ToolContext, path: &Path) -> String {
    ctx.project_root
        .as_deref()
        .and_then(|root| path.strip_prefix(root).ok())
        .map(|rel| rel.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

pub async fn read_file(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    let raw = match arg_str(args, "path") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let path = match resolve(ctx, &raw, false).await {
        Ok(p) => p,
        Err(e) => return e,
    };

    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(err) => {
            return ToolOutcome::err(
                format!("Could not read {}", display(ctx, &path)),
                format!("could not open `{}`: {err}", display(ctx, &path)),
            )
        }
    };
    if meta.is_dir() {
        return ToolOutcome::err(
            format!("{} is a directory", display(ctx, &path)),
            format!("`{}` is a directory — use list_dir instead.", display(ctx, &path)),
        );
    }
    if meta.len() > MAX_FILE_BYTES {
        return ToolOutcome::err(
            format!("{} is too large", display(ctx, &path)),
            format!(
                "`{}` is {} bytes, over the {MAX_FILE_BYTES}-byte limit. Use search_files to find \
                 the part you need, then read it with offset and limit.",
                display(ctx, &path),
                meta.len()
            ),
        );
    }

    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(err) => {
            return ToolOutcome::err(
                format!("Could not read {}", display(ctx, &path)),
                format!("could not read `{}`: {err}", display(ctx, &path)),
            )
        }
    };
    // A NUL byte in the first block is the standard binary heuristic; without
    // it a stray image would arrive as thousands of replacement characters.
    if bytes.iter().take(8_000).any(|b| *b == 0) {
        return ToolOutcome::err(
            format!("{} is binary", display(ctx, &path)),
            format!("`{}` looks like a binary file and cannot be read as text.", display(ctx, &path)),
        );
    }

    let text = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = text.lines().collect();
    let total = lines.len();
    let offset = arg_usize(args, "offset", 1, total.max(1));
    let limit = arg_usize(args, "limit", DEFAULT_READ_LINES, MAX_READ_LINES);
    let start = offset.saturating_sub(1);

    if start >= total && total > 0 {
        return ToolOutcome::err(
            format!("{} has only {total} lines", display(ctx, &path)),
            format!("offset {offset} is past the end of the file ({total} lines)."),
        );
    }

    let slice: Vec<String> = lines
        .iter()
        .enumerate()
        .skip(start)
        .take(limit)
        .map(|(i, line)| format!("{:>6}\t{}", i + 1, line))
        .collect();
    let shown = slice.len();
    let mut body = slice.join("\n");
    if start + shown < total {
        body.push_str(&format!(
            "\n\n… {} more lines. Read them with offset {}.",
            total - (start + shown),
            start + shown + 1
        ));
    }

    ToolOutcome::ok(
        format!("Read {} · {shown} of {total} lines", display(ctx, &path)),
        cap(&body, MAX_READ_CHARS),
    )
}

pub async fn list_dir(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    let raw = arg_str_opt(args, "path").unwrap_or_else(|| ".".to_string());
    let path = match resolve(ctx, &raw, false).await {
        Ok(p) => p,
        Err(e) => return e,
    };

    let entries = match std::fs::read_dir(&path) {
        Ok(e) => e,
        Err(err) => {
            return ToolOutcome::err(
                format!("Could not list {}", display(ctx, &path)),
                format!("could not list `{}`: {err}", display(ctx, &path)),
            )
        }
    };

    let mut dirs = Vec::new();
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // `.git` is never interesting and is enormous.
        if name == ".git" || name == "node_modules" || name == "target" {
            dirs.push(format!("{name}/  (skipped — not searched by default)"));
            continue;
        }
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            dirs.push(format!("{name}/"));
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            files.push(format!("{name}  ({size} bytes)"));
        }
    }
    dirs.sort();
    files.sort();
    let total = dirs.len() + files.len();
    let listing: Vec<String> = dirs.into_iter().chain(files).take(MAX_LIST_ENTRIES).collect();

    let mut body = listing.join("\n");
    if total > MAX_LIST_ENTRIES {
        body.push_str(&format!("\n\n… {} more entries.", total - MAX_LIST_ENTRIES));
    }
    if body.is_empty() {
        body = "(empty directory)".into();
    }

    ToolOutcome::ok(format!("Listed {} · {total} entries", display(ctx, &path)), body)
}

pub async fn search_files(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    let pattern = match arg_str(args, "pattern") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let regex = match regex::RegexBuilder::new(&pattern).case_insensitive(false).build() {
        Ok(r) => r,
        Err(err) => {
            return ToolOutcome::err(
                "Invalid search pattern",
                format!("`{pattern}` is not a valid regular expression: {err}"),
            )
        }
    };

    let raw = arg_str_opt(args, "path").unwrap_or_else(|| ".".to_string());
    let root = match resolve(ctx, &raw, false).await {
        Ok(p) => p,
        Err(e) => return e,
    };
    let max_results = arg_usize(args, "max_results", 80, MAX_SEARCH_RESULTS);
    let glob = arg_str_opt(args, "glob");

    let mut builder = WalkBuilder::new(&root);
    // Respect .gitignore, and never descend into the usual dependency swamps.
    builder
        .hidden(false)
        .git_ignore(true)
        .git_global(false)
        .filter_entry(|e| {
            !matches!(
                e.file_name().to_string_lossy().as_ref(),
                ".git" | "node_modules" | "target" | "dist" | ".next" | "vendor"
            )
        });

    let matcher = glob.as_deref().map(glob_to_regex).transpose();
    let matcher = match matcher {
        Ok(m) => m,
        Err(err) => return ToolOutcome::err("Invalid glob", err),
    };

    let mut hits = Vec::new();
    let mut files_scanned = 0usize;
    let mut truncated = false;

    'walk: for entry in builder.build().flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        if let Some(m) = &matcher {
            let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if !m.is_match(&name) {
                continue;
            }
        }
        let Ok(meta) = path.metadata() else { continue };
        if meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(bytes) = std::fs::read(path) else { continue };
        if bytes.iter().take(4_000).any(|b| *b == 0) {
            continue;
        }
        files_scanned += 1;
        let text = String::from_utf8_lossy(&bytes);
        for (i, line) in text.lines().enumerate() {
            if regex.is_match(line) {
                hits.push(format!(
                    "{}:{}: {}",
                    display(ctx, path),
                    i + 1,
                    line.trim_end().chars().take(240).collect::<String>()
                ));
                if hits.len() >= max_results {
                    truncated = true;
                    break 'walk;
                }
            }
        }
    }

    if hits.is_empty() {
        return ToolOutcome::ok(
            format!("No matches for `{pattern}`"),
            format!("no matches for `{pattern}` across {files_scanned} files."),
        );
    }

    let mut body = hits.join("\n");
    if truncated {
        body.push_str(&format!(
            "\n\n… stopped at {max_results} matches. Narrow the pattern or pass a `path`."
        ));
    }
    ToolOutcome::ok(
        format!("{} match{} for `{pattern}`", hits.len(), if hits.len() == 1 { "" } else { "es" }),
        cap(&body, MAX_READ_CHARS),
    )
}

pub async fn write_file(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    if ctx.read_only {
        return read_only_refusal("write_file");
    }
    let raw = match arg_str(args, "path") {
        Ok(v) => v,
        Err(e) => return e,
    };
    // `content` may legitimately be empty — truncating a file is a real edit —
    // so it is read directly rather than through the non-empty helper.
    let Some(content) = args.get("content").and_then(|v| v.as_str()) else {
        return ToolOutcome::err(
            "Missing `content`",
            "the `content` argument is required and must be a string.",
        );
    };

    let path = match resolve(ctx, &raw, true).await {
        Ok(p) => p,
        Err(e) => return e,
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            return ToolOutcome::err(
                format!("Could not write {}", display(ctx, &path)),
                format!("could not create `{}`: {err}", parent.display()),
            );
        }
    }
    let existed = path.exists();
    if let Err(err) = std::fs::write(&path, content) {
        return ToolOutcome::err(
            format!("Could not write {}", display(ctx, &path)),
            format!("could not write `{}`: {err}", display(ctx, &path)),
        );
    }

    let lines = content.lines().count();
    ToolOutcome::ok(
        format!(
            "{} {} · {lines} lines",
            if existed { "Replaced" } else { "Created" },
            display(ctx, &path)
        ),
        format!(
            "{} `{}` ({lines} lines, {} bytes).",
            if existed { "Replaced" } else { "Created" },
            display(ctx, &path),
            content.len()
        ),
    )
}

pub async fn edit_file(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    if ctx.read_only {
        return read_only_refusal("edit_file");
    }
    let raw = match arg_str(args, "path") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let old = match arg_str(args, "old_string") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let Some(new) = args.get("new_string").and_then(|v| v.as_str()) else {
        return ToolOutcome::err(
            "Missing `new_string`",
            "the `new_string` argument is required and must be a string.",
        );
    };
    if old == new {
        return ToolOutcome::err(
            "Edit is a no-op",
            "`old_string` and `new_string` are identical — nothing to do.",
        );
    }
    let replace_all = arg_bool(args, "replace_all");

    let path = match resolve(ctx, &raw, true).await {
        Ok(p) => p,
        Err(e) => return e,
    };
    let current = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(err) => {
            return ToolOutcome::err(
                format!("Could not read {}", display(ctx, &path)),
                format!("could not read `{}` to edit it: {err}", display(ctx, &path)),
            )
        }
    };

    let occurrences = current.matches(&old).count();
    if occurrences == 0 {
        return ToolOutcome::err(
            format!("No match in {}", display(ctx, &path)),
            format!(
                "`old_string` does not appear in `{}`. Read the file again and copy the target text \
                 exactly, including indentation.",
                display(ctx, &path)
            ),
        );
    }
    if occurrences > 1 && !replace_all {
        return ToolOutcome::err(
            format!("{occurrences} matches in {}", display(ctx, &path)),
            format!(
                "`old_string` appears {occurrences} times in `{}`. Include more surrounding context to \
                 make it unique, or pass replace_all: true.",
                display(ctx, &path)
            ),
        );
    }

    let updated = if replace_all {
        current.replace(&old, new)
    } else {
        current.replacen(&old, new, 1)
    };
    if let Err(err) = std::fs::write(&path, &updated) {
        return ToolOutcome::err(
            format!("Could not write {}", display(ctx, &path)),
            format!("could not write `{}`: {err}", display(ctx, &path)),
        );
    }

    let replaced = if replace_all { occurrences } else { 1 };
    ToolOutcome::ok(
        format!("Edited {} · {replaced} replacement{}", display(ctx, &path), if replaced == 1 { "" } else { "s" }),
        format!("made {replaced} replacement(s) in `{}`.", display(ctx, &path)),
    )
}

fn read_only_refusal(tool: &str) -> ToolOutcome {
    ToolOutcome::err(
        "Read-only agent",
        format!(
            "`{tool}` is not available to a subagent — subagents investigate and report, and the lead \
             agent applies changes. Describe the edit you would make instead."
        ),
    )
}

/// Translate a shell glob into an anchored regex. Only `*` and `?` are
/// supported, which covers `*.rs` and `test_?.py`; everything else is escaped.
fn glob_to_regex(glob: &str) -> Result<regex::Regex, String> {
    let mut pattern = String::from("^");
    for ch in glob.chars() {
        match ch {
            '*' => pattern.push_str("[^/]*"),
            '?' => pattern.push_str("[^/]"),
            other => pattern.push_str(&regex::escape(&other.to_string())),
        }
    }
    pattern.push('$');
    regex::Regex::new(&pattern).map_err(|e| format!("`{glob}` is not a usable glob: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approver::Approver;
    use crate::config::{ApprovalPolicy, Permissions};

    fn ctx_for(root: &Path, read_only: bool) -> ToolContext {
        ToolContext {
            project_root: Some(root.to_path_buf()),
            policy: ApprovalPolicy::ApproveForMe,
            permissions: Permissions::default(),
            approver: Approver::auto_allow(),
            http: reqwest::Client::new(),
            composio: None,
            read_only,
            groups: Default::default(),
        }
    }

    fn temp_project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "alpha\nbeta\ngamma\n").unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/lib.rs"), "fn hello() {}\nfn world() {}\n").unwrap();
        dir
    }

    #[tokio::test]
    async fn reads_a_file_with_line_numbers() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = read_file(&ctx, &serde_json::json!({ "path": "a.txt" })).await;
        assert!(out.ok, "{}", out.body);
        assert!(out.body.contains("     1\talpha"));
        assert!(out.body.contains("     3\tgamma"));
    }

    #[tokio::test]
    async fn read_paginates_with_offset_and_limit() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = read_file(&ctx, &serde_json::json!({ "path": "a.txt", "offset": 2, "limit": 1 })).await;
        assert!(out.body.contains("     2\tbeta"));
        assert!(!out.body.contains("alpha"));
        assert!(out.body.contains("1 more lines"));
    }

    #[tokio::test]
    async fn read_rejects_a_directory_with_a_useful_pointer() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = read_file(&ctx, &serde_json::json!({ "path": "src" })).await;
        assert!(!out.ok);
        assert!(out.body.contains("list_dir"));
    }

    #[tokio::test]
    async fn read_detects_binary_files() {
        let dir = temp_project();
        std::fs::write(dir.path().join("blob.bin"), [0x00, 0x01, 0x02, 0x00]).unwrap();
        let ctx = ctx_for(dir.path(), false);
        let out = read_file(&ctx, &serde_json::json!({ "path": "blob.bin" })).await;
        assert!(!out.ok);
        assert!(out.body.contains("binary"));
    }

    #[tokio::test]
    async fn writes_and_then_reads_back() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = write_file(&ctx, &serde_json::json!({ "path": "nested/new.txt", "content": "hi\n" })).await;
        assert!(out.ok, "{}", out.body);
        assert_eq!(std::fs::read_to_string(dir.path().join("nested/new.txt")).unwrap(), "hi\n");
        assert!(out.summary.starts_with("Created"));
    }

    #[tokio::test]
    async fn writing_an_empty_file_is_allowed() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = write_file(&ctx, &serde_json::json!({ "path": "empty.txt", "content": "" })).await;
        assert!(out.ok, "empty content is a valid truncation: {}", out.body);
    }

    #[tokio::test]
    async fn edit_requires_a_unique_match_unless_replace_all() {
        let dir = temp_project();
        std::fs::write(dir.path().join("dup.txt"), "x\nx\n").unwrap();
        let ctx = ctx_for(dir.path(), false);

        let out = edit_file(&ctx, &serde_json::json!({ "path": "dup.txt", "old_string": "x", "new_string": "y" })).await;
        assert!(!out.ok);
        assert!(out.body.contains("replace_all"));

        let out = edit_file(&ctx, &serde_json::json!({
            "path": "dup.txt", "old_string": "x", "new_string": "y", "replace_all": true
        })).await;
        assert!(out.ok, "{}", out.body);
        assert_eq!(std::fs::read_to_string(dir.path().join("dup.txt")).unwrap(), "y\ny\n");
    }

    #[tokio::test]
    async fn edit_reports_a_missing_match_instead_of_writing() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = edit_file(&ctx, &serde_json::json!({
            "path": "a.txt", "old_string": "not-there", "new_string": "z"
        })).await;
        assert!(!out.ok);
        assert_eq!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap(), "alpha\nbeta\ngamma\n");
    }

    #[tokio::test]
    async fn a_read_only_context_refuses_to_mutate() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), true);
        let out = write_file(&ctx, &serde_json::json!({ "path": "x.txt", "content": "no" })).await;
        assert!(!out.ok);
        assert!(!dir.path().join("x.txt").exists());

        let out = edit_file(&ctx, &serde_json::json!({
            "path": "a.txt", "old_string": "alpha", "new_string": "omega"
        })).await;
        assert!(!out.ok);
        assert!(std::fs::read_to_string(dir.path().join("a.txt")).unwrap().contains("alpha"));
    }

    #[tokio::test]
    async fn a_refused_write_leaves_the_file_untouched() {
        let dir = temp_project();
        let mut ctx = ctx_for(dir.path(), false);
        // Force every action to prompt, and refuse.
        ctx.policy = ApprovalPolicy::Custom;
        ctx.approver = Approver::auto_deny();

        let escape = dir.path().parent().unwrap().join("escape.txt");
        let out = write_file(&ctx, &serde_json::json!({ "path": "../escape.txt", "content": "nope" })).await;
        assert!(!out.ok);
        assert!(!escape.exists(), "a refused write must not have happened");
        // No human was asked, so it must not claim the user declined.
        assert_eq!(out.summary, "Out of scope");
        assert!(!out.body.contains("user declined"));
    }

    #[tokio::test]
    async fn search_finds_matches_with_file_and_line() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = search_files(&ctx, &serde_json::json!({ "pattern": "fn (hello|world)" })).await;
        assert!(out.ok, "{}", out.body);
        assert!(out.body.contains("src/lib.rs:1"));
        assert!(out.body.contains("src/lib.rs:2"));
    }

    #[tokio::test]
    async fn search_respects_a_glob_filter() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = search_files(&ctx, &serde_json::json!({ "pattern": "a", "glob": "*.rs" })).await;
        assert!(!out.body.contains("a.txt"), "glob should exclude the txt file");
    }

    #[tokio::test]
    async fn search_reports_an_invalid_regex_rather_than_panicking() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = search_files(&ctx, &serde_json::json!({ "pattern": "((unclosed" })).await;
        assert!(!out.ok);
        assert!(out.summary.contains("Invalid search pattern"));
    }

    #[tokio::test]
    async fn search_reports_zero_matches_as_success() {
        let dir = temp_project();
        let ctx = ctx_for(dir.path(), false);
        let out = search_files(&ctx, &serde_json::json!({ "pattern": "zzz-not-present" })).await;
        assert!(out.ok, "an empty result set is a valid answer, not an error");
        assert!(out.body.contains("no matches"));
    }

    #[tokio::test]
    async fn list_dir_marks_directories_and_skips_heavy_ones() {
        let dir = temp_project();
        std::fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        let ctx = ctx_for(dir.path(), false);
        let out = list_dir(&ctx, &serde_json::json!({})).await;
        assert!(out.ok, "{}", out.body);
        assert!(out.body.contains("src/"));
        assert!(out.body.contains("node_modules/  (skipped"));
    }

    #[tokio::test]
    async fn tools_explain_themselves_when_no_project_is_open() {
        let ctx = ToolContext {
            project_root: None,
            ..ctx_for(Path::new("/tmp"), false)
        };
        let out = read_file(&ctx, &serde_json::json!({ "path": "a.txt" })).await;
        assert!(!out.ok);
        assert!(out.body.contains("no project folder is open"));
    }

    #[test]
    fn globs_translate_to_anchored_regexes() {
        let re = glob_to_regex("*.rs").unwrap();
        assert!(re.is_match("main.rs"));
        assert!(!re.is_match("main.rs.bak"));
        let re = glob_to_regex("test_?.py").unwrap();
        assert!(re.is_match("test_1.py"));
        assert!(!re.is_match("test_12.py"));
    }
}
