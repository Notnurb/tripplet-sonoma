"""
Report Service — builds PDF reports (via ReportLab) from backend data.

This is the canonical PDF-building code for the Hefai backend. It's used by
routers/reports.py, and consumed by PyReport (the local TUI client) so that
report layout/branding lives in one place instead of being duplicated.
"""

from __future__ import annotations

import statistics
from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

BRAND_DARK = colors.HexColor("#2d2d44")
BRAND_ROW = colors.HexColor("#f2f2f7")


def _table_style() -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_DARK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, BRAND_ROW]),
        ]
    )


def _is_numeric(value) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def _summarize(columns: list[str], rows: list[dict]) -> list[list[str]]:
    summary_rows = [["Column", "Count", "Min/Unique", "Max", "Mean", "Median"]]
    for col in columns:
        values = [r.get(col, "") for r in rows]
        non_empty = [v for v in values if str(v).strip() != ""]
        numeric = [float(v) for v in non_empty if _is_numeric(v)]
        if numeric and len(numeric) == len(non_empty):
            summary_rows.append(
                [
                    col,
                    str(len(numeric)),
                    f"{min(numeric):.2f}",
                    f"{max(numeric):.2f}",
                    f"{statistics.mean(numeric):.2f}",
                    f"{statistics.median(numeric):.2f}",
                ]
            )
        else:
            summary_rows.append([col, str(len(non_empty)), str(len(set(non_empty))), "-", "-", "-"])
    return summary_rows


def build_generic_report_pdf(
    columns: list[str],
    rows: list[dict],
    title: str = "Data Report",
    source_label: str = "uploaded data",
    max_preview_rows: int = 50,
) -> bytes:
    """Render an arbitrary tabular dataset (columns + row dicts) to a PDF."""
    buf = BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(buf, pagesize=letter)
    story = [
        Paragraph(title, styles["Title"]),
        Paragraph(
            f"Source: {source_label} &nbsp;|&nbsp; Rows: {len(rows)} &nbsp;|&nbsp; "
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            styles["Normal"],
        ),
        Spacer(1, 0.3 * inch),
        Paragraph("Summary", styles["Heading2"]),
    ]

    summary_table = Table(_summarize(columns, rows), hAlign="LEFT")
    summary_table.setStyle(_table_style())
    story.append(summary_table)
    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph("Data", styles["Heading2"]))

    preview = rows[:max_preview_rows]
    table_rows = [columns] + [[str(r.get(c, "")) for c in columns] for r in preview]
    data_table = Table(table_rows, hAlign="LEFT", repeatRows=1)
    data_table.setStyle(_table_style())
    story.append(data_table)

    if len(rows) > max_preview_rows:
        story.append(Spacer(1, 0.2 * inch))
        story.append(Paragraph(f"Showing first {max_preview_rows} of {len(rows)} rows.", styles["Italic"]))

    doc.build(story)
    return buf.getvalue()


def build_user_memory_report_pdf(
    user_id: str,
    profile: dict | None,
    facts: list[dict],
    memories: list[dict],
) -> bytes:
    """Render a user's mem0/SuperMemory data into a PDF profile report."""
    buf = BytesIO()
    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(buf, pagesize=letter)
    story = [
        Paragraph(f"User Memory Report — {user_id}", styles["Title"]),
        Paragraph(
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            styles["Normal"],
        ),
        Spacer(1, 0.3 * inch),
    ]

    story.append(Paragraph("Profile", styles["Heading2"]))
    if profile:
        profile_rows = [["Field", "Value"]]
        for key in ("name", "personality", "preferences"):
            val = profile.get(key)
            profile_rows.append([key, str(val) if val is not None else "-"])
        profile_table = Table(profile_rows, hAlign="LEFT")
        profile_table.setStyle(_table_style())
        story.append(profile_table)
    else:
        story.append(Paragraph("No profile on record.", styles["Normal"]))
    story.append(Spacer(1, 0.3 * inch))

    story.append(Paragraph(f"Facts ({len(facts)})", styles["Heading2"]))
    if facts:
        fact_rows = [["Category", "Content", "Importance"]] + [
            [f.get("category", "-"), f.get("content", "-"), str(f.get("importance", "-"))]
            for f in facts
        ]
        fact_table = Table(fact_rows, hAlign="LEFT", repeatRows=1)
        fact_table.setStyle(_table_style())
        story.append(fact_table)
    else:
        story.append(Paragraph("No facts on record.", styles["Normal"]))
    story.append(Spacer(1, 0.3 * inch))

    story.append(Paragraph(f"Recent Memories ({len(memories)})", styles["Heading2"]))
    if memories:
        mem_rows = [["Memory"]] + [[str(m.get("memory", m.get("content", m)))[:180]] for m in memories[:50]]
        mem_table = Table(mem_rows, hAlign="LEFT", colWidths=[6.5 * inch], repeatRows=1)
        mem_table.setStyle(_table_style())
        story.append(mem_table)
    else:
        story.append(Paragraph("No memories on record.", styles["Normal"]))

    doc.build(story)
    return buf.getvalue()
