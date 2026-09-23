import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TokenAvatar } from "@/components/swap/TokenInputPanel";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { useEarnContext } from "@/context/EarnContext";
import { buildEarnApyMap, pathForApyInfo } from "@/utils/earnUtils";
import { effectiveDollarWei, fmtSpotDollarWei, formatBalance } from "@/utils/numberUtils";
import { normalizeRouteAddress } from "@/lib/route";
import type { RoutePickerToken } from "@/interface/swap";

export default function RouteTokenPicker({ label, tokens, value, onSelect, loading = false, external = false }: {
  label: string;
  tokens: RoutePickerToken[];
  value?: string;
  onSelect: (id: string) => void;
  loading?: boolean;
  external?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const { tokenApys } = useEarnContext();
  const apys = useMemo(() => buildEarnApyMap(tokenApys), [tokenApys]);
  const selected = tokens.find(token => token.id === value);
  const filtered = tokens.filter(token => `${token.symbol} ${token.name} ${token.address} ${token.detail ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const avatar = (token: RoutePickerToken) => <TokenAvatar token={{ _name: token.name, _symbol: token.symbol, images: token.image ? [{ value: token.image }] : [] }} size="h-8 w-8 shrink-0" />;

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
            const apy = external ? undefined : apys.get(normalizeRouteAddress(token.address));
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
              {apy && <div className="mt-2"><EarnApyTooltip info={apy}><button type="button" className="text-xs font-semibold text-emerald-600 dark:text-emerald-400" onClick={() => { setOpen(false); navigate(pathForApyInfo(apy)); }}>Earn up to {apy.total.toFixed(2)}% APY ↗</button></EarnApyTooltip></div>}
            </div>;
          })}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
