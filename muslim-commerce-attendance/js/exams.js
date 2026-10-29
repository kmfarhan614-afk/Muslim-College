/* ==========================================================================
   Muslim Commerce College Peshawar — Examination Management System
   js/exams.js
   --------------------------------------------------------------------------
   Data lives in localStorage under mca_exams / mca_subjects / mca_marks /
   mca_exam_settings (all allowlisted in js/api.js + server.js so the backend
   persists them like every other mca_* key). Ten tabs, sharing the existing
   Utils / Store / db / UI / Print engines.
   ========================================================================== */

'use strict';

(function () {

  const KEYS = {
    exams: 'mca_exams',
    subjects: 'mca_subjects',
    marks: 'mca_marks',
    settings: 'mca_exam_settings'
  };

  const EXAM_TYPES = ['Monthly Test', 'Weekly Test', 'Midterm Examination',
    'First Term', 'Second Term', 'Final', 'Annual', 'Pre-Board', 'Custom'];

  const EXAM_STATUSES = [
    { value: 'draft', label: 'Draft' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'ongoing', label: 'Ongoing' },
    { value: 'completed', label: 'Completed' },
    { value: 'published', label: 'Results Published' }
  ];

  const SUBJECT_TYPES = [
    { value: 'theory', label: 'Theory' },
    { value: 'practical', label: 'Practical' },
    { value: 'combined', label: 'Combined (Theory + Practical)' }
  ];

  const MARK_STATUSES = [
    { value: '', label: 'Not Entered' },
    { value: 'present', label: 'Present' },
    { value: 'absent', label: 'Absent' },
    { value: 'withheld', label: 'Withheld' }
  ];

  const TAB_DEFS = [
    { key: 'dashboard', label: 'Examination Dashboard', icon: 'fa-gauge-high' },
    { key: 'create', label: 'Create Examination', icon: 'fa-plus' },
    { key: 'schedule', label: 'Examination Schedule', icon: 'fa-calendar-days' },
    { key: 'subjects', label: 'Manage Subjects', icon: 'fa-book' },
    { key: 'marks', label: 'Enter Student Marks', icon: 'fa-pen-to-square' },
    { key: 'results', label: 'Examination Results', icon: 'fa-square-poll-vertical' },
    { key: 'dmc', label: 'Generate DMC', icon: 'fa-file-lines' },
    { key: 'printdmc', label: 'Print DMC', icon: 'fa-print' },
    { key: 'reports', label: 'Examination Reports', icon: 'fa-chart-column' },
    { key: 'settings', label: 'Examination Settings', icon: 'fa-gear' }
  ];

  const GRADE_CLS = { 'A+': 'aplus', 'A': 'a', 'B': 'b', 'C': 'c', 'D': 'd', 'E': 'e', 'F': 'f' };

  const RESULT_BADGES = {
    Pass: ['badge-green', 'Pass'],
    Fail: ['badge-red', 'Fail'],
    Absent: ['badge-gray', 'Absent'],
    Incomplete: ['badge-amber', 'Incomplete'],
    Withheld: ['badge-amber', 'Withheld']
  };

  const esc = v => Utils.esc(v);
  const uid = p => Utils.uid(p);

  /* ------------------------------------------------------------------------
     Store
     ------------------------------------------------------------------------ */
  const store = {
    exams() { const v = Store.read(KEYS.exams, []); return Array.isArray(v) ? v : []; },
    saveExams(list) { Store.write(KEYS.exams, list); },
    subjects() { const v = Store.read(KEYS.subjects, []); return Array.isArray(v) ? v : []; },
    saveSubjects(list) { Store.write(KEYS.subjects, list); },
    marks() { const v = Store.read(KEYS.marks, []); return Array.isArray(v) ? v : []; },
    saveMarks(list) {
      Store.write(KEYS.marks, list);
      invalidateMarkIndex();
    },
    settings() {
      const d = defaultSettings();
      const v = Store.read(KEYS.settings, null);
      return v && typeof v === 'object' ? Object.assign(d, v) : d;
    },
    saveSettings(s) { Store.write(KEYS.settings, s); }
  };

  function defaultSettings() {
    return {
      passPercent: 40,
      defaultMax: 100,
      defaultPass: 40,
      positionEnabled: true,
      gradeEnabled: true,
      grading: [
        { grade: 'A+', min: 90, max: 100, remark: 'Outstanding' },
        { grade: 'A', min: 80, max: 89.99, remark: 'Excellent' },
        { grade: 'B', min: 70, max: 79.99, remark: 'Very Good' },
        { grade: 'C', min: 60, max: 69.99, remark: 'Good' },
        { grade: 'D', min: 50, max: 59.99, remark: 'Satisfactory' },
        { grade: 'E', min: 40, max: 49.99, remark: 'Pass' },
        { grade: 'F', min: 0, max: 39.99, remark: 'Fail' }
      ],
      resultRemarks: { pass: 'Pass', fail: 'Fail', absent: 'Absent', incomplete: 'Incomplete', withheld: 'Withheld' },
      signatures: ['Class Teacher', 'Examination Controller', 'Principal'],
      stampLabel: 'Official College Stamp',
      dmcNote: 'This is a computer-generated Detailed Marks Certificate. Keep it safe for future reference.',
      registrationPrefix: '',
      headerNote: ''
    };
  }

  /* ------------------------------------------------------------------------
     Marks index
     One pass over mca_marks builds exam -> (exam + subject + student) -> mark.
     Every result/DMC calculation then reads a mark in O(1) instead of
     scanning the whole marks list once per student per subject.
     ------------------------------------------------------------------------ */
  const markIndex = { source: null, byExam: new Map() };
  const positionsCache = { key: '', map: null };

  function markKey(examId, subjectId, studentId) {
    return String(examId) + '\u0000' + String(subjectId) + '\u0000' + String(studentId);
  }

  function invalidateMarkIndex() {
    markIndex.source = null;
    markIndex.byExam = new Map();
    positionsCache.key = '';
    positionsCache.map = null;
  }

  function ensureMarkIndex() {
    const list = store.marks();
    if (markIndex.source === list) return markIndex;

    const byExam = new Map();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.examId) continue;
      let bucket = byExam.get(m.examId);
      if (!bucket) {
        bucket = new Map();
        byExam.set(m.examId, bucket);
      }
      const key = markKey(m.examId, m.subjectId, m.studentId);
      if (!bucket.has(key)) bucket.set(key, m);
    }

    markIndex.source = list;
    markIndex.byExam = byExam;
    positionsCache.key = '';
    positionsCache.map = null;
    return markIndex;
  }

  function marksForExam(examId) {
    const bucket = ensureMarkIndex().byExam.get(examId);
    return bucket ? Array.from(bucket.values()) : [];
  }

  /* ------------------------------------------------------------------------
     Small helpers
     ------------------------------------------------------------------------ */
  function nowISO() { return new Date().toISOString(); }

  function examById(id) {
    return store.exams().find(e => e.id === id) || null;
  }

  function subjById(exam, id) {
    return (exam && exam.subjects || []).find(s => s.id === id) || null;
  }

  function activeSubjects(exam) {
    return (exam && exam.subjects || []).filter(s => s.active !== false);
  }

  function classStudents(className) {
    return db.students.byClassSection(className, '');
  }

  function sessionChoice() {
    const names = db.sessions.names().filter(Boolean);
    const active = (db.sessions.active() || {}).name || '';
    if (active && names.indexOf(active) === -1) names.unshift(active);
    return { names: names, active: active };
  }

  function examStatusBadge(status) {
    const map = {
      draft: ['badge-gray', 'Draft'],
      scheduled: ['badge-blue', 'Scheduled'],
      ongoing: ['badge-amber', 'Ongoing'],
      completed: ['badge-green', 'Completed'],
      published: ['badge-green', 'Results Published'],
      archived: ['badge-gray', 'Archived']
    };
    const f = map[status] || ['badge-gray', status || '—'];
    return '<span class="badge ' + f[0] + '">' + esc(f[1]) + '</span>';
  }

  function typeBadge(type) {
    return '<span class="badge badge-gray">' + esc(type || '—') + '</span>';
  }

  function resultBadge(result) {
    const f = RESULT_BADGES[result] || ['badge-gray', result || '—'];
    return '<span class="badge ' + f[0] + '">' + esc(f[1]) + '</span>';
  }

  function gradeChip(grade) {
    if (!grade) return '<span class="muted">—</span>';
    const cls = GRADE_CLS[grade] ? ' g-' + GRADE_CLS[grade] : '';
    return '<span class="grade-chip' + cls + '">' + esc(grade) + '</span>';
  }

  function round1(n) { return Math.round((Number(n) || 0) * 10) / 10; }

  function timeMins(hhmm) {
    const p = String(hhmm || '').split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  /* ------------------------------------------------------------------------
     Marks access
     ------------------------------------------------------------------------ */
  function getMark(examId, subjectId, studentId) {
    const bucket = ensureMarkIndex().byExam.get(examId);
    if (!bucket) return null;
    return bucket.get(markKey(examId, subjectId, studentId)) || null;
  }

  function upsertMarks(marks) {
    if (!Array.isArray(marks) || !marks.length) return;
    const list = store.marks().slice();
    const lookup = new Map();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      lookup.set(markKey(m.examId, m.subjectId, m.studentId), i);
    }

    marks.forEach(mark => {
      if (!mark || !mark.examId) return;
      const key = markKey(mark.examId, mark.subjectId, mark.studentId);
      const i = lookup.get(key);
      if (i !== undefined) list[i] = Object.assign({}, list[i], mark);
      else {
        list.push(mark);
        lookup.set(key, list.length - 1);
      }
    });

    store.saveMarks(list);
  }

  function upsertMark(mark) {
    upsertMarks([mark]);
  }

  function removeMarksForExam(examId) {
    store.saveMarks(store.marks().filter(m => m.examId !== examId));
  }

  /* ------------------------------------------------------------------------
     Result engine
     ------------------------------------------------------------------------ */
  function subjMax(sub) {
    if (!sub) return 0;
    if (sub.type === 'combined') return (Number(sub.theoryMax) || 0) + (Number(sub.practicalMax) || 0);
    return Number(sub.maxMarks) || 0;
  }

  function subjPass(sub) {
    if (!sub) return 0;
    if (sub.type === 'combined') return (Number(sub.theoryPass) || 0) + (Number(sub.practicalPass) || 0);
    return Number(sub.passMarks) || 0;
  }

  function subjObtained(sub, mark) {
    if (!mark) return 0;
    if (sub.type === 'combined') return (Number(mark.theoryObtained) || 0) + (Number(mark.practicalObtained) || 0);
    return Number(mark.obtained) || 0;
  }

  function gradeFor(pct, grading) {
    const g = (grading || []).find(x => pct >= Number(x.min) && pct <= Number(x.max));
    return g ? g.grade : '';
  }

  /* Overall result for one student in one exam. */
  function computeResult(exam, student) {
    const st = store.settings();
    const subjects = activeSubjects(exam);
    const rows = [];
    let totalMax = 0, totalObtained = 0;
    let present = 0, absent = 0, withheld = 0, missing = 0, failSubs = 0;

    subjects.forEach(sub => {
      const mark = getMark(exam.id, sub.id, student.id);
      const status = mark ? mark.status : '';
      const max = subjMax(sub);
      const pass = subjPass(sub);
      const obtained = status === 'present' ? subjObtained(sub, mark) : 0;
      const pct = max ? round1(obtained / max * 100) : 0;
      const row = {
        subject: sub, mark: mark, status: status,
        max: max, pass: pass, obtained: obtained, pct: pct,
        result: '', grade: '', remark: ''
      };
      if (status === 'present') {
        present++;
        row.result = obtained >= pass ? 'Pass' : 'Fail';
        if (row.result === 'Fail') failSubs++;
        row.grade = st.gradeEnabled ? gradeFor(pct, st.grading) : '';
        totalObtained += obtained;
      } else if (status === 'absent') {
        absent++; row.result = 'Absent'; row.remark = 'Absent';
        row.grade = st.gradeEnabled ? 'F' : '';
      } else if (status === 'withheld') {
        withheld++; row.result = 'Withheld'; row.remark = 'Withheld';
      } else {
        missing++; row.result = 'Not Entered'; row.remark = 'Not Entered';
      }
      totalMax += max;
      rows.push(row);
    });

    let result = 'Incomplete';
    if (subjects.length && !missing) {
      if (withheld) result = 'Withheld';
      else if (present === 0 && absent > 0) result = 'Absent';
      else result = failSubs ? 'Fail' : 'Pass';
    }

    const percentage = totalMax ? round1(totalObtained / totalMax * 100) : 0;
    const overallGrade = st.gradeEnabled && (result === 'Pass' || result === 'Fail')
      ? gradeFor(percentage, st.grading) : '';

    return {
      rows: rows, totalMax: totalMax, totalObtained: totalObtained,
      percentage: percentage, result: result, grade: overallGrade
    };
  }

  /* Cache key covers the exam definition, its subjects, the register version
     and the marks version, so a position list can never survive a change. */
  function positionsKey(exam) {
    const subjectKey = (exam.subjects || []).map(s =>
      [s.id, s.active === false ? 0 : 1, subjMax(s), subjPass(s)].join(':')).join(',');
    return [exam.id, exam.className || '', String(exam.updatedAt || ''),
      subjectKey, db.students.indexVersion()].join('|');
  }

  /* Rank (1..N) of a student among the fully-calculated students of the class. */
  function positionsFor(exam) {
    ensureMarkIndex();
    const key = positionsKey(exam);
    if (positionsCache.key === key && positionsCache.map) return positionsCache.map;

    const scored = classStudents(exam.className)
      .map(s => ({ student: s, r: computeResult(exam, s) }))
      .filter(x => x.r.result === 'Pass' || x.r.result === 'Fail')
      .sort((a, b) =>
        (b.r.totalObtained - a.r.totalObtained) || (b.r.percentage - a.r.percentage));
    const map = {};
    scored.forEach((x, i) => { map[x.student.id] = i + 1; });
    positionsCache.key = key;
    positionsCache.map = map;
    return map;
  }

  /* Marking progress for the dashboard / list. */
  function examProgress(exam) {
    const subs = activeSubjects(exam);
    const activeIds = new Set(subs.map(s => String(s.id)));
    const total = classStudents(exam.className).length * subs.length;
    let entered = 0;
    marksForExam(exam.id).forEach(m => {
      if (m.status && activeIds.has(String(m.subjectId))) entered++;
    });
    return { total: total, entered: entered };
  }

  /* ------------------------------------------------------------------------
     Document builders (headings reuse style.css .mca-doc + .mca-table)
     ------------------------------------------------------------------------ */
  function collegeInfo() {
    const c = (db.settings.get() || {}).college || {};
    return {
      name: c.name || 'Muslim Commerce College Peshawar',
      address: c.address || '',
      phone: c.phone || '',
      email: c.email || '',
      website: c.website || ''
    };
  }

  function docShell(title, metaItems, bodyHtml, footerHtml) {
    const c = collegeInfo();
    const meta = (metaItems || []).filter(m => m && m.value).map(m =>
      '<span class="mca-meta-item"><span class="mca-meta-label">' + esc(m.label) + '</span>' +
      '<span class="mca-meta-value">' + esc(m.value) + '</span></span>').join('');
    return '<div class="mca-doc">' +
      '<header class="mca-doc-head">' +
        '<img class="mca-doc-logo" src="assets/logo.png" alt="">' +
        '<div class="mca-doc-head-text">' +
          '<div class="mca-doc-college">' + esc(c.name.toUpperCase()) + '</div>' +
          '<div class="mca-doc-title">' + esc(title) + '</div>' +
        '</div>' +
      '</header>' +
      (meta ? '<div class="mca-doc-meta">' + meta + '</div>' : '') +
      '<div class="mca-doc-body">' + bodyHtml + '</div>' +
      (footerHtml || '') +
      '<div class="mca-doc-footer">' + esc(c.address || '') +
        (c.phone ? ' &middot; ' + esc(c.phone) : '') +
        (c.email ? ' &middot; ' + esc(c.email) : '') + '</div>' +
    '</div>';
  }

  function docSignatures(labels) {
    return '<div class="mca-doc-sign">' +
      (labels || []).map(l =>
        '<div class="mca-sign"><span class="mca-sign-line"></span>' + esc(l) + '</div>').join('') +
      '</div>' +
      '<div class="mca-doc-printdate">Printed on ' + esc(Utils.fmtDate(Utils.pkToday())) +
      ' at ' + esc(Utils.pkClock()) + '</div>';
  }

  /* ------------------------------------------------------------------------
     DMC builder
     ------------------------------------------------------------------------ */
  function dmcNo(exam, student) {
    return 'DMC-' + String(student.studentId || '') + '/' + String(exam.academicYear || '').slice(0, 4);
  }

  function buildDmc(exam, student) {
    const st = store.settings();
    const r = computeResult(exam, student);
    const positions = st.positionEnabled ? positionsFor(exam) : {};
    const pos = positions[student.id] || '';
    const c = collegeInfo();
    const registration = (st.registrationPrefix ? st.registrationPrefix + ' ' : '') +
      String(student.studentId || student.registrationNo || '—');
    const rollNo = (student.rollNo !== '' && student.rollNo != null) ? String(student.rollNo) : '—';
    const session = exam.academicYear || student.session || '—';
    const resultIsFinal = (r.result === 'Pass' || r.result === 'Fail' || r.result === 'Absent');
    const percentLabel = resultIsFinal ? String(r.percentage) + '%' : '—';
    const resultLabel = st.resultRemarks[r.result.toLowerCase()] || r.result;

    const photoUrl = student.photo || (window.Photos ? Photos.src(student) : '');
    const photo = photoUrl
      ? '<img src="' + esc(photoUrl) + '" alt="">'
      : '<span class="initials">' + esc(Utils.initials(student.name)) + '</span>';

    const marksRows = r.rows.map((row, i) => {
      const obtainedCell = row.status === 'present' ? String(row.obtained)
        : row.status === 'absent' ? 'Absent'
        : '—';
      const remark = row.status === 'present'
        ? (row.result === 'Pass' ? st.resultRemarks.pass : st.resultRemarks.fail)
        : (row.status === 'absent' ? st.resultRemarks.absent
           : row.status === 'withheld' ? st.resultRemarks.withheld : '—');
      return '<tr>' +
        '<td class="c">' + (i + 1) + '</td>' +
        '<td class="subj">' + esc(row.subject.name || '') +
          (row.subject.type && row.subject.type !== 'theory' ? ' <span style="font-weight:400;color:#444">(' + esc(row.subject.type) + ')</span>' : '') + '</td>' +
        '<td class="c">' + row.max + '</td>' +
        '<td class="c">' + obtainedCell + '</td>' +
        '<td class="c">' + (row.status === 'present' ? esc(row.grade || '—') : esc(row.grade || '—')) + '</td>' +
        '<td class="c">' + esc(remark) + '</td>' +
      '</tr>';
    }).join('');

    const marksTable =
      '<div class="dmc-section">Marks Obtained</div>' +
      '<table class="dmc-marks">' +
        '<thead><tr><th>S.No.</th><th>Subject</th><th>Maximum Marks</th><th>Marks Obtained</th><th>Grade</th><th>Remarks</th></tr></thead>' +
        '<tbody>' + (marksRows || '<tr><td colspan="6" class="c">No subjects configured for this examination.</td></tr>') + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="2">TOTAL</td>' +
          '<td class="c">' + r.totalMax + '</td>' +
          '<td class="c">' + (resultIsFinal ? r.totalObtained : '—') + '</td>' +
          '<td class="c">' + (r.grade ? esc(r.grade) : '—') + '</td>' +
          '<td class="c">' + percentLabel + '</td>' +
        '</tr></tfoot>' +
      '</table>';

    const summary =
      '<div class="dmc-section">Result Summary</div>' +
      '<table class="dmc-summary">' +
        '<tr><td class="k">Total Marks</td><td class="c">' + r.totalMax + '</td>' +
            '<td class="k">Marks Obtained</td><td class="c">' + (resultIsFinal ? r.totalObtained : '—') + '</td></tr>' +
        '<tr><td class="k">Percentage</td><td class="c">' + percentLabel + '</td>' +
            '<td class="k">Grade</td><td class="c">' + (r.grade ? esc(r.grade) : '—') + '</td></tr>' +
        '<tr><td class="k">Result</td><td class="c">' + esc(resultLabel) + '</td>' +
            '<td class="k">Class Position</td><td class="c">' + (st.positionEnabled && pos ? esc('#' + pos) : '—') + '</td></tr>' +
        '<tr><td class="k">Result Date</td><td class="c">' + esc(exam.resultDate ? Utils.fmtDate(exam.resultDate) : '—') + '</td>' +
            '<td class="k">DMC No.</td><td class="c">' + esc(dmcNo(exam, student)) + '</td></tr>' +
      '</table>';

    const head = '<header class="dmc-head">' +
      '<img class="dmc-logo" src="assets/logo.png" alt="">' +
      '<div class="dmc-head-text">' +
        '<div class="dmc-college">' + esc(c.name) + '</div>' +
        (st.headerNote ? '<div class="dmc-sub">' + esc(st.headerNote) + '</div>' : '') +
        '<div class="dmc-title">Detailed Marks Certificate</div>' +
      '</div>' +
      '<div class="dmc-photo">' + photo + '</div>' +
    '</header>';

    const meta = '<div class="dmc-meta">' +
      '<span><b>Academic Session:</b> ' + esc(session) + '</span>' +
      '<span><b>Examination:</b> ' + esc(exam.name) + '</span>' +
      '<span><b>Class:</b> ' + esc(exam.className) + '</span>' +
      '<span class="dmc-meta-right"><b>Result Date:</b> ' + esc(exam.resultDate ? Utils.fmtDate(exam.resultDate) : '—') + '</span>' +
    '</div>';

    const info = '<div class="dmc-section">Student Information</div>' +
      '<table class="dmc-info">' +
        '<tr><td class="k">Student Name</td><td class="v">' + esc(student.name) + '</td>' +
            '<td class="divider"></td><td class="k">Father&rsquo;s Name</td><td class="v">' + esc(student.fatherName || '—') + '</td></tr>' +
        '<tr><td class="k">Student ID</td><td class="v">' + esc(student.studentId || '—') + '</td>' +
            '<td class="divider"></td><td class="k">Roll Number</td><td class="v">' + esc(rollNo) + '</td></tr>' +
        '<tr><td class="k">Class</td><td class="v">' + esc(student.class + (student.section ? ' — Section ' + student.section : '')) + '</td>' +
            '<td class="divider"></td><td class="k">Registration No.</td><td class="v">' + esc(registration) + '</td></tr>' +
      '</table>';

    const signs = (st.signatures && st.signatures.length ? st.signatures : ['Class Teacher', 'Examination Controller', 'Principal']);
    const signBlock = '<div class="dmc-sign">' +
      signs.map(s => '<div class="sig"><span class="line"></span>' + esc(s) + '</div>').join('') +
      '<div class="dmc-stamp"><div class="box">' + esc(st.stampLabel || 'Stamp') + '</div></div>' +
    '</div>';

    const foot = '<div class="dmc-foot">' + esc(c.name) + ' &mdash; ' +
      esc(session) + ' &middot; DMC date: ' + esc(Utils.fmtDate(Utils.pkToday())) + '</div>';

    return '<div class="dmc-doc">' + head + meta + info + marksTable + summary +
      (st.dmcNote ? '<div class="dmc-note">' + esc(st.dmcNote) + '</div>' : '') +
      signBlock + foot + '</div>';
  }

  function dmcPage(exam, student) {
    return '<div class="dmc-page">' + buildDmc(exam, student) + '</div>';
  }

  /* Returns the student with their photograph attached. The photograph lives
     in the photo store, so it is fetched on demand — only the students whose
     DMC is actually built are loaded. */
  async function studentWithPhoto(student) {
    if (!student || student.photo || !window.Photos) return student;
    try {
      const data = await Photos.loadFor(student);
      if (data) return Object.assign({}, student, { photo: data });
    } catch (err) { /* the DMC is built without the photograph */ }
    return student;
  }

  /* ------------------------------------------------------------------------
     Tabs — static scaffolding (per-tab sections, filled by renderers)
     ------------------------------------------------------------------------ */
  let activeTab = 'dashboard';
  let selectedExamId = '';

  function tabIcon(key) {
    const d = TAB_DEFS.find(t => t.key === key);
    return d ? d.icon : 'fa-circle';
  }

  function renderTabbar() {
    const host = document.getElementById('examTabbar');
    if (!host) return;
    host.innerHTML = TAB_DEFS.map(t =>
      '<button type="button" class="etab' + (t.key === activeTab ? ' active' : '') +
      '" data-etab="' + t.key + '"><i class="fa-solid ' + t.icon + '"></i>' + esc(t.label) + '</button>'
    ).join('');
  }

  function switchTab(key) {
    activeTab = key;
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', key);
      window.history.replaceState(null, '', url.toString());
    }
    renderTabbar();
    render();
    const top = document.getElementById('examTabbar');
    if (top) window.scrollTo({ top: top.getBoundingClientRect().top + window.scrollY - 86, behavior: 'smooth' });
  }

  function goTab(key, examId) {
    if (examId) selectedExamId = examId;
    switchTab(key);
  }

  /* ------------------------------------------------------------------------
     Modal helper (reuses the global data-modal-close / Escape bindings)
     ------------------------------------------------------------------------ */
  function openModal(title, bodyHtml, footerHtml, sizeClass) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML =
      '<div class="modal' + (sizeClass ? ' ' + sizeClass : '') + '">' +
        '<div class="modal-header"><h3>' + esc(title) + '</h3>' +
          '<button type="button" class="icon-btn" data-modal-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>' +
        '<div class="modal-body">' + (bodyHtml || '') + '</div>' +
        (footerHtml ? '<div class="modal-footer">' + footerHtml + '</div>' : '') +
      '</div>';
    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');
    setTimeout(() => backdrop.classList.add('open'), 10);
    return backdrop;
  }

  /* ------------------------------------------------------------------------
     1. Dashboard
     ------------------------------------------------------------------------ */
  function renderDashboard() {
    const exams = store.exams().slice().sort((a, b) => (String(b.updatedAt || '') < String(a.updatedAt || '') ? -1 : 1));
    const classes = db.classes.names();
    const studentsCount = db.students.active().length;
    let published = 0, ongoing = 0, pendingCells = 0;
    exams.forEach(e => {
      if (e.status === 'published') published++;
      if (e.status === 'ongoing') ongoing++;
      const p = examProgress(e);
      pendingCells += Math.max(0, p.total - p.entered);
    });
    const pendingLabel = String(pendingCells);

    const stats =
      '<div class="exam-stats">' +
        '<div class="exam-stat"><span class="es-icon"><i class="fa-solid fa-file-pen"></i></span>' +
          '<div><div class="es-value">' + exams.length + '</div><div class="es-label">Examinations</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon green"><i class="fa-solid fa-circle-check"></i></span>' +
          '<div><div class="es-value">' + published + '</div><div class="es-label">Results Published</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon amber"><i class="fa-solid fa-pen-to-square"></i></span>' +
          '<div><div class="es-value">' + pendingLabel + '</div><div class="es-label">Marks Entry Pending</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon"><i class="fa-solid fa-user-graduate"></i></span>' +
          '<div><div class="es-value">' + studentsCount + '</div><div class="es-label">Registered Students</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon red"><i class="fa-solid fa-school"></i></span>' +
          '<div><div class="es-value">' + classes.length + '</div><div class="es-label">Classes</div></div></div>' +
      '</div>';

    const quick =
      '<div class="card"><div class="card-header"><div><div class="card-title">Quick Actions</div>' +
        '<div class="card-sub">Jump straight into the workflow</div></div></div><div class="card-body">' +
        '<div class="detail-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
        '<button type="button" class="btn btn-primary" data-go="create"><i class="fa-solid fa-plus"></i> Create Examination</button>' +
        '<button type="button" class="btn btn-outline" data-go="marks"><i class="fa-solid fa-pen-to-square"></i> Enter Marks</button>' +
        '<button type="button" class="btn btn-outline" data-go="schedule"><i class="fa-solid fa-calendar-days"></i> Date Sheet</button>' +
        '<button type="button" class="btn btn-outline" data-go="dmc"><i class="fa-solid fa-file-lines"></i> Generate DMC</button>' +
        '<button type="button" class="btn btn-outline" data-go="results"><i class="fa-solid fa-square-poll-vertical"></i> Results</button>' +
      '</div></div></div>';

    const recent = exams.slice(0, 6).map(e => {
      const p = examProgress(e);
      const students = classStudents(e.className).length;
      return '<tr>' +
        '<td><div class="td-main">' + esc(e.name) + '</div><div class="td-sub">' + typeBadge(e.type) + '</div></td>' +
        '<td>' + esc(e.className) + '</td>' +
        '<td class="num">' + esc(e.academicYear || '—') + '</td>' +
        '<td class="num">' + esc(Utils.fmtDateShort(e.startDate)) + ' &rarr; ' + esc(Utils.fmtDateShort(e.endDate)) + '</td>' +
        '<td>' + examStatusBadge(e.status) + '</td>' +
        '<td class="num">' + (e.status === 'archived' ? '—' : p.entered + ' / ' + p.total + ' marks') + '</td>' +
        '<td><div class="actions-cell">' +
          '<button type="button" class="icon-btn" data-open-exam="' + e.id + '" data-tool="results" title="Results"><i class="fa-solid fa-square-poll-vertical"></i></button>' +
          '<button type="button" class="icon-btn" data-open-exam="' + e.id + '" data-tool="dmc" title="Generate DMC"><i class="fa-solid fa-file-lines"></i></button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    const list = exams.length ? 
      '<div class="card"><div class="card-header"><div><div class="card-title">Recent Examinations</div>' +
        '<div class="card-sub">Latest examinations across all classes</div></div></div>' +
        '<div class="card-body flush"><div class="table-scroll"><table class="data-table">' +
        '<thead><tr><th>Examination</th><th>Class</th><th>Session</th><th>Dates</th><th>Status</th><th>Marks Entry</th><th class="text-right">Actions</th></tr></thead>' +
        '<tbody>' + recent + '</tbody></table></div></div></div>'
      : '<div class="card">' + UI.emptyState('No examinations yet',
          'Create your first examination to begin the marks workflow.', 'fa-file-pen') +
        '<div class="card-body"><button type="button" class="btn btn-primary" data-go="create">' +
        '<i class="fa-solid fa-plus"></i> Create Examination</button></div></div>';

    document.getElementById('examContent').innerHTML =
      '<div class="exam-grid-2"><div style="min-width:0">' + stats + '</div></div>' +
      quick + list;
    bindGo();
  }

  function bindGo() {
    document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => goTab(b.dataset.go)));
    document.querySelectorAll('[data-open-exam]').forEach(b => b.addEventListener('click', () => {
      selectedExamId = b.dataset.openExam;
      goTab(b.dataset.tool);
    }));
  }

  /* ------------------------------------------------------------------------
     2. Create Examination (list + add/edit modal)
     ------------------------------------------------------------------------ */
  function renderCreate() {
    const host = document.getElementById('examContent');

    const selValue = (document.getElementById('createClassSel') || {}).value || '';
    const q = (document.getElementById('createSearch') || {}).value || '';

    const filterHtml =
      '<div class="filter-bar">' +
        '<div class="filter-item"><label class="form-label" for="createClassSel">Class</label>' +
          '<select class="form-select" id="createClassSel" data-live>' +
            '<option value="">All Classes</option>' +
            db.classes.names().map(n => '<option' + (n === selValue ? ' selected' : '') + '>' + esc(n) + '</option>').join('') +
          '</select></div>' +
        '<div class="filter-item wide"><label class="form-label">Search</label>' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i>' +
            '<input type="search" class="form-input" id="createSearch" placeholder="Examination name" value="' + esc(q) + '"></div></div>' +
        '<div class="filter-actions">' +
          '<button type="button" class="btn btn-outline" id="examExportCsv"><i class="fa-solid fa-file-csv"></i> Export CSV</button>' +
          '<button type="button" class="btn btn-primary" id="addExamBtn"><i class="fa-solid fa-plus"></i> Add Examination</button>' +
        '</div>' +
      '</div>';

    const list = store.exams().filter(e => e.status !== 'archived')
      .filter(e => !selValue || e.className === selValue)
      .filter(e => !q || String(e.name).toLowerCase().indexOf(q.toLowerCase()) > -1)
      .sort((a, b) => (String(b.createdAt || '') < String(a.createdAt || '') ? -1 : 1));

    const rows = list.map(e => {
      const p = examProgress(e);
      return '<tr>' +
        '<td><div class="td-main">' + esc(e.name) + '</div><div class="td-sub">' + typeBadge(e.type) + '</div></td>' +
        '<td>' + esc(e.className) + '</td>' +
        '<td class="num">' + esc(e.academicYear || '—') + '</td>' +
        '<td class="num">' + esc(Utils.fmtDateShort(e.startDate)) + ' &rarr; ' + esc(Utils.fmtDateShort(e.endDate)) + '</td>' +
        '<td class="num">' + esc(e.resultDate ? Utils.fmtDateShort(e.resultDate) : '—') + '</td>' +
        '<td><span class="actions-cell">' + examStatusBadge(e.status) + '</span></td>' +
        '<td><label class="form-label" style="display:none">Status</label>' +
          '<select class="form-select" data-status-exam="' + e.id + '" style="max-width:170px;padding:6px 8px">' +
            EXAM_STATUSES.map(s => '<option value="' + s.value + '"' + (e.status === s.value ? ' selected' : '') + '>' + s.label + '</option>').join('') +
          '</select></td>' +
        '<td class="num">' + (p.total ? p.entered + ' / ' + p.total : '—') + '</td>' +
        '<td><div class="actions-cell">' +
          '<button type="button" class="icon-btn" data-edit-exam="' + e.id + '" title="Edit"><i class="fa-solid fa-pen"></i></button>' +
          '<button type="button" class="icon-btn" data-sched-exam="' + e.id + '" title="Date Sheet"><i class="fa-solid fa-calendar-days"></i></button>' +
          '<button type="button" class="icon-btn" data-archive-exam="' + e.id + '" title="Archive"><i class="fa-solid fa-box-archive"></i></button>' +
          '<button type="button" class="icon-btn danger" data-del-exam="' + e.id + '" title="Delete"><i class="fa-solid fa-trash-can"></i></button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    const header = list.length ?
      '<div class="card"><div class="card-header"><div><div class="card-title">Examinations</div>' +
        '<div class="card-sub">' + list.length + ' examination(s) — add, edit, schedule or publish</div></div></div>' +
        '<div class="card-body flush"><div class="table-scroll"><table class="data-table">' +
        '<thead><tr><th>Examination</th><th>Class</th><th>Session</th><th>Exam Dates</th><th>Result Date</th><th>Status</th><th>Set Status</th><th>Marks</th><th class="text-right">Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div></div>'
      : '<div class="card">' + UI.emptyState('No examinations match',
          'Adjust the filters or create a new examination.', 'fa-magnifying-glass') + '</div>';

    host.innerHTML = filterHtml + header + renderExamTip();
    document.getElementById('addExamBtn').addEventListener('click', () => openExamModal());
    document.getElementById('examExportCsv').addEventListener('click', exportExamsCsv);
    document.getElementById('createClassSel').addEventListener('change', () => renderCreate());
    document.getElementById('createSearch').addEventListener('input', Utils.debounce(() => renderCreate(), 300));

    host.querySelectorAll('[data-edit-exam]').forEach(b => b.addEventListener('click', () => openExamModal(examById(b.dataset.editExam))));
    host.querySelectorAll('[data-sched-exam]').forEach(b => b.addEventListener('click', () => goTab('schedule', b.dataset.schedExam)));
    host.querySelectorAll('[data-archive-exam]').forEach(b => b.addEventListener('click', async () => {
      const e = examById(b.dataset.archiveExam);
      if (!e) return;
      const ok = await confirm({ title: 'Archive examination?', message: '“' + e.name + '” will be hidden from the active list. Marks are kept.', confirmText: 'Archive', danger: false });
      if (!ok) return;
      e.status = 'archived'; e.updatedAt = nowISO();
      store.saveExams(store.exams());
      toast('Examination archived.', 'success');
      renderCreate();
    }));
    host.querySelectorAll('[data-del-exam]').forEach(b => b.addEventListener('click', async () => {
      const e = examById(b.dataset.delExam);
      if (!e) return;
      const ok = await confirm({
        title: 'Delete examination permanently?',
        message: 'This removes “' + e.name + '” AND every marks record entered against it. This cannot be undone.',
        confirmText: 'Delete', danger: true
      });
      if (!ok) return;
      store.saveExams(store.exams().filter(x => x.id !== e.id));
      removeMarksForExam(e.id);
      toast('Examination deleted.', 'success');
      renderCreate();
    }));
    host.querySelectorAll('[data-status-exam]').forEach(sel => sel.addEventListener('change', () => {
      const e = examById(sel.dataset.statusExam);
      if (!e) return;
      e.status = sel.value; e.updatedAt = nowISO();
      store.saveExams(store.exams());
      toast('Status updated to ' + (EXAM_STATUSES.find(s => s.value === sel.value) || {}).label + '.', 'success');
    }));
  }

  function renderExamTip() {
    return '<div class="exam-hint"><i class="fa-solid fa-circle-info"></i><span>' +
      'Set the status to <b>Results Published</b> only after every required subject’s marks are entered. ' +
      'The DMC and reports use the saved marks — they are never hardcoded.</span></div>';
  }

  function exportExamsCsv() {
    const rows = [['Name', 'Type', 'Class', 'Academic Session', 'Start Date', 'End Date', 'Result Date', 'Status', 'Description']];
    store.exams().filter(e => e.status !== 'archived').forEach(e => {
      rows.push([e.name, e.type, e.className, e.academicYear || '', e.startDate || '', e.endDate || '', e.resultDate || '', e.status, e.description || '']);
    });
    UI.exportCSV('examinations.csv', rows);
  }

  function openExamModal(existing) {
    const isNew = !existing;
    const st = store.settings();
    const sessions = sessionChoice();
    const students = existing ? classStudents(existing.className).length : 0;

    const choices = {
      subjects: existing
        ? (existing.subjects || []).map(s => Object.assign({}, s))
        : []
    };

    function catalogForClass() {
      return store.subjects().filter(s => s.className === sel('exClassSel') && s.active !== false);
    }

    function subjRow(s, i) {
      const t = s.type || 'theory';
      const marksGroup = t === 'combined'
        ? '<div style="display:flex;gap:6px">' +
            '<label style="font-size:11px;flex:1">T.M<span class="req">*</span><input class="form-input" type="number" min="0" step="1" data-idx="' + i + '" data-field="theoryMax" value="' + esc(s.theoryMax) + '" style="width:100%"></label>' +
            '<label style="font-size:11px;flex:1">T.P<span class="req">*</span><input class="form-input" type="number" min="0" step="1" data-idx="' + i + '" data-field="theoryPass" value="' + esc(s.theoryPass) + '" style="width:100%"></label>' +
            '<label style="font-size:11px;flex:1">P.M<span class="req">*</span><input class="form-input" type="number" min="0" step="1" data-idx="' + i + '" data-field="practicalMax" value="' + esc(s.practicalMax) + '" style="width:100%"></label>' +
            '<label style="font-size:11px;flex:1">P.P<span class="req">*</span><input class="form-input" type="number" min="0" step="1" data-idx="' + i + '" data-field="practicalPass" value="' + esc(s.practicalPass) + '" style="width:100%"></label>' +
          '</div>'
        : '<div style="display:flex;gap:6px">' +
            '<label style="font-size:11px;flex:1">Max<span class="req">*</span><input class="form-input" type="number" min="0" step="1" data-idx="' + i + '" data-field="maxMarks" value="' + esc(s.maxMarks) + '" style="width:100%"></label>' +
            '<label style="font-size:11px;flex:1">Pass<span class="req">*</span><input class="form-input" type="number" min="0" step="1" data-idx="' + i + '" data-field="passMarks" value="' + esc(s.passMarks) + '" style="width:100%"></label>' +
          '</div>';

      return '<div class="subject-row">' +
        '<input type="checkbox" data-idx="' + i + '" data-field="active" ' + (s.active !== false ? 'checked' : '') + ' title="Include in exam">' +
        '<div style="min-width:0"><input class="form-input" type="text" data-idx="' + i + '" data-field="name" value="' + esc(s.name) + '" style="width:100%" placeholder="Subject name"></div>' +
        '<select class="form-select" data-idx="' + i + '" data-field="type" style="padding:6px 8px">' +
          SUBJECT_TYPES.map(t => '<option value="' + t.value + '"' + (s.type === t.value ? ' selected' : '') + '>' + t.label + '</option>').join('') +
        '</select>' +
        '<div style="min-width:0">' + marksGroup + '</div>' +
        '<button type="button" class="icon-btn danger" data-ex-rm-subj="' + i + '" title="Remove"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>';
    }

    function renderSubjList() {
      const box = modal.querySelector('[data-subjlist]');
      box.innerHTML = '<div class="subject-row head"><span>Use</span><span>Subject</span><span>Type</span><span>Marks / Pass</span><span></span></div>' +
        (choices.subjects.length ? choices.subjects.map(subjRow).join('')
          : '<div class="subject-row" style="grid-template-columns:1fr"><span class="muted">No subjects yet — pick from the catalog below or add custom.</span></div>');
      bindSubjEvents();
    }

    function bindSubjEvents() {
      const box = modal.querySelector('[data-subjlist]');
      box.querySelectorAll('[data-field]').forEach(el => {
        if (el.tagName === 'INPUT') {
          el.addEventListener('input', () => {
            const i = Number(el.dataset.idx);
            if (el.type === 'checkbox') choices.subjects[i].active = el.checked;
            else choices.subjects[i][el.dataset.field] = el.value;
          });
        } else {
          el.addEventListener('change', () => {
            const i = Number(el.dataset.idx);
            if (el.dataset.field === 'type') choices.subjects[i].type = el.value;
          });
        }
      });
      box.querySelectorAll('[data-ex-rm-subj]').forEach(b => b.addEventListener('click', () => {
        choices.subjects.splice(Number(b.dataset.exRmSubj), 1);
        renderSubjList();
      }));
    }

    function refreshCatalog() {
      const selEl = modal.querySelector('#exCatSubj');
      const cls = modal.querySelector('#exClassSel').value;
      const cats = store.subjects().filter(s => s.className === cls && s.active !== false);
      UI.optionList(selEl, cats.map(c => ({ value: c.id, label: c.name + (c.code ? ' (' + c.code + ')' : '') + ' — ' + (c.type === 'combined' ? ((c.theoryMax || 0) + (c.practicalMax || 0)) + ' marks' : (c.maxMarks || '') + ' marks') })), '', 'Add from subject catalog…');
    }

    const bodyHtml =
      '<div class="form-grid">' +
        '<div class="form-group span-2"><label class="form-label" for="exName">Examination Name <span class="req">*</span></label>' +
          '<input class="form-input" type="text" id="exName" required value="' + esc(existing ? existing.name : '') + '" placeholder="e.g. First Term Examination 2026"></div>' +
        '<div class="form-group"><label class="form-label" for="exType">Examination Type <span class="req">*</span></label>' +
          '<select class="form-select" id="exType">' + EXAM_TYPES.map(t => '<option' + (existing && existing.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
        '<div class="form-group" id="exCustomGroup" hidden><label class="form-label" for="exCustomType">Custom Type Name</label>' +
          '<input class="form-input" type="text" id="exCustomType" placeholder="e.g. Send-Up Examination"></div>' +
        '<div class="form-group"><label class="form-label" for="exSession">Academic Session <span class="req">*</span></label>' +
          '<select class="form-select" id="exSession"><option value="">—</option>' +
          sessions.names.map(n => '<option' + (existing && existing.academicYear === n ? ' selected' : (isNew && n === sessions.active ? ' selected' : '')) + '>' + esc(n) + '</option>').join('') + '</select></div>' +
        '<div class="form-group"><label class="form-label" for="exClassSel">Class <span class="req">*</span></label>' +
          '<select class="form-select" id="exClassSel"><option value="">Select class</option>' +
          db.classes.names().map(n => '<option' + (existing && existing.className === n ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
        '<div class="form-group"><label class="form-label" for="exStart">Start Date <span class="req">*</span></label>' +
          '<input class="form-input" type="date" id="exStart" required value="' + esc(existing ? existing.startDate : '') + '"></div>' +
        '<div class="form-group"><label class="form-label" for="exEnd">End Date <span class="req">*</span></label>' +
          '<input class="form-input" type="date" id="exEnd" required value="' + esc(existing ? existing.endDate : '') + '"></div>' +
        '<div class="form-group"><label class="form-label" for="exResult">Result Announcement Date</label>' +
          '<input class="form-input" type="date" id="exResult" value="' + esc(existing ? existing.resultDate : '') + '"></div>' +
        '<div class="form-group"><label class="form-label" for="exStatus">Status</label>' +
          '<select class="form-select" id="exStatus">' +
          EXAM_STATUSES.map(s => '<option value="' + s.value + '"' + (existing && existing.status === s.value ? ' selected' : '') + '>' + s.label + '</option>').join('') +
          '</select></div>' +
        '<div class="form-group span-2"><label class="form-label" for="exDesc">Description</label>' +
          '<textarea class="form-textarea" id="exDesc" rows="2" placeholder="Optional notes…">' + esc(existing ? existing.description || '' : '') + '</textarea></div>' +
      '</div>' +

      '<div class="mca-doc-section" style="margin-top:16px">Subjects for this examination</div>' +
      '<div class="form-grid">' +
        '<div class="form-group"><label class="form-label" for="exCatSubj">From Subject Catalog</label>' +
          '<div class="input-wrap"><select class="form-select" id="exCatSubj"></select>' +
          '<button type="button" class="input-action" id="exAddCat" title="Add from catalog"><i class="fa-solid fa-plus"></i></button></div></div>' +
        '<div class="form-group"><label class="form-label">Or add a custom subject</label>' +
          '<div style="display:flex;gap:6px"><input class="form-input" type="text" id="exCustomSubj" placeholder="Subject name" style="flex:1">' +
          '<button type="button" class="btn btn-outline" id="exAddCustom">Add</button></div></div>' +
      '</div>' +
      '<div class="subject-pick" data-subjlist></div>' +
      (existing ? '<div class="exam-hint warn" style="margin-top:10px"><i class="fa-solid fa-circle-exclamation"></i><span>Editing an examination after marks are entered only changes subject configuration — existing marks are kept.</span></div>' : '') +
      '<div class="exam-hint" style="margin-top:10px"><i class="fa-solid fa-circle-info"></i><span>' +
        'Max marks come from the catalog defaults; edit them before saving. Pass marks matter for the automatic Pass/Fail result. ' +
        (existing ? students + ' student(s) are enrolled in ' + existing.className + '.' : '') + '</span></div>';

    function sel(id) { return modal.querySelector('#' + id); }

    function selectedVal(id) { return modal.querySelector('#' + id).value; }

    function collectSubjects() {
      return choices.subjects.filter(s => s.active !== false).map((s, i) => {
        const out = {
          id: s.id, name: (s.name || '').trim(), code: s.code || '',
          type: s.type || 'theory', order: i, active: true
        };
        if (out.type === 'combined') {
          out.theoryMax = Number(s.theoryMax) || 0;
          out.theoryPass = Number(s.theoryPass) || 0;
          out.practicalMax = Number(s.practicalMax) || 0;
          out.practicalPass = Number(s.practicalPass) || 0;
        } else {
          out.maxMarks = Number(s.maxMarks) || 0;
          out.passMarks = Number(s.passMarks) || 0;
        }
        return out;
      });
    }

    const modal = openModal((isNew ? 'Add Examination' : 'Edit Examination'), bodyHtml,
      '<button type="button" class="btn btn-outline" data-modal-close>Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="exSave">' + (isNew ? 'Create Examination' : 'Save Changes') + '</button>',
      'modal-lg');

    modal.querySelector('#exType').addEventListener('change', () => {
      sel('exCustomGroup').hidden = selectedVal('exType') !== 'Custom';
    });
    if (existing && existing.type === 'Custom') sel('exCustomGroup').hidden = false;
    if (existing && existing.type === 'Custom') sel('exCustomType').value = existing.typeName || '';

    modal.querySelector('#exClassSel').addEventListener('change', () => {
      refreshCatalog();
      if (isNew) {
        choices.subjects = [];
        renderSubjList();
      } else {
        choices.subjects.forEach(s => {
          const cat = store.subjects().find(c => c.className === sel('exClassSel').value && c.name === s.name);
          if (cat && !s._kept) { /* keep per-exam overrides on edit */ }
        });
        renderSubjList();
      }
    });

    modal.querySelector('#exAddCat').addEventListener('click', () => {
      const id = sel('exCatSubj').value;
      if (!id) return;
      const cat = store.subjects().find(c => c.id === id);
      if (cat) choices.subjects.push(subjectConfigFromCatalog(cat));
      renderSubjList();
    });
    modal.querySelector('#exAddCustom').addEventListener('click', () => {
      const name = (sel('exCustomSubj').value || '').trim();
      if (!name) { toast('Enter a subject name.', 'warning'); return; }
      choices.subjects.push({
        id: uid('subj'), name: name, code: '', type: 'theory',
        maxMarks: st.defaultMax, passMarks: st.defaultPass,
        theoryMax: 70, theoryPass: 27, practicalMax: 30, practicalPass: 12, active: true
      });
      sel('exCustomSubj').value = '';
      renderSubjList();
    });

    refreshCatalog();
    renderSubjList();

    modal.querySelector('#exSave').addEventListener('click', () => {
      const name = (sel('exName').value || '').trim();
      const session = selectedVal('exSession');
      const className = selectedVal('exClassSel');
      const start = selectedVal('exStart');
      const end = selectedVal('exEnd');
      if (!name) { UI.fieldError(sel('exName'), 'Examination name is required.'); return; }
      if (!session) { UI.fieldError(sel('exSession'), 'Select an academic session.'); return; }
      if (!className) { UI.fieldError(sel('exClassSel'), 'Select a class.'); return; }
      if (!start || !end) { UI.fieldError(sel('exStart'), 'Start and end dates are required.'); return; }
      if (end < start) { UI.fieldError(sel('exEnd'), 'End date cannot be before start date.'); return; }
      const subjects = collectSubjects();
      if (!subjects.length) { toast('Add at least one active subject.', 'warning'); return; }

      const type = selectedVal('exType');
      const typeName = type === 'Custom' ? selectedVal('exCustomType').trim() : '';
      if (type === 'Custom' && !typeName) { UI.fieldError(sel('exCustomType'), 'Name the custom type.'); return; }

      const now = nowISO();
      const data = {
        id: existing ? existing.id : uid('exam'),
        name: name, type: type, typeName: typeName,
        academicYear: session, className: className,
        startDate: start, endDate: end,
        resultDate: selectedVal('exResult') || '',
        description: (sel('exDesc').value || '').trim(),
        status: selectedVal('exStatus'),
        subjects: subjects,
        schedule: existing ? (existing.schedule || []) : [],
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      };
      const list = store.exams();
      const i = list.findIndex(x => x.id === data.id);
      if (i > -1) list[i] = data; else list.push(data);
      store.saveExams(list);
      selectedExamId = data.id;
      UI.modal.close(modal);
      toast(existing ? 'Examination updated.' : 'Examination created.', 'success');
      renderCreate();
    });
  }

  function subjectConfigFromCatalog(cat) {
    const st = store.settings();
    return {
      id: uid('subj'), name: cat.name, code: cat.code || '',
      type: cat.type || 'theory',
      maxMarks: cat.maxMarks || st.defaultMax,
      passMarks: cat.passMarks != null ? cat.passMarks : st.defaultPass,
      theoryMax: cat.theoryMax || 70, theoryPass: cat.theoryPass || 27,
      practicalMax: cat.practicalMax || 30, practicalPass: cat.practicalPass || 12,
      active: true
    };
  }

  /* ------------------------------------------------------------------------
     3. Examination Schedule (date sheet + calendar + print)
     ------------------------------------------------------------------------ */
  let calMonthOff = 0;

  function renderSchedule() {
    const host = document.getElementById('examContent');
    const activeId = (document.getElementById('schedExamSel') || {}).value || selectedExamId;
    const exams = store.exams().filter(e => e.status !== 'archived');

    const pickerHtml =
      '<div class="filter-bar">' +
        '<div class="filter-item wide"><label class="form-label" for="schedExamSel">Examination</label>' +
          '<select class="form-select" id="schedExamSel">' +
            '<option value="">Select examination</option>' +
            exams.map(e => '<option value="' + e.id + '"' + (e.id === activeId ? ' selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.className) + '</option>').join('') +
          '</select></div>' +
        '<div class="filter-actions">' +
          '<button type="button" class="btn btn-outline" id="printDateSheetBtn"><i class="fa-solid fa-print"></i> Print Date Sheet</button>' +
          '<button type="button" class="btn btn-outline" id="printClassSheetBtn"><i class="fa-solid fa-print"></i> Print Class-Wise</button>' +
          '<button type="button" class="btn btn-outline" id="exportSchedCsv"><i class="fa-solid fa-file-csv"></i> Export CSV</button>' +
        '</div>' +
      '</div>';

    if (!activeId) {
      host.innerHTML = pickerHtml +
        '<div class="card">' + UI.emptyState('Choose an examination', 'Select an examination above to manage its date sheet and calendar.', 'fa-calendar-days') + '</div>';
      document.getElementById('schedExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('schedExamSel').value; renderSchedule(); });
      return;
    }

    const exam = examById(activeId);
    if (!exam) { host.innerHTML = pickerHtml; return; }
    selectedExamId = activeId;

    const subjects = activeSubjects(exam);
    const rows = (exam.schedule || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

    const conflictList = scheduleConflicts(exam);
    const conflictHtml = conflictList.length ?
      '<div class="exam-hint warn"><i class="fa-solid fa-triangle-exclamation"></i><span>Overlapping sessions detected on: ' +
        conflictList.map(x => '<b>' + esc(x) + '</b>').join(', ') + ' — a class cannot sit two papers at once.</span></div>' : '';

    let tableHtml;
    if (subjects.length) {
      tableHtml = rows.length ? rows.map((r) => {
        const opts = '<option value="">Select subject</option>' + subjects.map(s =>
          '<option value="' + s.id + '"' + (s.id === r.subjectId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
        return '<tr data-row="' + r.id + '">' +
          '<td><select class="form-select" data-f-subj style="min-width:160px">' + opts + '</select></td>' +
          '<td><input class="form-input" type="date" data-f="date" value="' + esc(r.date || '') + '"></td>' +
          '<td><input class="form-input" type="time" data-f="startTime" value="' + esc(r.startTime || '') + '"></td>' +
          '<td><input class="form-input" type="time" data-f="endTime" value="' + esc(r.endTime || '') + '"></td>' +
          '<td><input class="form-input" type="text" data-f="room" value="' + esc(r.room || '') + '" placeholder="Room"></td>' +
          '<td><input class="form-input" type="text" data-f="instructions" value="' + esc(r.instructions || '') + '" placeholder="Optional"></td>' +
          '<td><button type="button" class="icon-btn danger" data-rm-row="' + r.id + '"><i class="fa-solid fa-trash-can"></i></button></td>' +
        '</tr>';
      }).join('')
        : '<tr><td colspan="7" class="muted">No schedule entries yet — add papers below.</td></tr>';

      tableHtml =
        '<div class="card"><div class="card-header"><div><div class="card-title">Date Sheet — ' + esc(exam.name) + '</div>' +
          '<div class="card-sub">Set subject, date and time for every paper. Conflicts are detected automatically.</div></div>' +
          '<div class="page-actions" style="display:flex;gap:8px"><button type="button" class="btn btn-outline btn-sm" id="addSchedRow"><i class="fa-solid fa-plus"></i> Add Paper</button></div></div>' +
        '<div class="card-body flush"><div class="table-scroll"><table class="data-table"><thead><tr>' +
          '<th>Subject</th><th>Date</th><th>Start</th><th>End</th><th>Room</th><th>Instructions</th><th></th></tr></thead>' +
          '<tbody>' + tableHtml + '</tbody></table></div></div>' +
        '<div class="card-body" style="border-top:1px solid var(--color-border)">' +
          '<div class="bar-actions"><button type="button" class="btn btn-primary" id="saveScheduleBtn"><i class="fa-solid fa-floppy-disk"></i> Save Date Sheet</button></div></div></div>';
    } else {
      tableHtml = '<div class="card">' + UI.emptyState('No subjects configured', 'Add subjects when editing the examination, then build the date sheet.', 'fa-book-open') + '</div>';
    }

    const calendar = renderScheduleCalendar(exam);

    host.innerHTML = pickerHtml + conflictHtml + '<div class="exam-grid-2">' + tableHtml + calendar + '</div>';
    document.getElementById('schedExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('schedExamSel').value; renderSchedule(); });
    document.getElementById('printDateSheetBtn').addEventListener('click', () => Print.print(dateSheetHtml(exam), false));
    document.getElementById('printClassSheetBtn').addEventListener('click', () => Print.print(classDateSheetHtml(exam), false));
    document.getElementById('exportSchedCsv').addEventListener('click', () => exportScheduleCsv(exam));

    if (subjects.length) {
      document.getElementById('addSchedRow').addEventListener('click', () => {
        exam.schedule = exam.schedule || [];
        exam.schedule.push({ id: uid('srow'), subjectId: '', subjectName: '', date: '', startTime: '', endTime: '', room: '', instructions: '' });
        selectedExamId = exam.id;
        renderSchedule();
      });
      document.getElementById('saveScheduleBtn').addEventListener('click', () => {
        const conflict = scheduleConflicts(exam);
        if (conflict.length) {
          confirm({
            title: 'Schedule conflicts found',
            message: 'Overlapping papers were detected (' + conflict.join(', ') + '). Save anyway?',
            confirmText: 'Save Anyway'
          }).then(ok => { if (ok) scheduleCollectAndSave(exam); });
        } else {
          scheduleCollectAndSave(exam);
        }
      });
      host.querySelectorAll('[data-rm-row]').forEach(b => b.addEventListener('click', () => {
        exam.schedule = (exam.schedule || []).filter(r => r.id !== b.dataset.rmRow);
        selectedExamId = exam.id;
        renderSchedule();
      }));
      host.querySelectorAll('[data-f-subj]').forEach(selSel => {
        selSel.addEventListener('change', () => {
          const tr = selSel.closest('tr');
          const row = (exam.schedule || []).find(r => r.id === (tr && tr.dataset.row));
          if (!row) return;
          const sub = subjById(exam, selSel.value);
          row.subjectId = selSel.value;
          row.subjectName = sub ? sub.name : selSel.options[selSel.selectedIndex].text;
        });
      });
      host.querySelectorAll('[data-f]').forEach(inp => {
        inp.addEventListener('input', () => {
          const tr = inp.closest('tr');
          const row = (exam.schedule || []).find(r => r.id === (tr && tr.dataset.row));
          if (row) row[inp.dataset.f] = inp.value;
        });
      });
    }
  }

  function scheduleCollectAndSave(exam) {
    const rows = document.querySelectorAll('#examContent tbody tr[data-row]');
    rows.forEach(tr => {
      const row = (exam.schedule || []).find(r => r.id === tr.dataset.row);
      if (!row) return;
      tr.querySelectorAll('[data-f]').forEach(inp => { row[inp.dataset.f] = inp.value; });
      const subjOpt = tr.querySelector('[data-f-subj]');
      if (subjOpt) {
        row.subjectId = subjOpt.value;
        const sub = subjById(exam, subjOpt.value);
        row.subjectName = sub ? sub.name : subjOpt.options[subjOpt.selectedIndex].text;
      }
    });
    exam.schedule = (exam.schedule || []).filter(r => r.subjectId && r.date && r.startTime && r.endTime);
    exam.updatedAt = nowISO();
    store.saveExams(store.exams());
    toast('Date sheet saved.', 'success');
    renderSchedule();
  }

  function scheduleConflicts(exam) {
    const rows = (exam.schedule || []).filter(r => r.subjectName && r.date);
    const byClassDate = {};
    store.exams().filter(e => e.id !== exam.id && e.status !== 'archived' && e.className === exam.className)
      .forEach(e => (e.schedule || []).forEach(r => {
        if (r.subjectName && r.date && !byClassDate[r.date]) byClassDate[r.date] = [];
        if (r.subjectName && r.date) byClassDate[r.date].push({ subject: r.subjectName, start: r.startTime, end: r.endTime });
      }));
    const clashes = new Set();
    rows.forEach(r => {
      const others = (byClassDate[r.date] || []).filter(o =>
        r.startTime && r.endTime && o.start && o.end &&
        timeMins(r.startTime) < timeMins(o.end) && timeMins(o.start) < timeMins(r.end));
      if (others.length) clashes.add(Utils.fmtDateShort(r.date) + ' (' + r.subjectName + ')');
    });
    /* Also check duplicates within this exam on the same date. */
    const seen = {};
    rows.forEach(r => {
      if (!seen[r.date]) seen[r.date] = [];
      const dupe = seen[r.date].some(x =>
        r.startTime && x.start && timeMins(r.startTime) < timeMins(x.end) && timeMins(x.start) < timeMins(r.end));
      if (dupe) clashes.add(Utils.fmtDateShort(r.date) + ' (' + r.subjectName + ')');
      seen[r.date].push(r);
    });
    return Array.from(clashes);
  }

  function renderScheduleCalendar(exam) {
    const rows = (exam.schedule || []).filter(r => r.date);
    if (!rows.length) return '<div class="card">' + UI.emptyState('No dates yet', 'Add papers to see the calendar view.', 'fa-calendar') + '</div>';

    const dates = rows.map(r => r.date).sort();
    const first = dates[0];
    const base = new Date(Number(first.split('-')[0]), Number(first.split('-')[1]) - 1 + calMonthOff, 1);
    const year = base.getFullYear();
    const month = base.getMonth();
    const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'][month];
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDow = new Date(year, month, 1).getDay();
    const today = Utils.pkToday();

    const byDate = {};
    rows.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });

    let cells = [];
    for (let i = 0; i < firstDow; i++) cells.push('<div class="sched-cal-day empty"></div>');
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = year + '-' + Utils.pad(month + 1) + '-' + Utils.pad(d);
      const chips = (byDate[iso] || []).map(r =>
        '<span class="sched-chip" title="' + esc(r.room ? r.subjectName + ' · ' + r.room : r.subjectName) + '">' +
        esc(r.subjectName) + (r.startTime ? ' · ' + esc(Utils.fmtTime(r.startTime)) : '') + '</span>').join('');
      cells.push('<div class="sched-cal-day' + (iso === today ? ' today' : '') + '">' +
        '<span class="dnum">' + d + '</span>' + chips + '</div>');
    }
    const grid = '<div class="sched-cal">' +
      '<div class="sched-cal-head">' +
        '<button type="button" class="icon-btn" data-cal-prev aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>' +
        '<span>' + esc(monthName) + ' ' + year + '</span>' +
        '<button type="button" class="icon-btn" data-cal-next aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button>' +
      '</div>' +
      '<div class="sched-cal-grid">' +
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => '<div class="sched-cal-dow">' + d + '</div>').join('') +
        cells.join('') +
      '</div></div>';

    return '<div class="card"><div class="card-header"><div><div class="card-title">Calendar View</div>' +
      '<div class="card-sub">Papers are listed on their exam date</div></div></div><div class="card-body">' + grid + '</div></div>';
  }

  function bindScheduleCalendar() {
    const prev = document.getElementById('examContent').querySelector('[data-cal-prev]');
    const next = document.getElementById('examContent').querySelector('[data-cal-next]');
    if (prev) prev.addEventListener('click', () => { calMonthOff--; renderSchedule(); });
    if (next) next.addEventListener('click', () => { calMonthOff++; renderSchedule(); });
  }

  function dateSheetHtml(exam) {
    const rows = (exam.schedule || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const body = '<div class="mca-doc-section">Examination Date Sheet</div>' +
      '<table class="mca-table">' +
      '<thead><tr><th>No.</th><th>Subject</th><th>Date</th><th>Day</th><th>Start</th><th>End</th><th>Room</th><th>Instructions</th></tr></thead>' +
      '<tbody>' + (rows.length ? rows.map((r, i) => {
        const p = String(r.date || '').split('-');
        const day = p.length === 3 ? Utils.fmtDateLong(new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).split(',')[0] : '';
        return '<tr>' +
          '<td class="mca-center">' + (i + 1) + '</td>' +
          '<td>' + esc(r.subjectName) + '</td>' +
          '<td class="mca-nowrap">' + esc(Utils.fmtDate(r.date)) + '</td>' +
          '<td>' + esc(day) + '</td>' +
          '<td class="mca-center">' + esc(Utils.fmtTime(r.startTime)) + '</td>' +
          '<td class="mca-center">' + esc(Utils.fmtTime(r.endTime)) + '</td>' +
          '<td>' + esc(r.room || '—') + '</td>' +
          '<td>' + esc(r.instructions || '—') + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="8" class="mca-center">No schedule entries yet.</td></tr>') + '</tbody>' +
      '</table>';
    return docShell('EXAMINATION DATE SHEET', [
      { label: 'Examination', value: exam.name },
      { label: 'Class', value: exam.className },
      { label: 'Academic Session', value: exam.academicYear },
      { label: 'Exam Dates', value: exam.startDate ? Utils.fmtDate(exam.startDate) + ' to ' + Utils.fmtDate(exam.endDate) : '' }
    ], body);
  }

  function classDateSheetHtml(exam) {
    const inner = dateSheetHtml(exam);
    return inner.replace(exam.name, exam.name + ' (Class-Wise)');
  }

  function exportScheduleCsv(exam) {
    const rows = [['Subject', 'Date', 'Start', 'End', 'Room', 'Instructions']];
    (exam.schedule || []).forEach(r => { rows.push([r.subjectName, r.date, r.startTime, r.endTime, r.room, r.instructions]); });
    UI.exportCSV(slug(exam.name) + '-date-sheet.csv', rows);
  }

  function slug(s) { return String(s || 'date-sheet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  /* ------------------------------------------------------------------------
     4. Manage Subjects
     ------------------------------------------------------------------------ */
  function renderSubjects() {
    const host = document.getElementById('examContent');
    const cls = (document.getElementById('subjClassSel') || {}).value || '';
    const list = store.subjects()
      .filter(s => !cls || s.className === cls)
      .sort((a, b) => (a.className || '').localeCompare(b.className || '') || (Number(a.order) || 0) - (Number(b.order) || 0));

    const filterHtml =
      '<div class="filter-bar">' +
        '<div class="filter-item"><label class="form-label" for="subjClassSel">Class</label>' +
          '<select class="form-select" id="subjClassSel"><option value="">All Classes</option>' +
          db.classes.names().map(n => '<option' + (n === cls ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
        '<div class="filter-item wide"><label class="form-label">Subjects</label><div class="form-input muted">' + list.length + ' in catalog</div></div>' +
        '<div class="filter-actions">' +
          '<button type="button" class="btn btn-outline" id="subjExportCsv"><i class="fa-solid fa-file-csv"></i> Export CSV</button>' +
          '<button type="button" class="btn btn-primary" id="addSubjBtn"><i class="fa-solid fa-plus"></i> Add Subject</button>' +
        '</div>' +
      '</div>';

    const rows = list.map((s, i) => {
      const max = s.type === 'combined'
        ? ((Number(s.theoryMax) || 0) + (Number(s.practicalMax) || 0)) + ' (T ' + (s.theoryMax || 0) + ' / P ' + (s.practicalMax || 0) + ')'
        : (s.maxMarks || '—');
      const pass = s.type === 'combined'
        ? ((Number(s.theoryPass) || 0) + (Number(s.practicalPass) || 0)) + ' (T ' + (s.theoryPass || 0) + ' / P ' + (s.practicalPass || 0) + ')'
        : (s.passMarks || '—');
      return '<tr>' +
        '<td><div class="td-main">' + esc(s.name) + '</div><div class="td-sub">' + esc(s.code || '—') + '</div></td>' +
        '<td>' + esc(s.className) + '</td>' +
        '<td>' + typeBadge((SUBJECT_TYPES.find(t => t.value === s.type) || {}).label || s.type) + '</td>' +
        '<td class="num">' + esc(max) + '</td>' +
        '<td class="num">' + esc(pass) + '</td>' +
        '<td>' + (s.active === false ? '<span class="badge badge-gray">Inactive</span>' : '<span class="badge badge-green">Active</span>') + '</td>' +
        '<td><div class="actions-cell reorder-btns">' +
          '<button type="button" class="icon-btn" data-subj-up="' + s.id + '" title="Move up" ' + (i === 0 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
          '<button type="button" class="icon-btn" data-subj-down="' + s.id + '" title="Move down" ' + (i === list.length - 1 ? 'disabled' : '') + '><i class="fa-solid fa-arrow-down"></i></button>' +
        '</div></td>' +
        '<td><div class="actions-cell">' +
          '<button type="button" class="icon-btn" data-subj-edit="' + s.id + '" title="Edit"><i class="fa-solid fa-pen"></i></button>' +
          '<button type="button" class="icon-btn" data-subj-toggle="' + s.id + '" title="Toggle active"><i class="fa-solid ' + (s.active === false ? 'fa-toggle-on' : 'fa-toggle-off') + '"></i></button>' +
          '<button type="button" class="icon-btn danger" data-subj-del="' + s.id + '" title="Delete"><i class="fa-solid fa-trash-can"></i></button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    host.innerHTML = filterHtml +
      '<div class="card">' +
        (list.length ?
          '<div class="card-body flush"><div class="table-scroll"><table class="data-table"><thead><tr>' +
          '<th>Subject</th><th>Class</th><th>Type</th><th>Max Marks</th><th>Pass Marks</th><th>Status</th><th>Order</th><th class="text-right">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>'
          : '<div class="card-body">' + UI.emptyState('No subjects in the catalog', 'Add subjects so they can be attached to examinations.', 'fa-book-open') + '</div>') +
      '</div>';

    document.getElementById('subjClassSel').addEventListener('change', () => renderSubjects());
    document.getElementById('addSubjBtn').addEventListener('click', () => openSubjectModal());
    document.getElementById('subjExportCsv').addEventListener('click', () => {
      const rows = [['Name', 'Code', 'Class', 'Type', 'Max Marks', 'Pass Marks', 'Active']];
      store.subjects().forEach(s => rows.push([s.name, s.code || '', s.className, s.type, s.maxMarks, s.passMarks, s.active !== false]));
      UI.exportCSV('subjects.csv', rows);
    });
    host.querySelectorAll('[data-subj-edit]').forEach(b => b.addEventListener('click', () => openSubjectModal(store.subjects().find(x => x.id === b.dataset.subjEdit))));
    host.querySelectorAll('[data-subj-del]').forEach(b => b.addEventListener('click', async () => {
      const s = store.subjects().find(x => x.id === b.dataset.subjDel);
      const ok = await confirm({ title: 'Delete subject?', message: '“' + s.name + '” will be removed from the catalog. Existing examination records keep their own copy.', confirmText: 'Delete', danger: true });
      if (!ok) return;
      store.saveSubjects(store.subjects().filter(x => x.id !== s.id));
      toast('Subject deleted.', 'success');
      renderSubjects();
    }));
    host.querySelectorAll('[data-subj-toggle]').forEach(b => b.addEventListener('click', () => {
      const s = store.subjects().find(x => x.id === b.dataset.subjToggle);
      s.active = s.active === false ? true : false;
      store.saveSubjects(store.subjects());
      toast(s.active === false ? 'Subject deactivated.' : 'Subject activated.', 'success');
      renderSubjects();
    }));
    host.querySelectorAll('[data-subj-up]').forEach(b => b.addEventListener('click', () => moveSubject(b.dataset.subjUp, -1)));
    host.querySelectorAll('[data-subj-down]').forEach(b => b.addEventListener('click', () => moveSubject(b.dataset.subjDown, 1)));
  }

  function moveSubject(id, dir) {
    const list = store.subjects();
    const i = list.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i].order; list[i].order = list[j].order; list[j].order = tmp;
    store.saveSubjects(list);
    renderSubjects();
  }

  function openSubjectModal(existing) {
    const isNew = !existing;
    const st = store.settings();
    const combined = existing && existing.type === 'combined';

    function selQ(modal) { return i => modal.querySelector('#' + i); }

    function fieldsHtml() {
      if (combined !== undefined && combined) {
        return '<div class="form-group"><label class="form-label" for="sbTmax">Theory Max <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbTmax" value="' + esc(existing.theoryMax || 70) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbTpass">Theory Pass <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbTpass" value="' + esc(existing.theoryPass || 27) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbPmax">Practical Max <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbPmax" value="' + esc(existing.practicalMax || 30) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbPpass">Practical Pass <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbPpass" value="' + esc(existing.practicalPass || 12) + '"></div>';
      }
      return '<div class="form-group"><label class="form-label" for="sbMax">Max Marks <span class="req">*</span></label>' +
          '<input class="form-input" type="number" min="0" step="1" id="sbMax" value="' + esc(existing ? existing.maxMarks : st.defaultMax) + '"></div>' +
        '<div class="form-group"><label class="form-label" for="sbPass">Pass Marks <span class="req">*</span></label>' +
          '<input class="form-input" type="number" min="0" step="1" id="sbPass" value="' + esc(existing ? existing.passMarks : st.defaultPass) + '"></div>';
    }

    const bodyHtml =
      '<div class="form-grid">' +
        '<div class="form-group"><label class="form-label" for="sbName">Subject Name <span class="req">*</span></label>' +
          '<input class="form-input" type="text" id="sbName" required value="' + esc(existing ? existing.name : '') + '"></div>' +
        '<div class="form-group"><label class="form-label" for="sbCode">Subject Code</label>' +
          '<input class="form-input" type="text" id="sbCode" value="' + esc(existing ? existing.code || '' : '') + '" placeholder="Optional"></div>' +
        '<div class="form-group"><label class="form-label" for="sbClass">Class <span class="req">*</span></label>' +
          '<select class="form-select" id="sbClass"><option value="">Select class</option>' +
          db.classes.names().map(n => '<option' + (existing && existing.className === n ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></div>' +
        '<div class="form-group"><label class="form-label" for="sbType">Subject Type <span class="req">*</span></label>' +
          '<select class="form-select" id="sbType">' +
            SUBJECT_TYPES.map(t => '<option value="' + t.value + '"' + (existing && existing.type === t.value ? ' selected' : '') + '>' + t.label + '</option>').join('') + '</select></div>' +
        '<div class="form-group span-2" id="sbFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">' + fieldsHtml() + '</div>' +
        '<div class="form-group span-2"><label class="check-row" style="margin:0"><input type="checkbox" id="sbActive" ' + (existing && existing.active === false ? '' : 'checked') + '> Active in catalog</label></div>' +
      '</div>';

    const modal = openModal((isNew ? 'Add Subject' : 'Edit Subject'), bodyHtml,
      '<button type="button" class="btn btn-outline" data-modal-close>Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="sbSave">' + (isNew ? 'Add Subject' : 'Save Changes') + '</button>');
    const $ = selQ(modal);

    const refillFields = type => {
      const host2 = $('sbFields');
      const edit = existing;
      if (type === 'combined') {
        host2.innerHTML =
          '<div class="form-group"><label class="form-label" for="sbTmax">Theory Max <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbTmax" value="' + esc(edit && !isNew ? edit.theoryMax : 70) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbTpass">Theory Pass <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbTpass" value="' + esc(edit && !isNew ? edit.theoryPass : 27) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbPmax">Practical Max <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbPmax" value="' + esc(edit && !isNew ? edit.practicalMax : 30) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbPpass">Practical Pass <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbPpass" value="' + esc(edit && !isNew ? edit.practicalPass : 12) + '"></div>';
      } else {
        host2.innerHTML =
          '<div class="form-group"><label class="form-label" for="sbMax">Max Marks <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbMax" value="' + esc(edit && !isNew ? edit.maxMarks : st.defaultMax) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="sbPass">Pass Marks <span class="req">*</span></label>' +
            '<input class="form-input" type="number" min="0" step="1" id="sbPass" value="' + esc(edit && !isNew ? edit.passMarks : st.defaultPass) + '"></div>';
      }
    };

    if (existing) $('sbFields').innerHTML = fieldsHtml();

    $('sbType').addEventListener('change', () => refillFields($('sbType').value));

    modal.querySelector('#sbSave').addEventListener('click', () => {
      const name = ($('sbName').value || '').trim();
      const className = $('sbClass').value;
      const type = $('sbType').value;
      if (!name) { UI.fieldError($('sbName'), 'Subject name required.'); return; }
      if (!className) { UI.fieldError($('sbClass'), 'Select a class.'); return; }

      const list = store.subjects();
      const dupe = list.find(s => s.className === className && s.name.toLowerCase() === name.toLowerCase() && s.id !== (existing ? existing.id : ''));
      if (dupe) { UI.fieldError($('sbName'), 'This subject already exists for the selected class.'); return; }

      const data = existing ? Object.assign({}, existing) : {
        id: uid('subj'), code: '', active: true, createdAt: nowISO(),
        order: list.length + 1
      };
      data.name = name;
      data.code = ($('sbCode').value || '').trim();
      data.className = className;
      data.type = type;
      data.updatedAt = nowISO();
      if (type === 'combined') {
        data.theoryMax = Number($('sbTmax').value) || 0;
        data.practicalMax = Number($('sbPmax').value) || 0;
        data.theoryPass = Number($('sbTpass').value) || 0;
        data.practicalPass = Number($('sbPpass').value) || 0;
      } else {
        data.maxMarks = Number($('sbMax').value) || 0;
        data.passMarks = Number($('sbPass').value) || 0;
      }
      data.active = $('sbActive').checked;
      const i = list.findIndex(x => x.id === data.id);
      if (i > -1) list[i] = data; else list.push(data);
      store.saveSubjects(list);
      UI.modal.close(modal);
      toast(existing ? 'Subject updated.' : 'Subject added.', 'success');
      renderSubjects();
    });
  }

  /* ------------------------------------------------------------------------
     5. Enter Student Marks
     ------------------------------------------------------------------------ */
  function renderMarks() {
    const host = document.getElementById('examContent');
    const exams = store.exams().filter(e => e.status !== 'archived');
    const examVal = (document.getElementById('mkExamSel') || {}).value || '';
    const subjVal = (document.getElementById('mkSubjSel') || {}).value || '';

    const exam = examVal ? examById(examVal) : null;
    const subjects = exam ? activeSubjects(exam) : [];
    const subject = subjVal ? subjById(exam, subjVal) : (subjects[0] || null);

    let filterHtml =
      '<div class="filter-bar">' +
        '<div class="filter-item wide"><label class="form-label" for="mkExamSel">Examination</label>' +
          '<select class="form-select" id="mkExamSel"><option value="">Select examination</option>' +
          exams.map(e => '<option value="' + e.id + '"' + (e.id === examVal ? ' selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.className) + '</option>').join('') +
          '</select></div>' +
        '<div class="filter-item wide"><label class="form-label" for="mkSubjSel">Subject (paper)</label>' +
          '<select class="form-select" id="mkSubjSel"><option value="">Select subject</option>' +
          subjects.map(s => '<option value="' + s.id + '"' + (s.id === (subject && subject.id) ? ' selected' : '') + '>' + esc(s.name) + (s.type === 'combined' ? ' (T+P)' : '') + '</option>').join('') +
          '</select></div>' +
        '<div class="filter-actions"><button type="button" class="btn btn-outline" id="mkPrintSheet"><i class="fa-solid fa-print"></i> Print Sheet</button></div>' +
      '</div>';

    if (!exam || !subject) {
      host.innerHTML = filterHtml +
        '<div class="card">' + UI.emptyState('Pick an examination and subject', 'Marks are entered per paper (per subject) for the whole class at once.', 'fa-pen-to-square') + '</div>';
      document.getElementById('mkExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('mkExamSel').value; renderMarks(); });
      document.getElementById('mkSubjSel').addEventListener('change', () => { renderMarks(); });
      return;
    }

    selectedExamId = exam.id;
    const students = classStudents(exam.className);
    const max = subjMax(subject);
    const pass = subjPass(subject);
    const combined = subject.type === 'combined';

    const rows = students.map((s, i) => {
      const m = getMark(exam.id, subject.id, s.id);
      const status = m ? (m.status || 'present') : 'present';
      const numInputs = combined
        ? '<div class="input-wrap" style="display:flex;gap:5px"><input class="form-input mk-num" type="number" min="0" max="' + (Number(subject.theoryMax) || 0) + '" step="1" data-s="' + s.id + '" data-f="theoryObtained" value="' + esc(m && m.theoryObtained != null ? m.theoryObtained : '') + '" placeholder="T"><input class="form-input mk-num" type="number" min="0" max="' + (Number(subject.practicalMax) || 0) + '" step="1" data-s="' + s.id + '" data-f="practicalObtained" value="' + esc(m && m.practicalObtained != null ? m.practicalObtained : '') + '" placeholder="P"></div>'
        : '<input class="form-input mk-num" type="number" min="0" max="' + max + '" step="1" data-s="' + s.id + '" data-f="obtained" value="' + esc(m && m.obtained != null ? m.obtained : '') + '" placeholder="—">';

      const trCls = status === 'absent' ? 'is-absent' : status === 'withheld' ? 'is-withheld' : ((m && !m.status) ? 'is-blank' : '');
      return '<tr class="' + trCls + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td class="num">' + esc(s.studentId || '—') + '</td>' +
        '<td class="num">' + esc((s.rollNo !== '' && s.rollNo != null) ? s.rollNo : '—') + '</td>' +
        '<td class="mk-name">' + esc(s.name) + '</td>' +
        '<td class="num">' + max + '</td>' +
        '<td>' + numInputs + '</td>' +
        '<td><select class="form-select mk-status" data-s="' + s.id + '">' +
          MARK_STATUSES.map(ms => '<option value="' + ms.value + '"' + (ms.value === status ? ' selected' : '') + '>' + ms.label + '</option>').join('') +
          '</select></td>' +
      '</tr>';
    }).join('');

    let counters = '';
    const bar = '<div class="marks-bar">' +
      '<div class="counters"><span class="badge badge-gray">Total: <strong id="mkTotal">' + students.length + '</strong></span>' +
      '<span class="badge badge-green">Present: <strong id="mkPresent">0</strong></span>' +
      '<span class="badge badge-red">Absent: <strong id="mkAbsent">0</strong></span>' +
      '<span class="badge badge-amber">Withheld: <strong id="mkWithheld">0</strong></span>' +
      '<span class="badge badge-blue">Not Entered: <strong id="mkBlank">0</strong></span></div>' +
      '<div class="bar-actions">' +
        '<button type="button" class="btn btn-outline" id="mkMarkAll"><i class="fa-solid fa-check-double"></i> Mark All Present</button>' +
        '<button type="button" class="btn btn-primary" id="mkSave"><i class="fa-solid fa-floppy-disk"></i> Save Marks</button>' +
      '</div></div>';

    host.innerHTML = filterHtml +
      '<div class="card">' +
        '<div class="card-header"><div><div class="card-title">Marks Entry — ' + esc(subject.name) + '</div>' +
          '<div class="card-sub">' + esc(exam.name) + ' &middot; ' + esc(exam.className) + ' &middot; Maximum ' + max + ' (pass ' + pass + ')</div></div>' +
          '<div class="page-actions hintline" id="mkCounters">' + counters + '</div></div>' +
        '<div class="card-body flush"><div class="table-scroll"><table class="data-table marks-table">' +
          '<thead><tr><th>#</th><th>Student ID</th><th>Roll</th><th>Student</th><th>Total</th>' +
          '<th>' + (combined ? 'Obtained (Theory / Practical)' : 'Obtained Marks') + '</th><th>Status</th></tr></thead>' +
          '<tbody id="mkBody">' + (rows || '<tr><td colspan="7" class="muted">No students in this class.</td></tr>') + '</tbody>' +
        '</table></div></div>' + bar +
      '</div>';

    document.getElementById('mkExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('mkExamSel').value; renderMarks(); });
    document.getElementById('mkSubjSel').addEventListener('change', () => { renderMarks(); });
    document.getElementById('mkPrintSheet').addEventListener('click', () => Print.print(marksSheetHtml(exam, subject, students), false));
    document.getElementById('mkSave').addEventListener('click', () => saveMarksFor(exam, subject, students));
    document.getElementById('mkMarkAll').addEventListener('click', () => {
      document.querySelectorAll('#mkBody select.mk-status').forEach(sel => sel.value = 'present');
      document.querySelectorAll('#mkBody tr.is-absent, #mkBody tr.is-withheld').forEach(tr => tr.classList.remove('is-absent', 'is-withheld'));
      updateMkCounters();
      UI.dirtyGuard.set(true);
    });

    UI.dirtyGuard.set(false);
    bindMkKeyboard();
    bindMkLive();
    updateMkCounters();
  }

  function bindMkLive() {
    const body = document.getElementById('mkBody');
    body.addEventListener('change', e => {
      const sel = e.target.closest('select.mk-status');
      if (!sel) return;
      const tr = sel.closest('tr');
      tr.classList.toggle('is-absent', sel.value === 'absent');
      tr.classList.toggle('is-withheld', sel.value === 'withheld');
      tr.classList.toggle('is-blank', sel.value === '');
      if (sel.value !== 'present') {
        tr.querySelectorAll('input[type="number"]').forEach(inp => { inp.value = ''; inp.disabled = sel.value === 'absent' || sel.value === 'withheld'; });
      } else {
        tr.querySelectorAll('input[type="number"]').forEach(inp => { inp.disabled = false; });
      }
      updateMkCounters();
      UI.dirtyGuard.set(true);
    });
    body.addEventListener('input', () => { updateMkCounters(); UI.dirtyGuard.set(true); });
  }

  function updateMkCounters() {
    const body = document.getElementById('mkBody');
    if (!body) return;
    let present = 0, absent = 0, withheld = 0, blank = 0;
    body.querySelectorAll('select.mk-status').forEach(sel => {
      const v = sel.value || '';
      if (v === 'present') present++;
      else if (v === 'absent') absent++;
      else if (v === 'withheld') withheld++;
      else blank++;
    });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('mkPresent', present); set('mkAbsent', absent); set('mkWithheld', withheld); set('mkBlank', blank);
    set('mkTotal', body.querySelectorAll('select.mk-status').length);
  }

  function bindMkKeyboard() {
    const body = document.getElementById('mkBody');
    if (!body) return;
    body.querySelectorAll('input[type="number"]').forEach(inp => {
      inp.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const inputs = Array.from(body.querySelectorAll('input[type="number"]'));
        const i = inputs.indexOf(inp);
        if (e.shiftKey) { if (i > 0) inputs[i - 1].focus(); }
        else { const next = inputs[i + 1]; if (next) next.focus(); else { const first = inputs[0]; if (first) first.focus(); } }
      });
    });
  }

  function saveMarksFor(exam, subject, students) {
    const body = document.getElementById('mkBody');
    if (!body) return;
    const collected = [];
    const max = subjMax(subject);
    const maxT = Number(subject.theoryMax) || 0;
    const maxP = Number(subject.practicalMax) || 0;

    body.querySelectorAll('select.mk-status').forEach(sel => {
      const sid = sel.dataset.s;
      const tr = sel.closest('tr');
      const record = { sid: sid, status: sel.value || '' };
      if (record.status === 'present' && subject.type === 'combined') {
        const tInp = tr.querySelector('input[data-f="theoryObtained"]');
        const pInp = tr.querySelector('input[data-f="practicalObtained"]');
        record.theoryObtained = tInp.value;
        record.practicalObtained = pInp.value;
      } else if (record.status === 'present') {
        const inp = tr.querySelector('input[data-f="obtained"]');
        record.obtained = inp.value;
      }
      collected.push(record);
    });

    /* Validation */
    for (const rec of collected) {
      if (rec.status === 'present') {
        if (subject.type === 'combined') {
          if (rec.theoryObtained === '' || rec.practicalObtained === '') {
            toast('Every present student needs both theory and practical marks.', 'warning');
            return;
          }
          if (Number(rec.theoryObtained) > maxT || Number(rec.practicalObtained) > maxP || Number(rec.theoryObtained) < 0 || Number(rec.practicalObtained) < 0) {
            toast('Marks cannot exceed the subject maximum or be negative.', 'warning');
            return;
          }
        } else {
          if (rec.obtained === '') {
            toast('Present students need a numeric mark (blank is not zero).', 'warning');
            return;
          }
          if (Number(rec.obtained) > max || Number(rec.obtained) < 0) {
            toast('Obtained marks cannot exceed ' + max + ' or be negative.', 'warning');
            return;
          }
        }
      }
    }

    const by = (auth.current() || {}).name || 'Administrator';
    const batch = collected.map(rec => {
      const m = {
        examId: exam.id, subjectId: subject.id, subjectName: subject.name,
        className: exam.className,
        studentId: rec.sid,
        status: rec.status, updatedAt: nowISO(), enteredBy: by
      };
      if (rec.status === 'present') {
        m.obtained = Math.round(Number(rec.obtained) || 0);
        m.theoryObtained = Math.round(Number(rec.theoryObtained) || 0);
        m.practicalObtained = Math.round(Number(rec.practicalObtained) || 0);
      } else {
        m.obtained = 0; m.theoryObtained = 0; m.practicalObtained = 0;
      }
      return m;
    });
    /* One register write for the whole sheet, not one per student. */
    upsertMarks(batch);

    exam.updatedAt = nowISO();
    store.saveExams(store.exams());
    UI.dirtyGuard.set(false);
    toast('Marks saved for ' + exam.name + ' — ' + subject.name + '.', 'success');
    renderMarks();
  }

  function marksSheetHtml(exam, subject, students) {
    const max = subjMax(subject);
    const combined = subject.type === 'combined';
    const body = students.map((s, i) =>
      '<tr>' +
        '<td class="mca-center">' + (i + 1) + '</td>' +
        '<td>' + esc(s.studentId || '') + '</td>' +
        '<td>' + esc(s.name || '') + '</td>' +
        '<td>' + (combined ? '<span class="mca-nowrap">Theory __ / Pract __</span>' : '________') + '</td>' +
      '</tr>').join('');
    return docShell('MARKS SHEET', [
      { label: 'Examination', value: exam.name },
      { label: 'Subject', value: subject.name + (combined ? ' (Theory + Practical)' : '') },
      { label: 'Class', value: exam.className },
      { label: 'Maximum Marks', value: String(max) },
      { label: 'Academic Session', value: exam.academicYear }
    ],
    '<table class="mca-table">' +
      '<thead><tr><th>No.</th><th>Student ID</th><th>Student Name</th><th>Marks Obtained</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="4" class="mca-center">No students</td></tr>') + '</tbody>' +
      '</table>' +
      '<p class="mca-note">For office use — final results are calculated from the saved marks.</p>',
    docSignatures(['Examiner', 'Examination Controller']));
  }

  /* ------------------------------------------------------------------------
     6. Examination Results
     ------------------------------------------------------------------------ */
  function renderResults() {
    const host = document.getElementById('examContent');
    const exams = store.exams().filter(e => e.status !== 'archived');
    const examVal = (document.getElementById('resExamSel') || {}).value || selectedExamId;

    const picker =
      '<div class="filter-bar">' +
        '<div class="filter-item wide"><label class="form-label" for="resExamSel">Examination</label>' +
          '<select class="form-select" id="resExamSel"><option value="">Select examination</option>' +
          exams.map(e => '<option value="' + e.id + '"' + (e.id === examVal ? ' selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.className) + '</option>').join('') +
          '</select></div>' +
        '<div class="filter-actions">' +
          '<button type="button" class="btn btn-outline" id="resExportCsv"><i class="fa-solid fa-file-csv"></i> Export CSV</button>' +
          '<button type="button" class="btn btn-primary" id="resPublish"><i class="fa-solid fa-bullhorn"></i> Publish Results</button>' +
        '</div>' +
      '</div>';

    if (!examVal) {
      host.innerHTML = picker +
        '<div class="card">' + UI.emptyState('Choose an examination', 'Results are calculated automatically from the saved marks.', 'fa-square-poll-vertical') + '</div>';
      document.getElementById('resExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('resExamSel').value; renderResults(); });
      return;
    }

    const exam = examById(examVal);
    if (!exam) { host.innerHTML = picker; return; }
    selectedExamId = examVal;

    const students = classStudents(exam.className);
    const positions = store.settings().positionEnabled ? positionsFor(exam) : {};
    const results = students.map(s => ({ student: s, r: computeResult(exam, s) }));

    const counts = { Pass: 0, Fail: 0, Absent: 0, Incomplete: 0, Withheld: 0 };
    results.forEach(x => { counts[x.r.result] = (counts[x.r.result] || 0) + 1; });
    const complete = counts.Pass + counts.Fail + counts.Absent;
    const passRate = complete ? round1(counts.Pass / (counts.Pass + counts.Fail) * 100) + '%' : '—';

    const summary =
      '<div class="exam-stats" style="margin-bottom:16px">' +
        '<div class="exam-stat"><span class="es-icon green"><i class="fa-solid fa-user-check"></i></span>' +
          '<div><div class="es-value">' + counts.Pass + '</div><div class="es-label">Passed</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon red"><i class="fa-solid fa-user-xmark"></i></span>' +
          '<div><div class="es-value">' + counts.Fail + '</div><div class="es-label">Failed</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon amber"><i class="fa-solid fa-pen-to-square"></i></span>' +
          '<div><div class="es-value">' + (counts.Incomplete + counts.Withheld) + '</div><div class="es-label">Incomplete / Withheld</div></div></div>' +
        '<div class="exam-stat"><span class="es-icon"><i class="fa-solid fa-percent"></i></span>' +
          '<div><div class="es-value">' + passRate + '</div><div class="es-label">Pass Rate (of appeared)</div></div></div>' +
      '</div>';

    const rows = results.map(x => {
      const s = x.student, r = x.r;
      const pos = positions[s.id] || '';
      return '<tr>' +
        '<td class="num">' + esc(s.studentId || '—') + '</td>' +
        '<td class="num">' + esc((s.rollNo !== '' && s.rollNo != null) ? s.rollNo : '—') + '</td>' +
        '<td class="td-main">' + esc(s.name) + '</td>' +
        '<td class="num">' + r.totalMax + '</td>' +
        '<td class="num">' + (r.result === 'Incomplete' || r.result === 'Withheld' ? '—' : r.totalObtained) + '</td>' +
        '<td class="num">' + (r.result === 'Incomplete' || r.result === 'Withheld' ? '—' : r.percentage + '%') + '</td>' +
        '<td>' + (r.grade ? gradeChip(r.grade) : '<span class="muted">—</span>') + '</td>' +
        '<td>' + resultBadge(r.result) + '</td>' +
        '<td class="num">' + (pos ? '#' + pos : '—') + '</td>' +
        '<td><div class="actions-cell">' +
          '<button type="button" class="icon-btn" data-dmc-of="' + s.id + '" title="Generate DMC"><i class="fa-solid fa-file-lines"></i></button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    const table = 
      '<div class="card"><div class="card-header"><div><div class="card-title">Results — ' + esc(exam.name) + '</div>' +
        '<div class="card-sub">' + esc(exam.className) + ' &middot; ' + esc(exam.academicYear || '') + ' &middot; status: ' +
        (EXAM_STATUSES.find(s => s.value === exam.status) || {}).label + '</div></div></div>' +
        '<div class="card-body flush"><div class="table-scroll"><table class="data-table">' +
        '<thead><tr><th>Student ID</th><th>Roll</th><th>Student</th><th>Total Max</th><th>Obtained</th><th>%</th><th>Grade</th><th>Result</th><th>Position</th><th class="text-right">DMC</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="10" class="muted">No students.</td></tr>') + '</tbody></table></div></div></div>';

    host.innerHTML = picker + summary + table;
    document.getElementById('resExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('resExamSel').value; renderResults(); });
    document.getElementById('resExportCsv').addEventListener('click', () => exportResultsCsv(exam, results));
    document.getElementById('resPublish').addEventListener('click', async () => {
      await publishResults(exam, results);
    });
    host.querySelectorAll('[data-dmc-of]').forEach(b => b.addEventListener('click', () => {
      selectedStudentId = b.dataset.dmcOf;
      goTab('dmc', exam.id);
    }));
  }

  function publishResults(exam, results) {
    const missing = results.filter(x => x.r.result === 'Incomplete').length;
    const withheld = results.filter(x => x.r.result === 'Withheld').length;
    const done = async () => {
      exam.status = 'published'; exam.publishedAt = nowISO(); exam.updatedAt = nowISO();
      store.saveExams(store.exams());
      toast('Results published for ' + exam.name + '.', 'success');
      renderResults();
    };
    if (missing) {
      return confirm({
        title: 'Some results are incomplete',
        message: missing + ' student(s) still have papers without marks. Publishing now would show incomplete data. Publish anyway?',
        confirmText: 'Publish Anyway'
      }).then(ok => { if (ok) done(); });
    }
    if (withheld) {
      return confirm({
        title: 'Some marks are withheld',
        message: withheld + ' student(s) have withheld marks. Their totals are excluded until released. Publish anyway?',
        confirmText: 'Publish Anyway'
      }).then(ok => { if (ok) done(); });
    }
    return done();
  }

  let selectedStudentId = '';

  function exportResultsCsv(exam, results) {
    const rows = [['Student ID', 'Roll No', 'Name', 'Total Max', 'Total Obtained', 'Percentage', 'Grade', 'Result']];
    results.forEach(x => {
      rows.push([x.student.studentId, x.student.rollNo, x.student.name, x.r.totalMax, x.r.totalObtained, x.r.percentage + '%', x.r.grade, x.r.result]);
    });
    UI.exportCSV(slug(exam.name) + '-results.csv', rows);
  }

  /* ------------------------------------------------------------------------
     7. Generate DMC (+ 8. Print DMC uses the same builders)
     ------------------------------------------------------------------------ */
  function renderDmc() {
    const host = document.getElementById('examContent');
    const exams = store.exams().filter(e => e.status !== 'archived');
    const examVal = (document.getElementById('dmcExamSel') || {}).value || selectedExamId;
    const exam = examVal ? examById(examVal) : null;

    const studentSel =
      '<div class="filter-bar">' +
        '<div class="filter-item wide"><label class="form-label" for="dmcExamSel">Examination</label>' +
          '<select class="form-select" id="dmcExamSel"><option value="">Select examination</option>' +
          exams.map(e => '<option value="' + e.id + '"' + (e.id === examVal ? ' selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.className) + '</option>').join('') +
          '</select></div>' +
        (exam ?
          '<div class="filter-item wide"><label class="form-label" for="dmcStudentSel">Student</label>' +
            '<select class="form-select" id="dmcStudentSel"><option value="">Select student</option>' +
            classStudents(exam.className).map(s =>
              '<option value="' + s.id + '"' + (s.id === selectedStudentId ? ' selected' : '') + '>' +
              esc((s.rollNo != null && s.rollNo !== '' ? s.rollNo + ' · ' : '') + s.name + ' (' + s.studentId + ')') + '</option>').join('') +
            '</select></div>' +
          '<div class="filter-actions">' +
            '<button type="button" class="btn btn-outline" id="dmcPreview"><i class="fa-solid fa-eye"></i> Preview DMC</button>' +
            '<button type="button" class="btn btn-primary" id="dmcPrint"><i class="fa-solid fa-print"></i> Print / Save PDF</button>' +
          '</div>'
          : '') +
      '</div>';

    if (!exam) {
      host.innerHTML = studentSel +
        '<div class="card">' + UI.emptyState('Choose an examination', 'The DMC is generated from the saved marks of a real student record.', 'fa-file-lines') + '</div>';
      document.getElementById('dmcExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('dmcExamSel').value; selectedStudentId = ''; renderDmc(); });
      return;
    }
    selectedExamId = exam.id;

    const students = classStudents(exam.className);
    host.innerHTML = studentSel + '<div id="dmcLive"></div>';
    document.getElementById('dmcExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('dmcExamSel').value; selectedStudentId = ''; renderDmc(); });
    const stuSel = document.getElementById('dmcStudentSel');
    if (stuSel) stuSel.addEventListener('change', () => { selectedStudentId = stuSel.value; renderDmcLive(exam); });

    if (students.length === 0) {
      host.querySelector('#dmcLive').innerHTML = '<div class="card">' + UI.emptyState('No students in this class', 'Register students first so they appear on the DMC.', 'fa-user-graduate') + '</div>';
      return;
    }

    const previewBtn = document.getElementById('dmcPreview');
    const printBtn = document.getElementById('dmcPrint');
    if (previewBtn) previewBtn.addEventListener('click', async () => {
      const s = selectedStudent(exam);
      if (!s) { toast('Select a student first.', 'warning'); return; }
      Print.preview(dmcPage(exam, await studentWithPhoto(s)), false);
    });
    if (printBtn) printBtn.addEventListener('click', async () => {
      const s = selectedStudent(exam);
      if (!s) { toast('Select a student first.', 'warning'); return; }
      Print.print(dmcPage(exam, await studentWithPhoto(s)), false);
    });

    const s = selectedStudent(exam);
    if (s) renderDmcLive(exam, s); else renderDmcLive(exam, students[0]);
  }

  function selectedStudent(exam) {
    if (!exam) return null;
    if (selectedStudentId) {
      const found = classStudents(exam.className).find(x => x.id === selectedStudentId);
      if (found) return found;
    }
    return classStudents(exam.className)[0] || null;
  }

  async function renderDmcLive(exam, student) {
    const host = document.getElementById('dmcLive');
    if (!host || !student) return;
    const r = computeResult(exam, student);
    const previewHtml = buildDmc(exam, await studentWithPhoto(student));
    const snapshot = '<div class="card"><div class="card-header"><div><div class="card-title">Live DMC Preview</div>' +
      '<div class="card-sub">' + esc(student.name) + ' — ' + esc(exam.name) + '</div></div>' +
      '<span>' + resultBadge(r.result) + '</span></div>' +
      '<div class="card-body"><div class="mca-preview-sheet" style="box-shadow:none;border:1px solid var(--color-border)">' +
      previewHtml + '</div>' +
      '<div class="bar-actions" style="margin-top:14px">' +
        '<button type="button" class="btn btn-outline" id="dmcPreview"><i class="fa-solid fa-eye"></i> Full Preview</button>' +
        '<button type="button" class="btn btn-primary" id="dmcPrint"><i class="fa-solid fa-print"></i> Print / Save PDF</button>' +
      '</div></div></div>';
    host.innerHTML = snapshot;
    host.querySelector('#dmcPreview').addEventListener('click', async () => {
      Print.preview(dmcPage(exam, await studentWithPhoto(student)), false);
    });
    host.querySelector('#dmcPrint').addEventListener('click', async () => {
      Print.print(dmcPage(exam, await studentWithPhoto(student)), false);
    });
  }

  /* ------------------------------------------------------------------------
     8. Print DMC (batch)
     ------------------------------------------------------------------------ */
  function renderPrintDmc() {
    const host = document.getElementById('examContent');
    const exams = store.exams().filter(e => e.status !== 'archived');
    const examVal = (document.getElementById('pdmcExamSel') || {}).value || selectedExamId;
    const exam = examVal ? examById(examVal) : null;

    const picker =
      '<div class="filter-bar">' +
        '<div class="filter-item wide"><label class="form-label" for="pdmcExamSel">Examination</label>' +
          '<select class="form-select" id="pdmcExamSel"><option value="">Select examination</option>' +
          exams.map(e => '<option value="' + e.id + '"' + (e.id === examVal ? ' selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.className) + '</option>').join('') +
          '</select></div>' +
        (exam ?
          '<div class="filter-actions">' +
            '<label class="check-row" style="margin:0"><input type="checkbox" id="pdmcAll" checked> Select all</label>' +
            '<button type="button" class="btn btn-primary" id="pdmcPrint"><i class="fa-solid fa-print"></i> Print Selected DMCS</button>' +
          '</div>' : '') +
      '</div>';

    if (!exam) {
      host.innerHTML = picker +
        '<div class="card">' + UI.emptyState('Choose an examination', 'Select the examination whose students you want to print DMCS for.', 'fa-print') + '</div>';
      document.getElementById('pdmcExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('pdmcExamSel').value; renderPrintDmc(); });
      return;
    }
    selectedExamId = exam.id;

    const students = classStudents(exam.className);
    const rows = students.map(s =>
      '<label class="pdmcRow check-row" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--color-border);border-radius:8px">' +
        '<input type="checkbox" class="pdmcChk" value="' + s.id + '" checked>' +
        '<span style="flex:1">' + esc((s.rollNo != null && s.rollNo !== '' ? s.rollNo + ' · ' : '') + s.name) + '</span>' +
        '<span class="muted num">' + esc(s.studentId || '') + '</span>' +
        '<span>' + resultBadge(computeResult(exam, s).result) + '</span>' +
      '</label>').join('');

    host.innerHTML = picker +
      '<div class="card"><div class="card-header"><div><div class="card-title">Students — ' + esc(exam.name) + '</div>' +
        '<div class="card-sub">' + esc(exam.className) + ' &middot; ' + students.length + ' student(s). Tick the ones to print.</div></div></div>' +
        '<div class="card-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px">' +
          (rows || '<span class="muted">No students in this class.</span>') +
        '</div></div>';

    document.getElementById('pdmcExamSel').addEventListener('change', () => { selectedExamId = document.getElementById('pdmcExamSel').value; renderPrintDmc(); });
    const all = document.getElementById('pdmcAll');
    if (all) all.addEventListener('change', () => {
      document.querySelectorAll('.pdmcChk').forEach(c => c.checked = all.checked);
    });
    document.getElementById('pdmcPrint').addEventListener('click', async () => {
      const checked = Array.from(document.querySelectorAll('.pdmcChk:checked'));
      if (!checked.length) { toast('Select at least one student.', 'warning'); return; }
      const pages = [];
      for (const c of checked) {
        const student = students.find(s => s.id === c.value);
        if (!student) continue;
        pages.push(dmcPage(exam, await studentWithPhoto(student)));
      }
      Print.preview(pages.join(''), false);
    });
  }

  /* ------------------------------------------------------------------------
     9. Reports
     ------------------------------------------------------------------------ */
  function renderReports() {
    const host = document.getElementById('examContent');
    const exams = store.exams().filter(e => e.status !== 'archived');
    const examVal = (document.getElementById('repExamSel') || {}).value || '';

    const picker =
      '<div class="filter-bar">' +
        '<div class="filter-item wide"><label class="form-label" for="repExamSel">Examination</label>' +
          '<select class="form-select" id="repExamSel"><option value="">All examinations</option>' +
          exams.map(e => '<option value="' + e.id + '"' + (e.id === examVal ? ' selected' : '') + '>' + esc(e.name) + ' — ' + esc(e.className) + '</option>').join('') +
          '</select></div>' +
        '<div class="filter-actions">' +
          '<button type="button" class="btn btn-outline" id="repPrint"><i class="fa-solid fa-print"></i> Print Report</button>' +
          '<button type="button" class="btn btn-outline" id="repExport"><i class="fa-solid fa-file-csv"></i> Export CSV</button>' +
        '</div>' +
      '</div>';

    /* Summary across all examinations */
    const summaryRows = exams.map(e => {
      const res = classStudents(e.className).map(s => computeResult(e, s));
      const counts = { Pass: 0, Fail: 0, Absent: 0, Incomplete: 0, Withheld: 0 };
      res.forEach(r => { counts[r.result] = (counts[r.result] || 0) + 1; });
      const appeared = counts.Pass + counts.Fail + counts.Absent;
      const passRate = appeared ? round1(counts.Pass / (counts.Pass + counts.Fail) * 100) + '%' : '—';
      return '<tr>' +
        '<td class="td-main">' + esc(e.name) + '</td>' +
        '<td>' + esc(e.className) + '</td>' +
        '<td class="num">' + esc(e.academicYear || '—') + '</td>' +
        '<td class="num">' + res.length + '</td>' +
        '<td class="num">' + emerged(counts) + '</td>' +
        '<td class="num">' + counts.Pass + '</td>' +
        '<td class="num">' + counts.Fail + '</td>' +
        '<td class="num">' + passRate + '</td>' +
        '<td>' + examStatusBadge(e.status) + '</td>' +
      '</tr>';
    }).join('');

    const overview = '<div class="card"><div class="card-header"><div><div class="card-title">Examination Summary</div>' +
      '<div class="card-sub">Appeared / passed / failed across all examinations</div></div></div>' +
      '<div class="card-body flush"><div class="table-scroll"><table class="data-table"><thead><tr>' +
      '<th>Examination</th><th>Class</th><th>Session</th><th>Students</th><th>Appeared</th><th>Passed</th><th>Failed</th><th>Pass Rate</th><th>Status</th>' +
      '</tr></thead><tbody>' + (summaryRows || '<tr><td colspan="9" class="muted">No examinations yet.</td></tr>') + '</tbody></table></div></div></div>';

    host.innerHTML = picker + overview + '<div id="repDetail"></div>';
    document.getElementById('repExamSel').addEventListener('change', () => renderReports());
    document.getElementById('repPrint').addEventListener('click', () => Print.print(reportsPrintHtml(examVal), false));
    document.getElementById('repExport').addEventListener('click', () => exportReportsCsv(examVal));

    if (examVal) renderReportsDetail(examById(examVal));
  }

  function emerged(counts) {
    return (counts.Pass || 0) + (counts.Fail || 0) + (counts.Absent || 0);
  }

  function renderReportsDetail(exam) {
    const host = document.getElementById('repDetail');
    if (!exam || !host) return;
    const students = classStudents(exam.className);
    const subjects = activeSubjects(exam);
    const results = students.map(s => ({ student: s, r: computeResult(exam, s) }));
    const st = store.settings();

    /* Grade distribution */
    const gradeCounts = {};
    results.forEach(x => { const g = x.r.grade || '—'; gradeCounts[g] = (gradeCounts[g] || 0) + 1; });
    const gradeTotal = results.length;
    const gradeBars = Object.keys(gradeCounts).sort((a, b) => {
      const ra = st.grading.find(g => g.grade === a) || {}; const rb = st.grading.find(g => g.grade === b) || {};
      const ia = ra.min != null ? ra.min : 0; const ib = rb.min != null ? rb.min : 0;
      return ib - ia;
    }).map(g => {
      const n = gradeCounts[g];
      const pct = gradeTotal ? round1(n / gradeTotal * 100) : 0;
      const cls = GRADE_CLS[g] ? ' ' + GRADE_CLS[g] : '';
      return '<div class="exam-bar-row"><span class="muted">' + esc(g) + '</span>' +
        '<div class="exam-bar-track"><div class="exam-bar-fill' + cls + '" style="width:' + Math.max(pct, 2) + '%"></div></div>' +
        '<span class="exam-bar-val">' + n + ' (' + pct + '%)</span></div>';
    }).join('');

    /* Subject-wise statistics */
    const subjRows = subjects.map(sub => {
      const max = subjMax(sub);
      const pass = subjPass(sub);
      let appeared = 0, passed = 0, sum = 0;
      students.forEach(s => {
        const r = computeResult(exam, s);
        const row = r.rows.find(x => x.subject.id === sub.id);
        if (!row || row.status === '') return;
        appeared++;
        sum += row.obtained;
        if (row.result === 'Pass') passed++;
      });
      const avg = appeared ? round1(sum / appeared) : '—';
      const passRate = appeared ? round1(passed / appeared * 100) + '%' : '—';
      return '<tr>' +
        '<td class="td-main">' + esc(sub.name) + (sub.type === 'combined' ? ' (T+P)' : '') + '</td>' +
        '<td class="num">' + max + '</td>' +
        '<td class="num">' + pass + '</td>' +
        '<td class="num">' + appeared + '</td>' +
        '<td class="num">' + passed + '</td>' +
        '<td class="num">' + passRate + '</td>' +
        '<td class="num">' + avg + '</td>' +
      '</tr>';
    }).join('');

    host.innerHTML = '<div class="exam-grid-2">' +
      '<div class="card"><div class="card-header"><div><div class="card-title">Grade Distribution — ' + esc(exam.name) + '</div>' +
        '<div class="card-sub">Based on the configured grading scale</div></div></div>' +
        '<div class="card-body"><div class="exam-bars">' + (gradeBars || '<div class="muted">No results yet.</div>') + '</div></div></div>' +
      '<div class="card"><div class="card-header"><div><div class="card-title">Subject Performance — ' + esc(exam.name) + '</div>' +
        '<div class="card-sub">Per-paper averages and pass rates</div></div></div>' +
        '<div class="card-body flush"><div class="table-scroll"><table class="data-table"><thead><tr>' +
        '<th>Subject</th><th>Max</th><th>Pass</th><th>Appeared</th><th>Passed</th><th>Pass Rate</th><th>Avg Marks</th>' +
        '</tr></thead><tbody>' + (subjRows || '<tr><td colspan="7" class="muted">No subjects.</td></tr>') + '</tbody></table></div></div></div>' +
      '</div>';
  }

  function reportsPrintHtml(examVal) {
    const body = examVal
      ? buildReportsExamBody(examById(examVal))
      : buildReportsAllBody();
    return docShell('EXAMINATION REPORTS', [
      { label: 'Examination', value: examVal ? examById(examVal).name : 'All examinations' },
      { label: 'Academic Session', value: (db.sessions.active() || {}).name || '' }
    ], body);
  }

  function buildReportsAllBody() {
    const rows = store.exams().filter(e => e.status !== 'archived').map(e => {
      const res = classStudents(e.className).map(s => computeResult(e, s));
      const counts = { Pass: 0, Fail: 0, Absent: 0, Incomplete: 0, Withheld: 0 };
      res.forEach(r => { counts[r.result] = (counts[r.result] || 0) + 1; });
      const appeared = emerged(counts);
      return '<tr><td>' + esc(e.name) + '</td><td>' + esc(e.className) + '</td><td>' + appeared + '</td>' +
        '<td>' + counts.Pass + '</td><td>' + counts.Fail + '</td></tr>';
    }).join('');
    return '<div class="mca-doc-section">Examination Summary</div>' +
      '<table class="mca-table"><thead><tr><th>Examination</th><th>Class</th><th>Appeared</th><th>Passed</th><th>Failed</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" class="mca-center">No examinations.</td></tr>') + '</tbody></table>';
  }

  function buildReportsExamBody(exam) {
    const rows = classStudents(exam.className).map(s => {
      const r = computeResult(exam, s);
      return '<tr>' +
        '<td>' + esc(s.studentId) + '</td>' +
        '<td>' + esc((s.rollNo != null && s.rollNo !== '' ? s.rollNo : '—')) + '</td>' +
        '<td>' + esc(s.name) + '</td>' +
        '<td>' + r.totalMax + '</td>' +
        '<td>' + (r.result === 'Incomplete' || r.result === 'Withheld' ? '—' : r.totalObtained) + '</td>' +
        '<td>' + (r.result === 'Incomplete' || r.result === 'Withheld' ? '—' : r.percentage + '%') + '</td>' +
        '<td>' + esc(r.grade || '—') + '</td>' +
        '<td>' + esc(r.result) + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="mca-doc-section">Result Sheet — ' + esc(exam.name) + '</div>' +
      '<table class="mca-table">' +
      '<thead><tr><th>Student ID</th><th>Roll</th><th>Name</th><th>Max</th><th>Obtained</th><th>%</th><th>Grade</th><th>Result</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="8" class="mca-center">No students.</td></tr>') + '</tbody></table>' +
      '<p class="mca-note">Figures are calculated from saved marks. Blank/incomplete papers are not totalled.</p>';
  }

  function exportReportsCsv(examVal) {
    const rows = [['Examination', 'Class', 'Student ID', 'Roll', 'Student Name', 'Total Max', 'Obtained', 'Percentage', 'Grade', 'Result']];
    const exams = examVal ? [examById(examVal)] : store.exams().filter(e => e.status !== 'archived');
    exams.forEach(e => {
      classStudents(e.className).forEach(s => {
        const r = computeResult(e, s);
        rows.push([e.name, e.className, s.studentId, s.rollNo, s.name,
          r.totalMax, r.totalObtained, (r.result === 'Incomplete' || r.result === 'Withheld' ? '—' : r.percentage + '%'), r.grade, r.result]);
      });
    });
    UI.exportCSV('examination-reports.csv', rows);
  }

  /* ------------------------------------------------------------------------
     10. Examination Settings
     ------------------------------------------------------------------------ */
  function renderSettings() {
    const host = document.getElementById('examContent');
    const st = store.settings();

    const gradeRows = (st.grading || []).map((g, i) =>
      '<div class="gradeRow" style="display:grid;grid-template-columns:70px 80px 80px 1fr 40px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--color-border)">' +
        '<input class="form-input" type="text" data-g="grade" value="' + esc(g.grade) + '" placeholder="Grade">' +
        '<input class="form-input" type="number" step="0.01" data-g="min" value="' + esc(g.min) + '">' +
        '<input class="form-input" type="number" step="0.01" data-g="max" value="' + esc(g.max) + '">' +
        '<input class="form-input" type="text" data-g="remark" value="' + esc(g.remark || '') + '" placeholder="Remark">' +
        '<button type="button" class="icon-btn danger" data-grm="' + i + '"><i class="fa-solid fa-trash-can"></i></button>' +
      '</div>').join('');
    void gradeRows;

    const gradingBlock =
      '<div class="card"><div class="card-header"><div><div class="card-title">Grading Scale</div>' +
        '<div class="card-sub">Percentage ranges that map to a letter grade (Peshawar Board policy is NOT hardcoded — adjust freely)</div></div></div>' +
        '<div class="card-body">' +
        '<div style="display:grid;grid-template-columns:70px 80px 80px 1fr 40px;gap:8px;padding-bottom:6px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--color-text-muted)">' +
          '<span>Grade</span><span>Min %</span><span>Max %</span><span>Remark</span><span></span></div>' +
        '<div id="gradeList">' + gradeRows + '</div>' +
        '<div class="bar-actions" style="margin-top:10px">' +
          '<button type="button" class="btn btn-outline btn-sm" id="addGradeBtn"><i class="fa-solid fa-plus"></i> Add Band</button>' +
        '</div>' +
        '<div class="check-row" style="margin-top:12px">' +
          '<input type="checkbox" id="stPos' + '" ' + (st.positionEnabled ? 'checked' : '') + '> Enable class position (rank) on DMCs and results' +
        '</div>' +
        '<div class="check-row">' +
          '<input type="checkbox" id="stGrade' + '" ' + (st.gradeEnabled ? 'checked' : '') + '> Show letter grades on DMCs and results' +
        '</div>' +
      '</div></div>';

    const defaultsBlock =
      '<div class="card"><div class="card-header"><div><div class="card-title">Defaults &amp; Pass Rules</div>' +
        '<div class="card-sub">Used when new subjects are added to the catalog</div></div></div>' +
        '<div class="card-body"><div class="form-grid">' +
          '<div class="form-group"><label class="form-label" for="stDefMax">Default Max Marks</label><input class="form-input" type="number" min="0" id="stDefMax" value="' + esc(st.defaultMax) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="stDefPass">Default Pass Marks</label><input class="form-input" type="number" min="0" id="stDefPass" value="' + esc(st.defaultPass) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="stPassPct">Overall Pass % (info only)</label><input class="form-input" type="number" min="0" max="100" id="stPassPct" value="' + esc(st.passPercent) + '"></div>' +
          '<div class="form-group"><label class="form-label" for="stRegPrefix">DMC Registration Prefix</label><input class="form-input" type="text" id="stRegPrefix" value="' + esc(st.registrationPrefix || '') + '" placeholder="e.g. MCC/2026"></div>' +
        '</div></div></div>';

    const dmcBlock =
      '<div class="card"><div class="card-header"><div><div class="card-title">DMC Appearance</div>' +
        '<div class="card-sub">Header note, signatures and footer text printed on every certificate</div></div></div>' +
        '<div class="card-body"><div class="form-grid">' +
          '<div class="form-group span-2"><label class="form-label" for="stHeaderNote">Header Note (under college name)</label>' +
            '<input class="form-input" type="text" id="stHeaderNote" value="' + esc(st.headerNote || '') + '" placeholder="e.g. Recognized by the Education Department, Khyber Pakhtunkhwa"></div>' +
          '<div class="form-group span-2"><label class="form-label" for="stNote">DMC Footer Note</label>' +
            '<textarea class="form-textarea" id="stNote" rows="2">' + esc(st.dmcNote || '') + '</textarea></div>' +
          '<div class="form-group span-2"><label class="form-label">Signature labels (comma separated)</label>' +
            '<input class="form-input" type="text" id="stSigns" value="' + esc((st.signatures || []).join(', ')) + '"></div>' +
          '<div class="form-group span-2"><label class="form-label" for="stStamp">Stamp Area Label</label>' +
            '<input class="form-input" type="text" id="stStamp" value="' + esc(st.stampLabel || '') + '"></div>' +
        '</div></div></div>';

    const remarksBlock =
      '<div class="card"><div class="card-header"><div><div class="card-title">Result Remarks</div>' +
        '<div class="card-sub">Words shown next to each final result</div></div></div>' +
        '<div class="card-body"><div class="form-grid">' +
          ['pass', 'fail', 'absent', 'incomplete', 'withheld'].map(k =>
            '<div class="form-group"><label class="form-label" for="stRm' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + '</label>' +
            '<input class="form-input" type="text" id="stRm' + k + '" value="' + esc((st.resultRemarks || {})[k] || '') + '"></div>').join('') +
        '</div></div></div>';

    host.innerHTML =
      '<div class="exam-grid-2">' +
        '<div>' + gradingBlock + defaultsBlock + '</div>' +
        '<div>' + dmcBlock + remarksBlock + '</div>' +
      '</div>' +
      '<div class="page-actions" style="justify-content:flex-end;margin-top:14px">' +
        '<button type="button" class="btn btn-primary" id="stSave"><i class="fa-solid fa-floppy-disk"></i> Save Examination Settings</button>' +
      '</div>';

    document.getElementById('addGradeBtn').addEventListener('click', () => {
      const list = document.getElementById('gradeList');
      const row = document.createElement('div');
      row.className = 'gradeRow';
      row.style.cssText = 'display:grid;grid-template-columns:70px 80px 80px 1fr 40px;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--color-border)';
      row.innerHTML =
        '<input class="form-input" type="text" data-g="grade" placeholder="Grade">' +
        '<input class="form-input" type="number" step="0.01" data-g="min" placeholder="Min">' +
        '<input class="form-input" type="number" step="0.01" data-g="max" placeholder="Max">' +
        '<input class="form-input" type="text" data-g="remark" placeholder="Remark">' +
        '<button type="button" class="icon-btn danger" data-grm><i class="fa-solid fa-trash-can"></i></button>';
      list.appendChild(row);
      row.querySelector('[data-grm]').addEventListener('click', () => row.remove());
    });
    document.querySelectorAll('#gradeList [data-grm]').forEach(b => b.addEventListener('click', () => b.closest('.gradeRow').remove()));

    document.getElementById('stSave').addEventListener('click', () => {
      const grading = Array.from(document.querySelectorAll('#gradeList .gradeRow')).map(row => {
        const g = row.querySelector('[data-g="grade"]');
        const min = row.querySelector('[data-g="min"]');
        const max = row.querySelector('[data-g="max"]');
        const remark = row.querySelector('[data-g="remark"]');
        return {
          grade: g.value.trim() || '—',
          min: Number(min.value),
          max: Number(max.value),
          remark: remark.value.trim()
        };
      }).filter(g => g.grade !== '—' && !isNaN(g.min) && !isNaN(g.max));
      if (!grading.length) { toast('Add at least one valid grade band.', 'warning'); return; }
      grading.sort((a, b) => Number(a.min) - Number(b.min));

      const next = Object.assign({}, st, {
        grading: grading,
        defaultMax: Number(document.getElementById('stDefMax').value) || 100,
        defaultPass: Number(document.getElementById('stDefPass').value) || 40,
        passPercent: Number(document.getElementById('stPassPct').value) || 0,
        registrationPrefix: document.getElementById('stRegPrefix').value.trim(),
        headerNote: document.getElementById('stHeaderNote').value.trim(),
        dmcNote: document.getElementById('stNote').value.trim(),
        signatures: String(document.getElementById('stSigns').value).split(',').map(s => s.trim()).filter(Boolean),
        stampLabel: document.getElementById('stStamp').value.trim() || 'Official College Stamp',
        positionEnabled: document.getElementById('stPos').checked,
        gradeEnabled: document.getElementById('stGrade').checked,
        resultRemarks: {
          pass: document.getElementById('stRmpass').value.trim(),
          fail: document.getElementById('stRmfail').value.trim(),
          absent: document.getElementById('stRmabsent').value.trim(),
          incomplete: document.getElementById('stRmincomplete').value.trim(),
          withheld: document.getElementById('stRmwithheld').value.trim()
        }
      });
      store.saveSettings(next);
      toast('Examination settings saved.', 'success');
    });
  }

  /* ------------------------------------------------------------------------
     Init
     ------------------------------------------------------------------------ */
  function init() {
    const host = document.getElementById('examTabbar');
    if (!host) return;
    const params = new URLSearchParams(window.location.search);
    activeTab = params.get('tab') || 'dashboard';
    if (!TAB_DEFS.some(t => t.key === activeTab)) activeTab = 'dashboard';
    const examParam = params.get('exam');
    if (examParam) selectedExamId = examParam;

    renderTabbar();
    host.addEventListener('click', e => {
      const btn = e.target.closest('[data-etab]');
      if (btn) switchTab(btn.dataset.etab);
    });
    render();
  }

  function render() {
    const host = document.getElementById('examContent');
    if (!host) return;
    /* Start fresh every switch so leftover bindings never leak. */
    host.innerHTML = '';
    switch (activeTab) {
      case 'dashboard': renderDashboard(); break;
      case 'create': renderCreate(); break;
      case 'schedule': renderSchedule(); bindScheduleCalendar(); break;
      case 'subjects': renderSubjects(); break;
      case 'marks': renderMarks(); break;
      case 'results': renderResults(); break;
      case 'dmc': renderDmc(); break;
      case 'printdmc': renderPrintDmc(); break;
      case 'reports': renderReports(); break;
      case 'settings': renderSettings(); break;
      default: renderDashboard(); activeTab = 'dashboard'; renderTabbar();
    }
    window.scrollTo({ top: 0 });
  }

  onAppReady(init);

  window.Exams = {
    /* public API — also convenient for console debugging + future wiring */
    KEYS: KEYS,
    store: store,
    computeResult: computeResult,
    positionsFor: positionsFor,
    buildDmc: buildDmc,
    dmcPage: dmcPage,
    goTab: goTab,
    render: render
  };

})();