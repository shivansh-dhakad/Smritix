"""
database.py - SQLite database initialization and connection management for Smritix.
Handles all schema creation, FTS5 full-text search setup, and provides a thread-safe
connection factory for use across Flask routes.
"""

import sqlite3
import os
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)


def get_db_path(data_dir: str) -> str:
    """Return absolute path to the SQLite database file."""
    return os.path.join(data_dir, "smritix.db")


def get_connection(db_path: str) -> sqlite3.Connection:
    """
    Open and return a sqlite3 connection with:
    - Row factory so columns are accessible by name
    - WAL journal mode for better concurrency
    - Foreign key enforcement enabled
    """
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


@contextmanager
def db_session(db_path: str):
    """
    Context manager that yields a connection and auto-commits or rolls back.
    Usage:
        with db_session(db_path) as conn:
            conn.execute(...)
    """
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("DB session error, rolled back: %s", exc)
        raise
    finally:
        conn.close()


def init_db(db_path: str) -> None:
    """
    Create all tables and FTS5 virtual tables if they do not already exist.
    Safe to call on every app startup (idempotent).
    """
    with db_session(db_path) as conn:
        # ── courses ────────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS courses (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                description TEXT    DEFAULT '',
                emoji       TEXT    DEFAULT '📚',
                color       TEXT    DEFAULT '#6c5ce7',
                order_num   INTEGER DEFAULT 0,
                created_at  TEXT    DEFAULT (datetime('now')),
                updated_at  TEXT    DEFAULT (datetime('now'))
            )
        """)

        # ── sections (supports self-referential parent for sub-sections) ───────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sections (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                parent_id   INTEGER REFERENCES sections(id) ON DELETE CASCADE,
                name        TEXT    NOT NULL,
                order_num   INTEGER DEFAULT 0,
                created_at  TEXT    DEFAULT (datetime('now'))
            )
        """)

        # ── notes ──────────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS notes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                section_id  INTEGER REFERENCES sections(id) ON DELETE SET NULL,
                title       TEXT    NOT NULL DEFAULT 'Untitled Note',
                content     TEXT    DEFAULT '',
                created_at  TEXT    DEFAULT (datetime('now')),
                updated_at  TEXT    DEFAULT (datetime('now'))
            )
        """)

        # ── note_versions (history before each update) ─────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS note_versions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                note_id     INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                content     TEXT    NOT NULL,
                created_at  TEXT    DEFAULT (datetime('now'))
            )
        """)

        # ── projects ───────────────────────────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id       INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                section_id      INTEGER REFERENCES sections(id) ON DELETE SET NULL,
                name            TEXT    NOT NULL,
                description     TEXT    DEFAULT '',
                emoji           TEXT    DEFAULT '🚀',
                color           TEXT    DEFAULT '#00b894',
                run_local_path  TEXT    DEFAULT '',
                run_web_url     TEXT    DEFAULT '',
                created_at      TEXT    DEFAULT (datetime('now')),
                updated_at      TEXT    DEFAULT (datetime('now'))
            )
        """)

        # ── project_files (metadata only — actual files on disk) ───────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS project_files (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                name        TEXT    NOT NULL,
                filepath    TEXT    NOT NULL,
                parent_id   INTEGER REFERENCES project_files(id) ON DELETE CASCADE,
                is_dir      INTEGER DEFAULT 0,
                mime_type   TEXT    DEFAULT '',
                file_size   INTEGER DEFAULT 0,
                created_at  TEXT    DEFAULT (datetime('now'))
            )
        """)

        # ── app_settings (key-value store) ─────────────────────────────────────
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key_name    TEXT PRIMARY KEY,
                value       TEXT DEFAULT ''
            )
        """)

        # ── FTS5 virtual table for full-text search across notes ──────────────
        # Always drop and recreate the FTS table + triggers so that any
        # schema mismatch from old databases (e.g. stale 'tags' column) is
        # healed automatically on the next app start. FTS5 content tables are
        # cheap to rebuild — SQLite repopulates from the source table lazily.
        conn.execute("DROP TRIGGER IF EXISTS notes_fts_insert")
        conn.execute("DROP TRIGGER IF EXISTS notes_fts_update")
        conn.execute("DROP TRIGGER IF EXISTS notes_fts_delete")
        conn.execute("DROP TABLE IF EXISTS notes_fts")

        conn.execute("""
            CREATE VIRTUAL TABLE notes_fts
            USING fts5(
                title,
                content,
                content='notes',
                content_rowid='id'
            )
        """)

        # Populate FTS index from existing notes (idempotent re-build)
        conn.execute("""
            INSERT INTO notes_fts(rowid, title, content)
            SELECT id, title, content FROM notes
        """)

        # ── Triggers to keep FTS5 in sync with notes table ────────────────────
        conn.execute("""
            CREATE TRIGGER notes_fts_insert
            AFTER INSERT ON notes BEGIN
                INSERT INTO notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END
        """)

        conn.execute("""
            CREATE TRIGGER notes_fts_update
            AFTER UPDATE ON notes BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
                INSERT INTO notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END
        """)

        conn.execute("""
            CREATE TRIGGER notes_fts_delete
            AFTER DELETE ON notes BEGIN
                INSERT INTO notes_fts(notes_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
            END
        """)

        # ── Default setting: mark setup as NOT complete on first run ───────────
        conn.execute("""
            INSERT OR IGNORE INTO app_settings (key_name, value)
            VALUES ('setup_complete', 'false')
        """)

        logger.info("Database initialized at: %s", db_path)
