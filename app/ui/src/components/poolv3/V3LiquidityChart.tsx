import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { PoolV3LiquidityDistribution } from "@/interface";
import { formatTickAsPrice, snapTick, V3_MAX_TICK } from "./poolV3Utils";

interface V3LiquidityChartProps {
  distribution: PoolV3LiquidityDistribution | null;
  loading: boolean;
  /** the range being composed in the form; rendered as the draggable selection */
  tickLower: number | null;
  tickUpper: number | null;
  /** commit a new range (already spacing-snapped ticks) back to the form */
  onRangeChange: (tickLower: number, tickUpper: number) => void;
  /** clear the composed range (the reset button empties the selection too) */
  onRangeClear?: () => void;
  /** legend labels for the token-side bar colors */
  token0Symbol?: string;
  token1Symbol?: string;
}

const CHART_H = 150; // bar region height (px)
const TOP_PAD = 26; // room for the handle price pills
const AXIS_H = 20; // price labels strip below
const HANDLE_HIT_W = 28; // invisible pointer target around each handle
const DESIRED_BARS = 64; // target bar count; wider windows group ticks (peak-preserving)

// Bars are colored by which token the liquidity on that side of the current price is
// held in (Uniswap's token-split scheme): ticks above the price hold token0, below
// hold token1. token0 = strato-lightblue (readable in dark mode, unlike strato-blue),
// token1 = amber-500 — same pairing as the pool-composition bar above the chart.
const TOKEN0_COLOR = "#3452FE";
const TOKEN1_COLOR = "#f59e0b";
const FG = "hsl(var(--foreground))";
const MUTED_FG = "hsl(var(--muted-foreground))";
const BG = "hsl(var(--background))";
const BORDER = "hsl(var(--border))";
// Uniswap's in/out-of-selection opacity fade (0.8 / 0.2 in their colorUtils)
const OPACITY_IN_RANGE = 0.85;
const OPACITY_OUT_OF_RANGE = 0.25;
const OPACITY_EMPTY = 0.08;

type Drag =
  | { type: "lower" | "upper" }
  | { type: "band"; startX: number; startLower: number; startUpper: number }
  | { type: "pan"; startX: number; startCenter: number }
  | { type: "create"; startTick: number };

/**
 * Container width tracker so the chart renders in real pixels (crisp text, exact drag
 * math). Callback-ref based: an effect that checks `ref.current` once on mount misses
 * the node entirely when the first render is a loading/empty branch, leaving width 0
 * forever (bars never render). The state ref re-fires the effect when the node appears.
 */
const useContainerWidth = () => {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    setWidth(el.getBoundingClientRect().width); // ResizeObserver's initial callback is async
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { ref: setEl, width };
};

/**
 * Interactive liquidity depth chart, modeled on Uniswap's liquidity range input:
 * a dense bar series bucketed on a pan-stable grid (their liquidityBucketing —
 * peak-preserving max per bucket), linear height scale normalized to the max
 * visible bucket with a minimum bar height so thin liquidity stays visible, bars
 * token-colored and split exactly at the current price, selection fade outside the
 * range, draggable min/max handles with price pills, band drag to move the range,
 * drag-to-draw a range when none exists, background pan, wheel + button zoom, and
 * an out-of-view chip that recenters on the selection.
 */
const V3LiquidityChart = ({
  distribution,
  loading,
  tickLower,
  tickUpper,
  onRangeChange,
  onRangeClear,
  token0Symbol,
  token1Symbol,
}: V3LiquidityChartProps) => {
  const { ref, width } = useContainerWidth();
  const clipId = useId().replace(/:/g, ""); // colons would need escaping inside url(#…)
  const [svgEl, setSvgEl] = useState<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  // null = auto window (fit the pool's liquidity around the current price)
  const [customWindow, setCustomWindow] = useState<{ center: number; half: number } | null>(null);

  const spacing = distribution?.tickSpacing ?? 1;
  const currentTick = distribution?.currentTick ?? 0;
  const maxUsableTick = Math.floor(V3_MAX_TICK / spacing) * spacing;
  const hasSelection = tickLower !== null && tickUpper !== null && tickLower < tickUpper;

  const { lo, hi } = useMemo(() => {
    if (customWindow) return { lo: customWindow.center - customWindow.half, hi: customWindow.center + customWindow.half };
    // Fit the liquidity around the current price, capped at ±3000 ticks (≈±35% in
    // price) so one far-out or full-range position can't zoom everything else into
    // slivers. A fixed spacing multiple would be tier-dependent (±30×200 = ±82%).
    let half = 10 * spacing;
    if (distribution) {
      for (const s of distribution.segments) {
        half = Math.max(half, Math.abs(currentTick - s.tickLower), Math.abs(s.tickUpper - currentTick));
      }
    }
    half = Math.min(half, Math.max(3000, 10 * spacing));
    // the composed range must always stay in view
    if (tickLower !== null) half = Math.max(half, Math.abs(currentTick - tickLower) + 2 * spacing);
    if (tickUpper !== null) half = Math.max(half, Math.abs(tickUpper - currentTick) + 2 * spacing);
    return { lo: currentTick - half, hi: currentTick + half };
  }, [customWindow, distribution, currentTick, spacing, tickLower, tickUpper]);

  const x = useCallback((tick: number) => ((tick - lo) / (hi - lo)) * width, [lo, hi, width]);
  const tickAtX = useCallback((px: number) => lo + (px / width) * (hi - lo), [lo, hi, width]);

  // Bucket series across the window on a fixed global grid (Uniswap's fixedGrid
  // bucketing): the span depends only on zoom and boundaries align to multiples of
  // it, so bars keep their tick ranges while panning instead of re-tiling. Every
  // bucket gets a bar, zero-liquidity ones included, so the profile is continuous.
  const buckets = useMemo(() => {
    if (!distribution || width === 0) return [];
    const span = spacing * Math.max(1, Math.round((hi - lo) / spacing / DESIRED_BARS + 1e-9));
    const start = Math.floor(lo / span) * span;
    const result: { tick: number; span: number; liquidity: number }[] = [];
    for (let t = start; t < hi; t += span) {
      // peak-preserving: a grouped bucket shows the max liquidity inside it
      let liquidity = 0;
      for (const s of distribution.segments) {
        if (s.tickLower < t + span && s.tickUpper > t) liquidity = Math.max(liquidity, Number(s.liquidity));
      }
      result.push({ tick: t, span, liquidity });
    }
    return result;
  }, [distribution, width, lo, hi, spacing]);

  // linear scale normalized to the max VISIBLE bucket (Uniswap's auto-fit)
  const maxL = useMemo(() => buckets.reduce((m, b) => Math.max(m, b.liquidity), 0), [buckets]);

  // ----- interactions -----

  const svgX = (clientX: number): number => {
    const rect = svgEl?.getBoundingClientRect();
    return clientX - (rect?.left ?? 0);
  };

  const clampTick = (t: number) => Math.min(Math.max(t, -maxUsableTick), maxUsableTick);

  const startDrag = (d: Drag) => (e: React.PointerEvent<SVGRectElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(d.type === "band" || d.type === "pan" ? ({ ...d, startX: svgX(e.clientX) } as Drag) : d);
    setHoverX(null);
  };

  const handleMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (!drag || !distribution) return;
    const px = svgX(e.clientX);
    if (drag.type === "lower" && tickUpper !== null) {
      const t = Math.min(clampTick(snapTick(tickAtX(px), spacing)), tickUpper - spacing);
      if (t !== tickLower) onRangeChange(t, tickUpper);
    } else if (drag.type === "upper" && tickLower !== null) {
      const t = Math.max(clampTick(snapTick(tickAtX(px), spacing)), tickLower + spacing);
      if (t !== tickUpper) onRangeChange(tickLower, t);
    } else if (drag.type === "band") {
      const deltaTicks = Math.round((((px - drag.startX) / width) * (hi - lo)) / spacing) * spacing;
      const span = drag.startUpper - drag.startLower;
      let tl = drag.startLower + deltaTicks;
      tl = Math.min(Math.max(tl, -maxUsableTick), maxUsableTick - span);
      if (tl !== tickLower) onRangeChange(tl, tl + span);
    } else if (drag.type === "create") {
      const t = clampTick(snapTick(tickAtX(px), spacing));
      let a = Math.min(drag.startTick, t);
      let b = Math.max(drag.startTick, t);
      // zero-width start: widen by one spacing, inward when pinned at the domain edge
      if (a === b) {
        if (b + spacing <= maxUsableTick) b = a + spacing;
        else a = b - spacing;
      }
      if (a !== tickLower || b !== tickUpper) onRangeChange(a, b);
    } else if (drag.type === "pan") {
      const deltaTicks = ((px - drag.startX) / width) * (hi - lo);
      const center = Math.min(Math.max(drag.startCenter - deltaTicks, -maxUsableTick), maxUsableTick);
      setCustomWindow({ center, half: (hi - lo) / 2 });
    }
  };

  const endDrag = (e: React.PointerEvent<SVGRectElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
  };

  const zoom = useCallback(
    (factor: number, aroundTick?: number) => {
      const half = Math.min(Math.max(((hi - lo) / 2) * factor, 2 * spacing), maxUsableTick);
      if (aroundTick !== undefined && width > 0) {
        // keep the tick under the cursor stationary
        const f = x(aroundTick) / width;
        setCustomWindow({ center: aroundTick + half * (1 - 2 * f), half });
      } else {
        setCustomWindow({ center: (lo + hi) / 2, half });
      }
    },
    [hi, lo, spacing, maxUsableTick, width, x]
  );

  // wheel zoom needs a non-passive listener (React's synthetic wheel can't preventDefault)
  useEffect(() => {
    if (!svgEl) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svgEl.getBoundingClientRect();
      zoom(Math.exp(e.deltaY * 0.0018), tickAtX(e.clientX - rect.left));
    };
    svgEl.addEventListener("wheel", onWheel, { passive: false });
    return () => svgEl.removeEventListener("wheel", onWheel);
  }, [svgEl, zoom, tickAtX]);

  // percent offset of a tick from the current price (the handles' pill labels)
  const pctFromCurrent = (tick: number): string => {
    const pct = (Math.pow(1.0001, tick - currentTick) - 1) * 100;
    const abs = Math.abs(pct);
    return `${pct >= 0 ? "+" : "−"}${abs.toFixed(abs < 1 ? 2 : abs < 10 ? 1 : 0)}%`;
  };

  // token side of a price element (Uniswap's getColorForTick): at/above the current
  // price the liquidity there is held in token0, below it in token1
  const sideColor = (tick: number) => (tick >= currentTick ? TOKEN0_COLOR : TOKEN1_COLOR);

  // ----- render -----

  const H = TOP_PAD + CHART_H + AXIS_H;
  const chartBottom = TOP_PAD + CHART_H;

  const initialLoading = loading && !distribution;
  const noSegments = !initialLoading && (!distribution || distribution.segments.length === 0);
  const hasOnchainLiquidity = distribution && BigInt(distribution.liquidity || "0") > 0n;

  const currentX = x(currentTick);
  const selX0 = hasSelection ? x(tickLower!) : 0;
  const selX1 = hasSelection ? x(tickUpper!) : 0;
  const selectionOffscreen = hasSelection && (selX1 < 0 || selX0 > width);
  // split point of the token-side coloring, clamped into view
  const splitX = Math.min(Math.max(currentX, 0), width);

  const barHeight = (liquidity: number): number => {
    if (liquidity <= 0 || maxL <= 0) return 1.5; // baseline stub so the axis reads as continuous
    return Math.max((liquidity / maxL) * (CHART_H - 12), 3); // linear, min height (Uniswap)
  };

  const bars = buckets.map((b) => {
    const bx = x(b.tick);
    const bw = Math.max(x(b.tick + b.span) - bx - 1, 1); // 1px gap between bars
    const h = barHeight(b.liquidity);
    const overlapsSelection = hasSelection && b.tick + b.span > tickLower! && b.tick < tickUpper!;
    const opacity =
      b.liquidity <= 0 ? OPACITY_EMPTY : overlapsSelection || !hasSelection ? OPACITY_IN_RANGE : OPACITY_OUT_OF_RANGE;
    return { key: b.tick, x: bx, w: bw, h, opacity };
  });

  const pill = (cx: number, tick: number, anchor: "start" | "end") => {
    const label = `${formatTickAsPrice(tick)} (${pctFromCurrent(tick)})`;
    const w = label.length * 5.6 + 12;
    const px = anchor === "end" ? Math.max(cx - w - 4, 2) : Math.min(cx + 4, width - w - 2);
    return (
      <g pointerEvents="none">
        <rect x={px} y={2} width={w} height={17} rx={8.5} fill={BG} stroke={BORDER} />
        <text x={px + w / 2} y={13.5} fontSize={10} textAnchor="middle" fill={sideColor(tick)} fontWeight={600}>
          {label}
        </text>
      </g>
    );
  };

  const handleGrip = (type: "lower" | "upper", hx: number, tick: number) => {
    const inView = hx >= 0 && hx <= width;
    const color = sideColor(tick);
    return (
      <g>
        {inView && (
          <g pointerEvents="none">
            <line x1={hx} y1={TOP_PAD} x2={hx} y2={chartBottom} stroke={color} strokeWidth={1.5} />
            <rect x={type === "lower" ? hx - 9 : hx - 1} y={TOP_PAD} width={10} height={24} rx={4} fill={color} />
            {[3, 7].map((off) => (
              <line
                key={off}
                x1={type === "lower" ? hx - 9 + off : hx - 1 + off}
                y1={TOP_PAD + 6}
                x2={type === "lower" ? hx - 9 + off : hx - 1 + off}
                y2={TOP_PAD + 18}
                stroke="white"
                strokeWidth={1.2}
                opacity={0.9}
              />
            ))}
          </g>
        )}
        {/* pointer target (kept even when the grip is at the very edge) */}
        <rect
          x={hx - HANDLE_HIT_W / 2}
          y={TOP_PAD}
          width={HANDLE_HIT_W}
          height={CHART_H}
          fill="transparent"
          style={{ cursor: "ew-resize", touchAction: "none" }}
          onPointerDown={startDrag({ type })}
          onPointerMove={handleMove}
          onPointerUp={endDrag}
        />
      </g>
    );
  };

  return (
    <div ref={ref} className="relative select-none">
      {initialLoading && <div style={{ height: H }} className="rounded-xl border border-border bg-muted/40 animate-pulse" />}

      {noSegments && (
        <div
          style={{ height: H }}
          className="flex items-center justify-center rounded-xl border border-border text-xs text-muted-foreground"
        >
          {hasOnchainLiquidity ? "Liquidity data unavailable for this pool" : "No liquidity in this pool yet"}
        </div>
      )}

      {!initialLoading && !noSegments && (
        <>
          {/* zoom controls */}
          <div className="absolute z-10 flex gap-1" style={{ top: TOP_PAD + 6, right: 6 }}>
            {[
              { icon: Plus, action: () => zoom(0.6), label: "Zoom in" },
              { icon: Minus, action: () => zoom(1 / 0.6), label: "Zoom out" },
              {
                icon: RotateCcw,
                action: () => {
                  setCustomWindow(null);
                  onRangeClear?.();
                },
                label: "Reset view and clear range",
              },
            ].map(({ icon: Icon, action, label }) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                onClick={action}
                className="h-6 w-6 flex items-center justify-center rounded-md border border-border bg-background/80 backdrop-blur text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Icon size={13} />
              </button>
            ))}
          </div>

          {/* selection scrolled out of view — click to bring it back */}
          {selectionOffscreen && (
            <button
              type="button"
              onClick={() =>
                setCustomWindow({
                  center: (tickLower! + tickUpper!) / 2,
                  half: Math.max(tickUpper! - tickLower!, 8 * spacing),
                })
              }
              className="absolute z-10 top-1/2 -translate-y-1/2 text-[11px] font-medium px-2 py-1 rounded-full border border-border bg-background/90 backdrop-blur text-blue-600 dark:text-blue-400 hover:bg-muted transition-colors"
              style={selX1 < 0 ? { left: 8 } : { right: 8 }}
            >
              {selX1 < 0 ? "◀ " : ""}Range out of view{selX0 > width ? " ▶" : ""}
            </button>
          )}

          <svg
            ref={setSvgEl}
            width={width || "100%"}
            height={H}
            className="rounded-xl border border-border bg-muted/20 touch-none"
            role="img"
            aria-label="Liquidity distribution across the price axis"
          >
            <defs>
              {/* split the bar series at the current price: token1 left, token0 right */}
              <clipPath id={`${clipId}-t1`}>
                <rect x={0} y={0} width={splitX} height={H} />
              </clipPath>
              <clipPath id={`${clipId}-t0`}>
                <rect x={splitX} y={0} width={Math.max(width - splitX, 0)} height={H} />
              </clipPath>
            </defs>

            {/* background: drag to pan (or to draw a range when none exists), hover for price */}
            <rect
              x={0}
              y={0}
              width={width}
              height={chartBottom}
              fill="transparent"
              style={{
                cursor: !hasSelection ? "crosshair" : drag?.type === "pan" ? "grabbing" : "grab",
                touchAction: "none",
              }}
              onPointerDown={(e) =>
                startDrag(
                  hasSelection
                    ? { type: "pan", startX: 0, startCenter: (lo + hi) / 2 }
                    : { type: "create", startTick: clampTick(snapTick(tickAtX(svgX(e.clientX)), spacing)) }
                )(e)
              }
              onPointerMove={(e) => {
                if (drag) handleMove(e);
                else setHoverX(svgX(e.clientX));
              }}
              onPointerUp={endDrag}
              onPointerLeave={() => setHoverX(null)}
            />

            {/* liquidity depth bars, token-colored per side of the current price */}
            {[
              { clip: `${clipId}-t1`, color: TOKEN1_COLOR },
              { clip: `${clipId}-t0`, color: TOKEN0_COLOR },
            ].map(({ clip, color }) => (
              <g key={clip} clipPath={`url(#${clip})`} pointerEvents="none">
                {bars.map((b) => (
                  <rect
                    key={b.key}
                    x={b.x}
                    y={chartBottom - b.h}
                    width={b.w}
                    height={b.h}
                    rx={1}
                    fill={color}
                    opacity={b.opacity}
                  />
                ))}
              </g>
            ))}

            {/* selection band (token-tinted per side) + interior drag */}
            {hasSelection && (
              <>
                {(() => {
                  const bandX0 = Math.max(selX0, 0);
                  const bandX1 = Math.min(selX1, width);
                  const bandSplit = Math.min(Math.max(splitX, bandX0), bandX1);
                  return (
                    <g pointerEvents="none">
                      <rect x={bandX0} y={TOP_PAD} width={Math.max(bandSplit - bandX0, 0)} height={CHART_H} fill={TOKEN1_COLOR} opacity={0.1} />
                      <rect x={bandSplit} y={TOP_PAD} width={Math.max(bandX1 - bandSplit, 0)} height={CHART_H} fill={TOKEN0_COLOR} opacity={0.1} />
                    </g>
                  );
                })()}
                <rect
                  x={selX0 + HANDLE_HIT_W / 2}
                  y={TOP_PAD}
                  width={Math.max(selX1 - selX0 - HANDLE_HIT_W, 0)}
                  height={CHART_H}
                  fill="transparent"
                  style={{ cursor: drag?.type === "band" ? "grabbing" : "grab", touchAction: "none" }}
                  onPointerDown={startDrag({ type: "band", startX: 0, startLower: tickLower!, startUpper: tickUpper! })}
                  onPointerMove={handleMove}
                  onPointerUp={endDrag}
                />
              </>
            )}

            {/* hover price hairline */}
            {hoverX !== null && !drag && (
              <g pointerEvents="none">
                <line x1={hoverX} y1={TOP_PAD} x2={hoverX} y2={chartBottom} stroke={FG} opacity={0.25} />
                <text
                  x={Math.min(Math.max(hoverX, 34), width - 34)}
                  y={chartBottom - 6}
                  fontSize={10}
                  textAnchor="middle"
                  fill={MUTED_FG}
                >
                  {formatTickAsPrice(snapTick(tickAtX(hoverX), spacing))}
                </text>
              </g>
            )}

            {/* current price */}
            <line
              x1={currentX}
              y1={TOP_PAD - 4}
              x2={currentX}
              y2={chartBottom}
              stroke={FG}
              opacity={0.65}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              pointerEvents="none"
            />

            {/* handles + price pills */}
            {hasSelection && handleGrip("lower", selX0, tickLower!)}
            {hasSelection && handleGrip("upper", selX1, tickUpper!)}
            {hasSelection && selX0 >= 0 && selX0 <= width && pill(selX0, tickLower!, "end")}
            {hasSelection && selX1 >= 0 && selX1 <= width && pill(selX1, tickUpper!, "start")}

            {/* axis */}
            <g pointerEvents="none">
              <line x1={0} y1={chartBottom} x2={width} y2={chartBottom} stroke={BORDER} />
              {[0.1, 0.35, 0.65, 0.9].map((f) => {
                const t = lo + (hi - lo) * f;
                return (
                  <text key={f} x={f * width} y={H - 6} fontSize={10} textAnchor="middle" fill={MUTED_FG}>
                    {formatTickAsPrice(Math.round(t))}
                  </text>
                );
              })}
              <text
                x={Math.min(Math.max(currentX, 40), width - 40)}
                y={H - 6}
                fontSize={10}
                textAnchor="middle"
                fontWeight={600}
                fill={FG}
              >
                {formatTickAsPrice(currentTick)}
              </text>
            </g>
          </svg>

          {/* token-side legend + hint */}
          <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
            {token0Symbol && token1Symbol ? (
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: TOKEN1_COLOR }} />
                  {token1Symbol} side
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: TOKEN0_COLOR }} />
                  {token0Symbol} side
                </span>
              </span>
            ) : (
              <span />
            )}
            <span>{hasSelection ? "Drag the handles or band to adjust" : "Drag on the chart to set a range"}</span>
          </div>
        </>
      )}
    </div>
  );
};

export default V3LiquidityChart;
