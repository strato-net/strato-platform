import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { shortenHex } from "@/lib/utils";
import { useUserSearch } from "@/services/accounts";
import { strip0x } from "@/services/userWallets";

const isAddressLike = (s: string) => /^(0x)?[0-9a-fA-F]{40}$/.test(s.trim());

interface AddressInputProps {
  /** Raw field text: a 0x address or a username. */
  value: string;
  /** The resolved 40-hex address for the current text ("" while unresolved). */
  resolved: string;
  /**
   * Fired with the new text and its resolved address. May fire again for the
   * same text once an async username lookup resolves.
   */
  onChange: (text: string, resolvedAddress: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Address field with username resolution: accepts a raw 0x address, or a User
 * wallet username (e.g. "BlockApps") that resolves to that user's contract
 * address via Cirrus. Shows suggestions while typing; an exact username match
 * resolves automatically without needing a click.
 */
export function AddressInput({
  value,
  resolved,
  onChange,
  id,
  placeholder = "0x… address or username",
  disabled,
  className,
}: AddressInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);

  const isAddr = isAddressLike(value);
  const searchTerm = isAddr ? "" : value.trim();
  const { data: matches } = useUserSearch(searchTerm);
  const suggestions = useMemo(() => (matches ?? []).slice(0, 6), [matches]);

  // An exact (unique) username match resolves without a click.
  const autoResolved = useMemo(() => {
    if (isAddr) return strip0x(value);
    if (!searchTerm) return "";
    const hits = (matches ?? []).filter(
      (u) => u.username.toLowerCase() === searchTerm.toLowerCase()
    );
    return hits.length === 1 ? strip0x(hits[0].address) : "";
  }, [isAddr, value, searchTerm, matches]);

  // Username lookups land async — sync the resolution back to the parent.
  useEffect(() => {
    if (autoResolved && autoResolved !== strip0x(resolved)) onChange(value, autoResolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoResolved]);

  return (
    <div className="relative min-w-0 flex-1 space-y-1">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          const v = e.target.value;
          onChange(v, isAddressLike(v) ? strip0x(v) : "");
          setShowSuggestions(true);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        className={className}
      />
      {showSuggestions && suggestions.length > 0 ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {suggestions.map((u) => (
            <button
              type="button"
              key={u.address}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(u.username, strip0x(u.address));
                setShowSuggestions(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
            >
              <span className="font-medium">{u.username}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {shortenHex(u.address)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {resolved && !isAddr ? (
        <p className="font-mono text-xs text-muted-foreground">→ {resolved}</p>
      ) : null}
    </div>
  );
}
