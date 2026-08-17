import json
import os
import secrets
from datetime import datetime

from flask import Flask, request, jsonify, g, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash

import db
import templates
from auth import make_token, require_auth

app = Flask(__name__, static_folder="static", static_url_path="")

# ---------------------------------------------------------------- helpers

def row_to_dict(row):
    return dict(row) if row else None


def company_public(row):
    d = row_to_dict(row)
    if d:
        d["values"] = json.loads(d.pop("values_json") or "[]")
    return d


def program_progress(program_id):
    rows = db.query(
        "SELECT t.done FROM tasks t JOIN phases p ON t.phase_id = p.id WHERE p.program_id = ?",
        (program_id,),
    )
    total = len(rows)
    done = sum(1 for r in rows if r["done"])
    pct = round(done / total * 100) if total else 0
    return pct, done, total


def create_program(company_id, user_id, fmt, company_name, job_role, values):
    program_id = db.execute(
        "INSERT INTO programs (company_id, user_id, format) VALUES (?, ?, ?)",
        (company_id, user_id, fmt),
    )
    phases = templates.build_phases(fmt, company_name, job_role or "сотрудник")
    for pi, phase in enumerate(phases):
        phase_id = db.execute(
            "INSERT INTO phases (program_id, title, sort_order) VALUES (?, ?, ?)",
            (program_id, phase["title"], pi),
        )
        for ti, (title, desc) in enumerate(phase["tasks"]):
            db.execute(
                "INSERT INTO tasks (phase_id, title, description, sort_order) VALUES (?, ?, ?, ?)",
                (phase_id, title, desc, ti),
            )
    quiz = templates.build_quiz(company_name, values)
    for qi, q in enumerate(quiz):
        db.execute(
            "INSERT INTO quiz_questions (program_id, question, options_json, correct_index, sort_order) VALUES (?, ?, ?, ?, ?)",
            (program_id, q["q"], json.dumps(q["opts"], ensure_ascii=False), q["correct"], qi),
        )
    return program_id


def program_full_payload(program_row, for_employee=True):
    program_id = program_row["id"]
    phases = db.query("SELECT * FROM phases WHERE program_id = ? ORDER BY sort_order", (program_id,))
    phase_list = []
    for ph in phases:
        tasks = db.query("SELECT * FROM tasks WHERE phase_id = ? ORDER BY sort_order", (ph["id"],))
        phase_list.append({
            "id": ph["id"],
            "title": ph["title"],
            "tasks": [
                {"id": t["id"], "title": t["title"], "description": t["description"], "done": bool(t["done"])}
                for t in tasks
            ],
        })
    questions = db.query("SELECT * FROM quiz_questions WHERE program_id = ? ORDER BY sort_order", (program_id,))
    quiz_list = []
    for q in questions:
        answer = db.query(
            "SELECT * FROM quiz_answers WHERE question_id = ? ORDER BY id DESC LIMIT 1", (q["id"],), one=True
        )
        item = {
            "id": q["id"],
            "question": q["question"],
            "options": json.loads(q["options_json"]),
        }
        if answer:
            item["answered"] = True
            item["chosen"] = answer["chosen_index"]
            item["correct_index"] = q["correct_index"]
        else:
            item["answered"] = False
            if not for_employee:
                item["correct_index"] = q["correct_index"]
        quiz_list.append(item)

    feedback = db.query(
        "SELECT * FROM feedback WHERE program_id = ? ORDER BY created_at DESC", (program_id,)
    )
    pct, done, total = program_progress(program_id)
    return {
        "id": program_id,
        "format": program_row["format"],
        "format_label": templates.FORMAT_LABELS.get(program_row["format"], program_row["format"]),
        "progress": pct,
        "done": done,
        "total": total,
        "phases": phase_list,
        "quiz": quiz_list,
        "feedback": [
            {"mood": f["mood"], "text": f["text"], "created_at": f["created_at"]} for f in feedback
        ],
    }


def status_for(progress):
    return {"label": "В зоне риска", "code": "risk"} if progress < 40 else {"label": "Идёт по плану", "code": "ok"}


# ---------------------------------------------------------------- auth routes

@app.post("/api/auth/login")
def login():
    body = request.get_json(force=True, silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    user = db.query("SELECT * FROM users WHERE lower(email) = ?", (email,), one=True)
    if not user or not user["password_hash"] or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Неверный email или пароль"}), 401
    token = make_token(user)
    return jsonify({"token": token, "user": public_user(user)})


def public_user(user):
    d = {"id": user["id"], "name": user["name"], "role": user["role"], "company_id": user["company_id"]}
    if user["company_id"]:
        c = db.query("SELECT name FROM companies WHERE id = ?", (user["company_id"],), one=True)
        d["company_name"] = c["name"] if c else None
    return d


@app.get("/api/auth/me")
@require_auth()
def me():
    user = db.query("SELECT * FROM users WHERE id = ?", (g.user["sub"],), one=True)
    if not user:
        return jsonify({"error": "Пользователь не найден"}), 404
    return jsonify(public_user(user))


@app.get("/api/auth/invite/<token>")
def invite_info(token):
    inv = db.query("SELECT * FROM invites WHERE token = ?", (token,), one=True)
    if not inv or inv["used"]:
        return jsonify({"error": "Приглашение недействительно или уже использовано"}), 404
    company = db.query("SELECT * FROM companies WHERE id = ?", (inv["company_id"],), one=True)
    return jsonify({
        "role": inv["role"],
        "company_name": company["name"] if company else None,
        "name": inv["name"],
        "email": inv["email"],
        "job_role": inv["job_role"],
        "format": inv["format"],
        "format_label": templates.FORMAT_LABELS.get(inv["format"]) if inv["format"] else None,
    })


@app.post("/api/auth/accept-invite/<token>")
def accept_invite(token):
    body = request.get_json(force=True, silent=True) or {}
    password = body.get("password") or ""
    if len(password) < 4:
        return jsonify({"error": "Пароль должен быть не короче 4 символов"}), 400

    inv = db.query("SELECT * FROM invites WHERE token = ?", (token,), one=True)
    if not inv or inv["used"]:
        return jsonify({"error": "Приглашение недействительно или уже использовано"}), 404

    existing = db.query("SELECT id FROM users WHERE lower(email) = ?", (inv["email"].lower(),), one=True)
    if existing:
        return jsonify({"error": "Пользователь с таким email уже зарегистрирован"}), 400

    pw_hash = generate_password_hash(password)
    user_id = db.execute(
        "INSERT INTO users (email, password_hash, name, role, company_id, job_role) VALUES (?, ?, ?, ?, ?, ?)",
        (inv["email"], pw_hash, inv["name"], inv["role"], inv["company_id"], inv["job_role"]),
    )
    db.execute("UPDATE invites SET used = 1 WHERE token = ?", (token,))

    if inv["role"] == "EMPLOYEE":
        company = db.query("SELECT * FROM companies WHERE id = ?", (inv["company_id"],), one=True)
        values = json.loads(company["values_json"] or "[]")
        create_program(inv["company_id"], user_id, inv["format"] or "onboarding", company["name"], inv["job_role"], values)

    user = db.query("SELECT * FROM users WHERE id = ?", (user_id,), one=True)
    token_jwt = make_token(user)
    return jsonify({"token": token_jwt, "user": public_user(user)})


# ---------------------------------------------------------------- agency routes

@app.post("/api/agency/companies")
@require_auth(roles=["AGENCY"])
def agency_create_company():
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()
    industry = (body.get("industry") or "").strip()
    values = [v.strip() for v in (body.get("values") or []) if v.strip()]
    hr_name = (body.get("hr_name") or "").strip()
    hr_email = (body.get("hr_email") or "").strip().lower()
    if not name or not hr_name or not hr_email:
        return jsonify({"error": "Название компании, имя и email HR обязательны"}), 400

    company_id = db.execute(
        "INSERT INTO companies (name, industry, values_json, created_by) VALUES (?, ?, ?, ?)",
        (name, industry, json.dumps(values, ensure_ascii=False), g.user["sub"]),
    )
    token = secrets.token_urlsafe(16)
    db.execute(
        "INSERT INTO invites (token, role, company_id, email, name) VALUES (?, 'HR', ?, ?, ?)",
        (token, company_id, hr_email, hr_name),
    )
    company = db.query("SELECT * FROM companies WHERE id = ?", (company_id,), one=True)
    return jsonify({"company": company_public(company), "invite_token": token})


@app.get("/api/agency/companies")
@require_auth(roles=["AGENCY"])
def agency_list_companies():
    companies = db.query("SELECT * FROM companies ORDER BY id DESC")
    out = []
    for c in companies:
        employees = db.query(
            "SELECT u.id FROM users u WHERE u.company_id = ? AND u.role = 'EMPLOYEE'", (c["id"],)
        )
        progresses = []
        for e in employees:
            prog = db.query("SELECT id FROM programs WHERE user_id = ?", (e["id"],), one=True)
            if prog:
                pct, _, _ = program_progress(prog["id"])
                progresses.append(pct)
        hr_pending = db.query(
            "SELECT COUNT(*) c FROM invites WHERE company_id = ? AND role = 'HR' AND used = 0", (c["id"],), one=True
        )
        hr_active = db.query(
            "SELECT COUNT(*) c FROM users WHERE company_id = ? AND role = 'HR'", (c["id"],), one=True
        )
        avg = round(sum(progresses) / len(progresses)) if progresses else 0
        cd = company_public(c)
        cd["employee_count"] = len(employees)
        cd["avg_progress"] = avg
        cd["hr_active"] = hr_active["c"] > 0
        cd["hr_pending"] = hr_pending["c"] > 0
        out.append(cd)
    return jsonify(out)


@app.get("/api/agency/companies/<int:company_id>")
@require_auth(roles=["AGENCY"])
def agency_company_detail(company_id):
    c = db.query("SELECT * FROM companies WHERE id = ?", (company_id,), one=True)
    if not c:
        return jsonify({"error": "Компания не найдена"}), 404
    employees = db.query(
        "SELECT * FROM users WHERE company_id = ? AND role = 'EMPLOYEE' ORDER BY id DESC", (company_id,)
    )
    emp_out = []
    for e in employees:
        prog = db.query("SELECT * FROM programs WHERE user_id = ?", (e["id"],), one=True)
        pct = 0
        fmt = None
        if prog:
            pct, _, _ = program_progress(prog["id"])
            fmt = prog["format"]
        emp_out.append({
            "id": e["id"], "name": e["name"], "job_role": e["job_role"],
            "format": fmt, "format_label": templates.FORMAT_LABELS.get(fmt, fmt),
            "progress": pct, "status": status_for(pct),
        })
    pending_invites = db.query(
        "SELECT * FROM invites WHERE company_id = ? AND used = 0 ORDER BY created_at DESC", (company_id,)
    )
    return jsonify({
        "company": company_public(c),
        "employees": emp_out,
        "pending_invites": [
            {"token": i["token"], "role": i["role"], "name": i["name"], "email": i["email"]}
            for i in pending_invites
        ],
    })


# ---------------------------------------------------------------- HR routes

@app.post("/api/hr/employees")
@require_auth(roles=["HR"])
def hr_create_employee():
    body = request.get_json(force=True, silent=True) or {}
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    job_role = (body.get("job_role") or "").strip()
    fmt = body.get("format") or "onboarding"
    if not name or not email:
        return jsonify({"error": "Имя и email сотрудника обязательны"}), 400
    if fmt not in templates.FORMAT_LABELS:
        return jsonify({"error": "Неизвестный формат программы"}), 400

    company_id = g.user["company_id"]
    token = secrets.token_urlsafe(16)
    db.execute(
        "INSERT INTO invites (token, role, company_id, email, name, job_role, format) VALUES (?, 'EMPLOYEE', ?, ?, ?, ?, ?)",
        (token, company_id, email, name, job_role, fmt),
    )
    return jsonify({"invite_token": token})


@app.get("/api/hr/employees")
@require_auth(roles=["HR"])
def hr_list_employees():
    company_id = g.user["company_id"]
    employees = db.query(
        "SELECT * FROM users WHERE company_id = ? AND role = 'EMPLOYEE' ORDER BY id DESC", (company_id,)
    )
    out = []
    for e in employees:
        prog = db.query("SELECT * FROM programs WHERE user_id = ?", (e["id"],), one=True)
        pct = 0
        fmt = None
        if prog:
            pct, _, _ = program_progress(prog["id"])
            fmt = prog["format"]
        out.append({
            "id": e["id"], "name": e["name"], "job_role": e["job_role"],
            "format": fmt, "format_label": templates.FORMAT_LABELS.get(fmt, fmt),
            "progress": pct, "status": status_for(pct), "pending": False,
        })
    pending = db.query(
        "SELECT * FROM invites WHERE company_id = ? AND role = 'EMPLOYEE' AND used = 0 ORDER BY created_at DESC",
        (company_id,),
    )
    for i in pending:
        out.append({
            "id": None, "name": i["name"], "job_role": i["job_role"],
            "format": i["format"], "format_label": templates.FORMAT_LABELS.get(i["format"], i["format"]),
            "progress": 0, "status": {"label": "Приглашение отправлено", "code": "pending"},
            "pending": True, "invite_token": i["token"],
        })
    return jsonify(out)


@app.get("/api/hr/employees/<int:emp_id>")
@require_auth(roles=["HR"])
def hr_employee_detail(emp_id):
    company_id = g.user["company_id"]
    emp = db.query("SELECT * FROM users WHERE id = ? AND company_id = ? AND role = 'EMPLOYEE'", (emp_id, company_id), one=True)
    if not emp:
        return jsonify({"error": "Сотрудник не найден"}), 404
    prog = db.query("SELECT * FROM programs WHERE user_id = ?", (emp_id,), one=True)
    if not prog:
        return jsonify({"error": "Программа не найдена"}), 404
    payload = program_full_payload(prog, for_employee=False)
    payload["employee"] = {"id": emp["id"], "name": emp["name"], "job_role": emp["job_role"]}
    return jsonify(payload)


@app.get("/api/hr/overview")
@require_auth(roles=["HR"])
def hr_overview():
    company_id = g.user["company_id"]
    company = db.query("SELECT * FROM companies WHERE id = ?", (company_id,), one=True)
    employees = db.query("SELECT * FROM users WHERE company_id = ? AND role = 'EMPLOYEE'", (company_id,))
    progresses = []
    for e in employees:
        prog = db.query("SELECT id FROM programs WHERE user_id = ?", (e["id"],), one=True)
        if prog:
            pct, _, _ = program_progress(prog["id"])
            progresses.append(pct)
    avg = round(sum(progresses) / len(progresses)) if progresses else 0
    risk = sum(1 for p in progresses if p < 40)
    return jsonify({
        "company": company_public(company),
        "active_programs": len(progresses),
        "avg_progress": avg,
        "at_risk": risk,
    })


# ---------------------------------------------------------------- employee routes

def get_own_program():
    return db.query("SELECT * FROM programs WHERE user_id = ?", (g.user["sub"],), one=True)


@app.get("/api/employee/dashboard")
@require_auth(roles=["EMPLOYEE"])
def employee_dashboard():
    user = db.query("SELECT * FROM users WHERE id = ?", (g.user["sub"],), one=True)
    company = db.query("SELECT * FROM companies WHERE id = ?", (user["company_id"],), one=True)
    prog = get_own_program()
    if not prog:
        return jsonify({"error": "Программа не найдена"}), 404
    payload = program_full_payload(prog, for_employee=True)
    payload["employee"] = {"name": user["name"], "job_role": user["job_role"]}
    payload["company"] = company_public(company)
    return jsonify(payload)


@app.post("/api/employee/tasks/<int:task_id>/toggle")
@require_auth(roles=["EMPLOYEE"])
def employee_toggle_task(task_id):
    prog = get_own_program()
    if not prog:
        return jsonify({"error": "Программа не найдена"}), 404
    task = db.query(
        "SELECT t.* FROM tasks t JOIN phases p ON t.phase_id = p.id WHERE t.id = ? AND p.program_id = ?",
        (task_id, prog["id"]), one=True,
    )
    if not task:
        return jsonify({"error": "Задача не найдена"}), 404
    new_done = 0 if task["done"] else 1
    db.execute(
        "UPDATE tasks SET done = ?, done_at = ? WHERE id = ?",
        (new_done, datetime.utcnow().isoformat() if new_done else None, task_id),
    )
    pct, done, total = program_progress(prog["id"])
    return jsonify({"done": bool(new_done), "progress": pct})


@app.post("/api/employee/quiz/<int:question_id>/answer")
@require_auth(roles=["EMPLOYEE"])
def employee_answer_quiz(question_id):
    body = request.get_json(force=True, silent=True) or {}
    choice = body.get("choice")
    prog = get_own_program()
    if not prog:
        return jsonify({"error": "Программа не найдена"}), 404
    q = db.query(
        "SELECT * FROM quiz_questions WHERE id = ? AND program_id = ?", (question_id, prog["id"]), one=True
    )
    if not q:
        return jsonify({"error": "Вопрос не найден"}), 404
    existing = db.query("SELECT id FROM quiz_answers WHERE question_id = ?", (question_id,), one=True)
    if existing:
        return jsonify({"error": "Вопрос уже отвечен"}), 400
    correct = 1 if choice == q["correct_index"] else 0
    db.execute(
        "INSERT INTO quiz_answers (question_id, chosen_index, correct) VALUES (?, ?, ?)",
        (question_id, choice, correct),
    )
    return jsonify({"correct": bool(correct), "correct_index": q["correct_index"]})


@app.post("/api/employee/feedback")
@require_auth(roles=["EMPLOYEE"])
def employee_feedback():
    body = request.get_json(force=True, silent=True) or {}
    prog = get_own_program()
    if not prog:
        return jsonify({"error": "Программа не найдена"}), 404
    db.execute(
        "INSERT INTO feedback (program_id, mood, text) VALUES (?, ?, ?)",
        (prog["id"], body.get("mood"), (body.get("text") or "").strip()),
    )
    return jsonify({"ok": True})


# ---------------------------------------------------------------- static frontend

@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/health")
def health():
    return jsonify({"ok": True})


db.init_db()
import seed  # noqa: E402
seed.run()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port, debug=False)
