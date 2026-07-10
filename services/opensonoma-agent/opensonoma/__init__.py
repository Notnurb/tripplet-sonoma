"""OpenSonoma — give Tripplet Sonoma full, owner-authorized access to a machine.

This package provides:
  * a TUI setup wizard (opensonoma.tui)
  * an always-on daemon that connects out to the Tripplet relay (opensonoma.daemon)
  * an execution engine for bash / python / C++ / web (opensonoma.exec_engine)
  * service installers for macOS (launchd) and Linux (systemd) (opensonoma.service)
  * a CLI front-end (opensonoma.cli)

Nothing in this package executes anything until the daemon receives an operation
from the relay AND the per-operation password is verified against the locally
stored hash. The plaintext password is never written to disk and never leaves the
machine in a stored form.
"""

from .constants import APP_NAME, VERSION

__all__ = ["APP_NAME", "VERSION"]
__version__ = VERSION
