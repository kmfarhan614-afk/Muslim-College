import type {
  AcademicSession,
  AccountStatus,
  ActionResult,
  AnyReport,
  AttendanceQuery,
  AttendanceRecord,
  AttendanceSavePayload,
  AttendanceSaveResult,
  AttendanceStatus,
  ClassReport,
  ClassSubject,
  DailyReport,
  DashboardStats,
  LowAttendanceStudent,
  MonthlyReport,
  Paginated,
  Profile,
  RecentActivity,
  Role,
  SchoolClass,
  Section,
  SessionUser,
  Student,
  StudentAttendancePoint,
  StudentAttendanceSummary,
  StudentInput,
  StudentQuery,
  Subject,
  Teacher,
  ClassAttendanceStat,
  DailyTrendPoint,
} from "@/types";

/** The authenticated actor performing a request. */
export type Viewer = SessionUser;

/* ---------------------------------- Auth ---------------------------------- */

export interface AuthService {
  signIn(email: string, password: string, remember: boolean): Promise<ActionResult<SessionUser>>;
  signOut(): Promise<ActionResult>;
  sendPasswordReset(email: string): Promise<ActionResult>;
  getUser(): Promise<SessionUser | null>;
}

/* -------------------------------- Students -------------------------------- */

export interface StudentService {
  list(query: StudentQuery, viewer: Viewer): Promise<Paginated<Student>>;
  getById(id: string, viewer: Viewer): Promise<Student | null>;
  listForTimetable(classId: string, sectionId: string, viewer: Viewer): Promise<Student[]>;
  create(input: StudentInput, viewer: Viewer): Promise<ActionResult<Student>>;
  update(id: string, input: StudentInput, viewer: Viewer): Promise<ActionResult<Student>>;
  remove(id: string, viewer: Viewer): Promise<ActionResult>;
  summary(studentId: string, viewer: Viewer): Promise<StudentAttendanceSummary>;
  monthly(studentId: string, viewer: Viewer): Promise<StudentAttendancePoint[]>;
  history(
    studentId: string,
    opts: { page?: number; pageSize?: number; month?: string },
    viewer: Viewer,
  ): Promise<Paginated<AttendanceRecord>>;
}

/* ------------------------------- Attendance ------------------------------- */

export interface AttendanceService {
  save(payload: AttendanceSavePayload, viewer: Viewer): Promise<ActionResult<AttendanceSaveResult>>;
  list(query: AttendanceQuery, viewer: Viewer): Promise<Paginated<AttendanceRecord>>;
  getForSession(opts: {
    classId: string;
    sectionId: string;
    subjectId: string;
    date: string;
    viewer: Viewer;
  }): Promise<AttendanceRecord[]>;
  update(
    id: string,
    status: AttendanceStatus,
    remarks: string | null,
    viewer: Viewer,
  ): Promise<ActionResult<AttendanceRecord>>;
  bulkUpdate(
    ids: string[],
    status: AttendanceStatus,
    viewer: Viewer,
  ): Promise<ActionResult<number>>;
  remove(id: string, viewer: Viewer): Promise<ActionResult>;
  canEdit(record: AttendanceRecord, viewer: Viewer): boolean;
}

/* -------------------------------- Academic -------------------------------- */

export interface AcademicService {
  sessions(viewer: Viewer): Promise<AcademicSession[]>;
  activeSession(viewer: Viewer): Promise<AcademicSession | null>;
  saveSession(
    input: Omit<AcademicSession, "id"> & { id?: string },
    viewer: Viewer,
  ): Promise<ActionResult<AcademicSession>>;
  removeSession(id: string, viewer: Viewer): Promise<ActionResult>;

  classes(viewer: Viewer): Promise<SchoolClass[]>;
  saveClass(
    input: { id?: string; name: string; code: string; sessionId: string | null; isActive: boolean },
    viewer: Viewer,
  ): Promise<ActionResult<SchoolClass>>;
  removeClass(id: string, viewer: Viewer): Promise<ActionResult>;

  sections(classId: string | null, viewer: Viewer): Promise<Section[]>;
  allSections(viewer: Viewer): Promise<Section[]>;
  saveSection(
    input: { id?: string; classId: string; name: string; capacity: number | null; isActive: boolean },
    viewer: Viewer,
  ): Promise<ActionResult<Section>>;
  removeSection(id: string, viewer: Viewer): Promise<ActionResult>;

  subjects(viewer: Viewer): Promise<Subject[]>;
  saveSubject(
    input: { id?: string; code: string; name: string; isActive: boolean },
    viewer: Viewer,
  ): Promise<ActionResult<Subject>>;
  removeSubject(id: string, viewer: Viewer): Promise<ActionResult>;

  classSubjects(opts: { classId?: string; sectionId?: string }, viewer: Viewer): Promise<ClassSubject[]>;
  saveClassSubject(
    input: { id?: string; classId: string; sectionId: string | null; subjectId: string; teacherId: string | null },
    viewer: Viewer,
  ): Promise<ActionResult<ClassSubject>>;
  removeClassSubject(id: string, viewer: Viewer): Promise<ActionResult>;

  /** Subjects a given teacher may take for a class/section. */
  subjectsForTeacher(classId: string, sectionId: string, viewer: Viewer): Promise<ClassSubject[]>;
}

/* -------------------------------- Teachers -------------------------------- */

export interface TeacherService {
  list(opts: { search?: string; status?: string }, viewer: Viewer): Promise<Teacher[]>;
  getById(id: string, viewer: Viewer): Promise<Teacher | null>;
  save(
    input: {
      id?: string;
      teacherCode: string;
      name: string;
      email: string;
      phone: string | null;
      qualification: string | null;
      designation: string | null;
      status: AccountStatus;
      assignments?: { classId: string; sectionId: string | null; subjectId: string }[];
    },
    viewer: Viewer,
  ): Promise<ActionResult<Teacher>>;
  remove(id: string, viewer: Viewer): Promise<ActionResult>;
}

/* --------------------------------- Users ---------------------------------- */

export interface UserService {
  list(viewer: Viewer): Promise<Profile[]>;
  save(
    input: {
      id?: string;
      email: string;
      fullName: string;
      role: Role;
      phone: string | null;
      status: AccountStatus;
      password?: string;
      teacherId: string | null;
    },
    viewer: Viewer,
  ): Promise<ActionResult<Profile>>;
  remove(id: string, viewer: Viewer): Promise<ActionResult>;
}

/* -------------------------------- Dashboard ------------------------------- */

export interface DashboardService {
  stats(viewer: Viewer): Promise<DashboardStats>;
  classWise(viewer: Viewer): Promise<ClassAttendanceStat[]>;
  trend(viewer: Viewer): Promise<DailyTrendPoint[]>;
  recent(viewer: Viewer): Promise<RecentActivity[]>;
  lowAttendance(viewer: Viewer): Promise<LowAttendanceStudent[]>;
}

/* --------------------------------- Reports -------------------------------- */

export interface ReportService {
  daily(date: string, opts: { classId?: string; sectionId?: string }, viewer: Viewer): Promise<DailyReport>;
  monthly(month: string, opts: { classId?: string; sectionId?: string }, viewer: Viewer): Promise<MonthlyReport>;
  student(studentId: string, opts: { from?: string; to?: string }, viewer: Viewer): Promise<ClassReport | null>;
  studentReport(studentId: string, viewer: Viewer): Promise<import("@/types").StudentReport | null>;
  classReport(
    opts: { classId: string; sectionId: string; subjectId?: string; from: string; to: string },
    viewer: Viewer,
  ): Promise<ClassReport>;
}

/* ------------------------------ Root registry ----------------------------- */

export interface Services {
  auth: AuthService;
  students: StudentService;
  attendance: AttendanceService;
  academic: AcademicService;
  teachers: TeacherService;
  users: UserService;
  dashboard: DashboardService;
  reports: ReportService;
}

export type { AnyReport };
