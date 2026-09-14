import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ACTIVITY_CATEGORY_LABELS,
  ActionRow,
  BreakdownLink,
  BreakdownSection,
  BridgeRow,
  DailyBreakdown,
  externalTxLink,
  formatCount,
  formatUsd,
  METRICS_PERIOD_SUFFIX,
  MetricsPeriod,
  OpenRow,
  WalletRow,
} from '../api';
import {
  AddressCell,
  Badge,
  ExplorerLink,
  ExternalExplorerLink,
  tdClass,
  thClass,
} from './primitives';

// The rows behind each snapshot tile. Same window (same `period`) as the
// tiles, so a table and the number above it always agree; the server caps each
// list and says so via `truncated`.

export type BreakdownKey = 'opens' | 'wallets' | 'bridgeIns' | 'actions';

export const BREAKDOWN_LABELS: Record<BreakdownKey, string> = {
  opens: 'Opens',
  wallets: 'Wallets',
  bridgeIns: 'Bridged in',
  actions: 'On-chain actions',
};

// A single-day window makes the clock enough; a longer one needs the date
// too. The title always carries the full instant.
const Time = ({ at, withDate }: { at: string; withDate: boolean }) => (
  <span title={new Date(at).toLocaleString()}>
    {format(new Date(at), withDate ? 'MMM d, HH:mm' : 'HH:mm')}
  </span>
);

const Dash = () => <span className="text-muted-foreground">—</span>;

// How long a visit took to convert (open -> wallet connection)
const duration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  return `${hours}h ${Math.round((seconds % 3600) / 60)}m`;
};

const LinkCell = ({ link }: { link: BreakdownLink | null }) => {
  if (!link) return <span className="text-muted-foreground">—</span>;
  return (
    <Link to={`/links/${link.id}`} className="block truncate hover:underline" title={link.label}>
      {link.label}
      <span className="block truncate font-mono text-[11px] text-muted-foreground">
        /t/{link.slug}
        {link.source ? ` · ${link.source}` : ''}
      </span>
    </Link>
  );
};

const Place = ({ city, country }: { city: string | null; country: string | null }) => {
  const place = [city, country].filter(Boolean).join(', ');
  return place ? <>{place}</> : <span className="text-muted-foreground">—</span>;
};

// USD that may be a floor rather than a total (unpriced bridged token)
const Usd = ({ value, partial }: { value: number; partial: boolean }) => (
  <span title={partial ? 'At least this much: one or more bridged tokens have no oracle price' : undefined}>
    {formatUsd(value)}
    {partial ? '+' : ''}
  </span>
);

const Table = ({ headers, children }: { headers: (string | { label: string; align: 'right' })[]; children: ReactNode }) => (
  <div className="max-h-96 overflow-auto rounded-lg border border-border">
    <table className="w-full">
      <thead className="sticky top-0 z-10 border-b border-border bg-card">
        <tr>
          {headers.map((header) => {
            const label = typeof header === 'string' ? header : header.label;
            const align = typeof header === 'string' ? undefined : header.align;
            return (
              <th key={label} className={`${thClass} ${align === 'right' ? 'text-right' : ''}`}>
                {label}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">{children}</tbody>
    </table>
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
    {children}
  </p>
);

// A window longer than a day needs dates on every timestamp
const spansDays = (period: MetricsPeriod): boolean => period === '7d' || period === '30d';

const OpensTable = ({
  section,
  period,
}: {
  section: BreakdownSection<OpenRow>;
  period: MetricsPeriod;
}) => {
  if (section.rows.length === 0) return <Empty>No opens {METRICS_PERIOD_SUFFIX[period]}.</Empty>;
  const withDate = spansDays(period);
  return (
    <Table headers={['Time', 'Link', 'Location', 'Referrer', 'Engaged', 'Wallet']}>
      {section.rows.map((row, i) => (
        <tr key={`${row.at}-${i}`}>
          <td className={`${tdClass} whitespace-nowrap`}>
            <Time at={row.at} withDate={withDate} />
          </td>
          <td className={`${tdClass} max-w-[200px]`}>
            <LinkCell link={row.link} />
          </td>
          <td className={tdClass}>
            <Place city={row.city} country={row.country} />
          </td>
          <td className={`${tdClass} max-w-[180px] truncate text-muted-foreground`} title={row.referrer ?? ''}>
            {row.referrer || '—'}
          </td>
          <td className={tdClass}>
            {row.engaged ? <Badge variant="secondary">engaged</Badge> : <span className="text-muted-foreground">—</span>}
          </td>
          <td className={tdClass}>
            <AddressCell address={row.address} />
          </td>
        </tr>
      ))}
    </Table>
  );
};

// The categories a wallet acted in inside the window, so "3 actions" says
// which three
const ActionBadges = ({ summary }: { summary: WalletRow['actionSummary'] }) => {
  const entries = Object.entries(summary) as [keyof typeof ACTIVITY_CATEGORY_LABELS, number][];
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([category, count]) => (
        <Badge key={category} variant="secondary">
          {ACTIVITY_CATEGORY_LABELS[category]} {count}
        </Badge>
      ))}
    </span>
  );
};

// The wallet table is the behavioural one: who the visitor is (new to us or
// returning), how they got here, how long the visit took to convert, how much
// they moved and what they did with it.
const WalletsTable = ({
  section,
  period,
}: {
  section: BreakdownSection<WalletRow>;
  period: MetricsPeriod;
}) => {
  if (section.rows.length === 0)
    return <Empty>No wallets connected {METRICS_PERIOD_SUFFIX[period]}.</Empty>;
  const withDate = spansDays(period);
  return (
    <Table
      headers={[
        'Wallet',
        'Visitor',
        'First open',
        'Connected',
        { label: 'Visits', align: 'right' },
        'Link',
        'Referrer',
        'Location',
        'Connector',
        { label: 'Bridged in', align: 'right' },
        'Assets',
        'Actions',
      ]}
    >
      {section.rows.map((row) => (
        <tr key={row.address}>
          <td className={tdClass}>
            <AddressCell address={row.address} />
          </td>
          <td className={tdClass}>
            <Badge variant={row.returning ? 'outline' : 'secondary'}>
              <span title={`First seen ${new Date(row.firstSeenAt).toLocaleString()}`}>
                {row.returning ? 'returning' : 'new'}
              </span>
            </Badge>
          </td>
          <td className={`${tdClass} whitespace-nowrap`}>
            {row.firstOpenAt ? <Time at={row.firstOpenAt} withDate={withDate} /> : <Dash />}
          </td>
          <td className={`${tdClass} whitespace-nowrap`}>
            <Time at={row.connectedAt} withDate={withDate} />
            {row.secondsToConnect != null && (
              <span
                className="block text-[11px] text-muted-foreground"
                title="Time from the open to the wallet connection"
              >
                +{duration(row.secondsToConnect)}
              </span>
            )}
          </td>
          <td className={`${tdClass} whitespace-nowrap text-right`}>
            {formatCount(row.visits)}
            <span className="block text-[11px] text-muted-foreground">
              {formatCount(row.engagedVisits)} engaged
            </span>
          </td>
          <td className={`${tdClass} max-w-[200px]`}>
            <LinkCell link={row.link} />
          </td>
          <td
            className={`${tdClass} max-w-[160px] truncate text-muted-foreground`}
            title={row.referrer ?? ''}
          >
            {row.referrer || '—'}
          </td>
          <td className={tdClass}>
            <Place city={row.city} country={row.country} />
          </td>
          <td className={tdClass}>{row.connector || <Dash />}</td>
          <td className={`${tdClass} whitespace-nowrap text-right`}>
            {row.bridgeIns === 0 ? (
              <Dash />
            ) : (
              <>
                <Usd value={row.bridgeValueUsd} partial={row.bridgeValuePartial} />
                <span className="block text-[11px] text-muted-foreground">
                  {row.bridgeIns} transfer{row.bridgeIns === 1 ? '' : 's'}
                </span>
              </>
            )}
          </td>
          <td className={`${tdClass} max-w-[140px] truncate`} title={row.assets.join(', ')}>
            {row.assets.join(', ') || <Dash />}
          </td>
          <td className={tdClass}>
            <ActionBadges summary={row.actionSummary} />
          </td>
        </tr>
      ))}
    </Table>
  );
};

const BridgeInsTable = ({
  section,
  period,
}: {
  section: BreakdownSection<BridgeRow>;
  period: MetricsPeriod;
}) => {
  if (section.rows.length === 0)
    return <Empty>No bridge-ins attributed {METRICS_PERIOD_SUFFIX[period]}.</Empty>;
  const withDate = spansDays(period);
  return (
    <Table
      headers={[
        'Time',
        'Wallet',
        'Asset',
        { label: 'Amount', align: 'right' },
        { label: 'Value', align: 'right' },
        'From chain',
        'Link',
        'Tx',
      ]}
    >
      {section.rows.map((row, i) => {
        const external = externalTxLink(row);
        return (
          <tr key={`${row.txHash ?? row.at}-${i}`}>
            <td className={`${tdClass} whitespace-nowrap`}>
              <Time at={row.at} withDate={withDate} />
            </td>
            <td className={tdClass}>
              <AddressCell address={row.address} />
            </td>
            <td className={tdClass}>{row.asset}</td>
            <td className={`${tdClass} whitespace-nowrap text-right font-mono text-xs`}>{row.amount}</td>
            <td className={`${tdClass} whitespace-nowrap text-right`}>
              {row.amountUsd == null ? (
                <span className="text-muted-foreground" title="No oracle price for this token">
                  unpriced
                </span>
              ) : (
                formatUsd(row.amountUsd)
              )}
            </td>
            <td className={tdClass}>
              {row.chainName || (row.externalChainId != null ? `chain ${row.externalChainId}` : '—')}
            </td>
            <td className={`${tdClass} max-w-[200px]`}>
              <LinkCell link={row.link} />
            </td>
            <td className={`${tdClass} whitespace-nowrap`}>
              {row.txHash ? <ExplorerLink path={`/transaction/${row.txHash}`} /> : null}
              {external?.url ? (
                <ExternalExplorerLink
                  href={external.url}
                  title={`View origin transaction on ${external.explorerName}`}
                />
              ) : null}
              {!row.txHash && !external?.url ? <span className="text-muted-foreground">—</span> : null}
            </td>
          </tr>
        );
      })}
    </Table>
  );
};

const ActionsTable = ({
  section,
  period,
}: {
  section: BreakdownSection<ActionRow> & { byCategory: DailyBreakdown['actions']['byCategory'] };
  period: MetricsPeriod;
}) => {
  if (section.rows.length === 0)
    return <Empty>No on-chain actions attributed {METRICS_PERIOD_SUFFIX[period]}.</Empty>;
  const withDate = spansDays(period);
  return (
    <div className="space-y-3">
      {/* Grouped by action type first — the shape of the window at a glance */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {section.byCategory.map((group) => (
          <div key={group.category} className="rounded-lg border border-border p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              {ACTIVITY_CATEGORY_LABELS[group.category]}
            </div>
            <div className="mt-1 text-lg font-semibold">{formatCount(group.count)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {group.wallets} wallet{group.wallets === 1 ? '' : 's'} · {group.links} link
              {group.links === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>
      <Table headers={['Time', 'Action', 'Event', 'Wallet', 'Link']}>
        {section.rows.map((row, i) => (
          <tr key={`${row.at}-${i}`}>
            <td className={`${tdClass} whitespace-nowrap`}>
              <Time at={row.at} withDate={withDate} />
            </td>
            <td className={tdClass}>{ACTIVITY_CATEGORY_LABELS[row.category]}</td>
            <td className={`${tdClass} max-w-[200px] truncate text-muted-foreground`} title={row.description}>
              {row.description}
            </td>
            <td className={tdClass}>
              <AddressCell address={row.address} />
            </td>
            <td className={`${tdClass} max-w-[200px]`}>
              <LinkCell link={row.link} />
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
};

// Sub-line under the panel heading: how much of the metric the table shows,
// over which window
export const breakdownCaption = (
  key: BreakdownKey,
  breakdown: DailyBreakdown
): string => {
  const section = breakdown[key];
  const noun =
    key === 'opens' ? 'opens' : key === 'wallets' ? 'wallets' : key === 'bridgeIns' ? 'transfers' : 'actions';
  const when = METRICS_PERIOD_SUFFIX[breakdown.period];
  if (section.total === 0) return `no ${noun} ${when}`;
  if (section.truncated) {
    return `newest ${formatCount(section.shown)} of ${formatCount(section.total)} ${noun} ${when}`;
  }
  return `${formatCount(section.total)} ${noun} ${when}`;
};

// The window comes from the payload, not from the caller's state: the table
// must describe the data it was given, even mid-refetch after a period switch.
const SnapshotBreakdown = ({
  metric,
  breakdown,
}: {
  metric: BreakdownKey;
  breakdown: DailyBreakdown;
}) => {
  const period = breakdown.period;
  switch (metric) {
    case 'opens':
      return <OpensTable section={breakdown.opens} period={period} />;
    case 'wallets':
      return <WalletsTable section={breakdown.wallets} period={period} />;
    case 'bridgeIns':
      return <BridgeInsTable section={breakdown.bridgeIns} period={period} />;
    case 'actions':
      return <ActionsTable section={breakdown.actions} period={period} />;
  }
};

export default SnapshotBreakdown;
