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

/** Shorten a hex address/hash for display, e.g. 0x1234…abcd */
export function shortenHex(value: string, lead = 6, trail = 4): string {
  if (!value) return "";
  const v = value.startsWith("0x") ? value : `0x${value}`;
  if (v.length <= lead + trail + 2) return v;
  return `${v.slice(0, lead + 2)}…${v.slice(-trail)}`;
}
