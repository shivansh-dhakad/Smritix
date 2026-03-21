"""
routes/courses.py - CRUD API for courses.
"""

from flask import Blueprint, request, jsonify, g
from utils import ok, err, create_backup
import logging

logger = logging.getLogger(__name__)
courses_bp = Blueprint("courses", __name__, url_prefix="/api/courses")


def get_db():
    from flask import current_app
    return current_app.config["DB_PATH"]


# ── GET /api/courses ───────────────────────────────────────────────────────────
@courses_bp.route("", methods=["GET"])
def list_courses():
    try:
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM courses ORDER BY order_num, created_at"
            ).fetchall()
            return jsonify(ok([dict(r) for r in rows]))
    except Exception as exc:
        logger.error("list_courses error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/courses ──────────────────────────────────────────────────────────
@courses_bp.route("", methods=["POST"])
def create_course():
    try:
        data = request.get_json(force=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify(err("Course name is required")[0]), 400

        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            cur = conn.execute(
                """INSERT INTO courses (name, description, emoji, color, order_num)
                   VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(order_num),0)+1 FROM courses))""",
                (name,
                 data.get("description", ""),
                 data.get("emoji", "📚"),
                 data.get("color", "#6c5ce7"))
            )
            row = conn.execute(
                "SELECT * FROM courses WHERE id = ?", (cur.lastrowid,)
            ).fetchone()
            return jsonify(ok(dict(row))), 201
    except Exception as exc:
        logger.error("create_course error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/courses/<id> ──────────────────────────────────────────────────────
@courses_bp.route("/<int:course_id>", methods=["GET"])
def get_course(course_id):
    try:
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            row = conn.execute(
                "SELECT * FROM courses WHERE id = ?", (course_id,)
            ).fetchone()
            if not row:
                return jsonify(err("Course not found")[0]), 404
            return jsonify(ok(dict(row)))
    except Exception as exc:
        logger.error("get_course error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── PUT /api/courses/<id> ──────────────────────────────────────────────────────
@courses_bp.route("/<int:course_id>", methods=["PUT"])
def update_course(course_id):
    try:
        data = request.get_json(force=True) or {}
        from database import db_session
        db_path = get_db()
        with db_session(db_path) as conn:
            existing = conn.execute(
                "SELECT id FROM courses WHERE id = ?", (course_id,)
            ).fetchone()
            if not existing:
                return jsonify(err("Course not found")[0]), 404

            fields, values = [], []
            for key in ("name", "description", "emoji", "color", "order_num"):
                if key in data:
                    fields.append(f"{key} = ?")
                    values.append(data[key])
            if not fields:
                return jsonify(err("No fields to update")[0]), 400

            fields.append("updated_at = datetime('now')")
            values.append(course_id)
            conn.execute(
                f"UPDATE courses SET {', '.join(fields)} WHERE id = ?", values
            )
            row = conn.execute(
                "SELECT * FROM courses WHERE id = ?", (course_id,)
            ).fetchone()
            return jsonify(ok(dict(row)))
    except Exception as exc:
        logger.error("update_course error: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── DELETE /api/courses/<id> ───────────────────────────────────────────────────
@courses_bp.route("/<int:course_id>", methods=["DELETE"])
def delete_course(course_id):
    try:
        from database import db_session
        db_path = get_db()
        # Backup before destructive operation
        create_backup("pre_delete_course")
        with db_session(db_path) as conn:
            existing = conn.execute(
                "SELECT id FROM courses WHERE id = ?", (course_id,)
            ).fetchone()
            if not existing:
                return jsonify(err("Course not found")[0]), 404
            conn.execute("DELETE FROM courses WHERE id = ?", (course_id,))
            return jsonify(ok({"deleted": course_id}))
    except Exception as exc:
        logger.error("delete_course error: %s", exc)
        return jsonify(err(str(exc))[0]), 500
