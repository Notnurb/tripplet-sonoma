"""
Code execution router backed by E2B sandboxes.
"""

from __future__ import annotations

import json
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from services.code_executor import CodeExecutorError, code_executor

router = APIRouter()


class ExecuteCodeRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    execution_id: str = Field(min_length=1, max_length=200)
    language: Literal["python", "bash"]
    code: str = Field(min_length=1)
    timeout_seconds: Optional[float] = Field(default=60.0, gt=0, le=120)


@router.post("/execute/stream")
async def execute_code_stream(req: ExecuteCodeRequest):
    try:
        code_executor.ensure_ready()
    except CodeExecutorError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    async def event_stream():
        try:
            async for event in code_executor.stream_execution(
                session_id=req.session_id,
                execution_id=req.execution_id,
                language=req.language,
                code=req.code,
                timeout_seconds=req.timeout_seconds or 60.0,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
