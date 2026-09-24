import { useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TokenAvatar } from "@/components/swap/TokenInputPanel";
import RouteAssetYield from "./RouteAssetYield";
import { effectiveDollarWei, fmtSpotDollarWei, formatBalance } from "@/utils/numberUtils";
import type { RoutePickerToken } from "@/interface/swap";

export default function RouteTokenPicker({ label, tokens, value, onSelect, loading = false, external = false, staticSingle = false }: {
  label: string;
  tokens: RoutePickerToken[];
  value?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  external?: boolean;
  staticSingle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = tokens.find(token => token.id === value);
  const filtered = tokens.filter(token => `${token.symbol} ${token.name} ${token.address} ${token.detail ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const avatar = (token: RoutePickerToken) => <TokenAvatar token={{ _name: token.name, _symbol: token.symbol, images: token.image ? [{ value: token.image }] : [] }} size="h-8 w-8 shrink-0" />;

  if (staticSingle && tokens.length === 1 && selected) return <div className="flex max-w-[50%] shrink-0 items-center gap-2" aria-label={label}>
    {avatar(selected)}<span className="truncate font-semibold">{selected.symbol}</span>
  </div>;

  return <>
    <Button type="button" variant="outline" className="h-11 max-w-[50%] shrink-0 gap-2 rounded-full px-3" aria-label={label} onClick={() => { setSearch(""); setOpen(true); }}>
      {selected && avatar(selected)}<span className="truncate">{selected?.symbol ?? "Select token"}</span><ChevronDown className="h-4 w-4 shrink-0" />
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader><DialogTitle>{label}</DialogTitle><DialogDescription>Search by token name, symbol or address.</DialogDescription></DialogHeader>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="Search tokens" placeholder="Search tokens" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {!filtered.length && <p className="py-6 text-center text-sm text-muted-foreground">{loading ? "Loading tokens…" : "No matching tokens"}</p>}
          {filtered.map(token => {
            const spot = fmtSpotDollarWei(token.price ?? "0");
            const effective = token.metalFeeBps !== undefined ? effectiveDollarWei(token.price ?? "0", token.metalFeeBps) : null;
            return <div key={token.id} className="rounded-xl border border-border p-3">
              <button type="button" className="flex w-full items-center gap-3 text-left" onClick={() => { onSelect(token.id); setOpen(false); }}>
                {avatar(token)}
                <span className="min-w-0 flex-1"><span className="block font-semibold">{token.symbol}</span><span className="block truncate text-xs text-muted-foreground">{token.name}</span>{token.detail && <span className="block text-xs text-muted-foreground">{token.detail}</span>}</span>
                <span className="max-w-[55%] break-words text-right text-xs"><span className="block">{token.balance === undefined ? "Balance —" : `${formatBalance(token.balance, undefined, token.decimals, 2, 6)} ${token.symbol}`}</span><span className="block text-muted-foreground">{effective ? `${effective}/unit incl. mint fee` : spot ?? "Price unavailable"}</span></span>
                {token.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              {effective && <p className="mt-1 text-right text-xs text-muted-foreground">Spot {spot} · Mint fee {Number(token.metalFeeBps) / 100}%</p>}
              {!external && <RouteAssetYield address={token.address} destination={token.routeDestination} />}
            </div>;
          })}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
