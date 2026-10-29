/* ==========================================================================
   MCA_API — browser client for the Attendance System backend.

   Loaded before js/app.js on every page. Behaviour:
     - Probes GET api/health once; if the backend is not reachable (e.g. the
       pages were opened directly from disk via file://) every method becomes
       a silent no-op and the app runs 100% on localStorage as before.
     - hydrate(): pulls server state into localStorage (server = source of
       truth while online) before the app seeds/renders.
     - push(): write-through sync — app.js Store.write() calls this for every
       mutation; allowlisted keys are PUT to the server.
     - login()/logout()/reset(): thin wrappers around the auth + reset routes.

   Exposed as window.MCA_API.
   ========================================================================== */

'use strict';

(function () {
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

  const BASE = 'api/';
  let available = false;
  let token = null;
  let warnedAuth = false;

  const pending = {};      /* key -> latest value waiting to be flushed */
  let flushTimer = null;
  let inflight = false;

  /* The register as the server last confirmed it. Every change is sent as a
     delta against this snapshot, so a single edit never ships thousands of
     records again. */
  let studentSnapshot = null;
  let studentsVersion = 0;

  function hasFetch() {
    return typeof window.fetch === 'function';
  }

  function routeError(route, status, message) {
    if (status === 404) {
      return 'API route "' + BASE + route + '" was not found. Start the bundled backend with "node server.js".';
    }
    if (status >= 500) return message || 'The server could not complete the request. Check the server logs.';
    return message || ('Request failed (HTTP ' + status + ') for ' + BASE + route + '.');
  }

  async function request(route, options) {
    const opts = options || {};
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(BASE + route, Object.assign({}, opts, { headers: headers }));
    } catch (err) {
      const error = new Error('Cannot reach the server at ' + BASE + route + '. Start server.js and try again.');
      error.status = 0;
      error.route = route;
      throw error;
    }
    let data = null;
    try { data = await res.json(); } catch (err) { /* non-JSON response */ }
    if (!res.ok) {
      const error = new Error(routeError(route, res.status, data && data.message));
      error.status = res.status;
      error.route = route;
      throw error;
    }
    return data;
  }

  async function init() {
    if (!hasFetch()) { available = false; return false; }

    /* Relative URL: works for http://localhost:3000/ and any sub-path.
       file:// pages fail fast here and fall back to localStorage. */
    try {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 1500) : null;
      const res = await fetch(BASE + 'health', controller ? { signal: controller.signal } : {});
      if (timer) clearTimeout(timer);
      const data = await res.json();
      available = !!(data && data.ok);
    } catch (err) {
      available = false;
    }
    return available;
  }

  async function hydrate() {
    if (!available) return false;
    /* Reads require a Bearer token. A signed-out visitor never hydrates the
       private register. */
    if (!token) return false;
    try {
      const data = await request('state');
      if (!data || !data.keys) return false;
      let applied = 0;
      STATE_KEYS.forEach(key => {
        if (data.keys[key] !== undefined) {
          /* Write localStorage directly (not via Store) so hydration itself
             is never pushed back to the server. */
          try { localStorage.setItem(key, JSON.stringify(data.keys[key])); applied++; }
          catch (err) { console.warn('[MCA_API] hydrate write failed for', key, err); }
        }
      });
      /* Remember the confirmed register so the next change can be a delta. */
      if (Array.isArray(data.keys.mca_students)) {
        studentSnapshot = data.keys.mca_students.map(s => Object.assign({}, s));
      }
      if (data.meta && data.meta.mca_students) {
        studentsVersion = Number(data.meta.mca_students.version) || 0;
      }
      if (applied) console.info('[MCA_API] hydrated ' + applied + ' key(s) from server');
      return applied > 0;
    } catch (err) {
      console.warn('[MCA_API] hydrate failed:', err.message);
      return false;
    }
  }

  /* ---------- write-through sync (called from Store.write) ---------- */

  function push(key, value) {
    if (!available || STATE_KEYS.indexOf(key) === -1) return;
    pending[key] = value;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 250);
  }

  /* Works out what changed in the register since the last confirmed sync. */
  function studentDelta(next) {
    const list = Array.isArray(next) ? next : [];
    const previous = Array.isArray(studentSnapshot) ? studentSnapshot : null;
    const upserts = [];
    const removes = [];

    if (!previous) {
      /* No snapshot yet — the whole register is the delta. */
      list.forEach(s => upserts.push(s));
      return { upserts: upserts, removes: removes, full: true };
    }

    const before = new Map();
    previous.forEach(s => { if (s && s.id) before.set(s.id, s); });

    const seen = new Set();
    list.forEach(s => {
      if (!s || !s.id) return;
      seen.add(s.id);
      const old = before.get(s.id);
      if (!old) { upserts.push(s); return; }
      if (JSON.stringify(old) !== JSON.stringify(s)) upserts.push(s);
    });

    before.forEach((old, id) => {
      if (!seen.has(id)) removes.push(id);
    });

    return { upserts: upserts, removes: removes, full: false };
  }

  async function flush() {
    if (inflight) { flushTimer = setTimeout(flush, 250); return; }
    inflight = true;
    /* One atomic batch PUT for every pending key. This matters on first boot:
       the seed writes several keys at once and they must share a single
       "database still empty → bootstrap allowed" window on the server. */
    const snapshot = Object.assign({}, pending);
    Object.keys(snapshot).forEach(k => delete pending[k]);

    const register = snapshot.mca_students;
    const others = Object.assign({}, snapshot);
    delete others.mca_students;

    try {
      if (Object.keys(others).length) {
        await request('state', {
          method: 'PUT',
          body: JSON.stringify({ keys: others })
        });
      }
    } catch (err) {
      reportSyncError(err);
    }

    if (register !== undefined) {
      await pushStudents(register);
    }

    inflight = false;
    if (Object.keys(pending).length) flushTimer = setTimeout(flush, 250);
  }

  function reportSyncError(err) {
    if (err.status === 401) {
      if (!warnedAuth) {
        warnedAuth = true;
        console.warn('[MCA_API] server rejected a write (sign-in required) — change kept locally only.');
      }
    } else {
      console.warn('[MCA_API] push failed:', err.message);
    }
    /* Values are already in localStorage; the next mutation of any of
       these keys re-queues it. */
  }

  /* Sends the register as a delta. Falls back to a full replace when the
     server cannot apply the delta (for example after a server reset). */
  async function pushStudents(list) {
    const delta = studentDelta(list);
    try {
      const data = await request('students/delta', {
        method: 'PUT',
        body: JSON.stringify({
          upserts: delta.upserts,
          removes: delta.removes,
          baseVersion: studentsVersion
        })
      });
      if (data && data.rejected) {
        console.warn('[MCA_API] ' + data.rejected + ' student record(s) rejected by the server — sending the whole register instead.');
        await replaceStudents(list);
        return;
      }
      if (data && data.version) studentsVersion = data.version;
      studentSnapshot = (Array.isArray(list) ? list : []).map(s => Object.assign({}, s));
    } catch (err) {
      if (err.status === 401) { reportSyncError(err); return; }
      console.warn('[MCA_API] delta sync failed, sending the whole register instead:', err.message);
      await replaceStudents(list);
    }
  }

  /* Replaces the whole register on the server — the fallback when a delta
     cannot be applied (a reset server, or a record the server rejected). */
  async function replaceStudents(list) {
    try {
      const data = await request('students', {
        method: 'PUT',
        body: JSON.stringify({ students: Array.isArray(list) ? list : [] })
      });
      if (data && data.version) studentsVersion = data.version;
      studentSnapshot = (Array.isArray(list) ? list : []).map(s => Object.assign({}, s));
    } catch (err2) {
      reportSyncError(err2);
    }
  }

  /* ---------- auth / admin ---------- */

  async function login(email, password) {
    const data = await request('auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: email, password: password })
    });
    token = data.token;
    warnedAuth = false;
    return data; /* { ok, token, expiresAt, user } */
  }

  async function logout() {
    try { await request('auth/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
    token = null;
    warnedAuth = false;
  }

  async function reset() {
    /* Flush nothing — wipe local queue and the server database. */
    Object.keys(pending).forEach(k => delete pending[k]);
    const data = await request('reset', { method: 'POST' });
    return data;
  }

  function setToken(value) {
    token = value || null;
    if (token) warnedAuth = false;
  }

  function getToken() { return token; }
  function isAvailable() { return available; }

  /* ---------- Supabase permanent storage (optional, server-proxied) ----------
     These methods talk to server.js, which owns the Supabase credentials. When
     Supabase is not configured they resolve to "unavailable" so callers can
     fall back to the local dataset. */

  let sbStatus = null; /* cached /api/supabase/status result */

  async function supabaseStatus(force) {
    if (!available) return { available: false, configured: false, reachable: false };
    if (sbStatus && !force) return sbStatus;
    try {
      const data = await request('supabase/status');
      sbStatus = Object.assign({ available: true }, data);
    } catch (err) {
      sbStatus = { available: true, configured: false, reachable: false, error: err.message };
    }
    return sbStatus;
  }

  async function supabaseReady(force) {
    const s = await supabaseStatus(force);
    return !!(s && s.configured && s.reachable);
  }

  function qs(params) {
    const src = params || {};
    return Object.keys(src)
      .filter(k => src[k] !== undefined && src[k] !== null && src[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(src[k]))
      .join('&');
  }

  const sessions = {
    async list() {
      const data = await request('academic-sessions');
      return (data && data.sessions) || [];
    },
    async create(session) {
      const data = await request('academic-sessions', { method: 'POST', body: JSON.stringify(session) });
      return data && data.session;
    },
    async activate(id) {
      const data = await request('academic-sessions/' + encodeURIComponent(id) + '/activate', { method: 'POST' });
      return data && data.session;
    },
    async remove(id) {
      await request('academic-sessions/' + encodeURIComponent(id), { method: 'DELETE' });
    }
  };

  const attendance = {
    async query(params) {
      const query = qs(params);
      return request('attendance' + (query ? '?' + query : ''));
    },
    async save(payload) {
      return request('attendance', { method: 'POST', body: JSON.stringify(payload) });
    },
    async remove(id) {
      return request('attendance/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async retention(policy) {
      return request('attendance/retention', { method: 'POST', body: JSON.stringify(policy) });
    }
  };

  /* Student register API — paged reads and single-record writes. The browser
     keeps its own copy for speed; these calls are for the pages that need
     the server's view (another device, a fresh browser, an export). */
  const students = {
    async list(params) {
      const query = qs(params);
      return request('students' + (query ? '?' + query : ''));
    },
    async get(id) {
      return request('students/' + encodeURIComponent(id));
    },
    async create(record) {
      return request('students', { method: 'POST', body: JSON.stringify(record) });
    },
    async update(id, patch) {
      return request('students/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify(patch)
      });
    },
    async archive(id) {
      return request('students/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async restore(id) {
      return request('students/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
    },
    async bulk(records) {
      return request('students/bulk', { method: 'POST', body: JSON.stringify({ students: records }) });
    },
    async delta(upserts, removes) {
      return request('students/delta', {
        method: 'PUT',
        body: JSON.stringify({ upserts: upserts, removes: removes, baseVersion: studentsVersion })
      });
    },
    async exportCsv(params) {
      const query = qs(Object.assign({ format: 'csv' }, params || {}));
      const res = await fetch(BASE + 'students/export' + (query ? '?' + query : ''), {
        headers: token ? { 'Authorization': 'Bearer ' + token } : {}
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    },
    async storage() {
      return request('storage');
    },
    get version() { return studentsVersion; }
  };

  const admin = {
    async stats() {
      return request('admin/stats');
    },
    async meta() {
      return request('admin/meta');
    },
    async teachers(params) {
      const query = qs(params || {});
      return request('admin/teachers' + (query ? '?' + query : ''));
    },
    async teacher(id) {
      return request('admin/teachers/' + encodeURIComponent(id));
    },
    async createTeacher(payload) {
      return request('admin/teachers', { method: 'POST', body: JSON.stringify(payload) });
    },
    async updateTeacher(id, payload) {
      return request('admin/teachers/' + encodeURIComponent(id), {
        method: 'PUT', body: JSON.stringify(payload)
      });
    },
    async changePortal(id, portalNumber, reason) {
      return request('admin/teachers/' + encodeURIComponent(id) + '/portal-number', {
        method: 'PUT', body: JSON.stringify({ portalNumber: portalNumber, reason: reason })
      });
    },
    async resetPassword(id, method) {
      return request('admin/teachers/' + encodeURIComponent(id) + '/reset-password', {
        method: 'POST', body: JSON.stringify({ method: method || 'temporary' })
      });
    },
    async teacherAudit(id) {
      return request('admin/teachers/' + encodeURIComponent(id) + '/audit');
    },
    async audit(limit) {
      return request('admin/audit?limit=' + encodeURIComponent(limit || 100));
    },
    async submissions(limit) {
      return request('admin/attendance/submissions?limit=' + encodeURIComponent(limit || 50));
    },
    async logEvent(action, details, target) {
      return request('admin/audit/event', {
        method: 'POST', body: JSON.stringify({ action: action, details: details, target: target })
      });
    }
  };


  async function sync(model) {
    return request('sync', { method: 'POST', body: JSON.stringify(model) });
  }

  window.MCA_API = {
    STATE_KEYS: STATE_KEYS,
    init: init,
    hydrate: hydrate,
    push: push,
    flush: flush,
    login: login,
    logout: logout,
    reset: reset,
    setToken: setToken,
    getToken: getToken,
    supabaseStatus: supabaseStatus,
    supabaseReady: supabaseReady,
    sync: sync,
    sessions: sessions,
    attendance: attendance,
    students: students,
    admin: admin,
    get available() { return available; },
    isAvailable: isAvailable
  };
})();
