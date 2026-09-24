import type { RoutePickerToken, RouteQuoteResponse, SwapToken } from "@/interface/swap";
import { ROUTE_DESTINATIONS } from "@/lib/constants";
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

  return <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 lg:py-3">
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">You receive · STRATO</p>
    <p className="mt-1 text-xs text-muted-foreground">Choose a token, savings position, or yield vault.</p>
    <div className="my-3 flex flex-wrap gap-2" aria-label="Receive asset category">
      {ROUTE_DESTINATIONS.map(category => {
        const first = tokens.find(item => (item.routeDestination ?? "token") === category.value);
        return <button key={category.value} type="button" aria-pressed={destination === category.value}
          disabled={pending || loading || !first}
          title={!first && !loading ? `No ${category.label.toLowerCase()} destinations available` : undefined}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${destination === category.value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground"}`}
          onClick={() => { if (first && category.value !== destination) onSelect(first.id); }}>{category.label}</button>;
      })}
    </div>
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 text-3xl font-semibold tracking-tight">{quote ? formatAmount(formatUnits(quote.amountOut, token?.customDecimals ?? 18)) : "—"}</div>
      <RouteTokenPicker label={destination === "vault" ? "Choose yield vault" : destination === "savings" ? "Choose savings product" : "Choose receive token"}
        tokens={choices} value={token?.address} onSelect={onSelect} loading={loading} staticSingle />
    </div>
    <p className="mt-1 min-h-4 text-xs text-muted-foreground">{deposit ? "Estimated shares · " : ""}{usd ? `≈ ${usd}` : "— USD"}</p>
    {deposit && <p className="mt-2 border-l-2 border-border pl-2 text-xs text-muted-foreground">
      Your assets are converted as needed and deposited into {destination === "vault" ? "this vault" : "savings"}. You receive {token?._symbol} shares on STRATO.
    </p>}
    <RouteAssetYield address={token?.address} destination={destination} />
    {error && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
  </div>;
}
