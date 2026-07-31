import { config } from "../config";

// Same open-redirect guard rules as the edge /login?returnTo= handler, plus an
// explicit allowlist. Applied at link creation AND re-applied at resolve time
// so tightening the allowlist retroactively disarms stale DB rows.
export const isAllowedDestination = (destination: string): boolean => {
  if (typeof destination !== "string") return false;
  if (!destination.startsWith("/")) return false;
  if (destination.startsWith("//")) return false;
  if (destination.includes("://")) return false;
  if (/[\r\n]/.test(destination)) return false;
  return config.tracking.destinationAllowlist.some(
    (entry) => destination === entry || destination.startsWith(entry + "/")
  );
};
