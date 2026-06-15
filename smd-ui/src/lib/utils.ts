import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shorten a hex address/hash for display, e.g. 0x1234…abcd */
export function shortenHex(value: string, lead = 6, trail = 4): string {
  if (!value) return "";
  const v = value.startsWith("0x") ? value : `0x${value}`;
  if (v.length <= lead + trail + 2) return v;
  return `${v.slice(0, lead + 2)}…${v.slice(-trail)}`;
}
