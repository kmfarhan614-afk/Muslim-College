/* ==========================================================================
   teachers.js — teacher directory (add / edit / delete)
   ========================================================================== */

'use strict';

(function () {

  const Teachers = {
    init() {
      bindEvents();
      Teachers.render();
    },

    render() {
      const body = document.getElementById('teacherTableBody');
      if (!body) return;

      const teachers = db.teachers.all();

      if (!teachers.length) {
        body.innerHTML = '<tr><td colspan="7">' + UI.emptyState(
          'No teachers yet',
          'Click “Add Teacher” to build the faculty directory.',
          'fa-chalkboard-user') + '</td></tr>';
        return;
      }

      body.innerHTML = teachers.map(t =>
        '<tr>' +
          '<td class="num nowrap">' + Utils.esc(t.teacherId) + '</td>' +
          '<td><div class="td-main">' + Utils.esc(t.name) + '</div>' +
            (t.subject ? '<span class="td-sub">' + Utils.esc(t.subject) + '</span>' : '') + '</td>' +
          '<td class="nowrap">' + Utils.esc(t.email) + '</td>' +
          '<td class="nowrap">' + Utils.esc(t.phone || '—') + '</td>' +
          '<td>' + (t.classes && t.classes.length
            ? t.classes.map(c => '<span class="badge badge-blue" style="margin:2px 4px 2px 0">' +
                Utils.esc(c) + '</span>').join('')
            : '<span class="muted">—</span>') + '</td>' +
          '<td>' + UI.statusBadge(t.status || 'active') + '</td>' +
          '<td><div class="actions-cell">' +
            '<button type="button" class="icon-btn" title="Edit teacher" data-edit-teacher="' + Utils.esc(t.id) + '">' +
              '<i class="fa-solid fa-pen"></i></button>' +
            '<button type="button" class="icon-btn danger" title="Delete teacher" data-del-teacher="' + Utils.esc(t.id) + '">' +
              '<i class="fa-solid fa-trash-can"></i></button>' +
          '</div></td>' +
        '</tr>'
      ).join('');

      body.querySelectorAll('[data-edit-teacher]').forEach(b =>
        b.addEventListener('click', () => Teachers.openForm(b.dataset.editTeacher)));
      body.querySelectorAll('[data-del-teacher]').forEach(b =>
        b.addEventListener('click', () => Teachers.remove(b.dataset.delTeacher)));
    },

    openForm(id) {
      const form = document.getElementById('teacherForm');
      const title = document.getElementById('teacherModalTitle');
      UI.clearErrors(form);
      form.reset();

      const teacher = id ? db.teachers.find(id) : null;
      form.dataset.mode = teacher ? 'edit' : 'add';
      form.dataset.teacherId = teacher ? teacher.id : '';

      if (title) title.textContent = teacher ? 'Edit Teacher' : 'Add Teacher';

      /* Assigned class checkboxes */
      const host = document.getElementById('teacherClassList');
      host.innerHTML = db.classes.all().map(cls =>
        '<label class="checkbox-row">' +
          '<input type="checkbox" name="assignedClasses" value="' + Utils.esc(cls.name) + '">' +
          '<span>' + Utils.esc(cls.name) + '</span>' +
        '</label>'
      ).join('');

      if (teacher) {
        form.elements.teacherId.value = teacher.teacherId;
        form.elements.name.value = teacher.name;
        form.elements.subject.value = teacher.subject || '';
        form.elements.email.value = teacher.email;
        form.elements.phone.value = teacher.phone || '';
        form.elements.status.value = teacher.status || 'active';
        form.querySelectorAll('input[name="assignedClasses"]').forEach(cb => {
          cb.checked = (teacher.classes || []).indexOf(cb.value) > -1;
        });
      } else {
        form.elements.status.value = 'active';
        const nextNum = String(db.teachers.count() + 1).padStart(3, '0');
        form.elements.teacherId.value = 'TCH-' + nextNum;
      }

      UI.modal.open('teacherModal');
    },

    save() {
      const form = document.getElementById('teacherForm');
      const editing = form.dataset.mode === 'edit';
      const editId = form.dataset.teacherId;

      UI.clearErrors(form);

      const assigned = Array.prototype.slice
        .call(form.querySelectorAll('input[name="assignedClasses"]:checked'))
        .map(cb => cb.value);

      const payload = {
        teacherId: form.elements.teacherId.value.trim(),
        name: form.elements.name.value.trim(),
        subject: form.elements.subject.value.trim(),
        email: form.elements.email.value.trim().toLowerCase(),
        phone: form.elements.phone.value.trim(),
        classes: assigned,
        status: form.elements.status.value
      };

      let ok = true;
      const all = db.teachers.all();

      if (!/^TCH-?\d{2,6}$/i.test(payload.teacherId)) {
        UI.fieldError(form.elements.teacherId, 'Use a format like TCH-013.');
        ok = false;
      } else if (all.some(t => t.teacherId.toLowerCase() === payload.teacherId.toLowerCase() && t.id !== editId)) {
        UI.fieldError(form.elements.teacherId, 'This Teacher ID already exists.');
        ok = false;
      }
      if (payload.name.length < 3) {
        UI.fieldError(form.elements.name, 'Enter the full teacher name.');
        ok = false;
      }
      if (!form.elements.email.checkValidity()) {
        UI.fieldError(form.elements.email, 'Enter a valid email address.');
        ok = false;
      } else if (all.some(t => t.email === payload.email && t.id !== editId)) {
        UI.fieldError(form.elements.email, 'This email is already registered.');
        ok = false;
      }
      if (payload.phone && !/^03\d{9}$/.test(payload.phone.replace(/[\s-]/g, ''))) {
        UI.fieldError(form.elements.phone, 'Use format 03XXXXXXXXX (11 digits).');
        ok = false;
      }
      if (!payload.classes.length) {
        UI.fieldError(form.querySelector('input[name="assignedClasses"]'),
          'Assign at least one class to this teacher.');
        ok = false;
      }
      if (!ok) return;

      const previous = editing ? db.teachers.find(editId) : null;

      if (editing) {
        db.teachers.update(editId, payload);
        toast('Teacher updated successfully.', 'success');
      } else {
        payload.id = 'tch_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        db.teachers.insert(payload);
        toast('Teacher added successfully.', 'success');
      }

      syncClassTeachers(payload, previous ? previous.name : null);

      UI.modal.close('teacherModal');
      Teachers.render();
    },

    async remove(id) {
      const teacher = db.teachers.find(id);
      if (!teacher) return;
      const ok = await confirm({
        title: 'Delete teacher?',
        message: teacher.name + ' (' + teacher.teacherId + ') will be removed from the faculty directory.',
        confirmText: 'Delete',
        danger: true
      });
      if (!ok) return;
      db.teachers.remove(id);
      clearClassTeacher(teacher.name);
      toast('Teacher deleted.', 'success');
      Teachers.render();
    }
  };

  /* Keep each class's assigned-teacher label in sync with the directory. */
  function syncClassTeachers(teacher, previousName) {
    const assigned = teacher.classes || [];
    db.classes.all().forEach(cls => {
      if (assigned.indexOf(cls.name) > -1) {
        if (!cls.teacher || cls.teacher === previousName) {
          db.classes.update(cls.name, { teacher: teacher.name });
        }
      } else if (cls.teacher === teacher.name || (previousName && cls.teacher === previousName)) {
        db.classes.update(cls.name, { teacher: '' });
      }
    });
  }

  function clearClassTeacher(name) {
    db.classes.all().forEach(cls => {
      if (cls.teacher === name) db.classes.update(cls.name, { teacher: '' });
    });
  }

  function bindEvents() {
    const addBtn = document.getElementById('addTeacherBtn');
    if (addBtn) addBtn.addEventListener('click', () => Teachers.openForm(null));

    const saveBtn = document.getElementById('saveTeacherBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => Teachers.save());

    const form = document.getElementById('teacherForm');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); Teachers.save(); });
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Teachers.init));

  window.Teachers = Teachers;
})();
