"""
utils.py - Shared utility helpers: port selection, backup, sanitization, response builders.
"""

import os
import re
import socket
import shutil
import logging
import hashlib
import mimetypes
from datetime import datetime
from typing import Any

from config import (
    BACKUP_DIR, DB_PATH, MAX_FILE_SIZE_BYTES,
    PORT_RANGE_START, PORT_RANGE_END, TEXT_MIME_TYPES
)

logger = logging.getLogger(__name__)

# ── Response builders ──────────────────────────────────────────────────────────

def ok(data: Any = None, **kwargs) -> dict:
    """Build a successful JSON response envelope."""
    resp = {"success": True}
    if data is not None:
        resp["data"] = data
    resp.update(kwargs)
    return resp


def err(message: str, code: int = 400) -> tuple:
    """Build an error JSON response envelope with HTTP status code."""
    return {"success": False, "error": message}, code


# ── Port selection ─────────────────────────────────────────────────────────────

def find_free_port(start: int = PORT_RANGE_START, end: int = PORT_RANGE_END) -> int:
    """Scan the port range and return the first available port."""
    for port in range(start, end):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise RuntimeError(f"No free port found in range {start}–{end}")


# ── Backup ────────────────────────────────────────────────────────────────────

def create_backup(label: str = "auto") -> str:
    """
    Copy the current SQLite DB to BACKUP_DIR with a timestamped filename.
    Returns the backup file path.
    """
    if not os.path.exists(DB_PATH):
        logger.warning("Backup skipped: DB not found at %s", DB_PATH)
        return ""

    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"smritix_{label}_{ts}.db")
    shutil.copy2(DB_PATH, dest)
    logger.info("Backup created: %s", dest)

    # Prune old backups — keep latest 20
    _prune_backups(keep=20)
    return dest


def _prune_backups(keep: int = 20) -> None:
    """Remove oldest backup files beyond the keep limit."""
    try:
        files = sorted(
            [os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR) if f.endswith(".db")],
            key=os.path.getmtime
        )
        for old in files[:-keep]:
            os.remove(old)
            logger.debug("Pruned old backup: %s", old)
    except Exception as exc:
        logger.warning("Backup pruning failed: %s", exc)


def list_backups() -> list:
    """Return metadata list for all backup files, newest first."""
    if not os.path.isdir(BACKUP_DIR):
        return []
    result = []
    for fname in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if not fname.endswith(".db"):
            continue
        fpath = os.path.join(BACKUP_DIR, fname)
        stat = os.stat(fpath)
        result.append({
            "filename": fname,
            "path": fpath,
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
        })
    return result


# ── File / upload validation ───────────────────────────────────────────────────

def validate_upload(file_storage) -> tuple[bool, str]:
    """
    Validate a Werkzeug FileStorage object.
    Returns (is_valid, error_message).
    """
    if not file_storage or file_storage.filename == "":
        return False, "No file provided"

    # Peek at size by reading into memory limit — we'll enforce at stream level
    file_storage.seek(0, 2)  # seek to end
    size = file_storage.tell()
    file_storage.seek(0)     # reset

    if size > MAX_FILE_SIZE_BYTES:
        return False, f"File exceeds {MAX_FILE_SIZE_BYTES // (1024*1024)} MB limit"

    # Sanitize filename
    safe_name = sanitize_filename(file_storage.filename)
    if not safe_name:
        return False, "Invalid filename"

    return True, ""


def sanitize_filename(name: str) -> str:
    """Remove path traversal characters and unsafe characters from a filename."""
    # Strip directory components
    name = os.path.basename(name)
    # Remove null bytes and control characters
    name = re.sub(r'[\x00-\x1f\x7f]', '', name)
    # Collapse multiple dots that could hide extensions
    name = re.sub(r'\.{2,}', '.', name)
    return name.strip()


def detect_mime(filepath: str) -> str:
    """Guess MIME type from file extension."""
    mime, _ = mimetypes.guess_type(filepath)
    return mime or "application/octet-stream"


def is_text_file(mime_type: str) -> bool:
    """Return True if the MIME type indicates a text-editable file."""
    return mime_type in TEXT_MIME_TYPES or mime_type.startswith("text/")


# ── Markdown rendering ────────────────────────────────────────────────────────

def render_markdown(text: str) -> str:
    """
    Convert Markdown to safe HTML.
    Uses the `markdown` library; dangerous tags are stripped via basic allowlist.
    """
    try:
        import markdown as md_lib
        html = md_lib.markdown(
            text or "",
            extensions=["fenced_code", "tables", "nl2br", "toc", "sane_lists"]
        )
        return _strip_dangerous_html(html)
    except Exception as exc:
        logger.error("Markdown render failed: %s", exc)
        # Return escaped plain text as fallback
        return "<pre>" + _escape_html(text or "") + "</pre>"


_ALLOWED_TAGS = {
    "p","br","strong","em","u","s","blockquote","code","pre","h1","h2","h3",
    "h4","h5","h6","ul","ol","li","a","img","table","thead","tbody","tr","th",
    "td","hr","span","div","del","ins","sup","sub","details","summary",
}

_ALLOWED_ATTRS = {
    "a": ["href", "title", "target"],
    "img": ["src", "alt", "title", "width", "height"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
    "*": ["class", "id"],
}


def _escape_html(text: str) -> str:
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#x27;"))


def _strip_dangerous_html(html: str) -> str:
    """
    Very lightweight tag allowlisting without external deps.
    Strips script/style/iframe and on* attributes.
    Not a full sanitizer — for a production app add the `bleach` library.
    """
    # Remove dangerous tags entirely (including content for script/style)
    for tag in ("script", "style", "iframe", "object", "embed", "form", "input", "button"):
        html = re.sub(rf'<{tag}[^>]*>.*?</{tag}>', '', html, flags=re.DOTALL | re.IGNORECASE)
        html = re.sub(rf'<{tag}[^>]*/>', '', html, flags=re.IGNORECASE)

    # Strip on* event attributes
    html = re.sub(r'\s+on\w+\s*=\s*["\'][^"\']*["\']', '', html, flags=re.IGNORECASE)
    html = re.sub(r'\s+on\w+\s*=\s*\S+', '', html, flags=re.IGNORECASE)

    # Strip javascript: in href/src
    html = re.sub(r'(href|src)\s*=\s*["\']javascript:[^"\']*["\']', '', html, flags=re.IGNORECASE)

    return html
