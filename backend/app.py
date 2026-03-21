"""
app.py - Smritix Flask application entry point.
"""

import os
import sys
import sqlite3
import logging
import threading
import time
from flask import Flask, send_from_directory, jsonify

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import (
    DB_PATH, STATIC_DIR, TEMPLATE_DIR, AUTO_BACKUP_INTERVAL, ensure_dirs
)
from database import init_db
from utils import find_free_port, create_backup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)


def _emergency_fts_heal(db_path):
    """
    Called at every startup before init_db.
    Unconditionally drops and recreates the FTS5 table + all three triggers,
    stripping any stale columns (like 'tags') from old databases.
    Non-fatal: any exception is logged and swallowed so the app still starts.
    """
    if not os.path.exists(db_path):
        return   # brand-new install — init_db will create everything

    try:
        conn = sqlite3.connect(db_path)

        # 1. Drop triggers first (they reference the FTS table)
        conn.execute("DROP TRIGGER IF EXISTS notes_fts_insert")
        conn.execute("DROP TRIGGER IF EXISTS notes_fts_update")
        conn.execute("DROP TRIGGER IF EXISTS notes_fts_delete")

        # 2. Drop the virtual table
        conn.execute("DROP TABLE IF EXISTS notes_fts")

        # 3. Recreate without 'tags'
        conn.execute(
            "CREATE VIRTUAL TABLE notes_fts "
            "USING fts5(title, content, content='notes', content_rowid='id')"
        )

        # 4. Repopulate from existing notes (if the table exists already)
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='notes'"
        ).fetchall()
        if tables:
            conn.execute(
                "INSERT INTO notes_fts(rowid, title, content) "
                "SELECT id, COALESCE(title,''), COALESCE(content,'') FROM notes"
            )

        # 5. Recreate triggers
        conn.execute(
            "CREATE TRIGGER notes_fts_insert "
            "AFTER INSERT ON notes BEGIN "
            "INSERT INTO notes_fts(rowid, title, content) "
            "VALUES (new.id, new.title, new.content); "
            "END"
        )
        conn.execute(
            "CREATE TRIGGER notes_fts_update "
            "AFTER UPDATE ON notes BEGIN "
            "INSERT INTO notes_fts(notes_fts, rowid, title, content) "
            "VALUES ('delete', old.id, old.title, old.content); "
            "INSERT INTO notes_fts(rowid, title, content) "
            "VALUES (new.id, new.title, new.content); "
            "END"
        )
        conn.execute(
            "CREATE TRIGGER notes_fts_delete "
            "AFTER DELETE ON notes BEGIN "
            "INSERT INTO notes_fts(notes_fts, rowid, title, content) "
            "VALUES ('delete', old.id, old.title, old.content); "
            "END"
        )

        conn.commit()
        conn.close()
        logger.info("FTS5 index healed successfully")

    except Exception as exc:
        logger.warning("FTS heal warning (non-fatal): %s", exc)


def create_app():
    app = Flask(
        __name__,
        static_folder=STATIC_DIR,
        template_folder=TEMPLATE_DIR
    )
    app.config["DB_PATH"] = DB_PATH
    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

    @app.after_request
    def add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"]  = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response

    @app.before_request
    def handle_preflight():
        from flask import request
        if request.method == "OPTIONS":
            return app.make_default_options_response()

    from routes.courses  import courses_bp
    from routes.sections import sections_bp
    from routes.notes    import notes_bp
    from routes.projects import projects_bp
    from routes.misc     import misc_bp

    for bp in (courses_bp, sections_bp, notes_bp, projects_bp, misc_bp):
        app.register_blueprint(bp)

    @app.errorhandler(404)
    def not_found(e):
        from flask import request
        if not request.path.startswith("/api/"):
            return send_from_directory(TEMPLATE_DIR, "index.html")
        return jsonify({"success": False, "error": "Not found"}), 404

    @app.errorhandler(413)
    def too_large(e):
        return jsonify({"success": False, "error": "File too large (max 50 MB)"}), 413

    @app.errorhandler(500)
    def server_error(e):
        logger.error("Unhandled server error: %s", e)
        return jsonify({"success": False, "error": "Internal server error"}), 500

    @app.route("/")
    def index():
        return send_from_directory(TEMPLATE_DIR, "index.html")

    @app.route("/setup")
    def setup_page():
        return send_from_directory(TEMPLATE_DIR, "setup.html")

    @app.route("/static/<path:filename>")
    def serve_static(filename):
        return send_from_directory(STATIC_DIR, filename)

    return app


def run_auto_backup(interval):
    while True:
        time.sleep(interval)
        try:
            create_backup("auto")
        except Exception as exc:
            logger.warning("Auto-backup failed: %s", exc)


def main():
    ensure_dirs()
    _emergency_fts_heal(DB_PATH)   # ← heals stale FTS before anything else
    init_db(DB_PATH)

    backup_thread = threading.Thread(
        target=run_auto_backup,
        args=(AUTO_BACKUP_INTERVAL,),
        daemon=True
    )
    backup_thread.start()

    port = find_free_port()
    app  = create_app()

    port_file = os.path.join(os.path.dirname(DB_PATH), ".port")
    try:
        with open(port_file, "w") as f:
            f.write(str(port))
    except Exception:
        pass

    logger.info("Starting Smritix on http://127.0.0.1:%d", port)
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
