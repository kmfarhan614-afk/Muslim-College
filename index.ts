import { DEMO_MODE } from "@/lib/brand";
import { demoServices } from "@/services/demo";
import type { Services } from "@/services/types";

/**
 * Returns the singleton service registry. In demo mode (no Supabase keys) we
 * use the deterministic in-memory services. If Supabase becomes configured the
 * real implementation can replace this export without touching UI code.
 */
export function getServices(): Services {
  // For now, demo mode is the default/expected path for this project.
  return demoServices;
}

export const services = getServices();
export type { Services } from "@/services/types";
export { demoServices } from "@/services/demo";
export { getDb, getMaps, TODAY } from "@/services/demo/seed";
