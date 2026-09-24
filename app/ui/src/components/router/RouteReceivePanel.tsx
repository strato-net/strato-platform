import type { RoutePickerToken, RouteQuoteResponse, SwapToken } from "@/interface/swap";
import { useEarnContext } from "@/context/EarnContext";
import { ROUTE_DESTINATIONS } from "@/lib/constants";
import { normalizeRouteAddress } from "@/lib/route";
import { buildAssetApyInfo } from "@/utils/earnUtils";
import { formatAmount, formatUnits } from "@/utils/numberUtils";
import RouteAssetYield from "./RouteAssetYield";
import RouteTokenPicker from "./RouteTokenPicker";

export default function RouteReceivePanel({ tokens, token, quote, usd, loading, pending, error, onSelect }: {
  tokens: RoutePickerToken[];
  token?: SwapToken;
  quote?: RouteQuoteResponse;
  usd?: string | null;
  loading: boolean;
  pending: boolean;
  error?: string;
  onSelect: (address: string) => void;
}) {
  const destination = token?.routeDestination ?? "token";
  const choices = tokens.filter(item => (item.routeDestination ?? "token") === destination);
  const deposit = destination !== "token";
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  // Best holding APY per earn category, shown on the category chips so the
  // earning destinations are visible before any selection.
  const categoryApyLabel = (category: string): string => {
    if (category === "token" || !tokenApysLoaded) return "";
    let best = 0;
    let count = 0;
    for (const item of tokens) {
      if ((item.routeDestination ?? "token") !== category) continue;
      const apys = tokenApys.find(entry => normalizeRouteAddress(entry.token) === normalizeRouteAddress(item.address))?.apys ?? [];
      const total = buildAssetApyInfo(apys)?.total ?? 0;
      // Holding yields above 100% are bad benchmark data; keep them off the headline chip.
      if (total > 0 && total <= 100) {
        best = Math.max(best, total);
        count++;
      }
    }
    return best > 0 ? ` · ${count > 1 ? "up to " : ""}${best.toFixed(1)}%` : "";
  };

  return <div className="rounded-md border-2 border-border p-3 space-y-2">
    <div className="flex flex-wrap gap-2" aria-label="Receive asset category">
      {ROUTE_DESTINATIONS.map(category => {
        const first = tokens.find(item => (item.routeDestination ?? "token") === category.value);
        return <button key={category.value} type="button" aria-pressed={destination === category.value}
          disabled={pending || loading || !first}
          title={!first && !loading ? `No ${category.label.toLowerCase()} destinations available` : undefined}
          className={`rounded-md border-2 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${destination === category.value ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300" : "border-border text-muted-foreground hover:bg-muted/50"}`}
          onClick={() => { if (first && category.value !== destination) onSelect(first.id); }}>{category.label}{categoryApyLabel(category.value)}</button>;
      })}
    </div>
    <div className="flex items-center gap-2 pt-1">
      <RouteTokenPicker label={destination === "vault" ? "Choose yield vault" : destination === "savings" ? "Choose savings product" : "Choose receive token"}
        tokens={choices} value={token?.address} onSelect={onSelect} loading={loading} staticSingle />
      <div className="h-10 min-w-0 flex-1 flex items-center justify-end text-xl font-bold">{quote ? formatAmount(formatUnits(quote.amountOut, token?.customDecimals ?? 18)) : <span className="text-muted-foreground/50">0</span>}</div>
    </div>
    {usd && <p className="text-right text-xs text-muted-foreground pt-0.5">{deposit ? "Estimated shares · " : ""}≈ {usd}</p>}
    {deposit && <p className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
      Your assets are converted as needed and deposited into {destination === "vault" ? "this vault" : "savings"}. You receive {token?._symbol} shares on STRATO.
    </p>}
    <RouteAssetYield address={token?.address} />
    {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
  </div>;
}
