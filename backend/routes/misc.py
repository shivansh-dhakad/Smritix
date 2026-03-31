"""
routes/misc.py - Search, backup, settings, and run-project endpoints.
"""

import os
import subprocess
import webbrowser
import shutil
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app, send_file
from utils import ok, err, create_backup, list_backups
from config import DB_PATH, BACKUP_DIR
import logging

logger = logging.getLogger(__name__)
misc_bp = Blueprint("misc", __name__)


def get_db():
    return current_app.config["DB_PATH"]


# ── GET /api/search?q=... ─────────────────────────────────────────────────────
@misc_bp.route("/api/search", methods=["GET"])
def search():
    try:
        query = (request.args.get("q") or "").strip()
        if not query or len(query) < 2:
            return jsonify(ok({"notes": [], "courses": [], "sections": [], "projects": []}))

        from database import db_session
        db_path = get_db()
        safe_q  = query.replace('"', '""')  # Escape FTS5 query string

        with db_session(db_path) as conn:
            # FTS5 notes search
            try:
                note_rows = conn.execute(
                    """SELECT n.*, snippet(notes_fts, 1, '<mark>', '</mark>', '…', 20) AS snippet
                       FROM notes_fts
                       JOIN notes n ON notes_fts.rowid = n.id
                       WHERE notes_fts MATCH ?
                       ORDER BY rank
                       LIMIT 20""",
                    (safe_q,)
                ).fetchall()
            except Exception:
                # Fallback to LIKE search if FTS query is malformed
                note_rows = conn.execute(
                    "SELECT *, title AS snippet FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT 20",
                    (f"%{query}%", f"%{query}%")
                ).fetchall()

            # Course name search
            course_rows = conn.execute(
                "SELECT * FROM courses WHERE name LIKE ? OR description LIKE ? LIMIT 10",
                (f"%{query}%", f"%{query}%")
            ).fetchall()

            # Section name search
            section_rows = conn.execute(
                "SELECT * FROM sections WHERE name LIKE ? LIMIT 10",
                (f"%{query}%",)
            ).fetchall()

            # Project name/description search
            proj_rows = conn.execute(
                "SELECT * FROM projects WHERE name LIKE ? OR description LIKE ? LIMIT 10",
                (f"%{query}%", f"%{query}%")
            ).fetchall()

            return jsonify(ok({
                "notes":    [dict(r) for r in note_rows],
                "courses":  [dict(r) for r in course_rows],
                "sections": [dict(r) for r in section_rows],
                "projects": [dict(r) for r in proj_rows],
            }))
    except Exception as exc:
        logger.error("search error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/backup ──────────────────────────────────────────────────────────
@misc_bp.route("/api/backup", methods=["POST"])
def do_backup():
    try:
        path = create_backup("manual")
        if not path:
            return jsonify(err("Backup failed — DB not found")[0]), 500
        return jsonify(ok({"path": path, "created_at": datetime.now().isoformat()}))
    except Exception as exc:
        logger.error("backup error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/backups ──────────────────────────────────────────────────────────
@misc_bp.route("/api/backups", methods=["GET"])
def get_backups():
    try:
        return jsonify(ok(list_backups()))
    except Exception as exc:
        logger.error("list backups error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/backups/restore ─────────────────────────────────────────────────
@misc_bp.route("/api/backups/restore", methods=["POST"])
def restore_backup():
    try:
        data     = request.get_json(force=True) or {}
        filename = data.get("filename", "")
        if not filename or ".." in filename or "/" in filename or "\\" in filename:
            return jsonify(err("Invalid backup filename")[0]), 400

        backup_path = os.path.join(BACKUP_DIR, filename)
        if not os.path.exists(backup_path):
            return jsonify(err("Backup file not found")[0]), 404

        # Safety: backup current DB before restoring
        create_backup("pre_restore")
        db_path = get_db()
        shutil.copy2(backup_path, db_path)
        return jsonify(ok({"restored": filename}))
    except Exception as exc:
        logger.error("restore_backup error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/settings ─────────────────────────────────────────────────────────
@misc_bp.route("/api/settings", methods=["GET"])
def get_settings():
    try:
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            rows = conn.execute("SELECT key_name, value FROM app_settings").fetchall()
            return jsonify(ok({r["key_name"]: r["value"] for r in rows}))
    except Exception as exc:
        logger.error("get_settings error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── PUT /api/settings ─────────────────────────────────────────────────────────
@misc_bp.route("/api/settings", methods=["PUT"])
def update_settings():
    try:
        data = request.get_json(force=True) or {}
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            for key, value in data.items():
                conn.execute(
                    "INSERT OR REPLACE INTO app_settings (key_name, value) VALUES (?, ?)",
                    (str(key), str(value))
                )
        return jsonify(ok(data))
    except Exception as exc:
        logger.error("update_settings error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/projects/<id>/run ───────────────────────────────────────────────
@misc_bp.route("/api/projects/<int:project_id>/run", methods=["POST"])
def run_project(project_id):
    try:
        import sys as _sys
        data     = request.get_json(force=True) or {}
        run_type = data.get("type", "local")  # "local" | "web"

        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            row = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row:
                return jsonify(err("Project not found")[0]), 404

            if run_type == "web":
                url = row["run_web_url"]
                if not url:
                    return jsonify(err("No web URL configured")[0]), 400
                webbrowser.open(url)
                return jsonify(ok({"opened": url}))

            # ── Local run ─────────────────────────────────────────────────────
            local_path = (row["run_local_path"] or "").strip()
            if not local_path:
                return jsonify(err("No local path configured for this project")[0]), 400

            # Expand ~ and env vars so paths like ~/project/main.py work
            local_path = os.path.expanduser(os.path.expandvars(local_path))

            if not os.path.exists(local_path):
                return jsonify(err(f"Path not found: {local_path}")[0]), 400

            ext = os.path.splitext(local_path)[1].lower()

            # Build the command based on file type
            if ext == ".py":
                cmd = [_sys.executable, local_path]
            elif ext == ".ipynb":
                # Try jupyter nbconvert --execute, fall back to jupyter notebook
                jupyter = subprocess.run(
                    ["jupyter", "--version"], capture_output=True
                )
                if jupyter.returncode == 0:
                    cmd = ["jupyter", "notebook", local_path]
                else:
                    return jsonify(err("Jupyter is not installed. Run: pip install jupyter")[0]), 400
            elif ext == ".js":
                cmd = ["node", local_path]
            elif ext in (".sh",):
                cmd = ["bash", local_path]
            elif ext == ".bat":
                cmd = [local_path]
            elif ext == ".exe":
                cmd = [local_path]
            elif ext == ".rb":
                cmd = ["ruby", local_path]
            elif ext == ".r":
                cmd = ["Rscript", local_path]
            elif os.path.isdir(local_path):
                # Directory: try to open it in file explorer / finder
                if os.name == "nt":
                    subprocess.Popen(["explorer", local_path])
                elif os.uname().sysname == "Darwin":
                    subprocess.Popen(["open", local_path])
                else:
                    subprocess.Popen(["xdg-open", local_path])
                return jsonify(ok({"opened_dir": local_path}))
            else:
                # Generic: try to open with system default
                try:
                    if os.name == "nt":
                        os.startfile(local_path)
                    elif os.uname().sysname == "Darwin":
                        subprocess.Popen(["open", local_path])
                    else:
                        subprocess.Popen(["xdg-open", local_path])
                    return jsonify(ok({"opened": local_path}))
                except Exception as ex:
                    return jsonify(err(f"Cannot run .{ext} files: {ex}")[0]), 400

            work_dir = os.path.dirname(local_path) if os.path.isfile(local_path) else local_path
            
            if os.name == "nt" and ext in (".py", ".js", ".rb", ".r", ".sh", ".bat", ".exe"):
                cmd = ["cmd.exe", "/c", "start", "cmd.exe", "/k"] + cmd
                proc = subprocess.Popen(
                    cmd,
                    cwd=work_dir,
                    shell=True
                )
            else:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=work_dir,
                )
            return jsonify(ok({"pid": proc.pid, "path": local_path, "cmd": " ".join(cmd)}))
    except Exception as exc:
        logger.error("run_project error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/health ───────────────────────────────────────────────────────────
@misc_bp.route("/api/health", methods=["GET"])
def health():
    return jsonify(ok({"status": "running", "version": "1.0.0"}))


# ── GET /api/dashboard ────────────────────────────────────────────────────────
@misc_bp.route("/api/dashboard", methods=["GET"])
def dashboard():
    try:
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            total_courses  = conn.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
            total_sections = conn.execute("SELECT COUNT(*) FROM sections").fetchone()[0]
            total_notes    = conn.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
            total_projects = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]

            recent_notes = conn.execute(
                """SELECT n.id, n.title, n.updated_at, c.name as course_name, c.emoji as course_emoji
                   FROM notes n JOIN courses c ON n.course_id = c.id
                   ORDER BY n.updated_at DESC LIMIT 8"""
            ).fetchall()

            recent_projects = conn.execute(
                """SELECT p.id, p.name, p.emoji, p.color, p.created_at, c.name as course_name
                   FROM projects p JOIN courses c ON p.course_id = c.id
                   ORDER BY p.created_at DESC LIMIT 6"""
            ).fetchall()

            courses_summary = conn.execute(
                """SELECT c.id, c.name, c.emoji, c.color,
                          (SELECT COUNT(*) FROM notes n WHERE n.course_id = c.id) as note_count,
                          (SELECT COUNT(*) FROM projects p WHERE p.course_id = c.id) as project_count,
                          (SELECT COUNT(*) FROM sections s WHERE s.course_id = c.id) as section_count
                   FROM courses c ORDER BY c.order_num, c.created_at"""
            ).fetchall()

            return jsonify(ok({
                "stats": {
                    "courses":  total_courses,
                    "sections": total_sections,
                    "notes":    total_notes,
                    "projects": total_projects,
                },
                "recent_notes":    [dict(r) for r in recent_notes],
                "recent_projects": [dict(r) for r in recent_projects],
                "courses_summary": [dict(r) for r in courses_summary],
            }))
    except Exception as exc:
        logger.error("dashboard error: %s", exc)
        return jsonify(err(str(exc))[0]), 500
