import { Market } from "@/interface";
import { useUser } from "@/context/UserContext";
import { useTradeHistory } from "@/hooks/trade/useTradeHistory";
import { useMarketBalances, useOwnLatestTradeId } from "@/hooks/terminal/useMarketData";
import { formatAmount, formatUnits } from "@/utils/numberUtils";
import { formatPrice } from "@/components/terminal/format";
import { Tabs } from "@/components/terminal/Tabs";

const MY_TRADES_LIMIT = 25;

interface BottomPanelProps {
  market: Market;
  /** pool price, quote per base — values the base balance */
  price?: number;
}

const MyTrades = ({ market }: { market: Market }) => {
  const { userAddress } = useUser();
  // one refetch at confirmation can land before the indexer has the swap: refetch again
  // when the user's trade shows on the tape
  const revision = useOwnLatestTradeId(market.poolAddress);
  const { data, isLoading } = useTradeHistory({
    tokenIn: market.base.address,
    tokenOut: market.quote.address,
    page: 1,
    limit: MY_TRADES_LIMIT,
    sender: userAddress ?? undefined,
    revision,
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
  const signIn = (
    <p className="px-3 py-6 text-center text-muted-foreground">Sign in to see your trades and balances</p>
  );

  return (
    <div className="h-full text-xs">
      <Tabs
        tabs={[
          { name: "My trades", content: isLoggedIn ? <MyTrades market={market} /> : signIn },
          { name: "Balances", content: isLoggedIn ? <Balances market={market} price={price} /> : signIn },
        ]}
      />
    </div>
  );
};
