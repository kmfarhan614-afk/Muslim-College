'use strict';

(function () {
  const SESSION_KEY = 'mca_teacher_session';
  const BASE = 'api/';
  const TABS = [
    { id: 'overview', label: 'Overview', icon: 'fa-gauge-high' },
    { id: 'attendance', label: 'Attendance', icon: 'fa-clipboard-check' },
    { id: 'marks', label: 'Marks Entry', icon: 'fa-pen-to-square' },
    { id: 'results', label: 'Results', icon: 'fa-square-poll-vertical' },
    { id: 'dmc', label: 'Print DMC', icon: 'fa-file-certificate' },
    { id: 'planner', label: 'Academic Planner', icon: 'fa-calendar-days' },
    { id: 'profile', label: 'My Profile', icon: 'fa-user' }
  ];

  let session = null;
  let teacher = null;
  let meta = null;
  let tab = 'overview';
  let mustChangePassword = false;
  let renderSeq = 0;
  let examsCache = null;
  let dmcData = null;
  let photoDraft = '';
  const views = {
    attendance: { className: '', section: '', subject: '', date: today(), historyFrom: daysAgo(30), historyTo: today() },
    marks: { examId: '', subjectId: '' },
    results: { examId: '' },
    dmc: { examId: '', studentId: '' }
  };

  function el(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function today() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(d);
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(String(value).length === 10 ? value + 'T00:00:00' : value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function monthLabel(key) {
    const parts = String(key || '').split('-');
    if (parts.length < 2) return key;
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(part => part[0].toUpperCase()).join('');
  }

  function readSession() {
    for (const store of [localStorage, sessionStorage]) {
      try {
        const raw = store.getItem(SESSION_KEY);
        if (raw) {
          const data = JSON.parse(raw);
          if (data && data.token) return data;
        }
      } catch (err) { /* ignore */ }
    }
    return null;
  }

  function persistSession() {
    if (!session) return;
    const inLocal = !!localStorage.getItem(SESSION_KEY);
    const store = inLocal ? localStorage : sessionStorage;
    try { store.setItem(SESSION_KEY, JSON.stringify(session)); } catch (err) { /* ignore */ }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
    try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
  }

  function goLogin() {
    clearSession();
    window.location.replace('teacher-login.html');
  }

  function apiMessage(status, message) {
    if (status === 404) {
      return 'The Teacher Portal API was not found. Start the bundled backend with "node server.js" and open http://127.0.0.1:3000.';
    }
    if (status === 403) return message || 'You do not have permission to perform this action.';
    if (status === 429) return message || 'Too many requests. Wait a few minutes and try again.';
    if (status >= 500) return 'The Teacher Portal service could not complete the request. Try again.';
    return message || 'Could not complete the request.';
  }

  async function api(route, options) {
    const opts = options || {};
    const headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (session && session.token) headers['Authorization'] = 'Bearer ' + session.token;
    let res;
    try {
      res = await fetch(BASE + route, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (err) {
      const error = new Error('Cannot reach the Teacher Portal service. Start server.js and try again.');
      error.status = 0;
      error.route = route;
      throw error;
    }
    let data = null;
    try { data = await res.json(); } catch (err) { /* ignore */ }
    if (res.status === 401) {
      goLogin();
      throw new Error('Your session has expired. Sign in again.');
    }
    if (!res.ok) {
      const error = new Error(apiMessage(res.status, data && data.message));
      error.status = res.status;
      error.route = route;
      throw error;
    }
    return data;
  }

  function toast(message, type) {
    let stack = el('tpToastStack');
    if (!stack) return;
    const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    const iconsType = type || 'info';
    const node = document.createElement('div');
    node.className = 'tp-toast tp-toast-' + iconsType;
    node.innerHTML = '<i class="fa-solid ' + icons[iconsType] + '"></i><span>' + esc(message) + '</span>';
    stack.appendChild(node);
    setTimeout(() => node.classList.add('in'), 20);
    setTimeout(() => {
      node.classList.remove('in');
      setTimeout(() => node.remove(), 250);
    }, 3600);
  }

  function can(permission) {
    return !!(meta && meta.permissions && meta.permissions[permission]);
  }

  function allowedTabs() {
    return TABS.filter(item => {
      if (item.id === 'attendance') return can('takeAttendance') || can('viewAttendanceReports');
      if (item.id === 'marks') return can('enterMarks') || can('viewResults');
      if (item.id === 'results') return can('viewResults');
      if (item.id === 'dmc') return can('viewResults') && can('generateDmc');
      if (item.id === 'planner') return can('viewPlanner');
      return true;
    });
  }

  function renderChrome() {
    const top = el('tpTopActions');
    if (top) {
      top.innerHTML =
        '<div class="tp-top-user">' +
          '<span class="tp-avatar">' + (teacher.photo ? '<img src="' + esc(teacher.photo) + '" alt="">' : esc(initials(teacher.fullName))) + '</span>' +
          '<span><strong>' + esc(teacher.fullName) + '</strong><small>' + esc(teacher.portalNumber) + '</small></span>' +
        '</div>' +
        '<button type="button" class="tp-icon-btn" id="tpOpenPassword" title="Change password"><i class="fa-solid fa-key"></i></button>' +
        '<button type="button" class="tp-icon-btn" id="tpTopLogout" title="Sign out"><i class="fa-solid fa-right-from-bracket"></i></button>';
      el('tpOpenPassword').addEventListener('click', () => openPassword(false));
      el('tpTopLogout').addEventListener('click', logout);
    }
    const mini = el('tpProfileMini');
    if (mini) {
      mini.innerHTML =
        '<span class="tp-avatar tp-avatar-lg">' + (teacher.photo ? '<img src="' + esc(teacher.photo) + '" alt="">' : esc(initials(teacher.fullName))) + '</span>' +
        '<strong>' + esc(teacher.fullName) + '</strong>' +
        '<small>' + esc(teacher.designation || 'Teacher') + '</small>' +
        '<span class="tp-portal">' + esc(teacher.portalNumber) + '</span>';
    }
    const nav = el('tpNav');
    if (nav) {
      nav.innerHTML = allowedTabs().map(item =>
        '<button type="button" class="tp-nav-link' + (item.id === tab ? ' active' : '') + '" data-tab="' + item.id + '">' +
          '<i class="fa-solid ' + item.icon + '"></i><span>' + esc(item.label) + '</span></button>'
      ).join('');
      nav.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          window.location.hash = btn.dataset.tab;
          closeMenu();
        });
      });
    }
    el('tpLogout').onclick = logout;
  }

  function closeMenu() {
    const sidebar = el('tpSidebar');
    const backdrop = el('tpBackdrop');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
  }

  function openMenu() {
    el('tpSidebar').classList.add('open');
    el('tpBackdrop').classList.add('open');
  }

  function loading() {
    el('tpContent').innerHTML = '<div class="tp-loading"><i class="fa-solid fa-circle-notch fa-spin"></i><p>Loading...</p></div>';
  }

  function pageHead(title, subtitle, actions) {
    return '<div class="tp-page-head"><div><h1>' + esc(title) + '</h1><p>' + esc(subtitle) + '</p></div>' +
      '<div class="tp-page-actions">' + (actions || '') + '</div></div>';
  }

  function emptyState(icon, title, text) {
    return '<div class="tp-empty"><i class="fa-solid ' + icon + '"></i><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div>';
  }

  function stat(label, value, note, icon) {
    return '<div class="tp-stat"><span class="tp-stat-icon"><i class="fa-solid ' + icon + '"></i></span>' +
      '<div><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong>' +
      '<small>' + esc(note || '') + '</small></div></div>';
  }

  async function renderOverview(seq) {
    const data = await api('teacher/dashboard');
    if (seq !== renderSeq) return;
    const d = data.dashboard;
    const s = d.stats;
    const notifications = [];
    if (s.pendingMarks) notifications.push({ icon: 'fa-pen-to-square', text: s.pendingMarks + ' marks entries are still pending for your examinations.' });
    if (s.upcomingExams) notifications.push({ icon: 'fa-calendar-days', text: s.upcomingExams + ' upcoming examination' + (s.upcomingExams === 1 ? ' is' : 's are') + ' on your schedule.' });
    if (!notifications.length) notifications.push({ icon: 'fa-circle-check', text: 'Nothing urgent. Your assigned classes are up to date.' });

    el('tpContent').innerHTML =
      pageHead('Welcome, ' + teacher.fullName.split(' ')[0],
        'Your classes, attendance, marks and examination work in one place.',
        can('takeAttendance') ? '<button type="button" class="btn btn-primary" data-go="attendance"><i class="fa-solid fa-clipboard-check"></i> Take attendance</button>' : '') +
      '<div class="tp-stats">' +
        stat('Students', s.students, s.classes + ' classes', 'fa-user-graduate') +
        stat('Sheets today', s.todaySheets, s.todayPresent + ' present · ' + s.todayAbsent + ' absent', 'fa-clipboard-check') +
        stat('Pending marks', s.pendingMarks, 'Across assigned subjects', 'fa-pen-to-square') +
        stat('Upcoming exams', s.upcomingExams, 'Scheduled for your classes', 'fa-file-pen') +
      '</div>' +
      '<div class="tp-grid-2">' +
        '<section class="tp-card">' +
          '<div class="tp-card-head"><div><h2>Upcoming examinations</h2><p>Your assigned classes only</p></div></div>' +
          (d.upcomingExams.length ? '<div class="tp-exam-list">' + d.upcomingExams.map(e =>
            '<div class="tp-exam-row"><span class="tp-exam-date"><strong>' + esc(e.startDate ? fmtDate(e.startDate) : 'TBA') + '</strong><small>' + esc(e.className) + '</small></span>' +
            '<span><strong>' + esc(e.name) + '</strong><small>' + esc(e.type || 'Examination') + ' · ' + esc(e.status) + '</small></span></div>'
          ).join('') + '</div>' : emptyState('fa-calendar-xmark', 'No upcoming examinations', 'Your examination schedule will appear here.')) +
        '</section>' +
        '<section class="tp-card">' +
          '<div class="tp-card-head"><div><h2>Notifications</h2><p>Things to keep in mind</p></div></div>' +
          '<div class="tp-notices">' + notifications.map(n =>
            '<div class="tp-notice"><i class="fa-solid ' + n.icon + '"></i><span>' + esc(n.text) + '</span></div>'
          ).join('') + '</div>' +
        '</section>' +
      '</div>' +
      '<div class="tp-grid-2">' +
        '<section class="tp-card">' +
          '<div class="tp-card-head"><div><h2>Recent attendance</h2><p>Submitted by you today</p></div></div>' +
          (d.recentAttendance.length ? '<div class="tp-history-list">' + d.recentAttendance.map(r =>
            '<div class="tp-history-row"><span><strong>' + esc(r.className) + '</strong><small>' + esc(r.subject) + ' · ' + esc(r.entries) + ' students</small></span>' +
            '<span class="tp-chip">' + esc(r.submittedAt) + '</span></div>'
          ).join('') + '</div>' : '<div class="tp-empty tp-empty-sm"><i class="fa-solid fa-clipboard"></i><p>No attendance submitted yet today.</p></div>') +
        '</section>' +
        '<section class="tp-card">' +
          '<div class="tp-card-head"><div><h2>Planner preview</h2><p>Next examination dates</p></div></div>' +
          (d.planner.length ? '<div class="tp-history-list">' + d.planner.slice(0, 5).map(e =>
            '<div class="tp-history-row"><span><strong>' + esc(e.title) + '</strong><small>' + esc(e.className) + '</small></span>' +
            '<span class="tp-chip">' + esc(fmtDate(e.date)) + '</span></div>'
          ).join('') + '</div>' : '<div class="tp-empty tp-empty-sm"><i class="fa-solid fa-calendar"></i><p>No scheduled dates yet.</p></div>') +
        '</section>' +
      '</div>';

    el('tpContent').querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => { window.location.hash = btn.dataset.go; });
    });
  }

  function classInfo(name) {
    return (meta.classInfo || []).find(c => c.name === name) || { name: name, sections: [] };
  }

  function subjectsFor(className) {
    return (meta.subjects || []).filter(s => !className || !s.className || s.className === className);
  }

  async function renderAttendance(seq) {
    if (!meta.classes.length) {
      el('tpContent').innerHTML = pageHead('Attendance', 'Submit daily attendance for your assigned classes.') +
        emptyState('fa-user-slash', 'No classes assigned', 'Ask the Super Admin to assign classes to your account.');
      return;
    }
    const v = views.attendance;
    if (!v.className || !meta.classes.includes(v.className)) v.className = meta.classes[0];
    const info = classInfo(v.className);
    if (info.sections.length && !info.sections.includes(v.section)) v.section = info.sections[0];
    if (!info.sections.length) v.section = '';
    const subjects = subjectsFor(v.className);
    if (!subjects.some(s => s.name === v.subject)) v.subject = subjects[0] ? subjects[0].name : '';

    let data;
    try {
      data = await api('teacher/attendance?' + new URLSearchParams({
        class: v.className, section: v.section, subject: v.subject, date: v.date
      }).toString());
    } catch (err) {
      el('tpContent').innerHTML = pageHead('Attendance', 'Submit daily attendance for your assigned classes.') +
        emptyState('fa-triangle-exclamation', 'Attendance unavailable', err.message);
      return;
    }
    if (seq !== renderSeq) return;

    let history = [];
    if (can('viewAttendanceReports')) {
      try {
        const h = await api('teacher/attendance/history?' + new URLSearchParams({
          from: v.historyFrom, to: v.historyTo
        }).toString());
        history = h.rows || [];
      } catch (err) { /* keep empty */ }
    }

    const saved = data.saved;
    const savedMap = new Map(((saved && saved.entries) || []).map(e => [String(e.studentId), e]));
    const canTake = can('takeAttendance');
    const locked = !canTake || (!!saved && !can('editAttendance'));
    const rows = data.roster.map((s, i) => {
      const entry = savedMap.get(String(s.studentId));
      const status = entry ? entry.status : 'present';
      return '<tr data-row="' + esc(s.studentId) + '" data-status="' + esc(status) + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="num">' + esc(s.rollNo) + '</td>' +
        '<td class="td-main">' + esc(s.name) + '<small>' + esc(s.studentId) + '</small></td>' +
        '<td><select class="form-select tp-status" data-sid="' + esc(s.studentId) + '"' + (locked ? ' disabled' : '') + '>' +
          ['present', 'absent', 'leave'].map(st => '<option value="' + st + '"' + (st === status ? ' selected' : '') + '>' +
            st.charAt(0).toUpperCase() + st.slice(1) + '</option>').join('') +
        '</select></td>' +
        '<td><input class="form-input tp-remarks" data-sid="' + esc(s.studentId) + '" value="' + esc(entry ? entry.remarks : '') + '" placeholder="Optional"' + (locked ? ' disabled' : '') + '></td>' +
      '</tr>';
    }).join('');

    const classOptions = meta.classes.map(c => '<option value="' + esc(c) + '"' + (c === v.className ? ' selected' : '') + '>' + esc(c) + '</option>').join('');
    const sectionOptions = info.sections.length
      ? info.sections.map(s => '<option value="' + esc(s) + '"' + (s === v.section ? ' selected' : '') + '>' + esc(s) + '</option>').join('')
      : '<option value="">No section</option>';
    const subjectOptions = subjects.length
      ? subjects.map(s => '<option value="' + esc(s.name) + '"' + (s.name === v.subject ? ' selected' : '') + '>' + esc(s.name) + (s.code ? ' (' + esc(s.code) + ')' : '') + '</option>').join('')
      : '<option value="">No subject assigned</option>';

    el('tpContent').innerHTML =
      pageHead('Attendance', 'Submit attendance for your assigned class and subject.',
        '<button type="button" class="btn btn-outline" id="attPrint"><i class="fa-solid fa-print"></i> Print sheet</button>') +
      '<section class="tp-card">' +
        '<div class="tp-controls">' +
          '<div class="form-group"><label class="form-label">Class</label><select class="form-select" id="attClass">' + classOptions + '</select></div>' +
          '<div class="form-group"><label class="form-label">Section</label><select class="form-select" id="attSection"' + (info.sections.length ? '' : ' disabled') + '>' + sectionOptions + '</select></div>' +
          '<div class="form-group"><label class="form-label">Subject</label><select class="form-select" id="attSubject">' + subjectOptions + '</select></div>' +
          '<div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="attDate" value="' + esc(v.date) + '" max="' + today() + '"></div>' +
        '</div>' +
        (!canTake ? '<div class="tp-banner tp-banner-info"><i class="fa-solid fa-lock"></i><span>Attendance entry is disabled. You can review the submitted sheet and reports only.</span></div>' : '') +
        (saved ? '<div class="tp-banner ' + (locked ? 'tp-banner-warn' : 'tp-banner-info') + '">' +
          '<i class="fa-solid fa-circle-info"></i><span>Attendance was ' + esc(saved.action || 'submitted') + ' at ' + esc(saved.submittedAt || '') +
          (locked ? '. You do not have permission to edit a submitted sheet.' : '. You may correct it because edit permission is enabled.') +
          '</span></div>' : '') +
        (subjects.length ? '' : '<div class="tp-banner tp-banner-warn"><i class="fa-solid fa-triangle-exclamation"></i><span>No subject is assigned to this class. Ask the Super Admin to update your assignments.</span></div>') +
        '<div class="tp-att-tools">' +
          '<div class="tp-counts" id="attCounts"></div>' +
          '<div class="tp-inline-actions">' +
            '<button type="button" class="btn btn-outline btn-sm" data-mark="present"' + (locked ? ' disabled' : '') + '>All present</button>' +
            '<button type="button" class="btn btn-outline btn-sm" data-mark="absent"' + (locked ? ' disabled' : '') + '>All absent</button>' +
          '</div>' +
        '</div>' +
        '<div class="table-scroll"><table class="data-table tp-table"><thead><tr><th>#</th><th>Roll</th><th>Student</th><th>Status</th><th>Remarks</th></tr></thead><tbody id="attBody">' +
          (rows || '<tr><td colspan="5" class="muted">No students in this class.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="tp-form-foot"><span class="muted">' + data.roster.length + ' students · ' + esc(v.subject) + ' · ' + esc(fmtDate(v.date)) + '</span>' +
          (canTake ? '<button type="button" class="btn btn-primary" id="attSave"' + (locked || !subjects.length ? ' disabled' : '') + '><i class="fa-solid fa-floppy-disk"></i> Save attendance</button>' : '') + '</div>' +
      '</section>' +
      (can('viewAttendanceReports') ?
        '<section class="tp-card">' +
          '<div class="tp-card-head"><div><h2>Attendance history</h2><p>Your submitted sheets</p></div>' +
            '<div class="tp-inline-actions"><input type="date" class="form-input tp-date" id="attFrom" value="' + esc(v.historyFrom) + '">' +
            '<input type="date" class="form-input tp-date" id="attTo" value="' + esc(v.historyTo) + '">' +
            '<button type="button" class="btn btn-outline btn-sm" id="attHistory">Apply</button></div></div>' +
          '<div class="table-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Class</th><th>Subject</th><th>Present</th><th>Absent</th><th>Leave</th><th>Submitted</th></tr></thead><tbody>' +
            (history.length ? history.map(r =>
              '<tr><td>' + esc(fmtDate(r.date)) + '</td><td>' + esc(r.className) + '</td><td>' + esc(r.subject) +
              '</td><td class="num">' + r.present + '</td><td class="num">' + r.absent + '</td><td class="num">' + r.leave +
              '</td><td class="muted">' + esc(r.submittedBy || '') + ' · ' + esc(r.submittedAt || '') + '</td></tr>'
            ).join('') : '<tr><td colspan="7" class="muted">No attendance records in this date range.</td></tr>') +
          '</tbody></table></div>' +
        '</section>' : '');

    const body = el('attBody');
    function updateCounts() {
      if (!body) return;
      const statuses = Array.from(body.querySelectorAll('.tp-status')).map(s => s.value);
      const present = statuses.filter(s => s === 'present').length;
      const absent = statuses.filter(s => s === 'absent').length;
      const leave = statuses.filter(s => s === 'leave').length;
      const host = el('attCounts');
      if (host) host.innerHTML = '<span class="tp-count present">' + present + ' present</span>' +
        '<span class="tp-count absent">' + absent + ' absent</span>' +
        '<span class="tp-count leave">' + leave + ' leave</span>';
    }
    updateCounts();

    if (!locked) {
      body.querySelectorAll('.tp-status').forEach(sel => {
        sel.addEventListener('change', () => {
          const row = sel.closest('tr');
          if (row) row.dataset.status = sel.value;
          updateCounts();
        });
      });
      el('tpContent').querySelectorAll('[data-mark]').forEach(btn => {
        btn.addEventListener('click', () => {
          body.querySelectorAll('.tp-status').forEach(sel => { sel.value = btn.dataset.mark; });
          body.querySelectorAll('tr').forEach(tr => { tr.dataset.status = btn.dataset.mark; });
          updateCounts();
        });
      });
    }

    el('attClass').addEventListener('change', e => {
      views.attendance.className = e.target.value;
      views.attendance.section = '';
      views.attendance.subject = '';
      renderTab();
    });
    el('attSection').addEventListener('change', e => {
      views.attendance.section = e.target.value;
      renderTab();
    });
    el('attSubject').addEventListener('change', e => {
      views.attendance.subject = e.target.value;
      renderTab();
    });
    el('attDate').addEventListener('change', e => {
      views.attendance.date = e.target.value || today();
      renderTab();
    });
    if (el('attHistory')) {
      el('attHistory').addEventListener('click', () => {
        views.attendance.historyFrom = el('attFrom').value || daysAgo(30);
        views.attendance.historyTo = el('attTo').value || today();
        renderTab();
      });
    }
    const saveAttendance = el('attSave');
    if (saveAttendance) saveAttendance.addEventListener('click', async () => {
      const entries = Array.from(body.querySelectorAll('tr')).map(tr => {
        const sid = tr.dataset.row;
        const status = tr.querySelector('.tp-status').value;
        const remarks = tr.querySelector('.tp-remarks').value;
        return { studentId: sid, status: status, remarks: remarks };
      });
      if (!entries.length) return toast('There are no students to save.', 'warning');
      const btn = el('attSave');
      btn.classList.add('is-loading');
      try {
        await api('teacher/attendance', {
          method: 'POST',
          body: {
            className: views.attendance.className, section: views.attendance.section,
            subject: views.attendance.subject, date: views.attendance.date, entries: entries
          }
        });
        toast('Attendance saved successfully.', 'success');
        renderTab();
      } catch (err) {
        toast(err.message, 'error');
        btn.classList.remove('is-loading');
      }
    });
    el('attPrint').addEventListener('click', () => printAttendanceSheet(data, savedMap));
  }

  function printAttendanceSheet(data, savedMap) {
    const rows = data.roster.map((s, i) => {
      const entry = savedMap.get(String(s.studentId));
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(s.rollNo) + '</td><td>' + esc(s.name) +
        '</td><td>' + esc(entry ? entry.status : '') + '</td><td></td></tr>';
    }).join('');
    const html = '<div class="tp-print-doc"><h1>Muslim Commerce College Peshawar</h1>' +
      '<h2>Daily Attendance Sheet</h2>' +
      '<p>Class: ' + esc(views.attendance.className) + (views.attendance.section ? ' · Section ' + esc(views.attendance.section) : '') +
      ' · Subject: ' + esc(views.attendance.subject) + ' · Date: ' + esc(fmtDate(views.attendance.date)) + '</p>' +
      '<table><thead><tr><th>#</th><th>Roll No.</th><th>Student Name</th><th>Status</th><th>Remarks</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tp-print-sign"><span>Teacher signature</span><span>Principal signature</span></div></div>';
    printHtml(html);
  }

  async function loadExams(force) {
    if (examsCache && !force) return examsCache;
    const data = await api('teacher/exams');
    examsCache = data.rows || [];
    return examsCache;
  }

  async function renderMarks(seq) {
    if (!can('enterMarks') && !can('viewResults')) {
      el('tpContent').innerHTML = pageHead('Marks Entry', 'Enter marks for your assigned subjects.') +
        emptyState('fa-lock', 'Marks access is disabled', 'Ask the Super Admin to enable marks permissions.');
      return;
    }
    const exams = await loadExams();
    if (seq !== renderSeq) return;
    const usable = exams.filter(e => (e.subjects || []).length);
    if (!usable.length) {
      el('tpContent').innerHTML = pageHead('Marks Entry', 'Enter marks for your assigned subjects.') +
        emptyState('fa-file-circle-xmark', 'No examinations available', 'No examination in your classes has a subject assigned to you.');
      return;
    }
    const v = views.marks;
    if (!usable.some(e => e.id === v.examId)) v.examId = usable[0].id;
    let exam = usable.find(e => e.id === v.examId) || usable[0];
    if (!exam.subjects.some(s => s.id === v.subjectId)) v.subjectId = exam.subjects[0].id;
    const subject = exam.subjects.find(s => s.id === v.subjectId) || exam.subjects[0];

    let data;
    try {
      data = await api('teacher/exams/' + encodeURIComponent(exam.id) + '/marks?subjectId=' + encodeURIComponent(subject.id));
    } catch (err) {
      el('tpContent').innerHTML = pageHead('Marks Entry', 'Enter marks for your assigned subjects.') +
        emptyState('fa-triangle-exclamation', 'Marks unavailable', err.message);
      return;
    }
    if (seq !== renderSeq) return;

    const combined = data.subject.type === 'combined';
    const canEnter = can('enterMarks');
    const lockedExisting = !can('editMarks');
    const rows = data.roster.map((s, i) => {
      const hasMark = !!s.status;
      const locked = !canEnter || (hasMark && lockedExisting);
      return '<tr data-mrow="' + esc(s.id) + '" data-existing="' + (hasMark ? '1' : '0') + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td class="num">' + esc(s.rollNo) + '</td>' +
        '<td class="td-main">' + esc(s.name) + '<small>' + esc(s.studentId) + '</small></td>' +
        '<td><select class="form-select mk-status" data-sid="' + esc(s.id) + '"' + (locked ? ' disabled' : '') + '>' +
          ['', 'present', 'absent', 'withheld'].map(st => '<option value="' + st + '"' + (st === s.status ? ' selected' : '') + '>' +
            (st === '' ? 'Not entered' : st.charAt(0).toUpperCase() + st.slice(1)) + '</option>').join('') +
        '</select></td>' +
        (combined ?
          '<td><input type="number" min="0" max="' + data.subject.theoryMax + '" class="form-input mk-num mk-theory" data-sid="' + esc(s.id) + '" value="' +
            (hasMark ? s.theoryObtained : '') + '"' + (locked || s.status !== 'present' ? ' disabled' : '') + '></td>' +
          '<td><input type="number" min="0" max="' + data.subject.practicalMax + '" class="form-input mk-num mk-practical" data-sid="' + esc(s.id) + '" value="' +
            (hasMark ? s.practicalObtained : '') + '"' + (locked || s.status !== 'present' ? ' disabled' : '') + '></td>' :
          '<td><input type="number" min="0" max="' + data.subject.maxMarks + '" class="form-input mk-num mk-obtained" data-sid="' + esc(s.id) + '" value="' +
            (hasMark ? s.obtained : '') + '"' + (locked || s.status !== 'present' ? ' disabled' : '') + '></td>') +
        '<td class="muted">' + (locked ? (hasMark ? 'Submitted' : 'Read only') : '') + '</td>' +
      '</tr>';
    }).join('');

    const examOptions = usable.map(e => '<option value="' + esc(e.id) + '"' + (e.id === exam.id ? ' selected' : '') + '>' +
      esc(e.name) + ' · ' + esc(e.className) + '</option>').join('');
    const subjectOptions = exam.subjects.map(s => '<option value="' + esc(s.id) + '"' + (s.id === subject.id ? ' selected' : '') + '>' +
      esc(s.name) + (s.code ? ' (' + esc(s.code) + ')' : '') + '</option>').join('');

    el('tpContent').innerHTML =
      pageHead('Marks Entry', 'Enter subject marks for your assigned classes.',
        '<button type="button" class="btn btn-outline" id="mkReload"><i class="fa-solid fa-rotate"></i> Reload</button>') +
      '<section class="tp-card">' +
        '<div class="tp-controls tp-controls-2">' +
          '<div class="form-group"><label class="form-label">Examination</label><select class="form-select" id="mkExam">' + examOptions + '</select></div>' +
          '<div class="form-group"><label class="form-label">Subject</label><select class="form-select" id="mkSubject">' + subjectOptions + '</select></div>' +
        '</div>' +
        '<div class="tp-meta-strip">' +
          '<span><strong>Class</strong> ' + esc(exam.className) + '</span>' +
          '<span><strong>Max marks</strong> ' + data.subject.maxMarks + '</span>' +
          '<span><strong>Pass marks</strong> ' + data.subject.passMarks + '</span>' +
          '<span><strong>Status</strong> ' + esc(exam.status) + '</span>' +
        '</div>' +
        (!canEnter ? '<div class="tp-banner tp-banner-info"><i class="fa-solid fa-lock"></i><span>Marks entry is disabled. You can review saved marks only.</span></div>' :
          (!can('editMarks') ? '<div class="tp-banner tp-banner-info"><i class="fa-solid fa-lock"></i><span>New marks can be entered. Submitted marks are locked because edit permission is not enabled.</span></div>' : '')) +
        '<div class="table-scroll"><table class="data-table tp-table"><thead><tr><th>#</th><th>Roll</th><th>Student</th><th>Status</th>' +
          (combined ? '<th>Theory /' + data.subject.theoryMax + '</th><th>Practical /' + data.subject.practicalMax + '</th>' : '<th>Obtained /' + data.subject.maxMarks + '</th>') +
          '<th></th></tr></thead><tbody id="mkBody">' +
          (rows || '<tr><td colspan="7" class="muted">No students in this class.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="tp-form-foot"><span class="muted">Blank = not entered; absent is counted in the maximum but scores zero.</span>' +
          (canEnter ? '<button type="button" class="btn btn-primary" id="mkSave"><i class="fa-solid fa-floppy-disk"></i> Save marks</button>' : '') + '</div>' +
      '</section>';

    el('mkExam').addEventListener('change', e => {
      views.marks.examId = e.target.value;
      views.marks.subjectId = '';
      renderTab();
    });
    el('mkSubject').addEventListener('change', e => {
      views.marks.subjectId = e.target.value;
      renderTab();
    });
    el('mkReload').addEventListener('click', () => {
      loadExams(true).then(() => renderTab()).catch(err => toast(err.message, 'error'));
    });

    const body = el('mkBody');
    function toggleNumber(sel) {
      const row = sel.closest('tr');
      const present = sel.value === 'present';
      row.querySelectorAll('.mk-num').forEach(input => { input.disabled = !present || input.dataset.locked === '1'; });
      if (!present) row.querySelectorAll('.mk-num').forEach(input => { input.value = ''; });
    }
    if (body) {
      body.querySelectorAll('.mk-status').forEach(sel => {
        if (sel.disabled) return;
        sel.addEventListener('change', () => toggleNumber(sel));
        toggleNumber(sel);
      });
    }

    const saveButton = el('mkSave');
    if (saveButton) saveButton.addEventListener('click', async () => {
      const marks = [];
      let problem = '';
      body.querySelectorAll('tr[data-mrow]').forEach(tr => {
        if (problem) return;
        const sel = tr.querySelector('.mk-status');
        if (!sel || sel.disabled) return;
        const status = sel.value;
        if (!status) return;
        const sid = tr.dataset.mrow;
        const theory = tr.querySelector('.mk-theory');
        const practical = tr.querySelector('.mk-practical');
        const obtained = tr.querySelector('.mk-obtained');
        const row = { studentId: sid, status: status };
        if (status === 'present') {
          if (combined) {
            const t = Number(theory.value || 0);
            const p = Number(practical.value || 0);
            if (theory.value === '' || practical.value === '') { problem = 'Enter both theory and practical marks.'; return; }
            if (t < 0 || t > data.subject.theoryMax || p < 0 || p > data.subject.practicalMax) {
              problem = 'Marks must be within the allowed theory and practical ranges.'; return;
            }
            row.theoryObtained = t;
            row.practicalObtained = p;
          } else {
            const value = obtained.value;
            if (value === '') { problem = 'Enter marks for every present student.'; return; }
            const n = Number(value);
            if (n < 0 || n > data.subject.maxMarks) { problem = 'Marks must be within the allowed range.'; return; }
            row.obtained = n;
          }
        }
        marks.push(row);
      });
      if (problem) return toast(problem, 'warning');
      if (!marks.length) return toast('No marks to save. Choose a status first.', 'warning');
      const btn = el('mkSave');
      btn.classList.add('is-loading');
      try {
        await api('teacher/exams/' + encodeURIComponent(exam.id) + '/marks', {
          method: 'POST', body: { subjectId: subject.id, marks: marks }
        });
        toast('Marks saved successfully.', 'success');
        examsCache = null;
        renderTab();
      } catch (err) {
        toast(err.message, 'error');
        btn.classList.remove('is-loading');
      }
    });
  }

  async function renderResults(seq) {
    if (!can('viewResults')) {
      el('tpContent').innerHTML = pageHead('Results', 'Review computed examination results.') +
        emptyState('fa-lock', 'Results access is disabled', 'Ask the Super Admin to enable result viewing.');
      return;
    }
    const exams = await loadExams();
    if (seq !== renderSeq) return;
    if (!exams.length) {
      el('tpContent').innerHTML = pageHead('Results', 'Review computed examination results.') +
        emptyState('fa-file-circle-xmark', 'No examinations available', 'No examination is assigned to your classes.');
      return;
    }
    const v = views.results;
    if (!exams.some(e => e.id === v.examId)) v.examId = exams[0].id;
    const exam = exams.find(e => e.id === v.examId) || exams[0];
    let data;
    try {
      data = await api('teacher/results?examId=' + encodeURIComponent(exam.id));
    } catch (err) {
      el('tpContent').innerHTML = pageHead('Results', 'Review computed examination results.') +
        emptyState('fa-triangle-exclamation', 'Results unavailable', err.message);
      return;
    }
    if (seq !== renderSeq) return;
    const rows = data.rows || [];
    const pass = rows.filter(r => r.result.result === 'Pass').length;
    const fail = rows.filter(r => r.result.result === 'Fail').length;
    const incomplete = rows.filter(r => r.result.result === 'Incomplete').length;
    const examOptions = exams.map(e => '<option value="' + esc(e.id) + '"' + (e.id === exam.id ? ' selected' : '') + '>' +
      esc(e.name) + ' · ' + esc(e.className) + '</option>').join('');
    const publish = can('publishResults') && data.exam.status !== 'published' && data.exam.status !== 'archived';

    el('tpContent').innerHTML =
      pageHead('Results', 'Computed from saved marks using the Examination System result engine.',
        publish ? '<button type="button" class="btn btn-primary" id="resPublish"><i class="fa-solid fa-bullhorn"></i> Publish results</button>' : '') +
      '<section class="tp-card">' +
        '<div class="tp-controls tp-controls-2">' +
          '<div class="form-group"><label class="form-label">Examination</label><select class="form-select" id="resExam">' + examOptions + '</select></div>' +
          '<div class="tp-form-static"><span class="badge badge-blue">' + esc(data.exam.status) + '</span>' +
            '<span class="muted">' + esc(data.exam.className) + ' · Result date ' + esc(fmtDate(data.exam.resultDate)) + '</span></div>' +
        '</div>' +
        '<div class="tp-mini-stats">' +
          '<span><strong>' + rows.length + '</strong> Students</span>' +
          '<span class="ok"><strong>' + pass + '</strong> Pass</span>' +
          '<span class="bad"><strong>' + fail + '</strong> Fail</span>' +
          '<span class="warn"><strong>' + incomplete + '</strong> Incomplete</span>' +
        '</div>' +
        '<div class="table-scroll"><table class="data-table tp-table"><thead><tr><th>Pos.</th><th>Roll</th><th>Student</th><th>Total</th><th>%</th><th>Grade</th><th>Result</th><th>Subjects</th><th></th></tr></thead><tbody>' +
          (rows.length ? rows.map(r =>
            '<tr><td class="num">' + (r.position || '—') + '</td><td class="num">' + esc(r.student.rollNo) +
            '</td><td class="td-main">' + esc(r.student.name) + '<small>' + esc(r.student.studentId) + '</small></td>' +
            '<td class="num">' + r.result.totalObtained + ' / ' + r.result.totalMax + '</td>' +
            '<td class="num">' + r.result.percentage + '%</td><td>' + esc(r.result.grade || '—') + '</td>' +
            '<td><span class="tp-result ' + resultClass(r.result.result) + '">' + esc(r.result.result) + '</span></td>' +
            '<td><details class="tp-details"><summary>View</summary><div class="tp-detail-pop">' +
              r.result.rows.map(s => '<div><span>' + esc(s.name) + '</span><b>' + esc(s.result) + '</b><small>' +
                s.obtained + ' / ' + s.max + (s.grade ? ' · ' + esc(s.grade) : '') + '</small></div>').join('') +
            '</div></details></td>' +
            '<td>' + (can('generateDmc') ? '<button type="button" class="btn btn-outline btn-sm" data-dmc-student="' + esc(r.student.id) + '"><i class="fa-solid fa-file-certificate"></i></button>' : '') + '</td></tr>'
          ).join('') : '<tr><td colspan="9" class="muted">No students in this class.</td></tr>') +
        '</tbody></table></div>' +
      '</section>';

    el('resExam').addEventListener('change', e => {
      views.results.examId = e.target.value;
      renderTab();
    });
    el('tpContent').querySelectorAll('[data-dmc-student]').forEach(btn => {
      btn.addEventListener('click', () => {
        views.dmc.examId = exam.id;
        views.dmc.studentId = btn.dataset.dmcStudent;
        window.location.hash = 'dmc';
      });
    });
    if (publish) {
      el('resPublish').addEventListener('click', async () => {
        if (!window.confirm('Publish results for ' + data.exam.name + '? Students will be able to receive DMCs.')) return;
        try {
          await api('teacher/exams/' + encodeURIComponent(exam.id) + '/publish', { method: 'POST' });
          toast('Results published.', 'success');
          examsCache = null;
          renderTab();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  }

  function resultClass(result) {
    if (result === 'Pass') return 'ok';
    if (result === 'Fail') return 'bad';
    if (result === 'Incomplete') return 'warn';
    return 'neutral';
  }

  async function renderDmc(seq) {
    if (!can('viewResults') || !can('generateDmc')) {
      el('tpContent').innerHTML = pageHead('Print DMC', 'Generate a Detailed Marks Certificate from saved results.') +
        emptyState('fa-lock', 'DMC access is disabled', 'Ask the Super Admin to enable DMC generation.');
      return;
    }
    const exams = await loadExams();
    if (seq !== renderSeq) return;
    const usable = exams.filter(e => e.status === 'published' || e.status === 'completed' || e.status === 'ongoing');
    if (!usable.length) {
      el('tpContent').innerHTML = pageHead('Print DMC', 'Generate a Detailed Marks Certificate from saved results.') +
        emptyState('fa-file-circle-xmark', 'No eligible examinations', 'DMC generation is available for published or completed examinations.');
      return;
    }
    const v = views.dmc;
    if (!usable.some(e => e.id === v.examId)) v.examId = usable[0].id;
    const exam = usable.find(e => e.id === v.examId) || usable[0];
    let data;
    try {
      data = await api('teacher/results?examId=' + encodeURIComponent(exam.id));
    } catch (err) {
      el('tpContent').innerHTML = pageHead('Print DMC', 'Generate a Detailed Marks Certificate from saved results.') +
        emptyState('fa-triangle-exclamation', 'Results unavailable', err.message);
      return;
    }
    if (seq !== renderSeq) return;
    const rows = data.rows || [];
    if (!rows.some(r => r.student.id === v.studentId || String(r.student.studentId) === v.studentId)) {
      v.studentId = rows[0] ? rows[0].student.id : '';
    }
    const examOptions = usable.map(e => '<option value="' + esc(e.id) + '"' + (e.id === exam.id ? ' selected' : '') + '>' +
      esc(e.name) + ' · ' + esc(e.className) + '</option>').join('');
    const studentOptions = rows.length ? rows.map(r => '<option value="' + esc(r.student.id) + '"' +
      ((r.student.id === v.studentId) ? ' selected' : '') + '>' + esc(r.student.name) + ' · ' + esc(r.student.studentId) + '</option>').join('') : '';

    el('tpContent').innerHTML =
      pageHead('Print DMC', 'One student at a time, built from saved marks and examination settings.') +
      '<section class="tp-card">' +
        '<div class="tp-controls tp-controls-2">' +
          '<div class="form-group"><label class="form-label">Examination</label><select class="form-select" id="dmcExam">' + examOptions + '</select></div>' +
          '<div class="form-group"><label class="form-label">Student</label><select class="form-select" id="dmcStudent">' + (studentOptions || '<option value="">No students</option>') + '</select></div>' +
        '</div>' +
        '<div class="tp-dmc-actions">' +
          '<div class="tp-banner tp-banner-info"><i class="fa-solid fa-circle-info"></i><span>The DMC uses only saved marks. Blank marks appear as Not Entered and cannot be published as a complete result.</span></div>' +
          '<button type="button" class="btn btn-primary" id="dmcGenerate"' + (rows.length ? '' : ' disabled') + '><i class="fa-solid fa-file-certificate"></i> Preview DMC</button>' +
        '</div>' +
      '</section>' +
      '<section class="tp-card tp-card-muted">' +
        '<div class="tp-card-head"><div><h2>How the DMC is built</h2><p>Configuration comes from Examination Settings.</p></div></div>' +
        '<ul class="tp-help-list">' +
          '<li>College name, address, phone, email and website come from college settings.</li>' +
          '<li>Registration number uses the configured registration prefix plus the Student ID.</li>' +
          '<li>Subjects, maximum marks and pass marks come from the examination snapshot.</li>' +
          '<li>Signatures and stamp labels come from Examination Settings; no signature images are generated.</li>' +
        '</ul>' +
      '</section>';

    el('dmcExam').addEventListener('change', e => {
      views.dmc.examId = e.target.value;
      views.dmc.studentId = '';
      renderTab();
    });
    el('dmcStudent').addEventListener('change', e => { views.dmc.studentId = e.target.value; });
    el('dmcGenerate').addEventListener('click', async () => {
      const sid = el('dmcStudent').value;
      if (!sid) return toast('Choose a student.', 'warning');
      try {
        const result = await api('teacher/dmc/' + encodeURIComponent(exam.id) + '/' + encodeURIComponent(sid));
        dmcData = result.dmc;
        el('tpDmcPreview').innerHTML = dmcHtml(dmcData);
        el('tpDmcModal').classList.add('open');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function dmcHtml(d) {
    const college = d.college || {};
    const settings = d.settings || {};
    const labels = Array.isArray(settings.signatures) && settings.signatures.length
      ? settings.signatures : ['Teacher', 'Principal'];
    const rows = (d.rows || []).map((row, i) =>
      '<tr><td>' + (i + 1) + '</td><td>' + esc(row.name) + '</td><td>' + row.max + '</td><td>' + row.obtained +
      '</td><td>' + esc(row.grade || '—') + '</td><td>' + esc(row.remark || row.result || '—') + '</td></tr>'
    ).join('');
    return '<article class="tp-dmc-doc">' +
      '<header class="tp-dmc-head"><img src="assets/logo.png" alt="">' +
        '<div><h1>' + esc((college.name || 'Muslim Commerce College Peshawar').toUpperCase()) + '</h1>' +
        '<h2>DETAILED MARKS CERTIFICATE</h2>' +
        '<p>' + esc([college.address, college.phone, college.email, college.website].filter(Boolean).join(' · ')) + '</p></div>' +
      '</header>' +
      '<div class="tp-dmc-meta">' +
        '<span><b>Academic Session</b>' + esc(d.exam.academicYear || '—') + '</span>' +
        '<span><b>Examination</b>' + esc(d.exam.name) + '</span>' +
        '<span><b>Class</b>' + esc(d.exam.className) + '</span>' +
        '<span><b>Result Date</b>' + esc(fmtDate(d.exam.resultDate)) + '</span>' +
        '<span><b>DMC No.</b>' + esc(d.dmcNo) + '</span>' +
      '</div>' +
      '<table class="tp-dmc-info"><tbody>' +
        '<tr><th>Student Name</th><td>' + esc(d.student.name) + '</td><th>Father Name</th><td>' + esc(d.student.fatherName) + '</td></tr>' +
        '<tr><th>Student ID</th><td>' + esc(d.student.studentId) + '</td><th>Roll No.</th><td>' + esc(d.student.rollNo) + '</td></tr>' +
        '<tr><th>Class / Section</th><td>' + esc(d.student.className) + (d.student.section ? ' / ' + esc(d.student.section) : '') + '</td><th>Registration</th><td>' + esc(d.student.registration) + '</td></tr>' +
      '</tbody></table>' +
      '<table class="tp-dmc-marks"><thead><tr><th>S.No.</th><th>Subject</th><th>Max</th><th>Obtained</th><th>Grade</th><th>Remarks</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tp-dmc-summary">' +
        '<div><span>Total Maximum</span><strong>' + d.totalMax + '</strong></div>' +
        '<div><span>Total Obtained</span><strong>' + d.totalObtained + '</strong></div>' +
        '<div><span>Percentage</span><strong>' + d.percentage + '%</strong></div>' +
        '<div><span>Grade</span><strong>' + esc(d.grade || '—') + '</strong></div>' +
        '<div><span>Result</span><strong>' + esc(d.result) + '</strong></div>' +
        '<div><span>Class Position</span><strong>' + (d.position || '—') + '</strong></div>' +
      '</div>' +
      '<p class="tp-dmc-note">' + esc(settings.dmcNote || '') + '</p>' +
      '<div class="tp-dmc-sign">' +
        labels.map(label => '<div><span></span><small>' + esc(label) + '</small></div>').join('') +
        '<div class="tp-dmc-stamp"><span>' + esc(settings.stampLabel || 'Official Stamp') + '</span></div>' +
      '</div>' +
      '<div class="tp-dmc-foot">Printed from the Muslim Commerce College Teacher Portal · ' + esc(fmtDateTime(new Date().toISOString())) + '</div>' +
    '</article>';
  }

  function printHtml(html) {
    const area = el('tpPrintArea');
    if (!area) return;
    area.innerHTML = html;
    document.body.classList.add('tp-printing');
    const cleanup = () => {
      document.body.classList.remove('tp-printing');
      area.innerHTML = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(() => {
      if (document.body.classList.contains('tp-printing')) cleanup();
    }, 1500);
  }

  async function renderPlanner(seq) {
    if (!can('viewPlanner')) {
      el('tpContent').innerHTML = pageHead('Academic Planner', 'Examination dates and academic events.') +
        emptyState('fa-lock', 'Planner access is disabled', 'Ask the Super Admin to enable planner viewing.');
      return;
    }
    const data = await api('teacher/planner');
    if (seq !== renderSeq) return;
    const events = data.events || [];
    const groups = new Map();
    events.forEach(event => {
      const key = String(event.date || '').slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    });
    el('tpContent').innerHTML =
      pageHead('Academic Planner', 'Your examination schedule and academic dates.') +
      (events.length ? '<div class="tp-planner">' + Array.from(groups.entries()).map(([month, rows]) =>
        '<section class="tp-month"><h2>' + esc(monthLabel(month)) + '</h2>' + rows.map(event =>
          '<div class="tp-plan-row"><span class="tp-plan-date">' + esc(fmtDate(event.date)) + '</span>' +
            '<span><strong>' + esc(event.title) + '</strong><small>' + esc(event.exam || event.className) +
            ' · ' + esc(event.className) + '</small></span>' +
            '<span class="tp-chip">' + esc(event.status || 'exam') + '</span></div>'
        ).join('') + '</section>'
      ).join('') + '</div>' : emptyState('fa-calendar-xmark', 'No planner dates', 'No examination schedule has been published for your classes yet.'));
  }

  function profilePhotoHtml() {
    const src = photoDraft || teacher.photo;
    return src ? '<img src="' + esc(src) + '" alt="">' : esc(initials(teacher.fullName));
  }

  async function renderProfile(seq) {
    const perms = (meta.permissionsList || []).length ? meta.permissionsList : Object.keys(meta.permissions || {});
    const labels = {
      viewStudents: 'View students', takeAttendance: 'Take attendance', editAttendance: 'Edit attendance',
      viewAttendanceReports: 'Attendance reports', enterMarks: 'Enter marks', editMarks: 'Edit marks',
      viewResults: 'View results', publishResults: 'Publish results', generateDmc: 'Generate DMC', viewPlanner: 'View planner'
    };
    photoDraft = teacher.photo || '';
    el('tpContent').innerHTML =
      pageHead('My Profile', 'Your account details and assigned responsibilities.',
        '<button type="button" class="btn btn-outline" id="profilePassword"><i class="fa-solid fa-key"></i> Change password</button>') +
      '<div class="tp-grid-2">' +
        '<section class="tp-card">' +
          '<div class="tp-profile-head"><span class="tp-avatar tp-avatar-xl" id="profileAvatar">' + profilePhotoHtml() + '</span>' +
            '<div><h2>' + esc(teacher.fullName) + '</h2><p>' + esc(teacher.designation || 'Teacher') + ' · ' + esc(teacher.portalNumber) + '</p></div></div>' +
          '<dl class="tp-dl">' +
            '<div><dt>Father name</dt><dd>' + esc(teacher.fatherName || '—') + '</dd></div>' +
            '<div><dt>Username</dt><dd>' + esc(teacher.username || '—') + '</dd></div>' +
            '<div><dt>Email</dt><dd>' + esc(teacher.email || '—') + '</dd></div>' +
            '<div><dt>Contact</dt><dd>' + esc(teacher.contact || '—') + '</dd></div>' +
            '<div><dt>Qualification</dt><dd>' + esc(teacher.qualification || '—') + '</dd></div>' +
            '<div><dt>Academic session</dt><dd>' + esc(teacher.academicSession || '—') + '</dd></div>' +
            '<div><dt>Last sign-in</dt><dd>' + esc(fmtDateTime(teacher.lastLoginAt)) + '</dd></div>' +
          '</dl>' +
          '<div class="tp-section-label">Assigned classes</div><div class="tp-chips">' +
            (meta.classes || []).map(c => '<span class="tp-chip">' + esc(c) + '</span>').join('') + '</div>' +
          '<div class="tp-section-label">Assigned subjects</div><div class="tp-chips">' +
            (meta.subjects || []).map(s => '<span class="tp-chip">' + esc(s.name) + '</span>').join('') + '</div>' +
          '<div class="tp-section-label">Permissions</div><div class="tp-chips">' +
            (Object.keys(meta.permissions || {})).map(key => '<span class="tp-chip ' + (meta.permissions[key] ? 'on' : '') + '">' +
              esc(labels[key] || key) + '</span>').join('') + '</div>' +
        '</section>' +
        '<section class="tp-card">' +
          '<div class="tp-card-head"><div><h2>Update contact details</h2><p>Name, classes, subjects and permissions are managed by the Super Admin.</p></div></div>' +
          '<form id="profileForm" class="tp-form">' +
            '<div class="tp-photo-edit"><span class="tp-avatar tp-avatar-xl" id="profileAvatar2">' + profilePhotoHtml() + '</span>' +
              '<div><input type="file" id="profilePhoto" accept="image/png,image/jpeg,image/webp" class="form-input">' +
              '<button type="button" class="btn btn-outline btn-sm mt-8" id="profilePhotoRemove">Remove photo</button></div></div>' +
            '<div class="form-group"><label class="form-label" for="pfEmail">Email</label><input class="form-input" type="email" id="pfEmail" value="' + esc(teacher.email) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="pfContact">Contact number</label><input class="form-input" id="pfContact" value="' + esc(teacher.contact) + '"></div>' +
            '<div class="form-group"><label class="form-label" for="pfQualification">Qualification</label><input class="form-input" id="pfQualification" value="' + esc(teacher.qualification) + '"></div>' +
            '<button type="submit" class="btn btn-primary" id="pfSave"><i class="fa-solid fa-floppy-disk"></i> Save profile</button>' +
          '</form>' +
        '</section>' +
      '</div>';
    el('profilePassword').addEventListener('click', () => openPassword(false));
    function refreshAvatars() {
      ['profileAvatar', 'profileAvatar2'].forEach(id => {
        const node = el(id);
        if (node) node.innerHTML = profilePhotoHtml();
      });
    }
    el('profilePhoto').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return toast('Choose an image under 2 MB.', 'warning');
      try {
        const data = await readPhoto(file);
        if (data.length > 700000) return toast('The resized photograph is still too large.', 'warning');
        photoDraft = data;
        refreshAvatars();
      } catch (err) { toast(err.message, 'error'); }
    });
    el('profilePhotoRemove').addEventListener('click', () => {
      photoDraft = '';
      refreshAvatars();
    });
    el('profileForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = el('pfSave');
      btn.classList.add('is-loading');
      try {
        const result = await api('teacher/profile', {
          method: 'PUT',
          body: {
            email: el('pfEmail').value.trim(),
            contact: el('pfContact').value.trim(),
            qualification: el('pfQualification').value.trim(),
            photo: photoDraft
          }
        });
        teacher = result.teacher;
        session.teacher = teacher;
        persistSession();
        toast('Profile updated.', 'success');
        renderChrome();
        renderTab();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.classList.remove('is-loading');
      }
    });
  }

  function readPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the photograph.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('The selected file is not a valid image.'));
        img.onload = () => {
          const max = 320;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function renderTab() {
    const seq = ++renderSeq;
    const current = window.location.hash.replace(/^#/, '') || 'overview';
    const allowed = allowedTabs().map(t => t.id);
    tab = allowed.includes(current) ? current : (allowed.includes(tab) ? tab : 'overview');
    if (current !== tab) {
      window.location.hash = tab;
    }
    renderChrome();
    loading();
    try {
      if (tab === 'overview') await renderOverview(seq);
      else if (tab === 'attendance') await renderAttendance(seq);
      else if (tab === 'marks') await renderMarks(seq);
      else if (tab === 'results') await renderResults(seq);
      else if (tab === 'dmc') await renderDmc(seq);
      else if (tab === 'planner') await renderPlanner(seq);
      else if (tab === 'profile') await renderProfile(seq);
    } catch (err) {
      if (seq !== renderSeq) return;
      el('tpContent').innerHTML = pageHead('Teacher Portal', 'Something could not be loaded.') +
        emptyState('fa-triangle-exclamation', 'Could not load this section', err.message);
    }
  }

  function openPassword(forced) {
    el('tpPasswordIntro').textContent = forced
      ? 'Your account uses a temporary password. Set a new password to continue.'
      : 'Choose a strong password with at least 8 characters, including a letter and a number.';
    el('tpCurrentPassword').value = '';
    el('tpNewPassword').value = '';
    el('tpConfirmPassword').value = '';
    const close = el('tpPasswordClose');
    const cancel = el('tpPasswordCancel');
    if (close) close.style.display = forced ? 'none' : '';
    if (cancel) cancel.style.display = forced ? 'none' : '';
    el('tpPasswordModal').classList.add('open');
    setTimeout(() => el('tpCurrentPassword').focus(), 80);
  }

  async function changePassword(e) {
    e.preventDefault();
    const current = el('tpCurrentPassword').value;
    const next = el('tpNewPassword').value;
    const confirm = el('tpConfirmPassword').value;
    if (!current || !next || !confirm) return toast('Complete all password fields.', 'warning');
    if (next !== confirm) return toast('The new passwords do not match.', 'warning');
    if (next.length < 8) return toast('Use at least 8 characters.', 'warning');
    const btn = el('tpPasswordSave');
    btn.classList.add('is-loading');
    try {
      const result = await api('teacher/auth/change-password', {
        method: 'POST', body: { currentPassword: current, newPassword: next }
      });
      session.token = result.token;
      session.expiresAt = result.expiresAt;
      session.teacher = result.teacher;
      session.mustChangePassword = false;
      persistSession();
      teacher = result.teacher;
      mustChangePassword = false;
      el('tpPasswordModal').classList.remove('open');
      toast('Password updated.', 'success');
      renderChrome();
      renderTab();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.classList.remove('is-loading');
    }
  }

  async function logout() {
    try { await api('teacher/auth/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
    goLogin();
  }

  function bind() {
    el('tpMenuBtn').addEventListener('click', openMenu);
    el('tpBackdrop').addEventListener('click', closeMenu);
    el('tpPasswordForm').addEventListener('submit', changePassword);
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const backdrop = btn.closest('.modal-backdrop');
        if (backdrop && !(backdrop.id === 'tpPasswordModal' && mustChangePassword)) {
          backdrop.classList.remove('open');
        }
      });
    });
    el('tpDmcPrintBtn').addEventListener('click', () => {
      if (dmcData) printHtml(dmcHtml(dmcData));
    });
    window.addEventListener('hashchange', renderTab);
  }

  async function boot() {
    session = readSession();
    if (!session || !session.token) return goLogin();
    if (session.expiresAt && session.expiresAt < Date.now()) return goLogin();
    if (!navigator.onLine) {
      el('tpContent').innerHTML = emptyState('fa-wifi', 'You are offline', 'The Teacher Portal needs a connection to the secure server.');
      return;
    }
    try {
      const data = await api('teacher/me');
      teacher = data.teacher;
      meta = data.meta;
      mustChangePassword = !!data.mustChangePassword;
      session.teacher = teacher;
      session.mustChangePassword = mustChangePassword;
      persistSession();
      if (mustChangePassword) openPassword(true);
      bind();
      renderChrome();
      await renderTab();
    } catch (err) {
      if (err.status === 401) return;
      el('tpContent').innerHTML = pageHead('Teacher Portal', 'Could not start the portal.') +
        emptyState('fa-server', 'Connection problem', err.message);
    }
  }

  boot();
})();
