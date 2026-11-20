import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a duration in seconds as a compact human string, e.g. "3d 4h 12m". */
export function secondsToHuman(total?: number): string {
  if (!total || total < 0) return "—";
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (!d && !h) parts.push(`${s}s`);
  return parts.join(" ");
}

/** A waiting period in words, e.g. "7 days", "1 day 12 hours" or "none". */
export function formatWaitingPeriod(seconds: number): string {
  if (!seconds) return "none";
  const unit = (count: number, name: string) => count ? `${count} ${name}${count === 1 ? "" : "s"}` : "";
  return [
    unit(Math.floor(seconds / 86400), "day"),
    unit(Math.floor((seconds % 86400) / 3600), "hour"),
    unit(Math.floor((seconds % 3600) / 60), "minute"),
    unit(seconds % 60, "second"),
  ].filter(Boolean).join(" ");
}

/** A chain time in seconds as a local date and time with its time zone. */
export function formatDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Format a block/tx timestamp (ISO string or epoch) for display. */
export function formatTimestamp(ts?: string | number): string {
  if (ts == null || ts === "") return "—";
  const d = typeof ts === "number" ? new Date(ts) : new Date(/^\d+$/.test(String(ts)) ? Number(ts) : String(ts));
  return isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

/** Shorten a hex address/hash for display, e.g. 0x1234…abcd */
export function shortenHex(value: string, lead = 6, trail = 4): string {
  if (!value) return "";
  const v = value.startsWith("0x") ? value : `0x${value}`;
  if (v.length <= lead + trail + 2) return v;
  return `${v.slice(0, lead + 2)}…${v.slice(-trail)}`;
}
