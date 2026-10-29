/* ==========================================================================
   attendance.js — take attendance sheet, counters, save, records browser
   ========================================================================== */

'use strict';

(function () {

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  const sheet = {
    className: '',
    section: '',
    subject: '',
    date: '',
    roster: [],        /* [{studentId, rollNo, name, fatherName, status, remarks}] */
    savedAt: null,
    savedAction: null,
    dirty: false,
    search: ''
  };

  const Attendance = {
    init() {
      const classSelect = document.getElementById('attClassSelect');
      UI.optionList(classSelect, db.classes.names(), '', 'Select class');

      const dateInput = document.getElementById('attDateInput');
      dateInput.value = Utils.pkToday();
      dateInput.max = Utils.pkToday();

      UI.optionList(document.getElementById('recClassFilter'),
        db.classes.names(), '', 'All classes');

      bindEvents();
      applyInitialFilters();
      switchTab(initialTab(), false);
      Attendance.loadSheet();
      Attendance.renderRecords();
    },

    /* ---------- sheet ---------- */
    loadSheet() {
      const classSelect = document.getElementById('attClassSelect');
      const sectionSelect = document.getElementById('attSectionSelect');
      const subjectSelect = document.getElementById('attSubjectSelect');
      const dateInput = document.getElementById('attDateInput');

      sheet.className = classSelect.value;
      sheet.section = sectionSelect.value;
      sheet.subject = subjectSelect.value;
      sheet.date = dateInput.value || Utils.todayISO();
      sheet.dirty = false;
      sheet.search = '';

      const searchInput = document.getElementById('attSearchInput');
      if (searchInput) searchInput.value = '';

      const sectionless = db.classes.isSectionless(sheet.className);
      const hasContext = sheet.className && (sectionless || sheet.section);
      const section = sectionless ? '' : sheet.section;

      const roster = hasContext
        ? db.students.byClassSection(sheet.className, section)
        : [];

      const existing = hasContext && sheet.subject
        ? db.attendance.findSheet(sheet.date, sheet.className, section, sheet.subject)
        : null;

      const defaultStatus = db.settings.get().attendance.defaultStatus;

      sheet.roster = roster.map(s => {
        let status = null;
        let remarks = '';
        if (existing) {
          const entry = existing.entries.find(e => e.studentId === s.studentId);
          if (entry) {
            status = entry.status;
            remarks = entry.remarks || '';
          }
        } else if (defaultStatus && defaultStatus !== 'none') {
          status = defaultStatus;
        }
        return {
          studentId: s.studentId,
          rollNo: s.rollNo,
          name: s.name,
          fatherName: s.fatherName,
          status: status,
          remarks: remarks
        };
      });

      sheet.savedAt = existing ? existing.submittedAt : null;
      sheet.savedAction = existing ? existing.action : null;

      UI.dirtyGuard.clear();
      renderSheet();
      renderMeta();
      updateCounters();
    },

    setStatus(index, status) {
      const entry = sheet.roster[index];
      if (!entry) return;
      entry.status = status;
      sheet.dirty = true;
      UI.dirtyGuard.set(true);
      markRowStatus(index);
      updateCounters();
      renderMeta();
    },

    markAllPresent() {
      if (!sheet.roster.length) {
        toast('There are no students in this class.', 'warning');
        return;
      }
      sheet.roster.forEach(entry => { entry.status = 'present'; });
      sheet.dirty = true;
      UI.dirtyGuard.set(true);
      renderSheet();
      updateCounters();
      renderMeta();
      toast('All students marked present.', 'info', 'Marked');
    },

    async save() {
      const sectionless = db.classes.isSectionless(sheet.className);
      if (!sheet.className || !sheet.subject || (!sectionless && !sheet.section)) {
        toast('Select class, section (where applicable) and subject first.', 'warning');
        return;
      }
      if (!sheet.roster.length) {
        toast('No students found for this class.', 'warning');
        return;
      }

      const unmarked = sheet.roster.filter(e => !e.status).length;
      if (unmarked) {
        toast(unmarked + ' student(s) still need a status before saving.', 'error', 'Incomplete sheet');
        return;
      }

      const btn = document.getElementById('saveAttendanceBtn');
      if (btn) btn.classList.add('is-loading');

      /* Simulated write latency — swap for a Supabase insert when connected */
      await new Promise(resolve => setTimeout(resolve, 350));

      const now = new Date();
      const record = {
        date: sheet.date,
        className: sheet.className,
        section: sectionless ? '' : sheet.section,
        subject: sheet.subject,
        entries: sheet.roster.map(e => ({
          studentId: e.studentId,
          rollNo: e.rollNo,
          status: e.status,
          remarks: e.remarks || ''
        })),
        submittedAt: Utils.pad(now.getHours()) + ':' + Utils.pad(now.getMinutes()),
        action: sheet.savedAt ? 'updated' : 'submitted',
        submittedBy: (auth.current() || {}).name || 'Administrator'
      };

      db.attendance.upsert(record);

      if (window.MCA_API && MCA_API.admin) {
        MCA_API.admin.logEvent(
          'attendance.admin_' + record.action,
          record.className + ' / ' + record.subject + ' / ' + record.date +
            ' / ' + record.entries.length + ' students',
          record.id
        ).catch(() => {});
      }

      sheet.savedAt = record.submittedAt;
      sheet.savedAction = record.action;
      sheet.dirty = false;
      UI.dirtyGuard.clear();

      if (btn) btn.classList.remove('is-loading');
      renderMeta();
      Attendance.renderRecords();
      toast('Attendance saved successfully.', 'success');
    },

    /* ---------- print ---------- */
    printSheet() {
      if (!sheet.className) {
        toast('Select a class (and section where applicable) first.', 'warning');
        return;
      }
      if (!sheet.roster.length) {
        toast('There are no students to print for this class.', 'warning', 'Nothing to print');
        return;
      }
      const sectionless = db.classes.isSectionless(sheet.className);
      /* A freshly loaded, un-saved sheet prints blank for manual marking.
         Saved records and the user's own in-progress marks are printed as-is. */
      const unrecorded = !sheet.savedAt && !sheet.dirty;
      const roster = unrecorded
        ? sheet.roster.map(e => Object.assign({}, e, { status: null }))
        : sheet.roster;
      Print.dailyAttendance({
        className: sheet.className,
        section: sectionless ? '' : sheet.section,
        subject: sheet.subject,
        date: sheet.date,
        roster: roster
      });
    },

    /* ---------- records tab ---------- */
    renderRecords() {
      const body = document.getElementById('recTableBody');
      if (!body) return;

      const classFilter = document.getElementById('recClassFilter');
      const dateFilter = document.getElementById('recDateFilter');

      let records = db.attendance.query({
        className: classFilter ? classFilter.value : '',
        from: dateFilter && dateFilter.value ? dateFilter.value : '',
        to: dateFilter && dateFilter.value ? dateFilter.value : ''
      });

      const totalFound = records.length;
      records = records.slice(0, 50);

      setText('recCount', totalFound
        ? 'Showing ' + records.length + ' of ' + Utils.fmtNumber(totalFound) + ' records (latest first)'
        : '0 records');

      if (!records.length) {
        body.innerHTML = '<tr><td colspan="10">' + UI.emptyState(
          'No attendance records',
          'No records match these filters. Save an attendance sheet from the Take Attendance tab.',
          'fa-clipboard'
        ) + '</td></tr>';
        return;
      }

      body.innerHTML = records.map(rec => {
        const s = { present: 0, absent: 0, leave: 0 };
        rec.entries.forEach(e => { s[e.status]++; });
        const total = rec.entries.length;
        return '<tr>' +
          '<td class="nowrap">' + Utils.esc(Utils.fmtDateShort(rec.date)) + '</td>' +
          '<td class="td-main">' + Utils.esc(rec.className) + '</td>' +
          '<td>' + Utils.sectionCell(rec.section) + '</td>' +
          '<td>' + Utils.esc(rec.subject) + '</td>' +
          '<td class="num">' + total + '</td>' +
          '<td class="num">' + s.present + '</td>' +
          '<td class="num">' + s.absent + '</td>' +
          '<td class="num">' + s.leave + '</td>' +
          '<td class="nowrap muted">' + Utils.esc(Utils.fmtTime(rec.submittedAt)) + '</td>' +
          '<td><div class="actions-cell">' +
            '<button type="button" class="icon-btn" title="View sheet" data-view-rec="' + Utils.esc(rec.id) + '">' +
              '<i class="fa-solid fa-eye"></i></button>' +
            '<button type="button" class="icon-btn danger" title="Delete record" data-del-rec="' + Utils.esc(rec.id) + '">' +
              '<i class="fa-solid fa-trash-can"></i></button>' +
          '</div></td>' +
        '</tr>';
      }).join('');

      body.querySelectorAll('[data-view-rec]').forEach(b =>
        b.addEventListener('click', () => Attendance.viewRecord(b.dataset.viewRec)));
      body.querySelectorAll('[data-del-rec]').forEach(b =>
        b.addEventListener('click', () => Attendance.removeRecord(b.dataset.delRec)));
    },

    viewRecord(id) {
      const rec = db.attendance.all().find(r => r.id === id);
      const title = document.getElementById('recordModalTitle');
      const body = document.getElementById('recordModalBody');
      if (!rec || !body) return;

      if (title) title.textContent = rec.className + (rec.section ? ' — Section ' + rec.section : '');

      const studentMap = {};
      db.students.all().forEach(s => { studentMap[s.studentId] = s; });

      const s = { present: 0, absent: 0, leave: 0 };
      rec.entries.forEach(e => { s[e.status]++; });

      body.innerHTML =
        '<div class="summary-grid">' +
          summaryItem('Total', rec.entries.length, '') +
          summaryItem('Present', s.present, 'sp-present') +
          summaryItem('Absent', s.absent, 'sp-absent') +
          summaryItem('Leave', s.leave, 'sp-leave') +
          summaryItem('Rate', Utils.pct(s.present, rec.entries.length) + '%', 'sp-rate') +
        '</div>' +
        '<div class="detail-grid">' +
          detail('Date', Utils.fmtDate(rec.date)) +
          detail('Class', rec.className) +
          (rec.section ? detail('Section', rec.section) : '') +
          detail('Subject', rec.subject) +
          detail('Submitted', Utils.fmtTime(rec.submittedAt)) +
          detail('Submitted by', rec.submittedBy || 'Administrator') +
        '</div>' +
        '<div class="section-label">Student marks</div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr>' +
          '<th>#</th><th>Roll No.</th><th>Student</th><th>Status</th><th>Remarks</th>' +
        '</tr></thead><tbody>' +
        rec.entries.map((e, i) =>
          '<tr>' +
            '<td class="num">' + (i + 1) + '</td>' +
            '<td class="num">' + e.rollNo + '</td>' +
            '<td class="td-main">' + Utils.esc(studentMap[e.studentId] ? studentMap[e.studentId].name : e.studentId) + '</td>' +
            '<td>' + UI.statusBadge(e.status) + '</td>' +
            '<td class="muted">' + Utils.esc(e.remarks || '—') + '</td>' +
          '</tr>').join('') +
        '</tbody></table></div>';

      UI.modal.open('recordModal');
    },

    async removeRecord(id) {
      const rec = db.attendance.all().find(r => r.id === id);
      if (!rec) return;
      const ok = await confirm({
        title: 'Delete attendance record?',
        message: rec.className + (rec.section ? ' · Section ' + rec.section : '') + ' · ' + rec.subject +
          ' on ' + Utils.fmtDate(rec.date) + ' will be permanently deleted.',
        confirmText: 'Delete record',
        danger: true
      });
      if (!ok) return;
      db.attendance.remove(id);
      toast('Attendance record deleted.', 'success');
      Attendance.renderRecords();
      Attendance.loadSheet(); /* refresh the take tab if it shows this record */
    },

    /* ---------- print individual student attendance ---------- */
    openPrintStudent() {
      const now = new Date();

      UI.optionList(document.getElementById('psaClass'), db.classes.names(), '', 'All classes');

      UI.optionList(document.getElementById('psaPeriod'), [
        { value: 'today', label: 'Today' },
        { value: 'last7', label: 'Last 7 Days' },
        { value: 'thisMonth', label: 'Current Month' },
        { value: 'month', label: 'Selected Month' },
        { value: 'custom', label: 'Custom Date Range' },
        { value: 'year', label: 'Full Academic Year' }
      ], 'thisMonth', null);

      UI.optionList(document.getElementById('psaMonth'),
        MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
        String(now.getMonth() + 1), null);

      const years = [];
      for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 5; y--) years.push(String(y));
      UI.optionList(document.getElementById('psaYear'), years, String(now.getFullYear()), null);

      const search = document.getElementById('psaSearch');
      if (search) search.value = '';
      const from = document.getElementById('psaFrom');
      const to = document.getElementById('psaTo');
      if (from) from.value = '';
      if (to) to.value = '';

      syncPsaPeriod();
      rebuildPsaStudents();

      UI.modal.open('printStudentAttModal');
    },

    /* Build the report document for the current modal selection, or null. */
    psaBuild() {
      const sel = document.getElementById('psaStudent');
      const student = sel && sel.value ? db.students.find(sel.value) : null;
      if (!student) {
        toast('Select a student to print.', 'warning');
        return null;
      }
      const range = psaRange();
      if (range.from && range.to && range.from > range.to) {
        toast('The start date must be on or before the end date.', 'error', 'Invalid range');
        return null;
      }
      return Print.buildStudentAttendance({
        student: student,
        from: range.from,
        to: range.to,
        periodLabel: range.label
      });
    },

    printStudentAtt(previewOnly) {
      const html = Attendance.psaBuild();
      if (!html) return;
      UI.modal.close('printStudentAttModal');
      if (previewOnly) Print.preview(html, false);
      else Print.print(html, false);
    }
  };

  /* ---------- rendering ---------- */

  function initialTab() {
    return new URLSearchParams(window.location.search).get('tab') === 'records'
      ? 'records' : 'take';
  }

  function switchTab(tab, updateUrl) {
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === tab));
    const takePanel = document.getElementById('takePanel');
    const recPanel = document.getElementById('recordsPanel');
    if (takePanel) takePanel.hidden = tab !== 'take';
    if (recPanel) recPanel.hidden = tab !== 'records';

    if (updateUrl) {
      try {
        const url = tab === 'records' ? 'attendance.html?tab=records' : 'attendance.html';
        window.history.replaceState(null, '', url);
      } catch (err) { /* file:// may block replaceState — ignore */ }
    }
  }

  function applyInitialFilters() {
    const params = new URLSearchParams(window.location.search);
    const classSelect = document.getElementById('attClassSelect');
    const wantedClass = params.get('class');

    if (wantedClass && db.classes.find(wantedClass)) classSelect.value = wantedClass;
    if (!classSelect.value && classSelect.options.length > 1) classSelect.selectedIndex = 1;
    rebuildDependents();
  }

  function rebuildDependents() {
    const classSelect = document.getElementById('attClassSelect');
    const sectionSelect = document.getElementById('attSectionSelect');
    const subjectSelect = document.getElementById('attSubjectSelect');
    const sectionGroup = document.getElementById('attSectionGroup');
    lastClass = classSelect.value;

    const sectionless = db.classes.isSectionless(classSelect.value);
    if (sectionGroup) sectionGroup.hidden = sectionless;
    sectionSelect.disabled = sectionless;

    if (sectionless) {
      UI.optionList(sectionSelect, [], '', 'No section');
      sectionSelect.value = '';
    } else {
      const sections = db.classes.sectionsOf(classSelect.value);
      UI.optionList(sectionSelect, sections, sections[0] || '', 'Select section');
    }

    const subjects = db.classes.subjectsOf(classSelect.value);
    UI.optionList(subjectSelect, subjects, subjects[0] || '', 'Select subject');
  }

  function renderSheet() {
    const body = document.getElementById('attTableBody');
    if (!body) return;

    const sectionless = db.classes.isSectionless(sheet.className);

    if (!sheet.className || (!sectionless && !sheet.section)) {
      body.innerHTML = '<tr><td colspan="6">' + UI.emptyState(
        'Select a class',
        'Choose class, section (where applicable), subject and date to load the attendance sheet.',
        'fa-clipboard-list') + '</td></tr>';
      return;
    }

    if (!sheet.roster.length) {
      const noneAtAll = db.students.active().length === 0;
      body.innerHTML = '<tr><td colspan="6">' + UI.emptyState(
        noneAtAll ? 'No students added yet' : 'No students in this class',
        noneAtAll
          ? 'The student register is empty. Add students on the Students page before taking attendance.'
          : 'Add students to ' + sheet.className + (sectionless ? '' : ' — Section ' + sheet.section) +
            ' from the Students page.',
        'fa-user-graduate') + '</td></tr>';
      return;
    }

    body.innerHTML = sheet.roster.map((entry, idx) => {
      return '<tr data-row="' + idx + '">' +
        '<td class="num muted">' + (idx + 1) + '</td>' +
        '<td class="num td-main">' + Utils.esc(entry.rollNo) + '</td>' +
        '<td class="td-main">' + Utils.esc(entry.name) + '</td>' +
        '<td class="muted">' + Utils.esc(entry.fatherName) + '</td>' +
        '<td>' +
          '<div class="status-group" role="radiogroup" aria-label="Attendance status for ' + Utils.esc(entry.name) + '">' +
            statusBtn(idx, 'present', 'Present', entry.status) +
            statusBtn(idx, 'absent', 'Absent', entry.status) +
            statusBtn(idx, 'leave', 'Leave', entry.status) +
          '</div>' +
        '</td>' +
        '<td>' +
          '<input type="text" class="form-input remarks-input" data-remarks="' + idx +
            '" placeholder="Optional remarks" value="' + Utils.esc(entry.remarks) + '">' +
        '</td>' +
      '</tr>';
    }).join('');

    applySearchFilter();
  }

  function statusBtn(idx, status, label, current) {
    return '<button type="button" class="status-btn' + (current === status ? ' is-active' : '') +
      '" data-status="' + status + '" data-idx="' + idx + '" aria-pressed="' +
      (current === status) + '">' + label + '</button>';
  }

  function markRowStatus(index) {
    const row = document.querySelector('tr[data-row="' + index + '"]');
    if (!row) return;
    const status = sheet.roster[index].status;
    row.querySelectorAll('.status-btn').forEach(btn => {
      const active = btn.dataset.status === status;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function updateCounters() {
    const counts = { present: 0, absent: 0, leave: 0 };
    sheet.roster.forEach(e => { if (e.status) counts[e.status]++; });
    setText('cntTotal', sheet.roster.length);
    setText('cntPresent', counts.present);
    setText('cntAbsent', counts.absent);
    setText('cntLeave', counts.leave);
  }

  function renderMeta() {
    const meta = document.getElementById('sheetMeta');
    if (!meta) return;
    if (sheet.dirty) {
      meta.innerHTML = '<span class="badge badge-amber">Unsaved changes</span>' +
        (sheet.savedAt ? '<span>Last saved at ' + Utils.esc(Utils.fmtTime(sheet.savedAt)) + '</span>' : '');
    } else if (sheet.savedAt) {
      meta.innerHTML = '<span class="badge badge-green">Saved</span>' +
        '<span>' + (sheet.savedAction === 'updated' ? 'Updated' : 'Submitted') + ' at ' +
        Utils.esc(Utils.fmtTime(sheet.savedAt)) + '</span>';
    } else {
      meta.innerHTML = '<span class="badge badge-gray">Not saved yet</span>' +
        '<span>' + Utils.esc(Utils.fmtDate(sheet.date)) + '</span>';
    }
  }

  function applySearchFilter() {
    const q = (sheet.search || '').trim().toLowerCase();
    document.querySelectorAll('#attTableBody tr[data-row]').forEach(row => {
      const idx = Number(row.dataset.row);
      const entry = sheet.roster[idx];
      if (!entry) return;
      const hay = (entry.name + ' ' + entry.rollNo + ' ' + entry.fatherName).toLowerCase();
      row.style.display = (!q || hay.indexOf(q) > -1) ? '' : 'none';
    });
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function detail(label, value) {
    return '<div class="detail-item"><div class="dt-label">' + Utils.esc(label) +
      '</div><div class="dt-value">' + Utils.esc(value) + '</div></div>';
  }

  function summaryItem(label, value, cls) {
    return '<div class="summary-item ' + cls + '"><div class="s-label">' + Utils.esc(label) +
      '</div><div class="s-value">' + Utils.esc(String(value)) + '</div></div>';
  }

  /* ---------- print-student helpers ---------- */

  function addDays(iso, n) {
    const p = String(iso).split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    return Utils.toISO(d);
  }

  function monthBounds(year, month) {
    const last = new Date(year, month, 0).getDate();
    return {
      from: year + '-' + Utils.pad(month) + '-01',
      to: year + '-' + Utils.pad(month) + '-' + Utils.pad(last)
    };
  }

  /* Resolve the chosen period into { from, to, label }. */
  function psaRange() {
    const period = document.getElementById('psaPeriod').value;
    const today = Utils.pkToday();

    if (period === 'today') {
      return { from: today, to: today, label: 'Today (' + Utils.fmtDate(today) + ')' };
    }
    if (period === 'last7') {
      const from = addDays(today, -6);
      return { from: from, to: today,
        label: 'Last 7 Days (' + Utils.fmtDate(from) + ' – ' + Utils.fmtDate(today) + ')' };
    }
    if (period === 'thisMonth') {
      const p = today.split('-');
      const b = monthBounds(Number(p[0]), Number(p[1]));
      return { from: b.from, to: b.to, label: MONTHS[Number(p[1]) - 1] + ' ' + p[0] };
    }
    if (period === 'month') {
      const m = Number(document.getElementById('psaMonth').value);
      const y = Number(document.getElementById('psaYear').value);
      const b = monthBounds(y, m);
      return { from: b.from, to: b.to, label: MONTHS[m - 1] + ' ' + y };
    }
    if (period === 'custom') {
      const from = document.getElementById('psaFrom').value;
      const to = document.getElementById('psaTo').value;
      return { from: from, to: to,
        label: (from ? Utils.fmtDate(from) : 'Start') + ' – ' + (to ? Utils.fmtDate(to) : 'End') };
    }
    if (period === 'year') {
      const s = db.sessions.active();
      if (s) return { from: s.start, to: s.end, label: 'Academic Year ' + s.name };
      const a = academicSessionFor(new Date());
      return { from: a.start, to: a.end, label: 'Academic Year ' + a.name };
    }
    return { from: '', to: '', label: 'All records' };
  }

  /* Show only the inputs the selected period needs. */
  function syncPsaPeriod() {
    const period = document.getElementById('psaPeriod').value;
    const monthGroup = document.getElementById('psaMonthGroup');
    const yearGroup = document.getElementById('psaYearGroup');
    const fromGroup = document.getElementById('psaFromGroup');
    const toGroup = document.getElementById('psaToGroup');
    if (monthGroup) monthGroup.hidden = period !== 'month';
    if (yearGroup) yearGroup.hidden = period !== 'month';
    if (fromGroup) fromGroup.hidden = period !== 'custom';
    if (toGroup) toGroup.hidden = period !== 'custom';
    updatePsaSummary();
  }

  /* Populate the student dropdown from the active register, honouring the
     class filter and the free-text search (name / Student ID / roll no.). */
  function rebuildPsaStudents() {
    const classSel = document.getElementById('psaClass');
    const sel = document.getElementById('psaStudent');
    if (!sel) return;

    const q = (document.getElementById('psaSearch').value || '').trim().toLowerCase();
    let rows = db.students.active();
    if (classSel && classSel.value) rows = rows.filter(s => s.class === classSel.value);
    if (q) {
      rows = rows.filter(s =>
        [s.name, s.studentId, s.rollNo].join(' ').toLowerCase().indexOf(q) > -1);
    }
    rows.sort(db.students.idCompare);

    const items = rows.map(s => ({
      value: s.id,
      label: (s.rollNo !== '' && s.rollNo != null ? 'Roll ' + s.rollNo + ' · ' : '') +
        s.name + ' (' + s.studentId + ')'
    }));

    const prev = sel.value;
    UI.optionList(sel, items, '', items.length ? 'Select a student' : 'No matching students');
    if (items.some(i => i.value === prev)) sel.value = prev;

    updatePsaSummary();
  }

  /* Reflect the current selection + period in the modal summary area. */
  function updatePsaSummary() {
    const host = document.getElementById('psaSummary');
    if (!host) return;
    const sel = document.getElementById('psaStudent');
    const student = sel && sel.value ? db.students.find(sel.value) : null;

    if (!student) {
      host.innerHTML = detail('Report', 'Select a student to preview the report scope.');
      return;
    }

    const range = psaRange();
    const count = db.attendance.byStudent(student.studentId)
      .filter(r => (!range.from || r.date >= range.from) && (!range.to || r.date <= range.to))
      .length;

    host.innerHTML =
      detail('Student', student.name + ' · ' + student.studentId) +
      detail('Period', range.label) +
      detail('Recorded Sessions', String(count));
  }

  /* ---------- events ---------- */

  async function onFilterChange() {
    if (sheet.dirty) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        message: 'The attendance sheet has unsaved changes. They will be lost if you load a new sheet.',
        confirmText: 'Discard changes',
        danger: true
      });
      if (!ok) {
        /* User cancelled — restore the selects to the loaded sheet */
        document.getElementById('attClassSelect').value = sheet.className;
        rebuildDependents();
        document.getElementById('attSectionSelect').value = sheet.section;
        document.getElementById('attSubjectSelect').value = sheet.subject;
        document.getElementById('attDateInput').value = sheet.date;
        lastClass = sheet.className;
        return;
      }
    }
    rebuildDependentsIfNeeded();
    Attendance.loadSheet();
  }

  let lastClass = '';
  function rebuildDependentsIfNeeded() {
    const classSelect = document.getElementById('attClassSelect');
    if (classSelect.value !== lastClass) {
      rebuildDependents();
    }
  }

  function bindEvents() {
    const classSelect = document.getElementById('attClassSelect');
    const sectionSelect = document.getElementById('attSectionSelect');
    const subjectSelect = document.getElementById('attSubjectSelect');
    const dateInput = document.getElementById('attDateInput');

    lastClass = classSelect.value;

    classSelect.addEventListener('change', onFilterChange);
    sectionSelect.addEventListener('change', onFilterChange);
    subjectSelect.addEventListener('change', onFilterChange);
    dateInput.addEventListener('change', onFilterChange);

    /* Status buttons + remarks (delegated) */
    const body = document.getElementById('attTableBody');
    body.addEventListener('click', e => {
      const btn = e.target.closest('.status-btn');
      if (!btn) return;
      Attendance.setStatus(Number(btn.dataset.idx), btn.dataset.status);
    });
    body.addEventListener('input', e => {
      const input = e.target.closest('[data-remarks]');
      if (!input) return;
      const entry = sheet.roster[Number(input.dataset.remarks)];
      if (!entry) return;
      entry.remarks = input.value;
      if (!sheet.dirty) {
        sheet.dirty = true;
        UI.dirtyGuard.set(true);
        renderMeta();
      }
    });

    /* Search student */
    const searchInput = document.getElementById('attSearchInput');
    const searchBtn = document.getElementById('attSearchBtn');
    const runSearch = () => {
      sheet.search = searchInput.value;
      applySearchFilter();
      const matches = document.querySelectorAll('#attTableBody tr[data-row]:not([style*="none"])').length;
      if (searchInput.value.trim()) {
        toast(matches + ' student(s) match “' + searchInput.value.trim() + '”.', 'info', 'Search');
      }
    };
    if (searchBtn) searchBtn.addEventListener('click', runSearch);
    if (searchInput) {
      searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
      searchInput.addEventListener('input', Utils.debounce(() => {
        sheet.search = searchInput.value;
        applySearchFilter();
      }, 160));
    }

    const markAllBtn = document.getElementById('markAllBtn');
    if (markAllBtn) markAllBtn.addEventListener('click', () => Attendance.markAllPresent());

    const saveBtn = document.getElementById('saveAttendanceBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => Attendance.save());

    const printBtn = document.getElementById('printAttendanceBtn');
    if (printBtn) printBtn.addEventListener('click', () => Attendance.printSheet());

    /* Tabs */
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab, true));
    });

    /* Records filters */
    const recClass = document.getElementById('recClassFilter');
    const recDate = document.getElementById('recDateFilter');
    if (recClass) recClass.addEventListener('change', () => Attendance.renderRecords());
    if (recDate) recDate.addEventListener('change', () => Attendance.renderRecords());

    /* Print individual student attendance */
    const printStudentBtn = document.getElementById('printStudentAttBtn');
    if (printStudentBtn) printStudentBtn.addEventListener('click', () => Attendance.openPrintStudent());

    const psaClass = document.getElementById('psaClass');
    if (psaClass) psaClass.addEventListener('change', rebuildPsaStudents);

    const psaSearch = document.getElementById('psaSearch');
    if (psaSearch) psaSearch.addEventListener('input', Utils.debounce(rebuildPsaStudents, 180));

    const psaStudent = document.getElementById('psaStudent');
    if (psaStudent) psaStudent.addEventListener('change', updatePsaSummary);

    const psaPeriod = document.getElementById('psaPeriod');
    if (psaPeriod) psaPeriod.addEventListener('change', syncPsaPeriod);

    ['psaMonth', 'psaYear', 'psaFrom', 'psaTo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', updatePsaSummary);
    });

    const psaPrintBtn = document.getElementById('psaPrintBtn');
    if (psaPrintBtn) psaPrintBtn.addEventListener('click', () => Attendance.printStudentAtt(false));

    const psaPreviewBtn = document.getElementById('psaPreviewBtn');
    if (psaPreviewBtn) psaPreviewBtn.addEventListener('click', () => Attendance.printStudentAtt(true));
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Attendance.init));

  window.Attendance = Attendance;
})();
