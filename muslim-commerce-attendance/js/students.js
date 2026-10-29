/* ==========================================================================
   students.js — student list, search/filter, CRUD, profile, import/export
   --------------------------------------------------------------------------
   Designed for a register of 2 000 - 10 000 students:
     • Filtering, searching and paging run through the indexed data layer
       (db.students.query) instead of scanning the whole register.
     • Only one page of rows is rendered at a time.
     • Photographs live in the photo store (js/photos.js), never inside the
       register itself.
     • Bulk import writes the register once, not once per student.
   ========================================================================== */

'use strict';

(function () {

  const DEFAULT_PAGE_SIZE = 100;
  let photoData = '';
  let photoDirty = false;
  let profileId = '';
  let storageStat = { percent: 0, label: '—', detail: '' };

  const state = {
    search: '',
    className: '',
    session: '',
    section: '',
    status: '',
    sort: 'register',
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
    /* 'active' = normal register, 'archived' = soft-deleted students */
    view: 'active',
    /* Rows parsed from the import file, waiting for confirmation. */
    importRows: []
  };

  const Students = {
    saving: false,

    init() {
      const classFilter = document.getElementById('studentClassFilter');
      const params = new URLSearchParams(window.location.search);
      const wanted = params.get('class');
      const selected = wanted && db.classes.find(wanted) ? wanted : '';
      UI.optionList(classFilter, db.classes.names(), selected, 'All classes');
      state.className = classFilter.value;

      const sessionFilter = document.getElementById('studentSessionFilter');
      if (sessionFilter) {
        const names = sessionOptions();
        const wantedSession = params.get('session') || '';
        UI.optionList(sessionFilter, names,
          wantedSession && names.indexOf(wantedSession) > -1 ? wantedSession : '',
          'All sessions');
        state.session = sessionFilter.value;
      }

      UI.optionList(document.getElementById('studentStatusFilter'),
        [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }], '', 'All statuses');

      const sortSelect = document.getElementById('studentSort');
      if (sortSelect) {
        const storedSort = Store.read('mca_student_sort', '');
        if (storedSort && sortSelect.querySelector('option[value="' + storedSort + '"]')) {
          sortSelect.value = storedSort;
        }
        state.sort = sortSelect.value || 'register';
      }

      const sizeSelect = document.getElementById('studentPageSize');
      if (sizeSelect) {
        const stored = parseInt(Store.read('mca_student_page_size', ''), 10);
        if (stored && sizeSelect.querySelector('option[value="' + stored + '"]')) {
          sizeSelect.value = String(stored);
        }
        state.limit = parseInt(sizeSelect.value, 10) || DEFAULT_PAGE_SIZE;
      }

      updateSectionFilter();

      bindEvents();
      Students.render();
      notifyReview();
    },

    /* The filters currently applied to the register. */
    filters() {
      return {
        q: state.search,
        className: state.className,
        session: state.session,
        section: state.section,
        status: state.status,
        sort: state.sort,
        view: state.view
      };
    },

    /* Every row matching the filters — used by print and export, which need
       the complete set and not just the visible page. */
    filtered(source) {
      if (source) {
        const f = state;
        const q = f.search.trim().toLowerCase();
        return source.filter(s => {
          if (f.className && s.class !== f.className) return false;
          if (f.session && String(s.session || '') !== f.session) return false;
          if (f.section && s.section !== f.section) return false;
          if (f.view === 'active' && f.status && String(s.status || 'active') !== f.status) return false;
          if (q) {
            const haystack = [s.name, s.studentId, s.rollNo, s.phone, s.mobile, s.fatherName, s.address]
              .join(' ').toLowerCase();
            if (haystack.indexOf(q) === -1) return false;
          }
          return true;
        });
      }
      return db.students.select(Students.filters());
    },

    /* Active roster for printing — always the active list, never archived. */
    printRows() {
      return db.students.select(Object.assign({}, Students.filters(), { view: 'active' }));
    },

    render() {
      const result = db.students.query(Object.assign({}, Students.filters(), {
        page: state.page,
        limit: state.limit
      }));
      state.page = result.page;

      const stats = db.attendance.perStudentMap();
      const slice = result.rows;
      const body = document.getElementById('studentTableBody');

      if (!slice.length) {
        const emptyArchived = state.view === 'archived';
        const noFilters = !state.search && !state.className && !state.session && !state.section && !state.status;
        body.innerHTML = '<tr><td colspan="10">' + UI.emptyState(
          emptyArchived ? 'No archived students'
            : (result.total === 0 && noFilters ? 'No students added yet' : 'No students found'),
          emptyArchived
            ? 'Soft-deleted students appear here. Restore one to return them to the active register.'
            : (result.total === 0 && noFilters
                ? 'Your student register is empty. Click “+ Add Student” to register the first student.'
                : 'No students match your current search or filters. Try clearing them.'),
          emptyArchived ? 'fa-box-archive' : 'fa-user-graduate'
        ) + '</td></tr>';
      } else {
        body.innerHTML = slice.map(s => {
          const m = stats[s.studentId] || { present: 0, total: 0 };
          const pct = m.total ? Utils.pct(m.present, m.total) : null;
          const hasRoll = s.rollNo !== '' && s.rollNo != null;
          const archived = db.students.isArchived(s);
          const sub = archived && s.deletedAt
            ? 'Archived ' + Utils.esc(Utils.fmtDateShort(String(s.deletedAt).slice(0, 10)))
            : Utils.esc(s.studentId);
          const actions = archived
            ? '<button type="button" class="icon-btn" title="View profile" data-profile="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-id-card"></i></button>' +
              '<button type="button" class="icon-btn" title="Print profile" data-print-profile="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-print"></i></button>' +
              '<button type="button" class="icon-btn restore" title="Restore student" data-restore="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-rotate-left"></i></button>'
            : '<button type="button" class="icon-btn" title="View profile" data-profile="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-id-card"></i></button>' +
              '<button type="button" class="icon-btn" title="Print profile" data-print-profile="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-print"></i></button>' +
              '<button type="button" class="icon-btn" title="Edit student" data-edit="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-pen"></i></button>' +
              '<button type="button" class="icon-btn danger" title="Delete student" data-delete="' + Utils.esc(s.id) + '">' +
                '<i class="fa-solid fa-trash-can"></i></button>';
          return '<tr>' +
            '<td>' +
              '<div style="display:flex;align-items:center;gap:10px">' +
                avatarHtml(s) +
                '<span><span class="td-main">' + Utils.esc(s.name) + '</span>' +
                '<span class="td-sub">' + sub + '</span></span>' +
              '</div>' +
            '</td>' +
            '<td>' + Utils.esc(s.fatherName || '—') + '</td>' +
            '<td class="num">' + (hasRoll ? Utils.esc(s.rollNo) : '<span class="muted">—</span>') + '</td>' +
            '<td>' + Utils.esc(s.class) + '</td>' +
            '<td>' + Utils.sectionCell(s.section) + '</td>' +
            '<td class="nowrap">' + contactCell(s) + '</td>' +
            '<td>' + addressCell(s) + '</td>' +
            '<td>' + (pct === null
              ? '<span class="muted">—</span>'
              : '<span class="badge ' + (pct >= 90 ? 'badge-green' : pct >= 75 ? 'badge-blue' : 'badge-red') + '">' + pct + '%</span>') + '</td>' +
            '<td>' + (archived ? '<span class="badge badge-gray">Archived</span>' : UI.statusBadge(s.status)) + '</td>' +
            '<td>' +
              '<div class="actions-cell">' + actions + '</div>' +
            '</td>' +
          '</tr>';
        }).join('');
      }

      /* Footer + pagination */
      const label = state.view === 'archived' ? ' archived student' : ' students';
      setText('studentCount', result.total
        ? 'Showing ' + Utils.fmtNumber(result.start) + '–' + Utils.fmtNumber(result.end) +
          ' of ' + Utils.fmtNumber(result.total) + label
        : 'No ' + label.trim());
      renderPagination(result.pages);
      syncArchiveUI();
      renderStats();

      body.querySelectorAll('[data-profile]').forEach(b =>
        b.addEventListener('click', () => Students.openProfile(b.dataset.profile)));
      body.querySelectorAll('[data-print-profile]').forEach(b =>
        b.addEventListener('click', () => Students.printProfile(b.dataset.printProfile)));
      body.querySelectorAll('[data-edit]').forEach(b =>
        b.addEventListener('click', () => Students.openForm(b.dataset.edit)));
      body.querySelectorAll('[data-delete]').forEach(b =>
        b.addEventListener('click', () => Students.remove(b.dataset.delete)));
      body.querySelectorAll('[data-restore]').forEach(b =>
        b.addEventListener('click', () => Students.restore(b.dataset.restore)));

      hydratePhotos(body);
    },

    /* ---------- Add / edit form ---------- */
    async openForm(id) {
      const form = document.getElementById('studentForm');
      const title = document.getElementById('studentModalTitle');
      UI.clearErrors(form);
      form.reset();
      photoData = '';
      photoDirty = false;

      const classSelect = form.elements.class;
      UI.optionList(classSelect, db.classes.names(), '', 'Select class');

      const student = id ? db.students.find(id) : null;
      form.dataset.mode = student ? 'edit' : 'add';
      form.dataset.studentId = student ? student.id : '';

      if (title) title.textContent = student ? 'Edit Student' : 'Add Student';

      if (student) {
        ['studentId', 'rollNo', 'name', 'fatherName', 'dob', 'gender', 'class',
          'section', 'phone', 'phoneRes', 'mobile', 'address', 'status', 'admissionDate'].forEach(f => {
          if (!form.elements[f]) return;
          if (f === 'phone') form.elements[f].value = student.phoneRes || student.phone || '';
          else if (f === 'phoneRes') form.elements[f].value = student.phoneRes || student.phone || '';
          else form.elements[f].value = student[f] == null ? '' : student[f];
        });
        if (window.Photos) {
          try { photoData = await Photos.loadFor(student); }
          catch (err) { photoData = student.photo || ''; }
        } else {
          photoData = student.photo || '';
        }
        syncFormSections(student.section);
      } else {
        form.elements.status.value = 'active';
        form.elements.gender.value = '';
        syncFormSections();
      }
      renderPhotoPreview();
      updateRollPreview();

      UI.modal.open('studentModal');
    },

    async save() {
      if (Students.saving) return;
      const form = document.getElementById('studentForm');
      const editing = form.dataset.mode === 'edit';
      const editId = form.dataset.studentId;

      const errors = validate(form, editing, editId);
      if (errors) return; /* validate() already rendered the field errors */

      const className = form.elements.class.value;
      const section = form.elements.section.disabled ? '' : form.elements.section.value;
      const studentId = form.elements.studentId.value.trim();
      const existing = editing ? db.students.find(editId) : null;
      const activeSession = db.sessions.active();
      /* A student joins the class' current academic session so their roll
         number is sequenced together with the rest of that class. */
      const session = existing ? (existing.session || '') : (activeSession ? activeSession.name : '');

      const residential = form.elements.phone ? form.elements.phone.value.trim() : '';
      const payload = {
        studentId: studentId,
        rollNo: existing ? existing.rollNo : '',
        name: form.elements.name.value.trim(),
        fatherName: form.elements.fatherName.value.trim(),
        dob: form.elements.dob.value,
        gender: form.elements.gender.value,
        class: className,
        section: section,
        phone: residential,
        phoneRes: residential,
        mobile: form.elements.mobile ? form.elements.mobile.value.trim() : '',
        address: form.elements.address.value.trim(),
        admissionDate: form.elements.admissionDate.value,
        photo: '',
        status: form.elements.status.value,
        session: session
      };

      Students.saving = true;
      try {
        if (editing) {
          const oldStudentId = existing.studentId;
          const oldClass = existing.class;
          const oldSection = existing.section;
          const oldSession = existing.session;

          payload.id = existing.id;
          await applyPhoto(payload, existing);
          db.students.update(editId, payload);
          /* Correcting a Student ID carries the attendance history across. */
          if (String(oldStudentId) !== String(studentId)) {
            db.attendance.renumberStudent(oldStudentId, studentId);
          }
          db.students.resequence(className, section, session);
          /* Leaving a class/section/session closes the gap left behind. */
          if (oldClass !== className || oldSection !== section || (oldSession || '') !== (session || '')) {
            db.students.resequence(oldClass, oldSection, oldSession);
          }
          UI.modal.close('studentModal');
          Students.render();
          refreshStorageStat();
          toast('Student information updated successfully!', 'success');
          return;
        }

        /* Re-adding a removed student: offer to restore the archived record
           instead of creating a duplicate. */
        const archivedDup = findArchivedDuplicate(payload, studentId);
        if (archivedDup) {
          const ok = await confirm({
            title: 'Restore student?',
            message: 'A removed student with these details already exists. ' +
              'Restore their archived record instead of creating a duplicate?',
            detail: archivedDup.name + ' · ' + archivedDup.studentId,
            confirmText: 'Restore Student',
            cancelText: 'Add as new'
          });
          if (ok) {
            payload.id = archivedDup.id;
            await applyPhoto(payload, archivedDup);
            db.students.update(archivedDup.id, Object.assign({}, payload, {
              studentId: archivedDup.studentId,
              status: payload.status || 'active',
              deletedAt: '',
              deletedBy: ''
            }));
            db.students.resequence(className, section, session);
            UI.modal.close('studentModal');
            Students.render();
            refreshStorageStat();
            toast('Student restored successfully!', 'success', 'Restored');
            return;
          }
          /* The Student ID already exists in the archive — never overwrite
             or duplicate it. */
          UI.fieldError(form.elements.studentId,
            'This Student ID already exists. Please enter a unique Student ID.');
          return;
        }

        payload.id = uniqueInternalId(studentId);
        await applyPhoto(payload, null);
        db.students.insert(payload);
        db.students.resequence(className, section, session);
        UI.modal.close('studentModal');
        Students.render();
        refreshStorageStat();
        toast('Student added successfully!', 'success');
      } catch (err) {
        console.error('[MCA] could not save student', err);
        toast('Could not save the student. Please try again.', 'error');
      } finally {
        Students.saving = false;
      }
    },

    /* Soft-delete (archive): the record and its attendance history are kept
       so past reports stay intact; the student just leaves the active lists. */
    async remove(id) {
      const student = db.students.find(id);
      if (!student) return;
      const ok = await confirm({
        title: 'Delete Student?',
        message: 'Are you sure you want to remove this student from the active student list? ' +
          'This action will not delete their previous attendance records.',
        detail: student.name + ' · ' + student.studentId,
        confirmText: 'Delete Student',
        cancelText: 'Cancel',
        danger: true
      });
      if (!ok) return;
      db.students.archive(id);
      toast('Student removed successfully.', 'success', 'Deleted');
      Students.render();
      refreshStorageStat();
    },

    async restore(id) {
      const student = db.students.find(id);
      if (!student) return;
      const ok = await confirm({
        title: 'Restore Student?',
        message: 'This student will be returned to the active student list. Their attendance history is unchanged.',
        detail: student.name + ' · ' + student.studentId,
        confirmText: 'Restore Student',
        cancelText: 'Cancel'
      });
      if (!ok) return;
      db.students.restore(id);
      toast('Student restored successfully.', 'success', 'Restored');
      Students.render();
      refreshStorageStat();
    },

    /* Switch between the active register and the archived (soft-deleted) list. */
    toggleView() {
      state.view = state.view === 'archived' ? 'active' : 'archived';
      state.page = 1;
      state.status = '';
      const statusFilter = document.getElementById('studentStatusFilter');
      if (statusFilter) statusFilter.value = '';
      Students.render();
      if (state.view === 'archived') {
        toast('Showing archived students. Use the restore button to reactivate one.', 'info', 'Archived');
      }
    },

    /* ---------- Print student list ---------- */
    printList() {
      const rows = Students.printRows();
      if (!rows.length) {
        toast('There are no students to print with the current filters.', 'warning', 'Nothing to print');
        return;
      }
      setText('printStudentsScope',
        (state.className || 'All classes') +
        (state.session ? ' · ' + state.session : '') +
        ' · ' + Utils.fmtNumber(rows.length) + ' student' + (rows.length > 1 ? 's' : ''));
      UI.modal.open('printStudentsModal');
    },

    printConfirm() {
      const rows = Students.printRows();
      if (!rows.length) {
        toast('There are no students to print with the current filters.', 'warning', 'Nothing to print');
        return;
      }
      const include = {
        roll: !!(document.getElementById('pcolRoll') || {}).checked,
        phone: !!(document.getElementById('pcolPhone') || {}).checked,
        address: !!(document.getElementById('pcolAddress') || {}).checked
      };
      UI.modal.close('printStudentsModal');
      Print.studentList({ students: rows, className: state.className, include: include });
    },

    /* ---------- CSV export ---------- */
    exportCSV() {
      const rows = Students.printRows();
      if (!rows.length) {
        toast('There are no students to export with the current filters.', 'warning', 'Nothing to export');
        return;
      }
      const out = [[
        'Student ID', 'Student Name', 'Father Name', 'Class', 'Section', 'Roll No',
        'Contact Number', 'Residential Phone', 'Permanent Address',
        'Admission Date', 'Academic Session', 'Status'
      ]];
      rows.forEach(s => {
        out.push([
          s.studentId || '', s.name || '', s.fatherName || '', s.class || '', s.section || '',
          s.rollNo === '' || s.rollNo == null ? '' : s.rollNo,
          s.mobile || '', s.phoneRes || s.phone || '', s.address || '',
          s.admissionDate || '', s.session || '', s.status || 'active'
        ]);
      });
      UI.exportCSV('students-' + Utils.todayISO() + '.csv', out);
      toast(Utils.fmtNumber(rows.length) + ' student(s) exported.', 'success', 'Export complete');
    },

    /* ---------- Profile ---------- */
    openProfile(id) {
      const s = db.students.find(id);
      const host = document.getElementById('profileContent');
      if (!s || !host) return;

      const map = db.attendance.perStudentMap();
      const m = map[s.studentId] || { present: 0, absent: 0, leave: 0, total: 0 };
      const rate = m.total ? Utils.pct(m.present, m.total) : 0;
      const history = db.attendance.byStudent(s.studentId).slice(0, 20);

      const historyRows = history.length
        ? history.map(rec => {
            const entry = rec.entries.find(e => e.studentId === s.studentId);
            return '<tr>' +
              '<td class="nowrap">' + Utils.esc(Utils.fmtDateShort(rec.date)) + '</td>' +
              '<td>' + Utils.esc(rec.subject) + '</td>' +
              '<td>' + UI.statusBadge(entry ? entry.status : '—') + '</td>' +
              '<td class="muted">' + Utils.esc((entry && entry.remarks) || '—') + '</td>' +
            '</tr>';
          }).join('')
        : '<tr><td colspan="4">' + UI.emptyState(
            'No attendance history',
            'This student does not have any recorded attendance yet.',
            'fa-calendar-xmark') + '</td></tr>';

      host.innerHTML =
        '<div class="profile-head">' +
          avatarHtml(s, 'lg') +
          '<div>' +
            '<div class="profile-name">' + Utils.esc(s.name) + '</div>' +
            '<div class="profile-id">' + Utils.esc(s.studentId) +
              (s.rollNo !== '' && s.rollNo != null ? ' · Roll No. ' + Utils.esc(s.rollNo) : '') + '</div>' +
            '<div class="profile-badges">' +
              '<span class="badge badge-blue">' + Utils.esc(s.class) + '</span>' +
              Utils.sectionCell(s.section) +
              UI.statusBadge(s.status) +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="detail-grid">' +
          detail('Student ID', s.studentId) +
          detail('Father’s Name', s.fatherName) +
          detail('Date of Birth', s.dob ? Utils.fmtDate(s.dob) : '') +
          detail('Admission Date', s.admissionDate ? Utils.fmtDate(s.admissionDate) : '') +
          detail('Gender', s.gender) +
          detail('Academic Session', s.session) +
          detail('Contact Number', s.mobile) +
          detail('Residential Phone', s.phoneRes || s.phone) +
          detail('Permanent Address', s.address) +
        '</div>' +
        reviewBanner(s) +

        '<div class="section-label">Attendance summary</div>' +
        '<div class="summary-grid">' +
          summaryItem('Total Classes', m.total, '') +
          summaryItem('Present', m.present, 'sp-present') +
          summaryItem('Absent', m.absent, 'sp-absent') +
          summaryItem('Leave', m.leave, 'sp-leave') +
          summaryItem('Attendance %', m.total ? rate + '%' : '—', 'sp-rate') +
        '</div>' +

        '<div class="section-label">Attendance history' +
          (db.attendance.byStudent(s.studentId).length > 20 ? ' (latest 20)' : '') + '</div>' +
        '<div class="table-scroll"><table class="data-table"><thead><tr>' +
          '<th>Date</th><th>Subject</th><th>Status</th><th>Remarks</th>' +
        '</tr></thead><tbody>' + historyRows + '</tbody></table></div>';

      UI.modal.open('profileModal');
      profileId = s.id;
      hydratePhotos(host);
    },

    /* Print an official student profile / portfolio for one student. */
    async printProfile(id) {
      const s = db.students.find(id);
      if (!s) return;
      let record = s;
      if (window.Photos && !s.photo) {
        try {
          const data = await Photos.loadFor(s);
          if (data) record = Object.assign({}, s, { photo: data });
        } catch (err) { /* print without the photograph */ }
      }
      Print.studentProfile(record);
    }
  };

  /* ---------- helpers ---------- */

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /* The image source of a student, whether the photograph is stored in the
     photo store or (legacy) inline in the register. */
  function photoSrc(student) {
    if (!student) return '';
    if (window.Photos) return Photos.src(student);
    return student.photo || '';
  }

  /* Reflect the active/archived mode in the header button, banner and filters. */
  function syncArchiveUI() {
    const archived = state.view === 'archived';
    const banner = document.getElementById('archiveNotice');
    if (banner) banner.hidden = !archived;

    const statusItem = document.getElementById('studentStatusFilterItem');
    if (statusItem) statusItem.hidden = archived;

    const addBtn = document.getElementById('addStudentBtn');
    if (addBtn) addBtn.hidden = archived;

    const printBtn = document.getElementById('printStudentsBtn');
    if (printBtn) printBtn.hidden = archived;

    const exportBtn = document.getElementById('exportStudentsBtn');
    if (exportBtn) exportBtn.hidden = archived;

    const importBtn = document.getElementById('importStudentsBtn');
    if (importBtn) importBtn.hidden = archived;

    const toggle = document.getElementById('archivedToggleBtn');
    if (toggle) {
      toggle.innerHTML = archived
        ? '<i class="fa-solid fa-arrow-left"></i> Back to Active'
        : '<i class="fa-solid fa-box-archive"></i> Archived Students';
    }
  }

  /* Register totals + browser storage usage. */
  function renderStats() {
    const all = db.students.all();
    let archivedCount = 0;
    for (let i = 0; i < all.length; i++) {
      if (all[i] && all[i].deletedAt) archivedCount++;
    }
    const activeCount = all.length - archivedCount;
    setText('statTotal', Utils.fmtNumber(all.length));
    setText('statActive', Utils.fmtNumber(activeCount));
    setText('statArchived', Utils.fmtNumber(archivedCount));
    setText('statStorage', storageStat.label);
    setText('statStorageSub', storageStat.detail);
  }

  /* Reads the browser storage usage. Reading every key is expensive, so this
     runs on load and after a change — not on every keystroke. */
  function refreshStorageStat() {
    try {
      const usage = Store.usage();
      const percent = usage.quota ? Math.round((usage.total / usage.quota) * 100) : 0;
      const mb = (usage.total / (1024 * 1024)).toFixed(1);
      storageStat = {
        percent: percent,
        label: percent + '%',
        detail: mb + ' MB of ' + (usage.quota / (1024 * 1024)).toFixed(0) + ' MB used'
      };
    } catch (err) {
      storageStat = { percent: 0, label: '—', detail: 'Storage usage unavailable' };
    }
    renderStats();
  }

  function detail(label, value) {
    return '<div class="detail-item"><div class="dt-label">' + Utils.esc(label) + '</div>' +
      '<div class="dt-value">' + Utils.esc(displayValue(value)) + '</div></div>';
  }

  /* Any value a student may legitimately not have shows as “Not Provided”,
     never “undefined”, “null” or “NaN”. */
  function displayValue(value) {
    if (value === undefined || value === null) return 'Not Provided';
    const text = String(value).trim();
    if (!text || text === 'undefined' || text === 'null' || text === 'NaN') return 'Not Provided';
    return text;
  }

  /* Show the roll number this Student ID will receive, read-only. Roll numbers
     are never typed — they are derived from the ascending Student-ID order of
     the class + section + academic session. */
  function updateRollPreview() {
    const form = document.getElementById('studentForm');
    if (!form) return;
    const rollInput = form.elements.rollNo;
    if (!rollInput) return;

    const className = form.elements.class.value;
    const section = form.elements.section.disabled ? '' : form.elements.section.value;
    const studentId = form.elements.studentId.value.trim();
    const editId = form.dataset.mode === 'edit' ? form.dataset.studentId : '';
    const existing = editId ? db.students.find(editId) : null;
    const activeSession = db.sessions.active();
    const session = existing ? (existing.session || '') : (activeSession ? activeSession.name : '');

    if (!className || !studentId) { rollInput.value = ''; return; }
    rollInput.value = db.students.rollFor(className, section, session, studentId, editId);
  }

  /* Internal id derived from the Student ID, guaranteed free across the full
     register (archived students included). */
  function uniqueInternalId(studentId) {
    const base = 'stu_' + String(studentId).toLowerCase().replace(/[^a-z0-9]+/g, '_');
    let id = base;
    let n = 2;
    while (db.students.find(id)) { id = base + '_' + n; n++; }
    return id;
  }

  /* An archived record that shares the entered Student ID, so re-adding it can
     offer a restore instead of creating a duplicate. Matching is by Student ID
     only — a name/class coincidence never silently replaces an entered ID. */
  function findArchivedDuplicate(payload, studentId) {
    const sid = db.students.normaliseId(studentId);
    if (!sid) return null;
    const hit = db.students.findAnyByStudentId(studentId);
    if (hit && db.students.isArchived(hit)) return hit;
    return null;
  }

  /* Moves the photograph of the form into the photo store and points the
     student record at it. */
  async function applyPhoto(payload, existing) {
    const key = (existing && existing.photoKey) || ('ph_' + payload.id);
    if (!photoDirty) {
      if (existing) {
        payload.photoKey = existing.photoKey || '';
        payload.photo = '';
      }
      return;
    }
    if (!photoData) {
      await removePhoto(key);
      payload.photoKey = '';
      payload.photo = '';
      return;
    }
    const ok = window.Photos ? await Photos.set(key, photoData) : false;
    if (!ok) {
      toast('The photograph could not be stored. The student record was saved without it.', 'warning');
    }
    payload.photoKey = key;
    payload.photo = '';
  }

  async function removePhoto(key) {
    if (window.Photos && key) await Photos.remove(key);
  }

  function summaryItem(label, value, cls) {
    return '<div class="summary-item ' + cls + '"><div class="s-label">' + Utils.esc(label) +
      '</div><div class="s-value">' + Utils.esc(String(value)) + '</div></div>';
  }

  /* Students are listed in ascending Student-ID order (numeric, not
     alphabetic) — the same order that produces their roll numbers. */
  function byIdThenName(a, b) { return db.students.idCompare(a, b); }

  /* Contact cell: the student's own contact number with the residential
     phone beneath it. */
  function contactCell(s) {
    const parts = [];
    if (s.mobile) parts.push('<span class="td-main">' + Utils.esc(s.mobile) + '</span>');
    const residential = s.phoneRes || s.phone;
    if (residential) {
      parts.push('<span class="td-sub">Res. ' + Utils.esc(residential) + '</span>');
    }
    if (!parts.length) return '<span class="muted">—</span>';
    if (s.mobile && residential) return parts.join('');
    if (!s.mobile && residential) return '<span class="td-main">' + Utils.esc(residential) + '</span>';
    return parts.join('');
  }

  /* Address cell with a small warning marker when the source was unclear. */
  function addressCell(s) {
    const text = s.address ? Utils.esc(s.address) : '<span class="muted">—</span>';
    const flag = s.needsReview
      ? ' <i class="fa-solid fa-triangle-exclamation" style="color:var(--color-absent,#dc2626)" title="Needs manual verification"></i>'
      : '';
    return text + flag;
  }

  /* Profile note listing the fields that still need manual verification. */
  function reviewBanner(s) {
    if (!s.needsReview || !(s.reviewNotes && s.reviewNotes.length)) return '';
    return '<div class="section-label">Needs verification</div>' +
      '<div class="review-note" style="border:1px solid var(--color-border,#e3e9f1);' +
        'border-left:3px solid var(--color-leave,#f59e0b);border-radius:8px;' +
        'padding:10px 14px;background:var(--color-surface-alt,#f8fafc)">' +
      '<ul style="margin:0;padding-left:18px">' +
        s.reviewNotes.map(n => '<li>' + Utils.esc(n) + '</li>').join('') +
      '</ul></div>';
  }

  /* One gentle reminder per visit when imported records still need review. */
  function notifyReview() {
    const review = db.students.all().filter(s => s && s.needsReview).length;
    const marker = Store.read('mca_cs_import', null);
    const conflicts = marker && marker.conflicts ? marker.conflicts.length : 0;
    if (!review && !conflicts) return;
    const parts = [];
    if (review) parts.push(review + ' imported record(s) need manual verification (unclear address or unverified phone).');
    if (conflicts) parts.push(conflicts + ' record(s) share an existing Student ID and were left unchanged.');
    setTimeout(() => toast(parts.join(' '), 'warning', 'Review needed'), 600);
  }

  /* Avatar: the student's photo when present, otherwise their initials.
     A photograph that is not in memory yet is marked with its key and
     fetched in the background by hydratePhotos(). */
  function avatarHtml(s, extra) {
    const klass = 'avatar' + (extra ? ' ' + extra : '');
    const src = photoSrc(s);
    if (src) {
      return '<span class="' + klass + '"><img src="' + Utils.esc(src) + '" alt=""></span>';
    }
    const key = window.Photos ? Photos.keyFor(s) : '';
    if (key) {
      return '<span class="' + klass + '" data-photo-key="' + Utils.esc(key) + '">' +
        Utils.esc(Utils.initials(s.name)) + '</span>';
    }
    return '<span class="' + klass + '">' + Utils.esc(Utils.initials(s.name)) + '</span>';
  }

  /* Fills the thumbnails of the rows currently on screen. Only the visible
     photographs are loaded, so a register with thousands of students never
     holds thousands of images in memory. */
  async function hydratePhotos(root) {
    if (!window.Photos) return;
    const nodes = (root || document).querySelectorAll('[data-photo-key]:not([data-photo-done])');
    if (!nodes.length) return;
    const list = Array.prototype.slice.call(nodes);
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      const key = node.getAttribute('data-photo-key');
      if (!key) continue;
      node.setAttribute('data-photo-done', '1');
      let data = '';
      try { data = await Photos.load(key); }
      catch (err) { data = ''; }
      if (!data) continue;
      node.innerHTML = '<img src="' + Utils.esc(data) + '" alt="">';
    }
  }

  /* Reflect the currently-held photo into the modal preview. */
  function renderPhotoPreview() {
    const preview = document.getElementById('fPhotoPreview');
    const clearBtn = document.getElementById('fPhotoClear');
    if (!preview) return;
    const nameInput = document.getElementById('fName');
    if (photoData) {
      preview.innerHTML = '<img src="' + Utils.esc(photoData) + '" alt="">';
    } else {
      preview.textContent = Utils.initials((nameInput && nameInput.value) || '?');
    }
    if (clearBtn) clearBtn.hidden = !photoData;
  }

  async function readPhotoFile(file) {
    if (!window.Photos) {
      const reader = new FileReader();
      reader.onload = () => { photoData = reader.result; photoDirty = true; renderPhotoPreview(); };
      reader.onerror = () => toast('Could not read that image file.', 'error');
      reader.readAsDataURL(file);
      return;
    }
    try {
      const compressed = await Photos.compress(file);
      photoData = compressed;
      photoDirty = true;
      renderPhotoPreview();
    } catch (err) {
      toast(err.message || 'Could not read that image file.', 'error');
    }
  }

  function renderPagination(totalPages) {
    const host = document.getElementById('pagination');
    if (!host) return;
    if (totalPages <= 1) { host.innerHTML = ''; return; }

    const page = state.page;
    const numbers = [];
    const add = p => {
      if (p >= 1 && p <= totalPages && numbers.indexOf(p) === -1) numbers.push(p);
    };

    add(1);
    for (let p = page - 1; p <= page + 1; p++) add(p);
    add(totalPages);

    const pages = numbers.map(p => '<button type="button" class="page-btn' +
      (p === page ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>');

    host.innerHTML =
      '<button type="button" class="page-btn" data-step="-1"' + (page === 1 ? ' disabled' : '') +
        ' aria-label="Previous page"><i class="fa-solid fa-chevron-left"></i></button>' +
      pages.join('') +
      '<button type="button" class="page-btn" data-step="1"' + (page === totalPages ? ' disabled' : '') +
        ' aria-label="Next page"><i class="fa-solid fa-chevron-right"></i></button>';

    host.querySelectorAll('[data-page]').forEach(b =>
      b.addEventListener('click', () => { state.page = Number(b.dataset.page); Students.render(); }));
    host.querySelectorAll('[data-step]').forEach(b =>
      b.addEventListener('click', () => {
        state.page += Number(b.dataset.step);
        Students.render();
      }));
  }

  /* Show/hide + require the Section field based on the selected class */
  function syncFormSections(selected) {
    const form = document.getElementById('studentForm');
    const classSelect = form.elements.class;
    const sectionSelect = form.elements.section;
    const group = document.getElementById('studentSectionGroup');
    const sectionless = db.classes.isSectionless(classSelect.value);

    if (group) group.hidden = sectionless;
    sectionSelect.disabled = sectionless;

    if (sectionless) {
      sectionSelect.required = false;
      UI.optionList(sectionSelect, [], '', 'No section');
      sectionSelect.value = '';
    } else {
      sectionSelect.required = true;
      const wanted = (typeof selected === 'string') ? selected : '';
      UI.optionList(sectionSelect, db.classes.sectionsOf(classSelect.value), wanted, 'Select section');
    }
  }

  /* Every session named in the session catalogue or used by a student, newest
     first. Including register values keeps old sessions filterable even when
     they are no longer in the catalogue. */
  function sessionOptions() {
    const seen = {};
    db.sessions.names().forEach(name => { if (name) seen[name] = true; });
    db.students.all().forEach(s => { if (s && s.session) seen[s.session] = true; });
    return Object.keys(seen).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  /* Update the list's Section filter for the selected class */
  function updateSectionFilter() {
    const classFilter = document.getElementById('studentClassFilter');
    const sectionFilter = document.getElementById('studentSectionFilter');
    const item = document.getElementById('studentSectionFilterItem');
    if (!sectionFilter) return;
    const sectionless = !!classFilter.value && db.classes.isSectionless(classFilter.value);
    if (item) item.hidden = sectionless;
    sectionFilter.disabled = !!sectionless;
    UI.optionList(sectionFilter, db.classes.sectionsOf(classFilter.value), '', 'All sections');
  }

  function validate(form, editing, editId) {
    const ok = UI.validateForm(form, f => {
      const errors = [];
      const studentId = f.elements.studentId.value.trim();
      const name = f.elements.name.value.trim();
      const phone = f.elements.phone ? f.elements.phone.value.trim() : '';
      const mobile = f.elements.mobile ? f.elements.mobile.value.trim() : '';
      const className = f.elements.class.value;
      const section = f.elements.section.disabled ? '' : f.elements.section.value;
      const sectionless = db.classes.isSectionless(className);

      /* The Student Name, Class and Student ID are required. The Student ID
         determines the roll number, so it must be present and unique. */
      if (name.length < 2) {
        errors.push({ input: f.elements.name, message: "Enter the student's full name." });
      }
      if (!className) {
        errors.push({ input: f.elements.class, message: 'Select a class.' });
      }
      if (!sectionless && !section) {
        errors.push({ input: f.elements.section, message: 'Select a section.' });
      }
      if (!studentId) {
        errors.push({ input: f.elements.studentId, message: 'A valid Student ID is required to assign a roll number.' });
      } else if (db.students.findByStudentId(studentId) &&
          db.students.findByStudentId(studentId).id !== editId) {
        errors.push({ input: f.elements.studentId, message: 'This Student ID already exists. Please enter a unique Student ID.' });
      }

      if (mobile && !/^03\d{9}$/.test(mobile.replace(/[\s-]/g, ''))) {
        errors.push({ input: f.elements.mobile, message: 'Use format 03XXXXXXXXX (11 digits).' });
      }
      if (phone && !/^[0-9+\-\s()]{7,20}$/.test(phone)) {
        errors.push({ input: f.elements.phone, message: 'Enter a valid phone number (7-20 digits).' });
      }
      if (f.elements.dob.value && f.elements.dob.value > Utils.todayISO()) {
        errors.push({ input: f.elements.dob, message: 'Date of birth cannot be in the future.' });
      }
      if (f.elements.admissionDate && f.elements.admissionDate.value &&
        f.elements.admissionDate.value > Utils.todayISO()) {
        errors.push({ input: f.elements.admissionDate, message: 'Admission date cannot be in the future.' });
      }
      return errors;
    });
    return !ok;
  }

  /* ---------- Bulk import ---------- */

  /* Splits a CSV document into rows of cells, honouring quoted fields. */
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }

  /* Maps a CSV header to a student field. */
  function importFieldFor(header) {
    const h = String(header || '').trim().toLowerCase()
      .replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');
    if (!h) return '';
    if (/^(student id|studentid|id|reg no|reg no|registration no|registration number|admission no|admission number)$/.test(h)) {
      return 'studentId';
    }
    if (/name/.test(h)) {
      return /father|guardian|parent/.test(h) ? 'fatherName' : 'name';
    }
    if (/class/.test(h)) return 'class';
    if (/section/.test(h)) return 'section';
    if (/contact|mobile|cell|whatsapp/.test(h)) return 'mobile';
    if (/residential|landline|home phone|telephone|phone/.test(h)) return 'phone';
    if (/address/.test(h)) return 'address';
    if (/admission/.test(h)) return 'admissionDate';
    if (/^gender$|^sex$/.test(h)) return 'gender';
    if (/birth|^dob$/.test(h)) return 'dob';
    if (/roll/.test(h)) return 'rollNo';
    if (/^email$|e-mail/.test(h)) return 'email';
    return '';
  }

  /* Builds the list of importable rows from a parsed CSV document. */
  function prepareImport(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(importFieldFor);
    const mapped = headers.map((field, i) => ({ field: field, index: i }))
      .filter(h => h.field);

    if (!mapped.some(h => h.field === 'studentId') &&
        !mapped.some(h => h.field === 'rollNo')) {
      throw new Error('The file has no Student ID column. Add a “Student ID” header and try again.');
    }
    if (!mapped.some(h => h.field === 'name')) {
      throw new Error('The file has no name column. Add a “Student Name” header and try again.');
    }

    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const source = rows[r];
      const record = {};
      mapped.forEach(h => { record[h.field] = String(source[h.index] == null ? '' : source[h.index]).trim(); });
      if (!record.studentId && record.rollNo) record.studentId = record.rollNo;
      record.__row = r + 1;
      out.push(record);
    }
    return out;
  }

  /* Marks every parsed row as ready, duplicate or invalid. */
  function classifyImport(records) {
    const seen = new Set();
    const existing = new Set();
    db.students.all().forEach(s => {
      if (s && s.studentId) existing.add(db.students.normaliseId(s.studentId));
    });
    const classNames = db.classes.names().map(n => n.toLowerCase());

    return records.map(rec => {
      const sid = db.students.normaliseId(rec.studentId);
      const name = String(rec.name || '').trim();
      const cls = String(rec.class || '').trim();
      const classOk = !cls || classNames.indexOf(cls.toLowerCase()) > -1;

      if (!sid) {
        return { record: rec, status: 'invalid', reason: 'No Student ID' };
      }
      if (name.length < 2) {
        return { record: rec, status: 'invalid', reason: 'No student name' };
      }
      if (!cls) {
        return { record: rec, status: 'invalid', reason: 'No class' };
      }
      if (!classOk) {
        return { record: rec, status: 'invalid', reason: 'Unknown class “' + cls + '”' };
      }
      if (existing.has(sid)) {
        return { record: rec, status: 'duplicate', reason: 'Student ID already registered' };
      }
      if (seen.has(sid)) {
        return { record: rec, status: 'duplicate', reason: 'Repeated in this file' };
      }
      seen.add(sid);
      return { record: rec, status: 'ready', reason: '' };
    });
  }

  function renderImportPreview() {
    const host = document.getElementById('importPreview');
    const body = document.getElementById('importPreviewBody');
    const summary = document.getElementById('importSummary');
    const runBtn = document.getElementById('importRunBtn');
    const count = document.getElementById('importPreviewCount');
    if (!host || !body) return;

    const items = state.importRows;
    const ready = items.filter(i => i.status === 'ready').length;
    const duplicates = items.filter(i => i.status === 'duplicate').length;
    const invalid = items.filter(i => i.status === 'invalid').length;

    if (count) {
      count.textContent = '(' + Utils.fmtNumber(items.length) + ' row' + (items.length === 1 ? '' : 's') + ')';
    }
    if (summary) {
      summary.hidden = false;
      summary.innerHTML =
        '<span class="import-chip ok"><i class="fa-solid fa-circle-check"></i> ' + ready + ' ready</span>' +
        '<span class="import-chip warn"><i class="fa-solid fa-triangle-exclamation"></i> ' + duplicates + ' duplicate</span>' +
        '<span class="import-chip bad"><i class="fa-solid fa-circle-xmark"></i> ' + invalid + ' invalid</span>';
    }
    if (runBtn) runBtn.disabled = ready === 0;

    const preview = items.slice(0, 200);
    body.innerHTML = preview.map(item => {
      const rec = item.record;
      const badge = item.status === 'ready'
        ? '<span class="badge badge-green">Ready</span>'
        : item.status === 'duplicate'
          ? '<span class="badge badge-amber">Duplicate</span>'
          : '<span class="badge badge-red">Invalid</span>';
      const reason = item.reason
        ? '<span class="td-sub">' + Utils.esc(item.reason) + '</span>'
        : '';
      return '<tr>' +
        '<td class="num">' + Utils.esc(rec.__row) + '</td>' +
        '<td>' + Utils.esc(rec.studentId || '—') + '</td>' +
        '<td>' + Utils.esc(rec.name || '—') + '</td>' +
        '<td>' + Utils.esc(rec.class || '—') + '</td>' +
        '<td>' + Utils.esc(rec.fatherName || '—') + '</td>' +
        '<td>' + Utils.esc(rec.mobile || rec.phone || '—') + '</td>' +
        '<td>' + badge + reason + '</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="7" class="muted">Nothing to import.</td></tr>';

    host.hidden = false;
    if (items.length > preview.length) {
      const more = document.createElement('div');
      more.className = 'form-hint';
      more.textContent = 'Showing the first ' + preview.length + ' of ' + items.length + ' rows.';
      host.appendChild(more);
    }
  }

  async function parseImportFile() {
    const input = document.getElementById('importFile');
    if (!input || !input.files || !input.files[0]) {
      toast('Choose a CSV file first.', 'warning');
      return;
    }
    const file = input.files[0];
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        toast('That file has no readable rows.', 'warning');
        return;
      }
      const records = prepareImport(rows);
      state.importRows = classifyImport(records);
      renderImportPreview();
      toast(Utils.fmtNumber(state.importRows.length) + ' row(s) read from the file.', 'info', 'File parsed');
    } catch (err) {
      console.error('[MCA] import failed', err);
      toast(err.message || 'That file could not be read.', 'error');
    }
  }

  function runImport() {
    const items = state.importRows.filter(i => i.status === 'ready');
    if (!items.length) {
      toast('There is nothing ready to import.', 'warning');
      return;
    }
    const activeSession = db.sessions.active();
    const sessionName = activeSession ? activeSession.name : '';
    const list = db.students.all();
    const used = new Set();
    list.forEach(s => { if (s && s.studentId) used.add(db.students.normaliseId(s.studentId)); });

    let added = 0;
    let skipped = 0;
    items.forEach(item => {
      const rec = item.record;
      const sid = db.students.normaliseId(rec.studentId);
      if (!sid || used.has(sid)) { skipped++; return; }
      used.add(sid);

      const id = uniqueInternalId(rec.studentId);
      const className = db.classes.names().find(n => n.toLowerCase() === String(rec.class).toLowerCase()) || rec.class;
      const record = {
        id: id,
        studentId: String(rec.studentId).trim(),
        rollNo: '',
        name: String(rec.name || '').trim(),
        fatherName: String(rec.fatherName || '').trim(),
        dob: String(rec.dob || '').trim(),
        gender: String(rec.gender || '').trim(),
        class: className,
        section: String(rec.section || '').trim(),
        phone: String(rec.phone || '').trim(),
        phoneRes: String(rec.phone || '').trim(),
        mobile: String(rec.mobile || '').trim(),
        address: String(rec.address || '').trim(),
        admissionDate: normaliseDate(rec.admissionDate),
        photo: '',
        status: 'active',
        session: sessionName,
        importSource: 'CSV'
      };
      list.push(record);
      added++;
    });

    /* One write for the whole batch — not one write per student. */
    db.students.saveList(list);
    db.students.resequenceAll();

    state.importRows = [];
    UI.modal.close('importStudentsModal');
    const fileInput = document.getElementById('importFile');
    if (fileInput) fileInput.value = '';
    const host = document.getElementById('importPreview');
    if (host) host.hidden = true;
    const summary = document.getElementById('importSummary');
    if (summary) summary.hidden = true;

    state.page = 1;
    Students.render();
    refreshStorageStat();
    toast(Utils.fmtNumber(added) + ' student(s) imported' +
      (skipped ? ', ' + skipped + ' skipped' : '') + '.', 'success', 'Import complete');
  }

  /* Accepts YYYY-MM-DD, DD/MM/YYYY and DD-MM-YYYY. */
  function normaliseDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(text);
    if (m) {
      const day = String(m[1]).padStart(2, '0');
      const month = String(m[2]).padStart(2, '0');
      return m[3] + '-' + month + '-' + day;
    }
    return '';
  }

  function downloadImportTemplate() {
    const rows = [
      ['Student ID', 'Student Name', 'Class', 'Father Name', 'Contact Number',
        'Residential Phone', 'Permanent Address', 'Admission Date', 'Gender'],
      ['2413', 'MUHAMMAD ALI', '1st Year Computer Science', 'AKRAM ALI',
        '03001234567', '0911234567', 'Main Road, Peshawar', '2026-08-15', 'Male']
    ];
    UI.exportCSV('student-import-template.csv', rows);
  }

  function bindEvents() {
    const search = document.getElementById('studentSearch');
    if (search) {
      search.addEventListener('input', Utils.debounce(() => {
        state.search = search.value;
        state.page = 1;
        Students.render();
      }, 180));
    }

    const classFilter = document.getElementById('studentClassFilter');
    if (classFilter) {
      classFilter.addEventListener('change', () => {
        state.className = classFilter.value;
        state.section = '';
        state.page = 1;
        updateSectionFilter();
        Students.render();
      });
    }

    const sessionFilter = document.getElementById('studentSessionFilter');
    if (sessionFilter) {
      sessionFilter.addEventListener('change', () => {
        state.session = sessionFilter.value;
        state.page = 1;
        Students.render();
      });
    }

    const sectionFilter = document.getElementById('studentSectionFilter');
    if (sectionFilter) {
      sectionFilter.addEventListener('change', () => {
        state.section = sectionFilter.value;
        state.page = 1;
        Students.render();
      });
    }

    const sortSelect = document.getElementById('studentSort');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        state.sort = sortSelect.value || 'register';
        state.page = 1;
        Store.write('mca_student_sort', state.sort);
        Students.render();
      });
    }

    const statusFilter = document.getElementById('studentStatusFilter');
    if (statusFilter) {
      statusFilter.addEventListener('change', () => {
        state.status = statusFilter.value;
        state.page = 1;
        Students.render();
      });
    }

    const sizeSelect = document.getElementById('studentPageSize');
    if (sizeSelect) {
      sizeSelect.addEventListener('change', () => {
        state.limit = parseInt(sizeSelect.value, 10) || DEFAULT_PAGE_SIZE;
        state.page = 1;
        Store.write('mca_student_page_size', state.limit);
        Students.render();
      });
    }

    const addBtn = document.getElementById('addStudentBtn');
    if (addBtn) addBtn.addEventListener('click', () => Students.openForm(null));

    const printBtn = document.getElementById('printStudentsBtn');
    if (printBtn) printBtn.addEventListener('click', () => Students.printList());

    const exportBtn = document.getElementById('exportStudentsBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => Students.exportCSV());

    const printConfirmBtn = document.getElementById('printStudentsConfirmBtn');
    if (printConfirmBtn) printConfirmBtn.addEventListener('click', () => Students.printConfirm());

    const archiveBtn = document.getElementById('archivedToggleBtn');
    if (archiveBtn) archiveBtn.addEventListener('click', () => Students.toggleView());

    const importBtn = document.getElementById('importStudentsBtn');
    if (importBtn) importBtn.addEventListener('click', () => {
      state.importRows = [];
      const host = document.getElementById('importPreview');
      if (host) host.hidden = true;
      const summary = document.getElementById('importSummary');
      if (summary) summary.hidden = true;
      const runBtn = document.getElementById('importRunBtn');
      if (runBtn) runBtn.disabled = true;
      UI.modal.open('importStudentsModal');
    });

    const importParseBtn = document.getElementById('importParseBtn');
    if (importParseBtn) importParseBtn.addEventListener('click', () => parseImportFile());

    const importRunBtn = document.getElementById('importRunBtn');
    if (importRunBtn) importRunBtn.addEventListener('click', () => runImport());

    const templateBtn = document.getElementById('importTemplateBtn');
    if (templateBtn) templateBtn.addEventListener('click', () => downloadImportTemplate());

    const profileEditBtn = document.getElementById('profileEditBtn');
    if (profileEditBtn) profileEditBtn.addEventListener('click', () => {
      if (!profileId) return;
      const id = profileId;
      UI.modal.close('profileModal');
      Students.openForm(id);
    });

    const profilePrintBtn = document.getElementById('profilePrintBtn');
    if (profilePrintBtn) profilePrintBtn.addEventListener('click', () => {
      if (!profileId) return;
      Students.printProfile(profileId);
    });

    const saveBtn = document.getElementById('saveStudentBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => Students.save());

    const form = document.getElementById('studentForm');
    if (form) {
      form.addEventListener('submit', e => { e.preventDefault(); Students.save(); });
      form.elements.class.addEventListener('change', () => {
        syncFormSections();
        updateRollPreview();
      });
      if (form.elements.section) form.elements.section.addEventListener('change', updateRollPreview);
      if (form.elements.studentId) form.elements.studentId.addEventListener('input', updateRollPreview);

      if (form.elements.name) {
        form.elements.name.addEventListener('input', () => {
          const preview = document.getElementById('fPhotoPreview');
          if (preview && !photoData) preview.textContent = Utils.initials(form.elements.name.value || '?');
        });
      }
    }

    const photoInput = document.getElementById('fPhoto');
    if (photoInput) {
      photoInput.addEventListener('change', () => {
        const file = photoInput.files && photoInput.files[0];
        if (!file) return;
        if (file.size > 1024 * 1024) {
          toast('Please choose an image smaller than 1 MB.', 'error');
          photoInput.value = '';
          return;
        }
        readPhotoFile(file);
      });
    }

    const photoClear = document.getElementById('fPhotoClear');
    if (photoClear) {
      photoClear.addEventListener('click', () => {
        photoData = '';
        photoDirty = true;
        const input = document.getElementById('fPhoto');
        if (input) input.value = '';
        renderPhotoPreview();
      });
    }

    refreshStorageStat();
  }

  document.addEventListener('DOMContentLoaded', () => onAppReady(Students.init));

  window.Students = Students;
})();
