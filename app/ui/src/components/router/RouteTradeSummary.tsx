import type { RouteQuoteResponse, CompositeRouteQuoteResponse, SwapToken } from "@strato/shared-types";
import { SWAP_FEE, WAD } from "@/lib/constants";
import { formatAmount, formatUnits } from "@/utils/numberUtils";

export default function RouteTradeSummary({ quote, inputAmount, inputDecimals, inputSymbol, outputToken, external, fetching, error }: {
  quote?: RouteQuoteResponse | CompositeRouteQuoteResponse;
  inputAmount: string;
  inputDecimals: number;
  inputSymbol?: string;
  outputToken?: SwapToken;
  external: boolean;
  fetching: boolean;
  error?: string;
}) {
  const bridge = quote && "bridge" in quote ? quote.bridge : undefined;
  const fallback = quote && "depositAction" in quote && quote.depositAction.action === 4;
  const rate = quote && BigInt(inputAmount) > 0n
    ? BigInt(quote.amountOut) * 10n ** BigInt(inputDecimals) * WAD / (BigInt(inputAmount) * 10n ** BigInt(outputToken?.customDecimals ?? 18)) : undefined;
  return <div className="space-y-2 text-xs">
    <p className="min-h-5 text-muted-foreground" role="status">{error || (fetching ? quote ? "Updating quote…" : "Getting quote…" : quote ? "Quote ready" : "Enter an amount to get a quote")}</p>
    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Rate</span><span className="text-right">{rate === undefined ? "—" : `1 ${inputSymbol} ≈ ${formatAmount(formatUnits(rate))} ${outputToken?._symbol}`}</span></div>
    <div className="flex justify-between gap-3"><span className="text-muted-foreground">{fallback ? "Minimum if traded" : "Minimum received"}</span><span className="text-right font-semibold">{!quote ? "—" : bridge?.rebaseFactor && !fallback ? "Depends on rebase factor at settlement" : `${formatUnits(quote.minFinalOut, outputToken?.customDecimals ?? 18)} ${outputToken?._symbol}`}</span></div>
    <div className="flex justify-between gap-3"><span className="text-muted-foreground">{external ? "Network gas" : "Transaction fee"}</span><span className="text-right">{external ? "Shown in wallet" : `${SWAP_FEE} USDST · vouchers applied first`}</span></div>
  </div>;
}

export function RouteFallback({ quote, fallbackDecimals = 18, outputSymbol }: {
  quote?: CompositeRouteQuoteResponse;
  fallbackDecimals?: number;
  outputSymbol?: string;
}) {
  const bridge = quote?.bridge;
  const fallback = quote?.depositAction.action === 4;
  return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-muted-foreground">
    {bridge && fallback ? `Fallback: ${bridge.rebaseFactor ? "approximately " : ""}${formatUnits(bridge.bridgedAmount, fallbackDecimals)} ${bridge.targetStratoSymbol} if the trade cannot meet your minimum. The ${outputSymbol} minimum does not apply.${bridge.rebaseFactor ? " Amount depends on the rebase factor at settlement." : ""}`
      : bridge ? `Deposits as ${bridge.targetStratoSymbol} on STRATO.` : "Your deposit outcome will appear with the quote."}
  </p>;
}
