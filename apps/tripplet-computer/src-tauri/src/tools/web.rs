//! Web tools: fetch a page, or search.
//!
//! Search is keyless by design — it goes through DuckDuckGo's HTML endpoint,
//! the same fallback `src/lib/ai/websearch.ts` uses on the web side, so the
//! desktop app is useful the moment it is installed without a second API key
//! to configure.
//!
//! Both tools route through [`classify_url`](crate::approval::classify_url),
//! which blocks loopback and private-range hosts outright. Without that, an
//! agent that can be talked into fetching `169.254.169.254` is an SSRF pivot
//! into whatever the user's machine can reach.

use std::time::Duration;

use super::{arg_str, cap, ToolContext, ToolOutcome};
use crate::approval::{classify_url, ActionKind, ActionRequest, Risk};

const FETCH_TIMEOUT: Duration = Duration::from_secs(25);
const MAX_PAGE_CHARS: usize = 40_000;
const MAX_SEARCH_RESULTS: usize = 8;
/// Refuse to buffer a multi-gigabyte "page".
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;

pub async fn fetch_url(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    let url = match arg_str(args, "url") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let (risk, reason) = classify_url(&url);
    if risk == Risk::Dangerous {
        // Not a prompt — a private-range or non-http target is refused
        // outright. There is no legitimate agent use, and offering the user a
        // one-click "Allow" on an SSRF probe would be the whole vulnerability.
        return ToolOutcome::err(
            "Blocked URL",
            format!("`{url}` {reason} and cannot be fetched."),
        );
    }

    if let Err(denied) = ctx
        .gate(ActionRequest::new(
            ActionKind::Network,
            "Fetch a web page",
            url.clone(),
            reason,
            risk,
        ))
        .await
    {
        return denied;
    }

    let res = match ctx
        .http
        .get(&url)
        .header("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8")
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
    {
        Ok(res) => res,
        Err(err) => {
            return ToolOutcome::err(
                "Could not fetch the page",
                format!("could not fetch `{url}`: {}", trim_err(&err.to_string())),
            )
        }
    };

    let status = res.status();
    let final_url = res.url().to_string();

    // A redirect can walk a public URL into private space; re-check where we
    // actually landed, not just where we were pointed.
    if classify_url(&final_url).0 == Risk::Dangerous {
        return ToolOutcome::err(
            "Blocked redirect",
            format!("`{url}` redirected to `{final_url}`, which is not a permitted target."),
        );
    }

    if !status.is_success() {
        return ToolOutcome::err(
            format!("{url} returned {status}"),
            format!("`{url}` returned HTTP {status}."),
        );
    }

    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = match res.bytes().await {
        Ok(b) => b,
        Err(err) => {
            return ToolOutcome::err(
                "Could not read the page",
                format!("could not read the body of `{url}`: {}", trim_err(&err.to_string())),
            )
        }
    };
    if bytes.len() > MAX_BODY_BYTES {
        return ToolOutcome::err(
            "Page too large",
            format!("`{url}` returned {} bytes, over the {MAX_BODY_BYTES}-byte limit.", bytes.len()),
        );
    }
    let raw = String::from_utf8_lossy(&bytes);

    let text = if content_type.contains("json") {
        raw.to_string()
    } else {
        html_to_text(&raw)
    };

    if text.trim().is_empty() {
        return ToolOutcome::err(
            "Page had no readable text",
            format!("`{url}` returned no readable text (content-type `{content_type}`)."),
        );
    }

    ToolOutcome::ok(
        format!("Fetched {}", crate::approval::host_of(&final_url).unwrap_or_else(|| url.clone())),
        format!(
            "Source: {final_url}\n\n{}",
            cap(&text, MAX_PAGE_CHARS)
        ),
    )
}

pub async fn web_search(ctx: &ToolContext, args: &serde_json::Value) -> ToolOutcome {
    let query = match arg_str(args, "query") {
        Ok(v) => v,
        Err(e) => return e,
    };

    if let Err(denied) = ctx
        .gate(ActionRequest::new(
            ActionKind::Network,
            "Search the web",
            format!("https://duckduckgo.com/?q={}", urlencoding::encode(&query)),
            "runs a web search",
            Risk::Safe,
        ))
        .await
    {
        return denied;
    }

    let endpoint = format!("https://html.duckduckgo.com/html/?q={}", urlencoding::encode(&query));
    let res = match ctx
        .http
        .get(&endpoint)
        // The HTML endpoint serves a stub to unrecognised agents.
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36")
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
    {
        Ok(res) => res,
        Err(err) => {
            return ToolOutcome::err(
                "Search failed",
                format!("the web search for `{query}` failed: {}", trim_err(&err.to_string())),
            )
        }
    };

    let body = match res.text().await {
        Ok(b) => b,
        Err(err) => {
            return ToolOutcome::err(
                "Search failed",
                format!("could not read search results: {}", trim_err(&err.to_string())),
            )
        }
    };

    let results = parse_duckduckgo(&body, MAX_SEARCH_RESULTS);
    if results.is_empty() {
        return ToolOutcome::ok(
            format!("No results for `{query}`"),
            format!("the search for `{query}` returned no results."),
        );
    }

    let rendered = results
        .iter()
        .enumerate()
        .map(|(i, r)| format!("{}. {}\n   {}\n   {}", i + 1, r.title, r.url, r.snippet))
        .collect::<Vec<_>>()
        .join("\n\n");

    ToolOutcome::ok(
        format!("{} result{} for `{query}`", results.len(), if results.len() == 1 { "" } else { "s" }),
        cap(&rendered, MAX_PAGE_CHARS),
    )
}

#[derive(Debug, PartialEq)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// Pull results out of DuckDuckGo's HTML page.
///
/// Deliberately a hand-rolled scan rather than a DOM parse: the page is a
/// stable, shallow template, and a scraper that degrades to "no results" when
/// the markup shifts is better than a dependency that degrades to a panic.
pub fn parse_duckduckgo(html: &str, limit: usize) -> Vec<SearchResult> {
    let mut out = Vec::new();
    for chunk in html.split("result__a").skip(1) {
        if out.len() >= limit {
            break;
        }
        let Some(href) = extract_attr(chunk, "href=\"") else { continue };
        let url = normalise_ddg_url(&href);
        if url.is_empty() || !url.starts_with("http") {
            continue;
        }
        let title = chunk
            .split_once('>')
            .map(|(_, rest)| strip_tags(rest.split("</a>").next().unwrap_or_default()))
            .unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }
        let snippet = chunk
            .split_once("result__snippet")
            .and_then(|(_, rest)| rest.split_once('>'))
            .map(|(_, rest)| strip_tags(rest.split("</a>").next().unwrap_or_default()))
            .unwrap_or_default();

        out.push(SearchResult {
            title: title.trim().chars().take(200).collect(),
            url,
            snippet: snippet.trim().chars().take(320).collect(),
        });
    }
    out
}

fn extract_attr(chunk: &str, needle: &str) -> Option<String> {
    let start = chunk.find(needle)? + needle.len();
    let rest = &chunk[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// DuckDuckGo wraps results in `/l/?uddg=<encoded>`; unwrap to the real URL.
fn normalise_ddg_url(href: &str) -> String {
    let href = if let Some(stripped) = href.strip_prefix("//") {
        format!("https://{stripped}")
    } else {
        href.to_string()
    };
    if let Some(idx) = href.find("uddg=") {
        let encoded = &href[idx + 5..];
        let encoded = encoded.split('&').next().unwrap_or(encoded);
        if let Ok(decoded) = urlencoding::decode(encoded) {
            return decoded.to_string();
        }
    }
    href
}

/// Strip markup, scripts and entities down to readable prose.
pub fn html_to_text(html: &str) -> String {
    // Drop whole elements whose *content* is not prose before stripping tags,
    // otherwise a page's JavaScript ends up in the model's context.
    let mut cleaned = String::with_capacity(html.len());
    let mut rest = html;
    loop {
        let lower = rest.to_ascii_lowercase();
        let next = ["<script", "<style", "<noscript", "<svg", "<!--"]
            .iter()
            .filter_map(|tag| lower.find(tag).map(|i| (i, *tag)))
            .min_by_key(|(i, _)| *i);
        let Some((idx, tag)) = next else {
            cleaned.push_str(rest);
            break;
        };
        cleaned.push_str(&rest[..idx]);
        let close = match tag {
            "<!--" => "-->",
            "<script" => "</script>",
            "<style" => "</style>",
            "<noscript" => "</noscript>",
            _ => "</svg>",
        };
        match lower[idx..].find(close) {
            Some(rel) => rest = &rest[idx + rel + close.len()..],
            // Unterminated block — drop the remainder rather than emit source.
            None => break,
        }
    }

    // Turn block-level boundaries into newlines so paragraphs survive.
    let spaced = cleaned
        .replace("</p>", "\n\n")
        .replace("</div>", "\n")
        .replace("</li>", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("</h1>", "\n\n")
        .replace("</h2>", "\n\n")
        .replace("</h3>", "\n\n")
        .replace("</tr>", "\n");

    let text = strip_tags(&spaced);
    let text = decode_entities(&text);

    // Collapse the ocean of blank lines that markup removal leaves behind.
    let mut out = String::with_capacity(text.len());
    let mut blank_run = 0;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out.push('\n');
            }
        } else {
            blank_run = 0;
            out.push_str(trimmed);
            out.push('\n');
        }
    }
    out.trim().to_string()
}

fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut depth = 0usize;
    for ch in input.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

fn decode_entities(input: &str) -> String {
    // Ampersand last, so `&amp;lt;` decodes to `&lt;` rather than `<`.
    let mut s = input
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&hellip;", "…")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–");
    s = s.replace("&amp;", "&");
    s
}

fn trim_err(msg: &str) -> String {
    msg.chars().take(200).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approver::Approver;
    use crate::config::{ApprovalPolicy, Permissions};

    fn ctx() -> ToolContext {
        ToolContext {
            project_root: Some(std::path::PathBuf::from("/tmp")),
            policy: ApprovalPolicy::ApproveForMe,
            permissions: Permissions::default(),
            approver: Approver::auto_allow(),
            http: reqwest::Client::new(),
            composio: None,
            read_only: false,
            groups: Default::default(),
        }
    }

    #[tokio::test]
    async fn private_and_loopback_targets_are_refused_without_a_prompt() {
        let ctx = ctx();
        for url in [
            "http://localhost:8080/admin",
            "https://127.0.0.1/",
            "https://169.254.169.254/latest/meta-data",
            "file:///etc/passwd",
        ] {
            let out = fetch_url(&ctx, &serde_json::json!({ "url": url })).await;
            assert!(!out.ok, "{url} should be blocked");
            assert_eq!(out.summary, "Blocked URL", "{url}");
        }
    }

    #[tokio::test]
    async fn a_refused_fetch_never_reaches_the_network() {
        let mut ctx = ctx();
        ctx.policy = ApprovalPolicy::AskForApproval; // network always prompts
        ctx.approver = Approver::auto_deny();
        // example.invalid would fail DNS if the gate let it through, so a
        // "Out of scope" result proves the refusal happened before the request.
        let out = fetch_url(&ctx, &serde_json::json!({ "url": "https://example.invalid/x" })).await;
        assert!(!out.ok);
        assert_eq!(out.summary, "Out of scope");
    }

    #[test]
    fn scripts_and_styles_never_reach_the_model() {
        let html = r#"
            <html><head><style>body{color:red}</style>
            <script>var secret = "do not leak";</script></head>
            <body><h1>Title</h1><p>First para.</p><p>Second para.</p></body></html>
        "#;
        let text = html_to_text(html);
        assert!(!text.contains("do not leak"));
        assert!(!text.contains("color:red"));
        assert!(text.contains("Title"));
        assert!(text.contains("First para."));
        assert!(text.contains("Second para."));
    }

    #[test]
    fn comments_and_svg_are_dropped() {
        let text = html_to_text("<p>keep</p><!-- drop me --><svg><path d='x'/></svg><p>also keep</p>");
        assert!(text.contains("keep"));
        assert!(text.contains("also keep"));
        assert!(!text.contains("drop me"));
        assert!(!text.contains("path"));
    }

    #[test]
    fn an_unterminated_script_does_not_leak_source() {
        let text = html_to_text("<p>before</p><script>var x = 1;");
        assert!(text.contains("before"));
        assert!(!text.contains("var x"));
    }

    #[test]
    fn entities_decode_without_double_decoding() {
        assert_eq!(decode_entities("a &amp; b"), "a & b");
        assert_eq!(decode_entities("&amp;lt;"), "&lt;", "ampersand must decode last");
        assert_eq!(decode_entities("&lt;tag&gt;"), "<tag>");
    }

    #[test]
    fn block_elements_become_line_breaks() {
        let text = html_to_text("<div>one</div><div>two</div>");
        assert_eq!(text, "one\ntwo");
    }

    #[test]
    fn blank_line_runs_collapse() {
        let text = html_to_text("<p>a</p><p></p><p></p><p>b</p>");
        assert!(!text.contains("\n\n\n"), "got {text:?}");
    }

    #[test]
    fn duckduckgo_results_are_unwrapped_to_real_urls() {
        // `r##"…"##` because the markup itself contains `"#`.
        let html = r##"
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdoc.rust-lang.org%2Fbook%2F&rut=x">The Rust Book</a>
          <a class="result__snippet" href="#">The official <b>book</b>.</a>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.rs%2F">docs.rs</a>
        "##;
        let results = parse_duckduckgo(html, 8);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].url, "https://doc.rust-lang.org/book/");
        assert_eq!(results[0].title, "The Rust Book");
        assert_eq!(results[0].snippet, "The official book.");
        assert_eq!(results[1].url, "https://docs.rs/");
    }

    #[test]
    fn the_scraper_degrades_to_empty_when_the_markup_changes() {
        assert!(parse_duckduckgo("<html><body>totally different</body></html>", 8).is_empty());
        assert!(parse_duckduckgo("", 8).is_empty());
    }

    #[test]
    fn search_results_honour_the_limit() {
        let html = (0..20)
            .map(|i| format!(r#"<a class="result__a" href="https://e{i}.test/">R{i}</a>"#))
            .collect::<String>();
        assert_eq!(parse_duckduckgo(&html, 5).len(), 5);
    }
}
