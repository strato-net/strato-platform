import React from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  const styles = {
    primary: "bg-[#001B70] text-white hover:bg-[#00257a] disabled:opacity-50",
    secondary: "bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800",
    ghost: "bg-transparent text-[#001B70] dark:text-blue-300 hover:bg-slate-100 dark:hover:bg-slate-900",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return (
    <button
      className={cx(
        "w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        styles,
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-lg border border-slate-300 dark:border-slate-800 px-3 py-2 text-sm outline-none focus:border-[#001B70] focus:ring-1 focus:ring-[#001B70]",
        className
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-[#001B70] px-4 py-3 text-white">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-white/15 text-sm font-bold">
          S
        </div>
        <span className="text-sm font-semibold">{title}</span>
      </div>
      {right}
    </div>
  );
}

export function shortAddr(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/strato-icon.png"
      alt="STRATO"
      className={cx("h-6 w-6 rounded", className)}
    />
  );
}

/** Deterministic gradient avatar derived from an address. */
export function Avatar({ address, size = 28 }: { address?: string | null; size?: number }) {
  const seed = address ?? "0x0";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 60) % 360;
  return (
    <span
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${h2} 70% 45%))`,
      }}
      className="inline-block shrink-0 rounded-full"
    />
  );
}

/** Open a URL in a new browser tab (works from the popup). */
export function openTab(url: string): void {
  try {
    browser.tabs.create({ url });
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-red-600">{children}</p>;
}
