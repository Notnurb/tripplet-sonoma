# PyReport

A themed terminal UI (built with [Textual](https://textual.textualize.io/)) for turning data into
PDF reports (via [ReportLab](https://www.reportlab.com/)) — either from a local CSV/JSON file, or
directly from the Sonoma/Hefai FastAPI backend (`../backend`).

It's a two-tab app:

- **Local File** — load a `.csv`/`.json` file, preview it in a table, render a PDF locally
  (summary-stats table + data table).
- **Sonoma Backend** — talks to the backend's `/reports` router:
  - **Generate Memory Report** hits `GET /reports/user-memory/{user_id}`, which pulls that
    user's mem0 memories + SuperMemory profile/facts straight from the backend's own services
    and renders the PDF server-side.
  - **Render Loaded Data via Backend** takes whatever you loaded in the Local File tab and posts
    it to `POST /reports/generic`, so the *exact same* PDF template code
    (`backend/services/report_service.py`) is used whether you're online or offline.

A connectivity badge in the header pings `GET /health` on the backend at startup (**B** to
re-check).

## Setup

```bash
cd pyreport
pip install -r requirements.txt
```

Also install `reportlab` in the backend's own environment (`backend/requirements.txt` — already
added) so `/reports/*` endpoints work there too.

## Run

```bash
# In one terminal — the Sonoma backend (optional; Local File tab works without it)
cd backend && python main.py   # or: uvicorn main:app --reload

# In another terminal
cd pyreport && python app.py
```

Backend URL/API key are read from the repo root `.env` (`BACKEND_URL`, `BACKEND_API_KEY`) — the
same variables the Next.js app and `backend/auth.py` use, so PyReport always points at the same
backend instance without separate configuration.

## Usage

**Local File tab**
1. Enter a path to a `.csv` or `.json` (list of objects) file, then press **L** / "Load Data".
2. Optionally set a report title and output PDF path (defaults to `<datafile>.pdf`).
3. Press **G** / "Generate PDF" to write the report locally.

**Sonoma Backend tab**
1. Enter a `user_id` and press "Generate Memory Report" for a server-rendered profile PDF, or
2. Load a file in the Local File tab first, then press "Render Loaded Data via Backend" to have
   the backend render it instead of doing it locally.

## Files

- `app.py` — Textual TUI (two tabs: Local File, Sonoma Backend)
- `report.py` — local data loading, summary stats, offline PDF generation
- `backend_client.py` — thin `httpx` client for the backend's `/reports` + `/health` endpoints
- `sample_data.csv` — example input file

## Backend integration

- `backend/services/report_service.py` — canonical PDF-building code (ReportLab), shared so the
  layout/branding lives in one place.
- `backend/routers/reports.py` — `POST /reports/generic`, `GET /reports/user-memory/{user_id}`,
  mounted in `backend/main.py` alongside the existing memory/search/agents/code routers, behind
  the same `verify_api_key` auth as everything else.
