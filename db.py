"""SQLite storage layer for the Pulse onboarding platform.
Stdlib-only (sqlite3) so no extra installs are required.
"""
import sqlite3
import os
import threading

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pulse.db")
_lock = threading.Lock()


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('AGENCY','HR','EMPLOYEE')),
    company_id INTEGER,
    job_role TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    industry TEXT,
    values_json TEXT NOT NULL DEFAULT '[]',
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK(role IN ('HR','EMPLOYEE')),
    company_id INTEGER NOT NULL,
    email TEXT,
    name TEXT,
    job_role TEXT,
    format TEXT,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL UNIQUE,
    format TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    FOREIGN KEY(program_id) REFERENCES programs(id)
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phase_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    FOREIGN KEY(phase_id) REFERENCES phases(id)
);

CREATE TABLE IF NOT EXISTS quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    FOREIGN KEY(program_id) REFERENCES programs(id)
);

CREATE TABLE IF NOT EXISTS quiz_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    chosen_index INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    answered_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES quiz_questions(id)
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    mood INTEGER,
    text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(program_id) REFERENCES programs(id)
);
"""


def init_db():
    with _lock:
        conn = get_conn()
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()


def query(sql, params=(), one=False):
    with _lock:
        conn = get_conn()
        cur = conn.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
    if one:
        return rows[0] if rows else None
    return rows


def execute(sql, params=()):
    with _lock:
        conn = get_conn()
        cur = conn.execute(sql, params)
        conn.commit()
        last_id = cur.lastrowid
        conn.close()
    return last_id
