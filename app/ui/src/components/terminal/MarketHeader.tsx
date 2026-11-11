import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Market, MarketStats } from "@/interface";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatPrice, formatQuantity } from "@/components/terminal/format";

interface MarketHeaderProps {
  market: Market;
  markets: Market[];
  stats?: MarketStats;
}

const Stat = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col whitespace-nowrap">
    <span className="text-[11px] text-muted-foreground">{label}</span>
    <span className="text-xs font-medium tabular-nums">{children}</span>
  </div>
);

export const MarketHeader = ({ market, markets, stats }: MarketHeaderProps) => {
  const navigate = useNavigate();
  const change = stats?.changePct24h ?? 0;
  const changeClass = change > 0 ? "text-up" : change < 0 ? "text-down" : "text-muted-foreground";
  const quote = market.quote.symbol;

  return (
    <div className="flex items-center gap-5 px-3 py-2 border-b border-border overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-1 whitespace-nowrap rounded bg-muted px-2 py-1 text-sm font-semibold">
          {market.base.symbol}/{market.quote.symbol}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {markets.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => navigate(`/dashboard/terminal/${m.id}`)}
              className={`grid grid-cols-[9rem_3rem_6rem_5rem] gap-3 text-xs tabular-nums ${m.id === market.id ? "bg-muted" : ""}`}
            >
              <span className="truncate font-semibold">
                {m.base.symbol}/{m.quote.symbol}
              </span>
              <span className="text-muted-foreground">{m.feeBps / 100}%</span>
              <span className="text-right">{formatPrice(m.price)}</span>
              <span className="text-right text-muted-foreground">
                ${m.totalLiquidityUSD.toLocaleString(undefined, { notation: "compact", maximumFractionDigits: 1 })}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex flex-col whitespace-nowrap" aria-live="polite">
        <span className={`text-lg font-semibold leading-tight tabular-nums ${changeClass}`}>
          {stats ? formatPrice(stats.price) : "—"}
        </span>
        <span className="text-[11px] text-muted-foreground">Pool price</span>
      </div>
      <Stat label="24h change">
        <span className={changeClass}>{stats ? `${change > 0 ? "+" : ""}${change.toFixed(2)}%` : "—"}</span>
      </Stat>
      <Stat label="24h high">{stats ? formatPrice(stats.high24h) : "—"}</Stat>
      <Stat label="24h low">{stats ? formatPrice(stats.low24h) : "—"}</Stat>
      <Stat label={`24h volume (${quote})`}>
        {stats ? formatQuantity(stats.volumeQuote24h) : "—"}
        {stats && stats.gasVolumeQuote24h > 0 && (
          <span className="text-muted-foreground"> · {formatQuantity(stats.gasVolumeQuote24h)} network fees</span>
        )}
      </Stat>
      <Stat label="24h trades">{stats ? stats.trades24h.toLocaleString() : "—"}</Stat>
      <Stat label="Pool liquidity">
        ${market.totalLiquidityUSD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </Stat>
      <Stat label="Fee">{market.feeBps / 100}%</Stat>
    </div>
  );
};
