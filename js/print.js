/* ==========================================================================
   print.js — shared printable-document engine
   --------------------------------------------------------------------------
   Builds official college documents (student lists, daily attendance sheets,
   monthly registers) into a hidden #mca-print-area and opens the browser's
   print dialog. While printing, body.mca-print-active hides the app chrome so
   only the document is rendered. Portrait for lists / daily sheets, landscape
   for the monthly register.
   ========================================================================== */

'use strict';

(function () {

  const CHECK = '<span class="mca-check">&#10003;</span>';
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function pad(n) { return String(n).padStart(2, '0'); }

  function sessionName() {
    const active = db.sessions.active();
    if (active && active.name) return active.name;
    const settings = db.settings.get();
    return (settings && settings.academicSession) || '';
  }

  function collegeName() {
    const settings = db.settings.get();
    return (settings.college && settings.college.name) || 'Muslim Commerce College Peshawar';
  }

  /* The shared letterhead + meta chips + body wrapper. */
  function documentShell(title, metaItems, bodyHtml, footerHtml) {
    const meta = metaItems
      .filter(item => item && item.value !== '' && item.value != null)
      .map(item =>
        '<span class="mca-meta-item"><span class="mca-meta-label">' + Utils.esc(item.label) + '</span>' +
        '<span class="mca-meta-value">' + Utils.esc(item.value) + '</span></span>')
      .join('');

    return '<div class="mca-doc">' +
      '<header class="mca-doc-head">' +
        '<img class="mca-doc-logo" src="assets/logo.png" alt="">' +
        '<div class="mca-doc-head-text">' +
          '<div class="mca-doc-college">' + Utils.esc(collegeName().toUpperCase()) + '</div>' +
          '<div class="mca-doc-title">' + Utils.esc(title) + '</div>' +
        '</div>' +
      '</header>' +
      (meta ? '<div class="mca-doc-meta">' + meta + '</div>' : '') +
      '<div class="mca-doc-body">' + bodyHtml + '</div>' +
      (footerHtml || '') +
    '</div>';
  }

  function signatures() {
    return '<div class="mca-doc-sign">' +
      '<div class="mca-sign"><span class="mca-sign-line"></span>Teacher Signature</div>' +
      '<div class="mca-sign"><span class="mca-sign-line"></span>Principal Signature</div>' +
      '</div>' +
      '<div class="mca-doc-printdate">Printed on ' + Utils.esc(Utils.fmtDate(Utils.pkToday())) +
      ' at ' + Utils.esc(Utils.pkClock()) + '</div>';
  }

  /* ---------- run / cleanup ---------- */

  function ensureArea() {
    let area = document.getElementById('mca-print-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'mca-print-area';
      area.setAttribute('aria-hidden', 'true');
      document.body.appendChild(area);
    }
    return area;
  }

  function run(html, landscape) {
    const area = ensureArea();
    area.innerHTML = html;

    let pageStyle = document.getElementById('mca-print-page');
    if (!pageStyle) {
      pageStyle = document.createElement('style');
      pageStyle.id = 'mca-print-page';
      document.head.appendChild(pageStyle);
    }
    pageStyle.textContent =
      '@page { size: A4 ' + (landscape ? 'landscape' : 'portrait') + '; margin: 12mm 10mm; }';

    document.body.classList.add('mca-print-active');

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('mca-print-active');
      area.innerHTML = '';
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    /* Small delay lets the images/layout settle before the dialog opens.
       window.print() blocks until the dialog closes on desktop browsers, so
       the fallback cleanup below only fires if afterprint never does. */
    setTimeout(() => {
      try { window.print(); } finally { setTimeout(cleanup, 800); }
    }, 80);
  }

  /* ---------- Feature 2: student list ---------- */

  function studentList(opts) {
    const students = (opts && opts.students) || [];
    const include = (opts && opts.include) || {};
    const className = (opts && opts.className) || '';

    const headers = ['No.', 'Student ID', 'Student Name', 'Father’s Name', 'Class'];
    if (include.roll) headers.push('Roll No.');
    if (include.phone) headers.push('Contact Number');
    if (include.address) headers.push('Address');

    const rows = students.map((s, i) => {
      const cls = s.class + (s.section ? ' — Section ' + s.section : '');
      const cells = [
        String(i + 1), s.studentId || '', s.name || '', s.fatherName || '', cls
      ];
      if (include.roll) cells.push(s.rollNo !== '' && s.rollNo != null ? String(s.rollNo) : '—');
      if (include.phone) {
        const contact = [s.mobile, s.phoneRes || s.phone].filter(Boolean).join(' / ');
        cells.push(contact || '—');
      }
      if (include.address) cells.push(s.address || '—');
      return '<tr>' + cells.map((c, idx) =>
        '<td' + (idx === 0 ? ' class="mca-center"' : '') + '>' + Utils.esc(c) + '</td>').join('') + '</tr>';
    }).join('');

    const bodyHtml =
      '<table class="mca-table">' +
        '<thead><tr>' + headers.map(h => '<th>' + Utils.esc(h) + '</th>').join('') + '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="' + headers.length + '" class="mca-center">No students</td></tr>') + '</tbody>' +
      '</table>';

    const meta = [
      { label: 'Academic Session', value: sessionName() },
      { label: 'Class', value: className || 'All Classes' },
      { label: 'Total Students', value: String(students.length) },
      { label: 'Print Date', value: Utils.fmtDate(Utils.pkToday()) }
    ];

    run(documentShell('OFFICIAL STUDENT LIST', meta, bodyHtml,
      '<div class="mca-doc-sign"><div class="mca-sign"><span class="mca-sign-line"></span>Class Teacher</div>' +
      '<div class="mca-sign"><span class="mca-sign-line"></span>Principal</div></div>' +
      '<div class="mca-doc-printdate">Printed on ' + Utils.esc(Utils.fmtDate(Utils.pkToday())) +
      ' at ' + Utils.esc(Utils.pkClock()) + '</div>'), false);
  }

  /* ---------- Feature 3: daily attendance sheet ---------- */

  function dailyAttendance(opts) {
    const o = opts || {};
    const roster = o.roster || [];

    const rows = roster.map((e, i) => {
      const cell = st => (e.status === st ? '<td class="mca-center mca-mark">' + CHECK + '</td>' : '<td class="mca-center"></td>');
      return '<tr>' +
        '<td class="mca-center">' + (i + 1) + '</td>' +
        '<td>' + Utils.esc(e.studentId || '') + '</td>' +
        '<td>' + Utils.esc(e.name || '') + '</td>' +
        '<td>' + Utils.esc(e.fatherName || '') + '</td>' +
        cell('present') + cell('absent') + cell('leave') +
      '</tr>';
    }).join('');

    const counts = { present: 0, absent: 0, leave: 0 };
    roster.forEach(e => { if (e.status) counts[e.status]++; });
    const marked = counts.present + counts.absent + counts.leave;
    const rate = marked ? Utils.pct(counts.present, marked) + '%' : '—';

    const bodyHtml =
      '<table class="mca-table">' +
        '<thead><tr>' +
          '<th>No.</th><th>Student ID</th><th>Student Name</th><th>Father’s Name</th>' +
          '<th>Present</th><th>Absent</th><th>Leave</th>' +
        '</tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7" class="mca-center">No students</td></tr>') + '</tbody>' +
      '</table>' +
      '<div class="mca-summary">' +
        '<span><b>Total Students:</b> ' + roster.length + '</span>' +
        '<span><b>Present:</b> ' + counts.present + '</span>' +
        '<span><b>Absent:</b> ' + counts.absent + '</span>' +
        '<span><b>Leave:</b> ' + counts.leave + '</span>' +
        '<span><b>Attendance:</b> ' + rate + '</span>' +
      '</div>' +
      (marked ? '' : '<p class="mca-note">Attendance has not been recorded for this date — this is a blank sheet for manual marking.</p>');

    const meta = [
      { label: 'Academic Session', value: sessionName() },
      { label: 'Class', value: (o.className || '') + (o.section ? ' — Section ' + o.section : '') },
      { label: 'Date', value: o.date ? Utils.fmtDate(o.date) : '' },
      { label: 'Subject', value: o.subject || '' }
    ];

    run(documentShell('DAILY ATTENDANCE SHEET', meta, bodyHtml, signatures()), false);
  }

  /* ---------- Feature 4: monthly attendance register ---------- */

  /* When a day has several sessions, one mark is shown using the most serious
     status (absent > leave > present). */
  function pickStatus(current, next) {
    const rank = { present: 1, leave: 2, absent: 3 };
    if (!current) return next;
    return (rank[next] || 0) > (rank[current] || 0) ? next : current;
  }

  function monthlyAttendance(opts) {
    const o = opts || {};
    const className = o.className || '';
    const section = o.section || '';
    const year = Number(o.year);
    const month = Number(o.month);

    if (!className || !year || !month) return;

    const prefix = year + '-' + pad(month) + '-';
    const days = new Date(year, month, 0).getDate();

    const records = db.attendance.all().filter(r =>
      r.className === className && (!section || r.section === section) &&
      String(r.date).slice(0, 7) === year + '-' + pad(month));

    const byStudent = {};
    records.forEach(r => {
      const day = Number(String(r.date).slice(8, 10));
      (r.entries || []).forEach(e => {
        if (!byStudent[e.studentId]) byStudent[e.studentId] = {};
        byStudent[e.studentId][day] = pickStatus(byStudent[e.studentId][day], e.status);
      });
    });

    const students = db.students.active()
      .filter(s => s.class === className && (!section || s.section === section))
      .sort(db.students.idCompare);

    const head =
      '<tr><th>Roll / ID</th><th class="mca-name-col">Student Name</th>' +
      Array.from({ length: days }, (_, i) => '<th>' + (i + 1) + '</th>').join('') +
      '<th>P</th><th>A</th><th>L</th><th>%</th></tr>';

    const letter = { present: 'P', absent: 'A', leave: 'L' };

    const rows = students.map(s => {
      const map = byStudent[s.studentId] || {};
      const counts = { P: 0, A: 0, L: 0 };
      const dayCells = Array.from({ length: days }, (_, i) => {
        const st = map[i + 1];
        if (!st) return '<td class="mca-center mca-nr">–</td>';
        counts[letter[st]]++;
        return '<td class="mca-center mca-' + st + '">' + letter[st] + '</td>';
      }).join('');
      const total = counts.P + counts.A + counts.L;
      const pct = total ? Utils.pct(counts.P, total) + '%' : '–';
      const id = (s.rollNo !== '' && s.rollNo != null) ? s.rollNo : (s.studentId || '');
      return '<tr>' +
        '<td>' + Utils.esc(id) + '</td>' +
        '<td class="mca-name-col">' + Utils.esc(s.name || '') + '</td>' +
        dayCells +
        '<td class="mca-center">' + counts.P + '</td>' +
        '<td class="mca-center">' + counts.A + '</td>' +
        '<td class="mca-center">' + counts.L + '</td>' +
        '<td class="mca-center">' + pct + '</td>' +
      '</tr>';
    }).join('');

    const bodyHtml =
      '<table class="mca-table mca-table-register">' +
        '<thead>' + head + '</thead>' +
        '<tbody>' + (rows || '<tr><td colspan="' + (days + 6) + '" class="mca-center">No students</td></tr>') + '</tbody>' +
      '</table>' +
      '<p class="mca-note">P = Present · A = Absent · L = Leave · – = No record. ' +
      'Percentage is calculated over recorded sessions.</p>';

    const meta = [
      { label: 'Academic Session', value: sessionName() },
      { label: 'Class', value: className + (section ? ' — Section ' + section : '') },
      { label: 'Month', value: MONTHS[month - 1] + ' ' + year },
      { label: 'Recorded Days', value: String(Object.keys(records.reduce((a, r) => { a[r.date] = 1; return a; }, {})).length) }
    ];

    run(documentShell('MONTHLY ATTENDANCE REGISTER', meta, bodyHtml, signatures()), true);
  }

  /* ---------- Feature 5: individual student attendance report ---------- */

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const STATUS_LABEL = { present: 'Present', absent: 'Absent', leave: 'Leave' };

  function dayName(iso) {
    const p = String(iso || '').split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? '' : DAY_NAMES[d.getDay()];
  }

  /* Any value a student may legitimately not have shows as “Not Provided”. */
  function notProvided(value) {
    if (value === undefined || value === null) return 'Not Provided';
    const text = String(value).trim();
    if (!text || text === 'undefined' || text === 'null' || text === 'NaN') return 'Not Provided';
    return text;
  }

  function rollLabel(student) {
    return (student && student.rollNo !== '' && student.rollNo != null)
      ? String(student.rollNo) : 'Not Provided';
  }

  function classLabel(student) {
    if (!student) return '';
    return student.class + (student.section ? ' — Section ' + student.section : '');
  }

  function sectionTitle(text) {
    return '<div class="mca-doc-section">' + Utils.esc(text) + '</div>';
  }

  /* Two-column Field / Information table used by the profile + report. */
  function infoTable(pairs) {
    return '<table class="mca-table mca-info-table"><tbody>' +
      pairs.map(p => '<tr><th>' + Utils.esc(p[0]) + '</th><td>' + Utils.esc(p[1]) + '</td></tr>').join('') +
      '</tbody></table>';
  }

  /* The report's records for one student, filtered to the chosen period and
     sorted oldest-first. Dates without a record are simply absent — they are
     never counted as absent. */
  function studentRecords(student, from, to) {
    return db.attendance.byStudent(student.studentId)
      .filter(r => (!from || r.date >= from) && (!to || r.date <= to))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function buildStudentAttendance(opts) {
    const o = opts || {};
    const student = o.student;
    if (!student) return '';

    const from = o.from || '';
    const to = o.to || '';
    const periodLabel = o.periodLabel || 'All records';

    const records = studentRecords(student, from, to);
    const counts = { present: 0, absent: 0, leave: 0 };

    const rows = records.map((rec, i) => {
      const entry = (rec.entries || []).find(e => String(e.studentId) === String(student.studentId));
      const status = entry ? entry.status : '';
      if (counts[status] != null) counts[status]++;
      return '<tr>' +
        '<td class="mca-center">' + (i + 1) + '</td>' +
        '<td class="mca-nowrap">' + Utils.esc(Utils.fmtDateShort(rec.date)) + '</td>' +
        '<td>' + Utils.esc(dayName(rec.date)) + '</td>' +
        '<td>' + Utils.esc(rec.subject || '—') + '</td>' +
        '<td class="mca-center mca-status-' + Utils.esc(status) + '">' +
          Utils.esc(STATUS_LABEL[status] || '—') + '</td>' +
      '</tr>';
    }).join('');

    const total = records.length;
    const rate = total ? Utils.pct(counts.present, total) + '%' : '—';

    const info = infoTable([
      ['Student Name', student.name],
      ['Father’s Name', notProvided(student.fatherName)],
      ['Student ID', notProvided(student.studentId)],
      ['Roll Number', rollLabel(student)],
      ['Class', classLabel(student)],
      ['Academic Session', notProvided(student.session)],
      ['Report Period', periodLabel]
    ]);

    const summary = '<div class="mca-summary">' +
      '<span><b>Total Recorded Sessions:</b> ' + total + '</span>' +
      '<span><b>Total Present:</b> ' + counts.present + '</span>' +
      '<span><b>Total Absent:</b> ' + counts.absent + '</span>' +
      '<span><b>Total Leave:</b> ' + counts.leave + '</span>' +
      '<span><b>Attendance Percentage:</b> ' + rate + '</span>' +
    '</div>';

    const table = '<table class="mca-table">' +
      '<thead><tr>' +
        '<th class="mca-center">No.</th><th>Date</th><th>Day</th><th>Subject</th>' +
        '<th class="mca-center">Status</th>' +
      '</tr></thead>' +
      '<tbody>' + (rows ||
        '<tr><td colspan="5" class="mca-center">No attendance records available for the selected period.</td></tr>') +
      '</tbody>' +
    '</table>';

    const bodyHtml =
      sectionTitle('Student Information') + info +
      sectionTitle('Attendance Summary') + summary +
      sectionTitle('Detailed Attendance') + table;

    return documentShell('INDIVIDUAL STUDENT ATTENDANCE REPORT', [], bodyHtml, signatures());
  }

  /* ---------- Feature 6: student profile / portfolio ---------- */

  function signItem(label) {
    return '<div class="mca-sign"><span class="mca-sign-line"></span>' + Utils.esc(label) + '</div>';
  }

  function profileShell(title, student, bodyHtml) {
    const photo = student && student.photo ? student.photo
      : (window.Photos && student ? Photos.src(student) : '');
    return '<div class="mca-doc">' +
      '<header class="mca-doc-head mca-doc-head-profile">' +
        '<img class="mca-doc-logo" src="assets/logo.png" alt="">' +
        '<div class="mca-doc-head-text">' +
          '<div class="mca-doc-college">' + Utils.esc(collegeName().toUpperCase()) + '</div>' +
          '<div class="mca-doc-title">' + Utils.esc(title) + '</div>' +
        '</div>' +
        '<div class="mca-doc-photo">' +
          (photo
            ? '<img src="' + Utils.esc(photo) + '" alt="">'
            : '<span class="mca-photo-initials">' + Utils.esc(Utils.initials(student && student.name)) + '</span>') +
        '</div>' +
      '</header>' + bodyHtml + '</div>';
  }

  function enrollmentStatus(student) {
    if (db.students.isArchived(student)) return 'Archived';
    return String(student.status || 'active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active';
  }

  function buildStudentProfile(student) {
    if (!student) return '';
    const cls = classLabel(student);

    const personal = infoTable([
      ['Student Name', student.name],
      ['Father’s Name', notProvided(student.fatherName)],
      ['Student ID', notProvided(student.studentId)],
      ['Roll Number', rollLabel(student)],
      ['Class', cls],
      ['Academic Session', notProvided(student.session)],
      ['Admission Date', student.admissionDate ? Utils.fmtDate(student.admissionDate) : 'Not Provided'],
      ['Contact Number', notProvided(student.mobile)],
      ['Residential Phone', notProvided(student.phoneRes || student.phone)],
      ['Permanent Address', notProvided(student.address)]
    ]);

    const academic = infoTable([
      ['Class', cls],
      ['Student ID', notProvided(student.studentId)],
      ['Current Roll Number', rollLabel(student)],
      ['Academic Session', notProvided(student.session)],
      ['Enrollment Status', enrollmentStatus(student)]
    ]);

    const sign = '<div class="mca-doc-sign mca-sign-4">' +
      signItem('Student Signature') + signItem('Class Teacher Signature') +
      signItem('Principal Signature') + signItem('Date') + '</div>';

    const footer = '<div class="mca-doc-footer">' +
      Utils.esc(collegeName()) + ' — Official Student Record</div>';

    return profileShell('STUDENT INFORMATION PROFILE', student,
      sectionTitle('Personal Information') + personal +
      sectionTitle('Academic Information') + academic +
      sign + footer);
  }

  /* ---------- On-screen preview (before the browser print dialog) ---------- */

  function closePreview() {
    const el = document.getElementById('mcaPreview');
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (!document.querySelector('.modal-backdrop.open')) {
      document.body.classList.remove('modal-open');
    }
  }

  function preview(html, landscape) {
    closePreview();
    const backdrop = document.createElement('div');
    backdrop.className = 'mca-preview-backdrop';
    backdrop.id = 'mcaPreview';
    backdrop.innerHTML =
      '<div class="mca-preview-bar no-print">' +
        '<span><i class="fa-solid fa-print"></i> Print preview — A4 ' +
          (landscape ? 'landscape' : 'portrait') + '</span>' +
        '<div class="mca-preview-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-preview-close>Close</button>' +
          '<button type="button" class="btn btn-primary btn-sm" data-preview-print>' +
            '<i class="fa-solid fa-print"></i> Print / Save as PDF</button>' +
        '</div>' +
      '</div>' +
      '<div class="mca-preview-scroll">' +
        '<div class="mca-preview-sheet' + (landscape ? ' landscape' : '') + '">' + html + '</div>' +
      '</div>';

    document.body.appendChild(backdrop);
    document.body.classList.add('modal-open');

    backdrop.querySelector('[data-preview-close]').addEventListener('click', closePreview);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closePreview(); });
    backdrop.querySelector('[data-preview-print]').addEventListener('click', () => {
      run(html, landscape);
    });
    backdrop.scrollTop = 0;
  }

  window.Print = {
    studentList: studentList,
    dailyAttendance: dailyAttendance,
    monthlyAttendance: monthlyAttendance,
    buildStudentAttendance: buildStudentAttendance,
    buildStudentProfile: buildStudentProfile,
    studentAttendance: function (opts) { run(buildStudentAttendance(opts), false); },
    studentProfile: function (student) { run(buildStudentProfile(student), false); },
    preview: preview,
    closePreview: closePreview,
    print: run,
    sessionName: sessionName
  };
})();
