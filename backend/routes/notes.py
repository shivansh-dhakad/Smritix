"""
routes/notes.py — Notes CRUD, version history, WYSIWYG HTML storage.

Storage format: content is rich HTML produced by the contenteditable WYSIWYG editor.
Legacy plain-text / Markdown notes are auto-detected and rendered as fallback.
Tags column kept in DB for schema compat but never exposed to the frontend.
"""

import logging
from flask import Blueprint, request, jsonify
from utils import ok, err, render_markdown, create_backup
from config import MAX_VERSIONS_PER_NOTE

logger   = logging.getLogger(__name__)
notes_bp = Blueprint("notes", __name__, url_prefix="/api/notes")


def _db():
    from flask import current_app
    return current_app.config["DB_PATH"]


def _is_html(text: str) -> bool:
    """Return True when content looks like saved WYSIWYG HTML."""
    t = (text or "").strip()
    return bool(t) and t.startswith("<") and "</" in t


# ── GET /api/notes  (?course_id=X  &section_id=Y) ────────────────────────────
@notes_bp.route("", methods=["GET"])
def list_notes():
    try:
        cid = request.args.get("course_id",  type=int)
        sid = request.args.get("section_id", type=int)
        from database import db_session
        with db_session(_db()) as conn:
            q, p = "SELECT id,course_id,section_id,title,created_at,updated_at FROM notes WHERE 1=1", []
            if cid: q += " AND course_id=?";  p.append(cid)
            if sid: q += " AND section_id=?"; p.append(sid)
            q += " ORDER BY updated_at DESC"
            return jsonify(ok([dict(r) for r in conn.execute(q, p).fetchall()]))
    except Exception as exc:
        logger.error("list_notes: %s", exc)
        return jsonify(err("Failed to list notes"))[0], 500


# ── POST /api/notes ───────────────────────────────────────────────────────────
@notes_bp.route("", methods=["POST"])
def create_note():
    try:
        data  = request.get_json(force=True) or {}
        cid   = data.get("course_id")
        title = (data.get("title") or "Untitled Note").strip()[:500]
        if not cid:
            return jsonify(err("course_id is required")[0]), 400

        from database import db_session
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM courses WHERE id=?", (cid,)).fetchone():
                return jsonify(err("Course not found")[0]), 404
            cur = conn.execute(
                "INSERT INTO notes (course_id,section_id,title,content) VALUES (?,?,?,?)",
                (cid, data.get("section_id"), title, data.get("content", ""))
            )
            row = conn.execute("SELECT * FROM notes WHERE id=?", (cur.lastrowid,)).fetchone()
            return jsonify(ok(dict(row))), 201
    except Exception as exc:
        logger.error("create_note: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/notes/<id>  (?render=true) ──────────────────────────────────────
@notes_bp.route("/<int:nid>", methods=["GET"])
def get_note(nid):
    try:
        do_render = request.args.get("render", "false").lower() == "true"
        from database import db_session
        with db_session(_db()) as conn:
            row = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
            if not row:
                return jsonify(err("Note not found")[0]), 404
            note = dict(row)
            if do_render:
                c = note.get("content") or ""
                note["html"] = c if _is_html(c) else render_markdown(c)
            return jsonify(ok(note))
    except Exception as exc:
        logger.error("get_note: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── PUT /api/notes/<id> ───────────────────────────────────────────────────────
@notes_bp.route("/<int:nid>", methods=["PUT"])
def update_note(nid):
    try:
        data = request.get_json(force=True) or {}
        from database import db_session
        with db_session(_db()) as conn:
            existing = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
            if not existing:
                return jsonify(err("Note not found")[0]), 404

            # Snapshot old content before overwriting
            if "content" in data and data["content"] != existing["content"]:
                conn.execute(
                    "INSERT INTO note_versions (note_id,content) VALUES (?,?)",
                    (nid, existing["content"])
                )
                conn.execute(
                    """DELETE FROM note_versions WHERE id IN (
                         SELECT id FROM note_versions WHERE note_id=?
                         ORDER BY created_at DESC LIMIT -1 OFFSET ?)""",
                    (nid, MAX_VERSIONS_PER_NOTE)
                )

            fields, vals = [], []
            for k in ("title", "content", "section_id"):
                if k in data:
                    fields.append(f"{k}=?")
                    vals.append(data[k])
            if not fields:
                return jsonify(err("Nothing to update")[0]), 400

            fields.append("updated_at=datetime('now')")
            vals.append(nid)
            conn.execute(f"UPDATE notes SET {','.join(fields)} WHERE id=?", vals)
            return jsonify(ok(dict(conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone())))
    except Exception as exc:
        logger.error("update_note: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── DELETE /api/notes/<id> ────────────────────────────────────────────────────
@notes_bp.route("/<int:nid>", methods=["DELETE"])
def delete_note(nid):
    try:
        from database import db_session
        create_backup("pre_delete_note")
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM notes WHERE id=?", (nid,)).fetchone():
                return jsonify(err("Note not found")[0]), 404
            conn.execute("DELETE FROM notes WHERE id=?", (nid,))
            return jsonify(ok({"deleted": nid}))
    except Exception as exc:
        logger.error("delete_note: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/notes/<id>/versions ─────────────────────────────────────────────
@notes_bp.route("/<int:nid>/versions", methods=["GET"])
def get_versions(nid):
    try:
        from database import db_session
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM notes WHERE id=?", (nid,)).fetchone():
                return jsonify(err("Note not found")[0]), 404
            rows = conn.execute(
                "SELECT id,note_id,created_at,SUBSTR(content,1,120) AS preview FROM note_versions WHERE note_id=? ORDER BY created_at DESC",
                (nid,)
            ).fetchall()
            return jsonify(ok([dict(r) for r in rows]))
    except Exception as exc:
        logger.error("get_versions: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/notes/<id>/restore/<vid> ───────────────────────────────────────
@notes_bp.route("/<int:nid>/restore/<int:vid>", methods=["POST"])
def restore_version(nid, vid):
    try:
        from database import db_session
        with db_session(_db()) as conn:
            note = conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
            if not note:
                return jsonify(err("Note not found")[0]), 404
            ver = conn.execute(
                "SELECT * FROM note_versions WHERE id=? AND note_id=?", (vid, nid)
            ).fetchone()
            if not ver:
                return jsonify(err("Version not found")[0]), 404

            # Snapshot current before restore
            conn.execute("INSERT INTO note_versions (note_id,content) VALUES (?,?)", (nid, note["content"]))
            conn.execute("UPDATE notes SET content=?,updated_at=datetime('now') WHERE id=?", (ver["content"], nid))
            return jsonify(ok(dict(conn.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone())))
    except Exception as exc:
        logger.error("restore_version: %s", exc)
        return jsonify(err(str(exc))[0]), 500
