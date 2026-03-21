"""
routes/sections.py - CRUD API for sections and sub-sections.
"""

from flask import Blueprint, request, jsonify
from utils import ok, err
import logging

logger = logging.getLogger(__name__)
sections_bp = Blueprint("sections", __name__, url_prefix="/api/sections")


def get_db():
    from flask import current_app
    return current_app.config["DB_PATH"]


# ── GET /api/sections?course_id=X ─────────────────────────────────────────────
@sections_bp.route("", methods=["GET"])
def list_sections():
    try:
        course_id = request.args.get("course_id", type=int)
        parent_id = request.args.get("parent_id")  # "null" or int

        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            if course_id and parent_id == "null":
                # Top-level sections only
                rows = conn.execute(
                    """SELECT * FROM sections
                       WHERE course_id = ? AND parent_id IS NULL
                       ORDER BY order_num, created_at""",
                    (course_id,)
                ).fetchall()
            elif course_id:
                rows = conn.execute(
                    "SELECT * FROM sections WHERE course_id = ? ORDER BY order_num, created_at",
                    (course_id,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM sections ORDER BY order_num, created_at"
                ).fetchall()
            return jsonify(ok([dict(r) for r in rows]))
    except Exception as exc:
        logger.error("list_sections error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/sections ────────────────────────────────────────────────────────
@sections_bp.route("", methods=["POST"])
def create_section():
    try:
        data = request.get_json(force=True) or {}
        name = (data.get("name") or "").strip()
        course_id = data.get("course_id")

        if not name:
            return jsonify(err("Section name is required")[0]), 400
        if not course_id:
            return jsonify(err("course_id is required")[0]), 400

        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            # Verify course exists
            if not conn.execute("SELECT id FROM courses WHERE id=?", (course_id,)).fetchone():
                return jsonify(err("Course not found")[0]), 404

            parent_id = data.get("parent_id")
            if parent_id:
                # Verify parent section exists and belongs to same course
                parent = conn.execute(
                    "SELECT id FROM sections WHERE id=? AND course_id=?",
                    (parent_id, course_id)
                ).fetchone()
                if not parent:
                    return jsonify(err("Parent section not found")[0]), 404

            cur = conn.execute(
                """INSERT INTO sections (course_id, parent_id, name, order_num)
                   VALUES (?, ?, ?, (SELECT COALESCE(MAX(order_num),0)+1 FROM sections
                                     WHERE course_id=? AND parent_id IS ?))""",
                (course_id, parent_id, name, course_id, parent_id)
            )
            row = conn.execute(
                "SELECT * FROM sections WHERE id=?", (cur.lastrowid,)
            ).fetchone()
            return jsonify(ok(dict(row))), 201
    except Exception as exc:
        logger.error("create_section error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/sections/<id> ────────────────────────────────────────────────────
@sections_bp.route("/<int:section_id>", methods=["GET"])
def get_section(section_id):
    try:
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            row = conn.execute(
                "SELECT * FROM sections WHERE id=?", (section_id,)
            ).fetchone()
            if not row:
                return jsonify(err("Section not found")[0]), 404
            section = dict(row)
            # Include children
            children = conn.execute(
                "SELECT * FROM sections WHERE parent_id=? ORDER BY order_num",
                (section_id,)
            ).fetchall()
            section["children"] = [dict(c) for c in children]
            return jsonify(ok(section))
    except Exception as exc:
        logger.error("get_section error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── PUT /api/sections/<id> ────────────────────────────────────────────────────
@sections_bp.route("/<int:section_id>", methods=["PUT"])
def update_section(section_id):
    try:
        data = request.get_json(force=True) or {}
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            existing = conn.execute(
                "SELECT id FROM sections WHERE id=?", (section_id,)
            ).fetchone()
            if not existing:
                return jsonify(err("Section not found")[0]), 404

            fields, values = [], []
            for key in ("name", "order_num", "parent_id"):
                if key in data:
                    fields.append(f"{key} = ?")
                    values.append(data[key])
            if not fields:
                return jsonify(err("No fields to update")[0]), 400

            values.append(section_id)
            conn.execute(
                f"UPDATE sections SET {', '.join(fields)} WHERE id=?", values
            )
            row = conn.execute(
                "SELECT * FROM sections WHERE id=?", (section_id,)
            ).fetchone()
            return jsonify(ok(dict(row)))
    except Exception as exc:
        logger.error("update_section error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── DELETE /api/sections/<id> ─────────────────────────────────────────────────
@sections_bp.route("/<int:section_id>", methods=["DELETE"])
def delete_section(section_id):
    try:
        from database import db_session
        from utils import create_backup
        db_path = get_db()
        create_backup("pre_delete_section")
        with db_session(db_path) as conn:
            existing = conn.execute(
                "SELECT id FROM sections WHERE id=?", (section_id,)
            ).fetchone()
            if not existing:
                return jsonify(err("Section not found")[0]), 404
            conn.execute("DELETE FROM sections WHERE id=?", (section_id,))
            return jsonify(ok({"deleted": section_id}))
    except Exception as exc:
        logger.error("delete_section error: %s", exc)
        return jsonify(err(str(exc))[0]), 500
