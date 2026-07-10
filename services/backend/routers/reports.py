"""
Reports Router — PDF report generation.

Backs the PyReport TUI (../../pyreport). Two modes:
  - /reports/generic     render an arbitrary tabular dataset the client uploads
  - /reports/user-memory  render a user's mem0 + SuperMemory data straight from
                          the backend's own services (no client upload needed)
"""

from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services.mem0_service import get_all_memories
from services.supermemory_service import get_user_profile, get_user_facts
from services.report_service import build_generic_report_pdf, build_user_memory_report_pdf

router = APIRouter()


class GenericReportRequest(BaseModel):
    title: str = "Data Report"
    source_label: str = "uploaded data"
    columns: list[str]
    rows: list[dict]


def _pdf_response(pdf_bytes: bytes, filename: str) -> Response:
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/generic")
async def api_generate_generic_report(req: GenericReportRequest):
    """Render client-supplied tabular data (columns + rows) to a PDF."""
    if not req.columns:
        raise HTTPException(status_code=400, detail="columns must not be empty")
    pdf_bytes = build_generic_report_pdf(
        columns=req.columns,
        rows=req.rows,
        title=req.title,
        source_label=req.source_label,
    )
    return _pdf_response(pdf_bytes, "report.pdf")


@router.get("/user-memory/{user_id}")
async def api_generate_user_memory_report(user_id: str):
    """Pull a user's profile/facts/memories from mem0 + SuperMemory and render a PDF."""
    profile = await get_user_profile(user_id)
    facts = await get_user_facts(user_id)
    memories = await get_all_memories(user_id)
    pdf_bytes = build_user_memory_report_pdf(user_id, profile, facts, memories)
    return _pdf_response(pdf_bytes, f"user-memory-{user_id}.pdf")
