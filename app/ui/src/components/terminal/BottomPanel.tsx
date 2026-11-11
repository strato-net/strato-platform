import { useState } from "react";
import { Market } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useTradeHistory } from "@/hooks/trade/useTradeHistory";
import { useMarketBalances } from "@/hooks/terminal/useMarketData";
import { formatAmount, formatUnits } from "@/utils/numberUtils";
import { formatPrice } from "@/components/terminal/format";

const TABS = ["My trades", "Balances"] as const;
const MY_TRADES_LIMIT = 25;

interface BottomPanelProps {
  market: Market;
  /** pool price, quote per base — values the base balance */
  price?: number;
}

const MyTrades = ({ market }: { market: Market }) => {
  const { userAddress } = useUser();
  const { data, isLoading } = useTradeHistory({
    tokenIn: market.base.address,
    tokenOut: market.quote.address,
    page: 1,
    limit: MY_TRADES_LIMIT,
    sender: userAddress ?? undefined,
  });
  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return <p className="px-3 py-6 text-center text-muted-foreground">{isLoading ? "Loading…" : "No trades yet"}</p>;
  }
  return (
    <table className="w-full tabular-nums">
      <thead className="text-left text-[11px] text-muted-foreground">
        <tr>
          <th className="px-3 py-1 font-normal">Time</th>
          <th className="px-3 py-1 font-normal">Side</th>
          <th className="px-3 py-1 text-right font-normal">Price ({market.quote.symbol})</th>
          <th className="px-3 py-1 text-right font-normal">Size ({market.base.symbol})</th>
          <th className="px-3 py-1 text-right font-normal">Total ({market.quote.symbol})</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const isBuy = entry.tokenOut === market.base.symbol;
          const [baseWei, quoteWei] = isBuy ? [entry.amountOut, entry.amountIn] : [entry.amountIn, entry.amountOut];
          return (
            <tr key={entry.id}>
              <td className="px-3 py-1 text-muted-foreground">{entry.timestamp.toLocaleString([], { hour12: false })}</td>
              <td className={`px-3 py-1 ${isBuy ? "text-up" : "text-down"}`}>{isBuy ? "Buy" : "Sell"}</td>
              <td className="px-3 py-1 text-right">{formatPrice(Number(entry.impliedPrice))}</td>
              <td className="px-3 py-1 text-right">{formatAmount(formatUnits(baseWei))}</td>
              <td className="px-3 py-1 text-right">{formatAmount(formatUnits(quoteWei))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

const Balances = ({ market, price }: BottomPanelProps) => {
  const balances = useMarketBalances(market);
  const base = Number(formatUnits(balances.base));
  const rows = [
    { token: market.base, balance: balances.base, value: price ? base * price : null },
    { token: market.quote, balance: balances.quote, value: Number(formatUnits(balances.quote)) },
  ];
  return (
    <table className="w-full tabular-nums">
      <thead className="text-left text-[11px] text-muted-foreground">
        <tr>
          <th className="px-3 py-1 font-normal">Asset</th>
          <th className="px-3 py-1 text-right font-normal">Balance</th>
          <th className="px-3 py-1 text-right font-normal">Value ({market.quote.symbol})</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ token, balance, value }) => (
          <tr key={token.address}>
            <td className="px-3 py-1 font-medium">{token.symbol}</td>
            <td className="px-3 py-1 text-right">{formatAmount(formatUnits(balance))}</td>
            <td className="px-3 py-1 text-right">{value === null ? "—" : formatPrice(value, 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const BottomPanel = ({ market, price }: BottomPanelProps) => {
  const { isLoggedIn } = useUser();
  const [tab, setTab] = useState<(typeof TABS)[number]>("My trades");

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex gap-1 border-b border-border px-3 py-1.5 text-sm">
        {TABS.map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`rounded px-2 py-0.5 ${
              name === tab ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!isLoggedIn ? (
          <p className="px-3 py-6 text-center text-muted-foreground">Sign in to see your trades and balances</p>
        ) : tab === "My trades" ? (
          <MyTrades market={market} />
        ) : (
          <Balances market={market} price={price} />
        )}
      </div>
    </div>
  );
};
