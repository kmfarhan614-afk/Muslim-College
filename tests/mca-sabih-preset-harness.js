'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3417;
const HOST = '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'sabih-preset-data');

let server = null;
let logs = '';
let passed = 0;

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
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function waitForHealth() {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    try {
      const res = await request('GET', 'health');
      if (res.status === 200 && res.body && res.body.ok) return;
    } catch (err) { /* retry */ }
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('Server did not become healthy.\n' + logs);
}

async function main() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), HOST: HOST, DATA_DIR: DATA_DIR,
      ADMIN_EMAIL: 'admin@college.com', ADMIN_PASSWORD: 'admin123'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', chunk => { logs += chunk.toString(); });
  server.stderr.on('data', chunk => { logs += chunk.toString(); });
  await waitForHealth();

  const login = await request('POST', 'auth/login', {
    body: { email: 'admin@college.com', password: 'admin123' }
  });
  check(login.status === 200 && login.body.token, 'admin login');
  const token = login.body.token;

  const freshMeta = await request('GET', 'admin/meta', { token });
  check(freshMeta.status === 200, 'fresh admin meta loaded');
  check((freshMeta.body.classes || []).length === 4, 'fresh server seeds four core classes');
  check((freshMeta.body.classes || []).some(c => c.name === '1st Year Computer Science'), 'fresh server has the CS class');
  check((freshMeta.body.subjects || []).some(s => s.name === 'Urdu' && s.className === '1st Year Computer Science'), 'fresh server seeds Urdu for the CS class');

  const seeded = await request('PUT', 'state', {
    token,
    body: {
      keys: {
        mca_classes: [{
          id: 'first-year-computer-science',
          name: '1st Year Computer Science',
          sections: [],
          subjects: ['Computer Science', 'Mathematics', 'Physics', 'English', 'Urdu', 'Islamic Studies']
        }],
        mca_subjects: []
      }
    }
  });
  check(seeded.status === 200, 'class state saved');

  const meta = await request('GET', 'admin/meta', { token });
  check(meta.status === 200, 'admin meta loaded');
  const urdu = (meta.body.subjects || []).find(s =>
    s.name === 'Urdu' && s.className === '1st Year Computer Science');
  check(!!urdu, 'Urdu catalog subject auto-created');
  check(!!urdu && /^subj_/.test(urdu.id), 'Urdu subject has a stable catalog id', urdu);

  const create = await request('POST', 'admin/teachers', {
    token,
    body: {
      fullName: 'Sabih ud din',
      portalNumber: 'TCH-0001',
      status: 'active',
      classes: ['1st Year Computer Science'],
      subjects: [urdu.id],
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
    }
  });
  check(create.status === 201, 'Sabih account created', create.body);
  check(create.body.teacher.portalNumber === 'TCH-0001', 'portal number is TCH-0001');
  check(create.body.teacher.fullName === 'Sabih ud din', 'teacher name is exact');
  check(create.body.teacher.status === 'active', 'account status is active');
  check(create.body.teacher.mustChangePassword === true, 'first login forces password change');
  check(!!create.body.temporaryPassword, 'one-time password generated');
  check(!create.body.teacher.passwordHash && !create.body.teacher.passwordSalt, 'password secrets not exposed');
  check(create.body.teacher.subjects[0] === urdu.id, 'Urdu assigned');
  check(create.body.teacher.classes[0] === '1st Year Computer Science', 'class assigned');
  check(create.body.teacher.permissions.generateDmc === true, 'DMC permission enabled');
  check(create.body.teacher.permissions.enterMarks === true, 'marks permission enabled');
  check(create.body.teacher.permissions.takeAttendance === true, 'attendance permission enabled');
  check(create.body.teacher.permissions.editAttendance === false, 'attendance edit off');
  check(create.body.teacher.permissions.editMarks === false, 'marks edit off');
  check(create.body.teacher.permissions.publishResults === false, 'publish off');

  const duplicate = await request('POST', 'admin/teachers', {
    token,
    body: {
      fullName: 'Another Teacher',
      portalNumber: 'TCH-0001',
      classes: ['1st Year Computer Science'],
      subjects: [urdu.id]
    }
  });
  check(duplicate.status === 409, 'duplicate TCH-0001 rejected');

  const loginTeacher = await request('POST', 'teacher/auth/login', {
    body: { identifier: 'TCH-0001', password: create.body.temporaryPassword }
  });
  check(loginTeacher.status === 200, 'teacher can sign in with one-time password');
  check(loginTeacher.body.mustChangePassword === true, 'teacher must change password');

  console.log('\n' + passed + ' assertions passed');
}

main().catch(err => {
  console.error(err.stack || err.message);
  if (logs) console.error(logs);
  process.exitCode = 1;
}).finally(async () => {
  if (server) {
    const child = server;
    server = null;
    if (child.exitCode === null) {
      const timer = setTimeout(() => process.exit(), 5000);
      child.once('exit', () => { clearTimeout(timer); });
      child.kill();
    }
  }
  setTimeout(() => process.exit(process.exitCode || 0), 5000).unref();
});


