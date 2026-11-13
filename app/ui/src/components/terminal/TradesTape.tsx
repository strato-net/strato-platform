import { useState } from "react";
import { Market } from "@/interface";
import { useMarketTrades } from "@/hooks/terminal/useMarketData";
import { formatPrice, formatQuantity } from "@/components/terminal/format";

/** Time of day within the last 24 hours, the date for older trades (quiet markets) */
const formatTime = (ms: number): string =>
  Date.now() - ms < 86_400_000
    ? new Date(ms).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

export const TradesTape = ({ market }: { market: Market }) => {
  const { data: trades = [], isLoading } = useMarketTrades(market.poolAddress);
  const [hideGas, setHideGas] = useState(false);
  const hasGas = trades.some((t) => t.kind === "gas");
  const rows = hideGas ? trades.filter((t) => t.kind !== "gas") : trades;

  return (
    <div className="flex h-full flex-col text-xs">
      {hasGas && (
        <label className="flex items-center justify-end gap-1.5 px-3 pt-2 text-muted-foreground">
          <input type="checkbox" checked={hideGas} onChange={(e) => setHideGas(e.target.checked)} />
          Hide network-fee buys
        </label>
      )}
      <div className="grid grid-cols-3 px-3 py-2 text-[11px] text-muted-foreground">
        <span>Price ({market.quote.symbol})</span>
        <span className="text-right">Size ({market.base.symbol})</span>
        <span className="text-right">Time</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {rows.map((trade) => (
          <div key={trade.id} className="grid grid-cols-3 px-3 py-1 tabular-nums">
            <span className={trade.side === "buy" ? "text-up" : "text-down"}>{formatPrice(trade.price)}</span>
            <span className="text-right">
              {trade.kind === "gas" && <span className="mr-1 text-muted-foreground">fee</span>}
              {formatQuantity(trade.amountBase)}
            </span>
            <span className="text-right text-muted-foreground">{formatTime(trade.time)}</span>
          </div>
        ))}
        {!isLoading && rows.length === 0 && (
          <p className="px-3 py-6 text-center text-muted-foreground">No trades yet</p>
        )}
      </div>
    </div>
  );
};
