/* ==========================================================================
   Muslim Commerce College Peshawar — Attendance Management System
   Zero-dependency Node.js backend (no npm install required).

   Run:   node server.js        (or: npm start)
   Open:  http://localhost:3000

   Features
     - Static file serving for the frontend (with path-traversal protection)
     - REST API under /api/*
     - JSON file persistence (data/db.json, atomic writes)
     - Token auth: POST /api/auth/login  ->  Bearer token for all state,
       student, attendance and academic-year reads/writes.
   ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

/* Minimal .env.local loader (zero-dependency). Real environment variables
   always win, so deploys can override file values safely. */
(function loadEnvLocal() {
  let text;
  try { text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8'); }
  catch (err) { return; }
  text.split(/\r?\n/).forEach(line => {
    if (/^\s*#/.test(line)) return;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) return;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  });
})();

/* Demo credentials — keep in sync with the seeded client defaults.
   Override with env vars when deploying. */
const DEMO_EMAIL = (process.env.ADMIN_EMAIL || 'admin@college.com').toLowerCase();
const DEMO_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; /* 12 hours */
const MAX_BODY = 24 * 1024 * 1024;        /* 24 MB per request (bulk register) */

/* Only these keys may be stored via the API (mirrors js/api.js). */
const STATE_KEYS = [
  'mca_students',
  'mca_classes',
  'mca_teachers',
  'mca_attendance',
  'mca_settings',
  'mca_sessions',
  'mca_seeded_version',
  'mca_exams',
  'mca_subjects',
  'mca_marks',
  'mca_exam_settings',
  'mca_planner'
];

/* --------------------------------------------------------------------------
   Persistence — one JSON file per key, debounced writes, rotating backups
   --------------------------------------------------------------------------
   Every allowlisted key lives in its own file under data/state/. A single
   db.json holding everything meant one multi-megabyte rewrite per flush and
   one corrupt file for the whole database. Per-key files keep every write
   small, a crash can only cost the key that was being written, and a broken
   file is restored from its own backup.

   Writes are debounced (a burst of edits becomes one disk write) and flushed
   on exit. The previous copy of a key is kept in data/backups/<key>/ and a
   daily snapshot of the whole store is kept in data/backups/snapshots/.
   -------------------------------------------------------------------------- */

const STATE_DIR = path.join(DATA_DIR, 'state');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const AUTH_DIR = path.join(DATA_DIR, 'auth');
const AUTH_FILE = path.join(AUTH_DIR, 'users.json');
const BACKUP_KEEP = 10;          /* rotated copies kept per key */
const WRITE_DELAY_MS = 200;      /* debounce window for disk writes */

let store = { keys: {} };   // { keys: { <key>: { value, updatedAt, updatedBy, version } } }
const tokens = new Map();   // token -> { role, email, teacherId, expiresAt }

const TEACHER_PERMISSIONS = [
  'viewStudents', 'takeAttendance', 'editAttendance', 'viewAttendanceReports',
  'enterMarks', 'editMarks', 'viewResults', 'publishResults', 'generateDmc',
  'viewPlanner'
];

const DEFAULT_TEACHER_PERMISSIONS = {
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
};

const pendingWrites = new Set();
let writeTimer = null;
let lastSnapshotDay = '';

function keyFile(key) {
  return path.join(STATE_DIR, key + '.json');
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function loadStore() {
  /* 1. Per-key files (current layout). */
  let files = [];
  try {
    files = fs.readdirSync(STATE_DIR).filter(f => f.endsWith('.json'));
  } catch (err) {
    files = [];
  }

  if (files.length) {
    files.forEach(f => {
      const parsed = readJsonFile(path.join(STATE_DIR, f));
      if (!parsed || !parsed.key) return;
      store.keys[parsed.key] = {
        value: parsed.value,
        updatedAt: parsed.updatedAt || null,
        updatedBy: parsed.updatedBy || null,
        version: Number(parsed.version) || 1
      };
    });
    return;
  }

  /* 2. Legacy single-file database — migrate it key by key. */
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.keys) {
        store = parsed;
        Object.keys(store.keys).forEach(k => {
          if (!store.keys[k] || typeof store.keys[k] !== 'object') store.keys[k] = { value: null };
          if (!store.keys[k].version) store.keys[k].version = 1;
          if (!store.keys[k].updatedAt) store.keys[k].updatedAt = new Date().toISOString();
        });
        flushAll();
        console.log('[server] migrated data/db.json into data/state/');
      }
    }
  } catch (err) {
    console.error('[server] could not read data/db.json, starting empty:', err.message);
    store = { keys: {} };
  }
}

/* Keeps a rotating copy of the file that is about to be replaced. */
function backupKey(key) {
  const file = keyFile(key);
  try {
    if (!fs.existsSync(file)) return;
    const dir = path.join(BACKUP_DIR, key);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(dir, stamp + '.json'));
    const copies = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    while (copies.length > BACKUP_KEEP) {
      const old = copies.shift();
      try { fs.unlinkSync(path.join(dir, old)); } catch (err) { /* ignore */ }
    }
  } catch (err) {
    /* A failed backup must never block the write itself. */
  }
}

/* One snapshot of the whole store per day. */
function dailySnapshot() {
  const day = new Date().toISOString().slice(0, 10);
  if (lastSnapshotDay === day) return;
  lastSnapshotDay = day;
  try {
    const dir = path.join(BACKUP_DIR, 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, day + '.json'), JSON.stringify(store));
  } catch (err) {
    /* ignore */
  }
}

function persistKey(key) {
  const entry = store.keys[key];
  if (!entry) return;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    backupKey(key);
    const tmp = keyFile(key) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      key: key,
      value: entry.value,
      updatedAt: entry.updatedAt,
      updatedBy: entry.updatedBy,
      version: entry.version
    }));
    fs.renameSync(tmp, keyFile(key));
  } catch (err) {
    console.error('[server] could not write data/state/' + key + '.json:', err.message);
  }
}

/* Queues a key for the next disk write. */
function schedulePersist(key) {
  pendingWrites.add(key);
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushPending();
  }, WRITE_DELAY_MS);
  if (writeTimer.unref) writeTimer.unref();
}

/* Writes everything that is still queued. */
function flushPending() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  if (!pendingWrites.size) return;
  const keys = Array.from(pendingWrites);
  pendingWrites.clear();
  dailySnapshot();
  keys.forEach(persistKey);
}

/* Writes every key (used after a migration or a reset). */
function flushAll() {
  Object.keys(store.keys).forEach(key => persistKey(key));
  pendingWrites.clear();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
}

/* Records a new value for a key and queues it for disk. */
function setKeyValue(key, value, by) {
  const entry = store.keys[key] || {};
  entry.value = value;
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = by || 'system';
  entry.version = (Number(entry.version) || 0) + 1;
  store.keys[key] = entry;
  schedulePersist(key);
  return entry;
}

/* Older API kept for compatibility: writes the whole store now. */
let saveChain = Promise.resolve();
function saveStore() {
  saveChain = saveChain.then(() => new Promise(resolve => {
    try {
      flushAll();
    } catch (err) {
      console.error('[server] save failed:', err.message);
    }
    resolve();
  })).catch(() => {});
  return saveChain;
}

process.on('exit', () => {
  try { flushPending(); } catch (err) { /* ignore */ }
});

/* --------------------------------------------------------------------------
   Teacher accounts, RBAC and audit trail
   -------------------------------------------------------------------------- */

let authStore = { version: 1, nextPortal: 1, teachers: [], audit: [] };

const CORE_CLASS_RECORDS = [
  {
    id: 'first-year-medical', name: '1st Year Medical', code: '1YM', year: '1st Year',
    group: 'Pre-Medical', sections: [],
    subjects: ['Biology', 'Chemistry', 'Physics', 'English', 'Urdu', 'Islamic Studies'],
    teacher: 'Dr. Saima Gul', status: 'active'
  },
  {
    id: 'first-year-computer-science', name: '1st Year Computer Science', code: '1YCS',
    year: '1st Year', group: 'Computer Science', sections: [],
    subjects: ['Computer Science', 'Mathematics', 'Physics', 'English', 'Urdu', 'Islamic Studies'],
    teacher: 'Aamir Raza', status: 'active'
  },
  {
    id: 'second-year-medical', name: '2nd Year Medical', code: '2YM', year: '2nd Year',
    group: 'Pre-Medical', sections: [],
    subjects: ['Biology', 'Chemistry', 'Physics', 'English', 'Pak Studies', 'Islamic Studies'],
    teacher: 'Dr. Saima Gul', status: 'active'
  },
  {
    id: 'second-year-computer-science', name: '2nd Year Computer Science', code: '2YCS',
    year: '2nd Year', group: 'Computer Science', sections: [],
    subjects: ['Computer Science', 'Mathematics', 'Statistics', 'English', 'Pak Studies', 'Islamic Studies'],
    teacher: 'Aamir Raza', status: 'active'
  }
];

function stateValue(key, fallback) {
  const entry = store.keys[key];
  return entry ? entry.value : fallback;
}

function ensureCoreClasses() {
  const current = stateValue('mca_classes', []);
  if (Array.isArray(current) && current.length) return current;
  const classes = CORE_CLASS_RECORDS.map(cls => Object.assign({}, cls, {
    sections: cls.sections.slice(),
    subjects: cls.subjects.slice()
  }));
  setKeyValue('mca_classes', classes, 'system:core-classes');
  return classes;
}

function loadAuthStore() {
  const raw = readJsonFile(AUTH_FILE);
  if (raw && typeof raw === 'object') {
    authStore = {
      version: 1,
      nextPortal: Number(raw.nextPortal) || 1,
      teachers: Array.isArray(raw.teachers) ? raw.teachers : [],
      audit: Array.isArray(raw.audit) ? raw.audit : []
    };
  }
}

function saveAuthStore() {
  try {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const tmp = AUTH_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(authStore, null, 2));
    fs.renameSync(tmp, AUTH_FILE);
  } catch (err) {
    console.error('[server] could not save auth store:', err.message);
  }
}

function auditLog(actor, action, target, details) {
  authStore.audit.unshift({
    id: 'aud_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
    at: new Date().toISOString(),
    actor: actor || 'system',
    action,
    target: target || '',
    details: details || ''
  });
  if (authStore.audit.length > 2000) authStore.audit.length = 2000;
  saveAuthStore();
}

function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  return {
    salt: useSalt,
    hash: crypto.scryptSync(String(password), useSalt, 64).toString('hex')
  };
}

function verifyPassword(password, teacher) {
  if (!teacher || !teacher.passwordSalt || !teacher.passwordHash) return false;
  const test = hashPassword(password, teacher.passwordSalt).hash;
  const stored = Buffer.from(teacher.passwordHash, 'hex');
  const candidate = Buffer.from(test, 'hex');
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function normalizePortal(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function nextPortalNumber() {
  let n = Math.max(1, Number(authStore.nextPortal) || 1);
  const used = new Set(authStore.teachers.map(t => normalizePortal(t.portalNumber)));
  while (used.has('TCH-' + String(n).padStart(4, '0'))) n++;
  authStore.nextPortal = n + 1;
  return 'TCH-' + String(n).padStart(4, '0');
}

function teacherById(id) {
  return authStore.teachers.find(t => t.id === id) || null;
}

function findTeacher(identifier) {
  const key = String(identifier == null ? '' : identifier).trim().toLowerCase();
  const portal = normalizePortal(identifier);
  if (!key && !portal) return null;
  return authStore.teachers.find(t =>
    normalizePortal(t.portalNumber) === portal ||
    String(t.username || '').toLowerCase() === key ||
    String(t.email || '').toLowerCase() === key
  ) || null;
}

function publicTeacher(t) {
  if (!t) return null;
  const out = Object.assign({}, t);
  delete out.passwordHash;
  delete out.passwordSalt;
  delete out.tempPasswordHash;
  delete out.tempPasswordSalt;
  return out;
}

function teacherClasses(teacher) {
  return Array.isArray(teacher.classes) ? teacher.classes.slice() : [];
}

function catalogSubjects() {
  const list = stateValue('mca_subjects', []);
  return Array.isArray(list) ? list : [];
}

function subjectSlug(value) {
  return String(value == null ? '' : value).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Classes already declare their subjects. Make sure each one has a catalog
   record so it can be assigned to a teacher without manual setup. */
function ensureClassSubjectCatalog() {
  const classes = ensureCoreClasses();
  if (!Array.isArray(classes) || !classes.length) return catalogSubjects();
  const catalog = catalogSubjects().slice();
  const ids = new Set(catalog.map(s => s && s.id).filter(Boolean));
  const seen = new Set(catalog.map(s => String((s && s.className) || '') + '\u0000' +
    String((s && s.name) || '').trim().toLowerCase()));
  let order = catalog.reduce((max, s) => Math.max(max, Number(s && s.order) || 0), 0);
  let changed = false;

  classes.forEach(cls => {
    const className = cleanString(cls && cls.name, 120);
    if (!className) return;
    const names = Array.isArray(cls.subjects) ? cls.subjects : [];
    names.forEach(value => {
      const name = cleanString(value, 120);
      if (!name) return;
      const key = className + '\u0000' + name.toLowerCase();
      if (seen.has(key)) return;
      const base = 'subj_' + subjectSlug((cls && cls.id) || className) + '_' + subjectSlug(name);
      let id = base;
      let n = 2;
      while (ids.has(id)) id = base + '-' + (n++);
      catalog.push({
        id,
        name,
        code: '',
        className,
        type: 'theory',
        maxMarks: 100,
        passMarks: 40,
        order: ++order,
        active: true
      });
      ids.add(id);
      seen.add(key);
      changed = true;
    });
  });

  if (changed) setKeyValue('mca_subjects', catalog, 'system:class-subjects');
  return catalog;
}

function assignedSubjects(teacher) {
  const ids = new Set(Array.isArray(teacher.subjects) ? teacher.subjects : []);
  return catalogSubjects().filter(s => s && ids.has(s.id));
}

function teacherCan(teacher, permission) {
  return !!(teacher && teacher.permissions && teacher.permissions[permission]);
}

function teacherSubjectNames(teacher, className) {
  return assignedSubjects(teacher)
    .filter(s => !className || !s.className || s.className === className)
    .map(s => String(s.name || '').trim().toLowerCase()).filter(Boolean);
}

function examSubjectAssigned(teacher, exam, sub) {
  if (!sub) return false;
  const allowed = assignedSubjects(teacher);
  const name = String(sub.name || '').trim().toLowerCase();
  const code = String(sub.code || '').trim().toLowerCase();
  return allowed.some(s => {
    if (s.className && exam.className && s.className !== exam.className) return false;
    const sn = String(s.name || '').trim().toLowerCase();
    const sc = String(s.code || '').trim().toLowerCase();
    return (name && sn === name) || (code && sc && code === sc);
  });
}

function teacherToken(teacher) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, {
    role: 'teacher', teacherId: teacher.id,
    email: teacher.email || teacher.portalNumber,
    expiresAt: Date.now() + TOKEN_TTL_MS
  });
  return token;
}

function revokeTeacherTokens(teacherId) {
  tokens.forEach((entry, token) => {
    if (entry.role === 'teacher' && entry.teacherId === teacherId) tokens.delete(token);
  });
}

function issueToken(email) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, { role: 'admin', email, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function tokenFromReq(req) {
  const header = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1] : '';
}

function validToken(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  const entry = tokens.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { tokens.delete(token); return null; }
  return Object.assign({ token }, entry);
}

function validAdmin(req) {
  const authed = validToken(req);
  return authed && authed.role === 'admin' ? authed : null;
}

function validTeacher(req) {
  const authed = validToken(req);
  if (!authed || authed.role !== 'teacher') return null;
  const teacher = teacherById(authed.teacherId);
  if (!teacher || teacher.status !== 'active') return null;
  return { auth: authed, teacher };
}

/* Login throttling: five failures per identifier/IP in 15 minutes. */
const loginAttempts = new Map();
function loginKey(req, identifier) {
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
  return ip + '|' + String(identifier || '').trim().toLowerCase();
}
function loginBlocked(req, identifier) {
  const rec = loginAttempts.get(loginKey(req, identifier));
  if (!rec) return false;
  if (rec.until && rec.until > Date.now()) return true;
  if (rec.until && rec.until <= Date.now()) loginAttempts.delete(loginKey(req, identifier));
  return false;
}
function loginFailed(req, identifier) {
  const key = loginKey(req, identifier);
  const now = Date.now();
  const rec = loginAttempts.get(key) || { count: 0, firstAt: now, until: 0 };
  if (now - rec.firstAt > 15 * 60 * 1000) { rec.count = 0; rec.firstAt = now; }
  rec.count++;
  if (rec.count >= 5) rec.until = now + 15 * 60 * 1000;
  loginAttempts.set(key, rec);
}
function loginSucceeded(req, identifier) {
  loginAttempts.delete(loginKey(req, identifier));
}

function makePassword() {
  const body = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, '').slice(0, 7);
  return 'Mcc-' + body + crypto.randomInt(0, 10);
}

function passwordProblem(password) {
  const value = String(password || '');
  if (value.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return 'Password must include at least one letter and one number.';
  }
  return '';
}

function normalizePermissions(input) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  TEACHER_PERMISSIONS.forEach(key => {
    out[key] = Object.prototype.hasOwnProperty.call(source, key)
      ? !!source[key] : DEFAULT_TEACHER_PERMISSIONS[key];
  });
  return out;
}

function cleanString(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max || 500);
}

function validateTeacherPayload(body, current) {
  const src = body || {};
  const errors = [];
  const teacher = current || {};
  const fullName = cleanString(src.fullName !== undefined ? src.fullName : teacher.fullName, 120);
  if (!fullName) errors.push('Full name is required.');

  const classes = Array.isArray(src.classes) ? src.classes : (teacher.classes || []);
  const knownClasses = new Set(ensureCoreClasses().map(c => c && c.name));
  const cleanClasses = Array.from(new Set(classes.map(v => cleanString(v, 120)).filter(Boolean)));
  cleanClasses.forEach(name => {
    if (!knownClasses.has(name)) errors.push('Unknown class: ' + name);
  });

  const subjectIds = Array.isArray(src.subjects) ? src.subjects : (teacher.subjects || []);
  const catalog = ensureClassSubjectCatalog();
  const cleanSubjects = Array.from(new Set(subjectIds.map(v => cleanString(v, 80)).filter(Boolean)));
  cleanSubjects.forEach(id => {
    const sub = catalog.find(s => s && s.id === id);
    if (!sub) errors.push('Unknown subject.');
    else if (cleanClasses.length && sub.className && !cleanClasses.includes(sub.className)) {
      errors.push('Subject "' + sub.name + '" is outside the assigned classes.');
    }
  });

  const email = cleanString(src.email !== undefined ? src.email : teacher.email, 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Enter a valid email address.');

  const username = cleanString(src.username !== undefined ? src.username : teacher.username, 60).toLowerCase();
  if (username && !/^[a-z0-9._-]{3,60}$/.test(username)) {
    errors.push('Username must be 3-60 characters (letters, numbers, dot, dash, underscore).');
  }

  const portalInput = src.portalNumber !== undefined ? src.portalNumber : teacher.portalNumber;
  const portalNumber = portalInput ? normalizePortal(portalInput) : '';
  if (portalNumber && !/^TCH-\d{4,}$/.test(portalNumber)) {
    errors.push('Portal number must look like TCH-0001.');
  }

  const status = src.status === 'disabled' ? 'disabled'
    : (src.status === 'active' ? 'active' : (teacher.status === 'disabled' ? 'disabled' : 'active'));
  const academicSession = cleanString(
    src.academicSession !== undefined ? src.academicSession : teacher.academicSession, 40);

  const photo = cleanString(src.photo !== undefined ? src.photo : teacher.photo, 700000);
  if (photo && (!/^data:image\/(png|jpe?g|webp);base64,/i.test(photo) || photo.length > 700000)) {
    errors.push('Photo must be a PNG, JPEG or WebP data URL under 700 KB.');
  }

  return {
    errors,
    teacher: {
      fullName,
      fatherName: cleanString(src.fatherName !== undefined ? src.fatherName : teacher.fatherName, 120),
      contact: cleanString(src.contact !== undefined ? src.contact : teacher.contact, 60),
      email,
      username,
      qualification: cleanString(src.qualification !== undefined ? src.qualification : teacher.qualification, 120),
      designation: cleanString(src.designation !== undefined ? src.designation : teacher.designation, 120) || 'Teacher',
      photo,
      classes: cleanClasses,
      subjects: cleanSubjects,
      academicSession,
      permissions: normalizePermissions(src.permissions !== undefined ? src.permissions : teacher.permissions),
      status,
      portalNumber
    }
  };
}

function uniqueTeacherFields(teacher, ignoreId) {
  const portal = normalizePortal(teacher.portalNumber);
  const email = String(teacher.email || '').toLowerCase();
  const username = String(teacher.username || '').toLowerCase();
  return authStore.teachers.find(t => {
    if (ignoreId && t.id === ignoreId) return false;
    if (portal && normalizePortal(t.portalNumber) === portal) return 'Portal number is already in use.';
    if (email && String(t.email || '').toLowerCase() === email) return 'Email is already in use.';
    if (username && String(t.username || '').toLowerCase() === username) return 'Username is already in use.';
    return false;
  }) || null;
}

function teacherMeta(teacher) {
  const names = teacherClasses(teacher);
  const classes = stateValue('mca_classes', []);
  return {
    classes: names,
    classInfo: (Array.isArray(classes) ? classes : []).filter(c => c && names.includes(c.name))
      .map(c => ({ id: c.id, name: c.name, sections: Array.isArray(c.sections) ? c.sections : [] })),
    subjects: assignedSubjects(teacher).map(s => ({
      id: s.id, name: s.name, code: s.code, className: s.className, type: s.type
    })),
    permissions: teacher.permissions || {}
  };
}

function scopedStudents(teacher) {
  const classes = new Set(teacherClasses(teacher));
  return studentRecords().filter(s =>
    s && !s.deletedAt && classes.has(s.class)
  ).sort(studentSort);
}

function attendanceSheet(teacher, className, section, subject, date) {
  const classes = new Set(teacherClasses(teacher));
  if (!classes.has(className)) return { error: 'Class is not assigned to you.', status: 403 };
  const allowed = teacherSubjectNames(teacher, className);
  if (subject && allowed.indexOf(String(subject).trim().toLowerCase()) === -1) {
    return { error: 'Subject is not assigned to you.', status: 403 };
  }
  const roster = scopedStudents(teacher).filter(s =>
    s.class === className && String(s.section || '') === String(section || '')
  ).map(s => ({
    studentId: s.studentId, rollNo: s.rollNo, name: s.name,
    fatherName: s.fatherName, status: s.status
  }));
  const records = stateValue('mca_attendance', []);
  const saved = (Array.isArray(records) ? records : []).find(r =>
    r && r.date === date && r.className === className &&
    String(r.section || '') === String(section || '') && String(r.subject || '') === String(subject || '')
  ) || null;
  return { roster, saved };
}

/* --------------------------------------------------------------------------
   HTTP helpers
   -------------------------------------------------------------------------- */

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function hasAnyData() {
  return Object.keys(store.keys).length > 0;
}

/* --------------------------------------------------------------------------
   Supabase (PostgreSQL) integration — permanent attendance storage
   --------------------------------------------------------------------------
   The browser never holds database credentials. It calls this server, which
   forwards to Supabase's PostgREST API using the SERVICE-ROLE key (server-side
   only). When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are absent the whole
   subsystem reports itself disabled and the client keeps using the local
   store. See supabase/schema.sql and SUPABASE.md.
   -------------------------------------------------------------------------- */

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SUPABASE_KEY = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
const SUPABASE_ON = Boolean(SUPABASE_URL && SUPABASE_KEY);

const STATUS_TO_DB = { present: 'Present', absent: 'Absent', leave: 'Leave' };
const STATUS_FROM_DB = { Present: 'present', Absent: 'absent', Leave: 'leave' };
const SB_CHUNK = 500;
const NULL_UUID = '00000000-0000-0000-0000-000000000000';

async function sb(route, options) {
  const opts = options || {};
  const headers = Object.assign({
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }, opts.headers || {});
  if (opts.prefer) headers.Prefer = opts.prefer;

  const res = await fetch(SUPABASE_URL + '/rest/v1/' + route, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch (err) { data = text; } }

  if (!res.ok) {
    /* A Range that starts past the end yields 416 with a valid count. */
    if (res.status === 416) return { data: [], res: res, emptyRange: true };
    const error = new Error((data && data.message) || ('Supabase request failed (' + res.status + ')'));
    error.status = 502;
    error.supabase = data;
    throw error;
  }
  return { data: data, res: res };
}

async function sbSelect(table, query) {
  const result = await sb(table + (query ? '?' + query : ''));
  return Array.isArray(result.data) ? result.data : [];
}

async function sbUpsert(table, rows, onConflict) {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += SB_CHUNK) {
    const chunk = rows.slice(i, i + SB_CHUNK);
    const route = table + (onConflict ? '?on_conflict=' + onConflict : '');
    const result = await sb(route, {
      method: 'POST',
      body: chunk,
      prefer: 'resolution=merge-duplicates,return=representation'
    });
    if (Array.isArray(result.data)) out.push.apply(out, result.data);
  }
  return out;
}

function encodeQuery(params) {
  return params.filter(Boolean).join('&');
}

async function sbResolveId(table, name) {
  if (!name) return null;
  const rows = await sbSelect(table, 'select=id&name=eq.' + encodeURIComponent(name) + '&limit=1');
  return rows[0] ? rows[0].id : null;
}

async function sbSessions() {
  return sbSelect('academic_sessions',
    'select=id,name,start_date,end_date,is_active&order=start_date.desc.nullslast,name.desc');
}

/* Session that owns a given calendar date; falls back to the active session. */
async function sbSessionForDate(date) {
  const sessions = await sbSessions();
  const match = sessions.find(s => s.start_date && s.end_date && date >= s.start_date && date <= s.end_date);
  return match || sessions.find(s => s.is_active) || sessions[0] || null;
}

function mapAttendanceRow(r) {
  return {
    id: r.id,
    date: r.attendance_date,
    status: STATUS_FROM_DB[r.status] || r.status,
    remarks: r.remarks || '',
    markedBy: r.marked_by || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    studentCode: r.student ? r.student.student_code : '',
    rollNo: r.student ? r.student.roll_number : '',
    studentName: r.student ? r.student.full_name : '',
    fatherName: r.student ? r.student.father_name : '',
    className: r.class ? r.class.name : '',
    sectionName: r.section ? r.section.name : '',
    subjectName: r.subject ? r.subject.name : '',
    academicYear: r.academic_session ? r.academic_session.name : ''
  };
}

const ATT_SELECT = 'select=id,attendance_date,status,remarks,marked_by,created_at,updated_at,' +
  'student:students(student_code,roll_number,full_name,father_name),' +
  'class:classes(name),section:sections(name),subject:subjects(name),' +
  'academic_session:academic_sessions(name)';

function requireSupabase(res) {
  if (SUPABASE_ON) return true;
  sendJSON(res, 503, {
    ok: false,
    configured: false,
    message: 'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then restart the server.'
  });
  return false;
}

/* Returns true when the request was handled by a Supabase route. */
async function handleSupabaseAPI(req, res, pathname, method) {
  const isSbRoute =
    pathname.indexOf('/api/supabase') === 0 ||
    pathname.indexOf('/api/attendance') === 0 ||
    pathname.indexOf('/api/academic-sessions') === 0 ||
    pathname.indexOf('/api/sync') === 0;
  if (!isSbRoute) return false;

  /* Status is always answerable, even while disabled. */
  if (pathname === '/api/supabase/status' && method === 'GET') {
    let reachable = false;
    let error = null;
    if (SUPABASE_ON) {
      try { await sbSelect('academic_sessions', 'select=id&limit=1'); reachable = true; }
      catch (err) { error = err.message; }
    }
    sendJSON(res, 200, {
      ok: true,
      configured: SUPABASE_ON,
      reachable: reachable,
      url: SUPABASE_URL || null,
      keyType: SUPABASE_SERVICE_KEY ? 'service_role' : (SUPABASE_ANON_KEY ? 'anon' : null),
      error: error
    });
    return true;
  }

  if (!requireSupabase(res)) return true;

  /* Attendance and academic-year data are private to signed-in staff. The
     status route above remains open so the sign-in page can show whether the
     optional database is configured. */
  if (!validAdmin(req)) {
    sendJSON(res, 401, { ok: false, message: 'Sign in to read attendance and academic-year data.' });
    return true;
  }

  try {
    /* ---- Sync local model -> Supabase (sessions/classes/subjects/students) */
    if (pathname === '/api/sync' && method === 'POST') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in to sync data.' }); return true; }
      const body = await readBody(req);
      const counts = await syncModel(body);
      sendJSON(res, 200, { ok: true, counts: counts });
      return true;
    }

    /* ---- Academic sessions ---- */
    if (pathname === '/api/academic-sessions' && method === 'GET') {
      sendJSON(res, 200, { ok: true, sessions: await sbSessions() });
      return true;
    }
    if (pathname === '/api/academic-sessions' && method === 'POST') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in to manage academic years.' }); return true; }
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (name.length < 4) { sendJSON(res, 400, { ok: false, message: 'Academic year name is required (e.g. 2025-2026).' }); return true; }
      if (body.is_active) await sb('academic_sessions?is_active=eq.true', { method: 'PATCH', body: { is_active: false } });
      const saved = await sbUpsert('academic_sessions', [{
        name: name,
        start_date: body.start_date || null,
        end_date: body.end_date || null,
        is_active: !!body.is_active
      }], 'name');
      sendJSON(res, 200, { ok: true, session: saved[0] || null });
      return true;
    }
    const activate = /^\/api\/academic-sessions\/([^/]+)\/activate$/.exec(pathname);
    if (activate && method === 'POST') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in to manage academic years.' }); return true; }
      const id = decodeURIComponent(activate[1]);
      await sb('academic_sessions?is_active=eq.true', { method: 'PATCH', body: { is_active: false } });
      const result = await sb('academic_sessions?id=eq.' + encodeURIComponent(id),
        { method: 'PATCH', body: { is_active: true }, prefer: 'return=representation' });
      sendJSON(res, 200, { ok: true, session: (result.data && result.data[0]) || null });
      return true;
    }
    const delSession = /^\/api\/academic-sessions\/([^/]+)$/.exec(pathname);
    if (delSession && method === 'DELETE') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in to manage academic years.' }); return true; }
      await sb('academic_sessions?id=eq.' + encodeURIComponent(delSession[1]), { method: 'DELETE' });
      sendJSON(res, 200, { ok: true });
      return true;
    }

    /* ---- Attendance query ---- */
    if (pathname === '/api/attendance' && method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const q = url.searchParams;
      const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(q.get('pageSize') || '25', 10) || 25));

      const params = [ATT_SELECT, 'order=attendance_date.desc,created_at.desc'];
      if (q.get('from')) params.push('attendance_date=gte.' + q.get('from'));
      if (q.get('to')) params.push('attendance_date=lte.' + q.get('to'));

      const classId = q.get('classId') || await sbResolveId('classes', q.get('className'));
      if (classId) params.push('class_id=eq.' + classId);
      const subjectId = q.get('subjectId') || await sbResolveId('subjects', q.get('subjectName'));
      if (subjectId) params.push('subject_id=eq.' + subjectId);
      const yearId = q.get('academicYearId') || await sbResolveId('academic_sessions', q.get('academicYearName'));
      if (yearId) params.push('academic_year_id=eq.' + yearId);

      if (q.get('sectionId')) params.push('section_id=eq.' + q.get('sectionId'));
      else if (q.get('sectionName') === '') params.push('section_id=is.null');

      const studentTerm = (q.get('student') || '').trim();
      if (q.get('studentId')) {
        params.push('student_id=eq.' + q.get('studentId'));
      } else if (studentTerm) {
        const like = '*' + studentTerm + '*';
        const srows = await sbSelect('students',
          'select=id&or=(full_name.ilike.' + encodeURIComponent(like) +
          ',roll_number.ilike.' + encodeURIComponent(like) +
          ',student_code.ilike.' + encodeURIComponent(like) + ')&limit=500');
        if (!srows.length) {
          sendJSON(res, 200, { ok: true, rows: [], total: 0, page: page, pageSize: pageSize, source: 'supabase' });
          return true;
        }
        params.push('student_id=in.(' + srows.map(r => r.id).join(',') + ')');
      }

      const status = String(q.get('status') || '').toLowerCase();
      if (STATUS_TO_DB[status]) params.push('status=eq.' + STATUS_TO_DB[status]);

      const start = (page - 1) * pageSize;
      const end = start + pageSize - 1;
      const result = await sb('attendance_records?' + encodeQuery(params), {
        headers: { Range: start + '-' + end, 'Range-Unit': 'items' },
        prefer: 'count=exact'
      });
      const contentRange = result.res.headers.get('content-range') || '';
      const total = Number(contentRange.split('/')[1] || '0') || 0;
      const rows = (Array.isArray(result.data) ? result.data : []).map(mapAttendanceRow);
      sendJSON(res, 200, { ok: true, rows: rows, total: total, page: page, pageSize: pageSize, source: 'supabase' });
      return true;
    }

    /* ---- Attendance bulk save (dedup by unique constraint) ---- */
    if (pathname === '/api/attendance' && method === 'POST') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in to save attendance.' }); return true; }
      const body = await readBody(req);
      const result = await saveAttendance(body);
      sendJSON(res, 200, { ok: true, saved: result.saved, skipped: result.skipped, session: result.session });
      return true;
    }

    /* ---- Attendance delete ---- */
    const delAtt = /^\/api\/attendance\/([^/]+)$/.exec(pathname);
    if (delAtt && method === 'DELETE') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in to delete attendance.' }); return true; }
      await sb('attendance_records?id=eq.' + encodeURIComponent(delAtt[1]), { method: 'DELETE' });
      sendJSON(res, 200, { ok: true });
      return true;
    }

    /* ---- Retention (manual, admin-only, never scheduled) ---- */
    if (pathname === '/api/attendance/retention' && method === 'POST') {
      if (!validAdmin(req)) { sendJSON(res, 401, { ok: false, message: 'Sign in required.' }); return true; }
      const body = await readBody(req);
      if (!body.confirm) { sendJSON(res, 400, { ok: false, message: 'Set confirm:true to apply the retention policy.' }); return true; }
      if (body.academicYearId) {
        await sb('attendance_records?academic_year_id=eq.' + encodeURIComponent(body.academicYearId), { method: 'DELETE' });
      } else if (body.beforeDate) {
        await sb('attendance_records?attendance_date=lt.' + encodeURIComponent(body.beforeDate), { method: 'DELETE' });
      } else {
        sendJSON(res, 400, { ok: false, message: 'Provide academicYearId or beforeDate.' });
        return true;
      }
      sendJSON(res, 200, { ok: true, message: 'Retention policy applied.' });
      return true;
    }
  } catch (err) {
    const status = err.status || 502;
    sendJSON(res, status, { ok: false, message: err.message, detail: err.supabase || null });
    return true;
  }

  return false;
}

/* Upsert a natural-key row set and return a map of natural key -> id. */
async function sbNaturalMap(table, rows, keyCol, onConflict) {
  const saved = await sbUpsert(table, rows, onConflict || keyCol);
  const map = {};
  saved.forEach(r => { map[r[keyCol]] = r.id; });
  return map;
}

async function syncModel(body) {
  const counts = { sessions: 0, classes: 0, subjects: 0, sections: 0, students: 0 };

  const sessions = Array.isArray(body.sessions) ? body.sessions : [];
  if (sessions.length) {
    const rows = sessions.map(s => ({
      name: String(s.name || '').trim(),
      start_date: s.start_date || null,
      end_date: s.end_date || null,
      is_active: !!s.is_active
    })).filter(s => s.name);
    counts.sessions = (await sbUpsert('academic_sessions', rows, 'name')).length;
  }
  const sessionList = await sbSessions();
  const activeSession = sessionList.find(s => s.is_active) || sessionList[0] || null;

  const classes = Array.isArray(body.classes) ? body.classes : [];
  const subjectNames = {};
  classes.forEach(c => (c.subjects || []).forEach(s => { if (s) subjectNames[s] = true; }));
  const subjectRows = Object.keys(subjectNames).map(name => ({ name: name, code: null, is_active: true }));
  let subjectMap = {};
  if (subjectRows.length) {
    subjectMap = await sbNaturalMap('subjects', subjectRows, 'name');
    counts.subjects = Object.keys(subjectMap).length;
  }

  const classRows = classes.map(c => ({
    name: String(c.name || '').trim(),
    code: c.code || null,
    year: c.year || null,
    study_group: c.group || null,
    session_id: (c.session_id || (activeSession && activeSession.id) || null),
    is_active: c.status ? c.status !== 'inactive' : true
  })).filter(c => c.name);
  const classMap = classRows.length ? await sbNaturalMap('classes', classRows, 'name') : {};
  counts.classes = Object.keys(classMap).length;

  const sectionRows = [];
  const sectionKeys = [];
  classes.forEach(c => {
    const classId = classMap[String(c.name || '').trim()];
    if (!classId) return;
    (c.sections || []).forEach(name => {
      if (!name) return;
      sectionRows.push({ class_id: classId, name: name, is_active: true });
      sectionKeys.push(classId + '\u0000' + name);
    });
  });
  const sectionMap = {};
  if (sectionRows.length) {
    const saved = await sbUpsert('sections', sectionRows, 'class_id,name');
    saved.forEach(r => { sectionMap[r.class_id + '\u0000' + r.name] = r.id; });
    counts.sections = saved.length;
  }

  const students = Array.isArray(body.students) ? body.students : [];
  const studentRows = students.map(s => {
    const classId = classMap[String(s.class || '').trim()];
    if (!classId) return null;
    const sectionId = s.section ? (sectionMap[classId + '\u0000' + s.section] || null) : null;
    return {
      student_code: String(s.studentId || '').trim(),
      roll_number: String(s.rollNo == null ? '' : s.rollNo),
      full_name: String(s.name || '').trim(),
      father_name: s.fatherName || null,
      date_of_birth: s.dob || null,
      gender: s.gender || null,
      class_id: classId,
      section_id: sectionId,
      session_id: (activeSession && activeSession.id) || null,
      phone: s.phone || null,
      email: s.email || null,
      address: s.address || null,
      status: s.status || 'active'
    };
  }).filter(s => s && s.student_code && s.full_name);
  if (studentRows.length) {
    counts.students = (await sbUpsert('students', studentRows, 'student_code')).length;
  }

  return counts;
}

async function saveAttendance(body) {
  const className = String(body.className || '').trim();
  const sectionName = body.sectionName ? String(body.sectionName).trim() : '';
  const subjectName = String(body.subjectName || '').trim();
  const date = String(body.date || '').trim();
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!className || !subjectName || !date || !entries.length) {
    throw Object.assign(new Error('className, subjectName, date and entries are required.'), { status: 400 });
  }

  const classId = await sbResolveId('classes', className);
  if (!classId) throw Object.assign(new Error('Unknown class "' + className + '". Run a data sync first.'), { status: 400 });

  const subjectRows = await sbUpsert('subjects', [{ name: subjectName, code: null, is_active: true }], 'name');
  const subjectId = subjectRows[0] ? subjectRows[0].id : await sbResolveId('subjects', subjectName);

  let sectionId = null;
  if (sectionName) {
    const srows = await sbSelect('sections',
      'select=id&class_id=eq.' + classId + '&name=eq.' + encodeURIComponent(sectionName) + '&limit=1');
    sectionId = srows[0] ? srows[0].id : null;
  }

  const session = await sbSessionForDate(date);
  if (!session) throw Object.assign(new Error('No academic session found. Create one first.'), { status: 400 });

  const codes = entries.map(e => String(e.studentCode || e.studentId || '').trim()).filter(Boolean);
  const studentRows = await sbSelect('students',
    'select=id,student_code&student_code=in.(' + codes.map(encodeURIComponent).join(',') + ')');
  const studentMap = {};
  studentRows.forEach(r => { studentMap[r.student_code] = r.id; });

  const rows = [];
  let skipped = 0;
  entries.forEach(e => {
    const dbStatus = STATUS_TO_DB[String(e.status || '').toLowerCase()];
    const sid = studentMap[String(e.studentCode || e.studentId || '').trim()];
    if (!dbStatus || !sid) { skipped++; return; }
    rows.push({
      student_id: sid,
      class_id: classId,
      section_id: sectionId,
      subject_id: subjectId,
      academic_year_id: session.id,
      attendance_date: date,
      status: dbStatus,
      remarks: e.remarks || null,
      marked_by: body.markedBy || null
    });
  });

  const saved = await sbUpsert('attendance_records', rows,
    'student_id,class_id,subject_id,academic_year_id,attendance_date');

  return { saved: saved.length, skipped: skipped, session: session.name };
}

/* --------------------------------------------------------------------------
   Student register API — paged reads, single-record writes, deltas
   --------------------------------------------------------------------------
   The register is the biggest collection in the system (thousands of
   records). Sending it as one blob on every change is wasteful over the wire
   and impossible to page through, so the student endpoints speak in pages and
   in deltas:

     GET    /api/students            paged + filtered read
     GET    /api/students/:id        one record
     GET    /api/students/export     CSV or JSON export
     POST   /api/students            create (409 on a duplicate Student ID)
     PUT    /api/students            replace the whole register
     PUT    /api/students/:id        update
     DELETE /api/students/:id        archive (soft delete)
     POST   /api/students/:id/restore restore an archived student
     POST   /api/students/bulk       bulk create/update in one write
     PUT    /api/students/delta      apply a batch of changes in one write
     GET    /api/storage             per-key sizes and versions

   The Student ID is the business key and is enforced as unique by the
   server as well — a duplicate can never reach the database even if two
   browsers write at the same time.
   -------------------------------------------------------------------------- */

const STUDENT_KEY = 'mca_students';
const MAX_PAGE_LIMIT = 1000;

const STUDENT_FIELDS = [
  'id', 'studentId', 'rollNo', 'name', 'fatherName', 'dob', 'gender', 'class',
  'section', 'phone', 'phoneRes', 'mobile', 'address', 'email', 'admissionDate',
  'status', 'session', 'photo', 'photoKey', 'needsReview', 'reviewNotes',
  'deletedAt', 'deletedBy', 'importSource', 'createdAt', 'updatedAt'
];

function studentRecords() {
  const entry = store.keys[STUDENT_KEY];
  return entry && Array.isArray(entry.value) ? entry.value : [];
}

function normStudentId(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function studentNumber(value) {
  const raw = String(value == null ? '' : value).trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

/* Numeric Student IDs first (99 before 2413), then the rest in natural
   order — the same order the browser uses for roll numbers. */
function studentSort(a, b) {
  const na = studentNumber(a.studentId);
  const nb = studentNumber(b.studentId);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  const cmp = String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true });
  if (cmp !== 0) return cmp;
  return String(a.name || '').localeCompare(String(b.name || ''));
}

function studentHaystack(s) {
  return [
    s.studentId, s.name, s.fatherName, s.rollNo, s.mobile, s.phoneRes, s.phone,
    s.address, s.email, s.class, s.section, s.session
  ].filter(v => v !== undefined && v !== null && v !== '').join(' ').toLowerCase();
}

function filterStudents(query) {
  const q = String(query.q || '').trim().toLowerCase();
  const className = query.class || '';
  const section = query.section || '';
  const status = query.status || '';
  const session = query.session || '';
  const view = query.view === 'archived' ? 'archived' : 'active';

  return studentRecords().filter(s => {
    if (!s || typeof s !== 'object') return false;
    const archived = !!s.deletedAt;
    if (view === 'archived') {
      if (!archived) return false;
    } else if (archived) {
      return false;
    }
    if (className && s.class !== className) return false;
    if (section && String(s.section || '') !== section) return false;
    if (session && String(s.session || '') !== session) return false;
    if (status && String(s.status || 'active') !== status) return false;
    if (q && studentHaystack(s).indexOf(q) === -1) return false;
    return true;
  }).sort(studentSort);
}

/* An index of the register, built once per request so a 10 000-student
   register is never scanned record by record. */
function buildStudentIndex(list) {
  const byId = new Map();
  const bySid = new Map();
  list.forEach(s => {
    if (!s || !s.id) return;
    byId.set(s.id, s);
    const sid = normStudentId(s.studentId);
    if (sid && !bySid.has(sid)) bySid.set(sid, s);
  });
  return { byId: byId, bySid: bySid };
}

/* The record already using this Student ID (archived or active). */
function studentConflict(studentId, ignoreId, index) {
  const sid = normStudentId(studentId);
  if (!sid) return null;
  const src = index || buildStudentIndex(studentRecords());
  const clash = src.bySid.get(sid) || null;
  if (!clash) return null;
  if (ignoreId && clash.id === ignoreId) return null;
  return clash;
}

function pickStudentFields(input, current) {
  const out = {};
  const source = input || {};
  STUDENT_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      out[field] = source[field];
    } else if (current && Object.prototype.hasOwnProperty.call(current, field)) {
      out[field] = current[field];
    }
  });
  return out;
}

/* Validates a student record and returns the cleaned record + errors.
   `index` is the register index (built once per request) and `batchSids`
   holds the Student IDs already used inside the current batch. */
function validateStudent(input, current, index, batchSids) {
  const errors = [];
  const record = pickStudentFields(input, current);

  record.name = String(record.name == null ? '' : record.name).trim();
  record.class = String(record.class == null ? '' : record.class).trim();
  record.studentId = String(record.studentId == null ? '' : record.studentId).trim();
  record.fatherName = String(record.fatherName == null ? '' : record.fatherName).trim();
  record.mobile = String(record.mobile == null ? '' : record.mobile).trim();
  record.phoneRes = String(record.phoneRes == null ? '' : record.phoneRes).trim();
  record.phone = record.phoneRes || String(record.phone == null ? '' : record.phone).trim();
  record.address = String(record.address == null ? '' : record.address).trim();
  record.section = String(record.section == null ? '' : record.section).trim();
  record.gender = String(record.gender == null ? '' : record.gender).trim();
  record.dob = String(record.dob == null ? '' : record.dob).trim();
  record.admissionDate = String(record.admissionDate == null ? '' : record.admissionDate).trim();
  record.email = String(record.email == null ? '' : record.email).trim();
  record.session = String(record.session == null ? '' : record.session).trim();
  record.status = record.status ? String(record.status) : 'active';
  record.rollNo = record.rollNo === 0 ? 0 : (record.rollNo == null ? '' : record.rollNo);
  if (record.photo === undefined) record.photo = '';
  if (record.photoKey === undefined) record.photoKey = '';

  if (record.name.length < 2) errors.push({ field: 'name', message: "Enter the student's full name." });
  if (!record.class) errors.push({ field: 'class', message: 'Select a class.' });
  if (!record.studentId) {
    errors.push({ field: 'studentId', message: 'A Student ID is required.' });
  } else {
    const sid = normStudentId(record.studentId);
    const clash = studentConflict(record.studentId, current ? current.id : null, index);
    const batchClash = batchSids && batchSids.has(sid) &&
      batchSids.get(sid) !== (current ? current.id : null);
    if (clash || batchClash) {
      const existing = clash || { studentId: record.studentId, deletedAt: '' };
      errors.push({
        field: 'studentId',
        message: 'This Student ID already exists. Please enter a unique Student ID.',
        conflict: existing.deletedAt ? 'archived' : 'duplicate',
        existing: existing
      });
    }
  }

  if (record.mobile && !/^03\d{9}$/.test(record.mobile.replace(/[\s-]/g, ''))) {
    errors.push({ field: 'mobile', message: 'Use format 03XXXXXXXXX (11 digits).' });
  }
  if (record.phoneRes && !/^[0-9+\-\s()]{7,20}$/.test(record.phoneRes)) {
    errors.push({ field: 'phoneRes', message: 'Enter a valid residential phone number.' });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (record.dob && record.dob > today) {
    errors.push({ field: 'dob', message: 'Date of birth cannot be in the future.' });
  }
  if (record.admissionDate && record.admissionDate > today) {
    errors.push({ field: 'admissionDate', message: 'Admission date cannot be in the future.' });
  }

  return { record: record, errors: errors };
}

/* A free internal id derived from the Student ID. */
function freeStudentId(studentId, taken) {
  const base = 'stu_' + String(studentId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  let id = base;
  let n = 2;
  while (taken.has(id)) { id = base + '_' + n; n++; }
  return id;
}

/* Re-assigns the roll numbers of one class + section + session in Student-ID
   order — the same rule the browser applies. */
function resequenceScope(list, className, section, session) {
  const scope = list.filter(s => s && !s.deletedAt &&
    String(s.class || '') === String(className || '') &&
    String(s.section || '') === String(section || '') &&
    String(s.session || '') === String(session || ''));
  scope.sort(studentSort);
  scope.forEach((s, i) => { s.rollNo = i + 1; });
}

function writeStudents(list, by) {
  return setKeyValue(STUDENT_KEY, list, by);
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function studentsCsv(rows) {
  const header = [
    'Student ID', 'Student Name', 'Father Name', 'Class', 'Section', 'Roll No',
    'Contact Number', 'Residential Phone', 'Permanent Address',
    'Admission Date', 'Academic Session', 'Status'
  ];
  const lines = [header.map(csvCell).join(',')];
  rows.forEach(s => {
    lines.push([
      s.studentId || '', s.name || '', s.fatherName || '', s.class || '', s.section || '',
      s.rollNo === '' || s.rollNo == null ? '' : s.rollNo,
      s.mobile || '', s.phoneRes || s.phone || '', s.address || '',
      s.admissionDate || '', s.session || '', s.status || 'active'
    ].map(csvCell).join(','));
  });
  return lines.join('\r\n');
}
/* Applies a batch of student records to the register in one pass.

   mode 'bulk'  — a spreadsheet import: a Student ID that is already taken is
                   rejected instead of overwriting somebody.
   mode 'delta' — a sync from another browser: records are matched by their
                   id (or by their Student ID when the id is unknown here).

   The register is indexed once, the batch is validated against that index
   and the roll numbers are re-sequenced once per touched class — so a batch
   of 10 000 students costs one pass, not one pass per student. */
function applyStudentBatch(inputs, mode, by) {
  const list = studentRecords().slice();
  const index = buildStudentIndex(list);
  const taken = new Set(index.byId.keys());
  const batchSids = new Map();
  const now = new Date().toISOString();
  const errors = [];
  const scopes = new Map();
  let applied = 0;

  const touchScope = s => {
    const parts = [s.class || '', s.section || '', s.session || ''];
    const key = parts.join('\u0000');
    if (!scopes.has(key)) scopes.set(key, parts);
  };

  (Array.isArray(inputs) ? inputs : []).forEach(input => {
    if (!input || typeof input !== 'object') return;

    /* A record is matched by its id. A record whose id is unknown here but
       whose Student ID belongs to somebody else is a clash, not an update. */
    const current = input.id ? index.byId.get(input.id) : null;

    const result = validateStudent(input, current, index, batchSids);
    if (result.errors.length) {
      errors.push({
        studentId: (input && input.studentId) || '',
        errors: result.errors.map(e => ({ field: e.field, message: e.message }))
      });
      return;
    }

    const record = result.record;
    const wanted = String(input.id || '');
    record.id = current ? current.id
      : ((wanted && !taken.has(wanted)) ? wanted : freeStudentId(record.studentId, taken));
    taken.add(record.id);
    record.updatedAt = now;
    if (!record.createdAt) record.createdAt = now;
    if (record.deletedAt === undefined) record.deletedAt = '';
    if (record.deletedBy === undefined) record.deletedBy = '';

    const sid = normStudentId(record.studentId);
    if (sid) batchSids.set(sid, record.id);

    if (current) {
      const idx = list.indexOf(current);
      const merged = Object.assign({}, current, record);
      list[idx] = merged;
      index.byId.set(merged.id, merged);
      if (sid) index.bySid.set(sid, merged);
      touchScope(merged);
    } else {
      if (record.rollNo === '' || record.rollNo == null) record.rollNo = '';
      list.push(record);
      index.byId.set(record.id, record);
      if (sid) index.bySid.set(sid, record);
      touchScope(record);
    }
    applied++;
  });

  /* One re-sequencing pass per touched class + section + session. */
  scopes.forEach(parts => resequenceScope(list, parts[0], parts[1], parts[2]));

  return { list: list, applied: applied, errors: errors };
}

async function handleStudentsAPI(req, res, pathname, method) {
  if (pathname !== '/api/students' && pathname.indexOf('/api/students/') !== 0 &&
      pathname !== '/api/storage') {
    return false;
  }

  /* The register, exports and storage report contain private student data. */
  const authed = validAdmin(req);
  if (!authed) {
    sendJSON(res, 401, { ok: false, message: 'Sign in to read student records.' });
    return true;
  }

  /* GET /api/storage — how much space each key uses and how fresh it is. */
  if (method === 'GET' && pathname === '/api/storage') {
    const perKey = {};
    let total = 0;
    Object.keys(store.keys).forEach(k => {
      const bytes = Buffer.byteLength(JSON.stringify(
        store.keys[k].value === undefined ? null : store.keys[k].value));
      perKey[k] = {
        bytes: bytes,
        updatedAt: store.keys[k].updatedAt,
        updatedBy: store.keys[k].updatedBy,
        version: Number(store.keys[k].version) || 1
      };
      total += bytes;
    });
    sendJSON(res, 200, {
      ok: true,
      total: total,
      students: studentRecords().length,
      keys: perKey
    });
    return true;
  }

  const by = authed.email;

  /* GET /api/students — paged, filtered read. */
  if (method === 'GET' && pathname === '/api/students') {
    const url = new URL(req.url, 'http://localhost');
    const query = {
      q: url.searchParams.get('q') || '',
      class: url.searchParams.get('class') || '',
      section: url.searchParams.get('section') || '',
      status: url.searchParams.get('status') || '',
      session: url.searchParams.get('session') || '',
      view: url.searchParams.get('view') || 'active'
    };
    const rows = filterStudents(query);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 100));
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const page = Math.min(Math.max(1, Number(url.searchParams.get('page')) || 1), pages);
    const start = (page - 1) * limit;
    const entry = store.keys[STUDENT_KEY];
    sendJSON(res, 200, {
      ok: true,
      rows: rows.slice(start, start + limit),
      total: rows.length,
      page: page,
      pages: pages,
      limit: limit,
      start: rows.length ? start + 1 : 0,
      end: Math.min(start + limit, rows.length),
      version: entry ? (Number(entry.version) || 1) : 0
    });
    return true;
  }

  /* GET /api/students/export — CSV or JSON of the whole register. */
  if (method === 'GET' && pathname === '/api/students/export') {
    const url = new URL(req.url, 'http://localhost');
    const format = (url.searchParams.get('format') || 'json').toLowerCase();
    const rows = filterStudents({
      q: url.searchParams.get('q') || '',
      class: url.searchParams.get('class') || '',
      section: url.searchParams.get('section') || '',
      status: url.searchParams.get('status') || '',
      session: url.searchParams.get('session') || '',
      view: url.searchParams.get('view') || 'active'
    });
    if (format === 'csv') {
      const csv = studentsCsv(rows);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Length': Buffer.byteLength(csv),
        'Content-Disposition': 'attachment; filename="students.csv"',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(csv);
      return true;
    }
    sendJSON(res, 200, { ok: true, rows: rows, total: rows.length });
    return true;
  }

  /* POST /api/students — create one student. */
  if (method === 'POST' && pathname === '/api/students') {
    const body = await readBody(req);
    const index = buildStudentIndex(studentRecords());
    const result = validateStudent(body, null, index, null);
    if (result.errors.length) {
      const conflict = result.errors.find(e => e.conflict);
      sendJSON(res, conflict ? 409 : 422, {
        ok: false,
        message: conflict ? conflict.message : 'The student record is not valid.',
        errors: result.errors.map(e => ({ field: e.field, message: e.message }))
      });
      return true;
    }
    const list = studentRecords().slice();
    const now = new Date().toISOString();
    const record = result.record;
    record.id = record.id || freeStudentId(record.studentId, new Set(list.map(s => s.id)));
    record.createdAt = record.createdAt || now;
    record.updatedAt = now;
    record.deletedAt = record.deletedAt || '';
    record.deletedBy = record.deletedBy || '';
    record.rollNo = '';
    list.push(record);
    resequenceScope(list, record.class, record.section, record.session);
    const entry = writeStudents(list, by);
    sendJSON(res, 201, {
      ok: true,
      student: record,
      version: entry.version,
      total: list.length
    });
    return true;
  }

  /* POST /api/students/bulk — create or update many students in one write. */
  if (method === 'POST' && pathname === '/api/students/bulk') {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : body.students;
    if (!Array.isArray(incoming)) {
      sendJSON(res, 400, { ok: false, message: 'Expected an array of students.' });
      return true;
    }
    const result = applyStudentBatch(incoming, 'bulk', by);
    const entry = writeStudents(result.list, by);
    sendJSON(res, 200, {
      ok: true,
      applied: result.applied,
      rejected: result.errors.length,
      errors: result.errors.slice(0, 50),
      version: entry.version,
      total: result.list.length
    });
    return true;
  }

  /* PUT /api/students/delta — apply a batch of changes in one write. */
  if (method === 'PUT' && pathname === '/api/students/delta') {
    const body = await readBody(req);
    const upserts = Array.isArray(body.upserts) ? body.upserts : [];
    const removes = Array.isArray(body.removes) ? body.removes : [];
    const result = applyStudentBatch(upserts, 'delta', by);
    const list = result.list;

    const now = new Date().toISOString();
    const scopes = new Map();
    removes.forEach(id => {
      const target = list.find(s => s.id === id);
      if (!target) return;
      target.status = 'inactive';
      target.deletedAt = now;
      target.deletedBy = by;
      target.updatedAt = now;
      const parts = [target.class || '', target.section || '', target.session || ''];
      scopes.set(parts.join('\u0000'), parts);
      result.applied++;
    });
    scopes.forEach(parts => resequenceScope(list, parts[0], parts[1], parts[2]));

    const entry = writeStudents(list, by);
    sendJSON(res, 200, {
      ok: true,
      applied: result.applied,
      rejected: result.errors.length,
      errors: result.errors.slice(0, 50),
      version: entry.version,
      total: list.length
    });
    return true;
  }

  /* PUT /api/students — replace the whole register (bulk client fallback). */
  if (method === 'PUT' && pathname === '/api/students') {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : body.students;
    if (!Array.isArray(incoming)) {
      sendJSON(res, 400, { ok: false, message: 'Expected an array of students.' });
      return true;
    }
    const taken = new Set();
    const now = new Date().toISOString();
    const list = incoming.filter(s => s && typeof s === 'object').map(s => {
      const copy = pickStudentFields(s, null);
      copy.id = copy.id || freeStudentId(copy.studentId, taken);
      taken.add(copy.id);
      copy.rollNo = copy.rollNo == null ? '' : copy.rollNo;
      copy.createdAt = copy.createdAt || now;
      copy.updatedAt = now;
      return copy;
    });
    const scopes = new Map();
    list.forEach(s => {
      const parts = [s.class || '', s.section || '', s.session || ''];
      scopes.set(parts.join('\u0000'), parts);
    });
    scopes.forEach(parts => resequenceScope(list, parts[0], parts[1], parts[2]));
    const entry = writeStudents(list, by);
    sendJSON(res, 200, { ok: true, version: entry.version, total: list.length });
    return true;
  }

  /* Single-record routes: /api/students/:id[/restore] */
  const single = /^\/api\/students\/([A-Za-z0-9_-]+)(\/restore)?$/.exec(pathname);
  if (single) {
    const id = single[1];
    const isRestore = !!single[2];

    if (method === 'GET' && !isRestore) {
      const found = studentRecords().find(s => s.id === id);
      if (!found) {
        sendJSON(res, 404, { ok: false, message: 'Student not found.' });
        return true;
      }
      sendJSON(res, 200, { ok: true, student: found });
      return true;
    }

    if (method === 'POST' && isRestore) {
      const list = studentRecords().slice();
      const idx = list.findIndex(s => s.id === id);
      if (idx === -1) {
        sendJSON(res, 404, { ok: false, message: 'Student not found.' });
        return true;
      }
      list[idx] = Object.assign({}, list[idx], {
        status: 'active',
        deletedAt: '',
        deletedBy: '',
        updatedAt: new Date().toISOString()
      });
      resequenceScope(list, list[idx].class, list[idx].section, list[idx].session);
      const entry = writeStudents(list, by);
      sendJSON(res, 200, { ok: true, student: list[idx], version: entry.version });
      return true;
    }

    if (method === 'DELETE' && !isRestore) {
      const list = studentRecords().slice();
      const idx = list.findIndex(s => s.id === id);
      if (idx === -1) {
        sendJSON(res, 404, { ok: false, message: 'Student not found.' });
        return true;
      }
      const now = new Date().toISOString();
      list[idx] = Object.assign({}, list[idx], {
        status: 'inactive',
        deletedAt: now,
        deletedBy: by,
        updatedAt: now
      });
      resequenceScope(list, list[idx].class, list[idx].section, list[idx].session);
      const entry = writeStudents(list, by);
      sendJSON(res, 200, { ok: true, student: list[idx], version: entry.version });
      return true;
    }

    if (method === 'PUT' && !isRestore) {
      const body = await readBody(req);
      const list = studentRecords().slice();
      const idx = list.findIndex(s => s.id === id);
      if (idx === -1) {
        sendJSON(res, 404, { ok: false, message: 'Student not found.' });
        return true;
      }
      const index = buildStudentIndex(list);
      const result = validateStudent(body, list[idx], index, null);
      if (result.errors.length) {
        const conflict = result.errors.find(e => e.conflict);
        sendJSON(res, conflict ? 409 : 422, {
          ok: false,
          message: conflict ? conflict.message : 'The student record is not valid.',
          errors: result.errors.map(e => ({ field: e.field, message: e.message }))
        });
        return true;
      }
      const record = result.record;
      record.id = id;
      record.updatedAt = new Date().toISOString();
      if (!record.createdAt) record.createdAt = list[idx].createdAt || record.updatedAt;
      list[idx] = Object.assign({}, list[idx], record);
      resequenceScope(list, list[idx].class, list[idx].section, list[idx].session);
      const entry = writeStudents(list, by);
      sendJSON(res, 200, { ok: true, student: list[idx], version: entry.version });
      return true;
    }
  }

  return false;
}
/* --------------------------------------------------------------------------
   API routes
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Teacher API and Super Admin account management
   -------------------------------------------------------------------------- */

function queryOf(req) {
  try {
    return new URL(req.url, 'http://' + (req.headers.host || 'localhost')).searchParams;
  } catch (err) {
    return new URLSearchParams();
  }
}

function pkDateNow() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function pkTimeNow() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
}

function activeSessionForDate(date) {
  const list = stateValue('mca_sessions', []);
  if (!Array.isArray(list)) return '';
  const hit = list.find(s => s && s.start <= date && s.end >= date);
  if (hit) return hit.name;
  const active = list.find(s => s && s.active);
  return active ? active.name : '';
}

function round1(n) {
  return Math.round((Number(n) + Number.EPSILON) * 10) / 10;
}

function activeExamSubjects(exam) {
  return ((exam && exam.subjects) || []).filter(s => s && s.active !== false);
}

function examSubjMax(sub) {
  if (!sub) return 0;
  if (sub.type === 'combined') return (Number(sub.theoryMax) || 0) + (Number(sub.practicalMax) || 0);
  return Number(sub.maxMarks) || 0;
}

function examSubjPass(sub) {
  if (!sub) return 0;
  if (sub.type === 'combined') return (Number(sub.theoryPass) || 0) + (Number(sub.practicalPass) || 0);
  return Number(sub.passMarks) || 0;
}

function examSubjObtained(sub, mark) {
  if (!mark) return 0;
  if (sub.type === 'combined') {
    return (Number(mark.theoryObtained) || 0) + (Number(mark.practicalObtained) || 0);
  }
  return Number(mark.obtained) || 0;
}

function gradeFor(percentage, grading) {
  const hit = (grading || []).find(g => percentage >= Number(g.min) && percentage <= Number(g.max));
  return hit ? String(hit.grade || '') : '';
}

function markIndex() {
  const list = stateValue('mca_marks', []);
  const map = new Map();
  (Array.isArray(list) ? list : []).forEach(m => {
    if (!m) return;
    map.set([m.examId, m.subjectId, m.studentId].join('\u0000'), m);
  });
  return map;
}

function markFor(marks, examId, subjectId, student) {
  if (!marks || !student) return null;
  const byId = marks.get([examId, subjectId, student.id].join('\u0000'));
  if (byId) return byId;
  return student.studentId
    ? marks.get([examId, subjectId, student.studentId].join('\u0000')) || null
    : null;
}

function computeStudentResult(exam, student, marks, settings) {
  const grading = (settings && settings.grading) || [];
  const gradeEnabled = settings ? settings.gradeEnabled !== false : true;
  const rows = [];
  let totalMax = 0;
  let totalObtained = 0;
  let present = 0;
  let absent = 0;
  let withheld = 0;
  let missing = 0;
  let failed = 0;

  activeExamSubjects(exam).forEach(sub => {
    const mark = markFor(marks, exam.id, sub.id, student);
    const status = mark ? String(mark.status || '') : '';
    const max = examSubjMax(sub);
    const pass = examSubjPass(sub);
    const obtained = status === 'present' ? examSubjObtained(sub, mark) : 0;
    const pct = max ? round1(obtained / max * 100) : 0;
    const row = {
      subjectId: sub.id, name: sub.name, code: sub.code, type: sub.type,
      max, pass, obtained, pct, status, result: '', grade: '', remark: ''
    };
    if (status === 'present') {
      present++;
      row.result = obtained >= pass ? 'Pass' : 'Fail';
      if (row.result === 'Fail') failed++;
      row.grade = gradeEnabled ? gradeFor(pct, grading) : '';
      totalObtained += obtained;
    } else if (status === 'absent') {
      absent++; row.result = 'Absent'; row.remark = 'Absent';
      row.grade = gradeEnabled ? 'F' : '';
    } else if (status === 'withheld') {
      withheld++; row.result = 'Withheld'; row.remark = 'Withheld';
    } else {
      missing++; row.result = 'Not Entered'; row.remark = 'Not Entered';
    }
    totalMax += max;
    rows.push(row);
  });

  let result = 'Incomplete';
  if (activeExamSubjects(exam).length && !missing) {
    if (withheld) result = 'Withheld';
    else if (present === 0 && absent > 0) result = 'Absent';
    else result = failed ? 'Fail' : 'Pass';
  }
  const percentage = totalMax ? round1(totalObtained / totalMax * 100) : 0;
  const grade = gradeEnabled && (result === 'Pass' || result === 'Fail')
    ? gradeFor(percentage, grading) : '';
  return {
    rows, totalMax, totalObtained, percentage, result, grade,
    counts: { present, absent, withheld, missing }
  };
}

function resultsForExam(exam) {
  const students = studentRecords().filter(s => s && !s.deletedAt && s.class === exam.className).sort(studentSort);
  const marks = markIndex();
  const settings = stateValue('mca_exam_settings', {});
  const computed = students.map(student => ({
    student: {
      id: student.id, studentId: student.studentId, rollNo: student.rollNo,
      name: student.name, fatherName: student.fatherName,
      className: student.class, section: student.section, session: student.session
    },
    result: computeStudentResult(exam, student, marks, settings)
  }));
  const scored = computed.filter(row => row.result.result === 'Pass' || row.result.result === 'Fail')
    .sort((a, b) => (b.result.totalObtained - a.result.totalObtained) ||
      (b.result.percentage - a.result.percentage) ||
      String(a.student.studentId).localeCompare(String(b.student.studentId), undefined, { numeric: true }));
  const positions = new Map();
  scored.forEach((row, i) => positions.set(row.student.id, i + 1));
  computed.forEach(row => { row.position = positions.get(row.student.id) || null; });
  return computed;
}

function teacherExam(teacher, examId) {
  const classes = new Set(teacherClasses(teacher));
  const exam = (stateValue('mca_exams', []) || []).find(e =>
    e && e.id === examId && e.status !== 'archived' && classes.has(e.className));
  return exam || null;
}

function teacherExamSubject(teacher, exam, subjectId) {
  const sub = ((exam && exam.subjects) || []).find(s => s.id === subjectId);
  return sub && examSubjectAssigned(teacher, exam, sub) ? sub : null;
}

function teacherExamRoster(exam) {
  return studentRecords().filter(s => s && !s.deletedAt && s.class === exam.className).sort(studentSort);
}

function teacherDashboard(teacher) {
  const today = pkDateNow();
  const classes = teacherClasses(teacher);
  const students = scopedStudents(teacher);
  const attendance = stateValue('mca_attendance', []);
  const todayRows = (Array.isArray(attendance) ? attendance : []).filter(r =>
    r && r.date === today && classes.includes(r.className) && r.submittedByTeacherId === teacher.id);
  const exams = (stateValue('mca_exams', []) || []).filter(e =>
    e && e.status !== 'archived' && classes.includes(e.className));
  const upcomingExams = exams
    .filter(e => (e.startDate || e.resultDate || '') >= today || e.status === 'ongoing')
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
    .slice(0, 5)
    .map(e => ({
      id: e.id, name: e.name, type: e.type, className: e.className,
      startDate: e.startDate, endDate: e.endDate, resultDate: e.resultDate, status: e.status
    }));
  const marks = markIndex();
  let pendingMarks = 0;
  exams.forEach(exam => {
    const roster = teacherExamRoster(exam);
    ((exam.subjects) || []).filter(s => s && s.active !== false && examSubjectAssigned(teacher, exam, s))
      .forEach(sub => {
        roster.forEach(student => {
          const m = markFor(marks, exam.id, sub.id, student);
          if (!m || !m.status) pendingMarks++;
        });
      });
  });
  const planner = [];
  exams.forEach(exam => {
    (exam.schedule || []).forEach(row => {
      if (row && row.date && row.subjectName) {
        planner.push({
          date: row.date, endDate: row.endDate || '', title: exam.name + ' - ' + row.subjectName,
          type: 'exam', className: exam.className, code: 'EXAM'
        });
      }
    });
  });
  return {
    stats: {
      students: students.length,
      classes: classes.length,
      subjects: assignedSubjects(teacher).length,
      todaySheets: todayRows.length,
      todayPresent: todayRows.reduce((n, r) => n + (r.entries || []).filter(e => e.status === 'present').length, 0),
      todayAbsent: todayRows.reduce((n, r) => n + (r.entries || []).filter(e => e.status === 'absent').length, 0),
      pendingMarks,
      upcomingExams: upcomingExams.length
    },
    upcomingExams,
    planner: planner.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 10),
    recentAttendance: todayRows.slice(0, 5).map(r => ({
      id: r.id, className: r.className, subject: r.subject, date: r.date,
      submittedAt: r.submittedAt, entries: (r.entries || []).length
    }))
  };
}

function adminTeacherStats() {
  const teachers = authStore.teachers;
  const today = pkDateNow();
  const attendance = stateValue('mca_attendance', []);
  const todayRows = (Array.isArray(attendance) ? attendance : []).filter(r => r && r.date === today);
  return {
    teachers: teachers.length,
    active: teachers.filter(t => t.status === 'active').length,
    disabled: teachers.filter(t => t.status === 'disabled').length,
    resetRequests: teachers.filter(t => t.resetRequestedAt).length,
    todaySheets: todayRows.length,
    teacherSheetsToday: todayRows.filter(r => r.source === 'teacher').length,
    classes: (stateValue('mca_classes', []) || []).length,
    subjects: catalogSubjects().length,
    students: studentRecords().filter(s => s && !s.deletedAt).length,
    attendanceRecords: Array.isArray(attendance) ? attendance.length : 0
  };
}

async function handleTeacherAPI(req, res, pathname, method) {
  if (!pathname.startsWith('/api/teacher')) return false;

  if (method === 'POST' && pathname === '/api/teacher/auth/login') {
    const body = await readBody(req);
    const identifier = String(body.identifier || body.portalNumber || body.email || '').trim();
    const password = String(body.password || '');
    if (!identifier || !password) {
      return sendJSON(res, 400, { ok: false, message: 'Portal number and password are required.' }), true;
    }
    if (loginBlocked(req, identifier)) {
      return sendJSON(res, 429, { ok: false, message: 'Too many failed attempts. Try again in 15 minutes.' }), true;
    }
    const teacher = findTeacher(identifier);
    if (!teacher || !verifyPassword(password, teacher)) {
      loginFailed(req, identifier);
      auditLog('teacher:' + identifier, 'login.failed', 'teacher', 'Invalid teacher credentials.');
      return sendJSON(res, 401, { ok: false, message: 'Invalid portal number or password.' }), true;
    }
    if (teacher.status !== 'active') {
      auditLog('teacher:' + teacher.portalNumber, 'login.disabled', teacher.id, 'Disabled account attempt.');
      return sendJSON(res, 403, { ok: false, message: 'This teacher account is disabled.' }), true;
    }
    loginSucceeded(req, identifier);
    teacher.lastLoginAt = new Date().toISOString();
    saveAuthStore();
    const token = teacherToken(teacher);
    auditLog('teacher:' + teacher.portalNumber, 'login', teacher.id, 'Teacher signed in.');
    return sendJSON(res, 200, {
      ok: true, token, expiresAt: Date.now() + TOKEN_TTL_MS,
      teacher: publicTeacher(teacher), meta: teacherMeta(teacher),
      mustChangePassword: !!teacher.mustChangePassword
    }), true;
  }

  if (method === 'POST' && pathname === '/api/teacher/auth/forgot') {
    const body = await readBody(req);
    const identifier = String(body.identifier || '').trim();
    const teacher = findTeacher(identifier);
    if (teacher) {
      teacher.resetRequestedAt = new Date().toISOString();
      saveAuthStore();
      auditLog('teacher:' + teacher.portalNumber, 'password.reset_requested', teacher.id,
        'Teacher requested a password reset from the sign-in page.');
    }
    return sendJSON(res, 200, {
      ok: true,
      message: 'If this account exists, the Super Admin can now see the reset request.'
    }), true;
  }

  const authed = validTeacher(req);
  if (!authed) return sendJSON(res, 401, { ok: false, message: 'Teacher sign-in required.' }), true;
  const teacher = authed.teacher;

  if (method === 'POST' && pathname === '/api/teacher/auth/logout') {
    tokens.delete(authed.auth.token);
    auditLog('teacher:' + teacher.portalNumber, 'logout', teacher.id, 'Teacher signed out.');
    return sendJSON(res, 200, { ok: true }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/me') {
    return sendJSON(res, 200, {
      ok: true, teacher: publicTeacher(teacher), meta: teacherMeta(teacher),
      mustChangePassword: !!teacher.mustChangePassword
    }), true;
  }

  if (method === 'POST' && pathname === '/api/teacher/auth/change-password') {
    const body = await readBody(req);
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (!verifyPassword(current, teacher)) {
      return sendJSON(res, 400, { ok: false, message: 'Current password is incorrect.' }), true;
    }
    const problem = passwordProblem(next);
    if (problem) return sendJSON(res, 400, { ok: false, message: problem }), true;
    if (current === next) {
      return sendJSON(res, 400, { ok: false, message: 'Choose a password different from the current one.' }), true;
    }
    const hashed = hashPassword(next);
    teacher.passwordSalt = hashed.salt;
    teacher.passwordHash = hashed.hash;
    teacher.mustChangePassword = false;
    teacher.passwordChangedAt = new Date().toISOString();
    teacher.resetRequestedAt = null;
    saveAuthStore();
    revokeTeacherTokens(teacher.id);
    const token = teacherToken(teacher);
    auditLog('teacher:' + teacher.portalNumber, 'password.change', teacher.id, 'Teacher changed their password.');
    return sendJSON(res, 200, {
      ok: true, token, expiresAt: Date.now() + TOKEN_TTL_MS,
      teacher: publicTeacher(teacher), mustChangePassword: false
    }), true;
  }

  if (teacher.mustChangePassword) {
    return sendJSON(res, 403, {
      ok: false, code: 'password_change_required',
      message: 'Set a new password before using the teacher portal.'
    }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/dashboard') {
    return sendJSON(res, 200, {
      ok: true, teacher: publicTeacher(teacher), meta: teacherMeta(teacher),
      dashboard: teacherDashboard(teacher)
    }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/profile') {
    return sendJSON(res, 200, {
      ok: true, teacher: publicTeacher(teacher), meta: teacherMeta(teacher)
    }), true;
  }

  if (method === 'PUT' && pathname === '/api/teacher/profile') {
    const body = await readBody(req);
    const email = cleanString(body.email !== undefined ? body.email : teacher.email, 160).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJSON(res, 400, { ok: false, message: 'Enter a valid email address.' }), true;
    }
    if (email && authStore.teachers.some(t => t.id !== teacher.id && String(t.email || '').toLowerCase() === email)) {
      return sendJSON(res, 409, { ok: false, message: 'That email is already used by another teacher.' }), true;
    }
    const photo = cleanString(body.photo !== undefined ? body.photo : teacher.photo, 700000);
    if (photo && (!/^data:image\/(png|jpe?g|webp);base64,/i.test(photo) || photo.length > 700000)) {
      return sendJSON(res, 400, { ok: false, message: 'Photo must be a PNG, JPEG or WebP under 700 KB.' }), true;
    }
    teacher.contact = cleanString(body.contact !== undefined ? body.contact : teacher.contact, 60);
    teacher.email = email;
    teacher.qualification = cleanString(body.qualification !== undefined ? body.qualification : teacher.qualification, 120);
    teacher.photo = photo;
    teacher.updatedAt = new Date().toISOString();
    saveAuthStore();
    auditLog('teacher:' + teacher.portalNumber, 'profile.update', teacher.id, 'Teacher updated contact details.');
    return sendJSON(res, 200, { ok: true, teacher: publicTeacher(teacher) }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/students') {
    if (!teacherCan(teacher, 'viewStudents')) {
      return sendJSON(res, 403, { ok: false, message: 'Student viewing is not enabled for your account.' }), true;
    }
    const q = queryOf(req);
    const className = cleanString(q.get('class'), 120);
    const classes = new Set(teacherClasses(teacher));
    if (className && !classes.has(className)) {
      return sendJSON(res, 403, { ok: false, message: 'Class is not assigned to you.' }), true;
    }
    const search = String(q.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(q.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 25));
    let rows = scopedStudents(teacher).filter(s =>
      (!className || s.class === className) &&
      (!search || [s.name, s.studentId, s.rollNo, s.fatherName, s.class].join(' ').toLowerCase().includes(search))
    );
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const start = (Math.min(page, pages) - 1) * limit;
    rows = rows.slice(start, start + limit).map(s => ({
      studentId: s.studentId, rollNo: s.rollNo, name: s.name,
      fatherName: s.fatherName, className: s.class, section: s.section,
      session: s.session, status: s.status
    }));
    return sendJSON(res, 200, { ok: true, rows, total, page: Math.min(page, pages), pages, limit, start, end: start + rows.length }), true;
  }

  const studentMatch = /^\/api\/teacher\/students\/([^/]+)$/.exec(pathname);
  if (studentMatch && method === 'GET') {
    if (!teacherCan(teacher, 'viewStudents')) {
      return sendJSON(res, 403, { ok: false, message: 'Student viewing is not enabled for your account.' }), true;
    }
    const key = decodeURIComponent(studentMatch[1]);
    const student = scopedStudents(teacher).find(s => s.id === key || String(s.studentId) === key);
    if (!student) return sendJSON(res, 404, { ok: false, message: 'Student not found in your classes.' }), true;
    const records = stateValue('mca_attendance', []);
    let present = 0, absent = 0, leave = 0;
    (Array.isArray(records) ? records : []).forEach(rec => {
      if (!rec || !teacherClasses(teacher).includes(rec.className)) return;
      (rec.entries || []).forEach(en => {
        if (String(en.studentId) !== String(student.studentId)) return;
        if (en.status === 'present') present++;
        else if (en.status === 'absent') absent++;
        else if (en.status === 'leave') leave++;
      });
    });
    return sendJSON(res, 200, {
      ok: true,
      student: {
        studentId: student.studentId, rollNo: student.rollNo, name: student.name,
        fatherName: student.fatherName, className: student.class, section: student.section,
        session: student.session, status: student.status
      },
      attendance: { present, absent, leave, total: present + absent + leave }
    }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/attendance') {
    if (!teacherCan(teacher, 'takeAttendance') && !teacherCan(teacher, 'viewAttendanceReports')) {
      return sendJSON(res, 403, { ok: false, message: 'Attendance access is not enabled for your account.' }), true;
    }
    const q = queryOf(req);
    const className = cleanString(q.get('class'), 120) || teacherClasses(teacher)[0] || '';
    const section = cleanString(q.get('section'), 40);
    const subjects = assignedSubjects(teacher).filter(s => !className || s.className === className);
    const subject = cleanString(q.get('subject'), 120) || (subjects[0] ? subjects[0].name : '');
    const date = cleanString(q.get('date'), 10) || pkDateNow();
    const sheet = attendanceSheet(teacher, className, section, subject, date);
    if (sheet.error) return sendJSON(res, sheet.status, { ok: false, message: sheet.error }), true;
    return sendJSON(res, 200, {
      ok: true, classes: teacherClasses(teacher),
      subjects: subjects.map(s => ({ id: s.id, name: s.name, code: s.code, className: s.className })),
      className, section, subject, date, roster: sheet.roster, saved: sheet.saved
    }), true;
  }

  if (method === 'POST' && pathname === '/api/teacher/attendance') {
    if (!teacherCan(teacher, 'takeAttendance')) {
      return sendJSON(res, 403, { ok: false, message: 'Attendance entry is not enabled for your account.' }), true;
    }
    const body = await readBody(req);
    const className = cleanString(body.className, 120);
    const section = cleanString(body.section, 40);
    const subject = cleanString(body.subject, 120);
    const date = cleanString(body.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return sendJSON(res, 400, { ok: false, message: 'Choose a valid attendance date.' }), true;
    }
    if (date > pkDateNow()) {
      return sendJSON(res, 400, { ok: false, message: 'Future attendance cannot be submitted.' }), true;
    }
    if (!Array.isArray(body.entries) || !body.entries.length) {
      return sendJSON(res, 400, { ok: false, message: 'Attendance entries are required.' }), true;
    }
    const sheet = attendanceSheet(teacher, className, section, subject, date);
    if (sheet.error) return sendJSON(res, sheet.status, { ok: false, message: sheet.error }), true;
    const roster = new Map(sheet.roster.map(s => [String(s.studentId), s]));
    const seen = new Set();
    const entries = [];
    for (const input of body.entries) {
      if (!input || !roster.has(String(input.studentId))) {
        return sendJSON(res, 400, { ok: false, message: 'An entry is not part of this class roster.' }), true;
      }
      const sid = String(input.studentId);
      if (seen.has(sid)) return sendJSON(res, 400, { ok: false, message: 'Duplicate student entry.' }), true;
      seen.add(sid);
      const status = String(input.status || '');
      if (['present', 'absent', 'leave'].indexOf(status) === -1) {
        return sendJSON(res, 400, { ok: false, message: 'Attendance status must be present, absent or leave.' }), true;
      }
      const row = roster.get(sid);
      entries.push({ studentId: sid, rollNo: row.rollNo, status, remarks: cleanString(input.remarks, 300) });
    }
    if (sheet.saved && !teacherCan(teacher, 'editAttendance')) {
      return sendJSON(res, 409, {
        ok: false,
        message: 'Attendance for this class, subject and date is already submitted. Ask the Super Admin for edit permission.'
      }), true;
    }
    const records = (stateValue('mca_attendance', []) || []).slice();
    const keyMatch = records.findIndex(r => r && r.date === date && r.className === className &&
      String(r.section || '') === section && String(r.subject || '') === subject);
    const record = {
      id: keyMatch > -1 ? records[keyMatch].id : 'att_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex'),
      date, className, section, subject, entries,
      session: activeSessionForDate(date),
      submittedAt: pkTimeNow(),
      action: keyMatch > -1 ? 'updated' : 'submitted',
      submittedBy: teacher.fullName,
      submittedByTeacherId: teacher.id,
      submittedByPortalNumber: teacher.portalNumber,
      source: 'teacher'
    };
    if (keyMatch > -1) records[keyMatch] = record; else records.push(record);
    setKeyValue('mca_attendance', records, 'teacher:' + teacher.portalNumber);
    auditLog('teacher:' + teacher.portalNumber, 'attendance.' + record.action, record.id,
      className + ' / ' + (subject || 'General') + ' / ' + date + ' / ' + entries.length + ' students');
    return sendJSON(res, 200, { ok: true, record }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/attendance/history') {
    if (!teacherCan(teacher, 'viewAttendanceReports')) {
      return sendJSON(res, 403, { ok: false, message: 'Attendance reports are not enabled for your account.' }), true;
    }
    const q = queryOf(req);
    const classes = new Set(teacherClasses(teacher));
    const from = cleanString(q.get('from'), 10);
    const to = cleanString(q.get('to'), 10);
    const rows = (stateValue('mca_attendance', []) || []).filter(r => {
      if (!r || !classes.has(r.className)) return false;
      if (r.subject) {
        const allowed = new Set(teacherSubjectNames(teacher, r.className));
        if (!allowed.has(String(r.subject).toLowerCase())) return false;
      }
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 500);
    return sendJSON(res, 200, {
      ok: true,
      rows: rows.map(r => ({
        id: r.id, date: r.date, className: r.className, section: r.section || '',
        subject: r.subject || '', session: r.session || '', submittedAt: r.submittedAt || '',
        submittedBy: r.submittedBy || '', source: r.source || 'admin',
        present: (r.entries || []).filter(e => e.status === 'present').length,
        absent: (r.entries || []).filter(e => e.status === 'absent').length,
        leave: (r.entries || []).filter(e => e.status === 'leave').length,
        total: (r.entries || []).length
      }))
    }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/exams') {
    const classes = new Set(teacherClasses(teacher));
    const exams = (stateValue('mca_exams', []) || []).filter(e =>
      e && e.status !== 'archived' && classes.has(e.className));
    return sendJSON(res, 200, {
      ok: true,
      rows: exams.map(e => ({
        id: e.id, name: e.name, type: e.type, className: e.className,
        startDate: e.startDate, endDate: e.endDate, resultDate: e.resultDate,
        status: e.status, academicYear: e.academicYear,
        subjects: ((e.subjects) || []).filter(s => s && s.active !== false && examSubjectAssigned(teacher, e, s))
          .map(s => ({ id: s.id, name: s.name, code: s.code, type: s.type })),
        schedule: (e.schedule || []).filter(r => r && r.date)
      }))
    }), true;
  }

  const publishMatch = /^\/api\/teacher\/exams\/([^/]+)\/publish$/.exec(pathname);
  if (publishMatch && method === 'POST') {
    if (!teacherCan(teacher, 'publishResults')) {
      return sendJSON(res, 403, { ok: false, message: 'Result publishing is not enabled for your account.' }), true;
    }
    const exam = teacherExam(teacher, decodeURIComponent(publishMatch[1]));
    if (!exam) return sendJSON(res, 404, { ok: false, message: 'Examination not found in your classes.' }), true;
    const results = resultsForExam(exam);
    if (!results.length) {
      return sendJSON(res, 409, { ok: false, message: 'There are no students in this class.' }), true;
    }
    const incomplete = results.filter(row => row.result.result === 'Incomplete').length;
    if (incomplete) {
      return sendJSON(res, 409, {
        ok: false,
        message: 'Marks are incomplete for ' + incomplete + ' student' + (incomplete === 1 ? '' : 's') + '.'
      }), true;
    }
    const now = new Date().toISOString();
    exam.status = 'published';
    exam.publishedAt = now;
    exam.updatedAt = now;
    const exams = (stateValue('mca_exams', []) || []).slice();
    const idx = exams.findIndex(e => e && e.id === exam.id);
    if (idx > -1) exams[idx] = exam;
    setKeyValue('mca_exams', exams, 'teacher:' + teacher.portalNumber);
    auditLog('teacher:' + teacher.portalNumber, 'results.publish', exam.id,
      exam.name + ' / ' + exam.className + ' / ' + results.length + ' students');
    return sendJSON(res, 200, { ok: true, exam: { id: exam.id, status: exam.status, publishedAt: exam.publishedAt } }), true;
  }

  const marksMatch = /^\/api\/teacher\/exams\/([^/]+)\/marks$/.exec(pathname);
  if (marksMatch) {
    const exam = teacherExam(teacher, decodeURIComponent(marksMatch[1]));
    if (!exam) return sendJSON(res, 404, { ok: false, message: 'Examination not found in your classes.' }), true;
    if (method === 'GET') {
      if (!teacherCan(teacher, 'enterMarks') && !teacherCan(teacher, 'viewResults')) {
        return sendJSON(res, 403, { ok: false, message: 'Marks access is not enabled for your account.' }), true;
      }
      const subjectId = cleanString(queryOf(req).get('subjectId'), 80);
      const subject = teacherExamSubject(teacher, exam, subjectId);
      if (!subject) return sendJSON(res, 403, { ok: false, message: 'Subject is not assigned to you.' }), true;
      const marks = markIndex();
      const roster = teacherExamRoster(exam).map(s => {
        const mark = markFor(marks, exam.id, subject.id, s);
        return {
          id: s.id, studentId: s.studentId, rollNo: s.rollNo, name: s.name, fatherName: s.fatherName,
          status: mark ? (mark.status || '') : '',
          obtained: mark ? (mark.obtained || 0) : 0,
          theoryObtained: mark ? (mark.theoryObtained || 0) : 0,
          practicalObtained: mark ? (mark.practicalObtained || 0) : 0
        };
      });
      return sendJSON(res, 200, {
        ok: true,
        exam: { id: exam.id, name: exam.name, className: exam.className, status: exam.status },
        subject: {
          id: subject.id, name: subject.name, code: subject.code, type: subject.type,
          maxMarks: examSubjMax(subject), passMarks: examSubjPass(subject),
          theoryMax: Number(subject.theoryMax) || 0, theoryPass: Number(subject.theoryPass) || 0,
          practicalMax: Number(subject.practicalMax) || 0, practicalPass: Number(subject.practicalPass) || 0
        },
        roster
      }), true;
    }
    if (method === 'POST') {
      if (!teacherCan(teacher, 'enterMarks')) {
        return sendJSON(res, 403, { ok: false, message: 'Marks entry is not enabled for your account.' }), true;
      }
      const body = await readBody(req);
      const subject = teacherExamSubject(teacher, exam, cleanString(body.subjectId, 80));
      if (!subject) return sendJSON(res, 403, { ok: false, message: 'Subject is not assigned to you.' }), true;
      if (!Array.isArray(body.marks) || !body.marks.length) {
        return sendJSON(res, 400, { ok: false, message: 'Marks records are required.' }), true;
      }
      const roster = new Map();
      teacherExamRoster(exam).forEach(s => {
        roster.set(String(s.id), s);
        if (s.studentId) roster.set(String(s.studentId), s);
      });
      const max = examSubjMax(subject);
      const maxT = Number(subject.theoryMax) || 0;
      const maxP = Number(subject.practicalMax) || 0;
      const list = (stateValue('mca_marks', []) || []).slice();
      const index = new Map();
      list.forEach((m, i) => { if (m) index.set([m.examId, m.subjectId, m.studentId].join('\u0000'), i); });
      const now = new Date().toISOString();
      for (const input of body.marks) {
        const sid = String(input && input.studentId || '');
        const student = roster.get(sid);
        if (!student) return sendJSON(res, 400, { ok: false, message: 'A mark is not for a student in this class.' }), true;
        const status = String(input.status || '');
        if (['present', 'absent', 'withheld', ''].indexOf(status) === -1) {
          return sendJSON(res, 400, { ok: false, message: 'Invalid marks status.' }), true;
        }
        const obtained = Math.round(Number(input.obtained) || 0);
        const theory = Math.round(Number(input.theoryObtained) || 0);
        const practical = Math.round(Number(input.practicalObtained) || 0);
        if (status === 'present') {
          if (subject.type === 'combined') {
            if (theory < 0 || practical < 0 || theory > maxT || practical > maxP) {
              return sendJSON(res, 400, { ok: false, message: 'Theory/practical marks are outside the allowed range.' }), true;
            }
          } else if (obtained < 0 || obtained > max) {
            return sendJSON(res, 400, { ok: false, message: 'Marks are outside the allowed range.' }), true;
          }
        }
        const key = [exam.id, subject.id, student.id].join('\u0000');
        const legacyKey = student.studentId ? [exam.id, subject.id, student.studentId].join('\u0000') : '';
        const existingPos = index.has(key) ? index.get(key)
          : (legacyKey && index.has(legacyKey) ? index.get(legacyKey) : -1);
        const existing = existingPos > -1 ? list[existingPos] : null;
        if (existing && !teacherCan(teacher, 'editMarks')) {
          const unchanged = String(existing.status || '') === status &&
            Number(existing.obtained || 0) === (status === 'present' ? obtained : 0) &&
            Number(existing.theoryObtained || 0) === (status === 'present' ? theory : 0) &&
            Number(existing.practicalObtained || 0) === (status === 'present' ? practical : 0);
          if (!unchanged) {
            return sendJSON(res, 409, { ok: false, message: 'Marks already exist. Ask the Super Admin for edit permission.' }), true;
          }
        }
        const mark = {
          examId: exam.id, subjectId: subject.id, studentId: student.id,
          className: exam.className, subjectName: subject.name,
          status,
          obtained: status === 'present' ? obtained : 0,
          theoryObtained: status === 'present' ? theory : 0,
          practicalObtained: status === 'present' ? practical : 0,
          updatedAt: now, enteredBy: teacher.fullName,
          enteredByTeacherId: teacher.id
        };
        if (existing) list[existingPos] = Object.assign({}, existing, mark);
        else { list.push(mark); index.set(key, list.length - 1); }
      }
      setKeyValue('mca_marks', list, 'teacher:' + teacher.portalNumber);
      exam.updatedAt = now;
      const exams = (stateValue('mca_exams', []) || []).slice();
      const examIndex = exams.findIndex(e => e && e.id === exam.id);
      if (examIndex > -1) exams[examIndex] = exam;
      setKeyValue('mca_exams', exams, 'teacher:' + teacher.portalNumber);
      auditLog('teacher:' + teacher.portalNumber, 'marks.save', exam.id,
        exam.name + ' / ' + subject.name + ' / ' + body.marks.length + ' students');
      return sendJSON(res, 200, { ok: true, saved: body.marks.length }), true;
    }
  }

  if (method === 'GET' && pathname === '/api/teacher/results') {
    if (!teacherCan(teacher, 'viewResults')) {
      return sendJSON(res, 403, { ok: false, message: 'Results are not enabled for your account.' }), true;
    }
    const exam = teacherExam(teacher, cleanString(queryOf(req).get('examId'), 80));
    if (!exam) return sendJSON(res, 404, { ok: false, message: 'Examination not found in your classes.' }), true;
    const rows = resultsForExam(exam);
    return sendJSON(res, 200, {
      ok: true,
      exam: {
        id: exam.id, name: exam.name, className: exam.className, status: exam.status,
        resultDate: exam.resultDate, academicYear: exam.academicYear
      },
      rows
    }), true;
  }

  const dmcMatch = /^\/api\/teacher\/dmc\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (dmcMatch && method === 'GET') {
    if (!teacherCan(teacher, 'viewResults') || !teacherCan(teacher, 'generateDmc')) {
      return sendJSON(res, 403, { ok: false, message: 'DMC access is not enabled for your account.' }), true;
    }
    const exam = teacherExam(teacher, decodeURIComponent(dmcMatch[1]));
    if (!exam) return sendJSON(res, 404, { ok: false, message: 'Examination not found in your classes.' }), true;
    const key = decodeURIComponent(dmcMatch[2]);
    const row = resultsForExam(exam).find(r => r.student.id === key || String(r.student.studentId) === key);
    if (!row) return sendJSON(res, 404, { ok: false, message: 'Student result not found.' }), true;
    const settings = stateValue('mca_exam_settings', {});
    const college = (stateValue('mca_settings', {}) || {}).college || {};
    const registrationPrefix = String(settings.registrationPrefix || 'MCC-');
    const year = String(exam.academicYear || exam.startDate || '').slice(0, 4) || String(new Date().getFullYear());
    return sendJSON(res, 200, {
      ok: true,
      dmc: {
        college, settings, exam: {
          id: exam.id, name: exam.name, className: exam.className,
          academicYear: exam.academicYear, resultDate: exam.resultDate
        },
        student: Object.assign({}, row.student, {
          registration: registrationPrefix + row.student.studentId
        }),
        rows: row.result.rows,
        totalMax: row.result.totalMax,
        totalObtained: row.result.totalObtained,
        percentage: row.result.percentage,
        grade: row.result.grade,
        result: row.result.result,
        position: row.position,
        dmcNo: 'DMC-' + row.student.studentId + '/' + year
      }
    }), true;
  }

  if (method === 'GET' && pathname === '/api/teacher/planner') {
    if (!teacherCan(teacher, 'viewPlanner')) {
      return sendJSON(res, 403, { ok: false, message: 'Planner access is not enabled for your account.' }), true;
    }
    const classes = new Set(teacherClasses(teacher));
    const events = [];
    (stateValue('mca_exams', []) || []).forEach(exam => {
      if (!exam || exam.status === 'archived' || !classes.has(exam.className)) return;
      (exam.schedule || []).forEach(row => {
        if (row && row.date && row.subjectName) {
          events.push({
            date: row.date, endDate: row.endDate || row.date,
            title: row.subjectName, exam: exam.name, className: exam.className,
            type: 'exam', status: exam.status
          });
        }
      });
      if (exam.startDate && !(exam.schedule || []).length) {
        events.push({
          date: exam.startDate, endDate: exam.endDate || exam.startDate,
          title: exam.name, exam: exam.name, className: exam.className,
          type: 'exam', status: exam.status
        });
      }
    });
    return sendJSON(res, 200, {
      ok: true,
      events: events.sort((a, b) => a.date.localeCompare(b.date)),
      savedPlanner: stateValue('mca_planner', null)
    }), true;
  }

  return sendJSON(res, 404, { ok: false, message: 'Unknown teacher API route.' }), true;
}

async function handleTeacherAdminAPI(req, res, pathname, method) {
  if (!pathname.startsWith('/api/admin')) return false;
  const authed = validAdmin(req);
  if (!authed) return sendJSON(res, 401, { ok: false, message: 'Super Admin sign-in required.' }), true;

  if (method === 'GET' && pathname === '/api/admin/stats') {
    return sendJSON(res, 200, { ok: true, stats: adminTeacherStats(), audit: authStore.audit.slice(0, 8) }), true;
  }

  if (method === 'GET' && pathname === '/api/admin/meta') {
    return sendJSON(res, 200, {
      ok: true,
      classes: ensureCoreClasses(),
      subjects: ensureClassSubjectCatalog(),
      sessions: stateValue('mca_sessions', []) || [],
      permissions: TEACHER_PERMISSIONS,
      defaults: DEFAULT_TEACHER_PERMISSIONS
    }), true;
  }

  if (method === 'GET' && pathname === '/api/admin/teachers') {
    const q = queryOf(req);
    const search = String(q.get('q') || '').trim().toLowerCase();
    const status = String(q.get('status') || '');
    const className = String(q.get('class') || '');
    const page = Math.max(1, Number(q.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 25));
    let rows = authStore.teachers.slice().filter(t => {
      if (status && t.status !== status) return false;
      if (className && !(t.classes || []).includes(className)) return false;
      if (!search) return true;
      const subjects = assignedSubjects(t).map(s => s.name).join(' ');
      return [t.portalNumber, t.fullName, t.fatherName, t.username, t.email, t.designation,
        (t.classes || []).join(' '), subjects].join(' ').toLowerCase().includes(search);
    }).sort((a, b) =>
      normalizePortal(a.portalNumber).localeCompare(normalizePortal(b.portalNumber), undefined, { numeric: true }));
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const pageNo = Math.min(page, pages);
    const start = (pageNo - 1) * limit;
    rows = rows.slice(start, start + limit).map(t => {
      const out = publicTeacher(t);
      out.subjects = assignedSubjects(t).map(s => ({ id: s.id, name: s.name, code: s.code, className: s.className }));
      return out;
    });
    return sendJSON(res, 200, { ok: true, rows, total, page: pageNo, pages, limit, start, end: start + rows.length }), true;
  }

  if (method === 'POST' && pathname === '/api/admin/teachers') {
    const body = await readBody(req);
    const checked = validateTeacherPayload(body, null);
    if (checked.errors.length) {
      return sendJSON(res, 422, { ok: false, message: checked.errors[0], errors: checked.errors }), true;
    }
    if (!checked.teacher.portalNumber) checked.teacher.portalNumber = nextPortalNumber();
    const clash = uniqueTeacherFields(checked.teacher, null);
    if (clash) return sendJSON(res, 409, { ok: false, message: clash }), true;
    const password = String(body.password || '') || makePassword();
    const problem = passwordProblem(password);
    if (problem) return sendJSON(res, 400, { ok: false, message: problem }), true;
    const hashed = hashPassword(password);
    const now = new Date().toISOString();
    const teacher = Object.assign({}, checked.teacher, {
      id: 'tch_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
      role: 'teacher',
      passwordSalt: hashed.salt,
      passwordHash: hashed.hash,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: '',
      lastLoginAt: '',
      resetRequestedAt: null
    });
    if (!teacher.teacherProfileId) teacher.teacherProfileId = teacher.id;
    authStore.teachers.push(teacher);
    const n = parseInt(String(teacher.portalNumber).replace(/\D/g, ''), 10) || 0;
    if (n >= Number(authStore.nextPortal || 1)) authStore.nextPortal = n + 1;
    saveAuthStore();
    auditLog('admin:' + authed.email, 'teacher.create', teacher.id,
      teacher.portalNumber + ' / ' + teacher.fullName);
    return sendJSON(res, 201, {
      ok: true,
      teacher: publicTeacher(teacher),
      temporaryPassword: password,
      activationNote: 'Give this temporary password to the teacher. They must change it at first sign-in.'
    }), true;
  }

  const teacherMatch = /^\/api\/admin\/teachers\/([^/]+)$/.exec(pathname);
  if (teacherMatch && (method === 'GET' || method === 'PUT')) {
    const teacher = teacherById(decodeURIComponent(teacherMatch[1]));
    if (!teacher) return sendJSON(res, 404, { ok: false, message: 'Teacher account not found.' }), true;
    if (method === 'GET') {
      return sendJSON(res, 200, {
        ok: true, teacher: publicTeacher(teacher), meta: teacherMeta(teacher),
        audit: authStore.audit.filter(a => a.target === teacher.id).slice(0, 30)
      }), true;
    }
    const body = await readBody(req);
    const checked = validateTeacherPayload(body, teacher);
    if (checked.errors.length) {
      return sendJSON(res, 422, { ok: false, message: checked.errors[0], errors: checked.errors }), true;
    }
    const previousPortal = normalizePortal(teacher.portalNumber);
    const nextPortal = normalizePortal(checked.teacher.portalNumber || teacher.portalNumber);
    if (!nextPortal) {
      return sendJSON(res, 400, { ok: false, message: 'Portal number is required.' }), true;
    }
    if (nextPortal !== previousPortal) {
      return sendJSON(res, 400, {
        ok: false,
        message: 'Use the portal number action with an audit reason to change a portal number.'
      }), true;
    }
    checked.teacher.portalNumber = nextPortal;
    const clash = uniqueTeacherFields(checked.teacher, teacher.id);
    if (clash) return sendJSON(res, 409, { ok: false, message: clash }), true;
    const previousStatus = teacher.status;
    Object.keys(checked.teacher).forEach(k => { teacher[k] = checked.teacher[k]; });
    teacher.updatedAt = new Date().toISOString();
    const n = parseInt(nextPortal.replace(/\D/g, ''), 10) || 0;
    if (n >= Number(authStore.nextPortal || 1)) authStore.nextPortal = n + 1;
    if (teacher.status !== 'active') revokeTeacherTokens(teacher.id);
    saveAuthStore();
    auditLog('admin:' + authed.email, 'teacher.update', teacher.id,
      teacher.portalNumber + ' / ' + teacher.fullName);
    if (previousPortal !== nextPortal) {
      auditLog('admin:' + authed.email, 'teacher.portal.change', teacher.id,
        previousPortal + ' -> ' + nextPortal);
    }
    if (previousStatus !== teacher.status) {
      auditLog('admin:' + authed.email, 'teacher.status', teacher.id, previousStatus + ' -> ' + teacher.status);
    }
    return sendJSON(res, 200, { ok: true, teacher: publicTeacher(teacher), meta: teacherMeta(teacher) }), true;
  }

  const portalMatch = /^\/api\/admin\/teachers\/([^/]+)\/portal-number$/.exec(pathname);
  if (portalMatch && method === 'PUT') {
    const teacher = teacherById(decodeURIComponent(portalMatch[1]));
    if (!teacher) return sendJSON(res, 404, { ok: false, message: 'Teacher account not found.' }), true;
    const body = await readBody(req);
    const next = normalizePortal(body.portalNumber);
    const reason = cleanString(body.reason, 300);
    if (!/^TCH-\d{4,}$/.test(next)) {
      return sendJSON(res, 400, { ok: false, message: 'Portal number must look like TCH-0001.' }), true;
    }
    if (!reason) return sendJSON(res, 400, { ok: false, message: 'A reason is required for an audit trail.' }), true;
    const clash = uniqueTeacherFields({ portalNumber: next }, teacher.id);
    if (clash) return sendJSON(res, 409, { ok: false, message: clash }), true;
    const old = normalizePortal(teacher.portalNumber);
    teacher.portalNumber = next;
    teacher.updatedAt = new Date().toISOString();
    const n = parseInt(next.replace(/\D/g, ''), 10) || 0;
    if (n >= Number(authStore.nextPortal || 1)) authStore.nextPortal = n + 1;
    saveAuthStore();
    auditLog('admin:' + authed.email, 'teacher.portal.change', teacher.id,
      old + ' -> ' + next + ' / ' + reason);
    return sendJSON(res, 200, { ok: true, teacher: publicTeacher(teacher) }), true;
  }

  const resetMatch = /^\/api\/admin\/teachers\/([^/]+)\/reset-password$/.exec(pathname);
  if (resetMatch && method === 'POST') {
    const teacher = teacherById(decodeURIComponent(resetMatch[1]));
    if (!teacher) return sendJSON(res, 404, { ok: false, message: 'Teacher account not found.' }), true;
    const body = await readBody(req);
    const methodName = String(body.method || 'temporary');
    if (methodName === 'email') {
      return sendJSON(res, 501, {
        ok: false,
        message: 'Email delivery is not configured. Generate a one-time temporary password instead.'
      }), true;
    }
    if (methodName !== 'temporary') {
      return sendJSON(res, 400, { ok: false, message: 'Unsupported reset method.' }), true;
    }
    const temp = makePassword();
    const hashed = hashPassword(temp);
    teacher.passwordSalt = hashed.salt;
    teacher.passwordHash = hashed.hash;
    teacher.mustChangePassword = true;
    teacher.resetRequestedAt = null;
    teacher.passwordChangedAt = new Date().toISOString();
    teacher.updatedAt = new Date().toISOString();
    saveAuthStore();
    revokeTeacherTokens(teacher.id);
    auditLog('admin:' + authed.email, 'teacher.password.reset', teacher.id,
      teacher.portalNumber + ' / one-time temporary password generated');
    return sendJSON(res, 200, {
      ok: true,
      temporaryPassword: temp,
      teacher: publicTeacher(teacher),
      message: 'The teacher must change this password at their next sign-in.'
    }), true;
  }

  const teacherAuditMatch = /^\/api\/admin\/teachers\/([^/]+)\/audit$/.exec(pathname);
  if (teacherAuditMatch && method === 'GET') {
    const teacher = teacherById(decodeURIComponent(teacherAuditMatch[1]));
    if (!teacher) return sendJSON(res, 404, { ok: false, message: 'Teacher account not found.' }), true;
    return sendJSON(res, 200, {
      ok: true,
      rows: authStore.audit.filter(a =>
        a.target === teacher.id || a.actor === 'teacher:' + teacher.portalNumber
      ).slice(0, 200)
    }), true;
  }

  if (method === 'GET' && pathname === '/api/admin/audit') {
    const limit = Math.min(500, Math.max(1, Number(queryOf(req).get('limit')) || 100));
    return sendJSON(res, 200, { ok: true, rows: authStore.audit.slice(0, limit) }), true;
  }

  if (method === 'POST' && pathname === '/api/admin/audit/event') {
    const body = await readBody(req);
    const action = cleanString(body.action, 80);
    const details = cleanString(body.details, 500);
    if (!action) return sendJSON(res, 400, { ok: false, message: 'Audit action is required.' }), true;
    auditLog('admin:' + authed.email, action, cleanString(body.target, 120), details);
    return sendJSON(res, 200, { ok: true }), true;
  }

  if (method === 'GET' && pathname === '/api/admin/attendance/submissions') {
    const limit = Math.min(200, Math.max(1, Number(queryOf(req).get('limit')) || 50));
    const rows = (stateValue('mca_attendance', []) || []).filter(r => r && r.source === 'teacher')
      .sort((a, b) => String(b.date + ' ' + b.submittedAt).localeCompare(String(a.date + ' ' + a.submittedAt)))
      .slice(0, limit)
      .map(r => ({
        id: r.id, date: r.date, className: r.className, section: r.section || '',
        subject: r.subject || '', submittedAt: r.submittedAt || '',
        submittedBy: r.submittedBy || '', portalNumber: r.submittedByPortalNumber || '',
        teacherId: r.submittedByTeacherId || '', action: r.action || 'submitted',
        present: (r.entries || []).filter(e => e.status === 'present').length,
        absent: (r.entries || []).filter(e => e.status === 'absent').length,
        leave: (r.entries || []).filter(e => e.status === 'leave').length,
        total: (r.entries || []).length
      }));
    return sendJSON(res, 200, { ok: true, rows }), true;
  }

  return sendJSON(res, 404, { ok: false, message: 'Unknown admin API route.' }), true;
}

async function handleAPI(req, res, pathname) {
  const method = req.method;

  /* POST /api/auth/login */
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    if (loginBlocked(req, email)) {
      return sendJSON(res, 429, { ok: false, message: 'Too many failed attempts. Try again in 15 minutes.' });
    }
    if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) {
      loginFailed(req, email);
      auditLog('admin:' + email, 'login.failed', 'admin', 'Invalid administrator credentials.');
      return sendJSON(res, 401, {
        ok: false,
        message: 'Invalid email or password. Use the demo credentials shown on the login page.'
      });
    }
    loginSucceeded(req, email);
    auditLog('admin:' + email, 'login', 'admin', 'Administrator signed in.');
    const token = issueToken(DEMO_EMAIL);
    return sendJSON(res, 200, {
      ok: true,
      token,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      user: { email: DEMO_EMAIL, name: 'Administrator', role: 'admin' }
    });
  }

  /* POST /api/auth/logout */
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const authed = validToken(req);
    if (authed) tokens.delete(authed.token);
    return sendJSON(res, 200, { ok: true });
  }

  /* GET /api/health */
  if (method === 'GET' && pathname === '/api/health') {
    return sendJSON(res, 200, {
      ok: true,
      service: 'muslim-commerce-attendance',
      time: new Date().toISOString(),
      hasData: hasAnyData(),
      supabase: SUPABASE_ON
    });
  }

  /* GET /api/state — hydrate the client before login (demo-grade, open read) */
  /* Teacher portal and Super Admin teacher-account APIs. */
  if (await handleTeacherAPI(req, res, pathname, method)) return;
  if (await handleTeacherAdminAPI(req, res, pathname, method)) return;

  if (method === 'GET' && pathname === '/api/state') {
    if (!validAdmin(req)) {
      return sendJSON(res, 401, { ok: false, message: 'Sign in to read saved data.' });
    }
    const keys = {};
    const meta = {};
    for (const k of STATE_KEYS) {
      if (store.keys[k]) {
        keys[k] = store.keys[k].value;
        meta[k] = {
          updatedAt: store.keys[k].updatedAt,
          updatedBy: store.keys[k].updatedBy,
          version: Number(store.keys[k].version) || 1
        };
      }
    }
    return sendJSON(res, 200, { ok: true, keys, meta });
  }

  /* PUT /api/state — atomic batch write. The client flushes every pending key
     in ONE request so a multi-key save shares a single versioned write. */
  if (method === 'PUT' && pathname === '/api/state') {
    const body = await readBody(req);
    const incoming = body && body.keys;
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return sendJSON(res, 400, { ok: false, message: 'Expected { "keys": { ... } } in request body.' });
    }
    const disallowed = Object.keys(incoming).filter(k => STATE_KEYS.indexOf(k) === -1);
    if (disallowed.length) {
      return sendJSON(res, 403, { ok: false, message: 'Key not allowed: ' + disallowed[0] });
    }

    const authed = validAdmin(req);
    if (!authed) {
      return sendJSON(res, 401, { ok: false, message: 'Sign in to save data on the server.' });
    }

    const by = authed.email;
    const meta = {};
    Object.keys(incoming).forEach(k => {
      meta[k] = setKeyValue(k, incoming[k], by);
    });
    return sendJSON(res, 200, {
      ok: true,
      keys: Object.keys(incoming),
      updatedAt: new Date().toISOString(),
      meta: Object.keys(incoming).reduce((acc, k) => {
        acc[k] = { version: meta[k].version, updatedAt: meta[k].updatedAt };
        return acc;
      }, {})
    });
  }

  /* PUT /api/state/:key — token required once the database has data */
  const putMatch = /^\/api\/state\/([A-Za-z0-9_]+)$/.exec(pathname);
  if (method === 'PUT' && putMatch) {
    const key = putMatch[1];
    if (STATE_KEYS.indexOf(key) === -1) {
      return sendJSON(res, 403, { ok: false, message: 'Key not allowed: ' + key });
    }

    const authed = validAdmin(req);
    if (!authed) {
      return sendJSON(res, 401, { ok: false, message: 'Sign in to save data on the server.' });
    }

    const body = await readBody(req);
    if (body.value === undefined) {
      return sendJSON(res, 400, { ok: false, message: 'Missing "value" in request body.' });
    }

    const entry = setKeyValue(key, body.value, authed.email);
    return sendJSON(res, 200, {
      ok: true,
      key,
      updatedAt: entry.updatedAt,
      version: entry.version
    });
  }

  /* POST /api/reset — wipe the server database (auth required) */
  if (method === 'POST' && pathname === '/api/reset') {
    if (!validAdmin(req)) {
      return sendJSON(res, 401, { ok: false, message: 'Sign in required to reset data.' });
    }
    store.keys = {};
    try {
      if (fs.existsSync(STATE_DIR)) {
        fs.readdirSync(STATE_DIR).forEach(f => {
          if (f.endsWith('.json')) fs.unlinkSync(path.join(STATE_DIR, f));
        });
      }
    } catch (err) {
      console.error('[server] could not clear data/state:', err.message);
    }
    pendingWrites.clear();
    await saveStore();
    return sendJSON(res, 200, { ok: true, message: 'Server database cleared.' });
  }

  /* Student register API (paginated reads, single-record writes, deltas). */
  if (await handleStudentsAPI(req, res, pathname, method)) return;

  /* Supabase-backed permanent attendance storage (see supabase/schema.sql). */
  if (await handleSupabaseAPI(req, res, pathname, method)) return;

  return sendJSON(res, 404, { ok: false, message: 'Unknown API route: ' + method + ' ' + pathname });
}

/* --------------------------------------------------------------------------
   Static files
   -------------------------------------------------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const DENY = [
  /^\/data(\/|$)/i,
  /^\/server\.js$/i,
  /^\/package(-lock)?\.json$/i,
  /^\/node_modules(\/|$)/i,
  /(^|\/)\./,          /* dotfiles, .env, .git */
  /^\/api(\/|$)/i      /* never serve /api from the static handler */
];

const PAGE_ALIASES = {
  '/administration': '/admin.html',
  '/super-admin': '/admin.html',
  '/admin': '/admin.html'
};

function sendNotFound(req, res) {
  const wantsHtml = /text\/html/i.test(String(req.headers.accept || ''));
  const page = path.join(ROOT, '404.html');
  if (wantsHtml && fs.existsSync(page)) {
    let stat;
    try { stat = fs.statSync(page); } catch (err) { stat = null; }
    if (stat && stat.isFile()) {
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': stat.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(page).pipe(res);
    }
  }
  return sendJSON(res, 404, { ok: false, message: 'Not found' });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { ok: false, message: 'Method not allowed' });
  }

  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (err) {
    return sendJSON(res, 400, { ok: false, message: 'Bad path encoding' });
  }
  if (rel === '/') rel = '/index.html';

  if (DENY.some(re => re.test(rel))) {
    return sendJSON(res, 404, { ok: false, message: 'Not found' });
  }

  if (rel !== '/' && !path.extname(rel)) {
    const clean = rel.replace(/\/+$/, '') || '/';
    const alias = PAGE_ALIASES[clean.toLowerCase()] || (clean + '.html');
    const aliasPath = path.normalize(path.join(ROOT, alias));
    let aliasStat = null;
    try { aliasStat = fs.statSync(aliasPath); } catch (err) { /* not a page */ }
    if (aliasPath.startsWith(ROOT + path.sep) && aliasStat && aliasStat.isFile()) {
      const q = req.url.indexOf('?');
      const search = q >= 0 ? req.url.slice(q) : '';
      res.writeHead(302, { Location: alias + search, 'Cache-Control': 'no-store' });
      return res.end();
    }
  }

  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT + path.sep)) {          /* path traversal guard */
    return sendJSON(res, 403, { ok: false, message: 'Forbidden' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return sendNotFound(req, res);

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return sendNotFound(req, res);
  }
  if (!stat.isFile()) return sendNotFound(req, res);

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cache-Control': 'no-cache'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

/* --------------------------------------------------------------------------
   Server
   -------------------------------------------------------------------------- */

loadStore();
loadAuthStore();

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname;
  try {
    pathname = new URL(req.url, 'http://' + (req.headers.host || 'localhost')).pathname;
  } catch (err) {
    return sendJSON(res, 400, { ok: false, message: 'Bad request URL' });
  }

  try {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      await handleAPI(req, res, pathname);
    } else {
      serveStatic(req, res, pathname);
    }
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[server] error on', req.method, pathname, err);
    if (!res.headersSent) sendJSON(res, status, { ok: false, message: err.message || 'Server error' });
    else res.end();
  } finally {
    console.log(req.method, pathname, res.statusCode, (Date.now() - started) + 'ms');
  }
});

server.listen(PORT, HOST, () => {
  console.log('==========================================================');
  console.log('  Muslim Commerce College — Attendance System (backend)');
  console.log('  Open   http://localhost:' + PORT);
  console.log('  API    http://localhost:' + PORT + '/api/health');
  console.log('  Data   ' + STATE_DIR);
  console.log('  DB     ' + (SUPABASE_ON ? ('Supabase ' + SUPABASE_URL) : 'local only (Supabase not configured)'));
  console.log('  Stop   Ctrl+C');
  console.log('==========================================================');
});

process.on('SIGINT', () => {
  console.log('\n[server] shutting down');
  saveStore().finally(() => process.exit(0));
});
