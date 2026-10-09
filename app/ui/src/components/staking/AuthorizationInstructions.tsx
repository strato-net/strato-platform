import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AuthorizationDigest } from "@/components/staking/authorization";

// Plain text that copies itself when clicked; no button chrome.
export const CopyableText = ({ value, display, className = "" }: { value: string; display?: string; className?: string }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable; the value stays selectable on screen.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : `Click to copy ${value}`}
      className={`cursor-pointer rounded font-mono underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      {copied ? "Copied" : (display ?? value)}
    </button>
  );
};

export const CopyValueButton = ({ value, label = "Copy" }: { value: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (e.g. insecure context); the value stays selectable on screen.
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={copy}>
      {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
};

// The one line a node runner has to type. Shown as a terminal line so it reads as "run this",
// not as data to inspect.
export const CommandBlock = ({ command }: { command: string }) => (
  <div className="flex items-stretch gap-2 rounded-md border border-border bg-muted/40">
    <code className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3 py-2 font-mono text-sm">
      <span aria-hidden className="select-none text-muted-foreground">$</span>
      <span className="whitespace-nowrap">{command}</span>
    </code>
    <div className="flex items-center pr-2">
      <CopyValueButton value={command} />
    </div>
  </div>
);

// A numbered step in a real sequence. `state` drives the marker: a check once the step is behind
// the user, a number while it is ahead or current.
export const OnboardingStep = ({
  index,
  title,
  state = "todo",
  children,
}: {
  index: number;
  title: string;
  state?: "todo" | "current" | "done";
  children?: ReactNode;
}) => (
  <li className="flex gap-3">
    <div
      aria-hidden
      className={[
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
        state === "done"
          ? "border-primary bg-primary text-primary-foreground"
          : state === "current"
            ? "border-primary text-primary"
            : "border-border text-muted-foreground",
      ].join(" ")}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : index}
    </div>
    <div className="min-w-0 flex-1">
      <p className={["text-sm font-medium", state === "todo" ? "text-muted-foreground" : ""].join(" ")}>{title}</p>
      {children && <div className="mt-1.5 space-y-2 text-sm text-muted-foreground">{children}</div>}
    </div>
  </li>
);

// A value the link filled in, shown read-only with a way to override it.
export const PrefilledRow = ({
  label,
  value,
  note,
  onChange,
}: {
  label: string;
  value: string;
  note?: string;
  onChange?: () => void;
}) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-sm">
    <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
    <span className="min-w-0 flex-1 truncate font-mono text-xs">{value}</span>
    {note && <span className="text-xs text-muted-foreground">{note}</span>}
    {onChange && (
      <button type="button" className="text-xs font-medium text-primary underline-offset-2 hover:underline" onClick={onChange}>
        Change
      </button>
    )}
  </div>
);

// The raw digest, for a validator key held outside a vault. Collapsed by default: almost nobody
// needs it, and a 32-byte hash is noise to everyone else.
export const DigestDisclosure = ({ authorization }: { authorization: AuthorizationDigest }) => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronDown className={["h-3.5 w-3.5 transition-transform motion-reduce:transition-none", open ? "rotate-180" : ""].join(" ")} />
          Advanced: sign with a key held outside a vault
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Digest to sign (nonce {authorization.nonce})</span>
          <CopyValueButton value={authorization.digest} />
        </div>
        <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">{authorization.digest}</p>
        <p className="text-xs text-muted-foreground">
          Sign these raw 32 bytes with the validator key, no message prefix (not personal_sign), and paste the signature above.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
};
