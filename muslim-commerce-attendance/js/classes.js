/* ==========================================================================
   classes.js — class register (add / edit / view / delete)
   --------------------------------------------------------------------------
   Supports two kinds of class:
     • Sectioned   — has one or more sections (A, B, …)
     • Section-less — no sections at all; students sit directly under the class.
                      The four academic classes (1st/2nd Year Medical and
                      Computer Science) are section-less and use stable ids.
   ========================================================================== */

'use strict';

(function () {

  const state = { search: '', year: '', group: '', status: '' };

  const Classes = {
    init() {
      Classes.buildFilters();
      bindEvents();
      Classes.render();
    },

    buildFilters() {
      UI.optionList(document.getElementById('classYearFilter'), ACADEMIC_YEARS, '', 'All years');
      UI.optionList(document.getElementById('classGroupFilter'), STUDY_GROUPS, '', 'All groups');
      UI.optionList(document.getElementById('classStatusFilter'),
        [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }],
        '', 'All statuses');
    },

    filtered() {
      const q = state.search.trim().toLowerCase();
      return db.classes.all().filter(cls => {
        if (state.year && db.classes.yearOf(cls) !== state.year) return false;
        if (state.group && db.classes.groupOf(cls) !== state.group) return false;
        if (state.status && (cls.status || 'active') !== state.status) return false;
        if (q && cls.name.toLowerCase().indexOf(q) === -1 &&
            String(cls.code || '').toLowerCase().indexOf(q) === -1) return false;
        return true;
      });
    },

    render() {
      const body = document.getElementById('classTableBody');
      if (!body) return;

      const classes = Classes.filtered();

      if (!classes.length) {
        body.innerHTML = '<tr><td colspan="7">' + UI.emptyState(
          'No classes found',
          db.classes.all().length
            ? 'No classes match the current search or filters.'
            : 'Click “Add Class” to create your first class.',
          'fa-school') + '</td></tr>';
        return;
      }

      body.innerHTML = classes.map(cls => {
        const count = db.classes.studentCount(cls.name);
        const year = db.classes.yearOf(cls);
        const group = db.classes.groupOf(cls);
        const teacher = db.classes.teacherOf(cls);
        return '<tr>' +
          '<td><div class="td-main">' + Utils.esc(cls.name) + '</div>' +
            '<span class="td-sub">Code: ' + Utils.esc(cls.code || '—') +
            (db.classes.isSectionless(cls.name) ? ' · No sections' : '') + '</span></td>' +
          '<td>' + (year
            ? '<span class="badge badge-blue">' + Utils.esc(year) + '</span>'
            : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (group
            ? '<span class="badge badge-gray">' + Utils.esc(group) + '</span>'
            : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + Utils.fmtNumber(count) + '</td>' +
          '<td>' + (teacher
            ? '<div class="td-main">' + Utils.esc(teacher) + '</div><span class="td-sub">Assigned</span>'
            : '<span class="muted">Unassigned</span>') + '</td>' +
          '<td>' + UI.statusBadge(cls.status || 'active') + '</td>' +
          '<td><div class="actions-cell">' +
            '<button type="button" class="icon-btn" title="View class" data-view-class="' + Utils.esc(cls.name) + '">' +
              '<i class="fa-solid fa-eye"></i></button>' +
            '<button type="button" class="icon-btn" title="Edit class" data-edit-class="' + Utils.esc(cls.name) + '">' +
              '<i class="fa-solid fa-pen"></i></button>' +
            '<button type="button" class="icon-btn danger" title="Delete class" data-del-class="' + Utils.esc(cls.name) + '">' +
              '<i class="fa-solid fa-trash-can"></i></button>' +
          '</div></td>' +
        '</tr>';
      }).join('');

      body.querySelectorAll('[data-view-class]').forEach(b =>
        b.addEventListener('click', () => Classes.openView(b.dataset.viewClass)));
      body.querySelectorAll('[data-edit-class]').forEach(b =>
        b.addEventListener('click', () => Classes.openForm(b.dataset.editClass)));
      body.querySelectorAll('[data-del-class]').forEach(b =>
        b.addEventListener('click', () => Classes.remove(b.dataset.delClass)));
    },

    openForm(name) {
      const form = document.getElementById('classForm');
      const title = document.getElementById('classModalTitle');
      UI.clearErrors(form);
      form.reset();

      const cls = name ? db.classes.find(name) : null;
      form.dataset.mode = cls ? 'edit' : 'add';
      form.dataset.originalName = cls ? cls.name : '';

      if (title) title.textContent = cls ? 'Edit Class' : 'Add Class';

      UI.optionList(form.elements.year, ACADEMIC_YEARS,
        cls ? db.classes.yearOf(cls) : '', '— Not specified');
      UI.optionList(form.elements.group, STUDY_GROUPS,
        cls ? db.classes.groupOf(cls) : '', '— Not specified');
      UI.optionList(form.elements.teacher, db.teachers.all().map(t => t.name),
        cls ? (cls.teacher || '') : '', '— Unassigned');

      if (cls) {
        form.elements.className.value = cls.name;
        form.elements.sections.value = (cls.sections || []).join(', ');
        form.elements.subjects.value = (cls.subjects || []).join(', ');
        form.elements.status.value = cls.status || 'active';
      } else {
        /* Section is optional — never pre-filled. */
        form.elements.sections.value = '';
        form.elements.status.value = 'active';
      }

      UI.modal.open('classModal');
    },

    save() {
      const form = document.getElementById('classForm');
      const editing = form.dataset.mode === 'edit';
      const originalName = form.dataset.originalName;

      UI.clearErrors(form);

      const name = form.elements.className.value.trim();
      const year = form.elements.year.value;
      const group = form.elements.group.value;
      const sections = parseList(form.elements.sections.value, true);
      const subjects = parseList(form.elements.subjects.value, false);
      const teacher = form.elements.teacher.value;
      const status = form.elements.status.value;
      let ok = true;

      if (name.length < 3) {
        UI.fieldError(form.elements.className, 'Enter a class name (min 3 characters).');
        ok = false;
      } else if (db.classes.all().some(c =>
        c.name.toLowerCase() === name.toLowerCase() && c.name !== originalName)) {
        UI.fieldError(form.elements.className, 'A class with this name already exists.');
        ok = false;
      }
      if (!subjects.length) {
        UI.fieldError(form.elements.subjects, 'Add at least one subject.');
        ok = false;
      }
      if (!ok) return;

      if (editing) {
        const original = db.classes.find(originalName);
        const prevTeacher = original ? (original.teacher || '') : '';
        db.classes.update(originalName, {
          name: name, year: year, group: group, sections: sections,
          subjects: subjects, teacher: teacher, status: status
        });

        /* Keep students and attendance aligned when the class is renamed */
        if (name !== originalName) {
          const sList = db.students.all();
          sList.forEach(s => { if (s.class === originalName) s.class = name; });
          db.students.saveList(sList);

          const aList = db.attendance.all();
          aList.forEach(r => { if (r.className === originalName) r.className = name; });
          db.attendance.saveList(aList);
        }

        if (prevTeacher !== teacher) unassignTeacher(prevTeacher, name);
        if (teacher) assignTeacher(teacher, name);

        /* Students in sections that no longer exist need review (only when the
           class actually has sections). */
        const sectionsChanged = !original || (original.sections || []).join(',') !== sections.join(',');
        if (sectionsChanged && sections.length) {
          const orphans = db.students.all().filter(s =>
            s.class === name && s.section && sections.indexOf(s.section) === -1);
          if (orphans.length) {
            toast(orphans.length + ' student(s) belong to a removed section — update them from the Students page.',
              'warning', 'Check sections');
          }
        }

        toast('Class updated successfully.', 'success');
      } else {
        const core = CORE_CLASS_DEFS.find(d => d.name.toLowerCase() === name.toLowerCase());
        const code = generateCode(name);
        let id = core ? core.id : ('cls_' + code.toLowerCase() + '_' + Date.now().toString(36));
        if (db.classes.byId(id)) id = Utils.uid('cls');

        db.classes.insert({
          id: id,
          name: name,
          code: code,
          year: year,
          group: group,
          sections: sections,
          subjects: subjects,
          teacher: teacher,
          status: status
        });
        if (teacher) assignTeacher(teacher, name);
        toast('Class added successfully.', 'success');
      }

      UI.modal.close('classModal');
      Classes.render();
      Classes.buildFilters();
      syncSharedSelects();
    },

    openView(name) {
      const cls = db.classes.find(name);
      const title = document.getElementById('classViewTitle');
      const body = document.getElementById('classViewBody');
      if (!cls || !body) return;

      if (title) title.textContent = cls.name;

      const count = db.classes.studentCount(cls.name);
      const year = db.classes.yearOf(cls) || '—';
      const group = db.classes.groupOf(cls) || '—';
      const teacher = db.classes.teacherOf(cls) || 'Unassigned';
      const sections = cls.sections || [];
      const subjects = cls.subjects || [];

      const today = db.attendance.forDate(Utils.todayISO())
        .filter(r => r.className === cls.name);
      const summary = today.reduce((acc, rec) => {
        rec.entries.forEach(en => { acc[en.status]++; acc.total++; });
        return acc;
      }, { present: 0, absent: 0, leave: 0, total: 0 });

      body.innerHTML =
        '<div class="profile-badges" style="margin-bottom:14px">' +
          '<span class="badge badge-blue">' + Utils.esc(year) + '</span>' +
          '<span class="badge badge-gray">' + Utils.esc(group) + '</span>' +
          (sections.length
            ? '<span class="badge badge-blue">Sections: ' + Utils.esc(sections.join(', ')) + '</span>'
            : '<span class="badge badge-gray">No sections</span>') +
          UI.statusBadge(cls.status || 'active') +
        '</div>' +
        '<div class="detail-grid">' +
          detail('Class Code', cls.code || '—') +
          detail('Class ID', cls.id || '—') +
          detail('Assigned Teacher', teacher) +
          detail('Total Students', Utils.fmtNumber(count)) +
        '</div>' +
        '<div class="section-label">Subjects (' + subjects.length + ')</div>' +
        '<div class="profile-badges">' +
          (subjects.length
            ? subjects.map(s => '<span class="badge badge-blue">' + Utils.esc(s) + '</span>').join('')
            : '<span class="muted">No subjects defined.</span>') +
        '</div>' +
        '<div class="section-label">Today’s attendance' +
          (today.length ? ' · ' + Utils.fmtDate(Utils.todayISO()) : '') + '</div>' +
        (today.length
          ? '<div class="summary-grid">' +
              summaryItem('Total', summary.total, '') +
              summaryItem('Present', summary.present, 'sp-present') +
              summaryItem('Absent', summary.absent, 'sp-absent') +
              summaryItem('Leave', summary.leave, 'sp-leave') +
              summaryItem('Rate', Utils.pct(summary.present, summary.total) + '%', 'sp-rate') +
            '</div>'
          : UI.emptyState('No attendance today',
              'No attendance sheet has been submitted for this class today.', 'fa-clipboard'));

      const studentsLink = document.getElementById('classViewStudents');
      if (studentsLink) studentsLink.href = 'students.html?class=' + encodeURIComponent(cls.name);

      UI.modal.open('classViewModal');
    },

    async remove(name) {
      const cls = db.classes.find(name);
      if (!cls) return;
      const count = db.students.studentCount(name);

      const ok = await confirm({
        title: 'Delete ' + name + '?',
        message: count
          ? 'This class and its ' + count + ' student record(s) will be permanently deleted. Attendance history for this class will also be removed.'
          : 'This class will be permanently removed.',
        confirmText: 'Delete class',
        danger: true
      });
      if (!ok) return;

      /* Remember deliberately deleted core classes so the migration never
         re-creates them on the next page load. */
      if (CORE_CLASS_DEFS.some(d => d.name === name)) markRemovedCore(name);

      db.classes.remove(name);

      /* Cascade: drop attendance history for the deleted class */
      db.attendance.saveList(db.attendance.all().filter(r => r.className !== name));
      unassignTeacherEverywhere(name);

      toast('Class deleted.', 'success');
      Classes.render();
      Classes.buildFilters();
      syncSharedSelects();
    }
  };

  /* ---------- helpers ---------- */

  function parseList(raw, upper) {
    return String(raw || '')
      .split(',')
      .map(v => {
        const clean = v.replace(/\s+/g, ' ').trim();
        return upper ? clean.toUpperCase() : clean;
      })
      .filter((v, i, arr) => v && arr.indexOf(v) === i);
  }

  function generateCode(name) {
    const words = name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    let code = words.length > 1
      ? words[0][0] + words[1][0] + (words[1].replace(/\D/g, '') || '')
      : name.replace(/[^A-Za-z]/g, '').slice(0, 3);
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CLS';

    let unique = code;
    let n = 2;
    while (db.classes.all().some(c => c.code === unique)) {
      unique = code + n;
      n++;
    }
    return unique;
  }

  /* Keep the class ↔ teacher linkage in sync (teacher.classes holds names) */
  function assignTeacher(teacherName, className) {
    if (!teacherName) return;
    const list = db.teachers.all();
    let changed = false;
    list.forEach(t => {
      const has = (t.classes || []).indexOf(className) > -1;
      if (t.name === teacherName && !has) {
        t.classes = (t.classes || []).concat([className]);
        changed = true;
      }
    });
    if (changed) db.teachers.saveList(list);
  }

  function unassignTeacher(teacherName, className) {
    if (!teacherName) return;
    const list = db.teachers.all();
    let changed = false;
    list.forEach(t => {
      if (t.name === teacherName && (t.classes || []).indexOf(className) > -1 &&
          (t.classes || []).length > 1) {
        t.classes = t.classes.filter(c => c !== className);
        changed = true;
      }
    });
    if (changed) db.teachers.saveList(list);
  }

  function unassignTeacherEverywhere(className) {
    const list = db.teachers.all();
    let changed = false;
    list.forEach(t => {
      if ((t.classes || []).indexOf(className) > -1 && (t.classes || []).length > 1) {
        t.classes = t.classes.filter(c => c !== className);
        changed = true;
      }
    });
    if (changed) db.teachers.saveList(list);
  }

  function markRemovedCore(name) {
    const removed = Store.read(KEYS.removedCore, []);
    if (removed.indexOf(name) === -1) {
      removed.push(name);
      Store.write(KEYS.removedCore, removed);
    }
  }

  /* Class/subject selects exist on other pages — refresh them after changes */
  function syncSharedSelects() {
    const studentClass = document.getElementById('studentClassFilter');
    if (studentClass) {
      const current = studentClass.value;
      UI.optionList(studentClass, db.classes.names(), current, 'All classes');
    }
    const attClass = document.getElementById('attClassSelect');
    if (attClass) {
      const current = attClass.value;
      UI.optionList(attClass, db.classes.names(), current, 'Select class');
    }
  }

  function detail(label, value) {
    return '<div class="detail-item"><div class="dt-label">' + Utils.esc(label) + '</div>' +
      '<div class="dt-value">' + Utils.esc(value) + '</div></div>';
  }

  function summaryItem(label, value, cls) {
    return '<div class="summary-item ' + cls + '"><div class="s-label">' + Utils.esc(label) +
      '</div><div class="s-value">' + Utils.esc(String(value)) + '</div></div>';
  }

  function bindEvents() {
    const addBtn = document.getElementById('addClassBtn');
    if (addBtn) addBtn.addEventListener('click', () => Classes.openForm(null));

    const saveBtn = document.getElementById('saveClassBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => Classes.save());

    const form = document.getElementById('classForm');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); Classes.save(); });

    const search = document.getElementById('classSearch');
    if (search) {
      search.addEventListener('input', Utils.debounce(() => {
        state.search = search.value;
        Classes.render();
      }, 170));
    }

    const yearFilter = document.getElementById('classYearFilter');
    if (yearFilter) yearFilter.addEventListener('change', () => {
      state.year = yearFilter.value; Classes.render();
    });
    const groupFilter = document.getElementById('classGroupFilter');
    if (groupFilter) groupFilter.addEventListener('change', () => {
      state.group = groupFilter.value; Classes.render();
    });
    const statusFilter = document.getElementById('classStatusFilter');
    if (statusFilter) statusFilter.addEventListener('change', () => {
      state.status = statusFilter.value; Classes.render();
    });
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Classes.init));

  window.Classes = Classes;
})();
