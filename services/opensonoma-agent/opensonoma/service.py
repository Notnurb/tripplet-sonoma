"""Service installer / supervisor integration for the OpenSonoma daemon.

The daemon is meant to run as a background service that starts at login and is
restarted automatically if it crashes. This module wires that up natively on
each supported platform:

  * macOS  — a per-user LaunchAgent plist managed with ``launchctl``.
  * Linux  — a systemd **user** unit managed with ``systemctl --user`` (with
             ``loginctl enable-linger`` so it survives logout).

Everything here is best-effort and never raises on a missing/uncooperative
service manager: the public functions return human-readable strings (or, for
``service_status``, a dict) describing exactly what happened so the CLI/TUI can
show it to the user. The run target is always::

    [sys.executable, "-m", "opensonoma", "daemon"]

which is reliable regardless of how the package landed on PATH. Service stdout
and stderr are redirected to ``constants.DAEMON_LOG``.
"""

from __future__ import annotations

import os
import plistlib
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

from . import constants

__all__ = [
    "platform_name",
    "is_installed",
    "install_service",
    "uninstall_service",
    "start_service",
    "stop_service",
    "start",
    "stop",
    "service_status",
]

# Commands should be quick; guard against a hung service manager.
_CMD_TIMEOUT = 30


# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
def platform_name() -> str:
    """Friendly name for the current platform (for messages)."""
    if sys.platform == "darwin":
        return "macOS"
    if sys.platform.startswith("linux"):
        return "Linux"
    return sys.platform or "unknown"


def _platform() -> str:
    """Internal dispatch key: ``"darwin"`` / ``"linux"`` / ``"other"``."""
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("linux"):
        return "linux"
    return "other"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _run_target() -> List[str]:
    """The argv that launches the daemon."""
    return [sys.executable, "-m", "opensonoma", "daemon"]


def _run(cmd: List[str]):
    """Run *cmd*, returning ``(returncode, stdout, stderr)``.

    ``returncode`` is ``None`` when the command could not be executed at all
    (e.g. the service manager binary is missing or it timed out); in that case
    ``stderr`` carries an explanatory message. This never raises.
    """
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_CMD_TIMEOUT,
            universal_newlines=True,  # text mode (3.9-compatible spelling)
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except FileNotFoundError:
        return None, "", "command not found: {}".format(cmd[0])
    except subprocess.TimeoutExpired:
        return None, "", "timed out: {}".format(" ".join(cmd))
    except OSError as exc:
        return None, "", str(exc)


def _detail(err: str, out: str) -> str:
    """Pick the most useful one-line detail out of a command's output."""
    text = (err or out or "").strip()
    return text.splitlines()[0] if text else ""


def _current_user() -> str:
    try:
        import getpass

        return getpass.getuser()
    except Exception:
        return os.environ.get("USER") or os.environ.get("LOGNAME") or ""


def _service_env() -> Dict[str, str]:
    """Environment variables to bake into the service definition.

    launchd/systemd start the daemon with a minimal environment, so we provide
    a sane ``PATH`` (so the engine can find compilers/cmake/git) and pass
    through the OpenSonoma overrides plus locale so the config dir and relay
    match the interactive setup.
    """
    parts: List[str] = []
    current = os.environ.get("PATH", "")
    if current:
        parts.extend(current.split(os.pathsep))
    for extra in (
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        str(Path.home() / ".local" / "bin"),
    ):
        if extra not in parts:
            parts.append(extra)
    env: Dict[str, str] = {"PATH": os.pathsep.join(parts)}
    for key in ("OPENSONOMA_HOME", "OPENSONOMA_RELAY_URL", "LANG", "LC_ALL"):
        val = os.environ.get(key)
        if val:
            env[key] = val
    return env


def _ensure_dirs() -> Optional[str]:
    """Make sure the config dir (and thus the log path's parent) exists.

    Returns an error string on failure, otherwise ``None``.
    """
    try:
        constants.ensure_config_dir()
        return None
    except OSError as exc:
        return "Could not create config dir {}: {}".format(constants.CONFIG_DIR, exc)


def _unsupported(action: str) -> str:
    return (
        "Automatic service {} is not supported on {}. "
        "Run the daemon manually with `opensonoma start`.".format(
            action, platform_name()
        )
    )


# ---------------------------------------------------------------------------
# macOS — LaunchAgent (launchd)
# ---------------------------------------------------------------------------
def _plist_path() -> Path:
    return (
        Path.home()
        / "Library"
        / "LaunchAgents"
        / "{}.plist".format(constants.SERVICE_LABEL)
    )


def _macos_plist_dict() -> dict:
    return {
        "Label": constants.SERVICE_LABEL,
        "ProgramArguments": _run_target(),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "WorkingDirectory": str(Path.home()),
        "StandardOutPath": str(constants.DAEMON_LOG),
        "StandardErrorPath": str(constants.DAEMON_LOG),
        "EnvironmentVariables": _service_env(),
    }


def _install_macos() -> str:
    err = _ensure_dirs()
    if err:
        return err
    plist_path = _plist_path()
    try:
        plist_path.parent.mkdir(parents=True, exist_ok=True)
        with open(plist_path, "wb") as fh:
            plistlib.dump(_macos_plist_dict(), fh)
    except OSError as exc:
        return "Failed to write LaunchAgent plist at {}: {}".format(plist_path, exc)

    # Unload any prior copy (ignore errors), then load with -w to enable it.
    _run(["launchctl", "unload", str(plist_path)])
    rc, out, err_s = _run(["launchctl", "load", "-w", str(plist_path)])
    if rc is None:
        return (
            "Wrote LaunchAgent at {} but launchctl is unavailable ({}). "
            "It will load on your next login.".format(plist_path, _detail(err_s, out))
        )
    if rc != 0:
        return (
            "Wrote LaunchAgent at {} but `launchctl load` failed: {}".format(
                plist_path, _detail(err_s, out)
            )
        )
    return (
        "Installed LaunchAgent '{}' at {}. It is now running and will start "
        "automatically at every login.".format(constants.SERVICE_LABEL, plist_path)
    )


def _uninstall_macos() -> str:
    plist_path = _plist_path()
    if not plist_path.exists():
        # Try to unload by label anyway in case it lingers in launchd.
        _run(["launchctl", "remove", constants.SERVICE_LABEL])
        return "No LaunchAgent installed at {}.".format(plist_path)
    _run(["launchctl", "unload", "-w", str(plist_path)])
    try:
        plist_path.unlink()
    except OSError as exc:
        return "Unloaded the service but failed to remove {}: {}".format(
            plist_path, exc
        )
    return "Uninstalled LaunchAgent '{}' and removed {}.".format(
        constants.SERVICE_LABEL, plist_path
    )


def _start_macos() -> str:
    plist_path = _plist_path()
    if not plist_path.exists():
        return (
            "Service is not installed (no plist at {}). "
            "Run `opensonoma service install` first.".format(plist_path)
        )
    # Make sure it is loaded before asking launchd to start it.
    _run(["launchctl", "load", "-w", str(plist_path)])
    rc, out, err_s = _run(["launchctl", "start", constants.SERVICE_LABEL])
    if rc is None:
        return "launchctl is unavailable: {}".format(_detail(err_s, out))
    if rc != 0:
        return "Failed to start service '{}': {}".format(
            constants.SERVICE_LABEL, _detail(err_s, out)
        )
    return "Started service '{}'.".format(constants.SERVICE_LABEL)


def _stop_macos() -> str:
    rc, out, err_s = _run(["launchctl", "stop", constants.SERVICE_LABEL])
    if rc is None:
        return "launchctl is unavailable: {}".format(_detail(err_s, out))
    if rc != 0:
        return "Service '{}' was not running (or stop failed): {}".format(
            constants.SERVICE_LABEL, _detail(err_s, out)
        )
    return (
        "Stopped service '{}'. (KeepAlive will relaunch it; use "
        "`opensonoma service uninstall` to stop it permanently.)".format(
            constants.SERVICE_LABEL
        )
    )


def _status_macos() -> dict:
    plist_path = _plist_path()
    status = {
        "platform": platform_name(),
        "manager": "launchd",
        "supported": True,
        "label": constants.SERVICE_LABEL,
        "unit_path": str(plist_path),
        "installed": plist_path.exists(),
        "loaded": False,
        "running": False,
        "enabled": False,
        "pid": None,
        "last_exit_code": None,
        "detail": "",
    }
    rc, out, err_s = _run(["launchctl", "list"])
    if rc is None:
        status["detail"] = "launchctl is unavailable: {}".format(_detail(err_s, out))
        return status
    for line in out.splitlines():
        cols = line.split("\t")
        if len(cols) >= 3 and cols[2].strip() == constants.SERVICE_LABEL:
            status["loaded"] = True
            status["enabled"] = True  # loaded with RunAtLoad => starts at login
            pid_s = cols[0].strip()
            if pid_s not in ("-", ""):
                try:
                    status["pid"] = int(pid_s)
                    status["running"] = True
                except ValueError:
                    pass
            exit_s = cols[1].strip()
            try:
                status["last_exit_code"] = int(exit_s)
            except ValueError:
                pass
            break
    if status["running"]:
        status["detail"] = "running (pid {})".format(status["pid"])
    elif status["loaded"]:
        status["detail"] = "loaded but not running"
    elif status["installed"]:
        status["detail"] = "installed but not loaded"
    else:
        status["detail"] = "not installed"
    return status


# ---------------------------------------------------------------------------
# Linux — systemd user unit
# ---------------------------------------------------------------------------
def _unit_path() -> Path:
    return (
        Path.home()
        / ".config"
        / "systemd"
        / "user"
        / constants.SYSTEMD_UNIT_NAME
    )


def _exec_start() -> str:
    parts = []
    for arg in _run_target():
        if any(ch.isspace() for ch in arg):
            parts.append('"{}"'.format(arg))
        else:
            parts.append(arg)
    return " ".join(parts)


def _systemd_unit_text() -> str:
    env_lines = "".join(
        'Environment="{}={}"\n'.format(key, val)
        for key, val in _service_env().items()
    )
    log = str(constants.DAEMON_LOG)
    return (
        "[Unit]\n"
        "Description=OpenSonoma daemon (Tripplet Sonoma machine access)\n"
        "After=network-online.target\n"
        "Wants=network-online.target\n"
        "\n"
        "[Service]\n"
        "Type=simple\n"
        "ExecStart={exec_start}\n"
        "Restart=always\n"
        "RestartSec=3\n"
        "WorkingDirectory={home}\n"
        "{env_lines}"
        "StandardOutput=append:{log}\n"
        "StandardError=append:{log}\n"
        "\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    ).format(
        exec_start=_exec_start(),
        home=str(Path.home()),
        env_lines=env_lines,
        log=log,
    )


def _enable_linger() -> str:
    user = _current_user()
    if not user:
        return ""
    rc, out, err_s = _run(["loginctl", "enable-linger", user])
    if rc is None:
        return (
            "(loginctl is unavailable; run `loginctl enable-linger {}` so the "
            "service keeps running after you log out.)".format(user)
        )
    if rc != 0:
        return (
            "(Could not enable lingering automatically; run "
            "`loginctl enable-linger {}` to keep it running after logout.)".format(
                user
            )
        )
    return "Enabled lingering for {} (service survives logout).".format(user)


def _install_linux() -> str:
    err = _ensure_dirs()
    if err:
        return err
    unit_path = _unit_path()
    try:
        unit_path.parent.mkdir(parents=True, exist_ok=True)
        unit_path.write_text(_systemd_unit_text())
    except OSError as exc:
        return "Failed to write systemd user unit at {}: {}".format(unit_path, exc)

    msgs = ["Wrote systemd user unit at {}.".format(unit_path)]
    rc, out, err_s = _run(["systemctl", "--user", "daemon-reload"])
    if rc is None:
        msgs.append(
            "systemctl is unavailable ({}); could not enable the service "
            "automatically. Start the daemon with `opensonoma start` "
            "instead.".format(_detail(err_s, out))
        )
        return " ".join(msgs)

    rc, out, err_s = _run(
        ["systemctl", "--user", "enable", "--now", constants.SYSTEMD_UNIT_NAME]
    )
    if rc != 0:
        msgs.append(
            "`systemctl --user enable --now` failed: {}".format(_detail(err_s, out))
        )
    else:
        msgs.append(
            "Enabled and started '{}'.".format(constants.SYSTEMD_UNIT_NAME)
        )

    linger = _enable_linger()
    if linger:
        msgs.append(linger)
    return " ".join(msgs)


def _uninstall_linux() -> str:
    unit_path = _unit_path()
    msgs: List[str] = []
    rc, out, err_s = _run(
        ["systemctl", "--user", "disable", "--now", constants.SYSTEMD_UNIT_NAME]
    )
    if rc is None:
        msgs.append("systemctl is unavailable ({}).".format(_detail(err_s, out)))
    elif rc == 0:
        msgs.append("Stopped and disabled '{}'.".format(constants.SYSTEMD_UNIT_NAME))

    if unit_path.exists():
        try:
            unit_path.unlink()
            msgs.append("Removed {}.".format(unit_path))
        except OSError as exc:
            msgs.append("Failed to remove {}: {}".format(unit_path, exc))
    else:
        msgs.append("No unit file at {}.".format(unit_path))

    _run(["systemctl", "--user", "daemon-reload"])
    return " ".join(msgs) if msgs else "Nothing to uninstall."


def _start_linux() -> str:
    unit_path = _unit_path()
    if not unit_path.exists():
        return (
            "Service is not installed (no unit at {}). "
            "Run `opensonoma service install` first.".format(unit_path)
        )
    rc, out, err_s = _run(
        ["systemctl", "--user", "start", constants.SYSTEMD_UNIT_NAME]
    )
    if rc is None:
        return "systemctl is unavailable: {}".format(_detail(err_s, out))
    if rc != 0:
        return "Failed to start '{}': {}".format(
            constants.SYSTEMD_UNIT_NAME, _detail(err_s, out)
        )
    return "Started '{}'.".format(constants.SYSTEMD_UNIT_NAME)


def _stop_linux() -> str:
    rc, out, err_s = _run(
        ["systemctl", "--user", "stop", constants.SYSTEMD_UNIT_NAME]
    )
    if rc is None:
        return "systemctl is unavailable: {}".format(_detail(err_s, out))
    if rc != 0:
        return "Failed to stop '{}': {}".format(
            constants.SYSTEMD_UNIT_NAME, _detail(err_s, out)
        )
    return "Stopped '{}'.".format(constants.SYSTEMD_UNIT_NAME)


def _status_linux() -> dict:
    unit_path = _unit_path()
    status = {
        "platform": platform_name(),
        "manager": "systemd",
        "supported": True,
        "label": constants.SYSTEMD_UNIT_NAME,
        "unit_path": str(unit_path),
        "installed": unit_path.exists(),
        "loaded": False,
        "running": False,
        "enabled": False,
        "pid": None,
        "last_exit_code": None,
        "detail": "",
    }
    rc, out, err_s = _run(
        ["systemctl", "--user", "is-active", constants.SYSTEMD_UNIT_NAME]
    )
    if rc is None:
        status["detail"] = "systemctl is unavailable: {}".format(_detail(err_s, out))
        return status
    active = out.strip()
    status["running"] = active == "active"

    rc2, out2, _ = _run(
        ["systemctl", "--user", "is-enabled", constants.SYSTEMD_UNIT_NAME]
    )
    status["enabled"] = out2.strip() == "enabled"

    rc3, out3, _ = _run(
        [
            "systemctl",
            "--user",
            "show",
            constants.SYSTEMD_UNIT_NAME,
            "--property=MainPID",
            "--property=ExecMainStatus",
            "--property=LoadState",
        ]
    )
    props: Dict[str, str] = {}
    for line in out3.splitlines():
        key, sep, val = line.partition("=")
        if sep:
            props[key.strip()] = val.strip()
    pid = props.get("MainPID", "")
    if pid.isdigit() and int(pid) > 0:
        status["pid"] = int(pid)
    exitc = props.get("ExecMainStatus", "")
    if exitc.lstrip("-").isdigit():
        status["last_exit_code"] = int(exitc)
    status["loaded"] = props.get("LoadState", "") == "loaded"

    if status["running"]:
        status["detail"] = (
            "active (pid {})".format(status["pid"]) if status["pid"] else "active"
        )
    elif status["installed"]:
        status["detail"] = "installed ({})".format(active or "inactive")
    else:
        status["detail"] = "not installed"
    return status


# ---------------------------------------------------------------------------
# Public interface (platform dispatch)
# ---------------------------------------------------------------------------
def is_installed() -> bool:
    """True if a service definition exists for this platform."""
    plat = _platform()
    if plat == "darwin":
        return _plist_path().exists()
    if plat == "linux":
        return _unit_path().exists()
    return False


def install_service() -> str:
    plat = _platform()
    if plat == "darwin":
        return _install_macos()
    if plat == "linux":
        return _install_linux()
    return _unsupported("installation")


def uninstall_service() -> str:
    plat = _platform()
    if plat == "darwin":
        return _uninstall_macos()
    if plat == "linux":
        return _uninstall_linux()
    return _unsupported("removal")


def start_service() -> str:
    plat = _platform()
    if plat == "darwin":
        return _start_macos()
    if plat == "linux":
        return _start_linux()
    return _unsupported("start")


def stop_service() -> str:
    plat = _platform()
    if plat == "darwin":
        return _stop_macos()
    if plat == "linux":
        return _stop_linux()
    return _unsupported("stop")


def service_status() -> dict:
    plat = _platform()
    if plat == "darwin":
        return _status_macos()
    if plat == "linux":
        return _status_linux()
    return {
        "platform": platform_name(),
        "manager": None,
        "supported": False,
        "label": constants.SERVICE_LABEL,
        "unit_path": None,
        "installed": False,
        "loaded": False,
        "running": False,
        "enabled": False,
        "pid": None,
        "last_exit_code": None,
        "detail": "unsupported platform",
    }


# Aliases required by the spec (CLI/TUI call service.start()/service.stop()).
start = start_service
stop = stop_service
