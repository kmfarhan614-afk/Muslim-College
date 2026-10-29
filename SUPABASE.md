# Supabase — Permanent Attendance Storage

This document explains how the attendance system stores daily attendance in a
**Supabase PostgreSQL** database for a full academic year (365+ days) instead of
only in the browser's `localStorage`.

The app keeps working with **zero configuration** (local-only mode). Supabase is
optional and additive: when it is configured, the server also mirrors attendance
to Postgres; when it is not, the browser keeps using `localStorage` exactly as
before.

---

## Architecture

```
Browser (static app + js/*.js)
        │  fetch  /api/*
        ▼
server.js  (zero-dependency Node, no npm install)
        │  PostgREST over HTTPS, service-role key (server-side only)
        ▼
Supabase PostgreSQL   (supabase/schema.sql)
```

- **The browser never holds database credentials.** All Supabase access happens
  inside `server.js`, which reads the service-role key from the environment and
  never sends it to the client.
- **The local `server.js` store (`data/db.json`) is unchanged** and remains the
  source of truth the app already uses. Supabase is a durable, queryable copy
  used by the Records page and academic-year features.
- If Supabase is down or unset, every `/api/attendance*` and
  `/api/academic-sessions` route returns a clear JSON error and the client falls
  back to the local dataset. Nothing breaks.

---

## 1. Create the database objects

1. Open your Supabase project → **SQL Editor**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) and
   run it. It is idempotent and safe to re-run.
3. It creates:
   - enum `attendance_status` (`Present` / `Absent` / `Leave`)
   - tables `academic_sessions`, `classes`, `sections`, `subjects`, `students`,
     `attendance_records`
   - examination tables `examinations`, `exam_subjects`, `exam_marks`,
     `dmc_register`, `exam_settings`
   - teacher portal tables `teacher_users`, `teacher_class_assignments`,
     `teacher_subject_assignments`, `teacher_audit_log`
   - foreign keys, uniqueness constraints, and query indexes
     (including class + section + session roll-number uniqueness)
   - a single-active-session guarantee and three starter sessions
     (`2024-2025`, `2025-2026`, `2026-2027`; the newest is activated only
     when no session is active)
   - Row Level Security (see "Security" below)

The examination tables are schema-ready for the durable Supabase migration.
The current server proxy still mirrors attendance/sessions only; exam data
continues to use the local/server `mca_*` store until that migration is enabled.

## 2. Configure the server

Copy `.env.local.example` to `.env.local` and fill in:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # Project Settings → API → service_role
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...  # optional fallback key
```

`server.js` loads `.env.local` itself (a small zero-dependency parser), so no
`dotenv` install is required. Real environment variables always win over the
file, which makes production deploys easy.

> The service-role key is used **only** by `server.js`. Never put it in a file
> the browser loads, and never commit `.env.local`.

## 3. Restart and verify

```powershell
node server.js
```

The startup banner prints `DB  Supabase https://...` when configured, or
`DB  local only (Supabase not configured)` otherwise. Then:

- `GET /api/health` → `{ "supabase": true }`
- `GET /api/supabase/status` → `configured`, `reachable`, `keyType`, and any
  connection `error`.

## 4. Push your existing data to Supabase (one time)

So that foreign keys resolve, the app's classes/sections/subjects/students must
exist in Postgres. From the app, once signed in, the client calls
`POST /api/sync` with the current model (sessions, classes, students). This
upserts everything by natural key and is safe to re-run.

---

## API reference

All routes are served by `server.js`. Only `/api/health`, `/api/auth/login`,
`/api/teacher/auth/login` and `/api/supabase/status` are public. Every state,
student, attendance and academic-session read/write requires an admin Bearer
token from `/api/auth/login`; teacher routes require a separate teacher Bearer
token from `/api/teacher/auth/login`.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/supabase/status` | Connection/config status. |
| `POST` | `/api/sync` | Upsert sessions, classes, subjects, sections, students. |
| `GET` | `/api/academic-sessions` | List sessions (newest first). |
| `POST` | `/api/academic-sessions` | Create/update a session by name. |
| `POST` | `/api/academic-sessions/:id/activate` | Make one session active (others off). |
| `DELETE` | `/api/academic-sessions/:id` | Delete a session. |
| `GET` | `/api/attendance` | Query records with filters + pagination. |
| `POST` | `/api/attendance` | Bulk upsert a class/subject/day sheet. |
| `DELETE` | `/api/attendance/:id` | Delete one record. |
| `POST` | `/api/attendance/retention` | Manually apply a retention policy. |

### `GET /api/attendance` query parameters

| Param | Meaning |
| --- | --- |
| `from`, `to` | Inclusive `attendance_date` range (`YYYY-MM-DD`). |
| `academicYearId` / `academicYearName` | Filter by academic session. |
| `classId` / `className` | Filter by class. |
| `sectionId` | Filter by section id (`sectionName=` with empty value for section-less). |
| `subjectId` / `subjectName` | Filter by subject. |
| `studentId` | Exact student. |
| `student` | Text search over student name / roll no / student code. |
| `status` | `present`, `absent`, or `leave`. |
| `page`, `pageSize` | 1-based page; `pageSize` capped at 200. |

Response: `{ ok, rows, total, page, pageSize, source: "supabase" }`. Each row is
flattened (`studentName`, `rollNo`, `className`, `sectionName`, `subjectName`,
`academicYear`, `status`, `date`, `remarks`, ...).

### `POST /api/attendance` body

```json
{
  "className": "1st Year Medical",
  "sectionName": "",
  "subjectName": "Physics",
  "date": "2026-10-09",
  "markedBy": "admin@college.com",
  "entries": [
    { "studentCode": "MCA-0001", "status": "present", "remarks": "" },
    { "studentCode": "MCA-0002", "status": "absent",  "remarks": "Sick" }
  ]
}
```

Records are de-duplicated by the unique constraint
`(student_id, class_id, subject_id, academic_year_id, attendance_date)`, so
re-saving the same sheet **updates** existing rows instead of creating
duplicates.

---

## Teacher portal authentication (Supabase-ready)

Teacher accounts are currently stored locally in `data/auth/users.json` with
scrypt password hashes, salted per teacher, and are never exposed to the
browser. `schema.sql` now contains the durable equivalents:

| Table | Purpose |
| --- | --- |
| `teacher_users` | Portal number (`TCH-0001`), profile, password hash/salt, status, permissions JSON, forced-change and reset-request fields. |
| `teacher_class_assignments` | Classes a teacher may access. |
| `teacher_subject_assignments` | Class-scoped subject assignments; a subject is valid only for its assigned class. |
| `teacher_audit_log` | Login, account, attendance, marks, publish and portal-number changes with actor, action, target and details. |

`attendance_records` also carries `source`, `submission_action` and
`teacher_portal_number`; `exam_marks` carries `teacher_portal_number` and
`entered_by_teacher_id`. Teacher tables have RLS enabled with **no policies**:
only the service-role backend can read the password hashes. Direct public or
anon access is denied.

The Supabase proxy for teacher tables is not enabled yet. Until it is, teacher
accounts, assignments and audit remain in the local auth store and the
`mca_*` state keys.

---

## Time zone

All attendance dates are Pakistan local dates (`Asia/Karachi`, UTC+5, no DST).
The schema default is `(now() at time zone 'Asia/Karachi')::date`, and the client
sends an explicit `YYYY-MM-DD` for the day being marked.

---

## Academic years (sessions)

Each attendance row belongs to an `academic_sessions` record. When saving, the
server picks the session whose date range contains the attendance date, falling
back to the currently active session. Only one session can be active at a time
(enforced by a partial unique index). Historical sessions and their attendance
are preserved, so previous years stay queryable via the year filter.

---

## Data retention

Attendance is intended to be kept for the whole academic year (365+ days) and
across years. **Retention is manual only — there is no scheduler and nothing is
ever deleted automatically.** An administrator can explicitly prune with:

```json
// POST /api/attendance/retention
{ "confirm": true, "academicYearId": "<uuid>" }   // delete a whole session
{ "confirm": true, "beforeDate": "2024-06-30" }    // delete older than a date
```

The `confirm: true` flag is required to prevent accidental deletion.

---

## Security

- Service-role key lives only on the server; the client uses the app's own
  Bearer-token auth for writes.
- Row Level Security is enabled on all tables. The schema grants read access to
  authenticated users for academic data and performs writes through the
  service-role key (which bypasses RLS). Teacher account, assignment and audit
  tables intentionally have no policies, so password hashes are service-role
  only. If you later expose Supabase directly to browsers, add scoped policies
  first.
- `.env.local` is git-ignored and is never served (dotfiles are denied by the
  static handler).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/api/supabase/status` → `configured: false` | `.env.local` missing/empty, or the server was not restarted after editing it. |
| `reachable: false` with an `error` | Wrong URL/key, project paused, or `schema.sql` not run. |
| `Unknown class ... Run a data sync first.` | Call `POST /api/sync` (or save once in the app) so classes/students exist in Postgres. |
| `No academic session found.` | Create/activate a session in Settings → Academic Years, or confirm the seed ran. |
| `permission denied` from PostgREST | You used the anon key where RLS blocks writes; set `SUPABASE_SERVICE_ROLE_KEY`. |
