/* ==========================================================================
   Domain model — Muslim Commerce College Peshawar, Attendance Management
   These types are shared by the UI, the service layer and the SQL schema.
   ========================================================================== */

export type Role = "admin" | "teacher";

export type AccountStatus = "active" | "inactive" | "suspended";

export type AttendanceStatus = "present" | "absent" | "leave";

export type StudentStatus = "active" | "inactive" | "graduated" | "transferred";

export type Gender = "male" | "female" | "other";

/* ---------------------------------- Auth --------------------------------- */

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  teacherId: string | null;
  avatarUrl: string | null;
  remember: boolean;
}

/* -------------------------------- Profiles ------------------------------- */

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  phone: string | null;
  avatarUrl: string | null;
  status: AccountStatus;
  teacherId: string | null;
  createdAt: string;
  lastSignInAt: string | null;
}

/* ---------------------------- Academic structures ------------------------ */

export interface AcademicSession {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export interface SchoolClass {
  id: string;
  name: string;
  code: string;
  sessionId: string | null;
  isActive: boolean;
  studentCount?: number;
  sectionCount?: number;
  sessionName?: string;
}

export interface Section {
  id: string;
  classId: string;
  className: string;
  name: string;
  capacity: number | null;
  isActive: boolean;
  studentCount?: number;
}

export interface Subject {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  classCount?: number;
}

export interface ClassSubject {
  id: string;
  classId: string;
  sectionId: string | null;
  subjectId: string;
  teacherId: string | null;
  className?: string;
  sectionName?: string;
  subjectName?: string;
  subjectCode?: string;
  teacherName?: string;
}

/* -------------------------------- Teachers ------------------------------- */

export interface Teacher {
  id: string;
  teacherCode: string;
  name: string;
  email: string;
  phone: string | null;
  qualification: string | null;
  designation: string | null;
  status: AccountStatus;
  profileId: string | null;
  joinedAt: string;
  assignedClasses: TeacherAssignment[];
}

export interface TeacherAssignment {
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string;
}

/* -------------------------------- Students ------------------------------- */

export interface Student {
  id: string;
  studentId: string;
  rollNumber: string;
  fullName: string;
  fatherName: string;
  dateOfBirth: string | null;
  gender: Gender;
  classId: string;
  sectionId: string;
  className: string;
  sectionName: string;
  sessionId: string | null;
  sessionName?: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  admissionDate: string | null;
  status: StudentStatus;
  photoUrl: string | null;
  createdAt: string;
}

export interface StudentInput {
  studentId: string;
  rollNumber: string;
  fullName: string;
  fatherName: string;
  dateOfBirth: string | null;
  gender: Gender;
  classId: string;
  sectionId: string;
  sessionId: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  admissionDate: string | null;
  status: StudentStatus;
}

/* ------------------------------- Attendance ------------------------------ */

export interface AttendanceRecord {
  id: string;
  studentId: string;
  classId: string;
  sectionId: string;
  subjectId: string | null;
  teacherId: string | null;
  sessionId: string | null;
  date: string;
  status: AttendanceStatus;
  remarks: string | null;
  studentName?: string;
  rollNumber?: string;
  studentCode?: string;
  fatherName?: string;
  className?: string;
  sectionName?: string;
  subjectName?: string;
  subjectCode?: string;
  teacherName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceEntry {
  studentId: string;
  status: AttendanceStatus;
  remarks?: string | null;
}

export interface AttendanceSavePayload {
  classId: string;
  sectionId: string;
  subjectId: string;
  sessionId: string;
  date: string;
  teacherId: string | null;
  entries: AttendanceEntry[];
}

export interface AttendanceSaveResult {
  saved: number;
  updated: number;
  skipped: number;
  errors: string[];
}

/* ------------------------------- Statistics ------------------------------ */

export interface DashboardStats {
  totalStudents: number;
  presentToday: number;
  absentToday: number;
  leaveToday: number;
  notMarkedToday: number;
  overallAttendancePct: number;
  todayAttendancePct: number;
  totalClasses: number;
  totalTeachers: number;
  activeStudents: number;
  classesMarkedToday: number;
}

export interface ClassAttendanceStat {
  classId: string;
  className: string;
  sectionName: string;
  total: number;
  present: number;
  absent: number;
  leave: number;
  percentage: number;
}

export interface DailyTrendPoint {
  date: string;
  percentage: number;
  present: number;
  total: number;
}

export interface LowAttendanceStudent {
  id: string;
  studentId: string;
  rollNumber: string;
  fullName: string;
  className: string;
  sectionName: string;
  percentage: number;
  present: number;
  total: number;
}

export interface RecentActivity {
  id: string;
  date: string;
  className: string;
  sectionName: string;
  subjectName: string;
  teacherName: string;
  present: number;
  absent: number;
  leave: number;
  total: number;
  percentage: number;
}

export interface StudentAttendanceSummary {
  studentId: string;
  totalClasses: number;
  present: number;
  absent: number;
  leave: number;
  percentage: number;
}

export interface StudentAttendancePoint {
  date: string;
  present: number;
  total: number;
  percentage: number;
}

/* --------------------------------- Reports ------------------------------- */

export type ReportType = "daily" | "monthly" | "student" | "class";

export interface DailyReportRow {
  classId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  total: number;
  present: number;
  absent: number;
  leave: number;
  percentage: number;
}

export interface DailyReport {
  type: "daily";
  date: string;
  generatedAt: string;
  rows: DailyReportRow[];
  totals: { total: number; present: number; absent: number; leave: number; percentage: number };
}

export interface MonthlyReportRow {
  classId: string;
  className: string;
  sectionName: string;
  studentName: string;
  rollNumber: string;
  studentId: string;
  total: number;
  present: number;
  absent: number;
  leave: number;
  percentage: number;
}

export interface MonthlyReport {
  type: "monthly";
  month: string;
  generatedAt: string;
  rows: MonthlyReportRow[];
  daysWithAttendance: number;
  totals: { total: number; present: number; absent: number; leave: number; percentage: number };
}

export interface StudentReport {
  type: "student";
  student: Student;
  generatedAt: string;
  summary: StudentAttendanceSummary;
  history: AttendanceRecord[];
  monthly: StudentAttendancePoint[];
}

export interface ClassReportRow {
  studentId: string;
  rollNumber: string;
  studentIdCode: string;
  fullName: string;
  total: number;
  present: number;
  absent: number;
  leave: number;
  percentage: number;
}

export interface ClassReport {
  type: "class";
  classId: string;
  className: string;
  sectionName: string;
  subjectName: string;
  from: string;
  to: string;
  generatedAt: string;
  rows: ClassReportRow[];
  totals: { total: number; present: number; absent: number; leave: number; percentage: number };
}

export type AnyReport = DailyReport | MonthlyReport | StudentReport | ClassReport;

/* ------------------------------ Query helpers ---------------------------- */

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StudentQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  classId?: string;
  sectionId?: string;
  status?: string;
  sort?: "roll" | "name" | "created" | "attendance";
  order?: "asc" | "desc";
  sessionId?: string;
}

export interface AttendanceQuery {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  classId?: string;
  sectionId?: string;
  subjectId?: string;
  studentId?: string;
  status?: AttendanceStatus | "";
  search?: string;
  sessionId?: string;
}

export interface ActionResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
  errors?: Record<string, string[]>;
}
