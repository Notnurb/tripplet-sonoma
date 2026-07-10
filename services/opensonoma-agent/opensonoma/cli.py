"""Command-line front-end for OpenSonoma.

This is the ``opensonoma`` entry point declared in pyproject.toml. It is the one
module a user interacts with directly, so it stays light: imports that pull in
Textual (the ``tui`` module) are done lazily inside the handlers that need them,
so ``daemon`` / ``status`` / ``logs`` work fine on a headless host.

    opensonoma                 open the setup wizard (first run) or status screen
    opensonoma setup           force the setup wizard
    opensonoma start           start the background daemon (service or detached)
    opensonoma stop            stop it
    opensonoma restart         stop then start
    opensonoma status          print a one-screen status summary
    opensonoma logs [-f] [-n]  tail the operations log (--daemon for daemon log)
    opensonoma pair            show the pairing code + verification emoji
    opensonoma daemon          run the daemon in the foreground (service target)
    opensonoma service install|uninstall
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from typing import List, Optional

from . import constants
from . import pairing
from .config import Config, is_first_run


# ---------------------------------------------------------------------------
# Small presentation helpers
# ---------------------------------------------------------------------------
def _box(lines: List[str]) -> str:
    width = max((len(s) for s in lines), default=0)
    top = "┌" + "─" * (width + 2) + "┐"
    bot = "└" + "─" * (width + 2) + "┘"
    body = ["│ " + s.ljust(width) + " │" for s in lines]
    return "\n".join([top] + body + [bot])


def _read_status() -> Optional[dict]:
    import json

    try:
        return json.loads(constants.STATUS_FILE.read_text())
    except (OSError, ValueError):
        return None


def _pid_alive(pid: Optional[int]) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def _read_pidfile() -> Optional[int]:
    try:
        return int(constants.PID_FILE.read_text().strip())
    except (OSError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
def _cmd_default(_args: argparse.Namespace) -> int:
    from . import tui  # lazy: pulls in Textual

    if is_first_run():
        tui.run_wizard()
    else:
        tui.run_status()
    return 0


def _cmd_setup(_args: argparse.Namespace) -> int:
    from . import tui

    tui.run_wizard()
    return 0


def _cmd_daemon(_args: argparse.Namespace) -> int:
    from . import daemon

    daemon.main()
    return 0


def _cmd_start(_args: argparse.Namespace) -> int:
    from . import service

    if is_first_run():
        sys.stderr.write("OpenSonoma is not set up yet. Run: opensonoma setup\n")
        return 1

    if service.is_installed():
        print(service.start_service())
        return 0

    # No service manager wiring — spawn a detached daemon ourselves.
    constants.ensure_config_dir()
    existing = _read_pidfile()
    if _pid_alive(existing):
        print("Daemon already running (pid {}).".format(existing))
        return 0

    logf = open(constants.DAEMON_LOG, "a")
    proc = subprocess.Popen(
        [sys.executable, "-m", "opensonoma", "daemon"],
        stdout=logf,
        stderr=logf,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    print("Started OpenSonoma daemon (pid {}).".format(proc.pid))
    print("Logs: {}".format(constants.DAEMON_LOG))
    return 0


def _cmd_stop(_args: argparse.Namespace) -> int:
    from . import service

    if service.is_installed():
        print(service.stop_service())
        return 0

    pid = _read_pidfile()
    if not _pid_alive(pid):
        print("Daemon is not running.")
        return 0
    try:
        os.kill(int(pid), signal.SIGTERM)
        print("Sent SIGTERM to daemon (pid {}).".format(pid))
        return 0
    except OSError as exc:
        sys.stderr.write("Could not stop daemon: {}\n".format(exc))
        return 1


def _cmd_restart(args: argparse.Namespace) -> int:
    _cmd_stop(args)
    time.sleep(1.0)
    return _cmd_start(args)


def _cmd_status(_args: argparse.Namespace) -> int:
    from . import service

    cfg = Config.load()
    status = _read_status() or {}
    name = status.get("machine_name") or cfg.machine_name or "(unset)"
    code = status.get("pairing_code") or cfg.pairing_code or "(none)"
    link = status.get("link_state") or "not running"
    paired = bool(status.get("paired", cfg.paired))
    pid = status.get("pid")
    recent = status.get("recent_ops") or []

    running = _pid_alive(pid) or service.is_installed() and "running" in str(service.service_status())

    print("{} {}".format(constants.APP_NAME, constants.VERSION))
    print("  Machine:      {}".format(name))
    print("  Pairing code: {}".format(code))
    if code not in ("", "(none)"):
        print("  Confirm emoji: {}".format(pairing.pairing_emoji(code)))
    print("  Link:         {}".format(link))
    print("  Paired:       {}".format("yes" if paired else "no — enter the code in Tripplet"))
    print("  Daemon:       {}".format("running (pid {})".format(pid) if _pid_alive(pid) else "stopped"))
    print("  Recent ops:   {}".format(len(recent)))
    if is_first_run():
        print("\n  Not set up yet — run: opensonoma setup")
    return 0


def _cmd_logs(args: argparse.Namespace) -> int:
    path = constants.DAEMON_LOG if args.daemon else constants.OPERATIONS_LOG
    if not path.exists():
        print("No log yet at {}".format(path))
        return 0

    def tail(n: int) -> List[str]:
        try:
            with open(path, "r", errors="replace") as fh:
                return fh.readlines()[-n:]
        except OSError:
            return []

    for line in tail(args.lines):
        sys.stdout.write(line if line.endswith("\n") else line + "\n")

    if args.follow:
        try:
            with open(path, "r", errors="replace") as fh:
                fh.seek(0, os.SEEK_END)
                while True:
                    line = fh.readline()
                    if line:
                        sys.stdout.write(line)
                        sys.stdout.flush()
                    else:
                        time.sleep(0.4)
        except KeyboardInterrupt:
            return 0
        except OSError as exc:
            sys.stderr.write("log follow ended: {}\n".format(exc))
            return 1
    return 0


def _cmd_pair(_args: argparse.Namespace) -> int:
    cfg = Config.load()
    if not cfg.pairing_code:
        sys.stderr.write("No pairing code yet. Run: opensonoma setup\n")
        return 1
    emoji = pairing.pairing_emoji(cfg.pairing_code)
    print(_box(["Pairing code", "", cfg.pairing_code, "", "Verify emoji:  " + emoji]))
    print("\nEnter this in Tripplet → Sonoma → Connect (or visit /connect),")
    print("then pick the {} emoji to link this machine.".format(emoji))
    return 0


def _cmd_service(args: argparse.Namespace) -> int:
    from . import service

    if args.service_action == "install":
        print(service.install_service())
    elif args.service_action == "uninstall":
        print(service.uninstall_service())
    else:
        print(service.service_status())
    return 0


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="opensonoma",
        description="Give Tripplet Sonoma owner-authorized access to this machine.",
    )
    p.add_argument(
        "--version",
        action="version",
        version="{} {}".format(constants.APP_NAME, constants.VERSION),
    )
    p.set_defaults(func=_cmd_default)

    sub = p.add_subparsers(dest="command")

    sub.add_parser("setup", help="open the setup wizard").set_defaults(func=_cmd_setup)
    # Hidden-ish: the service target that runs the daemon in the foreground.
    sub.add_parser("daemon", help="run the daemon in the foreground").set_defaults(func=_cmd_daemon)
    sub.add_parser("start", help="start the background daemon").set_defaults(func=_cmd_start)
    sub.add_parser("stop", help="stop the background daemon").set_defaults(func=_cmd_stop)
    sub.add_parser("restart", help="restart the background daemon").set_defaults(func=_cmd_restart)
    sub.add_parser("status", help="print a status summary").set_defaults(func=_cmd_status)
    sub.add_parser("pair", help="show the pairing code + emoji").set_defaults(func=_cmd_pair)

    logs = sub.add_parser("logs", help="tail the operations log")
    logs.add_argument("-f", "--follow", action="store_true", help="follow new lines")
    logs.add_argument("-n", "--lines", type=int, default=40, help="lines to show")
    logs.add_argument("--daemon", action="store_true", help="show the daemon log instead")
    logs.set_defaults(func=_cmd_logs)

    svc = sub.add_parser("service", help="install or uninstall the background service")
    svc.add_argument("service_action", choices=["install", "uninstall", "status"], nargs="?", default="status")
    svc.set_defaults(func=_cmd_service)

    return p


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
