//! Shell execution.
//!
//! Commands run through `/bin/sh -c` in the project directory, with a hard
//! timeout and a captured, capped transcript. The command line is classified
//! by [`classify_command`](crate::approval::classify_command) before it runs,
//! so `git status` is silent under "Approve for me" while `rm -rf` prompts
//! under every policy.

use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::{arg_str, arg_str_opt, arg_usize, cap, ToolContext, ToolOutcome};
use crate::approval::{classify_command, resolve_within, ActionKind, ActionRequest};

const DEFAULT_TIMEOUT_SECS: usize = 120;
const MAX_TIMEOUT_SECS: usize = 600;
/// Per-stream capture cap. A runaway build log must not eat the context window.
const MAX_STREAM_BYTES: usize = 200_000;
const MAX_OUTPUT_CHARS: usize = 40_000;

pub async fn run_command(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    let command = match arg_str(args, "command") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let root = match ctx.root() {
        Ok(r) => r.to_path_buf(),
        Err(e) => return e,
    };

    // A subagent gets a read-only shell — the classifier already knows which
    // commands only observe, so reuse it rather than inventing a second list.
    let (risk, reason) = classify_command(&command);
    if ctx.read_only && risk != crate::approval::Risk::Safe {
        return ToolOutcome::err(
            "Read-only agent",
            format!(
                "`{command}` can modify state and subagents run read-only ({reason}). \
                 Use a read-only command, or report what the lead agent should run."
            ),
        );
    }

    let cwd = match arg_str_opt(args, "cwd") {
        Some(raw) => {
            let (resolved, inside) = resolve_within(&root, Path::new(&raw));
            if !inside {
                return ToolOutcome::err(
                    "Working directory outside the project",
                    format!("`{raw}` resolves outside the open project; commands run inside it."),
                );
            }
            resolved
        }
        None => root.clone(),
    };

    let timeout_secs = arg_usize(args, "timeout_seconds", DEFAULT_TIMEOUT_SECS, MAX_TIMEOUT_SECS);

    if let Err(denied) = ctx
        .gate(ActionRequest::new(
            ActionKind::Command,
            "Run a command",
            command.clone(),
            reason,
            risk,
        ))
        .await
    {
        return denied;
    }

    let mut child = match Command::new("/bin/sh")
        .arg("-c")
        .arg(&command)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // A command that expects a pager would otherwise hang until the
        // timeout; tell the usual suspects not to start one.
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .env("TERM", "dumb")
        .env("NO_COLOR", "1")
        .env("CI", "1")
        .kill_on_drop(true)
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            return ToolOutcome::err(
                "Could not start the command",
                format!("could not run `{command}`: {err}"),
            )
        }
    };

    let mut stdout_pipe = child.stdout.take();
    let mut stderr_pipe = child.stderr.take();

    let run = async {
        let mut out = Vec::new();
        let mut err = Vec::new();
        let read_out = async {
            if let Some(pipe) = stdout_pipe.as_mut() {
                let _ = pipe.take(MAX_STREAM_BYTES as u64).read_to_end(&mut out).await;
            }
        };
        let read_err = async {
            if let Some(pipe) = stderr_pipe.as_mut() {
                let _ = pipe.take(MAX_STREAM_BYTES as u64).read_to_end(&mut err).await;
            }
        };
        // Both pipes must be drained concurrently: a command that fills stderr
        // while we block on stdout would deadlock on the pipe buffer.
        let (_, _) = tokio::join!(read_out, read_err);
        let status = child.wait().await;
        (status, out, err)
    };

    let (status, stdout, stderr) = match tokio::time::timeout(Duration::from_secs(timeout_secs as u64), run).await {
        Ok(triple) => triple,
        Err(_) => {
            return ToolOutcome::err(
                format!("Timed out after {timeout_secs}s"),
                format!(
                    "`{command}` was still running after {timeout_secs} seconds and was killed. \
                     Re-run it with a larger timeout_seconds, or narrow what it does."
                ),
            )
        }
    };

    let code = match status {
        Ok(s) => s.code(),
        Err(err) => {
            return ToolOutcome::err(
                "Command failed",
                format!("`{command}` could not be waited on: {err}"),
            )
        }
    };

    let stdout = String::from_utf8_lossy(&stdout).to_string();
    let stderr = String::from_utf8_lossy(&stderr).to_string();

    let mut body = String::new();
    body.push_str(&format!("$ {command}\n"));
    match code {
        Some(0) => {}
        Some(c) => body.push_str(&format!("(exit code {c})\n")),
        None => body.push_str("(terminated by a signal)\n"),
    }
    if !stdout.trim().is_empty() {
        body.push_str("\n--- stdout ---\n");
        body.push_str(stdout.trim_end());
        body.push('\n');
    }
    if !stderr.trim().is_empty() {
        body.push_str("\n--- stderr ---\n");
        body.push_str(stderr.trim_end());
        body.push('\n');
    }
    if stdout.trim().is_empty() && stderr.trim().is_empty() {
        body.push_str("\n(no output)\n");
    }

    let ok = code == Some(0);
    let summary = match code {
        Some(0) => format!("Ran `{}`", short(&command)),
        Some(c) => format!("`{}` exited {c}", short(&command)),
        None => format!("`{}` was killed", short(&command)),
    };

    ToolOutcome {
        body: cap(&body, MAX_OUTPUT_CHARS),
        summary,
        ok,
    }
}

/// Shorten a command for the one-line activity summary.
fn short(command: &str) -> String {
    let one_line = command.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() <= 60 {
        one_line
    } else {
        format!("{}…", one_line.chars().take(59).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approver::Approver;
    use crate::config::{ApprovalPolicy, Permissions};

    fn ctx_for(root: &Path, read_only: bool, approver: Approver) -> ToolContext {
        ToolContext {
            project_root: Some(root.to_path_buf()),
            policy: ApprovalPolicy::ApproveForMe,
            permissions: Permissions::default(),
            approver,
            http: reqwest::Client::new(),
            composio: None,
            read_only,
            groups: Default::default(),
        }
    }

    #[tokio::test]
    async fn runs_a_command_and_captures_stdout() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_allow());
        let out = run_command(&ctx, &serde_json::json!({ "command": "echo hello" })).await;
        assert!(out.ok, "{}", out.body);
        assert!(out.body.contains("hello"));
        assert!(out.body.contains("$ echo hello"));
    }

    #[tokio::test]
    async fn a_non_zero_exit_is_reported_but_not_an_error_to_recover_from() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_allow());
        let out = run_command(&ctx, &serde_json::json!({ "command": "exit 3" })).await;
        assert!(!out.ok);
        assert!(out.body.contains("exit code 3"));
        assert!(out.summary.contains("exited 3"));
    }

    #[tokio::test]
    async fn captures_stderr_separately() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_allow());
        let out = run_command(&ctx, &serde_json::json!({ "command": "echo oops 1>&2" })).await;
        assert!(out.body.contains("--- stderr ---"));
        assert!(out.body.contains("oops"));
    }

    #[tokio::test]
    async fn runs_in_the_project_directory_by_default() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_allow());
        let out = run_command(&ctx, &serde_json::json!({ "command": "ls" })).await;
        assert!(out.body.contains("marker.txt"));
    }

    #[tokio::test]
    async fn refuses_a_cwd_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_allow());
        let out = run_command(&ctx, &serde_json::json!({ "command": "ls", "cwd": "../.." })).await;
        assert!(!out.ok);
        assert!(out.summary.contains("outside the project"));
    }

    #[tokio::test]
    async fn kills_a_command_that_overruns_its_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_allow());
        let out = run_command(&ctx, &serde_json::json!({
            "command": "sleep 5", "timeout_seconds": 1
        })).await;
        assert!(!out.ok);
        assert!(out.summary.contains("Timed out"));
    }

    #[tokio::test]
    async fn a_denied_command_never_runs() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), false, Approver::auto_deny());
        let marker = dir.path().join("should-not-exist.txt");
        let out = run_command(&ctx, &serde_json::json!({
            "command": format!("touch {}", marker.display())
        })).await;
        assert!(!out.ok);
        assert!(!marker.exists(), "a denied command must not have run");
    }

    #[tokio::test]
    async fn read_only_agents_may_observe_but_not_mutate() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = ctx_for(dir.path(), true, Approver::auto_allow());

        let out = run_command(&ctx, &serde_json::json!({ "command": "echo ok" })).await;
        assert!(out.ok, "read-only commands must still work: {}", out.body);

        let out = run_command(&ctx, &serde_json::json!({ "command": "touch new.txt" })).await;
        assert!(!out.ok);
        assert!(!dir.path().join("new.txt").exists());
    }

    #[test]
    fn summaries_stay_one_line_and_bounded() {
        assert_eq!(short("git   status"), "git status");
        let long = short(&"x".repeat(200));
        assert!(long.chars().count() <= 60, "got {}", long.chars().count());
    }
}
