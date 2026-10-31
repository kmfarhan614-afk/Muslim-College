/* Scale + API harness for server.js (students API, delta sync, persistence). */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'mca-test-data');
const PORT = 3199;
const BASE = 'http://127.0.0.1:' + PORT;

function req(method, route, body, token) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = { 'Accept': 'application/json' };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(BASE + route, { method, headers }, res => {
      let text = '';
      res.on('data', c => text += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function log(label, value) {
  console.log(label + ': ' + (typeof value === 'string' ? value : JSON.stringify(value)));
}

(async function main() {
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA_DIR }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => process.env.VERBOSE && process.stdout.write('[srv] ' + d));
  child.stderr.on('data', d => process.stdout.write('[srv-err] ' + d));

  /* wait for the server */
  for (let i = 0; i < 60; i++) {
    try {
      const h = await req('GET', '/api/health');
      if (h.status === 200) break;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }

  let failures = 0;
  function check(label, condition, extra) {
    if (condition) { console.log('  PASS  ' + label); }
    else { failures++; console.log('  FAIL  ' + label + (extra ? ' -> ' + JSON.stringify(extra) : '')); }
  }

  try {
    /* ---- health + login ---- */
    const health = await req('GET', '/api/health');
    check('health responds', health.status === 200 && health.body.ok, health.body);

    const badLogin = await req('POST', '/api/auth/login', { email: 'x@y.com', password: 'nope' });
    check('bad login rejected', badLogin.status === 401);

    const anonWrite = await req('PUT', '/api/state', { keys: { mca_settings: {} } });
    check('state write without token rejected', anonWrite.status === 401, anonWrite.body);

    const login = await req('POST', '/api/auth/login', { email: 'admin@college.com', password: 'admin123' });
    check('login works', login.status === 200 && !!login.body.token, login.body);
    const token = login.body.token;

    const noAuth = await req('POST', '/api/students', { name: 'No Auth', class: '1st Year Medical', studentId: '9001' });
    check('write without token rejected', noAuth.status === 401, noAuth.body);

    const anonRead = await req('GET', '/api/students?limit=1');
    check('student read without token rejected', anonRead.status === 401, anonRead.body);
    const anonState = await req('GET', '/api/state');
    check('state read without token rejected', anonState.status === 401, anonState.body);
    const anonStorage = await req('GET', '/api/storage');
    check('storage read without token rejected', anonStorage.status === 401, anonStorage.body);

    const stateRead = await req('GET', '/api/state', undefined, token);
    check('state read with token works', stateRead.status === 200 && !!stateRead.body.keys, stateRead.body);

    /* ---- create ---- */
    const create = await req('POST', '/api/students', {
      name: 'Ali Khan', studentId: '2413', class: '1st Year Medical', section: '',
      fatherName: 'Akram', mobile: '03001234567', phoneRes: '0911234567',
      address: 'Main Road, Peshawar', admissionDate: '2026-08-15'
    }, token);
    check('create student', create.status === 201 && create.body.student.id, create.body);
    const firstId = create.body.student.id;

    const dup = await req('POST', '/api/students', {
      name: 'Ali Khan', studentId: '2413', class: '1st Year Medical'
    }, token);
    check('duplicate Student ID rejected with 409', dup.status === 409, dup.body);

    const invalid = await req('POST', '/api/students', { name: 'X', class: '', studentId: '' }, token);
    check('invalid student rejected with 422', invalid.status === 422, invalid.body);

    const badPhone = await req('POST', '/api/students', {
      name: 'Bad Phone', studentId: '2414', class: '1st Year Medical', mobile: '12345'
    }, token);
    check('invalid contact number rejected', badPhone.status === 422, badPhone.body);

    /* ---- read ---- */
    const one = await req('GET', '/api/students/' + firstId, undefined, token);
    check('read one student', one.status === 200 && one.body.student.studentId === '2413');

    const list = await req('GET', '/api/students?page=1&limit=10', undefined, token);
    check('list students', list.status === 200 && list.body.total >= 1 && Array.isArray(list.body.rows));

    const search = await req('GET', '/api/students?q=akram', undefined, token);
    check('search by father name', search.body.total === 1, search.body.total);

    /* ---- update / archive / restore ---- */
    const update = await req('PUT', '/api/students/' + firstId, { address: 'New Address' }, token);
    check('update student', update.status === 200 && update.body.student.address === 'New Address', update.body);

    const archived = await req('DELETE', '/api/students/' + firstId, undefined, token);
    check('archive student', archived.status === 200 && !!archived.body.student.deletedAt);

    const afterArchive = await req('GET', '/api/students?q=akram', undefined, token);
    check('archived student hidden from active list', afterArchive.body.total === 0, afterArchive.body);

    const archivedView = await req('GET', '/api/students?view=archived', undefined, token);
    check('archived student listed in archived view', archivedView.body.total === 1, archivedView.body.total);

    const restored = await req('POST', '/api/students/' + firstId + '/restore', undefined, token);
    check('restore student', restored.status === 200 && !restored.body.student.deletedAt);

    /* ---- delta sync ---- */
    const delta = await req('PUT', '/api/students/delta', {
      upserts: [
        { id: 'stu_3001', studentId: '3001', name: 'Delta One', class: '1st Year Medical', session: '2026-2027' },
        { id: 'stu_3002', studentId: '3002', name: 'Delta Two', class: '1st Year Medical', session: '2026-2027' }
      ],
      removes: []
    }, token);
    check('delta applied', delta.status === 200 && delta.body.applied === 2, delta.body);

    const afterDelta = await req('GET', '/api/students?q=delta', undefined, token);
    check('delta records readable', afterDelta.body.total === 2, afterDelta.body.total);

    const deltaDup = await req('PUT', '/api/students/delta', {
      upserts: [{ id: 'stu_3003', studentId: '3001', name: 'Clash', class: '1st Year Medical' }],
      removes: []
    }, token);
    check('delta rejects a duplicate Student ID', deltaDup.status === 200 && deltaDup.body.rejected === 1, deltaDup.body);

    /* ---- bulk + scale ---- */
    const CLASSES = ['1st Year Medical', '2nd Year Medical', '1st Year Computer Science', '2nd Year Computer Science'];
    const total = 10000;
    const records = [];
    for (let i = 0; i < total; i++) {
      records.push({
        id: 'stu_bulk_' + i,
        studentId: String(100000 + i),
        name: 'Bulk Student ' + i,
        fatherName: 'Father ' + (i % 500),
        class: CLASSES[i % CLASSES.length],
        section: '',
        mobile: '0300' + String(1000000 + i).slice(-7),
        phoneRes: '091' + String(1000000 + i).slice(-7),
        address: 'House ' + i + ', Peshawar',
        admissionDate: '2026-08-15',
        session: '2026-2027'
      });
    }
    const t0 = Date.now();
    const bulk = await req('POST', '/api/students/bulk', { students: records }, token);
    const bulkMs = Date.now() - t0;
    check('bulk import of ' + total + ' students', bulk.status === 200 && bulk.body.applied === total, bulk.body && bulk.body.errors && bulk.body.errors.slice(0, 2));
    console.log('  bulk write: ' + bulkMs + 'ms (' + (bulk.body && bulk.body.total) + ' records in the register)');

    const t1 = Date.now();
    const paged = await req('GET', '/api/students?page=1&limit=100', undefined, token);
    const pagedMs = Date.now() - t1;
    check('paged read of a 10k register', paged.status === 200 && paged.body.rows.length === 100, paged.body && paged.body.total);
    console.log('  paged read (100 rows of ' + paged.body.total + '): ' + pagedMs + 'ms');

    const t2 = Date.now();
    const searched = await req('GET', '/api/students?q=bulk+student+4242&limit=50', undefined, token);
    const searchMs = Date.now() - t2;
    check('search inside a 10k register', searched.status === 200, searched.body && searched.body.total);
    console.log('  search: ' + searchMs + 'ms -> ' + searched.body.total + ' hit(s)');

    const t3 = Date.now();
    const csv = await req('GET', '/api/students/export?format=csv&class=1st%20Year%20Medical', undefined, token);
    const csvMs = Date.now() - t3;
    check('csv export', csv.status === 200 && typeof csv.body === 'string' && csv.body.indexOf('Student ID') === 0, String(csv.body).slice(0, 60));
    console.log('  csv export: ' + csvMs + 'ms (' + String(csv.body).length + ' bytes)');

    /* ---- storage ---- */
    const storage = await req('GET', '/api/storage', undefined, token);
    check('storage report', storage.status === 200 && storage.body.students >= total, storage.body && storage.body.students);
    console.log('  register size: ' + (storage.body.total / (1024 * 1024)).toFixed(2) + ' MB');

    /* ---- persistence: restart the server and read the register again ---- */
    child.kill('SIGINT');
    await new Promise(r => setTimeout(r, 800));
    const child2 = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR: DATA_DIR }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child2.stdout.on('data', d => process.env.VERBOSE && process.stdout.write('[srv2] ' + d));
    child2.stderr.on('data', d => process.stdout.write('[srv2-err] ' + d));
    for (let i = 0; i < 60; i++) {
      try {
        const h = await req('GET', '/api/health');
        if (h.status === 200) break;
      } catch (e) { /* not up yet */ }
      await new Promise(r => setTimeout(r, 200));
    }
    const login2 = await req('POST', '/api/auth/login', { email: 'admin@college.com', password: 'admin123' });
    const token2 = login2.body && login2.body.token;
    const afterRestart = await req('GET', '/api/students?limit=1', undefined, token2);
    check('register survives a restart', afterRestart.body.total >= total, afterRestart.body && afterRestart.body.total);
    const stateFiles = fs.readdirSync(path.join(DATA_DIR, 'state'));
    check('per-key state files written', stateFiles.indexOf('mca_students.json') > -1, stateFiles);
    const backups = fs.existsSync(path.join(DATA_DIR, 'backups')) ? fs.readdirSync(path.join(DATA_DIR, 'backups')) : [];
    check('backups folder created', backups.length > 0, backups);

    child2.kill('SIGINT');
    await new Promise(r => setTimeout(r, 500));
  } catch (err) {
    failures++;
    console.error('HARNESS ERROR:', err && err.stack || err);
  }

  console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
  process.exit(failures ? 1 : 0);
})();
