"""Idempotent demo data seeding: one Pulse agency account plus one
demo company with an HR admin and a few employees at various stages,
so the dashboards aren't empty on first login.
"""
import json
import random

from werkzeug.security import generate_password_hash

import db
import templates

DEMO_PASSWORD = "pulse2026"


def run():
    existing_agency = db.query("SELECT id FROM users WHERE role = 'AGENCY'", one=True)
    if existing_agency:
        return  # already seeded

    pw = generate_password_hash(DEMO_PASSWORD)

    agency_id = db.execute(
        "INSERT INTO users (email, password_hash, name, role, company_id) VALUES (?, ?, ?, 'AGENCY', NULL)",
        ("agency@pulse.local", pw, "Анастасия Мороз"),
    )

    company_id = db.execute(
        "INSERT INTO companies (name, industry, values_json, created_by) VALUES (?, ?, ?, ?)",
        ("Кофе-точка", "Розничная торговля", json.dumps(
            ["Клиент прежде всего", "Честность", "Скорость", "Командная работа"], ensure_ascii=False
        ), agency_id),
    )

    hr_id = db.execute(
        "INSERT INTO users (email, password_hash, name, role, company_id) VALUES (?, ?, ?, 'HR', ?)",
        ("hr@coffee-point.local", pw, "Ольга Смирнова", company_id),
    )

    demo_employees = [
        ("Игорь Панин", "kassir@coffee-point.local", "Кассир", "onboarding", 0.78),
        ("Дарья Волкова", "menedzher@coffee-point.local", "Менеджер зала", "pre", 0.35),
        ("Тимур Ахметов", "sushef@coffee-point.local", "Су-шеф", "post", 0.5),
    ]

    values = ["Клиент прежде всего", "Честность", "Скорость", "Командная работа"]

    for name, email, job_role, fmt, target_pct in demo_employees:
        user_id = db.execute(
            "INSERT INTO users (email, password_hash, name, role, company_id, job_role) VALUES (?, ?, ?, 'EMPLOYEE', ?, ?)",
            (email, pw, name, company_id, job_role),
        )
        program_id = db.execute(
            "INSERT INTO programs (company_id, user_id, format) VALUES (?, ?, ?)",
            (company_id, user_id, fmt),
        )
        phases = templates.build_phases(fmt, "Кофе-точка", job_role)
        task_ids = []
        for pi, phase in enumerate(phases):
            phase_id = db.execute(
                "INSERT INTO phases (program_id, title, sort_order) VALUES (?, ?, ?)",
                (program_id, phase["title"], pi),
            )
            for ti, (title, desc) in enumerate(phase["tasks"]):
                tid = db.execute(
                    "INSERT INTO tasks (phase_id, title, description, sort_order) VALUES (?, ?, ?, ?)",
                    (phase_id, title, desc, ti),
                )
                task_ids.append(tid)

        n_done = round(len(task_ids) * target_pct)
        for tid in task_ids[:n_done]:
            db.execute("UPDATE tasks SET done = 1, done_at = CURRENT_TIMESTAMP WHERE id = ?", (tid,))

        quiz = templates.build_quiz("Кофе-точка", values)
        for qi, q in enumerate(quiz):
            db.execute(
                "INSERT INTO quiz_questions (program_id, question, options_json, correct_index, sort_order) VALUES (?, ?, ?, ?, ?)",
                (program_id, q["q"], json.dumps(q["opts"], ensure_ascii=False), q["correct"], qi),
            )

        db.execute(
            "INSERT INTO feedback (program_id, mood, text) VALUES (?, ?, ?)",
            (program_id, random.choice([3, 4]), "Всё понятно, куратор быстро отвечает на вопросы."),
        )

    print("Seeded demo data:")
    print("  Agency login:  agency@pulse.local / " + DEMO_PASSWORD)
    print("  HR login:      hr@coffee-point.local / " + DEMO_PASSWORD)
    print("  Employee logins: kassir@coffee-point.local / menedzher@coffee-point.local / sushef@coffee-point.local, password " + DEMO_PASSWORD)
