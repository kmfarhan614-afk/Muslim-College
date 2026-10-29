/* ==========================================================================
   MCA Planner — Yearly Academic Planner 2026–2027

   Colour planner: each date is tinted with its activity's colour (matching the
   college's printed planner) and rendered from a data table derived from the
   college's yearly planner. Loaded only on planner.html.

   Colours live in css/planner.css as --planner-* custom properties; this file
   only maps codes/categories to the matching .sw-* swatch class.

   Everything the administrator edits (holiday/event dates + confirmation,
   monthly lecture totals, coverage, remarks, collapsed state) is persisted
   locally under the 'mca_planner' key through the shared Store wrapper.

   IMPORTANT: exact per-day dates that could not be read from the source are
   left unset and flagged "Needs verification" rather than invented.

   Exposed as window.Planner.
   ========================================================================== */

'use strict';

(function () {
  const STORE_KEY = 'mca_planner';

  const SESSION = {
    id: '2026-2027',
    label: '2026\u20132027',
    start: '2026-09-01',
    end: '2027-04-30',
    programs: ['D.Com', 'DBA', 'F.Sc']
  };

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* Per-code swatch class (defined in css/planner.css). Falls back by type. */
  const EXAM_CODES = ['MT', 'FT', 'MID', 'PB'];
  const SW_MAP = {
    RC: 'sw-rc', '2YC': 'sw-rc', '1YC': 'sw-rc', REV: 'sw-rc',
    MCQ: 'sw-mcq',
    WP: 'sw-wp', ODT: 'sw-odt', DC: 'sw-dc', PTM: 'sw-ptm',
    NC: 'sw-nc', GS: 'sw-gs', FG: 'sw-fg',
    WS: 'sw-activity',
    ID: 'sw-holiday', KD: 'sw-holiday', IQ: 'sw-holiday', QA: 'sw-holiday',
    PD: 'sw-holiday', EID: 'sw-holiday', WV: 'sw-holiday',
    SUN: 'sw-sunday'
  };

  function swClass(code, type) {
    if (SW_MAP[code]) return SW_MAP[code];
    if (EXAM_CODES.indexOf(code) > -1) return 'sw-exam';
    if (type === 'exam') return 'sw-exam';
    if (type === 'holiday') return 'sw-holiday';
    if (type === 'class') return 'sw-rc';
    return 'sw-activity';
  }

  /* Colour precedence for a cell that carries more than one activity. */
  const TYPE_PRIORITY = { exam: 4, holiday: 3, activity: 2, class: 1 };
  function priority(item) {
    if (item.code === 'SUN') return 0;
    return TYPE_PRIORITY[item.type] || 0;
  }

  function ev(id, code, title, type, date, endDate, verified, note) {
    return {
      id: id, code: code, title: title, type: type,
      date: date || null, endDate: endDate || null,
      verified: !!verified, note: note || ''
    };
  }

  /* ----------------------------------------------------------------------
     Planner data (derived from the supplied planner). Undated entries are
     intentionally left blank and flagged for verification.
     ---------------------------------------------------------------------- */
  const MONTHS = [
    {
      key: '2026-09', year: 2026, month: 9, label: 'September 2026', events: [
        ev('sep-2yc', '2YC', '2nd Year Classes Commencing', 'activity', '2026-09-01', null, true),
        ev('sep-1yc', '1YC', '1st Year Classes Commencing', 'activity', '2026-09-14', null, true),
        ev('sep-gs', 'GS', 'Guest Speaker', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.')
      ]
    },
    {
      key: '2026-10', year: 2026, month: 10, label: 'October 2026', events: [
        ev('oct-mt', 'MT', 'Monthly Test', 'exam', '2026-10-26', null, true),
        ev('oct-wp', 'WP', 'Welcome Party', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('oct-odt', 'ODT', 'One Day Tour', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.')
      ]
    },
    {
      key: '2026-11', year: 2026, month: 11, label: 'November 2026', events: [
        ev('nov-dc', 'DC', 'Debate Competition', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('nov-id', 'ID', 'Independence Day (ID)', 'holiday', null, null, false,
          'Listed under November in the source planner. Independence Day is 14 August \u2014 verify.')
      ]
    },
    {
      key: '2026-12', year: 2026, month: 12, label: 'December 2026', events: [
        ev('dec-mt2', 'MID', 'Mid Term (D.Com / DBA)', 'exam', '2026-12-04', null, true),
        ev('dec-fte', 'FT', 'First Term Examinations', 'exam', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('dec-ptm', 'PTM', 'Parent\u2013Teacher Meeting', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('dec-mcq', 'MCQ', "MCQ's Test", 'exam', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('dec-wv', 'WV', 'Winter Vacation / Tour', 'holiday', null, null, false,
          'Month confirmed; exact day not readable from the source.')
      ]
    },
    {
      key: '2027-01', year: 2027, month: 1, label: 'January 2027', events: [
        ev('jan-fg', 'FG', 'Food Gala', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.')
      ]
    },
    {
      key: '2027-02', year: 2027, month: 2, label: 'February 2027', events: [
        ev('feb-nc', 'NC', 'Naat Competition', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('feb-gs', 'GS', 'Guest Speaker', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.'),
        ev('feb-mcq', 'MCQ', "MCQ's Test", 'exam', null, null, false,
          'Month confirmed; exact day not readable from the source.')
      ]
    },
    {
      key: '2027-03', year: 2027, month: 3, label: 'March 2027', events: [
        ev('mar-eid', 'EID', 'Eid ul Fitr Holidays', 'holiday', '2027-03-08', '2027-03-13', false,
          'Subject to moon sighting \u2014 verify against the official notification.'),
        ev('mar-pb', 'PB', 'Pre-Board Examination', 'exam', '2027-03-22', null, true)
      ]
    },
    {
      key: '2027-04', year: 2027, month: 4, label: 'April 2027', events: [
        ev('apr-fsc', 'WS', 'F.Sc Workshop 2026', 'activity', null, null, false,
          'Labelled "2026" in the source but listed under April 2027 \u2014 verify the year.'),
        ev('apr-rev', 'REV', 'Revision', 'activity', null, null, false,
          'Month confirmed; exact day not readable from the source.')
      ]
    }
  ];

  const HOLIDAYS = [
    { id: 'h-iqbal', name: 'Iqbal Day', code: 'IQ', date: '2026-11-09', endDate: null, verified: true },
    { id: 'h-quaid', name: 'Quaid-e-Azam Day', code: 'QA', date: '2026-12-25', endDate: null, verified: true },
    { id: 'h-kashmir', name: 'Kashmir Day', code: 'KD', date: '2027-02-05', endDate: null, verified: true },
    { id: 'h-eid', name: 'Eid ul Fitr Holidays', code: 'EID', date: '2027-03-08', endDate: '2027-03-13', verified: false },
    { id: 'h-pakistan', name: 'Pakistan Day', code: 'PD', date: '2027-03-23', endDate: null, verified: true },
    {
      id: 'h-id', name: 'Independence Day (ID)', code: 'ID',
      date: null, endDate: null, verified: false,
      note: 'Shown in November in the source planner. Independence Day is 14 August \u2014 verify.'
    }
  ];

  const LEGEND = [
    {
      title: 'Schedule & Activities', category: 'activity',
      items: [
        { code: 'RC', label: 'Regular Classes', category: 'class' },
        { code: 'WP', label: 'Welcome Party' },
        { code: 'ODT', label: 'One Day Tour' },
        { code: 'DC', label: 'Debate Competition' },
        { code: 'PTM', label: 'Parent\u2013Teacher Meeting' },
        { code: 'NC', label: 'Naat Competition' },
        { code: 'GS', label: 'Guest Speaker' },
        { code: 'FG', label: 'Food Gala' }
      ]
    },
    {
      title: 'Examinations', category: 'exam',
      items: [
        { code: 'MT', label: 'Monthly Test' },
        { code: 'FT', label: 'First Term Examination' },
        { code: 'MID', label: 'Mid Term (D.Com / DBA)' },
        { code: 'PB', label: 'Pre-Board Examination' },
        { code: 'MCQ', label: "MCQ's Test" }
      ]
    },
    {
      title: 'Holidays', category: 'holiday',
      items: [
        { code: 'SUN', label: 'Sunday' },
        { code: 'ID', label: 'Independence Day (ID)' },
        { code: 'KD', label: 'Kashmir Day' },
        { code: 'IQ', label: 'Iqbal Day' },
        { code: 'QA', label: 'Quaid-e-Azam Day' },
        { code: 'PD', label: 'Pakistan Day' },
        { code: 'EID', label: 'Eid ul Fitr' },
        { code: 'WV', label: 'Winter Vacation / Tour' }
      ]
    }
  ];

  const NOTES = [
    {
      id: 'image-unreadable', severity: 'high',
      title: 'Planner image could not be read',
      text: 'The uploaded planner photograph could not be read by the assistant. Monthly lecture totals, ' +
        '1st/2nd year details, course-coverage percentages and exact activity dates are left as editable ' +
        'fields \u2014 please enter them from the original planner and tick "Date confirmed".'
    },
    {
      id: 'id-november', severity: 'high',
      title: 'Independence Day (ID) appears in November',
      text: 'The source places the "ID" code in the November list. Pakistan\u2019s Independence Day is 14 August. ' +
        'The entry is kept exactly as labelled but flagged for verification.'
    },
    {
      id: 'eid-moon', severity: 'high',
      title: 'Eid ul Fitr dates need confirmation',
      text: 'The source lists 8\u201313 March 2027. The actual dates depend on the moon sighting \u2014 verify before finalising.'
    },
    {
      id: 'fsc-year', severity: 'medium',
      title: '"F.Sc Workshop 2026" listed under April 2027',
      text: 'The activity is labelled "2026" but appears in the April 2027 block. Confirm the intended year.'
    },
    {
      id: 'mt-october', severity: 'medium',
      title: 'Monthly Test date cross-referenced',
      text: 'The Monthly Test is dated 26 October 2026 here; the source also carries examination information in December. ' +
        'Verify the intended month.'
    },
    {
      id: 'iqbal-november', severity: 'low',
      title: 'Iqbal Day (9 November) not in the November activity list',
      text: 'Iqbal Day is a public holiday on 9 November 2026. It is included in the Holidays panel.'
    }
  ];

  /* ----------------------------------------------------------------------
     Overrides (localStorage)
     ---------------------------------------------------------------------- */
  let overrides = {};

  function loadOverrides() {
    const o = Store.read(STORE_KEY, {}) || {};
    o.settings = Object.assign({ showRC: true }, o.settings || {});
    o.events = o.events || {};
    o.holidays = o.holidays || {};
    o.months = o.months || {};
    o.ui = Object.assign({ collapsed: {} }, o.ui || {});
    return o;
  }

  function saveOverrides() {
    Store.write(STORE_KEY, overrides);
  }

  function entryStore(kind) {
    return kind === 'holiday' ? overrides.holidays : overrides.events;
  }

  function eff(entry, kind) {
    const ov = entryStore(kind)[entry.id] || {};
    return {
      date: ov.date !== undefined ? ov.date : entry.date,
      endDate: ov.endDate !== undefined ? ov.endDate : entry.endDate,
      verified: ov.verified !== undefined ? ov.verified : entry.verified,
      note: entry.note || ''
    };
  }

  /* ----------------------------------------------------------------------
     Date helpers
     ---------------------------------------------------------------------- */
  function iso(y, m, d) { return y + '-' + Utils.pad(m) + '-' + Utils.pad(d); }
  function parseISO(s) { const p = String(s).split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function weekday(y, m, d) { return new Date(y, m - 1, d).getDay(); }
  function dayName(s) { if (!s) return ''; const p = parseISO(s); return DAY_NAMES[weekday(p.y, p.m, p.d)]; }

  function fmtRange(a, b) {
    if (!a) return null;
    if (!b || b === a) return Utils.fmtDateShort(a);
    const pa = parseISO(a), pb = parseISO(b);
    if (pa.y === pb.y && pa.m === pb.m) {
      return Utils.pad(pa.d) + '\u2013' + Utils.pad(pb.d) + ' ' + MONTH_ABBR[pa.m - 1] + ' ' + pa.y;
    }
    return Utils.fmtDateShort(a) + ' \u2013 ' + Utils.fmtDateShort(b);
  }

  function dateBetween(d, a, b) {
    return d >= a && d <= (b || a);
  }

  /* Every ISO date covered by a holiday entry. */
  function holidayDates(h) {
    if (!h.date) return [];
    const out = [];
    const end = h.endDate || h.date;
    const s = parseISO(h.date), e = parseISO(end);
    let cur = new Date(s.y, s.m - 1, s.d);
    const last = new Date(e.y, e.m - 1, e.d);
    while (cur <= last) {
      out.push(Utils.toISO(cur));
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    }
    return out;
  }

  /* ----------------------------------------------------------------------
     Rendering — header
     ---------------------------------------------------------------------- */
  function renderHead() {
    const settings = (db.settings.get && db.settings.get()) || {};
    const college = (settings.college && settings.college.name) || 'The Muslim College Peshawar';
    const programs = SESSION.programs.map(p => '<span class="pl-chip">' + Utils.esc(p) + '</span>').join('');

    return '' +
      '<div class="pl-head-top">' +
        '<img src="assets/logo.png" alt="College crest" class="pl-crest">' +
        '<div class="pl-head-text">' +
          '<div class="pl-college">' + Utils.esc(college) + '</div>' +
          '<div class="pl-place">Peshawar, Khyber Pakhtunkhwa</div>' +
          '<div class="pl-head-meta">' +
            '<span>Session <b>' + Utils.esc(SESSION.label) + '</b></span>' +
            '<span>Duration <b>' + Utils.fmtDateShort(SESSION.start) + ' \u2013 ' + Utils.fmtDateShort(SESSION.end) + '</b></span>' +
            '<span>Programs ' + programs + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pl-title">Yearly Planner for the Session ' + Utils.esc(SESSION.label) + '</div>';
  }

  /* ----------------------------------------------------------------------
     Rendering — toolbar
     ---------------------------------------------------------------------- */
  function renderToolbar() {
    const jumps = MONTHS.map(m => {
      const short = m.label.split(' ')[0].slice(0, 3);
      return '<button type="button" class="pl-jump" data-jump="' + m.key + '">' +
        Utils.esc(short + ' \u2019' + String(m.year).slice(2)) + '</button>';
    }).join('');

    return '' +
      '<label class="pl-field">Session ' +
        '<select id="plSessionSel"><option value="' + SESSION.id + '">' + Utils.esc(SESSION.label) + '</option></select>' +
      '</label>' +
      '<div class="pl-months-nav" role="group" aria-label="Jump to month">' + jumps + '</div>' +
      '<span class="pl-spacer"></span>' +
      '<label class="pl-check"><input type="checkbox" id="plShowRC"' +
        (overrides.settings.showRC ? ' checked' : '') + '> Show RC on working days</label>' +
      '<button type="button" class="pl-btn" id="plExpandAll"><i class="fa-solid fa-angles-down"></i> Expand all</button>' +
      '<button type="button" class="pl-btn" id="plCollapseAll"><i class="fa-solid fa-angles-up"></i> Collapse all</button>';
  }

  /* ----------------------------------------------------------------------
     Rendering — calendar
     ---------------------------------------------------------------------- */
  function holidayMapForMonth(month) {
    const map = {};
    HOLIDAYS.forEach(h => {
      const e = eff(h, 'holiday');
      holidayDates({ date: e.date, endDate: e.endDate }).forEach(d => {
        const p = parseISO(d);
        if (p.y === month.year && p.m === month.month) {
          if (!map[d]) map[d] = [];
          map[d].push({ name: h.name, code: h.code, verified: e.verified });
        }
      });
    });
    return map;
  }

  function eventsByDate(month) {
    const map = {};
    month.events.forEach(e => {
      const o = eff(e, 'events');
      if (!o.date) return;
      const end = o.endDate || o.date;
      const s = parseISO(o.date), en = parseISO(end);
      let cur = new Date(s.y, s.m - 1, s.d);
      const last = new Date(en.y, en.m - 1, en.d);
      while (cur <= last) {
        const d = Utils.toISO(cur);
        if (!map[d]) map[d] = [];
        map[d].push({ code: e.code, title: e.title, type: e.type, verified: o.verified });
        cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      }
    });
    return map;
  }

  function chip(item) {
    const cls = swClass(item.code, item.type) + (item.verified ? '' : ' is-unverified');
    const title = item.title ? ' title="' + Utils.esc(item.title) + '"' : '';
    return '<span class="pl-cal-ev ' + cls + '"' + title + '>' + Utils.esc(item.code) + '</span>';
  }

  /* Merge a day's events and holidays into one ordered, de-duplicated list. */
  function activitiesForDate(dayEvents, dayHols) {
    const list = [];
    const seen = {};
    dayEvents.forEach(e => {
      if (seen[e.code]) return;
      seen[e.code] = true;
      list.push({ code: e.code, type: e.type, verified: e.verified, title: e.title });
    });
    dayHols.forEach(h => {
      if (seen[h.code]) return;
      seen[h.code] = true;
      list.push({ code: h.code, type: 'holiday', verified: h.verified, title: h.name });
    });
    return list;
  }

  function renderCalendar(month) {
    const dim = daysInMonth(month.year, month.month);
    const firstDow = weekday(month.year, month.month, 1);
    const holidays = holidayMapForMonth(month);
    const events = eventsByDate(month);

    let html = '<div class="pl-cal"><div class="pl-cal-grid">';
    DAY_NAMES.forEach(d => { html += '<div class="pl-cal-dow">' + d.slice(0, 3) + '</div>'; });

    for (let i = 0; i < firstDow; i++) html += '<div class="pl-cal-cell is-blank"></div>';

    for (let d = 1; d <= dim; d++) {
      const isoDate = iso(month.year, month.month, d);
      const dow = weekday(month.year, month.month, d);
      const isSunday = dow === 0;
      const dayHols = holidays[isoDate] || [];
      const dayEvents = events[isoDate] || [];
      const acts = activitiesForDate(dayEvents, dayHols);

      /* Cell tint = highest-priority activity, else Sunday, else RC/working day. */
      let cellSw;
      if (acts.length) {
        const top = acts.slice().sort((a, b) => priority(b) - priority(a))[0];
        cellSw = swClass(top.code, top.type);
      } else if (isSunday) {
        cellSw = 'sw-sunday';
        acts.push({ code: 'SUN', type: 'holiday', verified: true, title: 'Sunday' });
      } else if (overrides.settings.showRC) {
        cellSw = 'sw-rc';
        acts.push({ code: 'RC', type: 'class', verified: true, title: 'Regular Classes' });
      } else {
        cellSw = 'sw-weekday';
      }

      /* Every activity on the date gets its own visible chip. */
      const chips = acts.map(chip).join('');

      html += '<div class="pl-cal-cell ' + cellSw + '">' +
        '<span class="pl-cal-num">' + d + '</span>' + chips +
      '</div>';
    }

    /* trailing blank cells to complete the last week */
    const total = firstDow + dim;
    const trail = (7 - (total % 7)) % 7;
    for (let i = 0; i < trail; i++) html += '<div class="pl-cal-cell is-blank"></div>';

    html += '</div></div>';
    return html;
  }

  /* ----------------------------------------------------------------------
     Rendering — month details + summary
     ---------------------------------------------------------------------- */
  function rowEdit(kind, id, label) {
    return '<button type="button" class="pl-row-action" data-edit="' + kind + '" data-id="' + id + '" ' +
      'title="Edit ' + Utils.esc(label) + '" aria-label="Edit ' + Utils.esc(label) + '">' +
      '<i class="fa-solid fa-pen"></i></button>';
  }

  function renderDetails(month) {
    const rows = month.events.map(e => {
      const o = eff(e, 'events');
      const range = fmtRange(o.date, o.endDate);
      const dateCell = range
        ? Utils.esc(range)
        : '<span class="pl-tbc">Date TBC</span>';
      const dayCell = o.date
        ? Utils.esc(o.endDate && o.endDate !== o.date ? dayName(o.date) + ' \u2013 ' + dayName(o.endDate) : dayName(o.date))
        : '\u2014';
      const remark = o.verified
        ? Utils.esc(o.note || 'Confirmed')
        : '<span class="pl-tbc">Needs verification</span>';
      return '<tr>' +
        '<td class="pl-nowrap">' + dateCell + '</td>' +
        '<td class="pl-nowrap">' + dayCell + '</td>' +
        '<td>' + Utils.esc(e.title) + '</td>' +
        '<td class="pl-nowrap"><span class="pl-code ' + swClass(e.code, e.type) + '">' + Utils.esc(e.code) + '</span></td>' +
        '<td class="pl-nowrap">\u2014</td>' +
        '<td>' + remark + '</td>' +
        '<td class="pl-nowrap">' + rowEdit('event', e.id, e.title) + '</td>' +
      '</tr>';
    }).join('');

    /* baseline Regular Classes row carries the month lecture total */
    const ms = overrides.months[month.key] || {};
    const estimate = workingDays(month);
    const totalShown = (ms.totalLectures != null && ms.totalLectures !== '')
      ? Utils.esc(String(ms.totalLectures))
      : '<span class="pl-est">\u2014</span>';
    const baseline = overrides.settings.showRC
      ? '<tr>' +
          '<td class="pl-nowrap">All working days</td>' +
          '<td class="pl-nowrap">Mon\u2013Sat</td>' +
          '<td>Regular Classes <span class="pl-est">(baseline schedule)</span></td>' +
          '<td class="pl-nowrap"><span class="pl-code sw-rc">RC</span></td>' +
          '<td class="pl-nowrap">' + totalShown + '</td>' +
          '<td>Sunday &amp; gazetted holidays excluded <span class="pl-est">(est. ' + estimate + ' working days)</span></td>' +
          '<td></td>' +
        '</tr>'
      : '';

    return '' +
      '<table class="pl-table">' +
        '<thead><tr>' +
          '<th>Date</th><th>Day</th><th>Event / Activity</th><th>Code</th>' +
          '<th>Total Lectures</th><th>Remarks</th><th></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + baseline + '</tbody>' +
      '</table>';
  }

  function workingDays(month) {
    const dim = daysInMonth(month.year, month.month);
    const holidays = holidayMapForMonth(month);
    let n = 0;
    for (let d = 1; d <= dim; d++) {
      const isoDate = iso(month.year, month.month, d);
      if (weekday(month.year, month.month, d) === 0) continue;
      if (holidays[isoDate]) continue;
      n++;
    }
    return n;
  }

  function sumItem(label, value, span) {
    return '<div class="pl-sum-item' + (span ? ' pl-span-2' : '') + '">' +
      '<div class="pl-sum-label">' + Utils.esc(label) + '</div>' +
      '<div class="pl-sum-value">' + value + '</div>' +
    '</div>';
  }

  function renderSummary(month) {
    const ms = overrides.months[month.key] || {};
    const estimate = workingDays(month);

    const total = (ms.totalLectures != null && ms.totalLectures !== '')
      ? Utils.esc(String(ms.totalLectures))
      : '\u2014 <span class="pl-est">(est. ' + estimate + ' working days)</span>';

    const exams = month.events.filter(e => e.type === 'exam')
      .map(e => e.title + (eff(e, 'events').date ? ' (' + fmtRange(eff(e, 'events').date, eff(e, 'events').endDate) + ')' : ' (date TBC)'))
      .join(', ');
    const examPeriod = ms.examPeriod ? Utils.esc(ms.examPeriod)
      : (exams || '\u2014');

    const revision = ms.revision ? Utils.esc(ms.revision)
      : (month.events.some(e => /revision/i.test(e.title)) ? 'Revision (see activities)' : '\u2014');

    function val(v, fallback) {
      return (v != null && v !== '') ? Utils.esc(String(v)) : (fallback || '\u2014');
    }

    return '' +
      '<div class="pl-summary">' +
        '<div class="pl-summary-title">Month Summary \u2014 ' + Utils.esc(month.label) +
          ' <button type="button" class="pl-row-action" data-edit="month" data-id="' + month.key + '" ' +
            'title="Edit month summary" aria-label="Edit month summary" style="color:#fff;float:right">' +
            '<i class="fa-solid fa-pen"></i></button>' +
        '</div>' +
        '<div class="pl-summary-grid">' +
          sumItem('Total Lectures', total) +
          sumItem('Course Coverage', val(ms.coverage)) +
          sumItem('1st Year', val(ms.year1)) +
          sumItem('2nd Year', val(ms.year2)) +
          sumItem('Revision Period', revision) +
          sumItem('Examination Period', examPeriod) +
          sumItem('Remarks', val(ms.remarks), true) +
        '</div>' +
      '</div>';
  }

  function renderMonth(month) {
    const collapsed = !!overrides.ui.collapsed[month.key];
    const estimate = workingDays(month);
    const verified = month.events.filter(e => eff(e, 'events').verified).length;

    return '' +
      '<article class="pl-month' + (collapsed ? ' is-collapsed' : '') + '" id="pl-m-' + month.key + '" data-month="' + month.key + '">' +
        '<div class="pl-month-head">' +
          '<button type="button" class="pl-month-toggle" data-month-toggle="' + month.key + '" aria-expanded="' + (!collapsed) + '">' +
            '<i class="fa-solid fa-chevron-down pl-month-caret"></i>' +
            '<span class="pl-month-name">' + Utils.esc(month.label) + '</span>' +
            '<span class="pl-month-badge">' + month.events.length + ' activities</span>' +
            '<span class="pl-month-sum-mini">' +
              '<span>Working days <b>' + estimate + '</b></span>' +
              '<span>Confirmed <b>' + verified + '</b></span>' +
            '</span>' +
          '</button>' +
          '<button type="button" class="pl-month-print" data-print-month="' + month.key + '" ' +
            'title="Print ' + Utils.esc(month.label) + ' (A4 landscape)" ' +
            'aria-label="Print ' + Utils.esc(month.label) + '"><i class="fa-solid fa-print"></i></button>' +
        '</div>' +
        '<div class="pl-month-body">' +
          renderCalendar(month) +
          '<div class="pl-detail-wrap">' + renderDetails(month) + renderSummary(month) + '</div>' +
        '</div>' +
      '</article>';
  }

  /* ----------------------------------------------------------------------
     Rendering — panels
     ---------------------------------------------------------------------- */
  function renderHolidays() {
    const items = HOLIDAYS.map(h => {
      const o = eff(h, 'holiday');
      const range = fmtRange(o.date, o.endDate);
      const dateCell = range ? Utils.esc(range) : '<span class="pl-tbc">Date TBC</span>';
      const flag = o.verified
        ? '<span class="pl-hol-flag is-ok">Confirmed</span>'
        : '<span class="pl-hol-flag">Verify</span>';
      return '<li class="pl-hol' + (o.verified ? '' : ' is-unverified') + '">' +
        '<span class="pl-code sw-holiday">' + Utils.esc(h.code) + '</span>' +
        '<span><span class="pl-hol-name">' + Utils.esc(h.name) + '</span>' +
          '<br><span class="pl-hol-date">' + dateCell +
          (h.note && !o.verified ? ' \u00b7 ' + Utils.esc(h.note) : '') + '</span></span>' +
        '<span>' + flag + ' ' + rowEdit('holiday', h.id, h.name) + '</span>' +
      '</li>';
    }).join('');

    return panel('Holidays', 'fa-calendar-xmark', '<ul class="pl-plain">' + items + '</ul>');
  }

  function renderLegend() {
    return LEGEND.map(group => {
      const items = group.items.map(it => {
        const cat = it.category || group.category;
        return '<div class="pl-leg-item ' + swClass(it.code, cat) + '">' +
          '<span class="pl-code">' + Utils.esc(it.code) + '</span>' +
          '<span class="pl-leg-name">' + Utils.esc(it.label) + '</span>' +
        '</div>';
      }).join('');
      return '<div class="pl-leg-cat">' + Utils.esc(group.title) + '</div>' +
        '<div class="pl-legend">' + items + '</div>';
    }).join('');
  }

  function renderExams() {
    const exams = [];
    MONTHS.forEach(m => m.events.forEach(e => {
      if (e.type !== 'exam') return;
      const o = eff(e, 'events');
      exams.push({ code: e.code, title: e.title, month: m.label, date: o.date, endDate: o.endDate, verified: o.verified });
    }));

    const items = exams.map(e => {
      const range = fmtRange(e.date, e.endDate);
      const dateCell = range ? Utils.esc(range) : '<span class="pl-tbc">Date TBC</span>';
      const flag = e.verified ? '' : ' <span class="pl-tbc">Needs verification</span>';
      return '<li class="pl-hol' + (e.verified ? '' : ' is-unverified') + '">' +
        '<span class="pl-code ' + swClass(e.code, 'exam') + '">' + Utils.esc(e.code) + '</span>' +
        '<span><span class="pl-hol-name">' + Utils.esc(e.title) + '</span>' +
          '<br><span class="pl-hol-date">' + dateCell + ' \u00b7 ' + Utils.esc(e.month) + flag + '</span></span>' +
        '<span></span>' +
      '</li>';
    }).join('');

    return panel('Examinations', 'fa-file-pen', '<ul class="pl-plain">' + items + '</ul>');
  }

  function renderNotes() {
    const items = NOTES.map(n =>
      '<li class="pl-note is-' + n.severity + '">' +
        '<div class="pl-note-title">' + Utils.esc(n.title) +
          '<span class="pl-note-sev">' + Utils.esc(n.severity) + '</span></div>' +
        '<div class="pl-note-text">' + Utils.esc(n.text) + '</div>' +
      '</li>'
    ).join('');
    return panel('Source Notes & Verification', 'fa-triangle-exclamation',
      '<ul class="pl-notes">' + items + '</ul>');
  }

  function panel(title, icon, body) {
    return '<section class="pl-panel">' +
      '<div class="pl-panel-head"><i class="fa-solid ' + icon + '"></i> ' + Utils.esc(title) + '</div>' +
      '<div class="pl-panel-body">' + body + '</div>' +
    '</section>';
  }

  function renderFoot() {
    return '' +
      '<span>Session ' + Utils.esc(SESSION.label) + ' \u00b7 ' +
        Utils.fmtDateShort(SESSION.start) + ' \u2013 ' + Utils.fmtDateShort(SESSION.end) + '</span>' +
      '<span>Generated ' + Utils.esc(Utils.fmtDate(Utils.pkToday())) + ' \u00b7 ' +
        'Dates marked "Needs verification" must be confirmed against the official planner.</span>';
  }

  /* ----------------------------------------------------------------------
     Full render
     ---------------------------------------------------------------------- */
  function render() {
    document.getElementById('plHead').innerHTML = renderHead();
    document.getElementById('plToolbar').innerHTML = renderToolbar();
    document.getElementById('plMonths').innerHTML = MONTHS.map(renderMonth).join('');
    document.getElementById('plPanels').innerHTML =
      renderHolidays() + renderLegend() + renderExams() + renderNotes();
    document.getElementById('plFoot').innerHTML = renderFoot();
  }

  /* ----------------------------------------------------------------------
     Editing — events & holidays
     ---------------------------------------------------------------------- */
  function findEntry(kind, id) {
    if (kind === 'holiday') return HOLIDAYS.find(h => h.id === id);
    for (const m of MONTHS) {
      const e = m.events.find(x => x.id === id);
      if (e) return e;
    }
    return null;
  }

  function openEventModal(kind, id) {
    const entry = findEntry(kind, id);
    if (!entry) return;
    const o = eff(entry, kind);
    const title = kind === 'holiday' ? entry.name : entry.title;

    document.getElementById('plEventModalTitle').textContent = 'Edit ' + (kind === 'holiday' ? 'holiday' : 'activity');
    document.getElementById('plEvKind').value = kind;
    document.getElementById('plEvId').value = id;
    document.getElementById('plEvTitle').value = title;
    document.getElementById('plEvDate').value = o.date || '';
    document.getElementById('plEvEnd').value = o.endDate || '';
    document.getElementById('plEvVerified').checked = !!o.verified;
    UI.modal.open('plEventModal');
  }

  function saveEvent() {
    const kind = document.getElementById('plEvKind').value;
    const id = document.getElementById('plEvId').value;
    const date = document.getElementById('plEvDate').value || null;
    const endDate = document.getElementById('plEvEnd').value || null;
    const verified = document.getElementById('plEvVerified').checked;

    if (endDate && date && endDate < date) {
      toast('The end date cannot be before the start date.', 'warning', 'Check dates');
      return;
    }

    entryStore(kind)[id] = { date: date, endDate: endDate, verified: verified };
    saveOverrides();
    UI.modal.close('plEventModal');
    render();
    toast('Entry updated.', 'success', 'Saved');
  }

  /* ----------------------------------------------------------------------
     Editing — month summary
     ---------------------------------------------------------------------- */
  function openMonthModal(key) {
    const month = MONTHS.find(m => m.key === key);
    if (!month) return;
    const ms = overrides.months[key] || {};
    document.getElementById('plMonthModalTitle').textContent = 'Edit ' + month.label;
    document.getElementById('plMonthKey').value = key;
    document.getElementById('plMonthTotal').value = ms.totalLectures != null ? ms.totalLectures : '';
    document.getElementById('plMonthCoverage').value = ms.coverage || '';
    document.getElementById('plMonthYear1').value = ms.year1 || '';
    document.getElementById('plMonthYear2').value = ms.year2 || '';
    document.getElementById('plMonthRevision').value = ms.revision || '';
    document.getElementById('plMonthExam').value = ms.examPeriod || '';
    document.getElementById('plMonthRemarks').value = ms.remarks || '';
    UI.modal.open('plMonthModal');
  }

  function saveMonth() {
    const key = document.getElementById('plMonthKey').value;
    overrides.months[key] = {
      totalLectures: document.getElementById('plMonthTotal').value,
      coverage: document.getElementById('plMonthCoverage').value.trim(),
      year1: document.getElementById('plMonthYear1').value.trim(),
      year2: document.getElementById('plMonthYear2').value.trim(),
      revision: document.getElementById('plMonthRevision').value.trim(),
      examPeriod: document.getElementById('plMonthExam').value.trim(),
      remarks: document.getElementById('plMonthRemarks').value.trim()
    };
    saveOverrides();
    UI.modal.close('plMonthModal');
    render();
    toast('Month updated.', 'success', 'Saved');
  }

  /* ----------------------------------------------------------------------
     Printing — full planner = A3 landscape, single month = A4 landscape.
     The @page size is injected at runtime; body classes drive the print CSS.
     ---------------------------------------------------------------------- */
  let plPrintStyle = null;

  function setPrintPageSize(size) {
    if (!plPrintStyle) {
      plPrintStyle = document.createElement('style');
      plPrintStyle.id = 'plPrintPage';
      document.head.appendChild(plPrintStyle);
    }
    plPrintStyle.textContent = '@page { size: ' + size + '; margin: 10mm; }';
  }

  function printFull() {
    setPrintPageSize('A3 landscape');
    document.body.classList.add('pl-print-full');
    document.body.classList.remove('pl-print-month');
    window.print();
  }

  function printMonth(key) {
    setPrintPageSize('A4 landscape');
    document.body.classList.remove('pl-print-full');
    document.body.classList.add('pl-print-month');
    document.querySelectorAll('.pl-month').forEach(m => {
      m.classList.toggle('pl-print-target', m.getAttribute('data-month') === key);
    });
    window.print();
  }

  function clearPrintState() {
    document.body.classList.remove('pl-print-full', 'pl-print-month');
    document.querySelectorAll('.pl-month.pl-print-target').forEach(m => m.classList.remove('pl-print-target'));
  }

  window.addEventListener('afterprint', clearPrintState);

  /* ----------------------------------------------------------------------
     Events
     ---------------------------------------------------------------------- */
  function bind() {
    const root = document.getElementById('plannerRoot');
    if (root) {
      root.addEventListener('click', e => {
        const toggle = e.target.closest('[data-month-toggle]');
        if (toggle) {
          const key = toggle.getAttribute('data-month-toggle');
          overrides.ui.collapsed[key] = !overrides.ui.collapsed[key];
          saveOverrides();
          const card = document.getElementById('pl-m-' + key);
          const collapsed = !!overrides.ui.collapsed[key];
          if (card) card.classList.toggle('is-collapsed', collapsed);
          toggle.setAttribute('aria-expanded', String(!collapsed));
          return;
        }

        const printM = e.target.closest('[data-print-month]');
        if (printM) {
          printMonth(printM.getAttribute('data-print-month'));
          return;
        }

        const jump = e.target.closest('[data-jump]');
        if (jump) {
          const card = document.getElementById('pl-m-' + jump.getAttribute('data-jump'));
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }

        const edit = e.target.closest('[data-edit]');
        if (edit) {
          const kind = edit.getAttribute('data-edit');
          const id = edit.getAttribute('data-id');
          if (kind === 'month') openMonthModal(id);
          else openEventModal(kind, id);
          return;
        }
      });

      root.addEventListener('change', e => {
        if (e.target && e.target.id === 'plShowRC') {
          overrides.settings.showRC = e.target.checked;
          saveOverrides();
          render();
        }
      });

      document.getElementById('plToolbar').addEventListener('click', e => {
        if (e.target.closest('#plExpandAll')) {
          overrides.ui.collapsed = {};
          saveOverrides();
          render();
        } else if (e.target.closest('#plCollapseAll')) {
          MONTHS.forEach(m => { overrides.ui.collapsed[m.key] = true; });
          saveOverrides();
          render();
        }
      });
    }

    const evSave = document.getElementById('plEvSave');
    if (evSave) evSave.addEventListener('click', saveEvent);
    const moSave = document.getElementById('plMonthSave');
    if (moSave) moSave.addEventListener('click', saveMonth);

    const printBtn = document.getElementById('plPrintBtn');
    if (printBtn) printBtn.addEventListener('click', printFull);

    const resetBtn = document.getElementById('plResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
      confirm({
        title: 'Reset planner edits?',
        message: 'All dates, lecture totals and remarks you entered will be cleared and the planner returns to the source defaults.',
        confirmText: 'Reset edits',
        danger: true
      }).then(ok => {
        if (!ok) return;
        Store.remove(STORE_KEY);
        overrides = loadOverrides();
        render();
        toast('Planner reset to defaults.', 'success', 'Reset');
      });
    });
  }

  function init() {
    overrides = loadOverrides();
    render();
    bind();
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(init));

  window.Planner = {
    SESSION: SESSION,
    MONTHS: MONTHS,
    HOLIDAYS: HOLIDAYS,
    init: init,
    render: render,
    _loadOverrides: loadOverrides
  };
})();
