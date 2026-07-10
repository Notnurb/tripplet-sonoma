"""Textual TUI for OpenSonoma.

Two public entry points are exposed and used by the CLI:

  * ``run_wizard()`` — the first-run setup wizard (prerequisite check, machine
    name, password create+confirm, big pairing code, install+start the service,
    final status screen).
  * ``run_status()`` — a live status dashboard (link state from STATUS_FILE,
    pairing code, paired/online, and a live tail of OPERATIONS_LOG).

All real work is delegated to the already-written core modules:
``crypto`` (device id), ``pairing`` (pairing code), ``config`` (Config/Secret
persistence) and ``service`` (LaunchAgent / systemd install + start). This module
never re-implements any of that logic.

Target: Python 3.9 syntax, Textual >= 0.50 APIs.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Center, Horizontal, Vertical, VerticalScroll
from textual.screen import Screen
from textual.widgets import (
    Button,
    DataTable,
    Footer,
    Header,
    Input,
    RichLog,
    Static,
)

from . import constants
from . import crypto
from . import pairing
from .config import Config, Secret


# ---------------------------------------------------------------------------
# Big block-letter font for the pairing code (terminals can't scale fonts, so
# we render the code as 5-row ASCII block glyphs to make it large + legible).
# Every glyph is exactly 5 rows by 5 columns.
# ---------------------------------------------------------------------------
_FONT_HEIGHT = 5
_FONT: Dict[str, List[str]] = {
    " ": ["     ", "     ", "     ", "     ", "     "],
    "-": ["     ", "     ", " ███ ", "     ", "     "],
    "A": [" ███ ", "█   █", "█████", "█   █", "█   █"],
    "B": ["████ ", "█   █", "████ ", "█   █", "████ "],
    "C": [" ████", "█    ", "█    ", "█    ", " ████"],
    "D": ["████ ", "█   █", "█   █", "█   █", "████ "],
    "E": ["█████", "█    ", "████ ", "█    ", "█████"],
    "F": ["█████", "█    ", "████ ", "█    ", "█    "],
    "G": [" ████", "█    ", "█  ██", "█   █", " ████"],
    "H": ["█   █", "█   █", "█████", "█   █", "█   █"],
    "J": ["   ██", "    █", "    █", "█   █", " ███ "],
    "K": ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
    "M": ["█   █", "██ ██", "█ █ █", "█   █", "█   █"],
    "N": ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
    "P": ["████ ", "█   █", "████ ", "█    ", "█    "],
    "Q": [" ███ ", "█   █", "█ █ █", "█  █ ", " ██ █"],
    "R": ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
    "S": [" ████", "█    ", " ███ ", "    █", "████ "],
    "T": ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
    "U": ["█   █", "█   █", "█   █", "█   █", " ███ "],
    "V": ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
    "W": ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
    "X": ["█   █", " █ █ ", "  █  ", " █ █ ", "█   █"],
    "Y": ["█   █", " █ █ ", "  █  ", "  █  ", "  █  "],
    "Z": ["█████", "   █ ", "  █  ", " █   ", "█████"],
    "2": [" ███ ", "█   █", "   █ ", "  █  ", "█████"],
    "3": ["████ ", "    █", " ███ ", "    █", "████ "],
    "4": ["█  █ ", "█  █ ", "█████", "   █ ", "   █ "],
    "5": ["█████", "█    ", "████ ", "    █", "████ "],
    "6": [" ███ ", "█    ", "████ ", "█   █", " ███ "],
    "7": ["█████", "   █ ", "  █  ", " █   ", " █   "],
    "8": [" ███ ", "█   █", " ███ ", "█   █", " ███ "],
    "9": [" ███ ", "█   █", " ████", "    █", " ███ "],
}


def big_text(text: str) -> str:
    """Render *text* as multi-line ASCII block letters."""
    rows = ["" for _ in range(_FONT_HEIGHT)]
    for ch in text:
        glyph = _FONT.get(ch.upper(), _FONT[" "])
        for i in range(_FONT_HEIGHT):
            rows[i] += glyph[i] + "  "
    return "\n".join(row.rstrip() for row in rows)


# ---------------------------------------------------------------------------
# Prerequisite detection + package-manager helpers
# ---------------------------------------------------------------------------
# Each prerequisite is satisfied if *any* of its commands resolves on PATH.
_PREREQS = [
    {"key": "python3", "label": "Python 3", "cmds": ["python3"]},
    {"key": "compiler", "label": "C/C++ compiler", "cmds": ["clang++", "g++"]},
    {"key": "cmake", "label": "CMake", "cmds": ["cmake"]},
    {"key": "make", "label": "Make", "cmds": ["make"]},
    {"key": "git", "label": "Git", "cmds": ["git"]},
]

# Package names per manager, keyed by prerequisite key.
_PACKAGES = {
    "brew": {
        "python3": "python", "compiler": "llvm", "cmake": "cmake",
        "make": "make", "git": "git",
    },
    "apt": {
        "python3": "python3", "compiler": "g++", "cmake": "cmake",
        "make": "make", "git": "git",
    },
    "dnf": {
        "python3": "python3", "compiler": "gcc-c++", "cmake": "cmake",
        "make": "make", "git": "git",
    },
    "pacman": {
        "python3": "python", "compiler": "gcc", "cmake": "cmake",
        "make": "make", "git": "git",
    },
}


def platform_label() -> str:
    if sys.platform == "darwin":
        return "macOS"
    if sys.platform.startswith("linux"):
        return "Linux"
    return sys.platform


def detect_pkg_manager() -> Optional[str]:
    """Return the package manager key for this platform, or None."""
    if sys.platform == "darwin":
        return "brew" if shutil.which("brew") else None
    if sys.platform.startswith("linux"):
        if shutil.which("apt-get") or shutil.which("apt"):
            return "apt"
        if shutil.which("dnf"):
            return "dnf"
        if shutil.which("pacman"):
            return "pacman"
    return None


def install_command(manager: str, packages: List[str]) -> Optional[List[str]]:
    """Build the install command for *manager* and *packages*."""
    if manager == "brew":
        return ["brew", "install"] + packages
    if manager == "apt":
        return ["sudo", "apt-get", "install", "-y"] + packages
    if manager == "dnf":
        return ["sudo", "dnf", "install", "-y"] + packages
    if manager == "pacman":
        return ["sudo", "pacman", "-S", "--noconfirm"] + packages
    return None


def detect_prereqs() -> List[Dict[str, object]]:
    """Probe PATH for every prerequisite; return rich result dicts."""
    results: List[Dict[str, object]] = []
    for spec in _PREREQS:
        found_path = None
        for cmd in spec["cmds"]:  # type: ignore[index]
            path = shutil.which(cmd)
            if path:
                found_path = path
                break
        results.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "found": found_path is not None,
                "detail": found_path or "not found",
            }
        )
    return results


# ---------------------------------------------------------------------------
# Password strength hint
# ---------------------------------------------------------------------------
def password_strength(pw: str) -> "tuple":
    """Return (label, color) describing the strength of *pw*."""
    if not pw:
        return ("", "dim")
    score = 0
    if len(pw) >= 8:
        score += 1
    if len(pw) >= 12:
        score += 1
    if any(c.islower() for c in pw) and any(c.isupper() for c in pw):
        score += 1
    if any(c.isdigit() for c in pw):
        score += 1
    if any(not c.isalnum() for c in pw):
        score += 1
    score = min(score, 5)
    labels = ["very weak", "weak", "fair", "good", "strong", "strong"]
    colors = ["red", "red", "yellow", "yellow", "green", "green"]
    return (labels[score], colors[score])


# ---------------------------------------------------------------------------
# Status / operations-log readers (used by the status screen)
# ---------------------------------------------------------------------------
def read_status_file() -> Dict[str, object]:
    try:
        return json.loads(constants.STATUS_FILE.read_text())
    except (OSError, ValueError):
        return {}


def _read_tail(path: Path, max_bytes: int = 65536) -> str:
    try:
        size = path.stat().st_size
    except OSError:
        return ""
    try:
        with open(path, "rb") as fh:
            if size > max_bytes:
                fh.seek(size - max_bytes)
            data = fh.read()
    except OSError:
        return ""
    return data.decode("utf-8", errors="replace")


def read_recent_ops(limit: int = 25) -> List[Dict[str, object]]:
    """Merge start/finish JSONL records from OPERATIONS_LOG into per-op rows."""
    ops: Dict[str, Dict[str, object]] = {}
    order: List[str] = []
    text = _read_tail(constants.OPERATIONS_LOG)
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        op_id = rec.get("op_id") or "?"
        if op_id not in ops:
            ops[op_id] = {
                "op_id": op_id,
                "kind": rec.get("kind", ""),
                "command": rec.get("command", ""),
                "exit_code": None,
                "error": None,
                "started_at": None,
                "finished_at": None,
            }
            order.append(op_id)
        entry = ops[op_id]
        event = rec.get("event")
        if event == "start":
            if rec.get("kind"):
                entry["kind"] = rec.get("kind")
            if rec.get("command"):
                entry["command"] = rec.get("command")
            entry["started_at"] = rec.get("ts")
        elif event == "finish":
            entry["exit_code"] = rec.get("exit_code")
            entry["error"] = rec.get("error")
            entry["finished_at"] = rec.get("ts")
            if rec.get("kind"):
                entry["kind"] = rec.get("kind")
            if rec.get("command"):
                entry["command"] = rec.get("command")
    rows = [ops[o] for o in order]
    return rows[-limit:]


def _fmt_time(iso: Optional[str]) -> str:
    if not iso:
        return "-"
    if "T" in iso:
        tail = iso.split("T", 1)[1]
        return tail.rstrip("Z")
    return iso


def _truncate(text: str, width: int) -> str:
    text = (text or "").replace("\n", " ")
    if len(text) <= width:
        return text
    return text[: width - 1] + "…"


# ===========================================================================
# Wizard screens
# ===========================================================================
class PrereqScreen(Screen):
    """Step 1 — detect OS and required tools; offer to install what's missing."""

    BINDINGS = [
        Binding("enter", "continue", "Continue"),
        Binding("ctrl+c", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Static(constants.APP_NAME + " setup", classes="title")
            yield Static(
                "Detected platform: " + platform_label()
                + ".  We check for the tools the agent will use.",
                classes="hint",
            )
            table = DataTable(id="prereq_table", zebra_stripes=True)
            table.cursor_type = "row"
            yield table
            yield Static("", id="prereq_summary")
            yield RichLog(id="prereq_log", highlight=False, markup=False, wrap=True)
            with Horizontal(classes="buttons"):
                yield Button("Install missing", id="install", variant="warning")
                yield Button("Continue", id="continue", variant="primary")
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Step 1 of 5 — Prerequisites"
        table = self.query_one("#prereq_table", DataTable)
        table.add_columns("Tool", "Status", "Where")
        self._refresh_prereqs()

    # -- helpers -----------------------------------------------------------
    def _refresh_prereqs(self) -> None:
        results = detect_prereqs()
        table = self.query_one("#prereq_table", DataTable)
        table.clear()
        missing = 0
        for r in results:
            ok = bool(r["found"])
            if not ok:
                missing += 1
            mark = "[green]✓ ok[/]" if ok else "[red]✗ missing[/]"
            table.add_row(str(r["label"]), mark, str(r["detail"]))
        summary = self.query_one("#prereq_summary", Static)
        install_btn = self.query_one("#install", Button)
        if missing == 0:
            summary.update("[green]All prerequisites are present.[/]")
            install_btn.disabled = True
        else:
            mgr = detect_pkg_manager()
            if mgr:
                summary.update(
                    "[yellow]{} missing.[/] Install with [b]{}[/b] or Skip.".format(
                        missing, mgr
                    )
                )
                install_btn.disabled = False
            else:
                summary.update(
                    "[yellow]{} missing[/] and no package manager was found. "
                    "Install them manually, then Continue.".format(missing)
                )
                install_btn.disabled = True

    def _append_log(self, text: str) -> None:
        self.query_one("#prereq_log", RichLog).write(text)

    def _post_install(self) -> None:
        self._append_log("--- re-checking prerequisites ---")
        self._refresh_prereqs()
        self.query_one("#install", Button).disabled = False
        self.query_one("#continue", Button).disabled = False

    @work(thread=True, exclusive=True)
    def _run_install(self, command: List[str]) -> None:
        self.app.call_from_thread(self._append_log, "$ " + " ".join(command))
        try:
            proc = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except OSError as exc:
            self.app.call_from_thread(self._append_log, "error: " + str(exc))
            self.app.call_from_thread(self._post_install)
            return
        if proc.stdout is not None:
            for line in proc.stdout:
                self.app.call_from_thread(self._append_log, line.rstrip("\n"))
        proc.wait()
        self.app.call_from_thread(
            self._append_log, "(exit code {})".format(proc.returncode)
        )
        self.app.call_from_thread(self._post_install)

    # -- actions / events --------------------------------------------------
    def action_continue(self) -> None:
        self.app.switch_screen(MachineNameScreen())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "continue":
            self.action_continue()
        elif event.button.id == "install":
            mgr = detect_pkg_manager()
            if not mgr:
                self._append_log("No supported package manager detected.")
                return
            missing_keys = [
                str(r["key"]) for r in detect_prereqs() if not r["found"]
            ]
            packages = []
            for key in missing_keys:
                pkg = _PACKAGES.get(mgr, {}).get(key)
                if pkg and pkg not in packages:
                    packages.append(pkg)
            if not packages:
                self._append_log("Nothing to install.")
                return
            command = install_command(mgr, packages)
            if not command:
                self._append_log("Could not build an install command.")
                return
            self.query_one("#install", Button).disabled = True
            self.query_one("#continue", Button).disabled = True
            self._run_install(command)


class MachineNameScreen(Screen):
    """Step 2 — name this machine (defaults to the hostname)."""

    BINDINGS = [
        Binding("escape", "back", "Back"),
        Binding("ctrl+c", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Static("Name this machine", classes="title")
            yield Static(
                "This is the label you'll see in Tripplet when picking a machine.",
                classes="hint",
            )
            yield Input(
                value=self.app.machine_name or _default_machine_name(),
                placeholder="e.g. work-laptop",
                id="machine_name",
            )
            with Horizontal(classes="buttons"):
                yield Button("Back", id="back")
                yield Button("Next", id="next", variant="primary")
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Step 2 of 5 — Machine name"
        self.query_one("#machine_name", Input).focus()

    def _advance(self) -> None:
        value = self.query_one("#machine_name", Input).value.strip()
        if not value:
            value = _default_machine_name()
        self.app.machine_name = value
        self.app.switch_screen(PasswordScreen())

    def action_back(self) -> None:
        self.app.switch_screen(PrereqScreen())

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self._advance()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "next":
            self._advance()
        elif event.button.id == "back":
            self.action_back()


class PasswordScreen(Screen):
    """Step 3 — create + confirm the per-use password."""

    BINDINGS = [
        Binding("escape", "back", "Back"),
        Binding("ctrl+c", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Static("Set the access password", classes="title")
            yield Static(
                "Sonoma must supply this password for every operation. It is "
                "hashed locally (scrypt) and never stored in plaintext.",
                classes="hint",
            )
            yield Input(password=True, placeholder="Password", id="pw1")
            yield Input(password=True, placeholder="Confirm password", id="pw2")
            yield Static("", id="pw_strength")
            yield Static("", id="pw_error")
            with Horizontal(classes="buttons"):
                yield Button("Back", id="back")
                yield Button("Next", id="next", variant="primary")
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Step 3 of 5 — Password"
        self.query_one("#pw1", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "pw1":
            label, color = password_strength(event.value)
            target = self.query_one("#pw_strength", Static)
            if label:
                target.update("Strength: [{}]{}[/]".format(color, label))
            else:
                target.update("")

    def _advance(self) -> None:
        pw1 = self.query_one("#pw1", Input).value
        pw2 = self.query_one("#pw2", Input).value
        err = self.query_one("#pw_error", Static)
        if not pw1:
            err.update("[red]Password cannot be empty.[/]")
            self.query_one("#pw1", Input).focus()
            return
        if pw1 != pw2:
            err.update("[red]Passwords do not match.[/]")
            self.query_one("#pw2", Input).focus()
            return
        err.update("")
        # Store the hash now via the core Secret API.
        self.app.secret.set_password(pw1)
        self.app.switch_screen(PairingScreen())

    def action_back(self) -> None:
        self.app.switch_screen(MachineNameScreen())

    def on_input_submitted(self, event: Input.Submitted) -> None:
        if event.input.id == "pw1":
            self.query_one("#pw2", Input).focus()
        else:
            self._advance()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "next":
            self._advance()
        elif event.button.id == "back":
            self.action_back()


class PairingScreen(Screen):
    """Step 4 — generate and prominently display the pairing code."""

    BINDINGS = [
        Binding("escape", "back", "Back"),
        Binding("enter", "next", "Next"),
        Binding("r", "regenerate", "Regenerate"),
        Binding("ctrl+c", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Static("Your pairing code", classes="title")
            with Center():
                yield Static("", id="pairing_big", classes="big")
            with Center():
                yield Static("", id="pairing_plain")
            with Center():
                yield Static("", id="pairing_emoji")
            yield Static(
                "Enter this in Tripplet -> Sonoma -> OpenSonoma to link this "
                "machine to your account. You'll be asked to pick the emoji "
                "shown above. Press 'r' for a new code.",
                classes="hint",
            )
            with Horizontal(classes="buttons"):
                yield Button("Back", id="back")
                yield Button("Regenerate", id="regen")
                yield Button("Next", id="next", variant="primary")
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Step 4 of 5 — Pairing code"
        if not self.app.pairing_code:
            self.app.pairing_code = pairing.generate_pairing_code()
        self._render_code()

    def _render_code(self) -> None:
        code = self.app.pairing_code
        self.query_one("#pairing_big", Static).update(big_text(code))
        self.query_one("#pairing_plain", Static).update("[b]" + code + "[/b]")
        emoji = pairing.pairing_emoji(code)
        self.query_one("#pairing_emoji", Static).update(
            "Confirm emoji:  [b]{}[/b]".format(emoji)
        )

    def action_regenerate(self) -> None:
        self.app.pairing_code = pairing.generate_pairing_code()
        self._render_code()

    def action_next(self) -> None:
        self.app.switch_screen(InstallScreen())

    def action_back(self) -> None:
        self.app.switch_screen(PasswordScreen())

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "next":
            self.action_next()
        elif event.button.id == "back":
            self.action_back()
        elif event.button.id == "regen":
            self.action_regenerate()


class InstallScreen(Screen):
    """Step 5 — persist config + secret, then install and start the service."""

    BINDINGS = [Binding("ctrl+c", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Static("Installing the background service", classes="title")
            yield Static(
                "Saving your configuration and registering OpenSonoma to start "
                "automatically.",
                classes="hint",
            )
            yield RichLog(id="install_log", highlight=False, markup=False, wrap=True)
            with Horizontal(classes="buttons"):
                yield Button("Continue", id="continue", variant="primary",
                             disabled=True)
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Step 5 of 5 — Install service"
        self._persist()
        self._do_install()

    def _append_log(self, text: str) -> None:
        self.query_one("#install_log", RichLog).write(text)

    def _persist(self) -> None:
        """Write Config + Secret to disk before touching the service manager."""
        cfg = self.app.cfg
        if not cfg.device_id:
            cfg.device_id = crypto.new_device_id()
        cfg.machine_name = self.app.machine_name or _default_machine_name()
        cfg.pairing_code = self.app.pairing_code
        if not cfg.relay_url:
            cfg.relay_url = constants.DEFAULT_RELAY_URL
        secret = self.app.secret
        secret.ensure_device_token()
        try:
            cfg.save()
            secret.save()
            self._append_log("Saved configuration to " + str(constants.CONFIG_DIR))
        except OSError as exc:
            self._append_log("error saving config: " + str(exc))

    def _enable_continue(self) -> None:
        btn = self.query_one("#continue", Button)
        btn.disabled = False
        btn.focus()

    @work(thread=True, exclusive=True)
    def _do_install(self) -> None:
        try:
            from . import service
        except ImportError as exc:
            self.app.call_from_thread(
                self._append_log,
                "service module unavailable: " + str(exc),
            )
            self.app.call_from_thread(self._enable_continue)
            return

        self.app.call_from_thread(self._append_log, "Installing service...")
        try:
            msg = service.install_service()
            self.app.call_from_thread(self._append_log, str(msg))
        except Exception as exc:  # noqa: BLE001 - never crash the wizard
            self.app.call_from_thread(
                self._append_log, "install error: " + str(exc)
            )

        self.app.call_from_thread(self._append_log, "Starting service...")
        try:
            start_fn = getattr(service, "start", None) or service.start_service
            msg = start_fn()
            self.app.call_from_thread(self._append_log, str(msg))
        except Exception as exc:  # noqa: BLE001
            self.app.call_from_thread(
                self._append_log, "start error: " + str(exc)
            )

        try:
            installed = service.is_installed()
            if installed:
                self.app.call_from_thread(
                    self._append_log, "[ok] Service is installed."
                )
            else:
                self.app.call_from_thread(
                    self._append_log,
                    "[warn] Service did not report as installed. You can start "
                    "the daemon manually with: opensonoma start",
                )
        except Exception as exc:  # noqa: BLE001
            self.app.call_from_thread(
                self._append_log, "status check error: " + str(exc)
            )

        self.app.call_from_thread(
            self._append_log, "Setup complete. Press Continue for live status."
        )
        self.app.call_from_thread(self._enable_continue)

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "continue":
            self.app.switch_screen(StatusScreen())


# ===========================================================================
# Status screen (final wizard screen + standalone run_status())
# ===========================================================================
class StatusScreen(Screen):
    """Live dashboard: link state, pairing code, and recent operations."""

    BINDINGS = [
        Binding("q", "quit", "Quit"),
        Binding("r", "refresh", "Refresh"),
        Binding("ctrl+c", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Static(constants.APP_NAME + " status", classes="title")
            yield Static("", id="status_info")
            yield Static("Recent operations", classes="title")
            table = DataTable(id="ops_table", zebra_stripes=True)
            table.cursor_type = "row"
            yield table
        yield Footer()

    def on_mount(self) -> None:
        self.app.sub_title = "Status"
        table = self.query_one("#ops_table", DataTable)
        table.add_columns("When", "Kind", "Command", "Result")
        self.refresh_status()
        self.set_interval(2.0, self.refresh_status)

    def action_refresh(self) -> None:
        self.refresh_status()

    def refresh_status(self) -> None:
        try:
            self._render_info()
            self._render_ops()
        except Exception:  # noqa: BLE001 - the timer must never crash
            pass

    def _render_info(self) -> None:
        status = read_status_file()
        cfg = Config.load()
        name = status.get("machine_name") or cfg.machine_name or "(unknown)"
        code = status.get("pairing_code") or cfg.pairing_code or "(none)"
        version = status.get("version") or constants.VERSION
        pid = status.get("pid")
        paired = bool(status.get("paired", cfg.paired))
        account = status.get("account_id") or cfg.account_id

        if status:
            state = str(status.get("link_state") or "offline")
        else:
            state = "not running"
        color = {
            "online": "green",
            "connecting": "yellow",
            "offline": "red",
            "not running": "red",
        }.get(state, "red")

        lines = []
        lines.append("Machine:      [b]{}[/b]".format(name))
        lines.append("Pairing code: [b]{}[/b]".format(code))
        if not paired and code not in ("", "(none)"):
            lines.append(
                "Confirm emoji:[b] {}[/b]".format(pairing.pairing_emoji(code))
            )
        lines.append("Link:         [{}]{}[/]".format(color, state))
        if paired:
            acct = (" (account {})".format(account)) if account else ""
            lines.append("Paired:       [green]yes[/]" + acct)
        else:
            lines.append("Paired:       [yellow]no[/] - enter the code in Tripplet")
        if status.get("connected_since"):
            lines.append("Connected:    {}".format(status.get("connected_since")))
        lines.append("Daemon PID:   {}".format(pid if pid else "-"))
        lines.append(self._service_line())
        lines.append("Version:      {}".format(version))
        if not status:
            lines.append(
                "[dim]No live status yet. Start the daemon with: "
                "opensonoma start[/]"
            )
        self.query_one("#status_info", Static).update("\n".join(lines))

    def _service_line(self) -> str:
        try:
            from . import service
            installed = service.is_installed()
        except Exception:  # noqa: BLE001
            return "Service:      [dim]unknown[/]"
        if installed:
            return "Service:      [green]installed[/]"
        return "Service:      [yellow]not installed[/]"

    def _render_ops(self) -> None:
        table = self.query_one("#ops_table", DataTable)
        rows = read_recent_ops(constants.RECENT_OPS_KEPT)
        table.clear()
        for op in reversed(rows):  # newest first
            when = _fmt_time(op.get("finished_at") or op.get("started_at"))
            kind = str(op.get("kind") or "")
            command = _truncate(str(op.get("command") or ""), 48)
            if op.get("finished_at"):
                if op.get("error"):
                    result = "[red]" + _truncate(str(op.get("error")), 18) + "[/]"
                else:
                    code = op.get("exit_code")
                    if code in (0, None):
                        result = "[green]exit 0[/]" if code == 0 else "done"
                    else:
                        result = "[red]exit {}[/]".format(code)
            else:
                result = "[yellow]running[/]"
            table.add_row(when, kind, command, result)
        if not rows:
            table.add_row("-", "-", "no operations yet", "-")


# ===========================================================================
# Apps
# ===========================================================================
_CSS = """
.title { text-style: bold; color: $accent; padding: 1 1 0 1; }
.hint { text-style: dim; padding: 0 1 1 1; }
.buttons { height: auto; align-horizontal: center; padding: 1 0; }
Button { margin: 0 1; }
Input { margin: 0 1; }
#prereq_table { height: auto; margin: 1 1; }
#prereq_summary { padding: 0 1; }
#prereq_log { height: 10; border: round $panel; margin: 1 1; }
#install_log { height: 16; border: round $panel; margin: 1 1; }
#status_info { padding: 1 2; }
#ops_table { height: 1fr; margin: 0 1 1 1; }
.big { padding: 1 0; color: $success; text-style: bold; }
#pairing_plain { padding: 0 0 1 0; }
"""


class WizardApp(App):
    """First-run setup wizard."""

    TITLE = constants.APP_NAME
    CSS = _CSS
    BINDINGS = [Binding("ctrl+c", "quit", "Quit")]

    def __init__(self) -> None:
        super().__init__()
        # Shared wizard state, persisted to disk at the install step.
        self.cfg = Config.load()
        self.secret = Secret.load()
        self.machine_name = self.cfg.machine_name or ""
        self.pairing_code = ""

    def on_mount(self) -> None:
        constants.ensure_config_dir()
        self.push_screen(PrereqScreen())


class StatusApp(App):
    """Standalone live status dashboard."""

    TITLE = constants.APP_NAME
    CSS = _CSS
    BINDINGS = [Binding("ctrl+c", "quit", "Quit")]

    def on_mount(self) -> None:
        self.push_screen(StatusScreen())


# ---------------------------------------------------------------------------
# Helpers + public entry points
# ---------------------------------------------------------------------------
def _default_machine_name() -> str:
    try:
        name = socket.gethostname()
    except OSError:
        name = ""
    if name.endswith(".local"):
        name = name[: -len(".local")]
    name = name.strip()
    return name or "my-machine"


def run_wizard() -> None:
    """Launch the interactive first-run setup wizard."""
    WizardApp().run()


def run_status() -> None:
    """Launch the live status dashboard."""
    StatusApp().run()
