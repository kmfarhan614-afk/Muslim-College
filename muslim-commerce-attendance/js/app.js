/* ==========================================================================
   Muslim Commerce College Peshawar — Attendance Management System
   app.js — core layer
   --------------------------------------------------------------------------
   Modules (kept separate so localStorage can later be swapped for Supabase):
     1.  Utils
     2.  Store           (localStorage wrapper)
     3.  Seed            (demo dataset)
     4.  db              (data access — replace bodies with Supabase queries)
     5.  auth            (demo auth — replace with Supabase Auth)
     6.  UI              (toast, modal, confirm, dropdown, theme, CSV)
     7.  Chrome          (sidebar + topbar rendering)
     8.  Init / guards
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. Utils
   ========================================================================== */
const Utils = {
  uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  pad(n) { return String(n).padStart(2, '0'); },

  toISO(d) {
    return d.getFullYear() + '-' + Utils.pad(d.getMonth() + 1) + '-' + Utils.pad(d.getDate());
  },

  todayISO() { return Utils.toISO(new Date()); },

  /** Calendar date (YYYY-MM-DD) in Pakistan Standard Time (Asia/Karachi,
      UTC+5, no DST). Use this — not the device clock — for attendance dates. */
  pkParts(date) {
    const d = date || new Date();
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(d);
    } catch (err) {
      return Utils.toISO(d);
    }
  },

  pkToday() { return Utils.pkParts(new Date()); },

  /** 24h HH:MM in Pakistan Standard Time. */
  pkClock(date) {
    const d = date || new Date();
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false
      }).format(d);
    } catch (err) {
      return Utils.pad(d.getHours()) + ':' + Utils.pad(d.getMinutes());
    }
  },

  /** 07 October 2026 */
  fmtDate(iso) {
    if (!iso) return '—';
    const parts = iso.split('-');
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d)) return iso;
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return Utils.pad(d.getDate()) + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  },

  /** 07 Oct 2026 */
  fmtDateShort(iso) {
    if (!iso) return '—';
    const parts = iso.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return parts[2] + ' ' + months[Number(parts[1]) - 1] + ' ' + parts[0];
  },

  /** Wednesday, 08 October 2026 */
  fmtDateLong(date) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return days[date.getDay()] + ', ' + Utils.pad(date.getDate()) + ' ' +
      months[date.getMonth()] + ' ' + date.getFullYear();
  },

  /** 14:05 -> 02:05 PM */
  fmtTime(hhmm) {
    if (!hhmm) return '—';
    const bits = hhmm.split(':');
    let h = Number(bits[0]);
    const m = bits[1] || '00';
    const suffix = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return Utils.pad(h) + ':' + m + ' ' + suffix;
  },

  fmtNumber(n) {
    return Number(n || 0).toLocaleString('en-US');
  },

  pct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 1000) / 10;
  },

  initials(name) {
    const words = String(name || '?').trim().split(/\s+/);
    const first = words[0] ? words[0][0] : '?';
    const last = words.length > 1 ? words[words.length - 1][0] : '';
    return (first + last).toUpperCase();
  },

  /** Best-effort academic year for legacy class records that predate the
      year/group fields (e.g. "D.Com 1st Year" -> "1st Year"). */
  inferYear(name) {
    const n = String(name || '');
    if (/\b1st\b|\bfirst\b/i.test(n)) return '1st Year';
    if (/\b2nd\b|\bsecond\b/i.test(n)) return '2nd Year';
    if (/\b3rd\b|\bthird\b/i.test(n)) return '3rd Year';
    if (/\b4th\b|\bfourth\b/i.test(n)) return '4th Year';
    return '';
  },

  /** Best-effort study group for legacy class records. */
  inferGroup(name) {
    const n = String(name || '').toLowerCase();
    if (n.indexOf('medical') > -1) return 'Pre-Medical';
    if (/(computer|\bit\b|\bcit\b|technology|software|programm)/.test(n)) return 'Computer Science';
    return 'Commerce';
  },

  /** "Section A" / "No section" — used anywhere a section is displayed. */
  sectionLabel(section) {
    return section ? 'Section ' + section : 'No section';
  },

  /** Cell content for a (possibly empty) section value. */
  sectionCell(section) {
    return section
      ? '<span class="badge badge-blue">' + Utils.esc(section) + '</span>'
      : '<span class="badge badge-gray" title="This class has no sections">—</span>';
  },

  debounce(fn, wait) {
    let t;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait || 200);
    };
  },

  /** Deterministic PRNG so demo data is identical on every machine */
  mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  shuffle(list, rand) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
};

/* ==========================================================================
   2. Store — localStorage wrapper (single place to swap for an API)
   ========================================================================== */
const KEYS = {
  students: 'mca_students',
  classes: 'mca_classes',
  teachers: 'mca_teachers',
  attendance: 'mca_attendance',
  settings: 'mca_settings',
  sessions: 'mca_sessions',
  sessionLocal: 'mca_session',
  sessionTemp: 'mca_session_temp',
  seeded: 'mca_seeded_version',
  /* Local-only: core classes the administrator deleted on purpose.
     Keeps ensureCoreClasses() from resurrecting them on the next load. */
  removedCore: 'mca_removed_core_classes',
  /* Local-only: marker for the one-time COM SCI-I (2026) roster import.
     Never synced to the server — it only keeps the import idempotent and
     preserves an administrator's later edits/deletions. */
  csImport: 'mca_cs_import'
};

const SEED_VERSION = 3;

/* One-time official roster import (1st Year Computer Science, session
   2026-2027). The data itself lives in js/students-import.js and is loaded
   only on authenticated pages, so student contact details are never served
   on the public sign-in page. Bump the version to re-import after an edit. */
const CS_IMPORT_VERSION = 1;
const CS_IMPORT_CLASS = '1st Year Computer Science';
const CS_IMPORT_SESSION = '2026-2027';

/* Single source of truth for the prototype demo account (NOT secure
   credentials — demo authentication only, see the auth section below). */
const DEMO_CREDENTIALS = Object.freeze({
  email: 'admin@college.com',
  password: 'admin123'
});

/* localStorage is read on EVERY db call, so parsing the same 5 MB student
   register again and again is what makes a large register slow. The cache
   keeps the parsed value in memory and re-parses only when the underlying
   string actually changed (another tab, or a server hydration). */
const Store = {
  /* key -> { raw: string, value: parsed } */
  _cache: new Map(),

  /* Set by the last failed write so the UI can warn instead of silently
     losing a record. */
  lastError: null,

  read(key, fallback) {
    let raw;
    try {
      raw = localStorage.getItem(key);
    } catch (err) {
      console.warn('Store.read failed for', key, err);
      return fallback;
    }
    if (raw === null || raw === undefined) {
      Store._cache.delete(key);
      return fallback;
    }
    const hit = Store._cache.get(key);
    if (hit && hit.raw === raw) return hit.value;
    let value = fallback;
    try {
      value = JSON.parse(raw);
    } catch (err) {
      console.warn('Store.read: stored value for "' + key + '" is not valid JSON — using the fallback.', err);
      value = fallback;
    }
    Store._cache.set(key, { raw: raw, value: value });
    return value;
  },

  write(key, value) {
    let raw;
    try {
      raw = JSON.stringify(value);
    } catch (err) {
      console.error('Store.write could not serialise', key, err);
      Store.lastError = { key: key, quota: false, error: err };
      return false;
    }
    try {
      localStorage.setItem(key, raw);
    } catch (err) {
      /* Quota exceeded (or storage blocked). The value stays in the cache so
         the running session keeps working, but it is NOT on disk — the caller
         must be told, otherwise records are silently lost. */
      console.error('Store.write failed for', key, err);
      Store._cache.set(key, { raw: raw, value: value });
      Store.lastError = { key: key, quota: Store.isQuotaError(err), error: err };
      return false;
    }
    Store._cache.set(key, { raw: raw, value: value });
    Store.lastError = null;
    /* Write-through sync: no-op unless the backend is reachable and the
       key is allowlisted (see js/api.js). */
    if (window.MCA_API) window.MCA_API.push(key, value);
    return true;
  },

  remove(key) {
    Store._cache.delete(key);
    try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
  },

  /* Drops the cached parse so the next read re-reads from storage. */
  invalidate(key) {
    if (key) Store._cache.delete(key);
    else Store._cache.clear();
  },

  isQuotaError(err) {
    if (!err) return false;
    return err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22 || err.code === 1014;
  },

  /* Browser storage budget for this origin (localStorage is ~5 MB in
     Chrome/Edge/Firefox). */
  quotaBytes() { return 5 * 1024 * 1024; },

  /* Bytes currently used by this origin, per key. */
  usage() {
    const perKey = {};
    let total = 0;
    let count = 0;
    try {
      count = localStorage.length;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k === null) continue;
        const raw = localStorage.getItem(k) || '';
        const bytes = (k.length + raw.length) * 2; /* UTF-16 code units */
        perKey[k] = bytes;
        total += bytes;
      }
    } catch (err) { /* storage unavailable */ }
    return { total: total, perKey: perKey, count: count, quota: Store.quotaBytes() };
  }
};

/* ==========================================================================
   3. Seed — demo dataset (students, classes, teachers, attendance, settings)
   ========================================================================== */

/* The four section-less academic classes. They use stable ids so records
   survive reloads, migrations and server hydration. `sections: {}` (empty)
   is what marks a class as section-less — students sit directly under the
   class and no section has to be picked anywhere. */
const CORE_CLASS_DEFS = [
  {
    id: 'first-year-medical',
    name: '1st Year Medical',
    code: '1YM',
    year: '1st Year',
    group: 'Pre-Medical',
    sections: {},
    count: 46,
    subjects: ['Biology', 'Chemistry', 'Physics', 'English', 'Urdu', 'Islamic Studies'],
    teacher: 'Dr. Saima Gul',
    status: 'active'
  },
  {
    id: 'first-year-computer-science',
    name: '1st Year Computer Science',
    code: '1YCS',
    year: '1st Year',
    group: 'Computer Science',
    sections: {},
    count: 44,
    subjects: ['Computer Science', 'Mathematics', 'Physics', 'English', 'Urdu', 'Islamic Studies'],
    teacher: 'Aamir Raza',
    status: 'active'
  },
  {
    id: 'second-year-medical',
    name: '2nd Year Medical',
    code: '2YM',
    year: '2nd Year',
    group: 'Pre-Medical',
    sections: {},
    count: 44,
    subjects: ['Biology', 'Chemistry', 'Physics', 'English', 'Pak Studies', 'Islamic Studies'],
    teacher: 'Dr. Saima Gul',
    status: 'active'
  },
  {
    id: 'second-year-computer-science',
    name: '2nd Year Computer Science',
    code: '2YCS',
    year: '2nd Year',
    group: 'Computer Science',
    sections: {},
    count: 42,
    subjects: ['Computer Science', 'Mathematics', 'Statistics', 'English', 'Pak Studies', 'Islamic Studies'],
    teacher: 'Aamir Raza',
    status: 'active'
  }
];

/* NOTE: the 12 former demo classes (D.Com, B.Com, I.Com, BS, CIT, ADP,
   M.Com, BBA …) were removed. The register now starts with only the four
   section-less academic classes above and an EMPTY student list, ready for
   real student registration. Do not re-add sample classes here. */

/** Academic year + date bounds containing a given day (Aug–Jul cycle). */
function academicSessionFor(date) {
  const d = date || new Date();
  const startYear = (d.getMonth() + 1) >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return {
    name: startYear + '-' + (startYear + 1),
    start: startYear + '-08-01',
    end: (startYear + 1) + '-06-30'
  };
}

function academicYearNameFor(date) { return academicSessionFor(date).name; }

/** Distinct academic years / study groups offered (used by filters + forms). */
const ACADEMIC_YEARS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const STUDY_GROUPS = ['Pre-Medical', 'Computer Science', 'Commerce', 'General'];

const Seed = {
  needed() {
    return Store.read(KEYS.seeded, 0) !== SEED_VERSION;
  },

  /* Clean seed: the four academic classes + an EMPTY student and attendance
     register. No sample students are ever generated again. */
  buildAll() {
    const classes = Seed.buildClasses();
    const teachers = Seed.buildTeachers(classes);
    const settings = Seed.buildSettings();

    Store.write(KEYS.classes, classes);
    Store.write(KEYS.students, []);
    Store.write(KEYS.teachers, teachers);
    Store.write(KEYS.attendance, []);
    Store.write(KEYS.settings, settings);
    Store.write(KEYS.sessions, Seed.buildSessions());
    Store.write(KEYS.seeded, SEED_VERSION);
  },

  buildClasses() {
    return CORE_CLASS_DEFS.map(def => Seed.classRecord(def));
  },

  /** Normalise a class definition into the stored class shape. */
  classRecord(def) {
    return {
      id: def.id || ('cls_' + def.code.toLowerCase()),
      name: def.name,
      code: def.code,
      year: def.year !== undefined ? def.year : Utils.inferYear(def.name),
      group: def.group !== undefined ? def.group : Utils.inferGroup(def.name),
      sections: Object.keys(def.sections || {}),
      subjects: (def.subjects || []).slice(),
      teacher: def.teacher || '',
      status: def.status || 'active'
    };
  },

  /* Teachers for the four academic classes. (Only the teachers that map to
     the remaining classes are seeded; no other demo staff.) */
  buildTeachers(classes) {
    const seeds = [
      ['Dr. Saima Gul', 'Pre-Medical', ['1st Year Medical', '2nd Year Medical']],
      ['Aamir Raza', 'Computer Science', ['1st Year Computer Science', '2nd Year Computer Science']]
    ];
    return seeds.map((row, i) => {
      const idNum = String(i + 1).padStart(3, '0');
      const slug = row[0].toLowerCase().replace(/[^a-z ]/g, '').replace(/ +/g, '.');
      return {
        id: 'tch_' + idNum,
        teacherId: 'TCH-' + idNum,
        name: row[0],
        subject: row[1],
        email: slug + '@college.com',
        phone: '03' + (11 + (i % 8)) + String(1000000 + i * 4567).slice(0, 7),
        classes: row[2],
        status: 'active'
      };
    });
  },

  buildSettings() {
    return {
      college: {
        name: 'Muslim Commerce College Peshawar',
        address: 'University Road, Peshawar, Khyber Pakhtunkhwa',
        phone: '+92 91 1234567',
        email: 'info@muslimcommerce.edu.pk',
        website: 'www.muslimcommerce.edu.pk'
      },
      appearance: {
        theme: 'light',
        primary: '#1c3d5f'
      },
      attendance: {
        threshold: 75,
        latePolicy: '15',
        defaultStatus: 'present'
      },
      academicSession: academicYearNameFor(new Date()),
      demo: {
        email: DEMO_CREDENTIALS.email,
        password: DEMO_CREDENTIALS.password
      },
      /* No demo trend — the dashboard derives this from real attendance. */
      weeklyTrend: []
    };
  },

  /* Two starter academic sessions: the current one (active) and the previous
     one. Dates follow the Aug–Jul academic cycle so the demo always has a
     session covering "today". */
  buildSessions() {
    const cur = academicSessionFor(new Date());
    const startYear = Number(cur.name.slice(0, 4));
    return [
      {
        id: 'sess_' + (startYear - 1) + '_' + startYear,
        name: (startYear - 1) + '-' + startYear,
        start: (startYear - 1) + '-08-01',
        end: startYear + '-06-30',
        active: false
      },
      {
        id: 'sess_' + startYear + '_' + (startYear + 1),
        name: cur.name,
        start: cur.start,
        end: cur.end,
        active: true
      }
    ];
  },

  /* Idempotent: guarantees the current academic session exists and that
     exactly one session is active. Never removes historical sessions. */
  ensureSessions() {
    const list = Store.read(KEYS.sessions, []);
    if (!Array.isArray(list)) { Store.write(KEYS.sessions, Seed.buildSessions()); return true; }
    let changed = false;

    Seed.buildSessions().forEach(w => {
      if (!list.some(s => s.name === w.name)) { list.push(w); changed = true; }
    });

    const activeList = list.filter(s => s.active);
    if (activeList.length !== 1) {
      const currentName = academicYearNameFor(new Date());
      list.forEach(s => { s.active = (s.name === currentName); });
      if (!list.some(s => s.active) && list.length) list[0].active = true;
      changed = true;
    }

    if (changed) Store.write(KEYS.sessions, list);
    return changed;
  },

  ensure() {
    if (Seed.needed()) Seed.buildAll();
    /* Runs on every load (after any server hydration) so the four academic
       classes are repaired if they are missing. It only ever ADDS class
       records or backfills metadata — students and attendance are never
       rewritten, and duplicates are impossible (matched by id or name). */
    Seed.ensureCoreClasses();
    Seed.ensureSessions();
    Seed.ensureCsImport();
    Seed.ensureRollNumbers();
  },

  /**
   * Idempotent migration that guarantees the four section-less academic
   * classes exist and that every class carries year/group metadata.
   * Safe to call repeatedly; deliberately deleted core classes are skipped.
   */
  ensureCoreClasses() {
    const list = db.classes.all();
    const removed = Store.read(KEYS.removedCore, []);
    let changed = false;

    CORE_CLASS_DEFS.forEach(def => {
      if (removed.indexOf(def.name) > -1) return;
      const idx = list.findIndex(c =>
        c.id === def.id || String(c.name).toLowerCase() === def.name.toLowerCase());
      if (idx === -1) {
        list.push(Seed.classRecord(def));
        changed = true;
        return;
      }
      /* Re-point an existing same-named class at the stable id. */
      const cls = list[idx];
      if (cls.id !== def.id && !list.some(c => c.id === def.id)) {
        cls.id = def.id;
        changed = true;
      }
    });

    list.forEach(c => {
      if (c.year === undefined) { c.year = Utils.inferYear(c.name); changed = true; }
      if (c.group === undefined) { c.group = Utils.inferGroup(c.name); changed = true; }
      if (!Array.isArray(c.sections)) { c.sections = []; changed = true; }
      if (!Array.isArray(c.subjects)) { c.subjects = []; changed = true; }
      if (c.status === undefined) { c.status = 'active'; changed = true; }
    });

    if (changed) db.classes.saveList(list);
    return changed;
  },

  /* Normalise one roster definition (see js/students-import.js) into the
     stored student shape. Roll number and personal fields we were not given
     (dob, gender, CNIC, email) are intentionally left blank — never guessed. */
  csStudentRecord(def) {
    const studentId = String(def[0]);
    const flags = def[6] || '';
    const notes = [];
    if (flags.indexOf('verify:phoneRes') > -1) {
      notes.push('Residential phone printed as “' + def[3] + '” — verify against the physical register.');
    }
    if (flags.indexOf('verify:mobile') > -1) {
      notes.push('Mobile printed as “' + def[4] + '” — verify against the physical register.');
    }
    if (flags.indexOf('review:address') > -1) {
      notes.push('Permanent address is unclear or unreadable in the source photo — verify.');
    }
    return {
      id: 'stu_cs_' + studentId,
      studentId: studentId,
      rollNo: '',
      name: def[1],
      fatherName: def[2],
      dob: '',
      gender: '',
      class: CS_IMPORT_CLASS,
      section: '',
      phone: def[3],
      mobile: def[4],
      phoneRes: def[3],
      address: def[5],
      admissionDate: '',
      photo: '',
      status: 'active',
      session: CS_IMPORT_SESSION,
      importSource: 'COM_SCI_I_2026',
      needsReview: notes.length > 0,
      reviewNotes: notes
    };
  },

  /* Idempotent one-time import of the official COM SCI-I (2026) roster.
     - Reads the roster from window.MCA_CS_ROSTER (js/students-import.js).
     - Matches on the original Student ID.
     - Skips identical existing records, flags conflicting ones for review,
       and never overwrites a manually edited record.
     - Gated by a local marker so it runs once per browser and a later
       deletion is not silently undone. Safe to call on every page load. */
  ensureCsImport() {
    const roster = window.MCA_CS_ROSTER;
    if (!Array.isArray(roster) || !roster.length) {
      return { ran: false, added: 0, skipped: 0, conflicts: [] };
    }

    const marker = Store.read(KEYS.csImport, null);
    if (marker && marker.version === CS_IMPORT_VERSION) {
      return { ran: false, added: 0, skipped: roster.length, conflicts: marker.conflicts || [] };
    }

    const list = db.students.all();
    const index = {};
    list.forEach(s => { if (s && s.studentId != null) index[String(s.studentId)] = s; });

    const result = { ran: true, added: 0, skipped: 0, conflicts: [] };

    roster.forEach(def => {
      const rec = Seed.csStudentRecord(def);
      const existing = index[rec.studentId];
      if (!existing) {
        list.push(rec);
        index[rec.studentId] = rec;
        result.added++;
      } else if (String(existing.name) === rec.name &&
        String(existing.fatherName) === rec.fatherName &&
        String(existing.class) === rec.class) {
        result.skipped++;
      } else {
        result.conflicts.push(rec.studentId);
      }
    });

    if (result.added) db.students.saveList(list);

    Store.write(KEYS.csImport, {
      version: CS_IMPORT_VERSION,
      importedAt: new Date().toISOString(),
      added: result.added,
      skipped: result.skipped,
      conflicts: result.conflicts
    });

    if (result.conflicts.length) {
      console.warn('[MCA] roster import: ' + result.conflicts.length +
        ' record(s) share an existing Student ID with different details and were left untouched.');
    }
    return result;
  },

  /* Idempotent: backfill the current academic session on active students that
     carry none, then recompute every roll number from ascending Student ID.
     Run on every load so an existing register adopts the Student-ID rule. */
  ensureRollNumbers() {
    const active = db.sessions.active();
    const sessionName = active ? active.name : '';
    const list = db.students.all();
    let changed = false;
    list.forEach(s => {
      if (s && !s.deletedAt && !s.session && sessionName) { s.session = sessionName; changed = true; }
    });
    if (changed) db.students.saveList(list);
    db.students.resequenceAll();
    return changed;
  }
};

/* ==========================================================================
   4. db — data access layer
   Every method is synchronous today (localStorage). To move to Supabase,
   keep the same method names and replace the internals with
   `await supabase.from('students').select()...` (and make callers await).
   ========================================================================== */

/* ---------- Student index ----------
   The register is the largest collection in the app. Scanning it linearly on
   every keystroke, every re-render and every roll-number preview is what
   makes a 2 000+ student register feel slow. The index below is rebuilt
   once per change and gives O(1) lookups by id and by Student ID, a
   pre-lowercased search haystack, and per-scope rosters for roll numbers. */
const studentIndex = {
  dirty: true,
  source: null,
  version: 0,
  byId: new Map(),
  bySid: new Map(),
  bySidActive: new Map(),
  byScope: new Map(),
  haystack: new Map(),
  sortKey: new Map(),
  active: [],
  archived: [],
  orderActive: [],
  orderArchived: []
};

/* Display order of the register: class, then section, then Student ID
   (numeric, so 99 comes before 2413). The order is baked into a single
   comparable string per student so sorting thousands of records stays a
   plain string comparison instead of thousands of localeCompare calls. */
function buildSortKeys(source, idx) {
  const classSections = new Map();
  for (let i = 0; i < source.length; i++) {
    const s = source[i];
    if (!s) continue;
    const cls = String(s.class || '');
    let secs = classSections.get(cls);
    if (!secs) { secs = new Set(); classSections.set(cls, secs); }
    secs.add(String(s.section || ''));
  }

  const classRank = new Map();
  Array.from(classSections.keys())
    .sort((a, b) => a.localeCompare(b))
    .forEach((c, i) => classRank.set(c, i));

  const sectionRank = new Map();
  classSections.forEach((secs, cls) => {
    Array.from(secs)
      .sort((a, b) => a.localeCompare(b))
      .forEach((sec, i) => sectionRank.set(cls + '\u0000' + sec, i));
  });

  for (let i = 0; i < source.length; i++) {
    const s = source[i];
    if (!s || !s.id) continue;
    const cls = String(s.class || '');
    const sec = String(s.section || '');
    const raw = String(s.studentId == null ? '' : s.studentId).trim();
    const idPart = /^\d+$/.test(raw)
      ? '0' + raw.padStart(12, '0')
      : '1' + raw.toLowerCase();
    idx.sortKey.set(s.id,
      String(classRank.get(cls) || 0).padStart(4, '0') + '\u0000' +
      String(sectionRank.get(cls + '\u0000' + sec) || 0).padStart(4, '0') + '\u0000' +
      idPart + '\u0000' +
      String(s.name || '').toLowerCase());
  }
}

/* Pre-sorts active/archived rows once per rebuild so the default register
   query is a filter + slice instead of a 10 000-row sort on every render. */
function buildRegisterOrder(rows, idx) {
  return rows
    .map(s => [idx.sortKey.get(s.id) || '', s])
    .sort((a, b) => (a[0] === b[0] ? 0 : (a[0] < b[0] ? -1 : 1)))
    .map(pair => pair[1]);
}

/* Fields scanned by the register search. */
const STUDENT_SEARCH_FIELDS = [
  'name', 'studentId', 'rollNo', 'fatherName', 'phone', 'phoneRes', 'mobile',
  'address', 'class', 'section', 'session', 'email'
];

function rebuildStudentIndex(list) {
  const idx = studentIndex;
  idx.byId = new Map();
  idx.bySid = new Map();
  idx.bySidActive = new Map();
  idx.byScope = new Map();
  idx.haystack = new Map();
  idx.sortKey = new Map();
  idx.active = [];
  idx.archived = [];
  idx.orderActive = [];
  idx.orderArchived = [];

  const source = Array.isArray(list) ? list : [];
  source.forEach(s => {
    if (!s || !s.id) return;

    idx.byId.set(s.id, s);

    const sid = db.students.normaliseId(s.studentId);
    if (sid) {
      if (!idx.bySid.has(sid)) idx.bySid.set(sid, s);
      if (!s.deletedAt && !idx.bySidActive.has(sid)) idx.bySidActive.set(sid, s);
    }

    const parts = [];
    for (let i = 0; i < STUDENT_SEARCH_FIELDS.length; i++) {
      const v = s[STUDENT_SEARCH_FIELDS[i]];
      if (v !== undefined && v !== null && v !== '') parts.push(String(v));
    }
    idx.haystack.set(s.id, parts.join(' ').toLowerCase());

    if (s.deletedAt) {
      idx.archived.push(s);
    } else {
      idx.active.push(s);
      const key = db.students.scopeKey(s.class, s.section, s.session);
      let bucket = idx.byScope.get(key);
      if (!bucket) {
        bucket = { className: s.class, section: s.section, session: s.session, students: [] };
        idx.byScope.set(key, bucket);
      }
      bucket.students.push(s);
    }
  });

  idx.active.sort(db.students.idCompare);
  idx.archived.sort((a, b) => (String(b.deletedAt) < String(a.deletedAt) ? -1 : 1));
  idx.byScope.forEach(bucket => bucket.students.sort(db.students.idCompare));
  buildSortKeys(source, idx);
  idx.orderActive = buildRegisterOrder(idx.active, idx);
  idx.orderArchived = buildRegisterOrder(idx.archived, idx);

  idx.source = source;
  idx.dirty = false;
  idx.version++;
}

/* Rebuilds the index only when the register actually changed. */
function ensureStudentIndex() {
  const list = db.students.all();
  if (!studentIndex.dirty && studentIndex.source === list) return;
  rebuildStudentIndex(list);
}

/* ---------- Attendance index ----------
   Attendance holds one row per student per class, so it grows fastest of
   all collections. It is indexed by date, by sheet (date + class + section +
   subject) and by Student ID, and the per-student summary is computed once
   per change instead of on every table render. */
const attendanceIndex = {
  dirty: true,
  source: null,
  byDate: new Map(),
  bySheet: new Map(),
  byStudent: new Map(),
  perStudent: {}
};

function rebuildAttendanceIndex(list) {
  const idx = attendanceIndex;
  idx.byDate = new Map();
  idx.bySheet = new Map();
  idx.byStudent = new Map();
  idx.perStudent = {};

  const source = Array.isArray(list) ? list : [];
  source.forEach(rec => {
    if (!rec) return;

    const date = rec.date;
    if (date) {
      const byDate = idx.byDate.get(date);
      if (byDate) byDate.push(rec);
      else idx.byDate.set(date, [rec]);
    }

    const sheetKey = [rec.date, rec.className, rec.section || '', rec.subject || ''].join('\u0000');
    if (!idx.bySheet.has(sheetKey)) idx.bySheet.set(sheetKey, rec);

    (rec.entries || []).forEach(en => {
      const sid = String(en.studentId);
      let rows = idx.byStudent.get(sid);
      if (!rows) { rows = []; idx.byStudent.set(sid, rows); }
      rows.push(rec);

      let sum = idx.perStudent[sid];
      if (!sum) { sum = { present: 0, absent: 0, leave: 0, total: 0 }; idx.perStudent[sid] = sum; }
      if (en.status === 'present' || en.status === 'absent' || en.status === 'leave') {
        sum[en.status]++;
      }
      sum.total++;
    });
  });

  idx.source = source;
  idx.dirty = false;
}

function ensureAttendanceIndex() {
  const list = db.attendance.all();
  if (!attendanceIndex.dirty && attendanceIndex.source === list) return;
  rebuildAttendanceIndex(list);
}

const db = {
  classes: {
    all() { return Store.read(KEYS.classes, []); },
    saveList(list) { Store.write(KEYS.classes, list); },
    find(name) { return db.classes.all().find(c => c.name === name); },
    insert(cls) {
      const list = db.classes.all();
      list.push(cls);
      db.classes.saveList(list);
      return cls;
    },
    update(name, patch) {
      const list = db.classes.all();
      const idx = list.findIndex(c => c.name === name);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      db.classes.saveList(list);
      return list[idx];
    },
    /* Deleting a class also removes its students (student records keep class name) */
    remove(name) {
      db.classes.saveList(db.classes.all().filter(c => c.name !== name));
      db.students.saveList(db.students.all().filter(s => s.class !== name));
    },
    names() { return db.classes.all().map(c => c.name); },
    byId(id) { return db.classes.all().find(c => c.id === id); },
    sectionsOf(name) {
      const cls = db.classes.find(name);
      return (cls && Array.isArray(cls.sections)) ? cls.sections : [];
    },
    subjectsOf(name) {
      const cls = db.classes.find(name);
      return (cls && Array.isArray(cls.subjects)) ? cls.subjects : [];
    },
    /* A class is "section-less" when it has no sections at all. Its students
       live directly under the class and never require a section choice. */
    isSectionless(clsOrName) {
      const cls = typeof clsOrName === 'string' ? db.classes.find(clsOrName) : clsOrName;
      if (!cls) return false;
      return !Array.isArray(cls.sections) || cls.sections.length === 0;
    },
    yearOf(clsOrName) {
      const cls = typeof clsOrName === 'string' ? db.classes.find(clsOrName) : clsOrName;
      if (!cls) return '';
      return cls.year !== undefined && cls.year !== null ? cls.year : Utils.inferYear(cls.name);
    },
    groupOf(clsOrName) {
      const cls = typeof clsOrName === 'string' ? db.classes.find(clsOrName) : clsOrName;
      if (!cls) return '';
      return cls.group !== undefined && cls.group !== null ? cls.group : Utils.inferGroup(cls.name);
    },
    teacherOf(clsOrName) {
      const cls = typeof clsOrName === 'string' ? db.classes.find(clsOrName) : clsOrName;
      if (!cls) return '';
      if (cls.teacher) return cls.teacher;
      const t = db.teachers.all().find(t => (t.classes || []).indexOf(cls.name) > -1);
      return t ? t.name : '';
    },
    studentCount(name) {
      return db.students.active().filter(s => s.class === name).length;
    }
  },

  students: {
    /* Full register — includes archived (soft-deleted) students so their
       historical attendance can still be resolved and restored. */
    all() { return Store.read(KEYS.students, []); },
    saveList(list) {
      studentIndex.dirty = true;
      return Store.write(KEYS.students, list);
    },
    find(id) {
      ensureStudentIndex();
      return studentIndex.byId.get(id) || null;
    },
    byRoll(rollNo) {
      ensureStudentIndex();
      return studentIndex.active.find(s => String(s.rollNo) === String(rollNo)) || null;
    },

    /* A student is archived (soft-deleted) once `deletedAt` is stamped.
       Archiving never removes attendance — only the active-list membership. */
    isArchived(student) { return !!(student && student.deletedAt); },

    /* Active register — everyone not archived. This is the source of truth
       for lists, counts, rosters and reports. A copy is returned so a caller
       that sorts or filters it in place never corrupts the index. */
    active() {
      ensureStudentIndex();
      return studentIndex.active.slice();
    },

    /* Archived (soft-deleted) students, newest deletion first. */
    archived() {
      ensureStudentIndex();
      return studentIndex.archived.slice();
    },

    byClassSection(className, section) {
      ensureStudentIndex();
      if (!className) return studentIndex.active.slice();
      return studentIndex.active.filter(s =>
        s.class === className && (!section || String(s.section || '') === section));
    },

    /* ---------- Indexed lookups ----------
       The register is indexed once per change so lookups stay O(1) instead of
       scanning thousands of records on every keystroke or re-render. */

    /* The active record holding this Student ID (case-insensitive), or null. */
    findByStudentId(studentId) {
      ensureStudentIndex();
      const sid = db.students.normaliseId(studentId);
      if (!sid) return null;
      return studentIndex.bySidActive.get(sid) || null;
    },

    /* Any record (active or archived) holding this Student ID. */
    findAnyByStudentId(studentId) {
      ensureStudentIndex();
      const sid = db.students.normaliseId(studentId);
      if (!sid) return null;
      return studentIndex.bySid.get(sid) || null;
    },

    /* True when another record already uses this Student ID. `excludeId`
       lets a record keep its own ID while it is being edited. */
    existsStudentId(studentId, excludeId) {
      const hit = db.students.findByStudentId(studentId);
      if (hit && hit.id !== excludeId) return true;
      const any = db.students.findAnyByStudentId(studentId);
      return !!(any && any.id !== excludeId);
    },

    normaliseId(studentId) {
      return String(studentId == null ? '' : studentId).trim().toLowerCase();
    },

    /* ---------- Paginated, filtered query ----------
       One pass over the register plus a pre-built search haystack. The UI
       renders one page at a time, so a 10 000-student register behaves
       exactly like a 10-student one. */
    query(options) {
      const o = options || {};
      ensureStudentIndex();

      const view = o.view === 'archived' ? 'archived' : 'active';
      const sort = String(o.sort || 'register');
      const source = sort === 'register'
        ? (view === 'archived' ? studentIndex.orderArchived : studentIndex.orderActive)
        : (view === 'archived' ? studentIndex.archived : studentIndex.active);
      const q = String(o.q || '').trim().toLowerCase();
      const className = o.className || '';
      const section = o.section || '';
      const session = o.session || '';
      const status = o.status || '';

      const rows = [];
      for (let i = 0; i < source.length; i++) {
        const s = source[i];
        if (className && s.class !== className) continue;
        if (section && String(s.section || '') !== section) continue;
        if (session && String(s.session || '') !== session) continue;
        if (view === 'active' && status && String(s.status || 'active') !== status) continue;
        if (q) {
          const hay = studentIndex.haystack.get(s.id);
          if (!hay || hay.indexOf(q) === -1) continue;
        }
        rows.push(s);
      }

      if (sort === 'id') {
        rows.sort((a, b) => db.students.idCompare(a, b));
      } else if (sort === 'name') {
        rows.sort((a, b) =>
          String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }) ||
          db.students.idCompare(a, b));
      } else if (sort === 'roll') {
        rows.sort((a, b) =>
          String(a.class || '').localeCompare(String(b.class || ''), undefined, { numeric: true }) ||
          String(a.section || '').localeCompare(String(b.section || ''), undefined, { numeric: true }) ||
          db.students.rollCompare(a, b));
      }
      /* Register order is already baked into orderActive/orderArchived. */

      const total = rows.length;
      const limit = Math.max(1, Number(o.limit) || 25);
      const pages = Math.max(1, Math.ceil(total / limit));
      const page = Math.min(Math.max(1, Number(o.page) || 1), pages);
      const start = (page - 1) * limit;

      return {
        rows: rows.slice(start, start + limit),
        total: total,
        page: page,
        pages: pages,
        limit: limit,
        start: total ? start + 1 : 0,
        end: Math.min(start + limit, total)
      };
    },

    /* Every record matching the filters — used by print/export where the
       whole filtered set is needed. */
    select(options) {
      const o = options || {};
      const limit = Number(o.limit) || 0;
      const res = db.students.query(Object.assign({}, o, { page: 1, limit: limit || 1000000 }));
      return res.rows;
    },

    /* ---------- Student-ID ordering ----------
       Student IDs are compared numerically, never alphabetically: a purely
       numeric ID such as "2413" sorts by its value (so 99 < 2413 < 10000).
       Non-numeric IDs follow after numeric ones in natural order. Name is the
       tie-breaker so every order is stable. */

    idNumber(studentId) {
      const raw = String(studentId == null ? '' : studentId).trim();
      return /^\d+$/.test(raw) ? Number(raw) : null;
    },

    idCompare(a, b) {
      const na = db.students.idNumber(a.studentId);
      const nb = db.students.idNumber(b.studentId);
      if (na != null && nb != null && na !== nb) return na - nb;
      if (na != null && nb == null) return -1;
      if (na == null && nb != null) return 1;
      const cmp = String(a.studentId || '').localeCompare(String(b.studentId || ''), undefined, { numeric: true });
      if (cmp !== 0) return cmp;
      return String(a.name || '').localeCompare(String(b.name || ''));
    },

    /* ---------- Automatic roll numbers (derived from Student ID) ----------
       Roll Number = 1-based position of the Student ID among the active
       students of the same class + section + academic session. The smallest
       Student ID is Roll No. 1. Resequencing only ever rewrites rollNo — a
       Student ID is never changed, and no student is ever removed. A sequence
       is scoped to one class + section + academic session, so changes in one
       class/session never touch another. */

    scopeKey(className, section, session) {
      return [className || '', section || '', session || ''].join('\u0000');
    },
    studentScope(s) {
      return db.students.scopeKey(s.class, s.section, s.session);
    },

    /* Does this record hold a real numeric roll number? */
    hasRoll(s) {
      return !!s && s.rollNo !== '' && s.rollNo != null && !isNaN(Number(s.rollNo));
    },

    /* Ascending by roll number; roll-less records sort last, then by name. */
    rollCompare(a, b) {
      const ar = db.students.hasRoll(a) ? Number(a.rollNo) : null;
      const br = db.students.hasRoll(b) ? Number(b.rollNo) : null;
      if (ar != null && br != null) return ar !== br ? ar - br : String(a.name || '').localeCompare(String(b.name || ''));
      if (ar != null) return -1;
      if (br != null) return 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    },

    /* The roll number a given Student ID would receive in its scope, ignoring
       an optional existing record (the student currently being edited).
       Only the students of that one scope are inspected, so the cost depends
       on the class size — not on the size of the whole register. */
    rollFor(className, section, session, studentId, excludeId) {
      ensureStudentIndex();
      const bucket = studentIndex.byScope.get(db.students.scopeKey(className, section, session));
      if (!bucket) return 1;
      const probe = { studentId: studentId, name: '' };
      let position = 1;
      for (let i = 0; i < bucket.students.length; i++) {
        const s = bucket.students[i];
        if (s.id === excludeId) continue;
        if (db.students.idCompare(s, probe) < 0) position++;
      }
      return position;
    },

    /* Re-assign contiguous roll numbers 1..N across one scope in Student-ID
       order, closing any gaps left by a removal. Returns true when anything
       changed. Runs in one pass over the scope (no nested scan of the whole
       register), so it stays fast with thousands of students. */
    resequence(className, section, session) {
      ensureStudentIndex();
      const bucket = studentIndex.byScope.get(db.students.scopeKey(className, section, session));
      if (!bucket) return false;
      let changed = false;
      bucket.students.forEach((s, i) => {
        const want = i + 1;
        if (Number(s.rollNo) !== want) {
          s.rollNo = want;
          changed = true;
        }
      });
      if (changed) db.students.saveList(db.students.all());
      return changed;
    },

    /* Re-sequence every class/section/session. Run on startup so an existing
       register adopts the Student-ID rule without any manual work. */
    resequenceAll() {
      ensureStudentIndex();
      let changed = 0;
      studentIndex.byScope.forEach(bucket => {
        bucket.students.forEach((s, i) => {
          const want = i + 1;
          if (Number(s.rollNo) !== want) {
            s.rollNo = want;
            changed++;
          }
        });
      });
      if (changed) db.students.saveList(db.students.all());
      return changed;
    },

    insert(student) {
      const list = db.students.all();
      list.push(student);
      db.students.saveList(list);
      return student;
    },
    update(id, patch) {
      const list = db.students.all();
      const idx = list.findIndex(s => s.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      db.students.saveList(list);
      return list[idx];
    },

    /* Soft-delete: keep the record (and its attendance) but remove it from
       every active list. Timestamped so it can be restored later. */
    archive(id, meta) {
      const when = (meta && meta.when) || new Date().toISOString();
      const by = (meta && meta.by) || (auth.current() || {}).name || 'Administrator';
      const result = db.students.update(id, { status: 'inactive', deletedAt: when, deletedBy: by });
      const s = db.students.find(id);
      if (s) db.students.resequence(s.class, s.section, s.session);
      return result;
    },

    /* Restore an archived student back to the active register. Their roll
       number is recomputed from Student-ID order along with the rest of the
       class. */
    restore(id) {
      const student = db.students.find(id);
      if (!student || !db.students.isArchived(student)) return null;
      const patch = { status: 'active', deletedAt: '', deletedBy: '' };
      const result = db.students.update(id, patch);
      db.students.resequence(student.class, student.section, student.session);
      return result;
    },

    /* Permanent removal — not wired to the UI (soft delete is used instead);
       kept for administrative/migration use. */
    remove(id) {
      db.students.saveList(db.students.all().filter(s => s.id !== id));
    },
    count() { return db.students.active().length; },
    indexVersion() {
      ensureStudentIndex();
      return studentIndex.version;
    }
  },

  teachers: {
    all() { return Store.read(KEYS.teachers, []); },
    saveList(list) { Store.write(KEYS.teachers, list); },
    find(id) { return db.teachers.all().find(t => t.id === id); },
    insert(teacher) {
      const list = db.teachers.all();
      list.push(teacher);
      db.teachers.saveList(list);
      return teacher;
    },
    update(id, patch) {
      const list = db.teachers.all();
      const idx = list.findIndex(t => t.id === id);
      if (idx === -1) return null;
      list[idx] = Object.assign({}, list[idx], patch);
      db.teachers.saveList(list);
      return list[idx];
    },
    remove(id) {
      db.teachers.saveList(db.teachers.all().filter(t => t.id !== id));
    },
    count() { return db.teachers.all().length; }
  },

  /* Academic sessions (academic years). Local cache mirrored to Supabase's
     academic_sessions table; drives the year filter and record tagging. */
  sessions: {
    all() { return Store.read(KEYS.sessions, []); },
    saveList(list) { Store.write(KEYS.sessions, list); },
    active() { return db.sessions.all().find(s => s.active) || null; },
    byName(name) { return db.sessions.all().find(s => s.name === name) || null; },
    names() { return db.sessions.all().map(s => s.name); },
    /* Session whose date range contains the ISO date; falls back to the active
       session, then the newest session, then null. */
    forDate(iso) {
      const list = db.sessions.all();
      const match = list.find(s => s.start && s.end && iso >= s.start && iso <= s.end);
      if (match) return match;
      return list.find(s => s.active) || list[0] || null;
    },
    insert(session) {
      const list = db.sessions.all();
      if (session.active) list.forEach(s => { s.active = false; });
      list.push(session);
      db.sessions.saveList(list);
      return session;
    },
    remove(name) {
      db.sessions.saveList(db.sessions.all().filter(s => s.name !== name));
    },
    setActive(name) {
      const list = db.sessions.all();
      list.forEach(s => { s.active = (s.name === name); });
      db.sessions.saveList(list);
      return db.sessions.active();
    }
  },

  attendance: {
    all() { return Store.read(KEYS.attendance, []); },
    saveList(list) {
      attendanceIndex.dirty = true;
      return Store.write(KEYS.attendance, list);
    },

    findSheet(date, className, section, subject) {
      ensureAttendanceIndex();
      const bucket = attendanceIndex.bySheet.get(
        [date, className, section || '', subject || ''].join('\u0000'));
      return bucket || null;
    },

    /* Insert or replace by natural key: date + class + section + subject */
    upsert(record) {
      const list = db.attendance.all();
      if (!record.session) {
        const sess = db.sessions.forDate(record.date);
        record.session = sess ? sess.name : '';
      }
      const idx = list.findIndex(r =>
        r.date === record.date && r.className === record.className &&
        r.section === record.section && r.subject === record.subject
      );
      if (idx > -1) {
        record.id = list[idx].id;
        list[idx] = record;
      } else {
        record.id = record.id || Utils.uid('att');
        list.push(record);
      }
      db.attendance.saveList(list);
      return record;
    },

    remove(id) {
      db.attendance.saveList(db.attendance.all().filter(r => r.id !== id));
    },

    /* When a student's Student ID is corrected, repoint every stored
       attendance entry at the new ID so nothing is lost (entries reference
       students by Student ID). */
    renumberStudent(oldId, newId) {
      if (String(oldId) === String(newId)) return false;
      const list = db.attendance.all();
      let changed = false;
      list.forEach(rec => {
        (rec.entries || []).forEach(en => {
          if (String(en.studentId) === String(oldId)) { en.studentId = newId; changed = true; }
        });
      });
      if (changed) db.attendance.saveList(list);
      return changed;
    },

    forDate(iso) {
      ensureAttendanceIndex();
      const rows = attendanceIndex.byDate.get(iso);
      return rows ? rows.slice() : [];
    },

    /* Aggregated marks for one day: { present, absent, leave, total } */
    statsForDate(iso) {
      const stats = { present: 0, absent: 0, leave: 0, total: 0 };
      db.attendance.forDate(iso).forEach(rec => {
        rec.entries.forEach(en => {
          stats[en.status] = (stats[en.status] || 0) + 1;
          stats.total++;
        });
      });
      return stats;
    },

    /* Per class+section breakdown for one day (dashboard table) */
    groupedForDate(iso) {
      const groups = {};
      db.attendance.forDate(iso).forEach(rec => {
        const key = rec.className + '|' + rec.section;
        if (!groups[key]) {
          groups[key] = { className: rec.className, section: rec.section, students: 0, present: 0, absent: 0, leave: 0 };
        }
        rec.entries.forEach(en => {
          groups[key][en.status] = (groups[key][en.status] || 0) + 1;
          groups[key].students++;
        });
      });
      return groups;
    },

    /* Records for one student (profile history) */
    byStudent(studentId) {
      ensureAttendanceIndex();
      const rows = attendanceIndex.byStudent.get(String(studentId)) || [];
      return rows.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    },

    /* One-pass summary for every student (students table percentages).
       The summary is built once per change and reused until the attendance
       records change, so the students table no longer re-counts every
       attendance entry on each render. */
    perStudentMap() {
      ensureAttendanceIndex();
      return attendanceIndex.perStudent;
    },

    /* Filter helper used by reports. Supports period, class, section,
       subject and the academic year / study group of the class (the latter
       two resolved from class metadata so Medical and Computer Science are
       only ever combined when no year/group/class filter is applied). */
    query(filters) {
      const f = filters || {};
      const needMeta = !!(f.year || f.group);
      let meta = null;
      if (needMeta) {
        meta = {};
        db.classes.all().forEach(c => {
          meta[c.name] = { year: db.classes.yearOf(c), group: db.classes.groupOf(c) };
        });
      }
      return db.attendance.all().filter(r => {
        if (f.from && r.date < f.from) return false;
        if (f.to && r.date > f.to) return false;
        if (f.className && r.className !== f.className) return false;
        if (f.section && r.section !== f.section) return false;
        if (f.subject && r.subject !== f.subject) return false;
        if (needMeta) {
          const m = meta[r.className] ||
            { year: Utils.inferYear(r.className), group: Utils.inferGroup(r.className) };
          if (f.year && m.year !== f.year) return false;
          if (f.group && m.group !== f.group) return false;
        }
        return true;
      }).sort((a, b) => (a.date === b.date ? (a.submittedAt < b.submittedAt ? 1 : -1) : (a.date < b.date ? 1 : -1)));
    }
  },

  settings: {
    get() {
      const defaults = Seed.buildSettings();
      const raw = Store.read(KEYS.settings, null);
      const stored = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : null;
      /* Merge stored over defaults so a partial or stale settings object
         (left over from an earlier build, a server hydrate, or corrupted
         storage) can never hide a field the app relies on. The demo
         account is ALWAYS the built-in one — it is not editable in the
         UI, so any stored value that differs is stale data. */
      const merged = Object.assign({}, defaults, stored || {});
      merged.college = Object.assign({}, defaults.college, (stored && stored.college) || {});
      merged.appearance = Object.assign({}, defaults.appearance, (stored && stored.appearance) || {});
      merged.attendance = Object.assign({}, defaults.attendance, (stored && stored.attendance) || {});
      merged.demo = { email: DEMO_CREDENTIALS.email, password: DEMO_CREDENTIALS.password };
      return merged;
    },
    update(patch) {
      const current = db.settings.get();
      const next = Object.assign({}, current, patch);
      Store.write(KEYS.settings, next);
      return next;
    },
    reset() {
      [
        KEYS.students, KEYS.classes, KEYS.teachers, KEYS.attendance,
        KEYS.settings, KEYS.sessions, KEYS.seeded, KEYS.removedCore,
        'mca_exams', 'mca_subjects', 'mca_marks', 'mca_exam_settings'
      ].forEach(Store.remove);
    }
  }
};

/* ==========================================================================
   5. auth — demo credentials. When the Node backend is running, the login
   is validated SERVER-SIDE via POST /api/auth/login and the returned token
   is kept in the session for authorised writes. When the pages are opened
   straight from disk (file://), it falls back to the built-in demo check.
   ========================================================================== */
const auth = {
  current() {
    const local = Store.read(KEYS.sessionLocal, null);
    if (local) return local;
    try {
      const temp = sessionStorage.getItem(KEYS.sessionTemp);
      return temp ? JSON.parse(temp) : null;
    } catch (err) {
      return null;
    }
  },

  async login(email, password, remember) {
    const wanted = String(email || '').trim().toLowerCase();
    const pass = String(password || '').trim();

    let user = null;

    /* --- Backend path: real server-side credential check --- */
    if (window.MCA_API && MCA_API.isAvailable()) {
      try {
        const data = await MCA_API.login(wanted, pass);
        user = {
          email: data.user ? data.user.email : wanted,
          name: data.user ? data.user.name : 'Administrator',
          role: data.user ? data.user.role : 'admin',
          loggedInAt: new Date().toISOString(),
          token: data.token
        };
      } catch (err) {
        return {
          ok: false,
          message: err.message || 'Invalid email or password. Use the demo credentials shown above.'
        };
      }
    } else {
      /* --- Offline path: local demo check (file:// / server down) ---.
         Compared against the built-in constants so a stale mca_settings
         entry can never break the demo sign-in. */
      const ok = wanted === DEMO_CREDENTIALS.email && pass === DEMO_CREDENTIALS.password;
      if (!ok) {
        return { ok: false, message: 'Invalid email or password. Use the demo credentials shown above.' };
      }
      user = {
        email: DEMO_CREDENTIALS.email,
        name: 'Administrator',
        role: 'admin',
        loggedInAt: new Date().toISOString()
      };
    }

    if (remember) {
      Store.write(KEYS.sessionLocal, user);
      try { sessionStorage.removeItem(KEYS.sessionTemp); } catch (err) { /* ignore */ }
    } else {
      try { sessionStorage.setItem(KEYS.sessionTemp, JSON.stringify(user)); } catch (err) { /* ignore */ }
      Store.remove(KEYS.sessionLocal);
    }
    if (user.token && window.MCA_API) MCA_API.setToken(user.token);
    return { ok: true, user: user };
  },

  logout() {
    if (window.MCA_API) MCA_API.logout();
    Store.remove(KEYS.sessionLocal);
    try { sessionStorage.removeItem(KEYS.sessionTemp); } catch (err) { /* ignore */ }
    window.location.replace('index.html');
  },

  require() {
    if (!auth.current()) {
      window.location.replace('index.html');
      return false;
    }
    return true;
  }
};

/* ==========================================================================
   6. UI helpers — toast, modal, confirm, dropdowns, theme, CSV, validation
   ========================================================================== */
const UI = {
  /* ---------- Toasts ---------- */
  toast(message, type, title) {
    type = type || 'info';
    const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Notice' };
    const icons = {
      success: 'fa-circle-check',
      error: 'fa-circle-exclamation',
      warning: 'fa-triangle-exclamation',
      info: 'fa-circle-info'
    };

    let stack = document.getElementById('toastStack');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'toastStack';
      stack.className = 'toast-stack';
      document.body.appendChild(stack);
    }

    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<span class="toast-ico"><i class="fa-solid ' + icons[type] + '"></i></span>' +
      '<div class="toast-body">' +
        '<div class="toast-title">' + Utils.esc(title || titles[type]) + '</div>' +
        '<div class="toast-msg">' + Utils.esc(message) + '</div>' +
      '</div>' +
      '<button class="toast-close" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '<span class="toast-progress" style="animation-duration:4000ms"></span>';

    const remove = () => {
      if (!el.parentNode) return;
      el.classList.add('leaving');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    };

    el.querySelector('.toast-close').addEventListener('click', remove);
    stack.appendChild(el);
    setTimeout(remove, 4000);
  },

  /* ---------- Modals ---------- */
  modal: {
    open(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.add('open');
      document.body.classList.add('modal-open');
      const focusable = el.querySelector('input, select, textarea, button.btn-primary');
      if (focusable) setTimeout(() => focusable.focus(), 60);
    },

    close(el) {
      const backdrop = typeof el === 'string' ? document.getElementById(el) : el;
      if (!backdrop || !backdrop.classList.contains('modal-backdrop')) return;
      backdrop.classList.remove('open');
      if (!document.querySelector('.modal-backdrop.open')) {
        document.body.classList.remove('modal-open');
      }
    },

    closeAll() {
      document.querySelectorAll('.modal-backdrop.open').forEach(b => UI.modal.close(b));
    }
  },

  /* ---------- Confirm dialog (returns a Promise) ---------- */
  confirm(options) {
    const opts = options || {};
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop open';
      backdrop.innerHTML =
        '<div class="modal" role="alertdialog" aria-modal="true">' +
          '<div class="modal-body">' +
            '<div class="confirm-body">' +
              '<span class="confirm-icon' + (opts.danger ? ' danger' : '') + '">' +
                '<i class="fa-solid ' + (opts.danger ? 'fa-trash-can' : 'fa-triangle-exclamation') + '"></i>' +
              '</span>' +
              '<div>' +
                '<h4>' + Utils.esc(opts.title || 'Are you sure?') + '</h4>' +
                '<p>' + Utils.esc(opts.message || 'This action cannot be undone.') + '</p>' +
                (opts.detail ? '<div class="confirm-detail">' + Utils.esc(opts.detail) + '</div>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button type="button" class="btn btn-outline" data-act="cancel">' +
              Utils.esc(opts.cancelText || 'Cancel') + '</button>' +
            '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' +
              Utils.esc(opts.confirmText || 'Confirm') + '</button>' +
          '</div>' +
        '</div>';

      const finish = result => {
        document.removeEventListener('keydown', onKey);
        backdrop.classList.remove('open');
        document.body.classList.remove('modal-open');
        setTimeout(() => { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }, 220);
        resolve(result);
      };

      const onKey = e => { if (e.key === 'Escape') finish(false); };

      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) finish(false);
      });
      backdrop.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(false));
      backdrop.querySelector('[data-act="ok"]').addEventListener('click', () => finish(true));
      document.addEventListener('keydown', onKey);

      document.body.appendChild(backdrop);
      document.body.classList.add('modal-open');
      backdrop.querySelector('[data-act="ok"]').focus();
    });
  },

  /* ---------- Validation helpers ---------- */
  clearErrors(form) {
    form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
    form.querySelectorAll('.field-error').forEach(el => el.remove());
  },

  fieldError(input, message) {
    input.classList.add('invalid');
    const box = document.createElement('div');
    box.className = 'field-error';
    box.textContent = message;
    const group = input.closest('.form-group');
    if (group) group.appendChild(box);
    else input.parentNode.appendChild(box);
  },

  /* Returns true when the whole form is valid (HTML5 + custom rule) */
  validateForm(form, customRule) {
    UI.clearErrors(form);
    let valid = true;

    form.querySelectorAll('input, select, textarea').forEach(input => {
      if (input.disabled) return;
      if (!input.checkValidity()) {
        UI.fieldError(input, input.validationMessage || 'This field is required.');
        valid = false;
      }
    });

    if (valid && typeof customRule === 'function') {
      const errors = customRule(form) || [];
      errors.forEach(err => {
        if (err.input) UI.fieldError(err.input, err.message);
        valid = false;
      });
    }

    if (!valid) {
      const first = form.querySelector('.invalid');
      if (first) first.focus();
    }
    return valid;
  },

  /* ---------- Dropdowns ---------- */
  initDropdowns(root) {
    (root || document).querySelectorAll('[data-dropdown]').forEach(trigger => {
      if (trigger.dataset.bound === '1') return;
      trigger.dataset.bound = '1';
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const menu = document.getElementById(trigger.dataset.dropdown);
        if (!menu) return;
        const wasOpen = menu.classList.contains('open');
        document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
        if (!wasOpen) menu.classList.add('open');
      });
    });
  },

  closeDropdowns() {
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
  },

  /* ---------- Theme / appearance ---------- */
  applyAppearance() {
    const app = db.settings.get().appearance || {};
    document.documentElement.setAttribute('data-theme', app.theme === 'dark' ? 'dark' : 'light');
    if (app.primary) {
      document.documentElement.style.setProperty('--color-primary', app.primary);
    }
    UI.syncThemeIcon();
  },

  setTheme(theme) {
    const settings = db.settings.get();
    db.settings.update({ appearance: Object.assign({}, settings.appearance, { theme: theme }) });
    UI.applyAppearance();
    window.dispatchEvent(new CustomEvent('mca:theme-change', { detail: { theme: theme } }));
  },

  toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    UI.setTheme(isDark ? 'light' : 'dark');
  },

  setPrimary(hex) {
    const settings = db.settings.get();
    db.settings.update({ appearance: Object.assign({}, settings.appearance, { primary: hex }) });
    document.documentElement.style.setProperty('--color-primary', hex);
    window.dispatchEvent(new CustomEvent('mca:primary-change', { detail: { primary: hex } }));
  },

  syncThemeIcon() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const icon = btn.querySelector('i');
    if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  },

  /* ---------- CSV export ---------- */
  exportCSV(filename, rows) {
    const csv = rows.map(row =>
      row.map(cell => {
        const s = String(cell == null ? '' : cell);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',')
    ).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },

  /* ---------- Unsaved-changes guard (attendance sheet) ---------- */
  dirtyGuard: (() => {
    let dirty = false;
    window.addEventListener('beforeunload', e => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    return {
      set(value) { dirty = !!value; },
      clear() { dirty = false; }
    };
  })(),

  /* ---------- Small DOM helpers ---------- */
  optionList(select, items, selected, placeholder) {
    select.innerHTML = '';
    if (placeholder) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = placeholder;
      select.appendChild(opt);
    }
    items.forEach(item => {
      const opt = document.createElement('option');
      opt.value = typeof item === 'string' ? item : item.value;
      opt.textContent = typeof item === 'string' ? item : item.label;
      select.appendChild(opt);
    });
    if (selected != null) select.value = selected;
  },

  statusBadge(status) {
    const map = {
      present: ['badge-green', 'Present'],
      absent: ['badge-red', 'Absent'],
      leave: ['badge-amber', 'Leave'],
      active: ['badge-green', 'Active'],
      inactive: ['badge-gray', 'Inactive']
    };
    const found = map[String(status || '').toLowerCase()] || ['badge-gray', status || '—'];
    return '<span class="badge ' + found[0] + '">' + Utils.esc(found[1]) + '</span>';
  },

  emptyState(title, message, icon) {
    return '<div class="empty-state">' +
      '<span class="empty-icon"><i class="fa-solid ' + (icon || 'fa-inbox') + '"></i></span>' +
      '<h4>' + Utils.esc(title) + '</h4>' +
      '<p>' + Utils.esc(message) + '</p>' +
      '</div>';
  }
};

/* ==========================================================================
   7. Chrome — sidebar & topbar (rendered once, shared by every page)
   ========================================================================== */
const NAV = [
  { key: 'dashboard', href: 'dashboard.html', icon: 'fa-gauge-high', label: 'Dashboard' },
  { key: 'students', href: 'students.html', icon: 'fa-user-graduate', label: 'Students' },
  {
    key: 'attendance', icon: 'fa-clipboard-check', label: 'Attendance',
    children: [
      { key: 'attendance-take', href: 'attendance.html', label: 'Take Attendance' },
      { key: 'attendance-records', href: 'attendance.html?tab=records', label: 'Records' }
    ]
  },
  {
    key: 'exams', icon: 'fa-file-pen', label: 'Examination System',
    children: [
      { key: 'exam-dashboard', href: 'examinations.html', label: 'Exam Dashboard' },
      { key: 'exam-create', href: 'examinations.html?tab=create', label: 'Create Examination' },
      { key: 'exam-schedule', href: 'examinations.html?tab=schedule', label: 'Examination Schedule' },
      { key: 'exam-subjects', href: 'examinations.html?tab=subjects', label: 'Manage Subjects' },
      { key: 'exam-marks', href: 'examinations.html?tab=marks', label: 'Enter Student Marks' },
      { key: 'exam-results', href: 'examinations.html?tab=results', label: 'Examination Results' },
      { key: 'exam-dmc', href: 'examinations.html?tab=dmc', label: 'Generate DMC' },
      { key: 'exam-printdmc', href: 'examinations.html?tab=printdmc', label: 'Print DMC' },
      { key: 'exam-reports', href: 'examinations.html?tab=reports', label: 'Examination Reports' },
      { key: 'exam-settings', href: 'examinations.html?tab=settings', label: 'Examination Settings' }
    ]
  },
  { key: 'reports', href: 'reports.html', icon: 'fa-chart-column', label: 'Reports' },
  { key: 'planner', href: 'planner.html', icon: 'fa-calendar-days', label: 'Yearly Planner' },
  { key: 'classes', href: 'classes.html', icon: 'fa-school', label: 'Classes' },
  { key: 'teachers', href: 'teachers.html', icon: 'fa-chalkboard-user', label: 'Teachers' },
  {
    key: 'administration', icon: 'fa-shield-halved', label: 'Administration',
    children: [
      { key: 'admin', href: 'admin.html', label: 'Super Admin Dashboard' },
      { key: 'teacher-accounts', href: 'teacher-accounts.html', label: 'Teacher Accounts' }
    ]
  },
  { key: 'settings', href: 'settings.html', icon: 'fa-gear', label: 'Settings' }
];

const Chrome = {
  navKey() {
    const page = document.body.dataset.page || '';
    if (page === 'attendance') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      return tab === 'records' ? 'attendance-records' : 'attendance-take';
    }
    if (page === 'examinations') {
      const tab = new URLSearchParams(window.location.search).get('tab');
      const key = tab ? 'exam-' + tab : 'exam-dashboard';
      return NAV.some(g => g.children && g.children.some(c => c.key === key)) ? key : 'exam-dashboard';
    }
    return page;
  },

  renderSidebar() {
    const host = document.getElementById('sidebar');
    if (!host) return;

    const settings = db.settings.get();
    const activeKey = Chrome.navKey();

    const items = NAV.map(item => {
      if (item.children) {
        const groupActive = item.children.some(c => c.key === activeKey);
        const children = item.children.map(c =>
          '<a href="' + c.href + '" class="' + (c.key === activeKey ? 'active' : '') + '">' +
          Utils.esc(c.label) + '</a>'
        ).join('');
        return '<div class="nav-group' + (groupActive ? ' open' : '') + '">' +
          '<button type="button" class="nav-item' + (groupActive ? ' active' : '') + '" data-nav-group>' +
            '<i class="fa-solid ' + item.icon + '"></i><span>' + Utils.esc(item.label) + '</span>' +
            '<i class="fa-solid fa-chevron-down nav-caret"></i>' +
          '</button>' +
          '<div class="nav-sub">' + children + '</div>' +
        '</div>';
      }
      return '<a href="' + item.href + '" class="nav-item' + (item.key === activeKey ? ' active' : '') + '">' +
        '<i class="fa-solid ' + item.icon + '"></i><span>' + Utils.esc(item.label) + '</span></a>';
    }).join('');

    host.innerHTML =
      '<div class="sidebar-brand">' +
        '<img src="assets/logo.png" alt="College logo" class="sidebar-logo">' +
        '<div class="sidebar-brand-text">' +
          '<strong>' + Utils.esc(settings.college.name) + '</strong>' +
          '<span>Attendance Management System</span>' +
        '</div>' +
        '<button type="button" class="sidebar-close" id="sidebarClose" aria-label="Close menu">&times;</button>' +
      '</div>' +
      '<nav class="sidebar-nav" aria-label="Main navigation">' + items + '</nav>' +
      '<div class="sidebar-footer">' +
        '<button type="button" class="nav-item nav-logout" data-logout>' +
          '<i class="fa-solid fa-right-from-bracket"></i><span>Logout</span>' +
        '</button>' +
      '</div>';
  },

  renderTopbar() {
    const host = document.getElementById('topbar');
    if (!host) return;

    const user = auth.current() || { name: 'Administrator', email: '' };
    const title = document.body.dataset.title || 'Dashboard';
    const todayRecords = db.attendance.forDate(Utils.todayISO())
      .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));

    const notifications = todayRecords.slice(0, 6).map(rec =>
      '<div class="dropdown-item notif-item">' +
        '<span class="notif-ico"><i class="fa-solid fa-clipboard-check"></i></span>' +
        '<span>' + Utils.esc(rec.className) +
          (rec.section ? ' &middot; Sec ' + Utils.esc(rec.section) : ' &middot; No section') +
          '<small>' + Utils.esc(rec.subject) + ' — attendance ' + Utils.esc(rec.action) +
          ' at ' + Utils.esc(Utils.fmtTime(rec.submittedAt)) + '</small></span>' +
      '</div>'
    ).join('');

    host.innerHTML =
      '<button type="button" class="icon-btn" id="menuBtn" aria-label="Open menu">' +
        '<i class="fa-solid fa-bars"></i></button>' +
      '<div class="topbar-title">' +
        '<h1>' + Utils.esc(title) + '</h1>' +
        '<span>' + Utils.esc(Utils.fmtDateLong(new Date())) + '</span>' +
      '</div>' +
      '<div class="topbar-actions">' +
        '<button type="button" class="icon-btn" id="themeToggle" title="Toggle dark mode" aria-label="Toggle dark mode">' +
          '<i class="fa-solid fa-moon"></i></button>' +
        '<div class="dropdown">' +
          '<button type="button" class="icon-btn" data-dropdown="notifMenu" aria-label="Notifications" style="position:relative">' +
            '<i class="fa-solid fa-bell"></i>' +
            (todayRecords.length ? '<span class="badge-dot"></span>' : '') +
          '</button>' +
          '<div class="dropdown-menu dropdown-right" id="notifMenu">' +
            '<div class="dropdown-title">Today\'s activity</div>' +
            (notifications || '<div class="dropdown-item muted">No attendance submitted yet today.</div>') +
          '</div>' +
        '</div>' +
        '<div class="dropdown">' +
          '<button type="button" class="user-chip" data-dropdown="userMenu">' +
            '<span class="avatar">' + Utils.esc(Utils.initials(user.name)) + '</span>' +
            '<span class="user-meta"><strong>' + Utils.esc(user.name) + '</strong>' +
            '<small>' + Utils.esc(user.email) + '</small></span>' +
            '<i class="fa-solid fa-chevron-down"></i>' +
          '</button>' +
          '<div class="dropdown-menu dropdown-right" id="userMenu">' +
            '<div class="dropdown-title">Signed in</div>' +
            '<a href="settings.html" class="dropdown-item"><i class="fa-solid fa-gear"></i> Settings</a>' +
            '<div class="dropdown-divider"></div>' +
            '<button type="button" class="dropdown-item" data-logout>' +
              '<i class="fa-solid fa-right-from-bracket"></i> Logout</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  },

  bind() {
    const openSidebar = () => document.body.classList.add('sidebar-open');
    const closeSidebar = () => document.body.classList.remove('sidebar-open');

    const menuBtn = document.getElementById('menuBtn');
    if (menuBtn) menuBtn.addEventListener('click', openSidebar);

    const sidebarClose = document.getElementById('sidebarClose');
    if (sidebarClose) sidebarClose.addEventListener('click', closeSidebar);

    const backdrop = document.getElementById('sidebarBackdrop');
    if (backdrop) backdrop.addEventListener('click', closeSidebar);

    /* Close the mobile drawer after navigating */
    document.querySelectorAll('.sidebar a').forEach(a => {
      a.addEventListener('click', closeSidebar);
    });

    /* Collapsible Attendance submenu */
    document.querySelectorAll('[data-nav-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.nav-group').classList.toggle('open');
      });
    });

    /* Logout (sidebar + user menu) */
    document.querySelectorAll('[data-logout]').forEach(btn => {
      btn.addEventListener('click', () => {
        auth.logout();
      });
    });

    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', () => UI.toggleTheme());

    UI.initDropdowns(document);
  },

  render() {
    Chrome.renderSidebar();
    Chrome.renderTopbar();
    Chrome.bind();
  }
};

/* ==========================================================================
   8. Init / guards
   ========================================================================== */

/* Login page wiring (demo authentication — see auth.login) */
function initLogin() {
  const form = document.getElementById('loginForm');
  if (!form) return;

  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  const remember = document.getElementById('rememberMe');
  const submitBtn = document.getElementById('loginBtn');
  const errorBox = document.getElementById('loginError');
  const errorText = document.getElementById('loginErrorText');

  /* Previously remembered email */
  const rememberedEmail = Store.read('mca_remember_email', '');
  if (rememberedEmail) {
    emailInput.value = rememberedEmail;
    remember.checked = true;
  }

  function showError(message) {
    errorText.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.hidden = true;
  }

  /* "Fill credentials for me" (demo convenience) */
  const fillBtn = document.getElementById('fillDemo');
  if (fillBtn) {
    fillBtn.addEventListener('click', () => {
      const demo = db.settings.get().demo;
      emailInput.value = demo.email;
      passInput.value = demo.password;
      clearError();
      toast('Demo credentials filled in.', 'info');
    });
  }

  /* Password visibility toggle */
  const toggle = document.getElementById('togglePassword');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const showing = passInput.type === 'text';
      passInput.type = showing ? 'password' : 'text';
      const icon = toggle.querySelector('i');
      if (icon) icon.className = showing ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      toggle.title = showing ? 'Show password' : 'Hide password';
      toggle.setAttribute('aria-label', toggle.title);
    });
  }

  /* Forgot password (demo) */
  const forgotBtn = document.getElementById('forgotBtn');
  if (forgotBtn) {
    forgotBtn.addEventListener('click', () => {
      document.getElementById('forgotEmail').value = emailInput.value;
      UI.modal.open('forgotModal');
    });
  }

  const forgotForm = document.getElementById('forgotForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', e => {
      e.preventDefault();
      if (!UI.validateForm(forgotForm)) return;
      UI.modal.close('forgotModal');
      toast('Password reset will be enabled once Supabase Auth is connected.', 'info', 'Demo prototype');
      forgotForm.reset();
    });
  }

  /* Submit */
  let submitting = false;
  form.addEventListener('submit', e => {
    e.preventDefault();
    clearError();

    const email = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }
    if (submitting) return;
    submitting = true;
    submitBtn.classList.add('is-loading');
    submitBtn.disabled = true;

    /* auth.login() talks to the backend when it is running, or falls back
       to the local demo check. */
    setTimeout(async () => {
      let result;
      try {
        result = await auth.login(email, password, remember.checked);
      } catch (err) {
        console.error('[MCA] login failed unexpectedly:', err);
        result = { ok: false, message: 'Something went wrong while signing in. Please try again.' };
      }
      submitting = false;
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;

      if (!result.ok) {
        showError(result.message);
        toast(result.message, 'error', 'Sign-in failed');
        return;
      }

      if (remember.checked) Store.write('mca_remember_email', email);
      else Store.remove('mca_remember_email');

      toast('Welcome back, Administrator.', 'success', 'Signed in');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 350);
    }, 450);
  });
}

/* Student photographs used to live inside `mca_students` as base64 data
   URLs, which filled the browser storage long before the register could
   reach a few hundred students. Any photograph still stored inline is moved
   into the photo store on the first load and the record is slimmed down. */
async function migrateLegacyPhotos() {
  if (!window.Photos) return 0;
  const list = db.students.all();
  let changed = 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (!s || typeof s.photo !== 'string' || s.photo.indexOf('data:') !== 0) continue;
    const key = s.photoKey || Photos.keyFor(s);
    try {
      await Photos.set(key, s.photo);
    } catch (err) {
      console.warn('[MCA] could not move an inline photo to the photo store:', err);
      continue;
    }
    s.photoKey = key;
    s.photo = '';
    changed++;
  }
  if (changed) db.students.saveList(list);
  return changed;
}

async function initApp() {
  /* 1. Connect to the backend (js/api.js). Silently skipped when the pages
        are opened via file:// or the server is not running. */
  try {
    if (window.MCA_API) {
      const live = await MCA_API.init();
      const existing = auth.current();
      if (existing && existing.token) MCA_API.setToken(existing.token);
      if (live) await MCA_API.hydrate();
    }
  } catch (err) {
    console.warn('[MCA] backend unavailable, running on localStorage only:', err && err.message);
  }

  /* 2. Open the photo store and move any inline photographs out of the
        register so the student list stays small. */
  try {
    if (window.Photos) {
      await Photos.init();
      await migrateLegacyPhotos();
    }
  } catch (err) {
    console.warn('[MCA] photo store unavailable:', err && err.message);
  }

  /* 3. Seed demo data (no-op when the server already hydrated it). */
  Seed.ensure();
  UI.applyAppearance();

  const page = document.body.dataset.page || '';

  /* Demo session guards */
  if (page !== 'login' && !auth.current()) {
    window.location.replace('index.html');
    return;
  }
  if (page === 'login' && auth.current()) {
    window.location.replace('dashboard.html');
    return;
  }

  if (page !== 'login') {
    Chrome.render();
  } else {
    initLogin();
  }

  /* Close dropdowns on outside click / Escape */
  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown')) UI.closeDropdowns();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      UI.closeDropdowns();
      const open = document.querySelectorAll('.modal-backdrop.open');
      if (open.length) UI.modal.close(open[open.length - 1]);
    }
  });

  /* Generic modal close bindings (works for every page) */
  document.addEventListener('click', e => {
    const closer = e.target.closest('[data-modal-close]');
    if (closer) {
      UI.modal.close(closer.closest('.modal-backdrop'));
      return;
    }
    const backdrop = e.target.classList && e.target.classList.contains('modal-backdrop')
      ? e.target : null;
    if (backdrop) UI.modal.close(backdrop);
  });
}

/* Convenience globals — page scripts call toast(...) and confirm(...) directly.
   Declared here (before initApp) so every script shares them via the global scope. */
const toast = UI.toast;
const confirm = UI.confirm;

/* Public API — handy for console debugging and future API wiring */
window.MCA = {
  Utils, Store, db, auth, UI, Chrome, Seed,
  toast: UI.toast,
  modal: UI.modal,
  confirm: UI.confirm,
  exportCSV: UI.exportCSV
};

/* Readiness gate: resolves once the backend handshake + seeding are done.
   Page scripts run their init through onAppReady() so they never render
   against half-hydrated data. */
function onAppReady(fn) {
  const run = () => { try { fn(); } catch (err) { console.error('[MCA] page init failed:', err); } };
  if (window.MCA_READY && typeof window.MCA_READY.then === 'function') {
    window.MCA_READY.then(run, run);
  } else {
    run();
  }
}
window.onAppReady = onAppReady;

window.MCA_READY = initApp();
window.MCA_READY.catch(err => console.error('[MCA] init failed:', err));
