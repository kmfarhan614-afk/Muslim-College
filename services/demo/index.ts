import type {
  ActionResult,
  AttendanceQuery,
  AttendanceRecord,
  AttendanceSavePayload,
  AttendanceSaveResult,
  ClassAttendanceStat,
  ClassReport,
  ClassSubject,
  DailyReport,
  DailyReportRow,
  DailyTrendPoint,
  DashboardStats,
  LowAttendanceStudent,
  MonthlyReport,
  MonthlyReportRow,
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
  StudentReport,
  Subject,
  Teacher,
} from "@/types";
import type {
  AcademicService,
  AttendanceService,
  AuthService,
  DashboardService,
  ReportService,
  Services,
  StudentService,
  TeacherService,
  UserService,
} from "@/services/types";
import { DEMO_CREDENTIALS } from "@/lib/brand";
import { pct } from "@/lib/utils";
import { getDb, getMaps, TODAY } from "./seed";

const SESSION_KEY = "mcs.session";
const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

function paginate<T>(items: T[], page = 1, pageSize = 12): Paginated<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, pageSize, total, totalPages };
}

function ok<T>(message: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
}

function fail(message: string, errors?: Record<string, string[]>): ActionResult<never> {
  return { ok: false, message, errors };
}

const DEMO_USERS: Record<string, { password: string; user: SessionUser }> = Object.fromEntries(
  DEMO_CREDENTIALS.map((c, i) => [
    c.email,
    {
      password: c.password,
      user: {
        id: `usr-${i + 1}`,
        email: c.email,
        fullName: i === 0 ? "Muhammad Irshad" : "Sadia Khan",
        role: (c.role === "Admin" ? "admin" : "teacher") as Role,
        teacherId: i === 0 ? null : "tch-2",
        avatarUrl: null,
        remember: false,
      },
    },
  ]),
);

const auth: AuthService = {
  async signIn(email, password, remember) {
    await delay(500);
    const entry = DEMO_USERS[email.trim().toLowerCase()];
    if (!entry || entry.password !== password) return fail("Invalid email or password. Please try again.");
    const user: SessionUser = { ...entry.user, remember };
    try {
      const store = remember ? window.localStorage : window.sessionStorage;
      store.setItem(SESSION_KEY, JSON.stringify(user));
    } catch {}
    return ok("Signed in successfully.", user);
  },
  async signOut() {
    await delay(220);
    try {
      window.localStorage.removeItem(SESSION_KEY);
      window.sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    return ok("Signed out.");
  },
  async sendPasswordReset(email) {
    await delay(500);
    if (!DEMO_USERS[email.trim().toLowerCase()]) return fail("No account found for that email address.");
    return ok("Password reset instructions have been sent to your email.");
  },
  async getUser() {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY) ?? window.localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  },
};

const empty = {} as unknown as never;

export const demoServices: Services = {
  auth,
  students: empty as Services["students"],
  attendance: empty as Services["attendance"],
  academic: empty as Services["academic"],
  teachers: empty as Services["teachers"],
  users: empty as Services["users"],
  dashboard: empty as Services["dashboard"],
  reports: empty as Services["reports"],
};

export { getDb, getMaps, TODAY } from "./seed";
