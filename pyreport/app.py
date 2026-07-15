"""PyReport — a TUI for turning data into PDF reports, local or via the Sonoma backend."""

from __future__ import annotations

from pathlib import Path

from textual import work
from textual.app import App, ComposeResult
from textual.containers import Horizontal, Vertical, VerticalScroll
from textual.reactive import reactive
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Input,
    Label,
    Static,
    TabbedContent,
    TabPane,
)

import backend_client
from report import LoadedData, compute_summary, generate_pdf, load_data

ACCENT = "#7c6cf6"
ACCENT_DIM = "#4a3f9c"


class PyReportApp(App):
    TITLE = "PyReport"
    SUB_TITLE = "Sonoma data → PDF"

    CSS = f"""
    Screen {{
        background: $surface;
        layout: vertical;
    }}

    #banner {{
        height: auto;
        padding: 1 2;
        background: {ACCENT_DIM};
        color: white;
        text-style: bold;
    }}

    #banner .subtitle {{
        color: #d8d3ff;
        text-style: none;
    }}

    #conn-badge {{
        width: auto;
        padding: 0 2;
        text-style: bold;
    }}

    .panel {{
        border: round {ACCENT};
        padding: 1 2;
        margin: 1 2 0 2;
        background: $panel;
    }}

    .panel-title {{
        text-style: bold;
        color: {ACCENT};
        margin-bottom: 1;
    }}

    .field-row {{
        height: auto;
        margin-bottom: 1;
    }}

    .field-label {{
        width: 16;
        content-align: left middle;
        color: $text-muted;
    }}

    .field-row Input {{
        border: round $primary-lighten-1;
    }}

    .field-row Input:focus {{
        border: round {ACCENT};
    }}

    #button-row {{
        height: auto;
        margin-top: 1;
        align-horizontal: right;
    }}

    #button-row Button {{
        margin-left: 1;
    }}

    #status {{
        margin: 1 2 0 2;
        padding: 1 2;
        border: round $primary-lighten-1;
        color: $text;
        height: auto;
    }}

    #preview-wrap {{
        margin: 1 2 1 2;
        border: round {ACCENT};
        height: 1fr;
    }}

    #preview-title {{
        dock: top;
        background: {ACCENT_DIM};
        color: white;
        text-style: bold;
        padding: 0 1;
        height: 1;
    }}

    DataTable {{
        height: 1fr;
    }}

    TabbedContent {{
        height: 1fr;
    }}
    """

    BINDINGS = [
        ("l", "load", "Load data"),
        ("g", "generate", "Generate PDF"),
        ("b", "check_backend", "Check backend"),
        ("q", "quit", "Quit"),
    ]

    backend_online: reactive[bool | None] = reactive(None)

    def __init__(self) -> None:
        super().__init__()
        self.loaded: LoadedData | None = None

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Horizontal(id="banner"):
            yield Static(
                "📄 PyReport  [dim]—[/dim]  [i]data files & the Sonoma backend, rendered to PDF[/i]",
                classes="subtitle",
            )
            yield Static("checking backend…", id="conn-badge")

        with TabbedContent(initial="local"):
            with TabPane("Local File", id="local"):
                with VerticalScroll():
                    with Vertical(classes="panel"):
                        yield Static("Load a CSV / JSON file", classes="panel-title")
                        with Horizontal(classes="field-row"):
                            yield Label("Data file:", classes="field-label")
                            yield Input(placeholder="path/to/data.csv or .json", id="input_path")
                        with Horizontal(classes="field-row"):
                            yield Label("Report title:", classes="field-label")
                            yield Input(placeholder="Data Report", id="title")
                        with Horizontal(classes="field-row"):
                            yield Label("Output PDF:", classes="field-label")
                            yield Input(placeholder="report.pdf", id="output_path")
                        with Horizontal(id="button-row"):
                            yield Button("Load Data  (L)", id="load_btn", variant="primary")
                            yield Button("Generate PDF  (G)", id="generate_btn", variant="success")
                    yield Static("Load a CSV or JSON file to begin.", id="status")
                    with Vertical(id="preview-wrap"):
                        yield Static("Preview", id="preview-title")
                        yield DataTable(id="preview")

            with TabPane("Sonoma Backend", id="backend"):
                with VerticalScroll():
                    with Vertical(classes="panel"):
                        yield Static("Generate directly from the Hefai backend", classes="panel-title")
                        with Horizontal(classes="field-row"):
                            yield Label("User ID:", classes="field-label")
                            yield Input(placeholder="user_abc123", id="backend_user_id")
                        with Horizontal(classes="field-row"):
                            yield Label("Output PDF:", classes="field-label")
                            yield Input(placeholder="user-memory-report.pdf", id="backend_output_path")
                        with Horizontal(id="button-row"):
                            yield Button("Check Backend  (B)", id="check_backend_btn")
                            yield Button(
                                "Generate Memory Report", id="backend_generate_btn", variant="success"
                            )
                        yield Static(
                            "[dim]Pulls the user's mem0 memories + SuperMemory profile/facts "
                            "straight from the backend's /reports/user-memory endpoint — "
                            "no local file needed.[/dim]"
                        )
                    with Vertical(classes="panel"):
                        yield Static("Send loaded local data to the backend instead", classes="panel-title")
                        yield Static(
                            "[dim]Load a file in the 'Local File' tab first, then render it "
                            "server-side via /reports/generic (uses the same PDF template as "
                            "the rest of the backend).[/dim]"
                        )
                        with Horizontal(id="button-row"):
                            yield Button("Render Loaded Data via Backend", id="backend_generic_btn")
                    yield Static("", id="backend_status")

        yield Footer()

    def on_mount(self) -> None:
        table = self.query_one("#preview", DataTable)
        table.zebra_stripes = True
        self.action_check_backend()

    def watch_backend_online(self, online: bool | None) -> None:
        badge = self.query_one("#conn-badge", Static)
        if online is None:
            badge.update("[dim]checking backend…[/dim]")
        elif online:
            badge.update("[on #1b5e20] ● backend online [/]")
        else:
            badge.update("[on #7a1f1f] ● backend offline [/]")

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "load_btn":
            self.action_load()
        elif event.button.id == "generate_btn":
            self.action_generate()
        elif event.button.id == "check_backend_btn":
            self.action_check_backend()
        elif event.button.id == "backend_generate_btn":
            self.action_generate_backend_memory_report()
        elif event.button.id == "backend_generic_btn":
            self.action_generate_backend_generic_report()

    # ─── Local file flow ────────────────────────────────────────────────

    def action_load(self) -> None:
        path = self.query_one("#input_path", Input).value.strip()
        status = self.query_one("#status", Static)
        if not path:
            status.update("[red]Enter a data file path first.[/red]")
            return
        try:
            self.loaded = load_data(path)
        except Exception as exc:  # noqa: BLE001
            status.update(f"[red]Failed to load: {exc}[/red]")
            return

        table = self.query_one("#preview", DataTable)
        table.clear(columns=True)
        table.add_columns(*self.loaded.columns)
        for row in self.loaded.rows[:100]:
            table.add_row(*[str(row[c]) for c in self.loaded.columns])

        out_input = self.query_one("#output_path", Input)
        if not out_input.value.strip():
            out_input.value = str(Path(self.loaded.source_path).with_suffix(".pdf"))

        summary = compute_summary(self.loaded)
        status.update(
            f"[green]Loaded {self.loaded.row_count} rows, "
            f"{len(self.loaded.columns)} columns from {self.loaded.source_path.name}. "
            f"({len(summary)} columns summarized)[/green]"
        )

    def action_generate(self) -> None:
        status = self.query_one("#status", Static)
        if self.loaded is None:
            status.update("[red]Load a data file before generating a report.[/red]")
            return

        title = self.query_one("#title", Input).value.strip() or "Data Report"
        output_path = self.query_one("#output_path", Input).value.strip()
        if not output_path:
            status.update("[red]Enter an output PDF path.[/red]")
            return

        try:
            result_path = generate_pdf(self.loaded, output_path, title=title)
        except Exception as exc:  # noqa: BLE001
            status.update(f"[red]Failed to generate PDF: {exc}[/red]")
            return

        status.update(f"[green]PDF report written locally to {result_path}[/green]")

    # ─── Sonoma backend flow ────────────────────────────────────────────

    def action_check_backend(self) -> None:
        self._check_backend()

    @work(exclusive=True, thread=True)
    def _check_backend(self) -> None:
        try:
            backend_client.check_health()
            self.backend_online = True
        except backend_client.BackendError:
            self.backend_online = False

    def action_generate_backend_memory_report(self) -> None:
        self._generate_backend_memory_report()

    @work(exclusive=True, thread=True)
    def _generate_backend_memory_report(self) -> None:
        status = self.query_one("#backend_status", Static)
        user_id = self.query_one("#backend_user_id", Input).value.strip()
        output_path = self.query_one("#backend_output_path", Input).value.strip()
        if not user_id:
            self.call_from_thread(status.update, "[red]Enter a user ID first.[/red]")
            return
        if not output_path:
            output_path = f"user-memory-{user_id}.pdf"

        self.call_from_thread(status.update, "[dim]Requesting report from backend…[/dim]")
        try:
            pdf_bytes = backend_client.generate_user_memory_report(user_id)
        except backend_client.BackendError as exc:
            self.call_from_thread(status.update, f"[red]{exc}[/red]")
            return

        out = Path(output_path).expanduser()
        out.write_bytes(pdf_bytes)
        self.call_from_thread(status.update, f"[green]Backend-generated report written to {out}[/green]")

    def action_generate_backend_generic_report(self) -> None:
        self._generate_backend_generic_report()

    @work(exclusive=True, thread=True)
    def _generate_backend_generic_report(self) -> None:
        status = self.query_one("#backend_status", Static)
        if self.loaded is None:
            self.call_from_thread(
                status.update, "[red]Load a file in the 'Local File' tab first.[/red]"
            )
            return

        title = self.query_one("#title", Input).value.strip() or "Data Report"
        output_path = self.query_one("#backend_output_path", Input).value.strip()
        if not output_path:
            output_path = str(Path(self.loaded.source_path).with_suffix("")) + "-backend.pdf"

        self.call_from_thread(status.update, "[dim]Sending data to backend for rendering…[/dim]")
        try:
            pdf_bytes = backend_client.generate_generic_report(
                columns=self.loaded.columns,
                rows=self.loaded.rows,
                title=title,
                source_label=self.loaded.source_path.name,
            )
        except backend_client.BackendError as exc:
            self.call_from_thread(status.update, f"[red]{exc}[/red]")
            return

        out = Path(output_path).expanduser()
        out.write_bytes(pdf_bytes)
        self.call_from_thread(status.update, f"[green]Backend-rendered report written to {out}[/green]")

    def action_quit(self) -> None:
        self.exit()


if __name__ == "__main__":
    PyReportApp().run()
