"""
Search Router — Multi-source Web Search (LLM web tool + Exa + Firecrawl)
"""

from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter

from services.search_service import search_web, search_exa, search_combined

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    num_results: int = 10
    category: Optional[str] = None


@router.post("/web")
async def api_search_web(req: SearchRequest):
    """Search the web via the LLM backend's web_search tool."""
    results = await search_web(req.query, req.num_results)
    return {"source": "web", "results": results, "count": len(results)}


@router.post("/firecrawl")
async def api_search_firecrawl(req: SearchRequest):
    """Search the web via Firecrawl."""
    from services.search_service import search_firecrawl
    results = await search_firecrawl(req.query, req.num_results)
    return {"source": "firecrawl", "results": results, "count": len(results)}


@router.post("/combined")
async def api_search_combined(req: SearchRequest):
    """Run multi-source search (web + Exa + Firecrawl) in parallel, merge and deduplicate."""
    result = await search_combined(req.query, req.num_results, req.category)
    return result
