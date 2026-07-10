"""
Search Service — Multi-source Web Search
Provides web search via the LLM backend's web_search tool, Exa, and Firecrawl.
Supports combined parallel search with result deduplication.
"""

import os
import asyncio
import httpx
from typing import Optional
from datetime import datetime

from services.llm_client import (
    is_configured,
    not_configured_error,
    chat_completions_url,
    auth_headers,
    model,
)


# ─── Exa Search ────────────────────────────────────────────────────────────────

async def search_exa(
    query: str,
    num_results: int = 10,
    category: Optional[str] = None,
) -> list[dict]:
    """Search via Exa API using auto mode with highlights."""
    api_key = os.getenv("EXA_API_KEY", "")
    if not api_key:
        return [{"error": "EXA_API_KEY not configured"}]

    payload = {
        "query": query,
        "type": "auto",
        "num_results": num_results,
        "contents": {
            "highlights": {
                "max_characters": 2000,
            }
        },
    }
    if category:
        payload["category"] = category

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.post(
                "https://api.exa.ai/search",
                headers={
                    "x-api-key": api_key,
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()

            results = []
            for r in data.get("results", []):
                results.append({
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "highlights": r.get("highlights", []),
                    "score": r.get("score", 0),
                    "published_date": r.get("publishedDate"),
                    "source": "exa",
                })
            return results
        except Exception as e:
            print(f"Exa search error: {e}")
            return [{"error": str(e), "source": "exa"}]


# ─── LLM-backed Web Search ─────────────────────────────────────────────────────

async def search_web(query: str, num_results: int = 10) -> list[dict]:
    """
    Search via the LLM backend using its web_search tool.
    Uses the OpenAI-compatible /chat/completions endpoint with tool_choice.
    """
    if not is_configured():
        return [{"error": not_configured_error()}]

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(
                chat_completions_url(),
                headers=auth_headers(),
                json={
                    "model": model(),
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are a web search assistant. Search the web for the query and return "
                                "structured results. For each result provide: title, url, and a brief summary. "
                                "Format as JSON array."
                            ),
                        },
                        {"role": "user", "content": f"Search the web for: {query}"},
                    ],
                    "tools": [
                        {
                            "type": "function",
                            "function": {
                                "name": "web_search",
                                "description": "Search the web for current information",
                                "parameters": {
                                    "type": "object",
                                    "properties": {
                                        "query": {
                                            "type": "string",
                                            "description": "Search query",
                                        }
                                    },
                                    "required": ["query"],
                                },
                            },
                        }
                    ],
                    "tool_choice": "auto",
                    "search_parameters": {
                        "max_search_results": num_results,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()

            results = []
            # Extract citations from the response
            citations = data.get("citations", [])
            for citation in citations:
                results.append({
                    "title": citation.get("title", ""),
                    "url": citation.get("url", ""),
                    "highlights": [citation.get("snippet", "")],
                    "source": "web",
                })

            # Also extract from message content if structured
            choices = data.get("choices", [])
            if choices and not results:
                content = choices[0].get("message", {}).get("content", "")
                results.append({
                    "title": "Web Search Result",
                    "url": "",
                    "highlights": [content[:500]],
                    "source": "web",
                    "raw_content": content,
                })

            return results
        except Exception as e:
            print(f"Web search error: {e}")
            return [{"error": str(e), "source": "web"}]


# ─── Firecrawl Search ────────────────────────────────────────────────────────

async def search_firecrawl(query: str, num_results: int = 5) -> list[dict]:
    """Search via Firecrawl API."""
    api_key = os.getenv("FIRECRAWL_API_KEY", "")
    if not api_key:
        return [{"error": "FIRECRAWL_API_KEY not configured", "source": "firecrawl"}]

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Firecrawl /search endpoint
            resp = await client.post(
                "https://api.firecrawl.dev/v0/search",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "query": query,
                    "limit": num_results,
                    "scrapeOptions": {"formats": ["markdown"]} # Optional: get content too
                },
            )
            # Handle non-200 safely
            if resp.status_code != 200:
                 return [{"error": f"Firecrawl error: {resp.status_code}", "source": "firecrawl"}]

            data = resp.json()
            # Firecrawl response structure check needed, usually data['data'] or similar
            # Assuming standard structure based on docs: { success: true, data: [...] }
            results = []
            
            # Accommodate potential response variations
            items = data.get("data", []) if isinstance(data.get("data"), list) else []

            for r in items:
                results.append({
                    "title": r.get("metadata", {}).get("title") or r.get("title", "No title"),
                    "url": r.get("url", ""),
                    "highlights": [r.get("markdown", "")[:300]] if r.get("markdown") else [],
                    "score": 0, # Firecrawl might not return score
                    "source": "firecrawl",
                })
            return results
        except Exception as e:
            print(f"Firecrawl search error: {e}")
            return [{"error": str(e), "source": "firecrawl"}]


# ─── Combined Search ──────────────────────────────────────────────────────────

async def search_combined(
    query: str,
    num_results: int = 10,
    category: Optional[str] = None,
) -> dict:
    """
    Run web (LLM), Exa, and Firecrawl searches in parallel, merge and deduplicate.
    """
    web_task = asyncio.create_task(search_web(query, num_results))
    exa_task = asyncio.create_task(search_exa(query, num_results, category))
    fc_task = asyncio.create_task(search_firecrawl(query, num_results))

    # Wait for all
    results_list = await asyncio.gather(web_task, exa_task, fc_task, return_exceptions=True)

    # Unpack safely
    web_results = results_list[0] if isinstance(results_list[0], list) else []
    exa_results = results_list[1] if isinstance(results_list[1], list) else []
    fc_results = results_list[2] if isinstance(results_list[2], list) else []

    # Flatten and filter errors
    all_raw = []
    for source_res in [web_results, exa_results, fc_results]:
        if isinstance(source_res, list):
            all_raw.extend([r for r in source_res if "error" not in r])

    # Deduplicate by URL
    seen_urls = set()
    merged = []
    # Priority: Exa > Firecrawl > web
    for result in exa_results + fc_results + web_results:
        if not isinstance(result, dict) or "error" in result: continue

        url = result.get("url", "")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        merged.append(result)

    return {
        "query": query,
        "results": merged[:num_results * 2],  # Allow more results from combined
        "sources": {
            "web": len([r for r in web_results if "error" not in r]),
            "exa": len([r for r in exa_results if "error" not in r]),
            "firecrawl": len([r for r in fc_results if "error" not in r]),
        },
        "errors": [r for r in web_results + exa_results + fc_results if isinstance(r, dict) and "error" in r],
        "timestamp": datetime.utcnow().isoformat(),
    }


def format_search_for_context(results: list[dict]) -> str:
    """Format search results into a context string for injection into AI prompts."""
    if not results:
        return ""

    parts = ["Here are relevant web search results:"]
    for i, r in enumerate(results[:8], 1):
        title = r.get("title", "Unknown")
        url = r.get("url", "")
        highlights = r.get("highlights", [])
        highlight_text = " ".join(highlights)[:300] if highlights else ""
        source = r.get("source", "unknown")

        parts.append(f"\n[{i}] {title}")
        if url:
            parts.append(f"    URL: {url}")
        if highlight_text:
            parts.append(f"    {highlight_text}")
        parts.append(f"    (source: {source})")

    return "\n".join(parts)
