"""
SuperMemory Service — User Profile & Personality Storage
Inspired by supermemory.ai, implemented locally with SQLite.

Stores persistent user information:
- Name, personality traits, preferences
- Long-term facts the AI should always remember
- Communication style preferences
"""

import os
import json
import uuid
import aiosqlite
from datetime import datetime
from pathlib import Path
from typing import Optional

DB_PATH = Path(__file__).parent.parent / "supermemory.db"


async def init_supermemory():
    """Initialize the SQLite database for user profiles."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                name TEXT,
                personality TEXT DEFAULT '{}',
                preferences TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_facts (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                importance INTEGER DEFAULT 5,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_facts_user ON user_facts(user_id)
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_facts_category ON user_facts(category)
        """)
        await db.commit()
    print(f"✅ SuperMemory DB initialized at {DB_PATH}")


# ─── User Profile CRUD ────────────────────────────────────────────────────────

async def get_user_profile(user_id: str) -> Optional[dict]:
    """Get a user's full profile including facts."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM user_profiles WHERE user_id = ?", (user_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None

        profile = {
            "user_id": row["user_id"],
            "name": row["name"],
            "personality": json.loads(row["personality"]),
            "preferences": json.loads(row["preferences"]),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

        # Get associated facts
        cursor = await db.execute(
            "SELECT * FROM user_facts WHERE user_id = ? ORDER BY importance DESC",
            (user_id,),
        )
        facts = await cursor.fetchall()
        profile["facts"] = [
            {
                "id": f["id"],
                "category": f["category"],
                "content": f["content"],
                "importance": f["importance"],
                "created_at": f["created_at"],
            }
            for f in facts
        ]
        return profile


ALLOWED_COLUMNS = frozenset({"name", "personality", "preferences", "updated_at"})


async def upsert_user_profile(
    user_id: str,
    name: Optional[str] = None,
    personality: Optional[dict] = None,
    preferences: Optional[dict] = None,
) -> dict:
    """Create or update a user profile."""
    now = datetime.utcnow().isoformat()
    async with aiosqlite.connect(str(DB_PATH)) as db:
        existing = await get_user_profile(user_id)
        if existing:
            updates = []
            params = []
            if name is not None:
                updates.append("name = ?")
                params.append(name)
            if personality is not None:
                merged = {**existing.get("personality", {}), **personality}
                updates.append("personality = ?")
                params.append(json.dumps(merged))
            if preferences is not None:
                merged = {**existing.get("preferences", {}), **preferences}
                updates.append("preferences = ?")
                params.append(json.dumps(merged))
            updates.append("updated_at = ?")
            params.append(now)
            params.append(user_id)

            for clause in updates:
                col = clause.split(" =")[0]
                if col not in ALLOWED_COLUMNS:
                    raise ValueError(f"Disallowed column in UPDATE: {col}")

            await db.execute(
                f"UPDATE user_profiles SET {', '.join(updates)} WHERE user_id = ?",
                params,
            )
        else:
            await db.execute(
                """INSERT INTO user_profiles (user_id, name, personality, preferences, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    name or "",
                    json.dumps(personality or {}),
                    json.dumps(preferences or {}),
                    now,
                    now,
                ),
            )
        await db.commit()

    return await get_user_profile(user_id) or {"user_id": user_id}


async def add_user_fact(
    user_id: str, category: str, content: str, importance: int = 5
) -> dict:
    """Add a fact about the user (e.g., 'name', 'hobby', 'work', 'preference')."""
    fact_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    # Ensure profile exists
    profile = await get_user_profile(user_id)
    if not profile:
        await upsert_user_profile(user_id)

    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute(
            """INSERT INTO user_facts (id, user_id, category, content, importance, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (fact_id, user_id, category, content, importance, now),
        )
        await db.commit()

    return {"id": fact_id, "category": category, "content": content, "importance": importance}


async def get_user_facts(user_id: str, category: Optional[str] = None) -> list[dict]:
    """Get facts about a user, optionally filtered by category."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        db.row_factory = aiosqlite.Row
        if category:
            cursor = await db.execute(
                "SELECT * FROM user_facts WHERE user_id = ? AND category = ? ORDER BY importance DESC",
                (user_id, category),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM user_facts WHERE user_id = ? ORDER BY importance DESC",
                (user_id,),
            )
        rows = await cursor.fetchall()
        return [
            {
                "id": r["id"],
                "category": r["category"],
                "content": r["content"],
                "importance": r["importance"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]


async def delete_user_fact(fact_id: str) -> dict:
    """Delete a user fact."""
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.execute("DELETE FROM user_facts WHERE id = ?", (fact_id,))
        await db.commit()
    return {"message": "Fact deleted", "id": fact_id}


async def build_user_context(user_id: str) -> str:
    """Build a context string about the user for injection into system prompts."""
    profile = await get_user_profile(user_id)
    if not profile:
        return ""

    parts = []
    if profile.get("name"):
        parts.append(f"The user's name is {profile['name']}.")

    personality = profile.get("personality", {})
    if personality:
        traits = ", ".join(f"{k}: {v}" for k, v in personality.items())
        parts.append(f"User personality: {traits}.")

    preferences = profile.get("preferences", {})
    if preferences:
        prefs = ", ".join(f"{k}: {v}" for k, v in preferences.items())
        parts.append(f"User preferences: {prefs}.")

    facts = profile.get("facts", [])
    if facts:
        fact_lines = [f"- {f['content']}" for f in facts[:20]]
        parts.append("Known facts about the user:\n" + "\n".join(fact_lines))

    return "\n".join(parts)
