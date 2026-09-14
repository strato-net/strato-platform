import { ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight, ChevronDown } from 'lucide-react';
import {
  DailySnapshot,
  formatCount,
  formatUsdCompact,
  getDailyBreakdown,
  getDailySnapshot,
  MetricDelta,
  METRICS_PERIOD_BASELINE,
  METRICS_PERIOD_SUFFIX,
  METRICS_PERIOD_TITLES,
  METRICS_PERIODS,
  MetricsPeriod,
} from '../api';
import SnapshotBreakdown, {
  BREAKDOWN_LABELS,
  BreakdownKey,
  breakdownCaption,
} from './SnapshotBreakdown';
import { SegmentedControl, Skeleton } from './primitives';

// The snapshot panel: cross-link numbers over the selected window (today,
// yesterday, or the trailing 7/30 UTC days) with a delta against the window of
// the same length before it, an opens-by-hour histogram and the busiest links.
// One piece of state drives the tiles AND the open breakdown, so a table can
// never describe a different window than the number above it. The table below
// stays on lifetime totals.

const HOUR_LABELS: Record<number, string> = {
  0: '12am',
  6: '6am',
  12: '12pm',
  18: '6pm',
  23: '11pm',
};

const Delta = ({ delta, baseline }: { delta: MetricDelta; baseline: string }) => {
  const title = `${formatCount(delta.previous)} ${baseline}`;
  if (delta.changePct == null) {
    return (
      <span className="text-xs text-muted-foreground" title={title}>
        {delta.value > 0 ? 'new' : '—'}
      </span>
    );
  }
  const rounded = Math.round(delta.changePct);
  if (rounded === 0) {
    return (
      <span className="text-xs text-muted-foreground" title={title}>
        flat
      </span>
    );
  }
  const up = rounded > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs ${up ? 'text-green-600' : 'text-destructive'}`}
      title={title}
    >
      {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(rounded)}%
    </span>
  );
};

// Each tile is a disclosure button: clicking it opens the table of rows the
// number is made of, below the grid.
const Tile = ({
  label,
  value,
  sub,
  delta,
  baseline,
  highlight,
  expanded,
  onToggle,
}: {
  label: string;
  value: string;
  sub: string;
  delta: MetricDelta;
  baseline: string;
  highlight?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={expanded}
    title={`${expanded ? 'Hide' : 'Show'} the ${label.toLowerCase()} breakdown`}
    className={`rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${
      expanded
        ? 'border-primary ring-1 ring-primary/40'
        : highlight
          ? 'border-primary bg-primary/5'
          : 'border-border'
    }`}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <ChevronDown
        size={14}
        className={`shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
      />
    </div>
    <div className="mt-1 text-2xl font-semibold">{value}</div>
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="truncate text-xs text-muted-foreground">{sub}</span>
      <Delta delta={delta} baseline={baseline} />
    </div>
  </button>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{children}</div>
);

// 24 UTC buckets; every hour keeps a full-height track so the day reads as a
// day, and the current (still filling) hour is highlighted — `currentHour` is
// -1 for a window that doesn't include today. Over a multi-day window the
// buckets are hour-of-day totals.
const OpensByHour = ({ opens, currentHour }: { opens: number[]; currentHour: number }) => {
  const max = Math.max(...opens, 1);
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {opens.map((count, hour) => (
          <div
            key={hour}
            className="relative h-full flex-1 rounded-sm bg-muted"
            title={`${hour.toString().padStart(2, '0')}:00 UTC — ${formatCount(count)} opens`}
          >
            {count > 0 && (
              <div
                className={`absolute bottom-0 w-full rounded-sm ${hour === currentHour ? 'bg-primary' : 'bg-primary/60'}`}
                style={{ height: `${Math.max(6, (count / max) * 100)}%` }}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {[0, 6, 12, 18, 23].map((hour) => (
          <span key={hour}>{HOUR_LABELS[hour]}</span>
        ))}
      </div>
    </div>
  );
};

const TopLinks = ({ snapshot }: { snapshot: DailySnapshot }) => {
  const navigate = useNavigate();
  const max = Math.max(...snapshot.topLinks.map((link) => link.opens), 1);
  const remaining = Math.max(0, snapshot.linksWithOpens - snapshot.topLinks.length);
  const suffix = METRICS_PERIOD_SUFFIX[snapshot.period];

  if (snapshot.topLinks.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No opens {suffix}.</p>;
  }
  return (
    <div className="mt-2 space-y-1">
      {snapshot.topLinks.map((link) => (
        <button
          key={link.id}
          type="button"
          onClick={() => navigate(`/links/${link.id}`)}
          className="flex w-full items-center gap-3 rounded-md px-1 py-1.5 text-left hover:bg-muted/50"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm" title={link.label}>
              {link.label}
            </span>
            <span className="block truncate font-mono text-xs text-muted-foreground">
              /t/{link.slug}
              {link.source ? ` · ${link.source}` : ''}
            </span>
          </span>
          <span className="hidden h-1.5 w-24 rounded-full bg-muted sm:block lg:w-32">
            <span
              className="block h-1.5 rounded-full bg-primary"
              style={{ width: `${Math.max(4, (link.opens / max) * 100)}%` }}
            />
          </span>
          <span className="w-14 text-right text-sm">{formatCount(link.opens)}</span>
        </button>
      ))}
      {remaining > 0 && (
        <p className="px-1 pt-1 text-xs text-muted-foreground">
          + {remaining} more link{remaining === 1 ? '' : 's'} with opens {suffix}
        </p>
      )}
    </div>
  );
};

// UTC day strings are parsed as local midnight so they don't shift back a day
const dayLabel = (date: string) => format(new Date(`${date}T00:00:00`), 'EEE, MMM d');

const DailySnapshotPanel = () => {
  const [period, setPeriod] = useState<MetricsPeriod>('today');
  const [expanded, setExpanded] = useState<BreakdownKey | null>(null);
  const snapshot = useQuery({
    queryKey: ['metrics', 'daily', period],
    queryFn: () => getDailySnapshot(period),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  // One request covers all four tables, and only once a tile is opened
  const breakdown = useQuery({
    queryKey: ['metrics', 'daily', 'breakdown', period],
    queryFn: () => getDailyBreakdown(period),
    enabled: expanded !== null,
    staleTime: 15_000,
    refetchInterval: expanded === null ? false : 30_000,
  });

  const periodPicker = (
    <SegmentedControl
      options={METRICS_PERIODS}
      value={period}
      onChange={setPeriod}
      label="Snapshot period"
    />
  );

  if (snapshot.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (snapshot.isError) {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            The {METRICS_PERIOD_TITLES[period].toLowerCase()} snapshot is unavailable.{' '}
            <button className="underline" onClick={() => snapshot.refetch()}>
              Retry
            </button>
          </span>
          {periodPicker}
        </div>
      </section>
    );
  }

  const toggle = (metric: BreakdownKey) =>
    setExpanded((current) => (current === metric ? null : metric));

  const data = snapshot.data;
  const range =
    data.days === 1
      ? dayLabel(data.date)
      : `${dayLabel(data.startDate)} – ${dayLabel(data.endDate)}`;
  const updated = format(new Date(data.generatedAt), 'HH:mm');
  const baseline = METRICS_PERIOD_BASELINE[data.period];

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{METRICS_PERIOD_TITLES[data.period]}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {range} · {data.linksWithOpens} of {data.linksTotal} links active · updated {updated}
          </p>
        </div>
        {periodPicker}
      </header>
      <div className="space-y-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Opens is highlighted: the two charts below break it down */}
          <Tile
            label="Opens"
            value={formatCount(data.opens.value)}
            sub={`${formatCount(data.engagedOpens)} engaged`}
            delta={data.opens}
            baseline={baseline}
            highlight
            expanded={expanded === 'opens'}
            onToggle={() => toggle('opens')}
          />
          <Tile
            label="Wallets"
            value={formatCount(data.wallets.value)}
            sub={`${formatCount(data.bridgedWallets)} bridged`}
            delta={data.wallets}
            baseline={baseline}
            expanded={expanded === 'wallets'}
            onToggle={() => toggle('wallets')}
          />
          <Tile
            label="Bridged in"
            value={`${formatUsdCompact(data.bridgeValueUsd.value)}${data.bridgeValuePartial ? '+' : ''}`}
            sub={`${formatCount(data.bridgeIns)} transfer${data.bridgeIns === 1 ? '' : 's'}`}
            delta={data.bridgeValueUsd}
            baseline={baseline}
            expanded={expanded === 'bridgeIns'}
            onToggle={() => toggle('bridgeIns')}
          />
          <Tile
            label="On-chain actions"
            value={formatCount(data.actions.value)}
            sub={`across ${data.actionLinks} link${data.actionLinks === 1 ? '' : 's'}`}
            delta={data.actions}
            baseline={baseline}
            expanded={expanded === 'actions'}
            onToggle={() => toggle('actions')}
          />
        </div>

        {expanded && (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>{BREAKDOWN_LABELS[expanded]} breakdown</SectionLabel>
              {breakdown.data && (
                <span className="text-xs text-muted-foreground">
                  {breakdownCaption(expanded, breakdown.data)}
                </span>
              )}
            </div>
            <div className="mt-3">
              {breakdown.isPending ? (
                <Skeleton className="h-48 w-full" />
              ) : breakdown.isError ? (
                <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
                  The breakdown is unavailable.{' '}
                  <button className="underline" onClick={() => breakdown.refetch()}>
                    Retry
                  </button>
                </p>
              ) : (
                <SnapshotBreakdown metric={expanded} breakdown={breakdown.data} />
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SectionLabel>Top links by opens</SectionLabel>
            <TopLinks snapshot={data} />
          </div>
          <div>
            <SectionLabel>
              {data.days === 1 ? 'Opens by hour (UTC)' : 'Opens by hour of day (UTC)'}
            </SectionLabel>
            <div className="mt-3">
              <OpensByHour
                opens={data.opensByHour}
                currentHour={data.period === 'today' ? data.hour : -1}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DailySnapshotPanel;
