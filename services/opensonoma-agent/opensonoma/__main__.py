"""Enable ``python -m opensonoma``.

The service runner and the daemon spawn the package this way
(``[sys.executable, "-m", "opensonoma", "daemon"]``) so it works regardless of
where the console script landed on PATH.
"""

from .cli import main

raise SystemExit(main())
