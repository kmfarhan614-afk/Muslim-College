/**
 * Central Supabase configuration.
 * Values come exclusively from environment variables — never hard-code keys.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True only when both public env vars are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Service-role key is server-only. It is intentionally *not* exported through a
 * `NEXT_PUBLIC_` variable so it can never be bundled into client code.
 */
export function getServiceRoleKey(): string {
  if (typeof window !== "undefined") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must never be read in the browser.");
  }
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}
