import { KeyboardEvent, PointerEvent, useLayoutEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { HistoryPoint } from '../api';

// Hand-rolled SVG chart (matches the dashboard's no-component-library style):
// one metric at a time, as either a per-day histogram or a cumulative line,
// over a preset date range. Single series — the selected chip is the legend.

type MetricKey = Exclude<keyof HistoryPoint, 'date'>;

const METRICS: { key: MetricKey; label: string; usd?: boolean }[] = [
  { key: 'opens', label: 'Opens' },
  { key: 'engagedOpens', label: 'Engaged opens' },
  { key: 'wallets', label: 'Wallets connected' },
  { key: 'bridgeIns', label: 'Bridge-ins' },
  { key: 'bridgeValueUsd', label: 'Bridge value', usd: true },
  { key: 'trades', label: 'Trades' },
  { key: 'tradeValueUsd', label: 'Trade value', usd: true },
  { key: 'activity', label: 'Activity events' },
];

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: Infinity },
];

const MARGIN = { top: 12, right: 16, bottom: 26, left: 48 };
const HEIGHT = 240;

const SERIES = 'hsl(var(--primary))';
const GRID = 'hsl(var(--border))';
const AXIS_TEXT = 'hsl(var(--muted-foreground))';
const SURFACE = 'hsl(var(--card))';

// Axis scale with clean ticks: step snapped to 1/2/2.5/5 × 10^n, max
// rounded up to a whole step so headroom stays tight.
const niceScale = (maxValue: number): { max: number; ticks: number[] } => {
  const rawStep = (maxValue > 0 ? maxValue : 1) / 5;
  const power = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / power;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * power;
  const max = Math.ceil((maxValue > 0 ? maxValue : 1) / step) * step;
  const ticks: number[] = [];
  for (let tick = step; tick <= max + step / 2; tick += step) ticks.push(tick);
  return { max, ticks };
};

const compactFormat = (value: number, usd: boolean): string =>
  new Intl.NumberFormat('en-US', {
    ...(usd ? { style: 'currency', currency: 'USD' } : {}),
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);

const exactFormat = (value: number, usd: boolean): string =>
  new Intl.NumberFormat('en-US', {
    ...(usd ? { style: 'currency', currency: 'USD' } : {}),
    maximumFractionDigits: usd ? 2 : 0,
  }).format(value);

// Bar with a 4px-rounded data end and a square baseline
const barPath = (x: number, y: number, w: number, h: number): string => {
  const r = Math.min(4, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `V ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `H ${x + w - r}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `V ${y + h}`,
    'Z',
  ].join(' ');
};

const chipClass = (selected: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition-colors ${
    selected
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

const HistoryChart = ({ history }: { history: HistoryPoint[] }) => {
  const [metricKey, setMetricKey] = useState<MetricKey>('opens');
  const [mode, setMode] = useState<'daily' | 'cumulative'>('daily');
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [hover, setHover] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const metric = METRICS.find((m) => m.key === metricKey)!;

  // Cumulative totals run over the FULL history, then get sliced — so a
  // windowed cumulative line starts at the true running total, not zero.
  let runningTotal = 0;
  const cumulative = history.map((point) => (runningTotal += point[metricKey]));
  const start = Number.isFinite(rangeDays) ? Math.max(0, history.length - rangeDays) : 0;
  const points = history.slice(start).map((point, i) => ({
    date: point.date,
    daily: point[metricKey],
    cumulative: cumulative[start + i],
  }));

  const plotW = Math.max(80, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const values = points.map((p) => (mode === 'daily' ? p.daily : p.cumulative));
  const { max: yMax, ticks: yTicks } = niceScale(Math.max(...values, 0));
  const yOf = (value: number) => MARGIN.top + plotH * (1 - value / yMax);
  const slot = plotW / Math.max(points.length, 1);
  const xOf = (i: number) => MARGIN.left + slot * (i + 0.5);

  // ~5 x labels, always including the first and last day
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));
  const xTickIndexes = points
    .map((_, i) => i)
    .filter((i) => i % labelEvery === 0 || i === points.length - 1);

  const indexAt = (clientX: number): number | null => {
    const el = containerRef.current;
    if (!el || points.length === 0) return null;
    const x = clientX - el.getBoundingClientRect().left - MARGIN.left;
    return Math.min(points.length - 1, Math.max(0, Math.round(x / slot - 0.5)));
  };

  const onPointerMove = (e: PointerEvent) => setHover(indexAt(e.clientX));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      setHover((prev) =>
        Math.min(points.length - 1, Math.max(0, (prev ?? points.length - 1) + delta))
      );
    } else if (e.key === 'Escape') {
      setHover(null);
    }
  };

  const hovered = hover != null ? points[hover] : null;
  const barW = Math.min(24, Math.max(1, slot - 2));

  const linePoints = points.map((p, i) => `${xOf(i)},${yOf(p.cumulative)}`).join(' ');
  const areaPath =
    points.length > 0
      ? `M ${xOf(0)} ${yOf(points[0].cumulative)} L ${linePoints.split(' ').join(' L ')} ` +
        `L ${xOf(points.length - 1)} ${MARGIN.top + plotH} L ${xOf(0)} ${MARGIN.top + plotH} Z`
      : '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="Date range">
          {RANGES.map((range) => (
            <button
              key={range.label}
              type="button"
              className={chipClass(rangeDays === range.days)}
              onClick={() => {
                setRangeDays(range.days);
                setHover(null);
              }}
            >
              {range.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Chart mode">
          <button
            type="button"
            className={chipClass(mode === 'daily')}
            onClick={() => setMode('daily')}
          >
            Daily
          </button>
          <button
            type="button"
            className={chipClass(mode === 'cumulative')}
            onClick={() => setMode('cumulative')}
          >
            Cumulative
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Metric">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            className={chipClass(m.key === metricKey)}
            onClick={() => setMetricKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div ref={containerRef} className="relative w-full">
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${metric.label}, ${mode === 'daily' ? 'per day' : 'cumulative'}`}
          tabIndex={0}
          className="block outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
        >
          {/* horizontal hairline grid + tick labels */}
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={MARGIN.left - 6}
                y={yOf(tick) + 3}
                textAnchor="end"
                fontSize={10}
                fill={AXIS_TEXT}
              >
                {compactFormat(tick, !!metric.usd)}
              </text>
            </g>
          ))}
          {/* baseline */}
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + plotW}
            y1={MARGIN.top + plotH}
            y2={MARGIN.top + plotH}
            stroke={GRID}
            strokeWidth={1}
          />
          {xTickIndexes.map((i) => (
            <text
              key={points[i].date}
              x={xOf(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize={10}
              fill={AXIS_TEXT}
            >
              {format(new Date(`${points[i].date}T00:00:00`), 'MMM d')}
            </text>
          ))}

          {mode === 'daily' ? (
            points.map(
              (p, i) =>
                p.daily > 0 && (
                  <path
                    key={p.date}
                    d={barPath(xOf(i) - barW / 2, yOf(p.daily), barW, MARGIN.top + plotH - yOf(p.daily))}
                    fill={SERIES}
                    style={hover === i ? { filter: 'brightness(1.15)' } : undefined}
                  />
                )
            )
          ) : (
            points.length > 0 && (
              <>
                <path d={areaPath} fill={SERIES} opacity={0.1} />
                <polyline
                  points={linePoints}
                  fill="none"
                  stroke={SERIES}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {/* end marker with a surface ring so it reads over the line */}
                <circle
                  cx={xOf(points.length - 1)}
                  cy={yOf(points[points.length - 1].cumulative)}
                  r={4}
                  fill={SERIES}
                  stroke={SURFACE}
                  strokeWidth={2}
                />
              </>
            )
          )}

          {/* crosshair snapped to the hovered day */}
          {hovered && (
            <line
              x1={xOf(hover!)}
              x2={xOf(hover!)}
              y1={MARGIN.top}
              y2={MARGIN.top + plotH}
              stroke={AXIS_TEXT}
              strokeWidth={1}
              opacity={0.5}
            />
          )}
        </svg>

        {hovered && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
            style={{
              top: MARGIN.top,
              ...(xOf(hover!) > width / 2
                ? { right: width - xOf(hover!) + 8 }
                : { left: xOf(hover!) + 8 }),
            }}
          >
            <div className="text-muted-foreground">
              {format(new Date(`${hovered.date}T00:00:00`), 'MMM d, yyyy')}
            </div>
            <div className="mt-0.5 font-semibold">
              {exactFormat(mode === 'daily' ? hovered.daily : hovered.cumulative, !!metric.usd)}{' '}
              <span className="font-normal text-muted-foreground">
                {mode === 'daily' ? 'that day' : 'to date'}
              </span>
            </div>
            <div className="text-muted-foreground">
              {mode === 'daily'
                ? `${exactFormat(hovered.cumulative, !!metric.usd)} to date`
                : `${exactFormat(hovered.daily, !!metric.usd)} that day`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryChart;
