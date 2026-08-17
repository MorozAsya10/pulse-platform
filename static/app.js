/* Pulse onboarding platform — frontend SPA (vanilla JS, no build step). */

const root = document.getElementById('root');
const state = { token: localStorage.getItem('pulse_token') || null, user: null };

const FORMAT_OPTIONS = [
  { value: 'pre', label: 'Preboarding' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'post', label: 'Postboarding' },
];

const BRAND_SVG = `<svg width="30" height="22" viewBox="0 0 34 26" fill="none">
  <path d="M2 13c1.5 0 1.5-9 3-9s1.5 18 3 18 1.5-22 3-22 1.5 26 3 26 1.5-13 3-13" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
</svg>`;

function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса (' + res.status + ')');
  return data;
}

function logout() {
  localStorage.removeItem('pulse_token');
  state.token = null;
  state.user = null;
  history.replaceState(null, '', location.pathname);
  renderLogin();
}

function topbar(roleLabel) {
  return `
  <div class="topbar">
    <div class="brand">
      <div class="brand-mark">${BRAND_SVG}</div>
      <div>
        <div class="brand-name">pulse</div>
        <div class="brand-tag">платформа онбординга</div>
      </div>
    </div>
    <div class="top-actions">
      ${roleLabel ? `<span class="pill">${esc(roleLabel)}</span>` : ''}
      ${state.user ? `<span>${esc(state.user.name)}</span><button class="btn btn-ghost btn-sm" onclick="logout()">Выйти</button>` : ''}
    </div>
  </div>`;
}

/* ============================== BOOT / ROUTING ============================== */

async function boot() {
  const params = new URLSearchParams(location.search);
  const inviteToken = params.get('invite');
  if (inviteToken) return renderAcceptInvite(inviteToken);

  if (!state.token) return renderLogin();

  try {
    state.user = await api('/api/auth/me');
    routeByRole();
  } catch (e) {
    localStorage.removeItem('pulse_token');
    state.token = null;
    renderLogin();
  }
}

function routeByRole() {
  if (!state.user) return renderLogin();
  if (state.user.role === 'AGENCY') return renderAgency();
  if (state.user.role === 'HR') return renderHR();
  if (state.user.role === 'EMPLOYEE') return renderEmployee();
  renderLogin();
}

/* ============================== LOGIN ============================== */

function renderLogin() {
  root.innerHTML = `
  <div class="center-shell">
    <div style="text-align:center; margin-bottom:24px;">
      <div style="display:inline-flex; align-items:center; gap:10px;">
        <div class="brand-mark">${BRAND_SVG}</div>
        <span class="brand-name" style="color:#fff; font-size:26px;">pulse</span>
      </div>
      <div style="color:rgba(255,255,255,0.8); font-size:13px; margin-top:4px;">платформа онбординга — вход</div>
    </div>
    <div class="card">
      <h2>Вход в личный кабинет</h2>
      <p class="sub">Для агентства, HR-команды или сотрудника — единая точка входа.</p>
      <div class="error-box" id="loginError"></div>
      <div class="field"><label>Email</label><input type="email" id="loginEmail" placeholder="you@company.ru"></div>
      <div class="field"><label>Пароль</label><input type="password" id="loginPassword" placeholder="••••••••"></div>
      <button class="btn btn-primary btn-block" onclick="doLogin()">Войти →</button>
      <p class="hint" style="margin-top:16px;">Демо-доступы (пароль для всех: <b>pulse2026</b>):<br>
        агентство — agency@pulse.local<br>
        HR — hr@coffee-point.local<br>
        сотрудник — kassir@coffee-point.local</p>
    </div>
  </div>`;
  document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.classList.remove('show');
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('pulse_token', data.token);
    routeByRole();
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.add('show');
  }
}

/* ============================== ACCEPT INVITE ============================== */

async function renderAcceptInvite(token) {
  root.innerHTML = `<div class="center-shell"><div class="card"><p class="muted">Загрузка приглашения…</p></div></div>`;
  let info;
  try {
    info = await api('/api/auth/invite/' + token, { auth: false });
  } catch (e) {
    root.innerHTML = `<div class="center-shell"><div class="card"><h2>Ссылка недействительна</h2><p class="sub">${esc(e.message)}</p><button class="btn btn-ghost" onclick="location.href=location.pathname">На главную</button></div></div>`;
    return;
  }
  const roleLabel = info.role === 'HR' ? 'HR-куратор' : 'Сотрудник';
  root.innerHTML = `
  <div class="center-shell">
    <div style="text-align:center; margin-bottom:24px;">
      <div style="display:inline-flex; align-items:center; gap:10px;">
        <div class="brand-mark">${BRAND_SVG}</div>
        <span class="brand-name" style="color:#fff; font-size:26px;">pulse</span>
      </div>
    </div>
    <div class="card">
      <h2>Приглашение в ${esc(info.company_name || 'компанию')}</h2>
      <p class="sub">Вы приглашены как <b>${esc(roleLabel)}</b>${info.job_role ? ' · ' + esc(info.job_role) : ''}${info.format_label ? ' · программа «' + esc(info.format_label) + '»' : ''}. Задайте пароль, чтобы открыть личный кабинет.</p>
      <div class="error-box" id="inviteError"></div>
      <div class="field"><label>Имя</label><input type="text" value="${esc(info.name || '')}" disabled></div>
      <div class="field"><label>Email</label><input type="text" value="${esc(info.email || '')}" disabled></div>
      <div class="field"><label>Придумайте пароль</label><input type="password" id="invitePassword" placeholder="Минимум 4 символа"></div>
      <button class="btn btn-primary btn-block" onclick="doAcceptInvite('${token}')">Создать аккаунт и войти →</button>
    </div>
  </div>`;
}

async function doAcceptInvite(token) {
  const password = document.getElementById('invitePassword').value;
  const errBox = document.getElementById('inviteError');
  errBox.classList.remove('show');
  try {
    const data = await api('/api/auth/accept-invite/' + token, { method: 'POST', body: { password }, auth: false });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('pulse_token', data.token);
    history.replaceState(null, '', location.pathname);
    routeByRole();
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.add('show');
  }
}

/* ============================== SHARED WIDGETS ============================== */

function statusChip(status) {
  const cls = status.code === 'ok' ? 'status-ok' : status.code === 'pending' ? 'status-pending' : 'status-risk';
  return `<span class="status-chip ${cls}">${esc(status.label)}</span>`;
}

function progressCell(pct) {
  return `<div class="row-progress"><div class="row-track"><div class="row-fill" style="width:${pct}%;"></div></div><span style="font-size:12px; color:var(--muted); min-width:32px;">${pct}%</span></div>`;
}

function inviteBox(url) {
  return `<div class="invite-box">
    <input type="text" readonly value="${esc(url)}" id="inviteUrlField" onclick="this.select()">
    <button class="btn btn-primary btn-sm" onclick="copyInviteUrl()">Скопировать</button>
  </div>`;
}

function copyInviteUrl() {
  const el = document.getElementById('inviteUrlField');
  el.select();
  navigator.clipboard && navigator.clipboard.writeText(el.value).catch(() => {});
  document.execCommand && document.execCommand('copy');
}

function inviteUrlFor(tokenValue) {
  return location.origin + location.pathname + '?invite=' + tokenValue;
}

/* ============================== AGENCY DASHBOARD ============================== */

async function renderAgency() {
  root.innerHTML = `<div class="app-shell">${topbar('Агентство Pulse')}<div class="card"><p class="muted">Загрузка…</p></div></div>`;
  let companies;
  try { companies = await api('/api/agency/companies'); } catch (e) { companies = []; }

  root.innerHTML = `
  <div class="app-shell">
    ${topbar('Агентство Pulse')}
    <div class="card">
      <h2>Новая компания-клиент</h2>
      <p class="sub">Заведите компанию и пригласите её HR-куратора — он получит ссылку для входа в свой кабинет.</p>
      <div class="error-box" id="companyError"></div>
      <div id="companyInviteResult"></div>
      <div class="grid-2">
        <div class="field"><label>Название компании</label><input type="text" id="c-name" placeholder="например, «Кофе-точка»"></div>
        <div class="field"><label>Отрасль</label><input type="text" id="c-industry" placeholder="например, розничная торговля"></div>
        <div class="field"><label>Имя HR-куратора</label><input type="text" id="c-hrname" placeholder="Имя Фамилия"></div>
        <div class="field"><label>Email HR-куратора</label><input type="email" id="c-hremail" placeholder="hr@company.ru"></div>
      </div>
      <div class="field"><label>Ценности компании (через запятую)</label><textarea id="c-values" placeholder="Клиент прежде всего, Честность, Скорость"></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" onclick="createCompany()">Создать и получить ссылку-приглашение →</button></div>
    </div>

    <div class="card section-gap">
      <h2>Компании-клиенты</h2>
      <p class="sub">Общий обзор всех запущенных программ адаптации по клиентам агентства.</p>
      <table>
        <thead><tr><th>Компания</th><th>Отрасль</th><th>Сотрудники</th><th style="width:200px;">Средний прогресс</th><th>HR-куратор</th></tr></thead>
        <tbody id="companiesBody"></tbody>
      </table>
      <div id="companyDetail"></div>
    </div>
  </div>`;

  renderCompaniesTable(companies);
}

function renderCompaniesTable(companies) {
  const body = document.getElementById('companiesBody');
  if (!companies.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty-row">Пока нет ни одной компании — создайте первую выше.</div></td></tr>`;
    return;
  }
  body.innerHTML = companies.map((c) => `
    <tr class="clickable" onclick="openCompanyDetail(${c.id})">
      <td><div class="emp-name">${esc(c.name)}</div></td>
      <td class="muted">${esc(c.industry || '—')}</td>
      <td>${c.employee_count}</td>
      <td>${progressCell(c.avg_progress)}</td>
      <td>${c.hr_active ? statusChip({ label: 'Активен', code: 'ok' }) : c.hr_pending ? statusChip({ label: 'Приглашение отправлено', code: 'pending' }) : '<span class="muted">—</span>'}</td>
    </tr>`).join('');
}

async function createCompany() {
  const errBox = document.getElementById('companyError');
  const resultBox = document.getElementById('companyInviteResult');
  errBox.classList.remove('show');
  resultBox.innerHTML = '';
  const body = {
    name: document.getElementById('c-name').value.trim(),
    industry: document.getElementById('c-industry').value.trim(),
    values: document.getElementById('c-values').value.split(',').map((s) => s.trim()).filter(Boolean),
    hr_name: document.getElementById('c-hrname').value.trim(),
    hr_email: document.getElementById('c-hremail').value.trim(),
  };
  try {
    const data = await api('/api/agency/companies', { method: 'POST', body });
    resultBox.innerHTML = `<div class="ok-box show">Компания «${esc(data.company.name)}» создана. Отправьте эту ссылку HR-куратору:</div>${inviteBox(inviteUrlFor(data.invite_token))}`;
    ['c-name', 'c-industry', 'c-hrname', 'c-hremail', 'c-values'].forEach((id) => document.getElementById(id).value = '');
    const companies = await api('/api/agency/companies');
    renderCompaniesTable(companies);
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.add('show');
  }
}

async function openCompanyDetail(id) {
  const box = document.getElementById('companyDetail');
  box.innerHTML = `<p class="muted" style="margin-top:16px;">Загрузка…</p>`;
  let data;
  try { data = await api('/api/agency/companies/' + id); } catch (e) { box.innerHTML = `<div class="error-box show">${esc(e.message)}</div>`; return; }

  const empRows = data.employees.length
    ? data.employees.map((e) => `<tr>
        <td><div class="emp-name">${esc(e.name)}</div><div class="emp-role">${esc(e.job_role || '')}</div></td>
        <td><span class="format-tag">${esc(e.format_label || '—')}</span></td>
        <td>${progressCell(e.progress)}</td>
        <td>${statusChip(e.status)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4"><div class="empty-row">У этой компании пока нет сотрудников в программе.</div></td></tr>`;

  const pendingRows = data.pending_invites.length
    ? data.pending_invites.map((i) => `<div class="side-card" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div><b>${esc(i.name)}</b> <span class="muted">· ${i.role === 'HR' ? 'HR-куратор' : 'Сотрудник'}</span></div>
        </div>
        ${inviteBox(inviteUrlFor(i.token))}
      </div>`).join('')
    : '';

  box.innerHTML = `
    <div style="margin-top:22px; padding-top:20px; border-top:1.5px solid var(--line);">
      <h3 style="margin:0 0 4px; color:var(--navy);">${esc(data.company.name)}</h3>
      <div class="value-chip-wrap" style="margin-bottom:16px;">${data.company.values.map((v) => `<span class="value-chip">${esc(v)}</span>`).join('')}</div>
      <table>
        <thead><tr><th>Сотрудник</th><th>Формат</th><th style="width:200px;">Прогресс</th><th>Статус</th></tr></thead>
        <tbody>${empRows}</tbody>
      </table>
      ${pendingRows ? `<h3 style="margin:22px 0 10px; font-size:15px;">Ожидают активации</h3>${pendingRows}` : ''}
    </div>`;
}

/* ============================== HR DASHBOARD ============================== */

async function renderHR() {
  root.innerHTML = `<div class="app-shell">${topbar('HR-куратор')}<div class="card"><p class="muted">Загрузка…</p></div></div>`;
  let overview, employees;
  try {
    [overview, employees] = await Promise.all([api('/api/hr/overview'), api('/api/hr/employees')]);
  } catch (e) {
    root.innerHTML = `<div class="app-shell">${topbar('HR-куратор')}<div class="card"><div class="error-box show">${esc(e.message)}</div></div></div>`;
    return;
  }

  root.innerHTML = `
  <div class="app-shell">
    ${topbar('HR · ' + (overview.company ? overview.company.name : ''))}

    <div class="card">
      <h2>${esc(overview.company ? overview.company.name : 'Компания')}</h2>
      <p class="sub">Обзор программ адаптации сотрудников вашей команды.</p>
      <div class="stat-row">
        <div class="stat-tile"><div class="s-label">Активные программы</div><div class="s-value">${overview.active_programs}</div></div>
        <div class="stat-tile"><div class="s-label">Средний прогресс</div><div class="s-value">${overview.avg_progress}%</div></div>
        <div class="stat-tile"><div class="s-label">В зоне риска</div><div class="s-value">${overview.at_risk}</div></div>
        <div class="stat-tile"><div class="s-label">Ценности</div><div class="s-value" style="font-size:13px; line-height:1.5; font-family:'Inter',sans-serif; font-weight:600;">${(overview.company.values || []).slice(0, 2).join(', ') || '—'}</div></div>
      </div>
    </div>

    <div class="card section-gap">
      <h2>Пригласить сотрудника</h2>
      <p class="sub">Программа адаптации соберётся автоматически по выбранному формату.</p>
      <div class="error-box" id="empError"></div>
      <div id="empInviteResult"></div>
      <div class="grid-2">
        <div class="field"><label>Имя сотрудника</label><input type="text" id="e-name" placeholder="Имя Фамилия"></div>
        <div class="field"><label>Email сотрудника</label><input type="email" id="e-email" placeholder="employee@company.ru"></div>
        <div class="field"><label>Должность</label><input type="text" id="e-role" placeholder="например, продавец-консультант"></div>
        <div class="field"><label>Формат программы</label>
          <select id="e-format">${FORMAT_OPTIONS.map((f) => `<option value="${f.value}" ${f.value === 'onboarding' ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" onclick="createEmployee()">Пригласить и получить ссылку →</button></div>
    </div>

    <div class="card section-gap">
      <h2>Сотрудники</h2>
      <table>
        <thead><tr><th>Сотрудник</th><th>Формат</th><th style="width:200px;">Прогресс</th><th>Статус</th></tr></thead>
        <tbody id="employeesBody"></tbody>
      </table>
      <div id="employeeDetail"></div>
    </div>
  </div>`;

  renderEmployeesTable(employees);
}

function renderEmployeesTable(employees) {
  const body = document.getElementById('employeesBody');
  if (!employees.length) {
    body.innerHTML = `<tr><td colspan="4"><div class="empty-row">Пока нет сотрудников — пригласите первого выше.</div></td></tr>`;
    return;
  }
  body.innerHTML = employees.map((e) => `
    <tr class="${e.pending ? '' : 'clickable'}" ${e.pending ? '' : `onclick="openEmployeeDetail(${e.id})"`}>
      <td><div class="emp-name">${esc(e.name)}</div><div class="emp-role">${esc(e.job_role || '')}</div></td>
      <td><span class="format-tag">${esc(e.format_label || '—')}</span></td>
      <td>${progressCell(e.progress)}</td>
      <td>${statusChip(e.status)} ${e.pending ? `<button class="link-btn" style="margin-left:8px;" onclick="event.stopPropagation(); showInviteAgain('${e.invite_token}')">ссылка</button>` : ''}</td>
    </tr>`).join('');
}

function showInviteAgain(token) {
  alert(inviteUrlFor(token));
}

async function createEmployee() {
  const errBox = document.getElementById('empError');
  const resultBox = document.getElementById('empInviteResult');
  errBox.classList.remove('show');
  resultBox.innerHTML = '';
  const body = {
    name: document.getElementById('e-name').value.trim(),
    email: document.getElementById('e-email').value.trim(),
    job_role: document.getElementById('e-role').value.trim(),
    format: document.getElementById('e-format').value,
  };
  try {
    const data = await api('/api/hr/employees', { method: 'POST', body });
    resultBox.innerHTML = `<div class="ok-box show">Приглашение создано. Отправьте эту ссылку сотруднику:</div>${inviteBox(inviteUrlFor(data.invite_token))}`;
    ['e-name', 'e-email', 'e-role'].forEach((id) => document.getElementById(id).value = '');
    const employees = await api('/api/hr/employees');
    renderEmployeesTable(employees);
  } catch (e) {
    errBox.textContent = e.message;
    errBox.classList.add('show');
  }
}

async function openEmployeeDetail(id) {
  const box = document.getElementById('employeeDetail');
  box.innerHTML = `<p class="muted" style="margin-top:16px;">Загрузка…</p>`;
  let data;
  try { data = await api('/api/hr/employees/' + id); } catch (e) { box.innerHTML = `<div class="error-box show">${esc(e.message)}</div>`; return; }

  const phasesHtml = data.phases.map((ph) => `
    <div class="phase open">
      <div class="phase-head" style="cursor:default;">
        <div class="phase-title">${esc(ph.title)}</div>
        <span class="phase-count">${ph.tasks.filter((t) => t.done).length}/${ph.tasks.length}</span>
      </div>
      <div class="phase-body" style="max-height:900px;">
        ${ph.tasks.map((t) => `<div class="task-row ${t.done ? 'done' : ''}">
          <div class="task-check ${t.done ? 'checked' : ''}" style="cursor:default;"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.2L4.6 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div class="task-text"><div class="t-title">${esc(t.title)}</div><div class="t-desc">${esc(t.description || '')}</div></div>
        </div>`).join('')}
      </div>
    </div>`).join('');

  const quizHtml = data.quiz.map((q, i) => `<div class="quiz-q"><p>${i + 1}. ${esc(q.question)}</p>
    ${q.answered ? `<div class="muted" style="font-size:12.5px;">Ответ: ${esc(q.options[q.chosen])} ${q.chosen === q.correct_index ? '✅' : '❌'}</div>` : '<div class="muted" style="font-size:12.5px;">Пока не отвечено</div>'}</div>`).join('');

  const feedbackHtml = data.feedback.length
    ? data.feedback.map((f) => `<div style="font-size:13px; margin-bottom:8px;"><b>${['😞','😐','🙂','😄'][((f.mood||3)-1)] || ''}</b> ${esc(f.text || '')} <span class="muted" style="font-size:11px;">${esc((f.created_at||'').slice(0,16).replace('T',' '))}</span></div>`).join('')
    : '<p class="muted" style="font-size:13px;">Обратной связи пока нет.</p>';

  box.innerHTML = `
    <div style="margin-top:22px; padding-top:20px; border-top:1.5px solid var(--line);">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="margin:0; color:var(--navy);">${esc(data.employee.name)} <span class="muted" style="font-weight:400; font-size:13px;">· ${esc(data.employee.job_role || '')}</span></h3>
        <button class="link-btn" onclick="document.getElementById('employeeDetail').innerHTML=''">закрыть ✕</button>
      </div>
      <div class="layout-2col">
        <div>${phasesHtml}</div>
        <div>
          <div class="side-card"><h3>Мини-тест</h3>${quizHtml}</div>
          <div class="side-card"><h3>Обратная связь</h3>${feedbackHtml}</div>
        </div>
      </div>
    </div>`;
}

/* ============================== EMPLOYEE DASHBOARD ============================== */

let employeeState = null;

async function renderEmployee() {
  root.innerHTML = `<div class="app-shell">${topbar('Сотрудник')}<div class="card"><p class="muted">Загрузка…</p></div></div>`;
  try {
    employeeState = await api('/api/employee/dashboard');
  } catch (e) {
    root.innerHTML = `<div class="app-shell">${topbar('Сотрудник')}<div class="card"><div class="error-box show">${esc(e.message)}</div></div></div>`;
    return;
  }
  drawEmployee();
}

function drawEmployee() {
  const d = employeeState;
  root.innerHTML = `
  <div class="app-shell">
    ${topbar(d.format_label)}
    <div class="card">
      <div class="dash-head">
        <div>
          <h2 style="margin-top:0;">Добро пожаловать, ${esc(d.employee.name)} 👋</h2>
          <div class="who"><b>${esc(d.employee.job_role || '')}</b> · ${esc(d.company.name)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="window.print()">Экспорт / печать PDF</button>
      </div>

      <div class="progress-wrap">
        <div class="progress-top"><span style="font-size:13px; color:var(--muted); font-weight:600;">Прогресс адаптации</span><span class="pct">${d.progress}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${d.progress}%;"></div></div>
        <div class="badges-row">
          <div class="badge ${d.progress >= 25 ? 'on' : ''}">🥉 Первый шаг</div>
          <div class="badge ${d.progress >= 60 ? 'on' : ''}">🥈 На полпути</div>
          <div class="badge ${d.progress >= 100 ? 'on' : ''}">🥇 Адаптация завершена</div>
        </div>
      </div>

      <div class="layout-2col">
        <div id="phasesContainer">${renderPhasesHtml(d.phases)}</div>
        <div>
          <div class="side-card">
            <h3>О компании</h3>
            <p style="font-size:13px; color:var(--muted); margin:0 0 10px;">Ценности ${esc(d.company.name)}:</p>
            ${d.company.values.map((v) => `<span class="value-chip">${esc(v)}</span>`).join('')}
          </div>
          <div class="side-card">
            <h3>Мини-тест на знание компании</h3>
            <div id="quizContainer">${renderQuizHtml(d.quiz)}</div>
          </div>
          <div class="side-card">
            <h3>Как настроение? Обратная связь</h3>
            <div class="mood-row" id="moodRow">
              ${[1,2,3,4].map((m) => `<button class="mood-btn" data-mood="${m}" onclick="pickMood(this,${m})">${['😞','😐','🙂','😄'][m-1]}</button>`).join('')}
            </div>
            <textarea id="feedbackText" placeholder="Что помогло / что было непонятно?"></textarea>
            <button class="btn btn-primary btn-sm" style="margin-top:10px; width:100%;" onclick="submitFeedback()">Отправить куратору</button>
            <div class="ok-box" id="feedbackOk" style="margin-top:10px;">Спасибо! Куратор получил обратную связь.</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

function renderPhasesHtml(phases) {
  return phases.map((ph, pi) => `
    <div class="phase ${pi === 0 ? 'open' : ''}" id="phase-${ph.id}">
      <div class="phase-head" onclick="togglePhase(${ph.id})">
        <div class="phase-title">${esc(ph.title)}</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="phase-count">${ph.tasks.filter((t) => t.done).length}/${ph.tasks.length}</span>
          <span class="chevron">▾</span>
        </div>
      </div>
      <div class="phase-body">
        ${ph.tasks.map((t) => `<div class="task-row ${t.done ? 'done' : ''}" id="task-${t.id}">
          <div class="task-check ${t.done ? 'checked' : ''}" onclick="toggleTask(${t.id})">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6.2L4.6 9L10 3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="task-text"><div class="t-title">${esc(t.title)}</div><div class="t-desc">${esc(t.description || '')}</div></div>
        </div>`).join('')}
      </div>
    </div>`).join('');
}

function togglePhase(id) {
  document.getElementById('phase-' + id).classList.toggle('open');
}

async function toggleTask(taskId) {
  try {
    const res = await api('/api/employee/tasks/' + taskId + '/toggle', { method: 'POST' });
    for (const ph of employeeState.phases) {
      const t = ph.tasks.find((x) => x.id === taskId);
      if (t) t.done = res.done;
    }
    employeeState.progress = res.progress;
    drawEmployee();
  } catch (e) { alert(e.message); }
}

function renderQuizHtml(quiz) {
  return quiz.map((q, qi) => `<div class="quiz-q" id="quiz-${q.id}">
    <p>${qi + 1}. ${esc(q.question)}</p>
    ${q.options.map((o, oi) => {
      let cls = 'quiz-opt';
      let disabled = '';
      if (q.answered) {
        disabled = 'disabled';
        if (oi === q.correct_index) cls += ' correct';
        else if (oi === q.chosen) cls += ' wrong';
      }
      return `<button class="${cls}" ${disabled} onclick="answerQuiz(${q.id},${oi})">${esc(o)}</button>`;
    }).join('')}
  </div>`).join('');
}

async function answerQuiz(questionId, choice) {
  try {
    await api('/api/employee/quiz/' + questionId + '/answer', { method: 'POST', body: { choice } });
    employeeState = await api('/api/employee/dashboard');
    document.getElementById('quizContainer').innerHTML = renderQuizHtml(employeeState.quiz);
  } catch (e) { /* already answered or network issue — refresh silently */ }
}

let selectedMood = null;
function pickMood(btn, val) {
  document.querySelectorAll('.mood-btn').forEach((b) => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedMood = val;
}

async function submitFeedback() {
  const text = document.getElementById('feedbackText').value.trim();
  try {
    await api('/api/employee/feedback', { method: 'POST', body: { mood: selectedMood, text } });
    document.getElementById('feedbackText').value = '';
    const ok = document.getElementById('feedbackOk');
    ok.classList.add('show');
    setTimeout(() => ok.classList.remove('show'), 3000);
  } catch (e) { alert(e.message); }
}

/* ============================== GO ============================== */
boot();
