/* ==========================================================================
   reports.js — attendance reports, filtering, print, CSV export
   ========================================================================== */

'use strict';

(function () {

  const filters = { from: '', to: '', className: '', year: '', group: '', section: '', subject: '' };
  let currentRows = [];

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  const Reports = {
    init() {
      const params = new URLSearchParams(window.location.search);
      const today = Utils.todayISO();
      const fromDefault = params.get('from') || dateMinusDays(14);

      filters.from = fromDefault;
      filters.to = params.get('to') || today;

      document.getElementById('repFrom').value = filters.from;
      document.getElementById('repTo').value = filters.to;
      document.getElementById('repFrom').max = today;
      document.getElementById('repTo').max = today;

      UI.optionList(document.getElementById('repClass'), db.classes.names(), '', 'All classes');
      UI.optionList(document.getElementById('repYear'), ACADEMIC_YEARS, '', 'All years');
      UI.optionList(document.getElementById('repGroup'), STUDY_GROUPS, '', 'All groups');
      rebuildSectionSubject();

      bindEvents();
      Reports.render();
    },

    readFilters() {
      filters.from = document.getElementById('repFrom').value;
      filters.to = document.getElementById('repTo').value;
      filters.className = document.getElementById('repClass').value;
      filters.year = document.getElementById('repYear').value;
      filters.group = document.getElementById('repGroup').value;
      filters.section = document.getElementById('repSection').disabled ? '' : document.getElementById('repSection').value;
      filters.subject = document.getElementById('repSubject').value;
    },

    render() {
      Reports.readFilters();

      if (filters.from && filters.to && filters.from > filters.to) {
        toast('The "Date From" must be on or before "Date To".', 'error', 'Invalid range');
        return;
      }

      const records = db.attendance.query(filters);
      currentRows = records;

      const totals = records.reduce((acc, rec) => {
        rec.entries.forEach(e => { acc[e.status]++; acc.marks++; });
        acc.days[rec.date] = true;
        return acc;
      }, { present: 0, absent: 0, leave: 0, marks: 0, days: {} });

      const dayCount = Object.keys(totals.days).length;
      const rate = totals.marks ? Utils.pct(totals.present, totals.marks) : 0;
      const scope = scopeStudents();

      setText('repTotalStudents', Utils.fmtNumber(scope));
      setText('repTotalStudentsSub', filters.className
        ? (filters.section ? filters.className + ' · Section ' + filters.section : filters.className)
        : 'All classes');

      setText('repPresent', Utils.fmtNumber(totals.present));
      setText('repPresentSub', totals.marks ? Utils.pct(totals.present, totals.marks) + '% of marks' : 'No marks in range');

      setText('repAbsent', Utils.fmtNumber(totals.absent));
      setText('repAbsentSub', totals.marks ? Utils.pct(totals.absent, totals.marks) + '% of marks' : 'No marks in range');

      setText('repLeave', Utils.fmtNumber(totals.leave));
      setText('repLeaveSub', totals.marks ? Utils.pct(totals.leave, totals.marks) + '% of marks' : 'No marks in range');

      setText('repAvg', totals.marks ? rate + '%' : '—');
      setText('repAvgSub', dayCount ? 'Across ' + dayCount + ' school day' + (dayCount > 1 ? 's' : '') : 'No days in range');

      renderTable(records, totals);
      renderPrintSummary(records.length, dayCount);
    },

    exportCSV() {
      if (!currentRows.length) {
        toast('There is no report data to export.', 'warning', 'Nothing to export');
        return;
      }

      const rows = [];
      rows.push(['Muslim Commerce College Peshawar', 'Attendance Report']);
      rows.push(['Period', (filters.from || 'Any') + ' to ' + (filters.to || 'Any')]);
      rows.push(['Class', filters.className || 'All']);
      rows.push(['Academic Year', filters.year || 'All']);
      rows.push(['Study Group', filters.group || 'All']);
      rows.push(['Section', filters.section || 'All']);
      rows.push(['Subject', filters.subject || 'All']);
      rows.push(['Generated', Utils.fmtDate(Utils.todayISO())]);
      rows.push([]);
      rows.push(['Date', 'Class', 'Section', 'Subject', 'Students', 'Present', 'Absent', 'Leave', 'Attendance %']);

      const sums = { present: 0, absent: 0, leave: 0, students: 0 };
      currentRows.forEach(rec => {
        const s = countStatuses(rec);
        sums.present += s.present;
        sums.absent += s.absent;
        sums.leave += s.leave;
        sums.students += rec.entries.length;
        rows.push([
          rec.date, rec.className, rec.section, rec.subject,
          rec.entries.length, s.present, s.absent, s.leave,
          Utils.pct(s.present, rec.entries.length)
        ]);
      });

      const totalMarks = sums.present + sums.absent + sums.leave;
      rows.push([
        'TOTAL', '', '', '', sums.students, sums.present, sums.absent, sums.leave,
        totalMarks ? Utils.pct(sums.present, totalMarks) : 0
      ]);

      UI.exportCSV('attendance-report-' + Utils.todayISO() + '.csv', rows);
      toast('Report exported as CSV.', 'success');
    },

    print() {
      if (!currentRows.length) {
        toast('There is no report data to print.', 'warning', 'Nothing to print');
        return;
      }
      window.print();
    },

    /* ---------- monthly attendance register (Feature 4) ---------- */
    openMonthlyPrint() {
      const names = db.classes.names();
      if (!names.length) {
        toast('No classes are available to print.', 'warning');
        return;
      }

      const now = new Date();
      const classSel = document.getElementById('mpClass');
      const monthSel = document.getElementById('mpMonth');
      const yearSel = document.getElementById('mpYear');

      UI.optionList(classSel, names, filters.className || names[0], null);
      UI.optionList(monthSel, MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
        String(now.getMonth() + 1), null);

      const years = [];
      for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 4; y--) years.push(String(y));
      UI.optionList(yearSel, years, String(now.getFullYear()), null);

      rebuildMonthlySections();
      UI.modal.open('monthlyPrintModal');
    },

    printMonthly() {
      const className = document.getElementById('mpClass').value;
      if (!className) {
        toast('Select a class to print.', 'warning');
        return;
      }
      const sectionless = db.classes.isSectionless(className);
      const section = sectionless ? '' : document.getElementById('mpSection').value;
      const month = Number(document.getElementById('mpMonth').value);
      const year = Number(document.getElementById('mpYear').value);

      if (!db.students.active().some(s => s.class === className && (!section || s.section === section))) {
        toast('There are no active students in this class to print.', 'warning', 'Nothing to print');
        return;
      }

      UI.modal.close('monthlyPrintModal');
      Print.monthlyAttendance({ className: className, section: section, month: month, year: year });
    }
  };

  /* ---------- helpers ---------- */

  function dateMinusDays(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return Utils.toISO(d);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function countStatuses(rec) {
    const s = { present: 0, absent: 0, leave: 0 };
    rec.entries.forEach(e => { s[e.status]++; });
    return s;
  }

  function scopeStudents() {
    if (filters.className) {
      return db.students.byClassSection(filters.className, filters.section).length;
    }
    return db.students.active().filter(s => {
      if (!filters.year && !filters.group) return true;
      const cls = db.classes.find(s.class);
      if (filters.year && db.classes.yearOf(cls) !== filters.year) return false;
      if (filters.group && db.classes.groupOf(cls) !== filters.group) return false;
      return true;
    }).length;
  }

  function rebuildSectionSubject() {
    const classSelect = document.getElementById('repClass');
    const sectionSelect = document.getElementById('repSection');
    const sectionGroup = document.getElementById('repSectionGroup');
    const subjectSelect = document.getElementById('repSubject');
    const sectionless = !!classSelect.value && db.classes.isSectionless(classSelect.value);

    if (sectionGroup) sectionGroup.hidden = sectionless;
    sectionSelect.disabled = sectionless;

    if (sectionless) {
      UI.optionList(sectionSelect, [], '', 'No section');
      sectionSelect.value = '';
    } else {
      const sections = db.classes.sectionsOf(classSelect.value);
      UI.optionList(sectionSelect, sections, sectionSelect.value || '', 'All sections');
    }

    const subjects = db.classes.subjectsOf(classSelect.value);
    UI.optionList(subjectSelect, subjects, subjectSelect.value || '', 'All subjects');
  }

  /* Section selector for the monthly-print modal (hidden for section-less classes) */
  function rebuildMonthlySections() {
    const classSel = document.getElementById('mpClass');
    const sectionSel = document.getElementById('mpSection');
    const group = document.getElementById('mpSectionGroup');
    if (!classSel || !sectionSel) return;
    const sectionless = db.classes.isSectionless(classSel.value);
    if (group) group.hidden = sectionless;
    sectionSel.disabled = sectionless;
    if (sectionless) {
      UI.optionList(sectionSel, [], '', 'No section');
      sectionSel.value = '';
    } else {
      UI.optionList(sectionSel, db.classes.sectionsOf(classSel.value), '', 'All sections');
    }
  }

  function renderTable(records, totals) {    const body = document.getElementById('reportTableBody');
    if (!body) return;

    if (!records.length) {
      body.innerHTML = '<tr><td colspan="9">' + UI.emptyState(
        'No attendance in this range',
        'Try widening the date range or clearing the class/section/subject filters.',
        'fa-chart-column') + '</td></tr>';
      const foot = document.getElementById('reportTotals');
      if (foot) foot.innerHTML = '';
      return;
    }

    body.innerHTML = records.map(rec => {
      const s = countStatuses(rec);
      const total = rec.entries.length;
      const rate = Utils.pct(s.present, total);
      return '<tr>' +
        '<td class="nowrap">' + Utils.esc(Utils.fmtDateShort(rec.date)) + '</td>' +
        '<td class="td-main">' + Utils.esc(rec.className) + '</td>' +
        '<td>' + Utils.sectionCell(rec.section) + '</td>' +
        '<td>' + Utils.esc(rec.subject) + '</td>' +
        '<td class="num">' + total + '</td>' +
        '<td class="num">' + s.present + '</td>' +
        '<td class="num">' + s.absent + '</td>' +
        '<td class="num">' + s.leave + '</td>' +
        '<td><span class="badge ' + (rate >= 90 ? 'badge-green' : rate >= 75 ? 'badge-blue' : 'badge-red') +
          '">' + rate + '%</span></td>' +
      '</tr>';
    }).join('');

    const foot = document.getElementById('reportTotals');
    if (foot) {
      const marks = totals.present + totals.absent + totals.leave;
      foot.innerHTML = '<tr class="tfoot-row">' +
        '<td colspan="4">Totals — ' + records.length + ' record' + (records.length > 1 ? 's' : '') + '</td>' +
        '<td class="num">' + (totals.present + totals.absent + totals.leave) + '</td>' +
        '<td class="num">' + totals.present + '</td>' +
        '<td class="num">' + totals.absent + '</td>' +
        '<td class="num">' + totals.leave + '</td>' +
        '<td class="num">' + (marks ? Utils.pct(totals.present, marks) + '%' : '—') + '</td>' +
      '</tr>';
    }
  }

  function renderPrintSummary(recordCount, dayCount) {
    const el = document.getElementById('reportFilterSummary');
    if (!el) return;
    el.textContent =
      'Period: ' + (filters.from ? Utils.fmtDate(filters.from) : 'Any') + ' to ' +
      (filters.to ? Utils.fmtDate(filters.to) : 'Any') +
      ' · Class: ' + (filters.className || 'All') +
      ' · Academic Year: ' + (filters.year || 'All') +
      ' · Study Group: ' + (filters.group || 'All') +
      ' · Section: ' + (filters.section || (filters.className && db.classes.isSectionless(filters.className) ? 'None' : 'All')) +
      ' · Subject: ' + (filters.subject || 'All') +
      ' · Records: ' + recordCount + ' · School days: ' + dayCount +
      ' · Printed: ' + Utils.fmtDate(Utils.todayISO());
  }

  function bindEvents() {
    const applyBtn = document.getElementById('applyFiltersBtn');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        const from = document.getElementById('repFrom').value;
        const to = document.getElementById('repTo').value;
        if (from && to && from > to) {
          toast('The "Date From" must be on or before "Date To".', 'error', 'Invalid range');
          return;
        }
        applyBtn.classList.add('is-loading');
        await new Promise(resolve => setTimeout(resolve, 250));
        applyBtn.classList.remove('is-loading');
        Reports.render();
      });
    }

    const resetBtn = document.getElementById('resetFiltersBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        document.getElementById('repFrom').value = dateMinusDays(14);
        document.getElementById('repTo').value = Utils.todayISO();
        document.getElementById('repClass').value = '';
        document.getElementById('repYear').value = '';
        document.getElementById('repGroup').value = '';
        rebuildSectionSubject();
        Reports.render();
        toast('Filters reset.', 'info');
      });
    }

    const classSelect = document.getElementById('repClass');
    if (classSelect) {
      classSelect.addEventListener('change', () => {
        rebuildSectionSubject();
        Reports.render();
      });
    }

    ['repFrom', 'repTo', 'repYear', 'repGroup', 'repSection', 'repSubject'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => Reports.render());
    });

    const printBtn = document.getElementById('printBtn');
    if (printBtn) printBtn.addEventListener('click', () => Reports.print());

    const monthlyBtn = document.getElementById('monthlyPrintBtn');
    if (monthlyBtn) monthlyBtn.addEventListener('click', () => Reports.openMonthlyPrint());

    const monthlyConfirm = document.getElementById('monthlyPrintConfirmBtn');
    if (monthlyConfirm) monthlyConfirm.addEventListener('click', () => Reports.printMonthly());

    const mpClass = document.getElementById('mpClass');
    if (mpClass) mpClass.addEventListener('change', rebuildMonthlySections);

    const csvBtn = document.getElementById('exportCsvBtn');
    if (csvBtn) csvBtn.addEventListener('click', () => Reports.exportCSV());
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Reports.init));

  window.Reports = Reports;
})();
