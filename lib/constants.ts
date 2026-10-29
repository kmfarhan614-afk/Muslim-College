import {
  BookOpen,
  ClipboardCheck,
  FileBarChart,
  GraduationCap,
  LayoutDashboard,
  Library,
  ListChecks,
  Palette,
  Presentation,
  Users,
  UserCircle2,
  Layers,
  CalendarRange,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { AttendanceStatus, Role } from "@/types";

/* -------------------------------- Navigation ------------------------------ */

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** roles allowed to see this entry; empty = everyone */
  roles?: Role[];
  badge?: "admin";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Academic",
    items: [
      { label: "Students", href: "/students", icon: GraduationCap },
      { label: "Classes", href: "/classes", icon: Library },
      { label: "Sections", href: "/sections", icon: Layers },
      { label: "Subjects", href: "/subjects", icon: BookOpen },
      { label: "Academic Sessions", href: "/sessions", icon: CalendarRange, roles: ["admin"] },
    ],
  },
  {
    label: "Attendance",
    items: [
      { label: "Take Attendance", href: "/attendance/take", icon: ClipboardCheck },
      { label: "Attendance Records", href: "/attendance/records", icon: ListChecks },
      { label: "Reports", href: "/attendance/reports", icon: FileBarChart },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Teachers", href: "/teachers", icon: Presentation, roles: ["admin"] },
      { label: "Users", href: "/users", icon: Users, roles: ["admin"] },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

export const ALL_NAV_HREFS = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));

/* ------------------------------ Attendance -------------------------------- */

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "absent", "leave"];

export const STATUS_META: Record<
  AttendanceStatus,
  { label: string; short: string; hint: string; icon: string }
> = {
  present: { label: "Present", short: "P", hint: "Student attended the class", icon: "check" },
  absent: { label: "Absent", short: "A", hint: "Student did not attend", icon: "x" },
  leave: { label: "Leave", short: "L", hint: "Student has an approved leave", icon: "minus" },
};

export const STUDENT_STATUS_META: Record<string, { label: string; tone: Tones }> = {
  active: { label: "Active", tone: "success" },
  inactive: { label: "Inactive", tone: "neutral" },
  graduated: { label: "Graduated", tone: "info" },
  transferred: { label: "Transferred", tone: "warning" },
};

export const ACCOUNT_STATUS_META: Record<string, { label: string; tone: Tones }> = {
  active: { label: "Active", tone: "success" },
  inactive: { label: "Disabled", tone: "neutral" },
  suspended: { label: "Suspended", tone: "danger" },
};

export type Tones = "success" | "danger" | "warning" | "info" | "neutral" | "brand";

export const ROLE_META: Record<Role, { label: string; tone: Tones; description: string }> = {
  admin: {
    label: "Administrator",
    tone: "brand",
    description: "Full access to every module, configuration and user account.",
  },
  teacher: {
    label: "Teacher",
    tone: "info",
    description: "Access limited to assigned classes, subjects and attendance.",
  },
};

export const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
] as const;

/* -------------------------------- Pagination ------------------------------ */

export const PAGE_SIZE = 12;
export const ATTENDANCE_PAGE_SIZE = 25;
export const RECORDS_PAGE_SIZE = 20;

/* ---------------------------------- Misc ---------------------------------- */

export const LOW_ATTENDANCE_THRESHOLD = 75;

export const DATE_INPUT_CLASSES =
  "h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink transition placeholder:text-ink-faint hover:border-line-strong focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20";
