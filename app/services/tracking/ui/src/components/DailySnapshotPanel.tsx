import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
  DailySnapshot,
  formatCount,
  formatUsdCompact,
  getDailySnapshot,
  MetricDelta,
} from '../api';
import { Skeleton } from './primitives';

// "Daily Snapshot": today's (UTC) cross-link numbers with a delta against the
// same elapsed window yesterday, an opens-by-hour histogram and the busiest
// links. The table below stays on lifetime totals.

const HOUR_LABELS: Record<number, string> = {
  0: '12am',
  6: '6am',
  12: '12pm',
  18: '6pm',
  23: '11pm',
};

const Delta = ({ delta }: { delta: MetricDelta }) => {
  const title = `${formatCount(delta.previous)} in the same window yesterday`;
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

const Tile = ({
  label,
  value,
  sub,
  delta,
  highlight,
}: {
  label: string;
  value: string;
  sub: string;
  delta: MetricDelta;
  highlight?: boolean;
}) => (
  <div
    className={`rounded-lg border p-4 ${highlight ? 'border-primary bg-primary/5' : 'border-border'}`}
  >
    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-semibold">{value}</div>
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="truncate text-xs text-muted-foreground">{sub}</span>
      <Delta delta={delta} />
    </div>
  </div>
);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{children}</div>
);

// 24 UTC buckets; every hour keeps a full-height track so the day reads as a
// day, and the current (still filling) hour is highlighted.
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

  if (snapshot.topLinks.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No opens yet today.</p>;
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
          + {remaining} more link{remaining === 1 ? '' : 's'} with opens today
        </p>
      )}
    </div>
  );
};

const DailySnapshotPanel = () => {
  const snapshot = useQuery({
    queryKey: ['metrics', 'daily'],
    queryFn: getDailySnapshot,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  if (snapshot.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (snapshot.isError) {
    return (
      <section className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        Today's snapshot is unavailable.{' '}
        <button className="underline" onClick={() => snapshot.refetch()}>
          Retry
        </button>
      </section>
    );
  }

  const data = snapshot.data;
  // date is a UTC day string: parse as local midnight so it doesn't shift back
  const day = format(new Date(`${data.date}T00:00:00`), 'EEE, MMM d');
  const updated = format(new Date(data.generatedAt), 'HH:mm');

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Today</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {day} · {data.linksWithOpens} of {data.linksTotal} links active · updated {updated}
        </p>
      </header>
      <div className="space-y-6 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {/* Opens is highlighted: the two charts below break it down */}
          <Tile
            label="Opens"
            value={formatCount(data.opens.value)}
            sub={`${formatCount(data.engagedOpens)} engaged`}
            delta={data.opens}
            highlight
          />
          <Tile
            label="Wallets"
            value={formatCount(data.wallets.value)}
            sub={`${formatCount(data.bridgedWallets)} bridged`}
            delta={data.wallets}
          />
          <Tile
            label="Bridged in"
            value={`${formatUsdCompact(data.bridgeValueUsd.value)}${data.bridgeValuePartial ? '+' : ''}`}
            sub={`${formatCount(data.bridgeIns)} transfer${data.bridgeIns === 1 ? '' : 's'}`}
            delta={data.bridgeValueUsd}
          />
          <Tile
            label="On-chain actions"
            value={formatCount(data.actions.value)}
            sub={`across ${data.actionLinks} link${data.actionLinks === 1 ? '' : 's'}`}
            delta={data.actions}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SectionLabel>Top links by opens</SectionLabel>
            <TopLinks snapshot={data} />
          </div>
          <div>
            <SectionLabel>Opens by hour (UTC)</SectionLabel>
            <div className="mt-3">
              <OpensByHour opens={data.opensByHour} currentHour={data.hour} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DailySnapshotPanel;
