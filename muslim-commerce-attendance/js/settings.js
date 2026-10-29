/* ==========================================================================
   settings.js — college info, appearance (color/theme), attendance rules
   ========================================================================== */

'use strict';

(function () {

  const SWATCHES = ['#1c3d5f', '#0f766e', '#1e40af', '#5b21b6', '#9f1239', '#b45309'];

  const Settings = {
    init() {
      populate();
      bindEvents();
      syncThemeButtons();
    }
  };

  function populate() {
    const settings = db.settings.get();

    const college = document.getElementById('collegeForm');
    if (college) {
      college.elements.collegeName.value = settings.college.name;
      college.elements.address.value = settings.college.address;
      college.elements.phone.value = settings.college.phone;
      college.elements.email.value = settings.college.email;
      college.elements.website.value = settings.college.website;
    }

    const color = document.getElementById('primaryColor');
    if (color) color.value = settings.appearance.primary || '#1c3d5f';
    syncSwatches(settings.appearance.primary);

    const att = document.getElementById('attendanceForm');
    if (att) {
      att.elements.threshold.value = settings.attendance.threshold;
      att.elements.latePolicy.value = settings.attendance.latePolicy;
      att.elements.defaultStatus.value = settings.attendance.defaultStatus;
    }

    const session = document.getElementById('sessionValue');
    if (session) session.textContent = settings.academicSession;
  }

  function bindEvents() {
    /* ----- College information ----- */
    const college = document.getElementById('collegeForm');
    if (college) {
      college.addEventListener('submit', e => {
        e.preventDefault();
        const ok = UI.validateForm(college, form => {
          const errors = [];
          if (form.elements.collegeName.value.trim().length < 3) {
            errors.push({ input: form.elements.collegeName, message: 'Enter the college name.' });
          }
          if (form.elements.email.value && !form.elements.email.checkValidity()) {
            errors.push({ input: form.elements.email, message: 'Enter a valid email address.' });
          }
          if (form.elements.phone.value && form.elements.phone.value.trim().length < 7) {
            errors.push({ input: form.elements.phone, message: 'Enter a valid phone number.' });
          }
          return errors;
        });
        if (!ok) return;

        db.settings.update({
          college: {
            name: formValue(college, 'collegeName'),
            address: formValue(college, 'address'),
            phone: formValue(college, 'phone'),
            email: formValue(college, 'email'),
            website: formValue(college, 'website')
          }
        });

        Chrome.render(); /* sidebar brand shows the updated college name */
        toast('College information saved.', 'success');
      });
    }

    /* ----- Appearance: primary color ----- */
    const color = document.getElementById('primaryColor');
    if (color) {
      color.addEventListener('change', () => {
        UI.setPrimary(color.value);
        syncSwatches(color.value);
        toast('Primary color updated.', 'success', 'Appearance');
      });
    }

    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        UI.setPrimary(sw.dataset.color);
        if (color) color.value = sw.dataset.color;
        syncSwatches(sw.dataset.color);
        toast('Primary color updated.', 'success', 'Appearance');
      });
    });

    /* ----- Appearance: light / dark ----- */
    document.querySelectorAll('[data-theme-set]').forEach(btn => {
      btn.addEventListener('click', () => {
        UI.setTheme(btn.dataset.themeSet);
        syncThemeButtons();
        toast('Switched to ' + btn.dataset.themeSet + ' mode.', 'success', 'Appearance');
      });
    });
    window.addEventListener('mca:theme-change', syncThemeButtons);

    /* ----- Attendance settings ----- */
    const att = document.getElementById('attendanceForm');
    if (att) {
      att.addEventListener('submit', e => {
        e.preventDefault();
        const ok = UI.validateForm(att, form => {
          const errors = [];
          const threshold = Number(form.elements.threshold.value);
          if (!threshold || threshold < 50 || threshold > 100) {
            errors.push({ input: form.elements.threshold, message: 'Threshold must be between 50 and 100.' });
          }
          return errors;
        });
        if (!ok) return;

        db.settings.update({
          attendance: {
            threshold: Number(att.elements.threshold.value),
            latePolicy: att.elements.latePolicy.value,
            defaultStatus: att.elements.defaultStatus.value
          }
        });
        toast('Attendance settings saved.', 'success');
      });
    }

    /* ----- Download a full JSON backup ----- */
    const backupBtn = document.getElementById('exportBackupBtn');
    if (backupBtn) {
      backupBtn.addEventListener('click', () => downloadBackup());
    }

    /* ----- Reset all data ----- */
    const resetBtn = document.getElementById('resetDataBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const ok = await confirm({
          title: 'Reset all data?',
          message: 'Every student, class, teacher, attendance, examination and mark record will be erased. The four core classes are recreated on reload; students are not restored. Download a backup first. Your signed-in session is kept.',
          confirmText: 'Reset all data',
          danger: true
        });
        if (!ok) return;

        /* Clear the server database too, otherwise the old data would be
           pulled straight back in on reload. */
        if (window.MCA_API && MCA_API.isAvailable()) {
          try { await MCA_API.reset(); }
          catch (err) { console.warn('[MCA_API] server reset failed:', err.message); }
        }

        db.settings.reset();
        toast('All data reset. Reloading…', 'success');
        setTimeout(() => window.location.reload(), 600);
      });
    }
  }

  function downloadBackup() {
    const keys = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || key.indexOf('mca_') !== 0) continue;
        /* Never export the signed-in session/token. */
        if (key === 'mca_session' || key === 'mca_session_temp') continue;
        const raw = localStorage.getItem(key);
        try { keys[key] = JSON.parse(raw); }
        catch (err) { keys[key] = raw; }
      }
    } catch (err) {
      toast('Could not read browser storage for the backup.', 'error');
      return;
    }

    const payload = {
      app: 'Muslim Commerce College Attendance',
      format: 1,
      exportedAt: new Date().toISOString(),
      note: 'Photographs are stored in IndexedDB and are not included in this JSON backup.',
      keys: keys
    };
    const stamp = Utils.todayISO() + '-' + new Date().toTimeString().slice(0, 5).replace(':', '-');
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mca-backup-' + stamp + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    toast('Backup downloaded (' + Utils.fmtNumber(Object.keys(keys).length) + ' data sets).', 'success', 'Backup');
  }

  function formValue(form, name) {
    return form.elements[name].value.trim();
  }

  function syncSwatches(activeColor) {
    document.querySelectorAll('.color-swatch').forEach(sw => {
      sw.classList.toggle('active', sw.dataset.color.toLowerCase() === String(activeColor || '').toLowerCase());
    });
  }

  function syncThemeButtons() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('[data-theme-set]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeSet === (isDark ? 'dark' : 'light'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Settings.init));

  window.SettingsPage = Settings;
})();
