'use strict';

(function () {
  const SESSION_KEY = 'mca_teacher_session';
  const BASE = 'api/';

  function el(id) { return document.getElementById(id); }

  function readSession() {
    for (const store of [localStorage, sessionStorage]) {
      try {
        const raw = store.getItem(SESSION_KEY);
        if (raw) {
          const session = JSON.parse(raw);
          if (session && session.token) return session;
        }
      } catch (err) { /* ignore */ }
    }
    return null;
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
    try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* ignore */ }
  }

  function showError(message) {
    const box = el('tpLoginError');
    const text = el('tpLoginErrorText');
    if (!box || !text) return;
    text.textContent = message;
    box.hidden = false;
  }

  function clearError() {
    const box = el('tpLoginError');
    if (box) box.hidden = true;
  }

  function setBusy(busy) {
    const btn = el('tpLoginBtn');
    if (!btn) return;
    btn.classList.toggle('is-loading', !!busy);
    btn.disabled = !!busy;
    btn.innerHTML = busy
      ? '<i class="fa-solid fa-circle-notch fa-spin"></i> Signing in...'
      : '<i class="fa-solid fa-arrow-right-to-bracket"></i> Sign in to Teacher Portal';
  }

  function apiMessage(status, message) {
    if (status === 404) {
      return 'The Teacher Portal API was not found. Start the bundled backend with "node server.js" and open http://127.0.0.1:3000.';
    }
    if (status === 401) return message || 'Invalid portal number or password.';
    if (status === 403) return message || 'This teacher account is disabled or restricted.';
    if (status === 429) return message || 'Too many failed attempts. Try again in 15 minutes.';
    if (status >= 500) return 'The Teacher Portal service could not complete the request. Try again.';
    return message || 'Could not complete the request.';
  }

  async function api(route, options) {
    const opts = options || {};
    const headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
    let res;
    try {
      res = await fetch(BASE + route, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (err) {
      const error = new Error('Cannot reach the Teacher Portal service. Start server.js and try again.');
      error.status = 0;
      throw error;
    }
    let data = null;
    try { data = await res.json(); } catch (err) { /* ignore */ }
    if (!res.ok) {
      const error = new Error(apiMessage(res.status, data && data.message));
      error.status = res.status;
      error.route = route;
      throw error;
    }
    return data;
  }

  async function checkExisting() {
    const session = readSession();
    if (!session || !session.token) return;
    if (session.expiresAt && session.expiresAt < Date.now()) {
      clearSession();
      return;
    }
    try {
      await api('teacher/me', { token: session.token });
      window.location.replace('teacher-dashboard.html');
    } catch (err) {
      clearSession();
    }
  }

  function saveSession(session, remember) {
    clearSession();
    const store = remember ? localStorage : sessionStorage;
    try { store.setItem(SESSION_KEY, JSON.stringify(session)); } catch (err) { /* ignore */ }
  }

  async function submit(e) {
    e.preventDefault();
    clearError();
    const identifier = el('tpIdentifier').value.trim();
    const password = el('tpPassword').value;
    if (!identifier) return showError('Enter your portal number.');
    if (!password) return showError('Enter your password.');
    setBusy(true);
    try {
      const data = await api('teacher/auth/login', {
        method: 'POST',
        body: { identifier: identifier, password: password }
      });
      saveSession({
        token: data.token,
        expiresAt: data.expiresAt,
        teacher: data.teacher,
        mustChangePassword: data.mustChangePassword
      }, !!el('tpRemember').checked);
      window.location.replace('teacher-dashboard.html');
    } catch (err) {
      showError(err.message || 'Could not sign in. Check the server and try again.');
      setBusy(false);
    }
  }

  function bind() {
    el('teacherLoginForm').addEventListener('submit', submit);
    el('tpTogglePassword').addEventListener('click', () => {
      const input = el('tpPassword');
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      const icon = el('tpTogglePassword').querySelector('i');
      if (icon) icon.className = showing ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
    });
    el('tpForgot').addEventListener('click', () => {
      el('tpForgotIdentifier').value = el('tpIdentifier').value.trim();
      el('tpForgotStatus').hidden = true;
      el('tpForgotModal').classList.add('open');
    });
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const backdrop = btn.closest('.modal-backdrop');
        if (backdrop) backdrop.classList.remove('open');
      });
    });
    el('tpForgotModal').addEventListener('click', e => {
      if (e.target === el('tpForgotModal')) el('tpForgotModal').classList.remove('open');
    });
    el('tpForgotSend').addEventListener('click', async () => {
      const identifier = el('tpForgotIdentifier').value.trim();
      const status = el('tpForgotStatus');
      if (!identifier) {
        status.hidden = false;
        status.textContent = 'Enter your portal number.';
        return;
      }
      try {
        const data = await api('teacher/auth/forgot', {
          method: 'POST', body: { identifier: identifier }
        });
        status.hidden = false;
        status.textContent = data.message || 'Your request has been recorded.';
        el('tpForgotSend').disabled = true;
        el('tpForgotSend').textContent = 'Request sent';
      } catch (err) {
        status.hidden = false;
        status.textContent = err.message || 'Could not send the request.';
      }
    });
  }

  checkExisting();
  bind();
})();
