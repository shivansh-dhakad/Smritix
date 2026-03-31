"""
routes/projects.py — Projects CRUD + file management.
Security: path-traversal guard on every file operation.
"""

import os, shutil, json, logging
from flask import Blueprint, request, jsonify, send_file, current_app
from utils import ok, err, sanitize_filename, detect_mime, is_text_file, validate_upload, create_backup
from config import FILES_DIR

logger      = logging.getLogger(__name__)
projects_bp = Blueprint("projects", __name__, url_prefix="/api/projects")

TEXT_EXTS = {
    ".md",".txt",".py",".js",".ts",".jsx",".tsx",".html",".css",
    ".json",".xml",".yaml",".yml",".sh",".bat",".r",".rb",".go",
    ".rs",".c",".cpp",".h",".hpp",".java",".cs",".php",".sql",
    ".csv",".toml",".ini",".cfg",".env",".gitignore",".dockerfile",
    ".makefile",".gradle",".kt",".swift",".m",".lua",".pl",".ps1",
}

def _db():
    return current_app.config["DB_PATH"]

def _proj_dir(pid):
    return os.path.join(FILES_DIR, str(pid))

def _safe_path(base, *parts):
    """Resolve path and raise ValueError if outside base."""
    target = os.path.realpath(os.path.join(base, *parts))
    base_r = os.path.realpath(base)
    if not (target == base_r or target.startswith(base_r + os.sep)):
        raise ValueError(f"Path traversal blocked: {target}")
    return target


# ── GET /api/projects ─────────────────────────────────────────────────────────
@projects_bp.route("", methods=["GET"])
def list_projects():
    try:
        cid = request.args.get("course_id",  type=int)
        sid = request.args.get("section_id", type=int)
        from database import db_session
        with db_session(_db()) as conn:
            q, p = "SELECT * FROM projects WHERE 1=1", []
            if cid: q += " AND course_id=?";  p.append(cid)
            if sid: q += " AND section_id=?"; p.append(sid)
            q += " ORDER BY created_at DESC"
            return jsonify(ok([dict(r) for r in conn.execute(q, p).fetchall()]))
    except Exception as exc:
        logger.error("list_projects: %s", exc)
        return jsonify(err("Failed to list projects")[0]), 500


# ── POST /api/projects ────────────────────────────────────────────────────────
@projects_bp.route("", methods=["POST"])
def create_project():
    try:
        data  = request.get_json(force=True) or {}
        name  = (data.get("name") or "").strip()[:300]
        cid   = data.get("course_id")
        if not name: return jsonify(err("Project name is required")[0]), 400
        if not cid:  return jsonify(err("course_id is required")[0]), 400

        from database import db_session
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM courses WHERE id=?", (cid,)).fetchone():
                return jsonify(err("Course not found")[0]), 404
            cur = conn.execute(
                "INSERT INTO projects (course_id,section_id,name,description,emoji,color,run_local_path,run_web_url) VALUES (?,?,?,?,?,?,?,?)",
                (cid, data.get("section_id"), name,
                 data.get("description",""), data.get("emoji","🚀"),
                 data.get("color","#00b894"), data.get("run_local_path",""),
                 data.get("run_web_url",""))
            )
            pid = cur.lastrowid
            os.makedirs(_proj_dir(pid), exist_ok=True)
            return jsonify(ok(dict(conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()))), 201
    except Exception as exc:
        logger.error("create_project: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/projects/<id> ────────────────────────────────────────────────────
@projects_bp.route("/<int:pid>", methods=["GET"])
def get_project(pid):
    try:
        from database import db_session
        with db_session(_db()) as conn:
            row = conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone()
            if not row: return jsonify(err("Project not found")[0]), 404
            proj  = dict(row)
            files = conn.execute(
                "SELECT * FROM project_files WHERE project_id=? AND parent_id IS NULL ORDER BY is_dir DESC,name",
                (pid,)
            ).fetchall()
            proj["files"] = [dict(f) for f in files]
            return jsonify(ok(proj))
    except Exception as exc:
        logger.error("get_project: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── PUT /api/projects/<id> ────────────────────────────────────────────────────
@projects_bp.route("/<int:pid>", methods=["PUT"])
def update_project(pid):
    try:
        data = request.get_json(force=True) or {}
        from database import db_session
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
                return jsonify(err("Project not found")[0]), 404
            fields, vals = [], []
            for k in ("name","description","emoji","color","run_local_path","run_web_url","section_id"):
                if k in data:
                    fields.append(f"{k}=?"); vals.append(data[k])
            if not fields: return jsonify(err("Nothing to update")[0]), 400
            fields.append("updated_at=datetime('now')"); vals.append(pid)
            conn.execute(f"UPDATE projects SET {','.join(fields)} WHERE id=?", vals)
            return jsonify(ok(dict(conn.execute("SELECT * FROM projects WHERE id=?", (pid,)).fetchone())))
    except Exception as exc:
        logger.error("update_project: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── DELETE /api/projects/<id> ─────────────────────────────────────────────────
@projects_bp.route("/<int:pid>", methods=["DELETE"])
def delete_project(pid):
    try:
        from database import db_session
        create_backup("pre_delete_project")
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
                return jsonify(err("Project not found")[0]), 404
            conn.execute("DELETE FROM projects WHERE id=?", (pid,))
        d = _proj_dir(pid)
        if os.path.exists(d):
            shutil.rmtree(d, ignore_errors=True)
        return jsonify(ok({"deleted": pid}))
    except Exception as exc:
        logger.error("delete_project: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/projects/<id>/files  (?parent_id=) ──────────────────────────────
@projects_bp.route("/<int:pid>/files", methods=["GET"])
def list_files(pid):
    try:
        parent_id = request.args.get("parent_id")
        from database import db_session
        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
                return jsonify(err("Project not found")[0]), 404
            if parent_id in (None, "null", ""):
                rows = conn.execute(
                    "SELECT * FROM project_files WHERE project_id=? AND parent_id IS NULL ORDER BY is_dir DESC,name",
                    (pid,)
                ).fetchall()
            else:
                try: parent_id = int(parent_id)
                except ValueError: return jsonify(err("Invalid parent_id")[0]), 400
                rows = conn.execute(
                    "SELECT * FROM project_files WHERE project_id=? AND parent_id=? ORDER BY is_dir DESC,name",
                    (pid, parent_id)
                ).fetchall()
            return jsonify(ok([dict(r) for r in rows]))
    except Exception as exc:
        logger.error("list_files: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── POST /api/projects/<id>/upload ───────────────────────────────────────────
@projects_bp.route("/<int:pid>/upload", methods=["POST"])
def upload_file(pid):
    try:
        from database import db_session
        if "file" not in request.files:
            return jsonify(err("No file provided")[0]), 400
        f = request.files["file"]
        valid, msg = validate_upload(f)
        if not valid:
            return jsonify(err(msg)[0]), 400

        safe_name = sanitize_filename(f.filename or "upload")
        if not safe_name:
            return jsonify(err("Invalid filename")[0]), 400

        parent_id = request.form.get("parent_id") or None
        rel_path  = (request.form.get("rel_path") or "").lstrip("/\\").replace("..", "")

        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
                return jsonify(err("Project not found")[0]), 404

            base = _proj_dir(pid)
            try:
                dest_dir  = _safe_path(base, os.path.dirname(rel_path)) if rel_path else base
                dest_path = _safe_path(base, os.path.join(os.path.dirname(rel_path), safe_name)) if rel_path else os.path.join(base, safe_name)
            except ValueError as e:
                return jsonify(err(str(e))[0]), 400

            # Ensure parent directories exist in DB
            actual_parent_id = parent_id
            if rel_path:
                dir_path = os.path.dirname(rel_path)
                if dir_path:
                    parts = dir_path.replace('\\', '/').split('/')
                    current_path = base
                    for part in parts:
                        if not part: continue
                        current_path = os.path.join(current_path, part)
                        
                        # Look for existing dir record with the specified parent
                        if actual_parent_id is None:
                            row = conn.execute(
                                "SELECT id FROM project_files WHERE project_id=? AND name=? AND is_dir=1 AND parent_id IS NULL",
                                (pid, part)
                            ).fetchone()
                        else:
                            row = conn.execute(
                                "SELECT id FROM project_files WHERE project_id=? AND name=? AND is_dir=1 AND parent_id=?",
                                (pid, part, actual_parent_id)
                            ).fetchone()
                        
                        if row:
                            actual_parent_id = row["id"]
                        else:
                            os.makedirs(current_path, exist_ok=True)
                            cur_dir = conn.execute(
                                "INSERT INTO project_files (project_id, name, filepath, parent_id, is_dir, mime_type, file_size) VALUES (?,?,?,?,1,'inode/directory',0)",
                                (pid, part, current_path, actual_parent_id)
                            )
                            actual_parent_id = cur_dir.lastrowid

            os.makedirs(dest_dir, exist_ok=True)
            f.save(dest_path)
            size      = os.path.getsize(dest_path)
            mime      = detect_mime(safe_name)
            
            # Check if file exists to overwrite it or create a new entry
            existing_file = conn.execute(
                "SELECT id FROM project_files WHERE project_id=? AND name=? AND is_dir=0 AND (parent_id=? OR (parent_id IS NULL AND ? IS NULL))",
                (pid, safe_name, actual_parent_id, actual_parent_id)
            ).fetchone()
            
            if existing_file:
                cur = conn.execute(
                    "UPDATE project_files SET file_size=?, mime_type=?, updated_at=datetime('now') WHERE id=?",
                    (size, mime, existing_file["id"])
                )
                file_id = existing_file["id"]
            else:
                cur = conn.execute(
                    "INSERT INTO project_files (project_id,name,filepath,parent_id,is_dir,mime_type,file_size) VALUES (?,?,?,?,0,?,?)",
                    (pid, safe_name, dest_path, actual_parent_id, mime, size)
                )
                file_id = cur.lastrowid
                
            return jsonify(ok(dict(conn.execute("SELECT * FROM project_files WHERE id=?", (file_id,)).fetchone()))), 201
    except Exception as exc:
        logger.error("upload_file: %s", exc)
        return jsonify(err(str(exc))[0]), 500

# ── POST /api/projects/<id>/mkdir ────────────────────────────────────────────
@projects_bp.route("/<int:pid>/mkdir", methods=["POST"])
def create_folder(pid):
    try:
        from database import db_session
        data      = request.get_json(force=True) or {}
        name      = sanitize_filename((data.get("name") or "").strip())
        parent_id = data.get("parent_id") or None

        if not name:
            return jsonify(err("Folder name is required")[0]), 400

        with db_session(_db()) as conn:
            if not conn.execute("SELECT id FROM projects WHERE id=?", (pid,)).fetchone():
                return jsonify(err("Project not found")[0]), 404

            base = _proj_dir(pid)

            # Determine parent path on disk
            if parent_id:
                parent_row = conn.execute(
                    "SELECT filepath FROM project_files WHERE id=? AND project_id=? AND is_dir=1",
                    (parent_id, pid)
                ).fetchone()
                if not parent_row:
                    return jsonify(err("Parent folder not found")[0]), 404
                try:
                    folder_path = _safe_path(base, os.path.relpath(parent_row["filepath"], base), name)
                except ValueError as e:
                    return jsonify(err(str(e))[0]), 400
            else:
                folder_path = os.path.join(base, name)

            try:
                _safe_path(base, os.path.relpath(folder_path, base))
            except ValueError as e:
                return jsonify(err(str(e))[0]), 400

            if os.path.exists(folder_path):
                return jsonify(err("Folder already exists")[0]), 409

            os.makedirs(folder_path, exist_ok=True)

            cur = conn.execute(
                "INSERT INTO project_files (project_id, name, filepath, parent_id, is_dir, mime_type, file_size) VALUES (?,?,?,?,1,'inode/directory',0)",
                (pid, name, folder_path, parent_id)
            )
            return jsonify(ok(dict(conn.execute(
                "SELECT * FROM project_files WHERE id=?", (cur.lastrowid,)
            ).fetchone()))), 201
    except Exception as exc:
        logger.error("create_folder: %s", exc)
        return jsonify(err(str(exc))[0]), 500
    
# ── GET /api/projects/<id>/files/<fid>/content ───────────────────────────────
@projects_bp.route("/<int:pid>/files/<int:fid>/content", methods=["GET"])
def get_file_content(pid, fid):
    try:
        from database import db_session
        with db_session(_db()) as conn:
            row = conn.execute("SELECT * FROM project_files WHERE id=? AND project_id=?", (fid, pid)).fetchone()
            if not row:   return jsonify(err("File not found")[0]), 404
            if row["is_dir"]: return jsonify(err("Cannot read directory")[0]), 400
            fp = row["filepath"]
            if not os.path.exists(fp): return jsonify(err("File missing on disk")[0]), 404

            # Security
            try: _safe_path(_proj_dir(pid), os.path.relpath(fp, _proj_dir(pid)))
            except ValueError: return jsonify(err("Access denied")[0]), 403

            ext = os.path.splitext(row["name"])[1].lower()

            # Jupyter notebook
            if ext == ".ipynb":
                try:
                    with open(fp, "r", encoding="utf-8", errors="replace") as f:
                        nb = json.load(f)
                    return jsonify(ok({"is_notebook": True, "is_text": True,
                                       "mime_type": "application/x-ipynb+json", "notebook": nb, "content": ""}))
                except Exception as ex:
                    return jsonify(err(f"Cannot parse notebook: {ex}")[0]), 400

            # Text files
            if is_text_file(row["mime_type"]) or ext in TEXT_EXTS:
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    return jsonify(ok({"is_notebook": False, "is_text": True,
                                       "mime_type": row["mime_type"], "content": f.read()}))

            # Binary — Return JSON
            return jsonify(ok({"is_notebook": False, "is_text": False, "mime_type": row["mime_type"], "download_url": f"/api/projects/{pid}/files/{fid}/download"}))
    except Exception as exc:
        logger.error("get_file_content: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── GET /api/projects/<id>/files/<fid>/download ──────────────────────────────
@projects_bp.route("/<int:pid>/files/<int:fid>/download", methods=["GET"])
def download_file(pid, fid):
    try:
        from database import db_session
        with db_session(_db()) as conn:
            row = conn.execute("SELECT * FROM project_files WHERE id=? AND project_id=?", (fid, pid)).fetchone()
            if not row: return jsonify(err("File not found")[0]), 404
            if row["is_dir"]: return jsonify(err("Cannot download directory")[0]), 400
            fp = row["filepath"]
            if not os.path.exists(fp): return jsonify(err("File missing on disk")[0]), 404
            try: _safe_path(_proj_dir(pid), os.path.relpath(fp, _proj_dir(pid)))
            except ValueError: return jsonify(err("Access denied")[0]), 403
            
            return send_file(fp, as_attachment=False)
    except Exception as exc:
        logger.error("download_file: %s", exc)
        return jsonify(err(str(exc))[0]), 500
        logger.error("get_file_content: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── PUT /api/projects/<id>/files/<fid>/content ───────────────────────────────
@projects_bp.route("/<int:pid>/files/<int:fid>/content", methods=["PUT"])
def save_file_content(pid, fid):
    try:
        data = request.get_json(force=True) or {}
        from database import db_session
        with db_session(_db()) as conn:
            row = conn.execute("SELECT * FROM project_files WHERE id=? AND project_id=?", (fid, pid)).fetchone()
            if not row: return jsonify(err("File not found")[0]), 404
            fp  = row["filepath"]
            try: _safe_path(_proj_dir(pid), os.path.relpath(fp, _proj_dir(pid)))
            except ValueError: return jsonify(err("Access denied")[0]), 403
            ext = os.path.splitext(row["name"])[1].lower()
            if not (is_text_file(row["mime_type"]) or ext in TEXT_EXTS):
                return jsonify(err("Binary files cannot be edited here")[0]), 400
            with open(fp, "w", encoding="utf-8") as f:
                f.write(data.get("content", ""))
            sz = os.path.getsize(fp)
            conn.execute("UPDATE project_files SET file_size=? WHERE id=?", (sz, fid))
            return jsonify(ok({"saved": True, "file_size": sz}))
    except Exception as exc:
        logger.error("save_file_content: %s", exc)
        return jsonify(err(str(exc))[0]), 500


# ── DELETE /api/projects/<id>/files/<fid> ────────────────────────────────────
@projects_bp.route("/<int:pid>/files/<int:fid>", methods=["DELETE"])
def delete_file(pid, fid):
    try:
        from database import db_session
        with db_session(_db()) as conn:
            row = conn.execute("SELECT * FROM project_files WHERE id=? AND project_id=?", (fid, pid)).fetchone()
            if not row: return jsonify(err("File not found")[0]), 404
            fp = row["filepath"]
            if os.path.exists(fp):
                shutil.rmtree(fp, ignore_errors=True) if row["is_dir"] else os.remove(fp)
            conn.execute("DELETE FROM project_files WHERE id=?", (fid,))
            return jsonify(ok({"deleted": fid}))
    except Exception as exc:
        logger.error("delete_file: %s", exc)
        return jsonify(err(str(exc))[0]), 500

