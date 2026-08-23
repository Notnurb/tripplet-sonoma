//! OpenAI-compatible chat client with SSE streaming and tool calling.
//!
//! One client serves the whole app: the foreground agent streams through
//! [`LlmClient::stream`], and every subagent in an Ultra fleet uses
//! [`LlmClient::complete`], which is the same path with the deltas discarded.
//!
//! Streaming tool calls arrive fragmented — the name lands on the first chunk
//! and `arguments` dribbles in as JSON text across many more — so calls are
//! accumulated by their `index` and only assembled once the stream ends.

use std::collections::BTreeMap;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Ultra-tier turns legitimately run for minutes; the cap exists to stop a
/// wedged connection from pinning a task forever, not to bound thinking time.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(600);

// ─────────────────────────── Wire types ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FunctionCall {
    pub name: String,
    /// Raw JSON text, exactly as the model emitted it. Parsed at execution
    /// time so a malformed blob becomes a tool error the model can recover
    /// from, rather than a hard failure of the whole turn.
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionCall,
}

impl ToolCall {
    pub fn function_name(&self) -> &str {
        &self.function.name
    }

    /// Parse `arguments` into a JSON object. An empty string means "no
    /// arguments", which some backends emit instead of `{}`.
    pub fn parsed_arguments(&self) -> Result<serde_json::Value> {
        let raw = self.function.arguments.trim();
        if raw.is_empty() {
            return Ok(serde_json::Value::Object(Default::default()));
        }
        serde_json::from_str(raw)
            .with_context(|| format!("tool `{}` sent arguments that are not valid JSON", self.function.name))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: "system".into(), content: Some(content.into()), ..Default::default() }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user".into(), content: Some(content.into()), ..Default::default() }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant".into(), content: Some(content.into()), ..Default::default() }
    }

    pub fn assistant_tool_calls(content: String, calls: Vec<ToolCall>) -> Self {
        Self {
            role: "assistant".into(),
            // OpenAI-compatible backends reject an assistant turn with both an
            // empty string and tool calls; send null content instead.
            content: if content.is_empty() { None } else { Some(content) },
            tool_calls: Some(calls),
            ..Default::default()
        }
    }

    pub fn tool_result(call_id: impl Into<String>, name: impl Into<String>, body: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: Some(body.into()),
            tool_call_id: Some(call_id.into()),
            name: Some(name.into()),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolDef {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub function: ToolFunctionDef,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

impl ToolDef {
    pub fn new(name: impl Into<String>, description: impl Into<String>, parameters: serde_json::Value) -> Self {
        Self {
            kind: "function",
            function: ToolFunctionDef {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u32,
    #[serde(default)]
    pub completion_tokens: u32,
    #[serde(default)]
    pub total_tokens: u32,
}

#[derive(Debug, Clone)]
pub struct CompletionRequest {
    /// Upstream model name, already resolved from a persona id.
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolDef>,
    pub temperature: f32,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Default)]
pub struct CompletionResult {
    pub content: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: String,
    pub usage: Usage,
}

/// A streamed fragment. Reasoning is surfaced separately so the UI can render
/// it in the collapsed "thinking" strip instead of the answer body.
#[derive(Debug, Clone)]
pub enum Delta {
    Content(String),
    Reasoning(String),
    /// A tool call's name became known — lets the UI show "Reading file…"
    /// before the arguments have finished arriving.
    ToolCallStarted { id: String, name: String },
}

// ─────────────────────────── Client ───────────────────────────

#[derive(Clone)]
pub struct LlmClient {
    gateway: crate::gateway::Gateway,
}

impl LlmClient {
    pub fn new(gateway: crate::gateway::Gateway) -> Self {
        Self { gateway }
    }

    /// Build the HTTP client the gateway rides on. Separate from `new` so the
    /// same connection pool can be shared with the rest of the app.
    pub fn http_client() -> Result<reqwest::Client> {
        reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .user_agent(concat!("TrippletComputer/", env!("CARGO_PKG_VERSION")))
            .build()
            .context("could not build the HTTP client")
    }

    /// Stream a completion, invoking `on_delta` for every fragment.
    pub async fn stream<F>(&self, req: CompletionRequest, mut on_delta: F) -> Result<CompletionResult>
    where
        F: FnMut(Delta) + Send,
    {
        let body = self.build_body(&req, true);
        // Registration, signing and token refresh all happen inside the
        // gateway — there is no user-supplied key on this path at all.
        let res = self.gateway.post("/chat/completions", &body).await?;

        if !res.status().is_success() {
            return Err(upstream_error(res).await);
        }

        let mut acc = StreamAccumulator::default();
        let mut buffer = String::new();
        let mut stream = res.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("the model stream was interrupted")?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            // SSE events are separated by a blank line, but every backend we
            // target emits exactly one `data:` line per event, so splitting on
            // newlines and ignoring the blanks is both simpler and tolerant of
            // \r\n framing.
            while let Some(idx) = buffer.find('\n') {
                let line: String = buffer.drain(..=idx).collect();
                let line = line.trim_end_matches(['\r', '\n']);
                let Some(payload) = line.strip_prefix("data:") else {
                    continue;
                };
                let payload = payload.trim();
                if payload.is_empty() {
                    continue;
                }
                if payload == "[DONE]" {
                    return Ok(acc.finish());
                }
                match serde_json::from_str::<StreamChunk>(payload) {
                    Ok(parsed) => acc.push(parsed, &mut on_delta),
                    Err(err) => {
                        // A single unparseable frame is not worth killing a
                        // long turn over — log it and keep reading.
                        tracing::debug!(%err, payload, "skipping unparseable stream frame");
                    }
                }
            }
        }

        Ok(acc.finish())
    }

    /// Non-streaming convenience wrapper. Used by every subagent — nobody is
    /// watching their tokens arrive, so the deltas are dropped.
    pub async fn complete(&self, req: CompletionRequest) -> Result<CompletionResult> {
        self.stream(req, |_| {}).await
    }

    fn build_body(&self, req: &CompletionRequest, stream: bool) -> serde_json::Value {
        let mut body = serde_json::json!({
            "model": req.model,
            "messages": req.messages,
            "temperature": req.temperature,
            "max_tokens": req.max_tokens,
            "stream": stream,
        });
        if !req.tools.is_empty() {
            body["tools"] = serde_json::to_value(&req.tools).unwrap_or(serde_json::Value::Null);
            body["tool_choice"] = serde_json::Value::String("auto".into());
        }
        body
    }
}

/// Turn a non-2xx response into an error message a user can act on, without
/// echoing an entire HTML error page into the UI.
async fn upstream_error(res: reqwest::Response) -> anyhow::Error {
    let status = res.status();
    let raw = res.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message").or(Some(e)))
                .or_else(|| v.get("message"))
                .map(|m| m.as_str().map(str::to_string).unwrap_or_else(|| m.to_string()))
        })
        .unwrap_or_else(|| raw.chars().take(300).collect());

    match status.as_u16() {
        401 | 403 => anyhow!("The model gateway rejected the API key ({status}). Check Settings."),
        429 => anyhow!("Rate limited by the model gateway. Try again shortly."),
        _ if detail.is_empty() => anyhow!("The model gateway returned {status}."),
        _ => anyhow!("The model gateway returned {status}: {detail}"),
    }
}

// ─────────────────────── Stream accumulation ───────────────────────

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<StreamChoice>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
    /// Reasoning models expose their scratchpad under one of these two keys
    /// depending on the backend; accept either.
    #[serde(default)]
    reasoning: Option<String>,
    #[serde(default)]
    reasoning_content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<StreamToolCall>>,
}

#[derive(Debug, Deserialize)]
struct StreamToolCall {
    #[serde(default)]
    index: Option<u32>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<StreamFunction>,
}

#[derive(Debug, Deserialize)]
struct StreamFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Default)]
struct PartialCall {
    id: String,
    name: String,
    arguments: String,
    announced: bool,
}

#[derive(Default)]
struct StreamAccumulator {
    content: String,
    reasoning: String,
    finish_reason: String,
    usage: Usage,
    /// Keyed by the upstream `index` so out-of-order frames still land in the
    /// right call. BTreeMap keeps the final ordering stable.
    calls: BTreeMap<u32, PartialCall>,
}

impl StreamAccumulator {
    fn push<F: FnMut(Delta)>(&mut self, chunk: StreamChunk, on_delta: &mut F) {
        if let Some(usage) = chunk.usage {
            self.usage = usage;
        }
        let Some(choice) = chunk.choices.into_iter().next() else {
            return;
        };
        if let Some(reason) = choice.finish_reason {
            self.finish_reason = reason;
        }
        if let Some(text) = choice.delta.content.filter(|t| !t.is_empty()) {
            self.content.push_str(&text);
            on_delta(Delta::Content(text));
        }
        if let Some(text) = choice
            .delta
            .reasoning
            .or(choice.delta.reasoning_content)
            .filter(|t| !t.is_empty())
        {
            self.reasoning.push_str(&text);
            on_delta(Delta::Reasoning(text));
        }
        for tc in choice.delta.tool_calls.unwrap_or_default() {
            let index = tc.index.unwrap_or(0);
            let entry = self.calls.entry(index).or_default();
            if let Some(id) = tc.id {
                if !id.is_empty() {
                    entry.id = id;
                }
            }
            if let Some(func) = tc.function {
                if let Some(name) = func.name {
                    if !name.is_empty() {
                        entry.name.push_str(&name);
                    }
                }
                if let Some(args) = func.arguments {
                    entry.arguments.push_str(&args);
                }
            }
            if !entry.announced && !entry.name.is_empty() {
                entry.announced = true;
                let id = if entry.id.is_empty() {
                    format!("call_{index}")
                } else {
                    entry.id.clone()
                };
                on_delta(Delta::ToolCallStarted { id, name: entry.name.clone() });
            }
        }
    }

    fn finish(self) -> CompletionResult {
        let tool_calls = self
            .calls
            .into_iter()
            .filter(|(_, c)| !c.name.is_empty())
            .map(|(index, c)| ToolCall {
                // Some backends omit ids entirely in streaming mode; synthesise
                // a stable one so the tool-result message can reference it.
                id: if c.id.is_empty() { format!("call_{index}") } else { c.id },
                kind: "function".into(),
                function: FunctionCall { name: c.name, arguments: c.arguments },
            })
            .collect::<Vec<_>>();

        let finish_reason = if !self.finish_reason.is_empty() {
            self.finish_reason
        } else if tool_calls.is_empty() {
            "stop".into()
        } else {
            "tool_calls".into()
        };

        CompletionResult {
            content: self.content,
            reasoning: self.reasoning,
            tool_calls,
            finish_reason,
            usage: self.usage,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(frames: &[&str]) -> (CompletionResult, Vec<String>) {
        let mut acc = StreamAccumulator::default();
        let mut seen = Vec::new();
        let mut sink = |d: Delta| match d {
            Delta::Content(t) => seen.push(format!("c:{t}")),
            Delta::Reasoning(t) => seen.push(format!("r:{t}")),
            Delta::ToolCallStarted { name, .. } => seen.push(format!("t:{name}")),
        };
        for frame in frames {
            let parsed: StreamChunk = serde_json::from_str(frame).unwrap();
            acc.push(parsed, &mut sink);
        }
        (acc.finish(), seen)
    }

    #[test]
    fn accumulates_plain_content() {
        let (res, deltas) = feed(&[
            r#"{"choices":[{"delta":{"content":"Hel"}}]}"#,
            r#"{"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":7}}"#,
        ]);
        assert_eq!(res.content, "Hello");
        assert_eq!(res.finish_reason, "stop");
        assert_eq!(res.usage.total_tokens, 7);
        assert_eq!(deltas, vec!["c:Hel", "c:lo"]);
    }

    #[test]
    fn reassembles_tool_call_arguments_split_across_frames() {
        let (res, deltas) = feed(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"read_file","arguments":"{\"pa"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\":\"a.txt\"}"}}]}}]}"#,
        ]);
        assert_eq!(res.tool_calls.len(), 1);
        let call = &res.tool_calls[0];
        assert_eq!(call.id, "call_a");
        assert_eq!(call.function.name, "read_file");
        assert_eq!(call.parsed_arguments().unwrap()["path"], "a.txt");
        assert_eq!(res.finish_reason, "tool_calls");
        // Announced exactly once, on the frame that first carried the name.
        assert_eq!(deltas, vec!["t:read_file"]);
    }

    #[test]
    fn keeps_parallel_tool_calls_separate_and_ordered() {
        let (res, _) = feed(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":1,"id":"b","function":{"name":"second","arguments":"{}"}}]}}]}"#,
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"a","function":{"name":"first","arguments":"{}"}}]}}]}"#,
        ]);
        let names: Vec<_> = res.tool_calls.iter().map(|c| c.function.name.as_str()).collect();
        assert_eq!(names, vec!["first", "second"], "BTreeMap must restore index order");
    }

    #[test]
    fn synthesises_an_id_when_the_backend_omits_one() {
        let (res, _) = feed(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":3,"function":{"name":"run","arguments":"{}"}}]}}]}"#,
        ]);
        assert_eq!(res.tool_calls[0].id, "call_3");
    }

    #[test]
    fn captures_reasoning_under_either_key() {
        let (res, deltas) = feed(&[
            r#"{"choices":[{"delta":{"reasoning":"step one. "}}]}"#,
            r#"{"choices":[{"delta":{"reasoning_content":"step two."}}]}"#,
        ]);
        assert_eq!(res.reasoning, "step one. step two.");
        assert!(res.content.is_empty());
        assert_eq!(deltas, vec!["r:step one. ", "r:step two."]);
    }

    #[test]
    fn drops_tool_calls_that_never_got_a_name() {
        let (res, _) = feed(&[
            r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}"#,
        ]);
        assert!(res.tool_calls.is_empty());
    }

    #[test]
    fn empty_arguments_parse_as_an_empty_object() {
        let call = ToolCall {
            id: "x".into(),
            kind: "function".into(),
            function: FunctionCall { name: "noop".into(), arguments: "  ".into() },
        };
        assert_eq!(call.parsed_arguments().unwrap(), serde_json::json!({}));
    }

    #[test]
    fn malformed_arguments_surface_as_an_error_naming_the_tool() {
        let call = ToolCall {
            id: "x".into(),
            kind: "function".into(),
            function: FunctionCall { name: "read_file".into(), arguments: "{oops".into() },
        };
        let err = call.parsed_arguments().unwrap_err().to_string();
        assert!(err.contains("read_file"), "error should name the tool: {err}");
    }

    #[test]
    fn assistant_with_tool_calls_sends_null_not_empty_content() {
        let msg = ChatMessage::assistant_tool_calls(String::new(), vec![]);
        let json = serde_json::to_value(&msg).unwrap();
        assert!(json.get("content").is_none(), "empty content must be omitted");
    }

    fn client() -> LlmClient {
        let identity = std::sync::Arc::new(parking_lot::Mutex::new(
            crate::attest::Identity::load_or_create().unwrap(),
        ));
        LlmClient::new(crate::gateway::Gateway::new(
            reqwest::Client::new(),
            "https://example.test/api/computer",
            identity,
        ))
    }

    #[test]
    fn tools_are_only_sent_when_present() {
        let c = client();
        let bare = CompletionRequest {
            model: "m".into(),
            messages: vec![ChatMessage::user("hi")],
            tools: vec![],
            temperature: 0.4,
            max_tokens: 100,
        };
        let body = c.build_body(&bare, true);
        assert!(body.get("tools").is_none());

        let with_tools = CompletionRequest {
            tools: vec![ToolDef::new("t", "d", serde_json::json!({"type":"object"}))],
            ..bare
        };
        let body = c.build_body(&with_tools, true);
        assert_eq!(body["tools"][0]["function"]["name"], "t");
        assert_eq!(body["tool_choice"], "auto");
    }

    #[test]
    fn the_request_body_never_carries_a_credential() {
        let c = client();
        let body = c.build_body(
            &CompletionRequest {
                model: "suzhou-4".into(),
                messages: vec![ChatMessage::user("hi")],
                tools: vec![],
                temperature: 0.4,
                max_tokens: 100,
            },
            true,
        );
        // Authentication is a signature in the headers, never a field in the
        // payload — a body that carried a key would end up in request logs.
        for forbidden in ["api_key", "key", "token", "authorization"] {
            assert!(body.get(forbidden).is_none(), "body must not contain `{forbidden}`");
        }
        assert_eq!(body["model"], "suzhou-4");
    }
}
