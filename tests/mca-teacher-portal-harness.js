'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3412;
const HOST = '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'teacher-portal-data');
const AUTH_FILE = path.join(DATA_DIR, 'auth', 'users.json');
const ADMIN_EMAIL = 'admin@college.com';
const ADMIN_PASSWORD = 'admin123';

let server = null;
let logs = '';
let passed = 0;

function todayPK() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function daysAgoPK(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function check(condition, label, detail) {
  if (condition) {
    passed++;
    console.log('  ok  ' + label);
    return;
  }
  console.error('FAIL  ' + label + (detail ? ' :: ' + JSON.stringify(detail) : ''));
  throw new Error('Assertion failed: ' + label);
}

function request(method, route, options) {
  const opts = options || {};
  const body = opts.body === undefined ? null : JSON.stringify(opts.body);
  const headers = { Accept: 'application/json' };
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  if (body !== null) headers['Content-Length'] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: '/api/' + route, method, headers }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
        resolve({ status: res.statusCode, body: data, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function status(res, expected, label) {
  check(res.status === expected, label + ' -> ' + expected,
    { status: res.status, body: res.body });
  return res.body;
}

async function waitForHealth(timeoutMs) {
  const end = Date.now() + (timeoutMs || 12000);
  let lastErr = null;
  while (Date.now() < end) {
    try {
      const res = await request('GET', 'health');
      if (res.status === 200 && res.body && res.body.ok) return res.body;
    } catch (err) {
      lastErr = err;
    }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('Server did not become healthy: ' + (lastErr && lastErr.message) + '\n' + logs);
}

function startServer() {
  logs = '';
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: HOST,
      DATA_DIR: DATA_DIR,
      ADMIN_EMAIL: ADMIN_EMAIL,
      ADMIN_PASSWORD: ADMIN_PASSWORD
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => { logs += chunk.toString(); });
  server.stderr.on('data', chunk => { logs += chunk.toString(); });
  return waitForHealth();
}

function stopServer() {
  return new Promise(resolve => {
    if (!server) return resolve();
    const child = server;
    server = null;
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => resolve(), 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}

function stateKeys(adminToken) {
  return request('PUT', 'state', {
    token: adminToken,
    body: {
      keys: {
        mca_classes: [
          { id: 'class-a', name: 'Class A', sections: [], active: true },
          { id: 'class-b', name: 'Class B', sections: [], active: true }
        ],
        mca_subjects: [
          { id: 'sub_math_a', name: 'Mathematics', code: 'MATH-A', className: 'Class A', type: 'theory', marks: 100, pass: 40, order: 1, active: true },
          { id: 'sub_math_b', name: 'Mathematics', code: 'MATH-B', className: 'Class B', type: 'theory', marks: 100, pass: 40, order: 2, active: true }
        ],
        mca_students: [
          { id: 'stu_a1', studentId: 'A-001', rollNo: 1, name: 'Ahmad Ali', fatherName: 'Ali', class: 'Class A', section: '', session: '2025-2026', status: 'active' },
          { id: 'stu_a2', studentId: 'A-002', rollNo: 2, name: 'Bilal Khan', fatherName: 'Khan', class: 'Class A', section: '', session: '2025-2026', status: 'active' },
          { id: 'stu_b1', studentId: 'B-001', rollNo: 1, name: 'Sara Noor', fatherName: 'Noor', class: 'Class B', section: '', session: '2025-2026', status: 'active' }
        ],
        mca_attendance: [
          {
            id: 'att_b_admin', date: todayPK(), className: 'Class B', section: '', subject: 'Mathematics',
            entries: [{ studentId: 'B-001', rollNo: 1, status: 'present', remarks: '' }],
            submittedAt: '09:00', submittedBy: 'Administrator', source: 'admin', action: 'submitted'
          }
        ],
        mca_exams: [
          {
            id: 'exam_a', name: 'Midterm A', type: 'Midterm Examination', className: 'Class A',
            academicYear: '2025-2026', startDate: '2026-01-10', endDate: '2026-01-12',
            resultDate: '2026-01-20', status: 'ongoing',
            subjects: [{
              id: 'esub_math_a', name: 'Mathematics', code: 'MATH-A', type: 'theory',
              maxMarks: 100, passMarks: 40, active: true
            }],
            schedule: [{ date: '2026-01-10', endDate: '2026-01-10', subjectName: 'Mathematics' }]
          },
          {
            id: 'exam_b', name: 'Midterm B', type: 'Midterm Examination', className: 'Class B',
            academicYear: '2025-2026', startDate: '2026-01-11', endDate: '2026-01-13',
            resultDate: '2026-01-21', status: 'ongoing',
            subjects: [{
              id: 'esub_math_b', name: 'Mathematics', code: 'MATH-B', type: 'theory',
              maxMarks: 100, passMarks: 40, active: true
            }],
            schedule: [{ date: '2026-01-11', endDate: '2026-01-11', subjectName: 'Mathematics' }]
          }
        ],
        mca_exam_settings: {
          grading: [
            { grade: 'A', min: 80, max: 100, remark: 'Excellent' },
            { grade: 'B', min: 60, max: 79, remark: 'Good' },
            { grade: 'C', min: 40, max: 59, remark: 'Pass' },
            { grade: 'F', min: 0, max: 39, remark: 'Fail' }
          ],
          gradeEnabled: true,
          passPercent: 40,
          registrationPrefix: 'MCC-',
          signatures: ['Teacher', 'Principal'],
          stampLabel: 'Official Stamp',
          dmcNote: 'Test DMC note.'
        },
        mca_sessions: [
          { id: 's1', name: '2025-2026', start: '2025-08-01', end: '2026-07-31', active: true }
        ]
      }
    }
  });
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await startServer();

  console.log('\nServer and admin authentication');
  const health = await request('GET', 'health');
  status(health, 200, 'health');
  check(health.body.hasData === false, 'fresh data directory is empty', health.body);

  const noAuthState = await request('GET', 'state');
  status(noAuthState, 401, 'state requires authentication');

  const badAdmin = await request('POST', 'auth/login', { body: { email: ADMIN_EMAIL, password: 'wrong' } });
  status(badAdmin, 401, 'invalid admin password rejected');

  const adminLogin = await request('POST', 'auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  status(adminLogin, 200, 'admin login');
  const adminToken = adminLogin.body.token;
  check(!!adminToken, 'admin token issued');

  const seeded = await stateKeys(adminToken);
  status(seeded, 200, 'seed classes, subjects, students, exams');

  console.log('\nTeacher account management');
  const emptyTeachers = await request('GET', 'admin/teachers', { token: adminToken });
  status(emptyTeachers, 200, 'teacher list');
  check(emptyTeachers.body.total === 0, 'teacher register starts empty', emptyTeachers.body);

  const invalidClass = await request('POST', 'admin/teachers', {
    token: adminToken,
    body: {
      fullName: 'Bad Teacher', classes: ['Unknown Class'],
      subjects: ['sub_math_a'], permissions: {}
    }
  });
  status(invalidClass, 422, 'unknown assigned class rejected');

  const invalidSubject = await request('POST', 'admin/teachers', {
    token: adminToken,
    body: {
      fullName: 'Bad Teacher', classes: ['Class A'],
      subjects: ['sub_math_b'], permissions: {}
    }
  });
  status(invalidSubject, 422, 'subject outside assigned classes rejected');

  const created = await request('POST', 'admin/teachers', {
    token: adminToken,
    body: {
      fullName: 'Test Teacher',
      fatherName: 'Teacher Father',
      username: 'test.teacher',
      email: 'teacher@college.com',
      contact: '0300-0000000',
      designation: 'Lecturer',
      qualification: 'MSc',
      academicSession: '2025-2026',
      classes: ['Class A', 'Class B'],
      subjects: ['sub_math_a'],
      permissions: {
        viewStudents: true, takeAttendance: true, editAttendance: false,
        viewAttendanceReports: true, enterMarks: true, editMarks: false,
        viewResults: true, publishResults: false, generateDmc: true, viewPlanner: true
      }
    }
  });
  status(created, 201, 'create teacher account');
  const teacher = created.body.teacher;
  const tempPassword = created.body.temporaryPassword;
  check(/^TCH-\d{4,}$/.test(teacher.portalNumber), 'portal number auto-generated', teacher.portalNumber);
  check(/[A-Za-z]/.test(tempPassword) && /\d/.test(tempPassword), 'temporary password has a letter and number', tempPassword);
  check(!Object.prototype.hasOwnProperty.call(teacher, 'passwordHash'), 'API never returns password hash');
  check(!Object.prototype.hasOwnProperty.call(teacher, 'passwordSalt'), 'API never returns password salt');

  const teacherList = await request('GET', 'admin/teachers?limit=100', { token: adminToken });
  status(teacherList, 200, 'teacher list after create');
  check(teacherList.body.total === 1, 'teacher list count is one', teacherList.body);
  check(!JSON.stringify(teacherList.body).includes('passwordHash'), 'teacher list contains no hashes');

  const detail = await request('GET', 'admin/teachers/' + teacher.id, { token: adminToken });
  status(detail, 200, 'teacher detail');
  check(!JSON.stringify(detail.body).includes('passwordHash'), 'teacher detail contains no hashes');

  const adminToTeacher = await request('GET', 'teacher/me', { token: adminToken });
  status(adminToTeacher, 401, 'admin token cannot use teacher APIs');

  console.log('\nTeacher login and forced password change');
  const teacherLogin = await request('POST', 'teacher/auth/login', {
    body: { identifier: teacher.portalNumber, password: tempPassword }
  });
  status(teacherLogin, 200, 'teacher login with temporary password');
  check(teacherLogin.body.mustChangePassword === true, 'first login requires password change');
  const tempToken = teacherLogin.body.token;

  const meTemp = await request('GET', 'teacher/me', { token: tempToken });
  status(meTemp, 200, 'teacher profile while password change is pending');

  const dashTemp = await request('GET', 'teacher/dashboard', { token: tempToken });
  status(dashTemp, 403, 'dashboard blocked until password changes');
  check(dashTemp.body.code === 'password_change_required', 'password-change code returned', dashTemp.body);

  const changePass = await request('POST', 'teacher/auth/change-password', {
    token: tempToken,
    body: { currentPassword: tempPassword, newPassword: 'TeacherPass123' }
  });
  status(changePass, 200, 'teacher sets a permanent password');
  const teacherToken = changePass.body.token;
  check(changePass.body.mustChangePassword === false, 'password change clears the forced flag');

  const oldTempToken = await request('GET', 'teacher/me', { token: tempToken });
  status(oldTempToken, 401, 'previous token revoked after password change');

  const teacherToAdmin = await request('GET', 'admin/stats', { token: teacherToken });
  status(teacherToAdmin, 401, 'teacher token cannot use admin APIs');

  const teacherToState = await request('GET', 'state', { token: teacherToken });
  status(teacherToState, 401, 'teacher token cannot read admin state');

  const dash = await request('GET', 'teacher/dashboard', { token: teacherToken });
  status(dash, 200, 'teacher dashboard after password change');

  console.log('\nTeacher data scoping');
  const students = await request('GET', 'teacher/students', { token: teacherToken });
  status(students, 200, 'teacher student list');
  check(students.body.total === 3, 'teacher sees only assigned classes (3 students)', students.body);

  const studentsA = await request('GET', 'teacher/students?class=Class%20A', { token: teacherToken });
  status(studentsA, 200, 'teacher students filtered by assigned class');
  check(studentsA.body.total === 2, 'Class A contains two students', studentsA.body);

  const studentsUnknown = await request('GET', 'teacher/students?class=Class%20Z', { token: teacherToken });
  status(studentsUnknown, 403, 'unassigned class filter rejected');

  const exams = await request('GET', 'teacher/exams', { token: teacherToken });
  status(exams, 200, 'teacher exam list');
  const examA = exams.body.rows.find(e => e.id === 'exam_a');
  const examB = exams.body.rows.find(e => e.id === 'exam_b');
  check(!!examA && !!examB, 'teacher sees exams for both assigned classes');
  check(examA.subjects.length === 1 && examA.subjects[0].name === 'Mathematics', 'assigned subject visible on Class A exam', examA.subjects);
  check(examB.subjects.length === 0, 'same-named subject in unassigned subject class is filtered out', examB.subjects);

  const marksB = await request('GET', 'teacher/exams/exam_b/marks?subjectId=esub_math_b', { token: teacherToken });
  status(marksB, 403, 'marks endpoint rejects cross-class subject assignment');

  const planner = await request('GET', 'teacher/planner', { token: teacherToken });
  status(planner, 200, 'teacher planner');
  check(planner.body.events.length === 2, 'planner only contains assigned class events', planner.body.events);

  console.log('\nTeacher attendance');
  const attQuery = 'class=Class%20A&section=&subject=Mathematics&date=' + todayPK();
  const attGet = await request('GET', 'teacher/attendance?' + attQuery, { token: teacherToken });
  status(attGet, 200, 'load attendance sheet');
  check(attGet.body.roster.length === 2, 'Class A roster has two students', attGet.body.roster);
  check(attGet.body.saved === null, 'no prior Class A sheet exists');

  const historyBefore = await request('GET', 'teacher/attendance/history?from=' + daysAgoPK(30) + '&to=' + todayPK(), { token: teacherToken });
  status(historyBefore, 200, 'attendance history before submission');
  check(historyBefore.body.rows.length === 0, 'history hides unassigned Class B subject records', historyBefore.body.rows);

  const attEntries = [
    { studentId: 'A-001', status: 'present', remarks: '' },
    { studentId: 'A-002', status: 'present', remarks: '' }
  ];
  const attSave = await request('POST', 'teacher/attendance', {
    token: teacherToken,
    body: { className: 'Class A', section: '', subject: 'Mathematics', date: todayPK(), entries: attEntries }
  });
  status(attSave, 200, 'submit attendance');
  check(attSave.body.record.source === 'teacher', 'attendance marked as teacher source');
  check(attSave.body.record.submittedByTeacherId === teacher.id, 'attendance stores the teacher id');

  const attAgain = await request('POST', 'teacher/attendance', {
    token: teacherToken,
    body: { className: 'Class A', section: '', subject: 'Mathematics', date: todayPK(), entries: attEntries }
  });
  status(attAgain, 409, 'second attendance submission blocked without edit permission');

  const attSavedGet = await request('GET', 'teacher/attendance?' + attQuery, { token: teacherToken });
  status(attSavedGet, 200, 'reload saved attendance');
  check(attSavedGet.body.saved && attSavedGet.body.saved.entries.length === 2, 'saved attendance has both entries', attSavedGet.body.saved);

  const historyAfter = await request('GET', 'teacher/attendance/history?from=' + daysAgoPK(30) + '&to=' + todayPK(), { token: teacherToken });
  status(historyAfter, 200, 'attendance history after submission');
  check(historyAfter.body.rows.length === 1, 'history contains only the assigned Class A sheet', historyAfter.body.rows);
  check(historyAfter.body.rows[0].className === 'Class A', 'history row is the Class A sheet', historyAfter.body.rows[0]);

  const crossClassAtt = await request('POST', 'teacher/attendance', {
    token: teacherToken,
    body: {
      className: 'Class B', section: '', subject: 'Mathematics', date: todayPK(),
      entries: [{ studentId: 'B-001', status: 'present', remarks: '' }]
    }
  });
  status(crossClassAtt, 403, 'attendance subject must belong to the selected class');

  console.log('\nTeacher marks and results');
  const marksGet = await request('GET', 'teacher/exams/exam_a/marks?subjectId=esub_math_a', { token: teacherToken });
  status(marksGet, 200, 'load marks sheet');
  check(marksGet.body.roster.length === 2, 'marks roster has two students', marksGet.body.roster);

  const markRows = [
    { studentId: 'stu_a1', status: 'present', obtained: 80 },
    { studentId: 'stu_a2', status: 'present', obtained: 90 }
  ];
  const marksSave = await request('POST', 'teacher/exams/exam_a/marks', {
    token: teacherToken,
    body: { subjectId: 'esub_math_a', marks: markRows }
  });
  status(marksSave, 200, 'save marks');

  const marksEdit = await request('POST', 'teacher/exams/exam_a/marks', {
    token: teacherToken,
    body: {
      subjectId: 'esub_math_a',
      marks: [
        { studentId: 'stu_a1', status: 'present', obtained: 70 },
        { studentId: 'stu_a2', status: 'present', obtained: 90 }
      ]
    }
  });
  status(marksEdit, 409, 'marks edit blocked without edit permission');

  const results = await request('GET', 'teacher/results?examId=exam_a', { token: teacherToken });
  status(results, 200, 'computed results');
  check(results.body.rows.length === 2, 'results include both students', results.body.rows);
  check(results.body.rows.every(r => r.result.result === 'Pass'), 'all students pass', results.body.rows.map(r => r.result.result));
  check(results.body.rows.every(r => r.position >= 1), 'positions assigned', results.body.rows.map(r => r.position));

  const publishDenied = await request('POST', 'teacher/exams/exam_a/publish', { token: teacherToken });
  status(publishDenied, 403, 'publishing blocked without permission');

  const dmcBefore = await request('GET', 'teacher/dmc/exam_a/stu_a1', { token: teacherToken });
  status(dmcBefore, 200, 'DMC generated from saved results');
  check(dmcBefore.body.dmc.student.studentId === 'A-001', 'DMC student is correct', dmcBefore.body.dmc.student);
  check(dmcBefore.body.dmc.rows.length === 1, 'DMC has one subject row', dmcBefore.body.dmc.rows);
  check(/^DMC-A-001\//.test(dmcBefore.body.dmc.dmcNo), 'DMC number uses student id and year', dmcBefore.body.dmc.dmcNo);

  console.log('\nPermission updates, audit and portal controls');
  const detailBeforePerm = await request('GET', 'admin/teachers/' + teacher.id, { token: adminToken });
  status(detailBeforePerm, 200, 'read teacher permissions');
  const perms = Object.assign({}, detailBeforePerm.body.teacher.permissions, {
    editAttendance: true, editMarks: true, publishResults: true
  });
  const grant = await request('PUT', 'admin/teachers/' + teacher.id, {
    token: adminToken, body: { permissions: perms }
  });
  status(grant, 200, 'grant edit and publish permissions');
  check(grant.body.teacher.permissions.publishResults === true, 'publish permission stored', grant.body.teacher.permissions);

  const attUpdate = await request('POST', 'teacher/attendance', {
    token: teacherToken,
    body: {
      className: 'Class A', section: '', subject: 'Mathematics', date: todayPK(),
      entries: [
        { studentId: 'A-001', status: 'absent', remarks: 'Sick' },
        { studentId: 'A-002', status: 'present', remarks: '' }
      ]
    }
  });
  status(attUpdate, 200, 'edit attendance with permission');
  check(attUpdate.body.record.action === 'updated', 'attendance action is updated', attUpdate.body.record);

  const marksUpdate = await request('POST', 'teacher/exams/exam_a/marks', {
    token: teacherToken,
    body: {
      subjectId: 'esub_math_a',
      marks: [
        { studentId: 'stu_a1', status: 'present', obtained: 70 },
        { studentId: 'stu_a2', status: 'present', obtained: 90 }
      ]
    }
  });
  status(marksUpdate, 200, 'edit marks with permission');

  const publish = await request('POST', 'teacher/exams/exam_a/publish', { token: teacherToken });
  status(publish, 200, 'publish results with permission');
  check(publish.body.exam.status === 'published', 'exam status is published', publish.body.exam);

  const genericPortal = await request('PUT', 'admin/teachers/' + teacher.id, {
    token: adminToken, body: { portalNumber: 'TCH-1001' }
  });
  status(genericPortal, 400, 'generic update cannot change portal number');

  const portalNoReason = await request('PUT', 'admin/teachers/' + teacher.id + '/portal-number', {
    token: adminToken, body: { portalNumber: 'TCH-1001' }
  });
  status(portalNoReason, 400, 'portal change requires an audit reason');

  const portalChange = await request('PUT', 'admin/teachers/' + teacher.id + '/portal-number', {
    token: adminToken, body: { portalNumber: 'TCH-1001', reason: 'Duplicate number correction' }
  });
  status(portalChange, 200, 'portal number changed with reason');
  check(portalChange.body.teacher.portalNumber === 'TCH-1001', 'portal number updated', portalChange.body.teacher.portalNumber);

  const audit = await request('GET', 'admin/audit?limit=500', { token: adminToken });
  status(audit, 200, 'global audit');
  const actions = audit.body.rows.map(r => r.action);
  ['teacher.create', 'teacher.update', 'login', 'attendance.submitted', 'attendance.updated',
    'marks.save', 'results.publish'].forEach(action => {
      check(actions.indexOf(action) !== -1, 'audit contains ' + action, actions);
    });
  check(actions.indexOf('teacher.portal.change') !== -1, 'audit contains portal change', actions);

  const authText = fs.readFileSync(AUTH_FILE, 'utf8');
  check(authText.indexOf(tempPassword) === -1, 'temporary password is not stored in plaintext');
  check(authText.indexOf('TeacherPass123') === -1, 'permanent password is not stored in plaintext');
  check(authText.indexOf('passwordHash') !== -1 && authText.indexOf('passwordSalt') !== -1, 'auth store contains hash and salt');

  console.log('\nDisable, partial update and reset');
  const disable = await request('PUT', 'admin/teachers/' + teacher.id, {
    token: adminToken, body: { status: 'disabled' }
  });
  status(disable, 200, 'disable teacher');
  check(disable.body.teacher.status === 'disabled', 'teacher is disabled', disable.body.teacher.status);

  const partial = await request('PUT', 'admin/teachers/' + teacher.id, {
    token: adminToken, body: { fullName: 'Test Teacher Renamed' }
  });
  status(partial, 200, 'partial update while disabled');
  check(partial.body.teacher.status === 'disabled', 'partial update preserves disabled status', partial.body.teacher.status);

  const disabledToken = await request('GET', 'teacher/me', { token: teacherToken });
  status(disabledToken, 401, 'disabled teacher token rejected');

  const disabledLogin = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-1001', password: 'TeacherPass123' }
  });
  status(disabledLogin, 403, 'disabled teacher cannot sign in');

  const reenable = await request('PUT', 'admin/teachers/' + teacher.id, {
    token: adminToken, body: { status: 'active' }
  });
  status(reenable, 200, 'reactivate teacher');
  check(reenable.body.teacher.status === 'active', 'teacher is active again', reenable.body.teacher.status);

  const loginAgain = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-1001', password: 'TeacherPass123' }
  });
  status(loginAgain, 200, 'teacher signs in after reactivation');
  const liveToken = loginAgain.body.token;

  const reset = await request('POST', 'admin/teachers/' + teacher.id + '/reset-password', {
    token: adminToken, body: { method: 'temporary' }
  });
  status(reset, 200, 'reset teacher password');
  const temp2 = reset.body.temporaryPassword;
  check(/[A-Za-z]/.test(temp2) && /\d/.test(temp2), 'reset password has a letter and number', temp2);

  const revoked = await request('GET', 'teacher/me', { token: liveToken });
  status(revoked, 401, 'password reset revokes existing sessions');

  const oldPass = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-1001', password: 'TeacherPass123' }
  });
  status(oldPass, 401, 'old password rejected after reset');

  const tempLogin = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-1001', password: temp2 }
  });
  status(tempLogin, 200, 'temporary reset password signs in');
  check(tempLogin.body.mustChangePassword === true, 'reset password requires a change');

  const finalChange = await request('POST', 'teacher/auth/change-password', {
    token: tempLogin.body.token,
    body: { currentPassword: temp2, newPassword: 'FinalPass123' }
  });
  status(finalChange, 200, 'set final password after reset');

  console.log('\nPersistence across server restart');
  await stopServer();
  await new Promise(resolve => setTimeout(resolve, 350));
  await startServer();

  const adminAfterRestart = await request('POST', 'auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  status(adminAfterRestart, 200, 'admin signs in after restart');

  const teacherAfterRestart = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-1001', password: 'FinalPass123' }
  });
  status(teacherAfterRestart, 200, 'teacher account persists across restart');
  const restartToken = teacherAfterRestart.body.token;

  const studentsAfterRestart = await request('GET', 'teacher/students', { token: restartToken });
  status(studentsAfterRestart, 200, 'teacher data persists after restart');
  check(studentsAfterRestart.body.total === 3, 'persisted register still scoped to assigned classes', studentsAfterRestart.body);

  console.log('\nLogin throttling');
  for (let i = 0; i < 5; i++) {
    const fail = await request('POST', 'teacher/auth/login', {
      body: { identifier: 'TCH-9999', password: 'wrong-password' }
    });
    status(fail, 401, 'failed login attempt ' + (i + 1));
  }
  const blocked = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-9999', password: 'wrong-password' }
  });
  status(blocked, 429, 'sixth failed login is rate limited');

  console.log('\n' + passed + ' assertions passed');
}

main()
  .catch(err => {
    console.error('\nHARNESS FAILED:', err && err.stack || err);
    if (logs) console.error('\n--- server log ---\n' + logs);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopServer();
  });
