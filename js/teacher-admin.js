'use strict';

(function () {
  const state = {
    page: document.body.dataset.page || '',
    meta: null,
    stats: null,
    teachers: [],
    editing: null,
    portalTeacher: null,
    photo: '',
    pageNo: 1,
    pages: 1,
    limit: 20,
    q: '',
    status: '',
    className: '',
    searchTimer: null,
    redirecting: false
  };

  const PERMISSION_LABELS = {
    viewStudents: ['View students', 'See students in assigned classes only'],
    takeAttendance: ['Take attendance', 'Submit a new class attendance sheet'],
    editAttendance: ['Edit submitted attendance', 'Change a sheet already submitted'],
    viewAttendanceReports: ['Attendance reports', 'Review attendance history'],
    enterMarks: ['Enter marks', 'Submit marks for assigned subjects'],
    editMarks: ['Edit submitted marks', 'Change marks already saved'],
    viewResults: ['View results', 'See computed examination results'],
    publishResults: ['Publish results', 'Change an examination to published'],
    generateDmc: ['Generate DMC', 'Preview and print a student DMC'],
    viewPlanner: ['View planner', 'See examination dates and academic events']
  };

  const SABIH_PRESET = {
    fullName: 'Sabih ud din',
    portalNumber: 'TCH-0001',
    className: '1st Year Computer Science',
    subjectName: 'Urdu',
    permissions: {
      viewStudents: true,
      takeAttendance: true,
      editAttendance: false,
      viewAttendanceReports: true,
      enterMarks: true,
      editMarks: false,
      viewResults: true,
      publishResults: false,
      generateDmc: true,
      viewPlanner: true
    }
  };

  function api() {
    if (!window.MCA_API || !MCA_API.admin) return null;
    if (typeof MCA_API.isAvailable === 'function' && !MCA_API.isAvailable()) return null;
    return MCA_API.admin;
  }

  function el(id) { return document.getElementById(id); }

  function esc(value) { return Utils.esc(value == null ? '' : value); }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(part => part[0].toUpperCase()).join('');
  }

  function fmtDateTime(value) {
    if (!value) return 'Never';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function friendlyError(err) {
    const status = Number(err && err.status) || 0;
    if (status === 404) {
      return 'The administration API was not found. Start the bundled backend with "node server.js" and open http://127.0.0.1:3000. If this site is deployed, route /api/* to server.js.';
    }
    if (status === 401) return 'Your Super Admin session has expired. Sign in again.';
    if (status === 403) return 'Access denied. Sign in with a Super Admin account.';
    if (status >= 500) return 'The administration service could not complete the request. Check the server logs and try again.';
    if (!status) return 'The administration service is unavailable. Start server.js and try again.';
    return (err && err.message) || 'Could not complete the administration request.';
  }

  function expireSession() {
    if (state.redirecting) return;
    state.redirecting = true;
    UI.toast('Your Super Admin session has expired. Sign in again.', 'error', 'Session expired');
    try { localStorage.removeItem('mca_session'); } catch (err) { /* ignore */ }
    try { sessionStorage.removeItem('mca_session_temp'); } catch (err) { /* ignore */ }
    if (window.MCA_API) MCA_API.logout();
    setTimeout(() => { window.location.replace('index.html?error=session'); }, 900);
  }

  function showError(err) {
    if (err && Number(err.status) === 401) {
      expireSession();
      return;
    }
    const status = Number(err && err.status) || 0;
    const title = status === 403 ? 'Access denied'
      : status === 404 ? 'Administration API'
        : status >= 500 ? 'Server error' : 'Administration';
    UI.toast(friendlyError(err), 'error', title);
  }

  function renderUnavailable(host, err) {
    if (!host) return;
    host.innerHTML = '<div class="ta-empty"><i class="fa-solid fa-server"></i><p>' +
      esc(friendlyError(err)) + '</p></div>';
  }

  function statCard(label, value, note) {
    return '<div class="ta-stat"><span>' + esc(label) + '</span><strong>' + esc(value) +
      '</strong><small>' + esc(note || '') + '</small></div>';
  }

  function renderStats(host, stats) {
    if (!host) return;
    host.innerHTML =
      statCard('Teacher accounts', stats.teachers, stats.active + ' active · ' + stats.disabled + ' disabled') +
      statCard('Reset requests', stats.resetRequests, stats.resetRequests ? 'Needs attention' : 'No pending requests') +
      statCard('Teacher sheets today', stats.teacherSheetsToday, stats.todaySheets + ' attendance sheets today') +
      statCard('Students', stats.students, stats.classes + ' classes · ' + stats.subjects + ' subjects') +
      statCard('Attendance records', stats.attendanceRecords, 'Stored on the server');
  }

  function fillSelect(host, options, selected) {
    if (!host) return;
    host.innerHTML = options.map(opt => {
      const value = typeof opt === 'string' ? opt : opt.value;
      const label = typeof opt === 'string' ? opt : opt.label;
      return '<option value="' + esc(value) + '"' + (String(value) === String(selected || '') ? ' selected' : '') + '>' +
        esc(label) + '</option>';
    }).join('');
  }

  function classMeta() {
    return (state.meta && state.meta.classes) || [];
  }

  function subjectMeta() {
    return (state.meta && state.meta.subjects) || [];
  }

  function selectedClasses() {
    return Array.from(document.querySelectorAll('#tfClasses input[type=checkbox]:checked')).map(x => x.value);
  }

  function selectedSubjects() {
    return Array.from(document.querySelectorAll('#tfSubjects input[type=checkbox]:checked')).map(x => x.value);
  }

  function selectedPermissions() {
    const out = {};
    (state.meta.permissions || []).forEach(key => {
      const box = document.querySelector('#tfPermissions input[data-perm="' + key + '"]');
      out[key] = !!(box && box.checked);
    });
    return out;
  }

  function renderClasses(selected) {
    const host = el('tfClasses');
    if (!host) return;
    const selectedSet = new Set(selected || []);
    host.innerHTML = classMeta().map(cls => {
      const name = cls.name || '';
      return '<label class="ta-field-check' + (selectedSet.has(name) ? ' is-on' : '') + '">' +
        '<input type="checkbox" value="' + esc(name) + '"' + (selectedSet.has(name) ? ' checked' : '') + '>' +
        '<span><strong>' + esc(name) + '</strong><small>' +
        ((cls.sections || []).length ? 'Sections: ' + esc(cls.sections.join(', ')) : 'Section-less class') +
        '</small></span></label>';
    }).join('') || '<p class="muted">No classes available.</p>';
    host.querySelectorAll('input').forEach(box => {
      box.addEventListener('change', () => {
        box.closest('label').classList.toggle('is-on', box.checked);
        renderSubjects(selectedSubjects());
      });
    });
  }

  function renderSubjects(selected) {
    const host = el('tfSubjects');
    if (!host) return;
    const classes = new Set(selectedClasses());
    const chosen = new Set(selected || []);
    const groups = new Map();
    subjectMeta().forEach(sub => {
      if (!sub || (sub.className && classes.size && !classes.has(sub.className))) return;
      const group = sub.className || 'General subjects';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(sub);
    });
    if (!groups.size) {
      host.innerHTML = '<p class="muted">Select at least one class to see its subjects.</p>';
      return;
    }
    host.innerHTML = Array.from(groups.entries()).map(([group, subs]) =>
      '<div class="ta-subject-group"><strong>' + esc(group) + '</strong><div class="ta-checks">' +
      subs.map(sub =>
        '<label class="ta-field-check' + (chosen.has(sub.id) ? ' is-on' : '') + '">' +
          '<input type="checkbox" value="' + esc(sub.id) + '"' + (chosen.has(sub.id) ? ' checked' : '') + '>' +
          '<span><strong>' + esc(sub.name) + '</strong><small>' +
          esc((sub.code ? sub.code + ' · ' : '') + (sub.type || 'theory')) +
          '</small></span></label>'
      ).join('') + '</div></div>'
    ).join('');
    host.querySelectorAll('input').forEach(box => {
      box.addEventListener('change', () => box.closest('label').classList.toggle('is-on', box.checked));
    });
  }

  function renderPermissions(selected) {
    const host = el('tfPermissions');
    if (!host) return;
    const chosen = selected || (state.meta && state.meta.defaults) || {};
    host.innerHTML = (state.meta.permissions || []).map(key => {
      const info = PERMISSION_LABELS[key] || [key, ''];
      return '<label class="ta-field-check' + (chosen[key] ? ' is-on' : '') + '">' +
        '<input type="checkbox" data-perm="' + esc(key) + '"' + (chosen[key] ? ' checked' : '') + '>' +
        '<span><strong>' + esc(info[0]) + '</strong><small>' + esc(info[1]) + '</small></span></label>';
    }).join('');
    host.querySelectorAll('input').forEach(box => {
      box.addEventListener('change', () => box.closest('label').classList.toggle('is-on', box.checked));
    });
  }

  function setPhoto(data) {
    state.photo = data || '';
    const wrap = el('tfPhotoPreview');
    const img = el('tfPhotoImg');
    if (wrap && img) {
      wrap.hidden = !state.photo;
      img.src = state.photo || '';
    }
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

  function openTeacherModal(teacher) {
    if (!state.meta) return;
    state.editing = teacher || null;
    state.photo = teacher && teacher.photo ? teacher.photo : '';
    el('teacherModalTitle').textContent = teacher ? 'Edit teacher account' : 'New teacher account';
    el('tfId').value = teacher ? teacher.id : '';
    el('tfFullName').value = teacher ? teacher.fullName || '' : '';
    el('tfFatherName').value = teacher ? teacher.fatherName || '' : '';
    el('tfPortal').value = teacher ? teacher.portalNumber || '' : '';
    el('tfPortal').readOnly = !!teacher;
    el('tfStatus').value = teacher ? teacher.status || 'active' : 'active';
    el('tfUsername').value = teacher ? teacher.username || '' : '';
    el('tfEmail').value = teacher ? teacher.email || '' : '';
    el('tfContact').value = teacher ? teacher.contact || '' : '';
    el('tfDesignation').value = teacher ? teacher.designation || '' : 'Teacher';
    el('tfQualification').value = teacher ? teacher.qualification || '' : '';
    el('tfPassword').value = '';
    el('tfPassword').disabled = !!teacher;
    el('tfPasswordHint').textContent = teacher
      ? 'Use “Reset password” to issue a new one-time password.'
      : 'Leave blank to generate a one-time password.';
    el('tfPhoto').value = '';

    const sessions = (state.meta.sessions || []).map(s => ({ value: s.name, label: s.name + (s.active ? ' (active)' : '') }));
    const defaultSession = teacher ? teacher.academicSession : ((state.meta.sessions || []).find(s => s.active) || {}).name;
    fillSelect(el('tfSession'), sessions, defaultSession);

    const classes = teacher ? teacher.classes || [] : [];
    renderClasses(classes);
    renderSubjects(teacher ? teacher.subjects || [] : []);
    renderPermissions(teacher ? teacher.permissions || {} : state.meta.defaults || {});
    setPhoto(state.photo);
    UI.modal.open('teacherModal');
  }

  function openSabihPresetForm() {
    openTeacherModal(null);
    if (!state.editing) {
      el('teacherModalTitle').textContent = 'New teacher account - Sabih ud din';
      el('tfFullName').value = SABIH_PRESET.fullName;
      el('tfPortal').value = SABIH_PRESET.portalNumber;
      el('tfDesignation').value = '';
      el('tfStatus').value = 'active';
      renderClasses([SABIH_PRESET.className]);
      const subject = subjectMeta().find(s => s && s.active !== false &&
        s.className === SABIH_PRESET.className &&
        String(s.name || '').trim().toLowerCase() === SABIH_PRESET.subjectName.toLowerCase());
      renderSubjects(subject ? [subject.id] : []);
      renderPermissions(SABIH_PRESET.permissions);
      if (!subject) {
        UI.toast('Urdu is not in the subject catalog yet. Refresh the page after the server prepares it.', 'warning');
      } else {
        UI.toast('Details prefilled. Review and save to create the account.', 'success');
      }
    }
  }

  async function openSabihPreset() {
    const client = api();
    if (!client) return;
    try {
      const result = await client.teachers({ q: SABIH_PRESET.portalNumber, limit: 10 });
      const existing = (result.rows || []).find(t =>
        String(t.portalNumber || '').toUpperCase() === SABIH_PRESET.portalNumber);
      if (existing) {
        UI.toast(SABIH_PRESET.portalNumber + ' is already assigned to ' + existing.fullName + '.', 'warning');
        const detail = await client.teacher(existing.id);
        openTeacherModal(detail.teacher);
        return;
      }
    } catch (err) {
      showError(err);
      return;
    }
    openSabihPresetForm();
  }

  function teacherPayload() {
    return {
      fullName: el('tfFullName').value.trim(),
      fatherName: el('tfFatherName').value.trim(),
      portalNumber: el('tfPortal').value.trim(),
      status: el('tfStatus').value,
      username: el('tfUsername').value.trim(),
      email: el('tfEmail').value.trim(),
      contact: el('tfContact').value.trim(),
      designation: el('tfDesignation').value.trim(),
      qualification: el('tfQualification').value.trim(),
      academicSession: el('tfSession').value,
      classes: selectedClasses(),
      subjects: selectedSubjects(),
      permissions: selectedPermissions(),
      photo: state.photo
    };
  }

  async function saveTeacher(e) {
    if (e) e.preventDefault();
    const client = api();
    if (!client) return UI.toast('Start server.js to manage teacher accounts.', 'error');
    const payload = teacherPayload();
    if (!payload.fullName) return UI.toast('Full name is required.', 'warning');
    if (!payload.classes.length) return UI.toast('Assign at least one class.', 'warning');
    if (!payload.subjects.length) return UI.toast('Assign at least one subject.', 'warning');
    if (!state.editing) {
      const pass = el('tfPassword').value;
      if (pass) payload.password = pass;
    }
    const btn = el('tfSave');
    if (btn) btn.classList.add('is-loading');
    try {
      if (state.editing) {
        await client.updateTeacher(state.editing.id, payload);
        UI.toast('Teacher account updated.', 'success');
      } else {
        const result = await client.createTeacher(payload);
        UI.toast('Teacher account created.', 'success');
        if (result.temporaryPassword) showPassword(result.temporaryPassword,
          'Initial password for ' + (result.teacher ? result.teacher.fullName : 'the teacher') + '.');
      }
      UI.modal.close('teacherModal');
      await loadStats();
      await loadTeachers();
    } catch (err) {
      showError(err);
    } finally {
      if (btn) btn.classList.remove('is-loading');
    }
  }

  function showPassword(password, text) {
    el('passwordModalText').textContent = text || 'Temporary password';
    el('passwordSecret').textContent = password;
    UI.modal.open('passwordModal');
  }

  function showPortalModal(teacher) {
    state.portalTeacher = teacher;
    el('portalModalTeacher').textContent = teacher.fullName + ' · current portal ' + teacher.portalNumber;
    el('pmPortal').value = teacher.portalNumber || '';
    el('pmReason').value = '';
    UI.modal.open('portalModal');
  }

  async function savePortal() {
    const client = api();
    if (!client || !state.portalTeacher) return;
    const portal = el('pmPortal').value.trim();
    const reason = el('pmReason').value.trim();
    if (!portal || !reason) return UI.toast('Portal number and reason are required.', 'warning');
    try {
      await client.changePortal(state.portalTeacher.id, portal, reason);
      UI.toast('Portal number changed.', 'success');
      UI.modal.close('portalModal');
      await loadStats();
      await loadTeachers();
    } catch (err) {
      showError(err);
    }
  }

  async function resetPassword(teacher) {
    const client = api();
    if (!client) return;
    const ok = await UI.confirm({
      title: 'Reset teacher password?',
      message: 'A new one-time password will be generated for ' + teacher.fullName + '. Existing sessions will end.',
      detail: 'The teacher must set a new password at their next sign-in.'
    });
    if (!ok) return;
    try {
      const result = await client.resetPassword(teacher.id, 'temporary');
      showPassword(result.temporaryPassword, 'New one-time password for ' + teacher.fullName + '.');
      await loadStats();
      await loadTeachers();
    } catch (err) {
      showError(err);
    }
  }

  async function toggleStatus(teacher, status) {
    const client = api();
    if (!client) return;
    const ok = await UI.confirm({
      title: status === 'disabled' ? 'Disable teacher account?' : 'Reactivate teacher account?',
      message: teacher.fullName + ' (' + teacher.portalNumber + ') will be ' +
        (status === 'disabled' ? 'signed out and blocked from signing in.' : 'able to sign in again.'),
      danger: status === 'disabled'
    });
    if (!ok) return;
    try {
      await client.updateTeacher(teacher.id, { status: status });
      UI.toast(status === 'disabled' ? 'Account disabled.' : 'Account reactivated.', 'success');
      await loadStats();
      await loadTeachers();
    } catch (err) {
      showError(err);
    }
  }

  async function showAudit(teacher) {
    const client = api();
    if (!client) return;
    el('auditModalTitle').textContent = 'Activity · ' + teacher.fullName;
    el('auditBody').innerHTML = '<div class="ta-empty"><i class="fa-solid fa-spinner fa-spin"></i><p>Loading activity...</p></div>';
    UI.modal.open('auditModal');
    try {
      const data = await client.teacherAudit(teacher.id);
      renderAuditRows(el('auditBody'), data.rows || []);
    } catch (err) {
      el('auditBody').innerHTML = '<div class="ta-empty"><i class="fa-solid fa-circle-exclamation"></i><p>' +
        esc(friendlyError(err)) + '</p></div>';
    }
  }

  function renderAuditRows(host, rows) {
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = '<div class="ta-empty"><i class="fa-solid fa-clock-rotate-left"></i><p>No activity recorded yet.</p></div>';
      return;
    }
    host.innerHTML = rows.map(row =>
      '<div class="ta-audit-row">' +
        '<time>' + esc(fmtDateTime(row.at)) + '</time>' +
        '<div><strong class="ta-audit-action">' + esc(row.action) + '</strong>' +
          '<small>' + esc(row.actor || 'system') + (row.details ? ' · ' + esc(row.details) : '') + '</small></div>' +
        '<span class="ta-chip">' + esc(row.target || '—') + '</span>' +
      '</div>'
    ).join('');
  }

  function teacherStatus(t) {
    return '<span class="badge ' + (t.status === 'active' ? 'badge-green' : 'badge-gray') + '">' +
      '<span class="ta-status-dot' + (t.status === 'active' ? '' : ' off') + '"></span>' +
      (t.status === 'active' ? 'Active' : 'Disabled') + '</span>' +
      (t.resetRequestedAt ? '<span class="ta-reset-flag"><i class="fa-solid fa-key"></i> Reset asked</span>' : '');
  }

  function renderTeacherRows() {
    const wrap = el('taTableWrap');
    if (!wrap) return;
    if (!state.teachers.length) {
      wrap.innerHTML = '<div class="ta-empty"><i class="fa-solid fa-user-slash"></i><p>No teacher accounts match these filters.</p></div>';
    } else {
      wrap.innerHTML = '<table class="data-table"><thead><tr>' +
        '<th>Portal</th><th>Teacher</th><th>Assignments</th><th>Status</th><th>Last sign-in</th><th class="ta-right">Actions</th>' +
        '</tr></thead><tbody>' + state.teachers.map(t => {
          const subjectNames = (t.subjects || []).map(s => s.name);
          return '<tr>' +
            '<td><span class="ta-code">' + esc(t.portalNumber) + '</span></td>' +
            '<td><div class="ta-teacher"><span class="ta-avatar">' +
              (t.photo ? '<img src="' + esc(t.photo) + '" alt="">' : esc(initials(t.fullName))) +
              '</span><div><strong>' + esc(t.fullName) + '</strong><small>' +
              esc(t.designation || 'Teacher') + (t.username ? ' · @' + esc(t.username) : '') +
              '</small></div></div></td>' +
            '<td><div class="ta-chips">' +
              (t.classes || []).map(c => '<span class="ta-chip">' + esc(c) + '</span>').join('') +
              (subjectNames.length ? '<span class="ta-chip" title="' + esc(subjectNames.join(', ')) + '">' +
                subjectNames.length + ' subject' + (subjectNames.length === 1 ? '' : 's') + '</span>' : '') +
              '</div></td>' +
            '<td>' + teacherStatus(t) + '</td>' +
            '<td class="muted">' + esc(fmtDateTime(t.lastLoginAt)) + '</td>' +
            '<td class="ta-right"><div class="ta-actions">' +
              '<button type="button" class="btn btn-outline" data-act="edit" data-id="' + esc(t.id) + '" title="Edit"><i class="fa-solid fa-pen"></i></button>' +
              '<button type="button" class="btn btn-outline" data-act="reset" data-id="' + esc(t.id) + '" title="Reset password"><i class="fa-solid fa-key"></i></button>' +
              '<button type="button" class="btn btn-outline" data-act="portal" data-id="' + esc(t.id) + '" title="Change portal number"><i class="fa-solid fa-hashtag"></i></button>' +
              '<button type="button" class="btn btn-outline" data-act="audit" data-id="' + esc(t.id) + '" title="Activity history"><i class="fa-solid fa-clock-rotate-left"></i></button>' +
              '<button type="button" class="btn ' + (t.status === 'active' ? 'btn-outline' : 'btn-primary') + '" data-act="status" data-id="' + esc(t.id) + '" title="' +
                (t.status === 'active' ? 'Disable account' : 'Reactivate account') + '">' +
                '<i class="fa-solid ' + (t.status === 'active' ? 'fa-user-slash' : 'fa-user-check') + '"></i></button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table>';
      wrap.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const teacher = state.teachers.find(t => t.id === btn.dataset.id);
          if (!teacher) return;
          if (btn.dataset.act === 'edit') openTeacherModal(teacher);
          else if (btn.dataset.act === 'reset') resetPassword(teacher);
          else if (btn.dataset.act === 'portal') showPortalModal(teacher);
          else if (btn.dataset.act === 'audit') showAudit(teacher);
          else if (btn.dataset.act === 'status') toggleStatus(teacher, teacher.status === 'active' ? 'disabled' : 'active');
        });
      });
    }
    renderPager();
  }

  function renderPager() {
    const host = el('taPager');
    if (!host) return;
    const total = state.total || 0;
    host.innerHTML =
      '<span>' + total + ' account' + (total === 1 ? '' : 's') + ' · Page ' + state.pageNo + ' of ' + state.pages + '</span>' +
      '<span class="ta-pager-btns">' +
        '<button type="button" class="btn btn-outline btn-sm" data-page="' + (state.pageNo - 1) + '"' +
          (state.pageNo <= 1 ? ' disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>' +
        '<button type="button" class="btn btn-outline btn-sm" data-page="' + (state.pageNo + 1) + '"' +
          (state.pageNo >= state.pages ? ' disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>' +
      '</span>';
    host.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = Number(btn.dataset.page);
        if (page >= 1 && page <= state.pages) {
          state.pageNo = page;
          loadTeachers();
        }
      });
    });
  }

  async function loadTeachers() {
    const client = api();
    if (!client) return;
    try {
      const data = await client.teachers({
        q: state.q, status: state.status, class: state.className,
        page: state.pageNo, limit: state.limit
      });
      state.teachers = data.rows || [];
      state.total = data.total || 0;
      state.pageNo = data.page || 1;
      state.pages = data.pages || 1;
      renderTeacherRows();
    } catch (err) {
      const wrap = el('taTableWrap');
      if (wrap) renderUnavailable(wrap, err);
    }
  }

  async function loadStats() {
    const client = api();
    if (!client) return;
    try {
      const data = await client.stats();
      state.stats = data.stats;
      renderStats(el('taStats'), data.stats);
      renderStats(el('adminStats'), data.stats);
      if (state.page === 'admin') renderAdmin(data.stats, data.audit || []);
    } catch (err) {
      showError(err);
      renderUnavailable(el('adminStats') || el('taStats'), err);
    }
  }

  async function renderAdmin(stats, auditRows) {
    const client = api();
    const resetHost = el('adminResetRequests');
    const subHost = el('adminSubmissions');
    if (resetHost) {
      try {
        const data = await client.teachers({ limit: 100 });
        const rows = (data.rows || []).filter(t => t.resetRequestedAt);
        resetHost.innerHTML = rows.length ? rows.map(t =>
          '<div class="ta-list-row"><div><strong>' + esc(t.fullName) + ' · ' + esc(t.portalNumber) + '</strong>' +
            '<small>Requested ' + esc(fmtDateTime(t.resetRequestedAt)) + '</small></div>' +
            '<button type="button" class="btn btn-primary btn-sm" data-reset="' + esc(t.id) + '">Reset</button></div>'
        ).join('') : '<div class="ta-empty"><i class="fa-solid fa-circle-check"></i><p>No pending password reset requests.</p></div>';
        resetHost.querySelectorAll('[data-reset]').forEach(btn => {
          btn.addEventListener('click', () => {
            const teacher = rows.find(t => t.id === btn.dataset.reset);
            if (teacher) resetPassword(teacher);
          });
        });
      } catch (err) {
        renderUnavailable(resetHost, err);
      }
    }
    if (subHost) {
      try {
        const data = await client.submissions(8);
        const rows = data.rows || [];
        subHost.innerHTML = rows.length ? rows.map(r =>
          '<div class="ta-list-row"><div><strong>' + esc(r.className) + ' · ' + esc(r.subject) +
            '</strong><small>' + esc(Utils.fmtDate(r.date)) + ' · by ' + esc(r.submittedBy) +
            ' · P' + r.present + ' A' + r.absent + ' L' + r.leave + '</small></div>' +
            '<span class="ta-chip">' + esc(r.action) + '</span></div>'
        ).join('') : '<div class="ta-empty"><i class="fa-solid fa-clipboard"></i><p>No teacher attendance submissions yet.</p></div>';
      } catch (err) {
        renderUnavailable(subHost, err);
      }
    }
    renderAuditRows(el('adminAudit'), auditRows);
  }

  async function loadMeta() {
    const client = api();
    if (!client) return;
    const data = await client.meta();
    state.meta = {
      classes: data.classes || [],
      subjects: data.subjects || [],
      sessions: data.sessions || [],
      permissions: data.permissions || [],
      defaults: data.defaults || {}
    };
    const filter = el('taClassFilter');
    if (filter) {
      filter.innerHTML = '<option value="">All classes</option>' + classMeta().map(c =>
        '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('');
    }
  }

  function bindAccounts() {
    el('newTeacherBtn').addEventListener('click', () => openTeacherModal(null));
    if (el('sabihPresetBtn')) el('sabihPresetBtn').addEventListener('click', openSabihPreset);
    el('teacherForm').addEventListener('submit', saveTeacher);
    el('pmSave').addEventListener('click', savePortal);
    el('copyPassword').addEventListener('click', async () => {
      const value = el('passwordSecret').textContent || '';
      try {
        await navigator.clipboard.writeText(value);
        UI.toast('Password copied.', 'success');
      } catch (err) {
        UI.toast('Select and copy the password manually.', 'warning');
      }
    });
    el('tfPhoto').addEventListener('change', async () => {
      const file = el('tfPhoto').files && el('tfPhoto').files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) return UI.toast('Choose an image under 2 MB.', 'warning');
      try {
        const data = await readPhoto(file);
        if (data.length > 700000) return UI.toast('The resized photograph is still too large.', 'warning');
        setPhoto(data);
      } catch (err) {
        UI.toast(err.message, 'error');
      }
    });
    el('tfPhotoRemove').addEventListener('click', () => setPhoto(''));
    el('taSearch').addEventListener('input', e => {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(() => {
        state.q = e.target.value.trim();
        state.pageNo = 1;
        loadTeachers();
      }, 250);
    });
    el('taStatusFilter').addEventListener('change', e => {
      state.status = e.target.value;
      state.pageNo = 1;
      loadTeachers();
    });
    el('taClassFilter').addEventListener('change', e => {
      state.className = e.target.value;
      state.pageNo = 1;
      loadTeachers();
    });
    el('taRefresh').addEventListener('click', async () => {
      await loadMeta();
      await loadStats();
      await loadTeachers();
    });
  }

  function bindDashboard() {
    el('adminStats').addEventListener('click', e => {
      const card = e.target.closest('.ta-stat');
      if (!card) return;
      window.location.href = 'teacher-accounts.html';
    });
  }

  onAppReady(async function () {
    const client = api();
    if (!client) {
      const message = 'Administration needs the bundled Node.js server. Run "node server.js", then open http://127.0.0.1:3000/admin.html. Do not use npm run dev for this static site.';
      ['taTableWrap', 'adminStats', 'adminResetRequests', 'adminSubmissions', 'adminAudit'].forEach(id => {
        const host = el(id);
        if (host) host.innerHTML = '<div class="ta-empty"><i class="fa-solid fa-server"></i><p>' + esc(message) + '</p></div>';
      });
      return;
    }
    try {
      if (state.page === 'teacher-accounts') {
        await loadMeta();
        bindAccounts();
        await loadStats();
        await loadTeachers();
        const params = new URLSearchParams(window.location.search);
        if (params.get('new') === 'sabih' || params.get('preset') === 'sabih') openSabihPreset();
        else if (params.get('new') === '1') openTeacherModal(null);
      } else if (state.page === 'admin') {
        bindDashboard();
        await loadStats();
      }
    } catch (err) {
      showError(err);
      renderUnavailable(el('taTableWrap') || el('adminStats'), err);
    }
  });
})();
