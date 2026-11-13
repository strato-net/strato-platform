import { useMemo, useState } from "react";
import { Market } from "@/interface";
import { useMarketLiquidity } from "@/hooks/terminal/useMarketData";
import {
  buildLadder,
  groupingDecimals,
  groupingOptions,
  poolPrice,
  Ladder,
  LadderLevel,
} from "@/components/terminal/ladder";
import { formatPrice, formatQuantity } from "@/components/terminal/format";

const LEVELS_PER_SIDE = 20;

/** A level's size and, once it has changed while on screen, which way and how often */
interface LevelMemory {
  base: number;
  direction?: "up" | "down";
  changes: number;
}

interface LevelRowProps {
  level: LadderLevel;
  side: "ask" | "bid";
  decimals: number;
  maxTotal: number;
  memory?: LevelMemory;
}

const LevelRow = ({ level, side, decimals, maxTotal, memory }: LevelRowProps) => (
  <div className="relative grid w-full grid-cols-3 px-3 py-1 tabular-nums">
    {memory?.direction && (
      // keyed by the change count so that every change replays the flash
      <div
        key={memory.changes}
        className={`absolute inset-0 motion-reduce:animate-none ${
          memory.direction === "up" ? "animate-flash-up" : "animate-flash-down"
        }`}
      />
    )}
    <div
      className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-down/15" : "bg-up/15"}`}
      style={{ width: `${maxTotal > 0 ? (level.totalQuote / maxTotal) * 100 : 0}%` }}
    />
    <span className={`relative ${side === "ask" ? "text-down" : "text-up"}`}>{formatPrice(level.price, decimals)}</span>
    <span className="relative text-right">{formatQuantity(level.base)}</span>
    <span className="relative text-right text-muted-foreground">{formatQuantity(level.totalQuote)}</span>
  </div>
);

/**
 * The pool's liquidity read as an order book: how much trades between the pool
 * price and each price level, computed from the on-chain tick liquidity.
 */
export const DepthLadder = ({ market }: { market: Market }) => {
  const { data: distribution } = useMarketLiquidity(market.poolAddress);
  const [groupingIndex, setGroupingIndex] = useState(0);

  const view = useMemo(() => {
    if (!distribution) return null;
    // the grouping choices depend only on the price's magnitude, so they are stable across polls
    const options = groupingOptions(poolPrice(distribution, market));
    const grouping = options[groupingIndex];
    const ladder = buildLadder(distribution, market, grouping, LEVELS_PER_SIDE);
    const maxTotal = Math.max(
      ladder.asks[ladder.asks.length - 1]?.totalQuote ?? 0,
      ladder.bids[ladder.bids.length - 1]?.totalQuote ?? 0
    );
    return { ladder, options, decimals: groupingDecimals(grouping), maxTotal };
  }, [distribution, market, groupingIndex]);

  // a level whose size differs from the previous ladder flashes: green when it grew, red
  // when it shrank. Only ladders of the same market and grouping are compared, so the
  // first load, a market switch and a regrouping stay still.
  const [seen, setSeen] = useState<{ ladder: Ladder; scope: string; levels: Map<number, LevelMemory> }>();
  const scope = `${market.poolAddress}:${groupingIndex}`;
  if (view && seen?.ladder !== view.ladder) {
    const before = seen?.scope === scope ? seen.levels : undefined;
    const levels = new Map<number, LevelMemory>();
    for (const level of [...view.ladder.asks, ...view.ladder.bids]) {
      const was = before?.get(level.price);
      const changed = !!was && Math.abs(level.base - was.base) > Math.max(level.base, was.base) * 1e-9;
      levels.set(
        level.price,
        changed
          ? { base: level.base, direction: level.base > was.base ? "up" : "down", changes: was.changes + 1 }
          : { base: level.base, direction: was?.direction, changes: was?.changes ?? 0 }
      );
    }
    setSeen({ ladder: view.ladder, scope, levels });
  }

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex h-9 items-center justify-end gap-1 px-3">
        {view?.options.map((option, index) => (
          <button
            key={index}
            onClick={() => setGroupingIndex(index)}
            className={`rounded px-1.5 py-0.5 tabular-nums ${
              index === groupingIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {formatPrice(option, groupingDecimals(option))}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 px-3 pb-2 text-[11px] text-muted-foreground">
        <span>Price ({market.quote.symbol})</span>
        <span className="text-right">Size ({market.base.symbol})</span>
        <span className="text-right">Total ({market.quote.symbol})</span>
      </div>
      {view && (
        // each side shows as many whole levels as fit, nearest the pool price: levels that
        // do not fit wrap into a second flex column, which is clipped
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col-reverse flex-wrap overflow-hidden">
            {view.ladder.asks.map((level) => (
              <LevelRow
                key={level.price}
                level={level}
                side="ask"
                decimals={view.decimals}
                maxTotal={view.maxTotal}
                memory={seen?.levels.get(level.price)}
              />
            ))}
          </div>
          <div className="my-1 flex items-baseline gap-2 border-y border-border px-3 py-2.5">
            <span className="text-sm font-semibold tabular-nums">{formatPrice(view.ladder.price)}</span>
            <span className="text-[11px] text-muted-foreground">Pool price</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col flex-wrap overflow-hidden">
            {view.ladder.bids.map((level) => (
              <LevelRow
                key={level.price}
                level={level}
                side="bid"
                decimals={view.decimals}
                maxTotal={view.maxTotal}
                memory={seen?.levels.get(level.price)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
