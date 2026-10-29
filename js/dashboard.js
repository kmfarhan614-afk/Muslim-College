/* ==========================================================================
   dashboard.js — statistics, charts, class overview, recent activity
   ========================================================================== */

'use strict';

(function () {

  const state = { className: '', year: '', group: '' };

  const Dashboard = {
    charts: { today: null, weekly: null },

    init() {
      Dashboard.renderStats();
      Dashboard.renderCharts();
      buildClassFilters();
      Dashboard.renderClassTable();
      Dashboard.renderActivity();

      bindClassFilters();

      /* Re-draw charts when the user switches dark/light mode */
      window.addEventListener('mca:theme-change', () => Dashboard.renderCharts());
    },

    /* ---------- Statistics ---------- */
    renderStats() {
      const registered = db.students.all();
      const students = db.students.active();
      const archived = db.students.archived();
      const stats = db.attendance.statsForDate(Utils.todayISO());
      const settings = db.settings.get();
      const session = db.sessions.active();
      const examsValue = Store.read('mca_exams', []);
      const exams = Array.isArray(examsValue) ? examsValue : [];
      const published = exams.filter(e => e && e.status === 'published').length;

      setText('statTotal', Utils.fmtNumber(registered.length));
      setText('statTotalSub', Utils.fmtNumber(students.length) + ' active · ' +
        Utils.fmtNumber(archived.length) + ' archived');

      setText('statActive', Utils.fmtNumber(students.length));
      setText('statActiveSub', registered.length
        ? Utils.pct(students.length, registered.length) + '% of the register'
        : 'No students added yet');

      setText('statArchived', Utils.fmtNumber(archived.length));
      setText('statArchivedSub', archived.length
        ? 'Restorable from the student register'
        : 'No archived students');

      setText('statSession', session ? Utils.esc(session.name) : '—');
      setText('statSessionSub', session
        ? (session.start && session.end
            ? Utils.fmtDateShort(session.start) + ' – ' + Utils.fmtDateShort(session.end)
            : 'Active academic session')
        : 'No active academic session');

      setText('statExams', Utils.fmtNumber(exams.length));
      setText('statExamsSub', exams.length
        ? Utils.fmtNumber(published) + ' published · ' +
          Utils.fmtNumber(exams.length - published) + ' in progress'
        : 'No examinations created yet');

      setText('statPresent', Utils.fmtNumber(stats.present));
      setText('statPresentSub', stats.total
        ? '<strong>' + Utils.pct(stats.present, stats.total) + '%</strong> of today’s marks'
        : 'No attendance taken yet');

      setText('statAbsent', Utils.fmtNumber(stats.absent));
      setText('statAbsentSub', stats.total
        ? '<strong>' + Utils.pct(stats.absent, stats.total) + '%</strong> of today’s marks'
        : 'No attendance taken yet');

      const rate = stats.total ? Utils.pct(stats.present, stats.total) : 0;
      setText('statRate', (stats.total ? rate : '—') + (stats.total ? '%' : ''));
      setText('statRateSub', stats.total
        ? statusWord(rate, settings.attendance.threshold)
        : 'Awaiting first submission');
    },

    /* ---------- Charts (Chart.js via CDN, CSS fallback if offline) ---------- */
    renderCharts() {
      const stats = db.attendance.statsForDate(Utils.todayISO());
      const css = getComputedStyle(document.documentElement);
      const colors = {
        present: css.getPropertyValue('--color-present').trim() || '#16a34a',
        absent: css.getPropertyValue('--color-absent').trim() || '#dc2626',
        leave: css.getPropertyValue('--color-leave').trim() || '#f59e0b',
        primary: css.getPropertyValue('--color-primary').trim() || '#1c3d5f',
        border: css.getPropertyValue('--color-border').trim() || '#e3e9f1',
        muted: css.getPropertyValue('--color-text-muted').trim() || '#64748b'
      };

      renderTodayChart(stats, colors);
      renderWeeklyChart(weeklyTrendFromData(), colors);
    },

    /* ---------- Class attendance overview ---------- */
    renderClassTable() {
      const body = document.getElementById('classTableBody');
      if (!body) return;

      const all = db.classes.all();
      const classes = all.filter(cls => {
        if (state.className && cls.name !== state.className) return false;
        if (state.year && db.classes.yearOf(cls) !== state.year) return false;
        if (state.group && db.classes.groupOf(cls) !== state.group) return false;
        return true;
      });
      const groups = db.attendance.groupedForDate(Utils.todayISO());

      if (!classes.length) {
        body.innerHTML = '<tr><td colspan="8">' +
          UI.emptyState(
            all.length ? 'No classes match these filters' : 'No classes yet',
            all.length
              ? 'Try clearing the class, academic year or study group filters.'
              : 'Create classes from the Classes page to see the overview.',
            'fa-school') +
          '</td></tr>';
        return;
      }

      const rows = [];
      classes.forEach(cls => {
        const sectionless = db.classes.isSectionless(cls);
        const sections = sectionless ? [''] : db.classes.sectionsOf(cls.name);

        sections.forEach(section => {
          const key = cls.name + '|' + section;
          const g = groups[key];
          /* Students = the enrolled register (real headcount), while
             present/absent/leave come from today's marks only. */
          const enrolled = db.classes.studentCount(cls.name);
          const marked = g ? g.students : 0;
          const present = g ? g.present : 0;
          const absent = g ? g.absent : 0;
          const leave = g ? g.leave : 0;
          const rate = marked ? Utils.pct(present, marked) : null;

          rows.push(
            '<tr>' +
              '<td class="td-main">' + Utils.esc(cls.name) + '</td>' +
              '<td>' + Utils.sectionCell(section) + '</td>' +
              '<td class="num">' + enrolled + '</td>' +
              '<td class="num">' + present + '</td>' +
              '<td class="num">' + absent + '</td>' +
              '<td class="num">' + leave + '</td>' +
              '<td>' + (rate === null
                ? '<span class="muted">—</span>'
                : rateBadge(rate)) + '</td>' +
              '<td class="text-right">' +
                '<button type="button" class="btn btn-outline btn-sm" data-view-section="' +
                  Utils.esc(key) + '">' +
                  '<i class="fa-solid fa-eye"></i> View Details</button>' +
              '</td>' +
            '</tr>'
          );
        });
      });

      body.innerHTML = rows.join('');

      body.querySelectorAll('[data-view-section]').forEach(btn => {
        btn.addEventListener('click', () => {
          const parts = btn.dataset.viewSection.split('|');
          Dashboard.openSectionModal(parts[0], parts[1] || '');
        });
      });
    },

    openSectionModal(className, section) {
      const title = document.getElementById('sectionModalTitle');
      const body = document.getElementById('sectionModalBody');
      if (!body) return;

      const records = db.attendance.forDate(Utils.todayISO())
        .filter(r => r.className === className && (r.section || '') === (section || ''));

      if (title) title.textContent = className + (section ? ' — Section ' + section : '');

      if (!records.length) {
        body.innerHTML = UI.emptyState(
          'No attendance today',
          'Attendance has not been submitted for this ' + (section ? 'section' : 'class') +
            ' on ' + Utils.fmtDate(Utils.todayISO()) + '.',
          'fa-clipboard'
        );
        UI.modal.open('sectionModal');
        return;
      }

      const studentMap = {};
      db.students.all().forEach(s => { studentMap[s.studentId] = s; });

      const summary = records.reduce((acc, rec) => {
        rec.entries.forEach(en => {
          acc[en.status]++;
          acc.total++;
        });
        return acc;
      }, { present: 0, absent: 0, leave: 0, total: 0 });

      const rows = records.map(rec =>
        '<div class="section-label">' + Utils.esc(rec.subject) + ' · submitted at ' +
          Utils.esc(Utils.fmtTime(rec.submittedAt)) + '</div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr>' +
          '<th>#</th><th>Roll No.</th><th>Student</th><th>Status</th><th>Remarks</th>' +
        '</tr></thead><tbody>' +
        rec.entries.map((en, idx) => {
          const stu = studentMap[en.studentId];
          return '<tr>' +
            '<td class="num">' + (idx + 1) + '</td>' +
            '<td class="num">' + en.rollNo + '</td>' +
            '<td class="td-main">' + Utils.esc(stu ? stu.name : en.studentId) + '</td>' +
            '<td>' + UI.statusBadge(en.status) + '</td>' +
            '<td class="muted">' + Utils.esc(en.remarks || '—') + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>'
      ).join('');

      body.innerHTML =
        '<div class="summary-grid">' +
          summaryItem('Total', summary.total, '') +
          summaryItem('Present', summary.present, 'sp-present') +
          summaryItem('Absent', summary.absent, 'sp-absent') +
          summaryItem('Leave', summary.leave, 'sp-leave') +
          summaryItem('Rate', (summary.total ? Utils.pct(summary.present, summary.total) : 0) + '%', 'sp-rate') +
        '</div>' + rows;

      UI.modal.open('sectionModal');
    },

    /* ---------- Recent activity ---------- */
    renderActivity() {
      const host = document.getElementById('activityList');
      if (!host) return;

      const records = db.attendance.forDate(Utils.todayISO())
        .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1))
        .slice(0, 8);

      if (!records.length) {
        host.innerHTML = UI.emptyState(
          'Nothing yet today',
          'Activity will appear here as soon as attendance is submitted.',
          'fa-clock'
        );
        return;
      }

      host.innerHTML = records.map(rec =>
        '<div class="activity-item">' +
          '<span class="activity-time">' + Utils.esc(Utils.fmtTime(rec.submittedAt)) + '</span>' +
          '<span class="activity-icon"><i class="fa-solid fa-clipboard-check"></i></span>' +
          '<div class="activity-body">' +
            '<div class="activity-text">' + Utils.esc(rec.className) + ' — Attendance ' +
              Utils.esc(rec.action) + '</div>' +
            '<div class="activity-sub">' + (rec.section ? 'Section ' + Utils.esc(rec.section) + ' · ' : '') +
              Utils.esc(rec.subject) + ' · ' + rec.entries.length + ' students</div>' +
          '</div>' +
        '</div>'
      ).join('');
    }
  };

  /* ---------- module helpers ---------- */

  function buildClassFilters() {
    const classFilter = document.getElementById('dashClassFilter');
    if (!classFilter) return;
    UI.optionList(classFilter, db.classes.names(), state.className, 'All classes');
    UI.optionList(document.getElementById('dashYearFilter'), ACADEMIC_YEARS, state.year, 'All years');
    UI.optionList(document.getElementById('dashGroupFilter'), STUDY_GROUPS, state.group, 'All groups');
  }

  function bindClassFilters() {
    const classFilter = document.getElementById('dashClassFilter');
    const yearFilter = document.getElementById('dashYearFilter');
    const groupFilter = document.getElementById('dashGroupFilter');
    if (classFilter) classFilter.addEventListener('change', () => {
      state.className = classFilter.value;
      Dashboard.renderClassTable();
    });
    if (yearFilter) yearFilter.addEventListener('change', () => {
      state.year = yearFilter.value;
      Dashboard.renderClassTable();
    });
    if (groupFilter) groupFilter.addEventListener('change', () => {
      state.group = groupFilter.value;
      Dashboard.renderClassTable();
    });
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }

  /* Real weekly trend: attendance rate for the last up-to-6 working days
     (Sundays skipped) that actually have saved attendance. Empty until the
     first sheet is submitted. */
  function weeklyTrendFromData() {
    const out = [];
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    const days = [];
    for (let i = 0; i < 30 && days.length < 6; i++) {
      if (cursor.getDay() !== 0) days.push(new Date(cursor));
      cursor.setDate(cursor.getDate() - 1);
    }
    days.reverse();
    days.forEach(d => {
      const st = db.attendance.statsForDate(Utils.toISO(d));
      if (st.total) {
        out.push({
          day: d.toLocaleDateString('en-US', { weekday: 'short' }),
          rate: Utils.pct(st.present, st.total)
        });
      }
    });
    return out;
  }

  function statusWord(rate, threshold) {
    if (rate >= 90) return '<strong>' + rate + '%</strong> — excellent, above 90% target';
    if (rate >= 80) return '<strong>' + rate + '%</strong> — healthy, above ' + threshold + '% threshold';
    if (rate >= Number(threshold)) return '<strong>' + rate + '%</strong> — meets ' + threshold + '% threshold';
    return '<strong>' + rate + '%</strong> — below ' + threshold + '% threshold';
  }

  function rateBadge(rate) {
    const cls = rate >= 90 ? 'badge-green' : rate >= 75 ? 'badge-blue' : 'badge-red';
    return '<span class="badge ' + cls + '">' + rate + '%</span>';
  }

  function summaryItem(label, value, cls) {
    return '<div class="summary-item ' + cls + '">' +
      '<div class="s-label">' + Utils.esc(label) + '</div>' +
      '<div class="s-value">' + Utils.esc(String(value)) + '</div>' +
    '</div>';
  }

  function renderTodayChart(stats, colors) {
    const canvas = document.getElementById('todayChart');
    if (!canvas) return;
    const wrap = canvas.closest('.chart-wrap');
    const total = stats.present + stats.absent + stats.leave;

    if (!total) {
      showFallback(wrap, canvas, [
        { label: 'Present', value: 0, color: colors.present },
        { label: 'Absent', value: 0, color: colors.absent },
        { label: 'Leave', value: 0, color: colors.leave }
      ], 'No attendance submitted yet today.');
      return;
    }

    if (!window.Chart) {
      showFallback(wrap, canvas, [
        { label: 'Present', value: stats.present, color: colors.present },
        { label: 'Absent', value: stats.absent, color: colors.absent },
        { label: 'Leave', value: stats.leave, color: colors.leave }
      ]);
      return;
    }

    restoreCanvas(wrap, canvas);
    if (Dashboard.charts.today) Dashboard.charts.today.destroy();

    try {
      Dashboard.charts.today = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Present', 'Absent', 'Leave'],
          datasets: [{
            data: [stats.present, stats.absent, stats.leave],
            backgroundColor: [colors.present, colors.absent, colors.leave],
            borderWidth: 0,
            hoverOffset: 10
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
          animation: { duration: 500 },
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 18,
                font: { family: 'Inter', size: 13, weight: '600' },
                color: colors.muted
              }
            },
            tooltip: {
              callbacks: {
                label: ctx => ' ' + ctx.label + ': ' + Utils.fmtNumber(ctx.parsed) +
                  ' (' + Utils.pct(ctx.parsed, total) + '%)'
              }
            }
          }
        }
      });
    } catch (err) {
      /* Canvas unavailable (e.g. blocked/unsupported) — degrade to CSS bars */
      console.warn('[MCA] today chart unavailable:', err.message);
      showFallback(wrap, canvas, [
        { label: 'Present', value: stats.present, color: colors.present },
        { label: 'Absent', value: stats.absent, color: colors.absent },
        { label: 'Leave', value: stats.leave, color: colors.leave }
      ]);
    }
  }

  function renderWeeklyChart(trend, colors) {
    const canvas = document.getElementById('weeklyChart');
    if (!canvas) return;
    const wrap = canvas.closest('.chart-wrap');

    if (!trend.length) {
      showFallback(wrap, canvas, [], 'No weekly data available.');
      return;
    }

    if (!window.Chart) {
      showFallback(wrap, canvas, trend.map(t => ({
        label: t.day, value: t.rate, color: colors.primary, suffix: '%'
      })));
      return;
    }

    restoreCanvas(wrap, canvas);
    if (Dashboard.charts.weekly) Dashboard.charts.weekly.destroy();

    try {
      Dashboard.charts.weekly = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: trend.map(t => t.day),
          datasets: [{
            label: 'Attendance %',
            data: trend.map(t => t.rate),
            backgroundColor: colors.primary,
            hoverBackgroundColor: colors.present,
            borderRadius: 7,
            maxBarThickness: 44
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ' ' + ctx.parsed.y + '%' } }
          },
          scales: {
            y: {
              min: 60,
              max: 100,
              ticks: {
                stepSize: 10,
                callback: v => v + '%',
                color: colors.muted,
                font: { size: 12 }
              },
              grid: { color: colors.border },
              border: { display: false }
            },
            x: {
              ticks: { color: colors.muted, font: { size: 12.5, weight: '600' } },
              grid: { display: false },
              border: { display: false }
            }
          }
        }
      });
    } catch (err) {
      /* Canvas unavailable — degrade to CSS bars */
      console.warn('[MCA] weekly chart unavailable:', err.message);
      showFallback(wrap, canvas, trend.map(t => ({
        label: t.day, value: t.rate, color: colors.primary, suffix: '%'
      })));
    }
  }

  /* CSS-based chart fallback (used when the Chart.js CDN is unreachable) */
  function showFallback(wrap, canvas, rows, emptyMessage) {
    if (!wrap) return;
    canvas.style.display = 'none';
    let fb = wrap.querySelector('.chart-fallback');
    if (!fb) {
      fb = document.createElement('div');
      fb.className = 'chart-fallback';
      wrap.appendChild(fb);
    }
    fb.style.display = 'flex';

    if (!rows.length || (emptyMessage && rows.every(r => !r.value))) {
      fb.innerHTML = '<p class="muted" style="text-align:center">' +
        Utils.esc(emptyMessage || 'No data to display.') + '</p>';
      return;
    }

    const max = Math.max.apply(null, rows.map(r => r.value)) || 1;
    fb.innerHTML = rows.map(r =>
      '<div class="fb-row">' +
        '<span class="muted">' + Utils.esc(r.label) + '</span>' +
        '<span class="fb-track"><span class="fb-fill" style="width:' +
          Math.max(4, Math.round((r.value / max) * 100)) + '%;background:' + r.color + '"></span></span>' +
        '<span class="fb-value">' + Utils.fmtNumber(r.value) + (r.suffix || '') + '</span>' +
      '</div>'
    ).join('');
  }

  function restoreCanvas(wrap, canvas) {
    if (!wrap) return;
    const fb = wrap.querySelector('.chart-fallback');
    if (fb) fb.remove();
    canvas.style.display = '';
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Dashboard.init));

  window.Dashboard = Dashboard;
})();
