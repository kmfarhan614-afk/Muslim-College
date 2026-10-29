/* ==========================================================================
   Branding configuration
   Central place to change the college name, logo, copy and imagery.
   Colour tokens live in `app/globals.css` (@theme block) so both the CSS and
   the Tailwind utility layer stay in sync.
   ========================================================================== */

export interface BrandConfig {
  /** Full legal name of the institution */
  name: string;
  /** Short lockup used in the sidebar / browser tab */
  nameLines: [string, string];
  /** Product name shown under the institution name */
  systemName: string;
  /** Marketing line on the login screen */
  tagline: string;
  /** Fallback initials rendered when the logo file is missing */
  monogram: string;
  /** Path (inside /public) to the college crest */
  logo: string;
  /** Optional campus photograph used on the login split-screen */
  heroImage: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  sessionLabel: string;
}

export const brand: BrandConfig = {
  name: "Muslim Commerce College Peshawar",
  nameLines: ["MUSLIM COMMERCE", "COLLEGE PESHAWAR"],
  systemName: "Attendance Management System",
  tagline: "Digital attendance management for a smarter and more organized college.",
  monogram: "MC",
  logo: "/branding/logo.png",
  heroImage: null,
  address: "Peshawar, Khyber Pakhtunkhwa, Pakistan",
  phone: "+92 91 000 0000",
  email: "info@mcs.edu.pk",
  website: "www.mcs.edu.pk",
  sessionLabel: "Academic Session",
};

/** Marks the application as running in demo mode (Supabase keys absent). */
export const DEMO_MODE = !(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const DEMO_CREDENTIALS = [
  { role: "Admin", email: "admin@mcs.edu.pk", password: "Admin@123" },
  { role: "Teacher", email: "teacher@mcs.edu.pk", password: "Teacher@123" },
] as const;
