"""
Agents Router — Multi-AI Collaboration
"""

from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from services.agent_service import (
    orchestrate_collaboration,
    select_agents,
    AGENT_ROSTER,
)

import json

router = APIRouter()


class CollaborateRequest(BaseModel):
    query: str
    num_agents: Optional[int] = None  # None = auto (defaults to 7, leans 5+)
    conversation_history: Optional[list[dict]] = None


@router.post("/collaborate")
async def api_collaborate(req: CollaborateRequest):
    """
    Orchestrate multi-AI collaboration.
    - 1-4 agents: sequential processing
    - 5+ agents: batch API processing
    Tura 3 synthesizes the final unified answer.
    """
    result = await orchestrate_collaboration(
        query=req.query,
        num_agents=req.num_agents,
        conversation_history=req.conversation_history,
    )
    return result


@router.post("/collaborate/stream")
async def api_collaborate_stream(req: CollaborateRequest):
    """
    Stream collaboration results as Server-Sent Events.
    Each agent's response is sent as it completes.
    """
    async def event_stream():
        num = req.num_agents or 7
        num = max(1, min(25, num))
        agents = select_agents(req.query, num)

        # Send agent list first
        yield f"data: {json.dumps({'type': 'agents', 'agents': [{'id': a['id'], 'name': a['name'], 'emoji': a['emoji'], 'specialty': a['specialty']} for a in agents]})}\n\n"

        # Process and stream results
        result = await orchestrate_collaboration(
            query=req.query,
            num_agents=req.num_agents,
            conversation_history=req.conversation_history,
        )

        # Stream each agent response
        for resp in result.get("responses", []):
            yield f"data: {json.dumps({'type': 'agent_response', 'response': resp})}\n\n"

        # Stream synthesis
        if result.get("synthesis"):
            yield f"data: {json.dumps({'type': 'synthesis', 'content': result['synthesis']})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/roster")
async def api_get_roster():
    """Get the full list of available AI agents."""
    return {
        "agents": [
            {
                "id": a["id"],
                "name": a["name"],
                "emoji": a["emoji"],
                "specialty": a["specialty"],
            }
            for a in AGENT_ROSTER
        ],
        "total": len(AGENT_ROSTER),
        "max_per_session": 25,
    }
