import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn, shortenHex } from "@/lib/utils";

/** Inline copy-to-clipboard icon button. */
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy"
      className={cn("inline-flex items-center text-muted-foreground hover:text-foreground transition-colors", className)}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** A compressed address with its copy control; hovering shows it in full. */
export function CopyableAddress({ value, className }: { value: string; className?: string }) {
  const address = value.replace(/^0x/i, "");
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono", className)}>
      <span title={`0x${address}`}>{shortenHex(address, 6, 4)}</span>
      <CopyButton value={address} className="shrink-0" />
    </span>
  );}
