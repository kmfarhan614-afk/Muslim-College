<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Muslim Commerce College — Attendance System

## Project
- Live app = static site at repo root: HTML + `js/*.js` + `css/style.css` + zero-dep `server.js`. Open in a browser or run `node server.js` (http://127.0.0.1:3000).
- `muslim-commerce-attendance/` is a BYTE-IDENTICAL mirror — after every change, copy the file there too and confirm equal MD5.
- Unused Next.js scaffolding (`app/`, `services/`, `lib/supabase/`, root `package.json`/`tsconfig.json`): do NOT modify.
- Admin login `admin@college.com` / `admin123` (`index.html`); teacher login is separate at `teacher-login.html` with accounts created by the Super Admin. Data lives in browser `localStorage` (`mca_*` keys) and syncs to the `server.js` REST API when running.

## Current data model
- 4 section-less core classes only: `first-year-medical`, `first-year-computer-science`, `second-year-medical`, `second-year-computer-science`. Stable ids; `sections: []` = section-less (students sit directly under the class, `section: ''`).
- Student register starts EMPTY by design (`SEED_VERSION = 3`). No demo students are ever generated; `Seed.buildAll()` seeds classes only and `ensureCoreClasses()` re-adds missing core classes idempotently.
- Attendance dates use Pakistan time (`Asia/Karachi`): `Utils.pkParts/pkToday/pkClock`, `academicSessionFor()` (Aug–Jul cycle).

## Supabase (paused)
- Goal: permanent attendance in Supabase Postgres (365+ days) via a `server.js` PostgREST proxy using the service-role key.
- Done: `supabase/schema.sql`, `SUPABASE.md`, server endpoints (`/api/supabase/status`, `/api/sync`, `/api/academic-sessions*`, `/api/attendance*`), `js/api.js` client methods, `db.sessions` + session seed in `js/app.js`.
- Not connected — `.env.local` values are empty. All state/student/attendance/academic-session reads and writes need `Authorization: Bearer <token>`; only `/api/health`, login and Supabase status are open. Unconfigured Supabase returns 503.
- Deferred: Records-tab filter/pagination UI (reverted), Academic-Years management in `settings.html` / `js/settings.js`.

## Teacher Portal & Super Admin
- Teacher auth is separate from admin auth: `teacher-login.html` + `js/teacher-login.js`; portal at `teacher-dashboard.html` + `js/teacher-portal.js` + `css/teacher.css`. Admin management at `admin.html` / `teacher-accounts.html` + `js/teacher-admin.js` + `css/teacher-admin.css`. `index.html` links to the Teacher Portal.
- Accounts live in `data/auth/users.json` (not `localStorage`): `{version,nextPortal,teachers[],audit[]}`. Passwords use salted `crypto.scryptSync`; API responses never include `passwordHash`/`passwordSalt`. Audit is capped at 2 000 entries.
- Portal numbers are `TCH-\d{4,}`, unique, auto-sequenced, and changeable only via `PUT /api/admin/teachers/:id/portal-number` with a `reason`. Generic `PUT /api/admin/teachers/:id` rejects portal changes. IDs are stable `tch_<time>_<hex>`.
- Permissions: `viewStudents`, `takeAttendance`, `editAttendance`, `viewAttendanceReports`, `enterMarks`, `editMarks`, `viewResults`, `publishResults`, `generateDmc`, `viewPlanner`. Defaults: all true except `editAttendance`, `editMarks`, `publishResults`.
- Login throttling: 5 failures per IP+identifier in 15 minutes then a 15-minute block. First login forces a password change (`403 code: password_change_required`); the client must call `/api/teacher/auth/change-password`. Resets return a one-time temporary password; no email/SMTP delivery.
- Teacher data is class-scoped. `teacherSubjectNames(teacher, className)` and `examSubjectAssigned()` require both the class and subject assignment to match; attendance history also filters each record by its own class. Teacher marks use the internal `student.id`; attendance uses the external Student ID.
- On a fresh `data/` directory the server bootstraps the four core classes (`ensureCoreClasses()`) before admin meta/teacher validation; admin meta/teacher validation then auto-materializes each class's declared subjects into `mca_subjects` (`ensureClassSubjectCatalog()`, stable `subj_<class>_<subject>` ids, theory 100/40) so teacher assignments work before the exam catalog is edited by hand.
- `teacher-accounts.html` has an **Add Sabih ud din** preset (also `?new=sabih` / `?preset=sabih`): `Sabih ud din`, `TCH-0001`, `1st Year Computer Science`, `Urdu`, attendance/marks/DMC plus dashboard-view permissions. It only prefills; Save still enforces `TCH-0001` uniqueness and issues a one-time password with forced change.
- Teacher APIs are under `/api/teacher/*` (dashboard, profile, students, attendance/history, exams, marks, results, publish, DMC, planner); admin account APIs under `/api/admin/teachers*`, `/api/admin/audit`, `/api/admin/submissions`. Admin and teacher tokens are not interchangeable.
- `mca_planner` is allowlisted in `js/api.js` + `server.js`. Teacher planner currently derives exam schedule events plus saved planner overrides; static yearly planner data is not fully server-side.

## Examination System
- Files: `examinations.html` (page shell: `body[data-page="examinations"]`, theme bootstrap, `#examTabbar` + `#examContent`, loads `css/exams.css` + `js/exams.js`), `js/exams.js` (IIFE → `window.Exams`), `css/exams.css`. Do NOT modify print.js — reuse `Print.preview(html, landscape)` / `Print.print(html, landscape)`.
- 10 tabs (`TAB_DEFS`): `dashboard`, `create`, `schedule`, `subjects`, `marks`, `results`, `dmc`, `printdmc`, `reports`, `settings`. Page is one HTML file with a 10-tab bar; tab content in `#examContent`; buttons carry `data-etab`; deep-link via `examinations.html?tab=<key>` (also honors `?exam=<id>`). `Chrome.navKey()` maps page `examinations` → `exam-<tab>` (default `exam-dashboard`); NAV group key `exams`, icon `fa-file-pen`, label "Examination System" with the 10 children.
- localStorage keys (allowlisted in BOTH `js/api.js` and `server.js` `STATE_KEYS`): `mca_exams`, `mca_subjects`, `mca_marks`, `mca_exam_settings`.
- `mca_exams[]`: id, name, type, typeName (Custom only), academicYear, className, startDate, endDate, resultDate, description, status, `subjects[]`, `schedule[]`, createdAt, updatedAt, publishedAt. Statuses: draft/scheduled/ongoing/completed/published (+archived), changeable inline. Types: Monthly Test, Weekly Test, Midterm Examination, First Term, Second Term, Final, Annual, Pre-Board, Custom.
- **Per-exam `subjects[]` are instance snapshots with their OWN fresh `id`** (not the catalog id) — `subjectConfigFromCatalog()` assigns `uid('subj')`. Marks reference that per-exam `sub.id` via `mark.subjectId`. Fields: id, name, code, type (theory/practical/combined), maxMarks/passMarks (non-combined) or theoryMax/theoryPass/practicalMax/practicalPass (combined), active.
- `mca_subjects[]` is the reusable catalog: id, name, code, className, type, marks/pass fields, order, active.
- `mca_marks[]`: one record per `examId`+`subjectId`+`studentId`; status `present|absent|withheld|''`; obtained (or theoryObtained/practicalObtained for combined). **`studentId` is the internal `student.id` (not the external Student ID shown in the register).** **Blank status `''` = Not Entered, and blank ≠ zero.** Upsert keyed by (examId, subjectId, studentId). Server result/dashboard lookups accept a legacy external-ID key as a fallback.
- `mca_exam_settings`: grading[] ({grade,min,max,remark}, sorted by min on save), passPercent, defaultMax (100), defaultPass (40), positionEnabled, gradeEnabled, resultRemarks{pass,fail,absent,incomplete,withheld}, signatures[] (labels), stampLabel, dmcNote, registrationPrefix, headerNote.
- **Result engine** (`computeResult(exam, student)`): for each active subject `getMark`; combined max/pass = theory+practical; absent counts in `totalMax` but contributes 0; withheld excluded from obtained; blank → "Not Entered". Overall: any missing → `Incomplete`; any withheld → `Withheld`; all absent → `Absent`; else `Fail` if any subject failed else `Pass`. `positionsFor(exam)` returns a **map** `{studentId: rank}`, ranking ONLY Pass/Fail students (by totalObtained desc, then %). Overall grade only for Pass/Fail. Don't publish final result while marks are missing (publish warns/confirms).
- **DMC** (`buildDmc`/`dmcPage`), built from saved records only: header `MUSLIM COMMERCE COLLEGE PESHAWAR` + "DETAILED MARKS CERTIFICATE" + `assets/logo.png`; college info from `db.settings.get().college` {name,address,phone,email,website}; meta Academic Session/Examination/Class/Result Date; Student Info table (name, fatherName, studentId, rollNo, class/section, registration = `registrationPrefix` + studentId); marks table (S.No./Subject/Max/Obtained/Grade/Remarks); summary (Total Max/Obtained, %, Grade, Result, Class Position, Result Date, DMC No. `DMC-<studentId>/<year4>`); signatures (labels from settings, blank lines) + official stamp box (no fake signature images). Print-DMC tab batches selected students, each in `.dmc-page` with `break-after: page`.
- Other tabs: Dashboard (stat cards + pending marks), Create (modal + per-exam subject picker), Schedule (date sheet table + month calendar + `scheduleConflicts()` overlapping-window detection with confirm-and-proceed, + Print Date Sheet / Class-Wise / CSV via local `docShell`), Subjects (catalog CRUD + reorder), Marks (exam→subject→class roster; status + numeric entry; live counters; Mark All Present; validation; keyboard Enter/Shift+Enter nav; dirty guard), Results (summary + per-student table + publish + CSV), Reports (all-exams summary, grade distribution, subject-wise stats, print + CSV), Settings (grading editor + defaults + remarks + signatures + stamp + toggles).
- Classes: the four section-less core classes only; rosters via `db.students.byClassSection(className, '')`.

## Student Register (scalable — 2 000 to 10 000 students)
- `js/app.js` `Store` caches parsed values, detects quota, exposes `usage()`/`quotaBytes()`.
  `db.students` is backed by one index per change (`byId`, `bySid`, `bySidActive`, `byScope`,
  `haystack`, `sortKey`) — lookups are O(1), `query({q,className,section,session,status,view,page,limit})`
  returns `{rows,total,page,pages,limit,start,end}`, `select()` returns the whole filtered set.
  `active()`/`archived()` return copies; `byClassSection` returns rows sorted by numeric Student ID.
- Photographs live in IndexedDB (`mca-photos`/`photos`), key `photoKey` (`ph_<id>`), 320px JPEG q0.72,
  300-entry memory cache — `js/photos.js` → `window.Photos` (`init/load/loadFor/set/remove/keyFor/src/cached/has/count/backend`).
  Falls back to the `mca_photos` localStorage map when IndexedDB is unavailable; the student
  record only keeps the pointer. Legacy inline photos migrate on `initApp()`.
- `server.js` persists one JSON file per key in `data/state/` (200 ms debounce), rotating backups
  in `data/backups/<key>/` (10 copies), a daily snapshot in `data/backups/snapshots/`, per-key
  versions in `GET /api/state`, `GET /api/storage`, `DATA_DIR` env override, 24 MB body limit.
- Students API: `GET|POST /api/students`, `GET|PUT|DELETE /api/students/:id`,
  `POST /api/students/:id/restore`, `POST /api/students/bulk`, `PUT /api/students/delta`,
  `PUT /api/students` (full replace), `GET /api/students/export?format=csv`.
  Server enforces Student-ID uniqueness and re-sequences roll numbers per class + section + session.
  Bulk/delta run in a single pass (`buildStudentIndex` + `applyStudentBatch`): 10 000 records ≈ 280 ms.
- `js/api.js` syncs `mca_students` as a delta (`upserts`/`removes`) against the last confirmed
  snapshot; if the server rejects records or the call fails, it falls back to a full replace.
- Field mapping: Contact Number → `mobile`; Residential Phone → `phone` + `phoneRes`.

## Conventions
- Vanilla JS, IIFE modules, globals `Utils/Store/Seed/db/auth/UI/Chrome`. No build step, no npm deps for the app.
- No comments unless present in surrounding code. Keep HTML ids in sync with JS.
- Verify: `node --check` each edited JS file, then `npm test` (runs `tests/mca-server-harness.js`,
  `mca-teacher-portal-harness.js`, `mca-sabih-preset-harness.js`, `mca-wiring-harness.js`).
  UI harnesses still live in `C:\Users\DELL\AppData\Local\Temp\opencode\`: `mca-app-harness.js`
  (db.students core), `mca-students-ui-harness.js` (students page via jsdom),
  `mca-exams-ui-harness.js` (exam tabs, result engine, DMC, print). Also `npm run lint` and
  `npm run build` (Next scaffold). Confirm root↔mirror MD5.

## Known open items
- DMC reference image not yet supplied — DMC currently follows the written spec above; refine layout/typography when a sample is provided.
- Supabase still disconnected (see above).
- Photo thumbnails are resized in-browser; `js/photos.js` keeps only 300 in memory, so a photo on a
  scrolled-away row is re-read from IndexedDB on the next render.
- Teacher password resets are manual (one-time temporary password); there is no SMTP/email delivery.
- Teacher DMC is available for exams in assigned classes; the teacher UI limits selection to published/ongoing/completed exams.
- Static yearly planner data is not fully server-side; teacher planner combines exam schedule events with saved planner overrides.

## Recent work
- Scalable register rebuilt for 2 000–10 000 students: indexed `db.students` + paged `query()`,
  photographs moved out of `localStorage` into IndexedDB (`js/photos.js`, lazy 300-entry cache),
  per-key server persistence with backups + snapshots, and a full students REST API
  (paged read, CRUD, archive/restore, bulk, delta, CSV export, storage report).
  `js/api.js` syncs the register as a delta and falls back to a full replace.
  Bulk write of 10 000 records went from 18.1 s (O(n²)) to ~280 ms (single pass).
- Removed ALL demo students, attendance and classes; kept only the 4 core classes.
- Add Student form: Name/Father/Roll/Class required; DOB/Gender/Email/Status/Student ID optional; added Admission Date + Photo (data URL, ≤1 MB); duplicate roll per class+section blocked.
- Empty states: Students and Attendance ("No students added yet"); Dashboard Rate shows `—` and the weekly chart is derived from real attendance.
- Examination System added: `examinations.html` (10-tab page: dashboard, create, schedule, subjects, marks, results, dmc, printdmc, reports, settings), `js/exams.js` (IIFE → `window.Exams`; result engine + DMC builder + print/CSV), `css/exams.css`. New localStorage keys `mca_exams`/`mca_subjects`/`mca_marks`/`mca_exam_settings` allowlisted in `js/api.js` + `server.js`. Nav group "Examination System" added in `js/app.js` (`Chrome.navKey()` maps `examinations.html?tab=…` → `exam-<tab>`). Blank mark ≠ zero; absent counts in max but scores 0; withheld excluded from totals. DMC printing reuses `Print.preview/print`.
- Session-aware register filter/sort added; `db.students.query` supports `register|id|name|roll`, pre-sorts the register once per rebuild (`orderActive`/`orderArchived`) and keeps 10k paging under the harness threshold. Dashboard shows Registered/Active/Archived/Session/Exams stats.
- Exam marks now use a keyed in-memory index with batch upsert/save; result positions cached by exam + register/mark version. Settings has JSON backup download and a full reset that clears register/exams while preserving the roster-import marker.
- Supabase schema extended with `examinations`, `exam_subjects`, `exam_marks`, `dmc_register`, `exam_settings`, expanded student columns/indexes, and a session-aware roll uniqueness index. Proxy support for these exam tables is still pending.
- API hardened: state, register, CSV, storage, attendance and academic-session reads/writes require a Bearer token; `js/api.js` never hydrates without one. Only health, login and Supabase status remain public.
- Teacher Portal and Super Admin added: separate teacher auth, scrypt hashes, portal numbers, permissions, class/subject scoping, throttling, forced password change, one-time resets, audit trail, attendance/marks/results/DMC/planner APIs, responsive portal, admin dashboard and account manager.
- Teacher marks were aligned to the Examination System: canonical `studentId` is the internal `student.id`; the server accepts legacy external Student IDs as a read fallback. `markFor()` prevents teacher-entered marks from disappearing from results.
- Supabase schema extended with `teacher_users`, `teacher_class_assignments`, `teacher_subject_assignments`, `teacher_audit_log`, teacher attribution columns and service-role-only RLS for credential tables. Proxy migration still pending.
- `mca-teacher-portal-harness.js` added: 123 assertions covering admin/teacher auth, forced password change, RBAC, class/subject isolation, attendance, marks, results, DMC, audit, portal changes, disable/reset, restart persistence and login throttling.
- Added the `Sabih ud din` account preset and automatic class-subject catalog preparation; the preset does not create an account or set a password until the Super Admin saves. Verified with a 23-assertion preset harness.

