import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TradePool, TradeQuote } from "@/interface";
import { formatAmount, formatUnits } from "@/utils/numberUtils";

// ============================================================================
// POOL SELECTOR
// One card per pool the pair trades on (V2, stable, and every V3 fee tier).
// The pool quoting the best rate is auto-selected and labeled; the user can
// still pick any other pool.
// ============================================================================

const SUBTITLES: Record<TradePool["poolType"], string> = {
  v2: "Classic pool",
  stable: "Stable pool",
  v3: "Concentrated liquidity",
};

interface PoolSelectorProps {
  pools: TradePool[];
  quotes: TradeQuote[];
  bestPoolAddress: string | null;
  selectedPoolAddress: string | null;
  hasAmount: boolean;
  /** a quote response for the current pair has arrived — until then per-pool
   *  quote states are unknown and cards show a resolving marker, never "No quote" */
  hasQuoteResponse: boolean;
  /** pools still show the previous pair while the new pair loads — dim them */
  transitioning?: boolean;
  exactOut: boolean;
  tokenInSymbol: string;
  tokenOutSymbol: string;
  onSelect: (address: string) => void;
  disabled?: boolean;
}

/** short, human label for a per-pool quote failure */
const quoteErrorLabel = (error: string): string =>
  /liquidity|reserves/i.test(error) ? "Insufficient liquidity" : "No quote";

export const PoolSelector = ({
  pools,
  quotes,
  bestPoolAddress,
  selectedPoolAddress,
  hasAmount,
  hasQuoteResponse,
  transitioning = false,
  exactOut,
  tokenInSymbol,
  tokenOutSymbol,
  onSelect,
  disabled = false,
}: PoolSelectorProps) => {
  const quoteByPool = new Map(quotes.map((q) => [q.poolAddress, q]));

  const detailFor = (pool: TradePool): string => {
    if (transitioning) return "…";
    if (!hasAmount) {
      return `$${(pool.totalLiquidityUSD || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} TVL`;
    }
    // still resolving (debounce window, request in flight, or awaiting the
    // interval retry after a failed fetch) — an answer is always coming
    if (!hasQuoteResponse) return "…";
    const quote = quoteByPool.get(pool.address);
    if (!quote) return "No quote";
    if (quote.error) return quoteErrorLabel(quote.error);
    if (exactOut) {
      return `≈ ${formatAmount(formatUnits(quote.amountIn))} ${tokenInSymbol} in${quote.partialFill ? " · partial" : ""}`;
    }
    return `≈ ${formatAmount(formatUnits(quote.amountOut))} ${tokenOutSymbol}${quote.partialFill ? " · partial" : ""}`;
  };

  if (pools.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 transition-opacity duration-200 ${
        transitioning ? "opacity-50 pointer-events-none" : ""
      }`}>
        {pools.map((pool) => {
          const selected = pool.address === selectedPoolAddress;
          const isBest = hasAmount && pool.address === bestPoolAddress;
          return (
            <button
              key={pool.address}
              type="button"
              onClick={() => { if (!disabled) onSelect(pool.address); }}
              disabled={disabled}
              className={`rounded-lg border p-2.5 md:p-3 text-left transition-colors ${
                selected ? 'border-primary bg-muted' : 'border-border hover:bg-muted/50'
              } ${disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-semibold whitespace-nowrap">{pool.poolLabel}</span>
                {isBest ? (
                  <Badge variant="success" className="text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                    Best rate
                  </Badge>
                ) : selected ? (
                  <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                ) : null}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{SUBTITLES[pool.poolType]}</div>
              <div className="text-[11px] text-muted-foreground mt-1 truncate tabular-nums">{detailFor(pool)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
