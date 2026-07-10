"""
Memory Router — Endpoints for mem0 + SuperMemory
"""

from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter

from services.mem0_service import add_memory, search_memories, get_all_memories, delete_memory
from services.supermemory_service import (
    get_user_profile,
    upsert_user_profile,
    add_user_fact,
    get_user_facts,
    delete_user_fact,
    build_user_context,
)

router = APIRouter()


# ─── Request/Response Models ──────────────────────────────────────────────────

class AddMemoryRequest(BaseModel):
    content: str
    user_id: str
    metadata: Optional[dict] = None

class SearchMemoryRequest(BaseModel):
    query: str
    user_id: str
    limit: int = 10

class UserProfileRequest(BaseModel):
    user_id: str
    name: Optional[str] = None
    personality: Optional[dict] = None
    preferences: Optional[dict] = None

class UserFactRequest(BaseModel):
    user_id: str
    category: str
    content: str
    importance: int = 5


# ─── mem0 Endpoints ───────────────────────────────────────────────────────────

@router.post("/add")
async def api_add_memory(req: AddMemoryRequest):
    """Store a new conversation memory."""
    result = await add_memory(req.content, req.user_id, req.metadata)
    return {"success": True, "result": result}


@router.post("/search")
async def api_search_memories(req: SearchMemoryRequest):
    """Search for relevant memories."""
    results = await search_memories(req.query, req.user_id, req.limit)
    return {"results": results, "count": len(results)}


@router.get("/all/{user_id}")
async def api_get_all_memories(user_id: str):
    """Get all memories for a user."""
    results = await get_all_memories(user_id)
    return {"results": results, "count": len(results)}


@router.delete("/{memory_id}")
async def api_delete_memory(memory_id: str):
    """Delete a specific memory."""
    result = await delete_memory(memory_id)
    return result


# ─── SuperMemory (User Profile) Endpoints ─────────────────────────────────────

@router.get("/user/{user_id}")
async def api_get_user_profile(user_id: str):
    """Get user profile with personality, preferences, and facts."""
    profile = await get_user_profile(user_id)
    if not profile:
        return {"user_id": user_id, "exists": False}
    return {**profile, "exists": True}


@router.post("/user")
async def api_upsert_user_profile(req: UserProfileRequest):
    """Create or update a user profile."""
    result = await upsert_user_profile(
        req.user_id, req.name, req.personality, req.preferences
    )
    return {"success": True, "profile": result}


@router.post("/user/fact")
async def api_add_user_fact(req: UserFactRequest):
    """Add a fact about the user."""
    result = await add_user_fact(req.user_id, req.category, req.content, req.importance)
    return {"success": True, "fact": result}


@router.get("/user/{user_id}/facts")
async def api_get_user_facts(user_id: str, category: Optional[str] = None):
    """Get facts about a user."""
    facts = await get_user_facts(user_id, category)
    return {"facts": facts, "count": len(facts)}


@router.delete("/user/fact/{fact_id}")
async def api_delete_user_fact(fact_id: str):
    """Delete a user fact."""
    result = await delete_user_fact(fact_id)
    return result


@router.get("/user/{user_id}/context")
async def api_get_user_context(user_id: str):
    """Get the full user context string for system prompt injection."""
    context = await build_user_context(user_id)
    return {"context": context, "user_id": user_id}
