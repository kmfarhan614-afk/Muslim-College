/* ==========================================================================
   Demo dataset — deterministic, realistic college data used when Supabase is
   not configured (DEMO_MODE). Everything is generated once and cached for the
   lifetime of the tab, then mutated in place by the demo services.
   ========================================================================== */

import type {
  AcademicSession,
  AttendanceRecord,
  AttendanceStatus,
  ClassSubject,
  Gender,
  Profile,
  SchoolClass,
  Section,
  Student,
  Subject,
  Teacher,
  TeacherAssignment,
} from "@/types";

/* --------------------------------- helpers -------------------------------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]!;

const pad = (n: number, width: number) => `${n}`.padStart(width, "0");

function toDateOnly(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

/** The last `count` weekday (Mon–Fri) dates, oldest first, ending with `end`. */
function schoolDays(end: Date, count: number): string[] {
  const days: string[] = [];
  const cursor = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (days.length < count) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days.unshift(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }
  return days;
}

/* ---------------------------------- names --------------------------------- */

const MALE_NAMES = [
  "Muhammad", "Ali", "Ahmed", "Bilal", "Hamza", "Usman", "Abdullah", "Fahad",
  "Junaid", "Kamran", "Adnan", "Saeed", "Rehan", "Talha", "Zeeshan", "Ahsan",
  "Danish", "Faizan", "Asif", "Naveed", "Shahzaib", "Waqar", "Imran", "Salman",
  "Arslan", "Yasir", "Sohail", "Noman", "Haroon", "Zain", "Irfan", "Owais",
  "Tariq", "Amjad", "Shehryar", "Moiz", "Suleman", "Kashif", "Jawad", "Sheraz",
  "Waleed", "Hasnain", "Mudassir", "Saqib", "Farrukh", "Bilal", "Atif", "Nasir",
];

const FEMALE_NAMES = [
  "Ayesha", "Fatima", "Sana", "Hina", "Maryam", "Zainab", "Sadia", "Iqra",
  "Maria", "Rabia", "Nimra", "Areeba", "Laiba", "Sidra", "Kiran", "Anum",
  "Farah", "Saima", "Shazia", "Nazia", "Gulnaz", "Wajiha", "Mehwish", "Rida",
  "Zoya", "Amna", "Noor", "Sundas", "Bushra", "Tania",
];

const FATHER_NAMES = [
  "Muhammad Usman", "Muhammad Ilyas", "Abdul Sattar", "Muhammad Rafiq",
  "Gul Amin", "Muhammad Yousaf", "Zahid Khan", "Muhammad Aslam", "Noor Gul",
  "Sher Afzal", "Muhammad Anwar", "Aftab Ahmad", "Riaz Ahmad", "Muhammad Sadiq",
  "Habib Ur Rehman", "Fazal Wahid", "Muhammad Tariq", "Imtiaz Ali",
  "Shahid Mehmood", "Zulfiqar Ali", "Muhammad Owais", "Nasrullah Khan",
  "Arshad Iqbal", "Wazir Gul", "Muhammad Jamil",
];

const SURNAMES = [
  "Khan", "Khan", "Khan", "Shah", "Afridi", "Yousafzai", "Bangash", "Khattak",
  "Mehsud", "Tarkai", "Abbasi", "Gilani", "Qureshi", "Chaudhry", "Bhatti",
  "Malik", "Hussain", "Raza", "Abbas", "Iqbal", "Anwar", "Bashir", "Latif",
  "Nawaz", "Sadiq", "Zaman", "Orakzai", "Mohmand", "Sarwar", "Durrani",
];

const TEACHER_SEED: Array<[string, string, string]> = [
  ["Muhammad Saleem", "Ph.D Commerce", "Professor"],
  ["Sadia Khan", "M.Com", "Assistant Professor"],
  ["Imran Yousafzai", "M.Phil Economics", "Professor"],
  ["Nadia Shah", "M.Com Finance", "Lecturer"],
  ["Waqar Ahmed", "MS Computer Science", "Assistant Professor"],
  ["Faisal Mehsud", "M.Sc Statistics", "Lecturer"],
  ["Rabia Bibi", "M.Com", "Lecturer"],
  ["Shahid Iqbal", "LL.M Business Law", "Assistant Professor"],
  ["Ayesha Noor", "M.Phil English", "Senior Lecturer"],
  ["Kamran Afridi", "MBA", "Professor"],
  ["Hina Gul", "M.Sc Mathematics", "Lecturer"],
  ["Asif Mahmood", "M.Com", "Assistant Professor"],
  ["Zeeshan Raza", "MS Information Technology", "Lecturer"],
  ["Saima Bibi", "M.Com Banking", "Senior Lecturer"],
];

/* ------------------------------ academic defs ----------------------------- */

const CLASS_DEFS = [
  { name: "D.Com 1st Year", code: "DCOM-1", sections: ["A", "B", "C", "D", "E"], size: 45 },
  { name: "D.Com 2nd Year", code: "DCOM-2", sections: ["A", "B", "C", "D", "E"], size: 42 },
  { name: "I.Com 1st Year", code: "ICOM-1", sections: ["A", "B", "C", "D", "E"], size: 45 },
  { name: "I.Com 2nd Year", code: "ICOM-2", sections: ["A", "B", "C", "D", "E"], size: 42 },
  { name: "CIT", code: "CIT", sections: ["A", "B", "C", "D", "E"], size: 40 },
  { name: "B.Com 1st Year", code: "BCOM-1", sections: ["A", "B", "C", "D"], size: 45 },
];

const SUBJECT_SEED: Array<[string, string]> = [
  ["ACC-101", "Accounting"],
  ["BST-102", "Business Statistics"],
  ["BMT-103", "Business Mathematics"],
  ["ECO-104", "Principles of Economics"],
  ["BNK-105", "Banking & Finance"],
  ["LAW-106", "Business Law"],
  ["COM-107", "Computer Applications"],
  ["ENG-108", "English"],
  ["URD-109", "Urdu"],
  ["ISL-110", "Islamic Studies"],
  ["PST-111", "Pakistan Studies"],
  ["MGT-112", "Principles of Management"],
];

/** Subjects offered per class, in teaching order. */
const CLASS_SUBJECTS: Record<string, string[]> = {
  "DCOM-1": ["ACC-101", "BST-102", "ECO-104", "BNK-105", "LAW-106", "ENG-108", "URD-109", "ISL-110"],
  "DCOM-2": ["ACC-101", "BST-102", "BNK-105", "LAW-106", "MGT-112", "ENG-108", "URD-109", "ISL-110"],
  "ICOM-1": ["ACC-101", "BMT-103", "ECO-104", "COM-107", "ENG-108", "URD-109", "ISL-110", "PST-111"],
  "ICOM-2": ["ACC-101", "BMT-103", "ECO-104", "COM-107", "ENG-108", "URD-109", "PST-111", "ISL-110"],
  CIT: ["COM-107", "BST-102", "BMT-103", "ACC-101", "ENG-108", "URD-109", "PST-111", "ISL-110"],
  "BCOM-1": ["ACC-101", "MGT-112", "BNK-105", "LAW-106", "ECO-104", "ENG-108", "ISL-110", "PST-111"],
};

/* -------------------------------- database -------------------------------- */

export interface DemoDb {
  sessions: AcademicSession[];
  classes: SchoolClass[];
  sections: Section[];
  subjects: Subject[];
  classSubjects: ClassSubject[];
  teachers: Teacher[];
  students: Student[];
  profiles: Profile[];
  attendance: AttendanceRecord[];
  /** School days (Mon–Fri) used for the attendance dataset, oldest first. */
  days: string[];
  /** Today's status plan: exactly 1108 present / 92 absent / 50 leave. */
  todayCounts: { present: number; absent: number; leave: number; total: number };
}

export const TODAY = toDateOnly(new Date());

let cached: DemoDb | null = null;

export function getDb(): DemoDb {
  if (!cached) cached = build();
  return cached;
}

function build(): DemoDb {
  const rng = mulberry32(0x4d43_5043);

  /* ------------------------------ sessions ------------------------------ */
  const year = new Date().getFullYear();
  const sessions: AcademicSession[] = [
    {
      id: "sess-current",
      name: `${year} — ${year + 1}`,
      startDate: `${year}-07-01`,
      endDate: `${year + 1}-06-30`,
      isActive: true,
    },
    {
      id: "sess-prev",
      name: `${year - 1} — ${year}`,
      startDate: `${year - 1}-07-01`,
      endDate: `${year}-06-30`,
      isActive: false,
    },
  ];
  const sessionId = sessions[0]!.id;

  /* ------------------------------- subjects ----------------------------- */
  const subjects: Subject[] = SUBJECT_SEED.map(([code, name], i) => ({
    id: `sub-${i + 1}`,
    code,
    name,
    isActive: true,
    classCount: 0,
  }));
  const subjectByCode = new Map(subjects.map((s) => [s.code, s]));

  /* ------------------------------- teachers ----------------------------- */
  const teachers: Teacher[] = TEACHER_SEED.map(([name, qualification, designation], i) => ({
    id: `tch-${i + 1}`,
    teacherCode: `TCH-${pad(i + 1, 3)}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@mcs.edu.pk`,
    phone: `+92 300 ${pad(1000000 + Math.floor(rng() * 8999999), 7)}`,
    qualification,
    designation,
    status: "active" as const,
    profileId: `prf-tch-${i + 1}`,
    joinedAt: `${year - 6 + (i % 6)}-08-15`,
    assignedClasses: [],
  }));

  /* -------------------------- classes & sections ------------------------ */
  const classes: SchoolClass[] = [];
  const sections: Section[] = [];
  for (const def of CLASS_DEFS) {
    const classId = `cls-${def.code.toLowerCase()}`;
    classes.push({
      id: classId,
      name: def.name,
      code: def.code,
      sessionId,
      isActive: true,
      studentCount: def.sections.length * def.size,
      sectionCount: def.sections.length,
      sessionName: sessions[0]!.name,
    });
    for (const s of def.sections) {
      sections.push({
        id: `sec-${def.code.toLowerCase()}-${s.toLowerCase()}`,
        classId,
        className: def.name,
        name: s,
        capacity: def.size + 5,
        isActive: true,
        studentCount: def.size,
      });
    }
  }

  /* ---------------------------- class subjects -------------------------- */
  const classSubjects: ClassSubject[] = [];
  let csSeq = 0;
  for (const def of CLASS_DEFS) {
    const classId = `cls-${def.code.toLowerCase()}`;
    const codes = CLASS_SUBJECTS[def.code] ?? [];
    codes.forEach((code, idx) => {
      const subject = subjectByCode.get(code)!;
      subject.classCount = (subject.classCount ?? 0) + 1;
      const teacher = teachers[(classes.length + idx) % teachers.length]!;
      const id = `cs-${++csSeq}`;
      classSubjects.push({
        id,
        classId,
        sectionId: null,
        subjectId: subject.id,
        teacherId: teacher.id,
        className: def.name,
        sectionName: undefined,
        subjectName: subject.name,
        subjectCode: subject.code,
        teacherName: teacher.name,
      });
      teacher.assignedClasses.push({
        classId,
        className: def.name,
        sectionId: null,
        sectionName: null,
        subjectId: subject.id,
        subjectName: subject.name,
        subjectCode: subject.code,
      });
    });
  }

  /* ------------------------------- students ----------------------------- */
  const students: Student[] = [];
  let studentSeq = 0;
  for (const def of CLASS_DEFS) {
    const classId = `cls-${def.code.toLowerCase()}`;
    let roll = 100;
    for (const s of def.sections) {
      const sectionId = `sec-${def.code.toLowerCase()}-${s.toLowerCase()}`;
      for (let i = 0; i < def.size; i++) {
        studentSeq++;
        roll++;
        const female = rng() < 0.46;
        const first = female ? pick(rng, FEMALE_NAMES) : pick(rng, MALE_NAMES);
        // Occasionally double the honorific for realism.
        const given = rng() < 0.25 && !female ? `Muhammad ${first}` : first;
        const fullName = `${given} ${pick(rng, SURNAMES)}`;
        const admissionMonth = rng() < 0.5 ? "08" : "09";
        students.push({
          id: `stu-${pad(studentSeq, 4)}`,
          studentId: `MCC-${year % 100}${pad(studentSeq, 4)}`,
          rollNumber: `${roll}`,
          fullName,
          fatherName: pick(rng, FATHER_NAMES),
          dateOfBirth: `${year - 19 - Math.floor(rng() * 4)}-${pad(1 + Math.floor(rng() * 12), 2)}-${pad(1 + Math.floor(rng() * 27), 2)}`,
          gender: (female ? "female" : "male") as Gender,
          classId,
          sectionId,
          sessionId,
          className: def.name,
          sectionName: s,
          sessionName: sessions[0]!.name,
          phone: rng() < 0.7 ? `+92 3${Math.floor(rng() * 9)} ${pad(Math.floor(rng() * 9000000) + 1000000, 7)}` : null,
          email: rng() < 0.35 ? `${fullName.toLowerCase().replace(/[^a-z]+/g, ".")}.${roll}@mcs.edu.pk` : null,
          address: `House ${1 + Math.floor(rng() * 400)}, Block ${pick(rng, ["A", "B", "C", "D"])}, Peshawar`,
          admissionDate: `${year}-${admissionMonth}-${pad(1 + Math.floor(rng() * 20), 2)}`,
          status: "active" as const,
          photoUrl: null,
          createdAt: `${year}-${admissionMonth}-${pad(1 + Math.floor(rng() * 20), 2)}T09:00:00`,
        });
      }
    }
  }

  /* ------------------------------ attendance ---------------------------- */
  const days = schoolDays(new Date(), 25);
  const today = days[days.length - 1]!;
  const pastDays = days.slice(0, -1);

  // Per-student reliability drives historical status.
  const reliability = new Map<string, number>();
  for (const s of students) {
    const roll = rng();
    reliability.set(s.id, roll < 0.9 ? 0.87 + rng() * 0.12 : roll < 0.97 ? 0.76 + rng() * 0.1 : 0.58 + rng() * 0.16);
  }

  const attendance: AttendanceRecord[] = [];
  const classSubjectByClass = new Map<string, ClassSubject[]>();
  for (const cs of classSubjects) {
    const list = classSubjectByClass.get(cs.classId) ?? [];
    list.push(cs);
    classSubjectByClass.set(cs.classId, list);
  }

  const makeRecord = (
    student: Student,
    date: string,
    status: AttendanceStatus,
    dayIdx: number,
    remarks: string | null,
  ): AttendanceRecord => {
    const list = classSubjectByClass.get(student.classId) ?? [];
    const cs = list[dayIdx % Math.max(list.length, 1)];
    return {
      id: `att_${student.id}_${date}`,
      studentId: student.id,
      classId: student.classId,
      sectionId: student.sectionId,
      subjectId: cs?.subjectId ?? null,
      teacherId: cs?.teacherId ?? null,
      sessionId,
      date,
      status,
      remarks,
      studentName: student.fullName,
      rollNumber: student.rollNumber,
      studentCode: student.studentId,
      fatherName: student.fatherName,
      className: student.className,
      subjectCode: cs?.subjectCode ?? undefined,
      teacherName: cs?.teacherName ?? undefined,
      createdAt: `${date}T08:30:00`,
      updatedAt: `${date}T08:30:00`,
    };
  };

  pastDays.forEach((date, dayIdx) => {
    for (const student of students) {
      const rel = reliability.get(student.id)!;
      let status: AttendanceStatus;
      if (rng() < rel) status = "present";
      else status = rng() < 0.74 ? "absent" : "leave";
      const remarks =
        status === "present" && rng() < 0.035
          ? "Late"
          : status === "absent" && rng() < 0.12
            ? "Not informed"
            : status === "leave"
              ? rng() < 0.5
                ? "Approved leave"
                : null
              : null;
      attendance.push(makeRecord(student, date, status, dayIdx, remarks));
    }
  });

  // Today — exact, presentation-ready distribution.
  const total = students.length;
  const plan: AttendanceStatus[] = [];
  const presentCount = Math.round(total * 0.8864); // 1108 of 1250 → 88.6%
  const leaveCount = Math.round(total * 0.04); // 50
  const absentCount = total - presentCount - leaveCount; // 92
  for (let i = 0; i < presentCount; i++) plan.push("present");
  for (let i = 0; i < absentCount; i++) plan.push("absent");
  for (let i = 0; i < leaveCount; i++) plan.push("leave");
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [plan[i], plan[j]] = [plan[j]!, plan[i]!];
  }
  students.forEach((student, i) => {
    const status = plan[i]!;
    const remarks =
      status === "leave" ? "Approved leave" : status === "absent" && rng() < 0.15 ? "Not informed" : null;
    attendance.push(makeRecord(student, today, status, pastDays.length, remarks));
  });

  /* -------------------------------- profiles ---------------------------- */
  const profiles: Profile[] = [
    {
      id: "prf-admin",
      email: "admin@mcs.edu.pk",
      fullName: "Muhammad Irshad",
      role: "admin",
      phone: "+92 300 1234567",
      avatarUrl: null,
      status: "active",
      teacherId: null,
      createdAt: `${year - 3}-01-10T09:00:00`,
      lastSignInAt: `${today}T08:05:00`,
    },
    ...teachers.map<Profile>((t) => ({
      id: t.profileId!,
      email: t.email,
      fullName: t.name,
      role: "teacher",
      phone: t.phone,
      avatarUrl: null,
      status: t.status === "active" ? "active" : "inactive",
      teacherId: t.id,
      createdAt: t.joinedAt,
      lastSignInAt: `${today}T08:12:00`,
    })),
  ];

  return {
    sessions,
    classes,
    sections,
    subjects,
    classSubjects,
    teachers,
    students,
    profiles,
    attendance,
    days,
    todayCounts: { present: presentCount, absent: absentCount, leave: leaveCount, total },
  };
}

/* --------------------------------- lookups -------------------------------- */

interface Maps {
  students: Map<string, Student>;
  classes: Map<string, SchoolClass>;
  sections: Map<string, Section>;
  subjects: Map<string, Subject>;
  teachers: Map<string, Teacher>;
  sessions: Map<string, AcademicSession>;
}

let maps: Maps | null = null;

export function getMaps(): Maps {
  if (!maps) {
    const db = getDb();
    maps = {
      students: new Map(db.students.map((s) => [s.id, s])),
      classes: new Map(db.classes.map((c) => [c.id, c])),
      sections: new Map(db.sections.map((s) => [s.id, s])),
      subjects: new Map(db.subjects.map((s) => [s.id, s])),
      teachers: new Map(db.teachers.map((t) => [t.id, t])),
      sessions: new Map(db.sessions.map((s) => [s.id, s])),
    };
  }
  return maps;
}
