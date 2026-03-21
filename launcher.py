"""
launcher.py — Smritix entry-point launcher.

On first run  → opens the /setup page so the user can step through the install wizard.
On later runs → opens the main app directly.

Usage:
    python launcher.py          # start the server and open browser
    python launcher.py --no-browser  # server only (for testing)
"""

import os
import sys
import time
import socket
import threading
import webbrowser
import subprocess
import argparse
import logging

logging.basicConfig(level=logging.INFO, format="[Smritix] %(message)s")
log = logging.getLogger(__name__)

# ── Resolve paths ──────────────────────────────────────────────────────────────
LAUNCHER_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR  = os.path.join(LAUNCHER_DIR, "backend")
sys.path.insert(0, BACKEND_DIR)

from config import DB_PATH, APP_DATA_DIR, ensure_dirs
from database import init_db, db_session


def is_setup_done() -> bool:
    """Check if the one-time setup wizard has been completed."""
    try:
        with db_session(DB_PATH) as conn:
            row = conn.execute(
                "SELECT value FROM app_settings WHERE key_name='setup_complete'"
            ).fetchone()
            return row and row["value"] == "true"
    except Exception:
        return False


def wait_for_server(port: int, timeout: float = 12.0) -> bool:
    """Poll localhost until the Flask server is accepting connections."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def read_port() -> int | None:
    """Read the port chosen by the Flask app from the .port file."""
    port_file = os.path.join(APP_DATA_DIR, ".port")
    for _ in range(30):          # wait up to 3 seconds
        if os.path.exists(port_file):
            try:
                return int(open(port_file).read().strip())
            except Exception:
                pass
        time.sleep(0.1)
    return None


def main():
    parser = argparse.ArgumentParser(description="Smritix launcher")
    parser.add_argument("--no-browser", action="store_true", help="Don't open the browser")
    args = parser.parse_args()

    log.info("Starting Smritix…")

    # Ensure data dirs + DB exist before Flask boots
    ensure_dirs()
    init_db(DB_PATH)

    # Launch Flask in a subprocess so this process can manage it
    server_proc = subprocess.Popen(
        [sys.executable, os.path.join(BACKEND_DIR, "app.py")],
        cwd=BACKEND_DIR,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )

    # Read the dynamically chosen port
    port = read_port()
    if not port:
        log.error("Could not read server port — aborting")
        server_proc.terminate()
        sys.exit(1)

    log.info("Server starting on port %d…", port)

    # Wait for Flask to be ready
    if not wait_for_server(port):
        log.error("Server did not start in time")
        server_proc.terminate()
        sys.exit(1)

    log.info("Server is up!")

    if not args.no_browser:
        # First run → show setup wizard; subsequent runs → go straight to app
        route = "/" if is_setup_done() else "/setup"
        url   = f"http://127.0.0.1:{port}{route}"
        log.info("Opening %s", url)
        webbrowser.open(url)

    try:
        server_proc.wait()
    except KeyboardInterrupt:
        log.info("Shutting down…")
        server_proc.terminate()


if __name__ == "__main__":
    main()
