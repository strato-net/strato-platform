import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Copy, ExternalLink, X } from 'lucide-react';
import { userTimelinePath } from '../api';
import { explorerUrl } from '../auth';

// Minimal hand-rolled primitives (no component library): enough for an
// internal dashboard, themed via the shared CSS tokens.

export const Card = ({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) => (
  <section className="rounded-lg border border-border bg-card">
    {(title || subtitle) && (
      <header className="border-b border-border px-4 py-3">
        {title && <h2 className="text-sm font-semibold">{title}</h2>}
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </header>
    )}
    <div className="p-4">{children}</div>
  </section>
);

export const Badge = ({ children, variant = 'outline' }: { children: ReactNode; variant?: 'outline' | 'secondary' }) => (
  <span
    className={
      variant === 'secondary'
        ? 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground'
        : 'inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-foreground'
    }
  >
    {children}
  </span>
);

export const Button = ({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'outline' | 'ghost';
  disabled?: boolean;
}) => {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90',
    outline: 'border border-border hover:bg-muted',
    ghost: 'hover:bg-muted',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
};

// Small square button for icon-only controls (map zoom), where Button's
// text padding is too generous.
export const IconButton = ({
  children,
  onClick,
  label,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
  >
    {children}
  </button>
);

// Dual-handle range slider: two native range inputs overlaid on one track, so
// keyboard and screen-reader support come for free. The handles can't cross
// (each drag clamps against the other). Thumb styling lives in index.css
// (.range-input) because pseudo-elements can't be expressed in Tailwind here.
export const RangeSlider = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  labelStart,
  labelEnd,
  disabled,
}: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
  labelStart: string;
  labelEnd: string;
  disabled?: boolean;
}) => {
  const span = Math.max(1, max - min);
  const percent = (v: number) => ((Math.min(Math.max(v, min), max) - min) / span) * 100;
  return (
    <div className={`relative h-6 w-full ${disabled ? 'opacity-50' : ''}`}>
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `${percent(value[0])}%`, right: `${100 - percent(value[1])}%` }}
      />
      <input
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value[0]}
        disabled={disabled}
        aria-label={`Range start — ${labelStart}`}
        aria-valuetext={labelStart}
        onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])}
      />
      <input
        type="range"
        className="range-input"
        min={min}
        max={max}
        step={step}
        value={value[1]}
        disabled={disabled}
        aria-label={`Range end — ${labelEnd}`}
        aria-valuetext={labelEnd}
        onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])}
      />
    </div>
  );
};

export const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse rounded-md bg-muted ${className}`} />
);

export const CopyButton = ({ value, label = 'Copy' }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={copied ? 'Copied!' : label}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`ml-1 transition-colors ${copied ? 'text-green-600' : 'text-muted-foreground hover:text-foreground'}`}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

export const ExplorerLink = ({ path }: { path: string }) => (
  <a
    href={`${explorerUrl}${path}`}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="View on explorer"
    title="View on explorer"
    onClick={(e) => e.stopPropagation()}
    className="ml-1 text-muted-foreground transition-colors hover:text-foreground"
  >
    <ExternalLink size={14} />
  </a>
);

// Like ExplorerLink but for arbitrary external explorers (Etherscan,
// Basescan, …) instead of the STRATO explorer.
export const ExternalExplorerLink = ({ href, title }: { href: string; title: string }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={title}
    title={title}
    onClick={(e) => e.stopPropagation()}
    className="ml-1 text-muted-foreground transition-colors hover:text-foreground"
  >
    <ExternalLink size={14} />
  </a>
);

// The address itself links to the wallet's activity timeline; the icons keep
// their own targets (clipboard, STRATO explorer). Inside clickable table rows
// the navigation must not also trigger the row handler.
export const AddressCell = ({ address }: { address: string | null }) => {
  if (!address) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center font-mono text-xs">
      <Link
        to={userTimelinePath(address)}
        onClick={(e) => e.stopPropagation()}
        title="View activity timeline"
        className="hover:underline"
      >
        {address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address}
      </Link>
      <CopyButton value={address} label="Copy address" />
      <ExplorerLink path={`/address/${address}`} />
    </span>
  );
};

export const Switch = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={(e) => {
      e.stopPropagation();
      onChange(!checked);
    }}
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted'}`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
    />
  </button>
);

export const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const SidePanel = ({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
}) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute right-0 top-0 h-full w-full max-w-xl overflow-y-auto border-l border-border bg-card p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="font-mono text-base font-semibold">{title}</h2>
            {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/50';

export const thClass =
  'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground';
export const tdClass = 'px-3 py-2 text-sm';

export type SortDirection = 'asc' | 'desc';

// Clickable table header: the caller cycles ascending → descending → unsorted.
// The sorted column keeps its arrow, the others only hint at one on hover.
export const SortHeader = ({
  label,
  active,
  direction,
  align,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  align?: 'right';
  onClick: () => void;
}) => (
  <th
    className={`${thClass} ${align === 'right' ? 'text-right' : ''}`}
    aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
  >
    <button
      type="button"
      onClick={onClick}
      title={`Sort by ${label}`}
      className={`group inline-flex max-w-full items-center gap-1 transition-colors hover:text-foreground ${
        active ? 'text-foreground' : ''
      } ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      <span className="truncate">{label}</span>
      {active ? (
        direction === 'asc' ? (
          <ArrowUp size={12} className="shrink-0" />
        ) : (
          <ArrowDown size={12} className="shrink-0" />
        )
      ) : (
        <ChevronsUpDown
          size={12}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
        />
      )}
    </button>
  </th>
);
