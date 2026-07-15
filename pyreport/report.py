"""Data loading and PDF report generation for PyReport."""

from __future__ import annotations

import csv
import json
import statistics
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

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


class UnsupportedFileError(ValueError):
    pass


@dataclass
class LoadedData:
    source_path: Path
    columns: list[str]
    rows: list[dict]

    @property
    def row_count(self) -> int:
        return len(self.rows)


def load_data(path: str | Path) -> LoadedData:
    """Load a CSV or JSON (list-of-objects) file into rows of dicts."""
    path = Path(path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"No such file: {path}")

    suffix = path.suffix.lower()
    if suffix == ".csv":
        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
            columns = reader.fieldnames or []
    elif suffix == ".json":
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
            raise UnsupportedFileError("JSON file must contain a list of objects")
        rows = data
        columns = list(rows[0].keys()) if rows else []
    else:
        raise UnsupportedFileError(f"Unsupported file type: {suffix} (use .csv or .json)")

    rows = [{k: r.get(k, "") for k in columns} for r in rows]
    return LoadedData(source_path=path, columns=columns, rows=rows)


def _is_numeric(value) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def compute_summary(data: LoadedData) -> dict[str, dict]:
    """Return per-column summary stats for numeric columns."""
    summary = {}
    for col in data.columns:
        values = [r[col] for r in data.rows]
        numeric = [float(v) for v in values if _is_numeric(v) and str(v).strip() != ""]
        if numeric and len(numeric) == len([v for v in values if str(v).strip() != ""]):
            summary[col] = {
                "count": len(numeric),
                "min": min(numeric),
                "max": max(numeric),
                "mean": statistics.mean(numeric),
                "median": statistics.median(numeric),
            }
        else:
            non_empty = [v for v in values if str(v).strip() != ""]
            summary[col] = {
                "count": len(non_empty),
                "unique": len(set(non_empty)),
            }
    return summary


def generate_pdf(
    data: LoadedData,
    output_path: str | Path,
    title: str = "Data Report",
    max_preview_rows: int = 50,
) -> Path:
    output_path = Path(output_path).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(output_path), pagesize=letter)
    story = []

    story.append(Paragraph(title, styles["Title"]))
    story.append(
        Paragraph(
            f"Source: {data.source_path.name} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"Rows: {data.row_count} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 0.3 * inch))

    story.append(Paragraph("Summary", styles["Heading2"]))
    summary = compute_summary(data)
    summary_rows = [["Column", "Count", "Min/Unique", "Max", "Mean", "Median"]]
    for col, s in summary.items():
        if "mean" in s:
            summary_rows.append(
                [
                    col,
                    str(s["count"]),
                    f"{s['min']:.2f}",
                    f"{s['max']:.2f}",
                    f"{s['mean']:.2f}",
                    f"{s['median']:.2f}",
                ]
            )
        else:
            summary_rows.append([col, str(s["count"]), str(s["unique"]), "-", "-", "-"])

    summary_table = Table(summary_rows, hAlign="LEFT")
    summary_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d2d44")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f2f7")]),
            ]
        )
    )
    story.append(summary_table)
    story.append(Spacer(1, 0.3 * inch))

    story.append(Paragraph("Data", styles["Heading2"]))
    preview = data.rows[:max_preview_rows]
    table_rows = [data.columns] + [[str(r[c]) for c in data.columns] for r in preview]
    data_table = Table(table_rows, hAlign="LEFT", repeatRows=1)
    data_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2d2d44")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 7),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f2f7")]),
            ]
        )
    )
    story.append(data_table)

    if data.row_count > max_preview_rows:
        story.append(Spacer(1, 0.2 * inch))
        story.append(
            Paragraph(
                f"Showing first {max_preview_rows} of {data.row_count} rows.",
                styles["Italic"],
            )
        )

    doc.build(story)
    return output_path
