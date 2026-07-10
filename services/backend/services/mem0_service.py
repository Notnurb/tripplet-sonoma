"""
mem0 Memory Service — Local Integration
Uses the cloned mem0 repo for conversation memory.
Stores and retrieves contextual memories per user/conversation.
"""

import os
import uuid
from datetime import datetime
from typing import Optional

# We'll use mem0's Memory class directly from the cloned repo
# The vendor path is added to sys.path in main.py
try:
    from mem0 import Memory
    MEM0_AVAILABLE = True
except ImportError:
    MEM0_AVAILABLE = False
    print("⚠️  mem0 import failed — using fallback in-memory store")


# ─── In-memory fallback (when mem0 deps aren't fully installed) ────────────────

class FallbackMemory:
    """Simple in-memory store that mimics mem0's API for development."""

    def __init__(self):
        self.memories: dict[str, list[dict]] = {}  # user_id -> memories

    def add(self, data: str, user_id: str, metadata: Optional[dict] = None) -> dict:
        if user_id not in self.memories:
            self.memories[user_id] = []

        entry = {
            "id": str(uuid.uuid4()),
            "memory": data,
            "user_id": user_id,
            "metadata": metadata or {},
            "created_at": datetime.utcnow().isoformat(),
            "score": 1.0,
        }
        self.memories[user_id].append(entry)
        return {"id": entry["id"], "message": "Memory added successfully"}

    def search(self, query: str, user_id: str, limit: int = 10) -> dict:
        user_mems = self.memories.get(user_id, [])
        # Simple substring matching as fallback
        results = []
        query_lower = query.lower()
        for mem in user_mems:
            text = mem["memory"].lower()
            # Score based on word overlap
            query_words = set(query_lower.split())
            mem_words = set(text.split())
            overlap = len(query_words & mem_words)
            if overlap > 0 or query_lower in text:
                scored = {**mem, "score": overlap / max(len(query_words), 1)}
                results.append(scored)

        results.sort(key=lambda x: x["score"], reverse=True)
        return {"results": results[:limit]}

    def get_all(self, user_id: str) -> dict:
        return {"results": self.memories.get(user_id, [])}

    def delete(self, memory_id: str) -> dict:
        for user_id, mems in self.memories.items():
            self.memories[user_id] = [m for m in mems if m["id"] != memory_id]
        return {"message": "Memory deleted"}


# ─── Singleton ─────────────────────────────────────────────────────────────────

_memory_instance: Optional[Memory | FallbackMemory] = None


async def init_mem0():
    """Initialize the mem0 memory system."""
    global _memory_instance

    if MEM0_AVAILABLE:
        try:
            from services.llm_client import api_key, base_url, model

            # Configure mem0 for local usage:
            #  - LLM: our own OpenAI-compatible backend (env-driven, see llm_client)
            #  - Embedder: local sentence-transformers, so memory works with zero
            #    external embedding API and no provider lock-in.
            config = {
                "llm": {
                    "provider": "openai",
                    "config": {
                        "model": model(),
                        "api_key": api_key(),
                        "openai_base_url": base_url(),
                    },
                },
                "embedder": {
                    "provider": "huggingface",
                    "config": {
                        "model": os.getenv(
                            "EMBEDDING_MODEL",
                            "sentence-transformers/all-MiniLM-L6-v2",
                        ),
                    },
                },
                "vector_store": {
                    "provider": "qdrant",
                    "config": {
                        "collection_name": "hefai_memories",
                        "host": "localhost",
                        "port": 6333,
                        # Use in-memory mode if Qdrant isn't running
                        "on_disk": False,
                    },
                },
                "version": "v1.1",
            }
            _memory_instance = Memory.from_config(config)
            print("✅ mem0 initialized with local embeddings + Qdrant")
        except Exception as e:
            print(f"⚠️  mem0 init failed ({e}), using fallback")
            _memory_instance = FallbackMemory()
    else:
        _memory_instance = FallbackMemory()
        print("📦 Using fallback in-memory store")


def get_memory() -> Memory | FallbackMemory:
    """Get the memory instance."""
    if _memory_instance is None:
        return FallbackMemory()
    return _memory_instance


async def add_memory(content: str, user_id: str, metadata: Optional[dict] = None) -> dict:
    """Store a new memory for a user."""
    mem = get_memory()
    result = mem.add(content, user_id=user_id, metadata=metadata or {})
    return result


async def search_memories(query: str, user_id: str, limit: int = 10) -> list[dict]:
    """Search for relevant memories."""
    mem = get_memory()
    result = mem.search(query, user_id=user_id, limit=limit)
    return result.get("results", [])


async def get_all_memories(user_id: str) -> list[dict]:
    """Get all memories for a user."""
    mem = get_memory()
    result = mem.get_all(user_id=user_id)
    return result.get("results", [])


async def delete_memory(memory_id: str) -> dict:
    """Delete a specific memory."""
    mem = get_memory()
    return mem.delete(memory_id)
