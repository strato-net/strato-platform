import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpDown,
  Globe,
  MousePointerClick,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  ACTIVITY_CATEGORY_LABELS,
  ApiError,
  formatUsd,
  getUserTimeline,
  shortAddress,
  TimelineItem,
  TimelineKind,
  UserTimeline,
} from '../api';
import ActivityTiles from '../components/ActivityTiles';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  ExplorerLink,
  ExternalExplorerLink,
  Skeleton,
} from '../components/primitives';

const KIND_META: Record<TimelineKind, { icon: typeof Activity; label: string }> = {
  link_opened: { icon: MousePointerClick, label: 'Link open' },
  engaged: { icon: Sparkles, label: 'Engagement' },
  wallet_connected: { icon: Wallet, label: 'Wallet' },
  bridge_in: { icon: ArrowDownToLine, label: 'Bridge in' },
  onchain: { icon: Activity, label: 'On-chain' },
  remote_chain: { icon: Globe, label: 'Origin chain' },
};

const TimelineRow = ({
  item,
  linkLabels,
}: {
  item: TimelineItem;
  linkLabels: Map<string, string>;
}) => {
  const meta = KIND_META[item.kind] ?? KIND_META.onchain;
  const Icon = meta.icon;
  const attributedTo = item.attributedLinkId ? linkLabels.get(item.attributedLinkId) : null;

  return (
    <li className="relative">
      <span className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <Icon size={12} />
      </span>
      <div className="rounded-md border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary">
              {item.category ? ACTIVITY_CATEGORY_LABELS[item.category] : meta.label}
            </Badge>
            <span className="font-medium">{item.title}</span>
            {item.amountUsd != null && (
              <span className="text-muted-foreground">{formatUsd(item.amountUsd)}</span>
            )}
            {item.txHash && <ExplorerLink path={`/tx/${item.txHash}`} />}
            {item.externalTxUrl && (
              <ExternalExplorerLink
                href={item.externalTxUrl}
                title={`View on ${item.chainName ?? 'the origin chain'} explorer`}
              />
            )}
          </div>
          <span
            className="whitespace-nowrap text-xs text-muted-foreground"
            title={format(new Date(item.at), 'PPpp')}
          >
            {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {item.detail && <span>{item.detail}</span>}
          {item.linkId && (
            <Link to={`/links/${item.linkId}`} className="hover:underline">
              {item.linkLabel ?? `Link ${item.linkId}`}
              {item.linkSource ? ` · ${item.linkSource}` : ''}
            </Link>
          )}
          {attributedTo && <span>Attributed to {attributedTo}</span>}
          {item.address && <span className="font-mono">{shortAddress(item.address)}</span>}
        </div>
      </div>
    </li>
  );
};

const Identity = ({ timeline }: { timeline: UserTimeline }) => (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {timeline.externalWalletAddress && (
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">External wallet:</span>
          <span className="font-mono text-xs">{timeline.externalWalletAddress}</span>
          <CopyButton value={timeline.externalWalletAddress} label="Copy address" />
        </span>
      )}
      {timeline.stratoAddress && (
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground">STRATO address:</span>
          <span className="font-mono text-xs">{timeline.stratoAddress}</span>
          <CopyButton value={timeline.stratoAddress} label="Copy address" />
        </span>
      )}
      <span>
        <span className="text-muted-foreground">Connector:</span> {timeline.connector ?? '—'}
      </span>
      <span>
        <span className="text-muted-foreground">First seen:</span>{' '}
        {format(new Date(timeline.firstSeenAt), 'MMM d, yyyy HH:mm')}
      </span>
      <span>
        <span className="text-muted-foreground">Last on-chain activity:</span>{' '}
        {timeline.lastActivityAt
          ? formatDistanceToNow(new Date(timeline.lastActivityAt), { addSuffix: true })
          : '—'}
      </span>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Tracking links:</span>
      {timeline.links.length === 0 ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        timeline.links.map((link) => (
          <Link key={link.id} to={`/links/${link.id}`} className="hover:underline">
            <Badge>{link.label}</Badge>
          </Link>
        ))
      )}
    </div>
  </div>
);

// Per-wallet story: how the visitor arrived (tracking link opens, origin-chain
// funding), when they connected, and everything they did on STRATO afterwards.
const UserTimelinePage = () => {
  const navigate = useNavigate();
  const { address } = useParams<{ address: string }>();
  const [oldestFirst, setOldestFirst] = useState(false);

  const timeline = useQuery({
    queryKey: ['users', address, 'timeline'],
    queryFn: () => getUserTimeline(address!),
    enabled: !!address,
  });

  const linkLabels = useMemo(
    () => new Map((timeline.data?.links ?? []).map((link) => [link.id, link.label])),
    [timeline.data]
  );
  // The service returns newest first; the "story" reading is oldest first.
  const items = useMemo(() => {
    const list = timeline.data?.items ?? [];
    return oldestFirst ? [...list].reverse() : list;
  }, [timeline.data, oldestFirst]);

  const notFound = timeline.error instanceof ApiError && timeline.error.status === 404;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <h1 className="font-mono text-lg font-semibold">
          {address ? shortAddress(address) : 'User'}
        </h1>
        {address && <CopyButton value={address} label="Copy address" />}
      </div>

      {timeline.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : notFound ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No tracked activity for this address.
        </div>
      ) : timeline.isError ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Failed to load the timeline.{' '}
          <button className="underline" onClick={() => timeline.refetch()}>
            Retry
          </button>
        </div>
      ) : timeline.data ? (
        <div className="space-y-4">
          <Card title="User">
            <Identity timeline={timeline.data} />
          </Card>

          <Card title="Activity summary" subtitle="This wallet's full on-chain history.">
            <ActivityTiles summary={timeline.data.activitySummary} />
          </Card>

          <Card
            title="Timeline"
            subtitle={
              timeline.data.remoteChainEnabled
                ? 'Link opens, wallet connections, STRATO activity and origin-chain transactions.'
                : 'Link opens, wallet connections and STRATO activity. Set TRACKING_ETHERSCAN_API_KEY to include origin-chain transactions.'
            }
          >
            <div className="space-y-3">
              <Button variant="outline" onClick={() => setOldestFirst((prev) => !prev)}>
                <ArrowUpDown size={14} />
                {oldestFirst ? 'Oldest first' : 'Newest first'}
              </Button>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recorded for this wallet.</p>
              ) : (
                <ol className="relative space-y-3 pl-9">
                  <span className="absolute bottom-2 left-3 top-2 w-px bg-border" aria-hidden />
                  {items.map((item, i) => (
                    <TimelineRow key={`${item.kind}-${item.at}-${i}`} item={item} linkLabels={linkLabels} />
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
};

export default UserTimelinePage;
