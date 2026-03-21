"""
config.py - Central configuration for Smritix.
Resolves platform-appropriate paths and tunable constants.
"""

import os
import sys
import platform

# ── Data directory: respects platform conventions ─────────────────────────────
def get_app_data_dir() -> str:
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    elif system == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    return os.path.join(base, "Smritix")


APP_DATA_DIR   = get_app_data_dir()
FILES_DIR      = os.path.join(APP_DATA_DIR, "files")       # project files on disk
BACKUP_DIR     = os.path.join(APP_DATA_DIR, "backups")     # backup .db files
DB_PATH        = os.path.join(APP_DATA_DIR, "smritix.db")

# ── Frontend static files (relative to this file's directory) ─────────────────
BACKEND_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
STATIC_DIR   = os.path.join(PROJECT_ROOT, "frontend", "static")
TEMPLATE_DIR = os.path.join(PROJECT_ROOT, "frontend", "templates")

# ── Upload / file limits ───────────────────────────────────────────────────────
MAX_FILE_SIZE_MB  = 50
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Allowed text-editable MIME types
TEXT_MIME_TYPES = {
    "text/plain", "text/html", "text/css", "text/javascript",
    "application/json", "application/xml", "text/xml",
    "text/markdown", "text/x-python", "text/x-java-source",
    "application/x-sh", "text/x-c", "text/x-c++",
}

# ── Note version history cap (keep latest N versions per note) ─────────────────
MAX_VERSIONS_PER_NOTE = 50

# ── Auto-backup interval (seconds, used by scheduler in app.py) ───────────────
AUTO_BACKUP_INTERVAL = 3600  # 1 hour

# ── Port search range ──────────────────────────────────────────────────────────
PORT_RANGE_START = 5000
PORT_RANGE_END   = 5100

def ensure_dirs():
    """Create all necessary application directories."""
    for d in (APP_DATA_DIR, FILES_DIR, BACKUP_DIR):
        os.makedirs(d, exist_ok=True)
