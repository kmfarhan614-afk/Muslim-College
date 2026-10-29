-- ============================================================================
--  Muslim Commerce College Peshawar — Attendance & Examination System
--  Supabase / PostgreSQL schema
-- ----------------------------------------------------------------------------
--  Run this once in the Supabase SQL editor (or `psql`):
--      psql "$DATABASE_URL" -f supabase/schema.sql
--  It is idempotent and safe to re-run.
--
--  Design notes
--    * Attendance is stored PER STUDENT, PER SUBJECT, PER DAY — one row per
--      mark. This is the normalized form required for a one-year (and longer)
--      audit trail and for O(1) duplicate prevention.
--    * Examinations store a snapshot of their subjects; marks reference that
--      snapshot, not the reusable subject catalogue. Blank marks are stored as
--      status '' (Not Entered), so they are never mistaken for zero.
--    * DMC records are generated from saved marks and keep a JSON snapshot of
--      what was issued.
--    * Teacher portal accounts are separate from admin auth. Password hashes
--      live only in service-role-only tables; class/subject assignments are
--      explicit so teacher reads and writes stay scoped.
--    * Historical records are never overwritten or auto-deleted. A new
--      academic session is simply a new row in `academic_sessions`; old rows
--      keep pointing at their own session (see the retention section).
--    * All calendar dates are handled in the college's timezone,
--      Asia/Karachi (UTC+05:00, no daylight saving). `attendance_date` is a
--      plain `date`; timestamps are `timestamptz` (stored UTC, displayed in
--      the college timezone).
--    * The application writes through the Node backend using the
--      service-role key, so RLS below denies direct public access. The
--      service role bypasses RLS by design. See SUPABASE.md.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'attendance_status') then
    create type attendance_status as enum ('Present', 'Absent', 'Leave');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. updated_at helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Academic sessions (academic years)
--    e.g. "2025-2026". Preserved forever so previous years stay accessible.
-- ---------------------------------------------------------------------------
create table if not exists academic_sessions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  start_date  date,
  end_date    date,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint academic_sessions_name_key unique (name),
  constraint academic_sessions_range_chk check (end_date is null or start_date is null or end_date >= start_date)
);

-- Only one active session at a time.
create unique index if not exists academic_sessions_one_active_idx
  on academic_sessions (is_active) where (is_active);

drop trigger if exists trg_academic_sessions_updated on academic_sessions;
create trigger trg_academic_sessions_updated
  before update on academic_sessions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Classes  (e.g. "1st Year Medical", "D.Com 1st Year")
-- ---------------------------------------------------------------------------
create table if not exists classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text,
  year        text,                 -- "1st Year" / "2nd Year" ...
  study_group text,                 -- "Pre-Medical" / "Computer Science" / "Commerce"
  session_id  uuid references academic_sessions(id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint classes_name_key unique (name)
);

drop trigger if exists trg_classes_updated on classes;
create trigger trg_classes_updated
  before update on classes
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Sections  (A / B ...; a section-less class simply has no rows here)
-- ---------------------------------------------------------------------------
create table if not exists sections (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references classes(id) on delete cascade,
  name        text not null,
  capacity    integer,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint sections_class_name_key unique (class_id, name)
);

create index if not exists sections_class_idx on sections (class_id);

drop trigger if exists trg_sections_updated on sections;
create trigger trg_sections_updated
  before update on sections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Subjects
-- ---------------------------------------------------------------------------
create table if not exists subjects (
  id          uuid primary key default gen_random_uuid(),
  code        text,
  name        text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint subjects_name_key unique (name)
);

drop trigger if exists trg_subjects_updated on subjects;
create trigger trg_subjects_updated
  before update on subjects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Students
-- ---------------------------------------------------------------------------
create table if not exists students (
  id            uuid primary key default gen_random_uuid(),
  student_code  text not null,               -- human id, e.g. "1YM-01"
  roll_number   text not null,
  full_name     text not null,
  father_name   text,
  date_of_birth date,
  gender        text,
  class_id      uuid not null references classes(id) on delete restrict,
  section_id    uuid references sections(id) on delete set null,
  session_id    uuid references academic_sessions(id) on delete set null,
  phone         text,
  email         text,
  address       text,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint students_student_code_key unique (student_code)
);

-- Fields the browser register uses in addition to the original app model.
alter table students add column if not exists admission_date    date;
alter table students add column if not exists mobile            text;
alter table students add column if not exists residential_phone text;
alter table students add column if not exists photo_key         text;
alter table students add column if not exists deleted_at        timestamptz;
alter table students add column if not exists deleted_by        text;

create index if not exists students_class_idx    on students (class_id);
create index if not exists students_section_idx  on students (section_id);
create index if not exists students_session_idx  on students (session_id);
create index if not exists students_status_idx   on students (status);
create index if not exists students_class_session_idx
  on students (class_id, session_id);
create index if not exists students_active_class_idx
  on students (class_id, session_id) where deleted_at is null;
create index if not exists students_name_lower_idx
  on students (lower(full_name));

-- Roll number is unique within a class + section + academic session
-- (null section/session use a sentinel so section-less classes still work).
drop index if exists students_roll_unique_idx;
create unique index if not exists students_roll_unique_session_idx
  on students (
    class_id,
    coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    roll_number
  );

drop trigger if exists trg_students_updated on students;
create trigger trg_students_updated
  before update on students
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Attendance records  (one row per student, subject, day)
-- ---------------------------------------------------------------------------
create table if not exists attendance_records (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  class_id          uuid not null references classes(id) on delete restrict,
  section_id        uuid references sections(id) on delete set null,
  subject_id        uuid not null references subjects(id) on delete restrict,
  academic_year_id  uuid not null references academic_sessions(id) on delete restrict,
  attendance_date   date not null default ((now() at time zone 'Asia/Karachi')::date),
  status            attendance_status not null,
  remarks           text,
  marked_by         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A student is marked at most once per subject per day within a session.
  constraint attendance_unique_mark
    unique (student_id, class_id, subject_id, academic_year_id, attendance_date)
);

create index if not exists attendance_date_idx     on attendance_records (attendance_date);
create index if not exists attendance_student_idx  on attendance_records (student_id);
create index if not exists attendance_class_idx    on attendance_records (class_id);
create index if not exists attendance_subject_idx  on attendance_records (subject_id);
create index if not exists attendance_session_idx  on attendance_records (academic_year_id);
create index if not exists attendance_status_idx   on attendance_records (status);
-- Speeds up the common "records for a class+date" and range scans.
create index if not exists attendance_class_date_idx on attendance_records (class_id, attendance_date desc);

drop trigger if exists trg_attendance_updated on attendance_records;
create trigger trg_attendance_updated
  before update on attendance_records
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. Examinations
--    An exam stores a snapshot of its subjects. Editing the reusable subject
--    catalogue never rewrites an exam that has already been created.
-- ---------------------------------------------------------------------------
create table if not exists examinations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  type          text not null default 'Custom',
  type_name     text,
  academic_year text,
  session_id    uuid references academic_sessions(id) on delete set null,
  class_id      uuid references classes(id) on delete set null,
  class_name    text not null,
  start_date    date,
  end_date      date,
  result_date   date,
  description   text,
  status        text not null default 'draft'
                check (status in ('draft','scheduled','ongoing','completed','published','archived')),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint examinations_date_range_chk
    check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists examinations_class_idx    on examinations (class_id);
create index if not exists examinations_session_idx  on examinations (session_id);
create index if not exists examinations_status_idx   on examinations (status);
create index if not exists examinations_year_class_idx
  on examinations (academic_year, class_name);

drop trigger if exists trg_examinations_updated on examinations;
create trigger trg_examinations_updated
  before update on examinations
  for each row execute function set_updated_at();

create table if not exists exam_subjects (
  id                  uuid primary key default gen_random_uuid(),
  exam_id             uuid not null references examinations(id) on delete cascade,
  catalog_subject_id  uuid references subjects(id) on delete set null,
  name                text not null,
  code                text,
  type                text not null default 'theory'
                      check (type in ('theory','practical','combined')),
  max_marks           numeric(7,2) not null default 0,
  pass_marks          numeric(7,2) not null default 0,
  theory_max          numeric(7,2) not null default 0,
  theory_pass         numeric(7,2) not null default 0,
  practical_max       numeric(7,2) not null default 0,
  practical_pass      numeric(7,2) not null default 0,
  is_active           boolean not null default true,
  order_index         integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exam_subjects_exam_name_key unique (exam_id, name),
  constraint exam_subjects_marks_nonnegative_chk
    check (max_marks >= 0 and pass_marks >= 0 and theory_max >= 0 and
           theory_pass >= 0 and practical_max >= 0 and practical_pass >= 0)
);

create index if not exists exam_subjects_exam_idx on exam_subjects (exam_id);

drop trigger if exists trg_exam_subjects_updated on exam_subjects;
create trigger trg_exam_subjects_updated
  before update on exam_subjects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. Exam marks  (one row per exam + subject snapshot + student)
--     Blank status '' means "Not Entered" and is NOT the same as zero.
-- ---------------------------------------------------------------------------
create table if not exists exam_marks (
  id                  uuid primary key default gen_random_uuid(),
  exam_id             uuid not null references examinations(id) on delete cascade,
  exam_subject_id     uuid not null references exam_subjects(id) on delete cascade,
  student_id          uuid not null references students(id) on delete cascade,
  status              text not null default ''
                      check (status in ('', 'present', 'absent', 'withheld')),
  obtained            numeric(7,2),
  theory_obtained     numeric(7,2),
  practical_obtained  numeric(7,2),
  entered_by          text,
  entered_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exam_marks_unique_mark unique (exam_id, exam_subject_id, student_id),
  constraint exam_marks_nonnegative_chk
    check ((obtained is null or obtained >= 0) and
           (theory_obtained is null or theory_obtained >= 0) and
           (practical_obtained is null or practical_obtained >= 0))
);

create index if not exists exam_marks_exam_idx     on exam_marks (exam_id);
create index if not exists exam_marks_subject_idx  on exam_marks (exam_subject_id);
create index if not exists exam_marks_student_idx  on exam_marks (student_id);
create index if not exists exam_marks_status_idx   on exam_marks (status);

drop trigger if exists trg_exam_marks_updated on exam_marks;
create trigger trg_exam_marks_updated
  before update on exam_marks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 11. DMC register
--     One issued certificate per student per exam. `snapshot` keeps the
--     printed values even if marks or names are corrected later.
-- ---------------------------------------------------------------------------
create table if not exists dmc_register (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references examinations(id) on delete cascade,
  student_id      uuid not null references students(id) on delete cascade,
  dmc_no          text not null,
  academic_year   text,
  result          text,
  total_max       numeric(9,2),
  total_obtained  numeric(9,2),
  percentage      numeric(5,2),
  grade           text,
  snapshot        jsonb,
  issued_by       text,
  issued_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint dmc_register_dmc_no_key unique (dmc_no),
  constraint dmc_register_exam_student_key unique (exam_id, student_id)
);

create index if not exists dmc_register_exam_idx    on dmc_register (exam_id);
create index if not exists dmc_register_student_idx on dmc_register (student_id);

drop trigger if exists trg_dmc_register_updated on dmc_register;
create trigger trg_dmc_register_updated
  before update on dmc_register
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. Examination settings (single row, id = 'default')
-- ---------------------------------------------------------------------------
create table if not exists exam_settings (
  key                 text primary key default 'default',
  pass_percent        numeric(5,2) not null default 40,
  default_max         numeric(7,2) not null default 100,
  default_pass        numeric(7,2) not null default 40,
  position_enabled    boolean not null default true,
  grade_enabled       boolean not null default true,
  grading             jsonb not null default '[]'::jsonb,
  result_remarks      jsonb not null default '{}'::jsonb,
  signatures          jsonb not null default '[]'::jsonb,
  stamp_label         text,
  dmc_note            text,
  registration_prefix text,
  header_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exam_settings_single_row_chk check (key = 'default')
);

drop trigger if exists trg_exam_settings_updated on exam_settings;
create trigger trg_exam_settings_updated
  before update on exam_settings
  for each row execute function set_updated_at();

insert into exam_settings (key) values ('default') on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 13. Teacher portal accounts, assignments and audit
--     These tables are schema-ready for the durable Supabase migration. The
--     current server keeps accounts in data/auth/users.json (scrypt hashes)
--     and the browser never receives password_hash / password_salt.
-- ---------------------------------------------------------------------------
create table if not exists teacher_users (
  id                    uuid primary key default gen_random_uuid(),
  portal_number         text not null,
  full_name             text not null,
  father_name           text,
  username              text not null default '',
  email                 text not null default '',
  contact_number        text,
  qualification         text,
  designation           text not null default 'Teacher',
  academic_session      text,
  photo_key             text,
  status                text not null default 'active'
                        check (status in ('active', 'disabled')),
  password_hash         text not null,
  password_salt         text not null,
  must_change_password  boolean not null default true,
  permissions           jsonb not null default '{}'::jsonb,
  reset_requested_at    timestamptz,
  last_login_at         timestamptz,
  password_changed_at   timestamptz,
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint teacher_users_portal_key unique (portal_number),
  constraint teacher_users_portal_format_chk
    check (portal_number ~ '^TCH-[0-9]{4,}$')
);

create unique index if not exists teacher_users_username_key
  on teacher_users (lower(username)) where username <> '';
create unique index if not exists teacher_users_email_key
  on teacher_users (lower(email)) where email <> '';
create index if not exists teacher_users_status_idx on teacher_users (status);

drop trigger if exists trg_teacher_users_updated on teacher_users;
create trigger trg_teacher_users_updated
  before update on teacher_users
  for each row execute function set_updated_at();

create table if not exists teacher_class_assignments (
  teacher_id  uuid not null references teacher_users(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (teacher_id, class_id)
);

create index if not exists teacher_class_assignments_class_idx
  on teacher_class_assignments (class_id);

create table if not exists teacher_subject_assignments (
  teacher_id  uuid not null references teacher_users(id) on delete cascade,
  class_id    uuid not null references classes(id) on delete cascade,
  subject_id  uuid not null references subjects(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (teacher_id, class_id, subject_id)
);

create index if not exists teacher_subject_assignments_class_idx
  on teacher_subject_assignments (class_id, subject_id);
create index if not exists teacher_subject_assignments_subject_idx
  on teacher_subject_assignments (subject_id);

create table if not exists teacher_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor       text not null,
  action      text not null,
  target      text not null default '',
  details     text not null default '',
  ip          text,
  created_at  timestamptz not null default now()
);

create index if not exists teacher_audit_log_created_idx on teacher_audit_log (created_at desc);
create index if not exists teacher_audit_log_actor_idx   on teacher_audit_log (actor);
create index if not exists teacher_audit_log_action_idx  on teacher_audit_log (action);
create index if not exists teacher_audit_log_target_idx  on teacher_audit_log (target);

alter table attendance_records add column if not exists source text not null default 'admin';
alter table attendance_records add column if not exists submission_action text not null default 'submitted';
alter table attendance_records add column if not exists teacher_portal_number text;
alter table exam_marks add column if not exists teacher_portal_number text;
alter table exam_marks add column if not exists entered_by_teacher_id text;

create index if not exists attendance_teacher_idx
  on attendance_records (teacher_portal_number) where teacher_portal_number is not null;
create index if not exists exam_marks_teacher_idx
  on exam_marks (teacher_portal_number) where teacher_portal_number is not null;

-- ---------------------------------------------------------------------------
-- 14. Row Level Security
--     The backend uses the service-role key (server-side only) and therefore
--     is not subject to RLS. These policies deny direct anon access and grant
--     read access to signed-in Supabase users. No public write path exists.
--     Teacher tables intentionally have NO policies: they contain password
--     hashes and are reachable only through the service-role backend.
-- ---------------------------------------------------------------------------
alter table academic_sessions   enable row level security;
alter table classes             enable row level security;
alter table sections            enable row level security;
alter table subjects            enable row level security;
alter table students            enable row level security;
alter table attendance_records  enable row level security;
alter table examinations       enable row level security;
alter table exam_subjects      enable row level security;
alter table exam_marks         enable row level security;
alter table dmc_register       enable row level security;
alter table exam_settings      enable row level security;
alter table teacher_users              enable row level security;
alter table teacher_class_assignments  enable row level security;
alter table teacher_subject_assignments enable row level security;
alter table teacher_audit_log          enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'academic_sessions','classes','sections','subjects','students',
    'attendance_records','examinations','exam_subjects','exam_marks',
    'dmc_register','exam_settings'
  ] loop
    execute format('drop policy if exists "read_authenticated" on %I', t);
    execute format(
      'create policy "read_authenticated" on %I for select to authenticated using (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 15. Seed academic sessions (idempotent).
--     New rows are inserted inactive; an existing active session is never
--     overridden. If no session is active, the current 2026-2027 session is
--     activated. History is never deleted.
-- ---------------------------------------------------------------------------
insert into academic_sessions (name, start_date, end_date, is_active)
values
  ('2024-2025', '2024-09-01', '2025-06-30', false),
  ('2025-2026', '2025-09-01', '2026-06-30', false),
  ('2026-2027', '2026-08-01', '2027-07-31', false)
on conflict (name) do nothing;

do $$
begin
  if not exists (select 1 from academic_sessions where is_active) then
    update academic_sessions set is_active = true where name = '2026-2027';
  end if;
end $$;

-- ============================================================================
--  Retention policy (MANUAL ONLY — nothing is ever auto-deleted)
-- ----------------------------------------------------------------------------
--  To purge records older than a chosen academic session, an administrator
--  runs this explicitly. It is intentionally NOT scheduled.
--
--    delete from attendance_records
--    where academic_year_id = (select id from academic_sessions where name = '2019-2020');
--
--  A safety-checked dry run:
--    select academic_year_id, count(*)
--    from attendance_records
--    group by academic_year_id
--    order by 1;
-- ============================================================================
