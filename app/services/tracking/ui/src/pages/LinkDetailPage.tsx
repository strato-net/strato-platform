import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { ArrowLeft, Pencil } from 'lucide-react';
import {
  absoluteLinkUrl,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_ORDER,
  ApiError,
  BridgeInItem,
  externalTxLink,
  formatUsd,
  getLink,
  WalletSummary,
} from '../api';
import ActivityTiles from '../components/ActivityTiles';
import EditLinkModal from '../components/EditLinkModal';
import HistoryChart from '../components/HistoryChart';
import WalletPanel from '../components/WalletPanel';
import WorldMap from '../components/WorldMap';
import {
  AddressCell,
  Badge,
  Button,
  Card,
  CopyButton,
  ExplorerLink,
  ExternalExplorerLink,
  Skeleton,
  tdClass,
  thClass,
} from '../components/primitives';

// Origin-chain transaction with an etherscan/basescan-style link when the
// chain is recognized; bare hash otherwise, dash when the row predates
// externalTxHash tracking.
const ExternalTxCell = ({ bridge }: { bridge: BridgeInItem }) => {
  const external = externalTxLink(bridge);
  if (!external) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex items-center font-mono text-xs">
      {external.hash.slice(0, 10)}…
      {external.url && (
        <ExternalExplorerLink
          href={external.url}
          title={`View on ${external.explorerName}`}
        />
      )}
    </span>
  );
};

const StatTile = ({ label, value }: { label: string; value: string | number }) => (
  <div className="rounded-lg border border-border p-4">
    <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className="mt-1 text-xl font-semibold">{value}</div>
  </div>
);

// Compact per-wallet chips: top three non-zero categories, then a +N overflow
const WalletActivityChips = ({ wallet }: { wallet: WalletSummary }) => {
  const entries = ACTIVITY_CATEGORY_ORDER.filter(
    (category) => (wallet.activitySummary[category] ?? 0) > 0
  );
  if (entries.length === 0) {
    return <span className="text-xs text-muted-foreground">No activity</span>;
  }
  const shown = entries.slice(0, 3);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((category) => (
        <Badge key={category} variant="secondary">
          {ACTIVITY_CATEGORY_LABELS[category]}: {wallet.activitySummary[category]}
        </Badge>
      ))}
      {entries.length > shown.length && <Badge>+{entries.length - shown.length} more</Badge>}
    </span>
  );
};

const LinkDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const link = useQuery({
    queryKey: ['links', id],
    queryFn: () => getLink(id!),
    enabled: !!id,
  });

  const notFound = link.error instanceof ApiError && link.error.status === 404;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => navigate('/')}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <h1 className="text-lg font-semibold">{link.data ? link.data.label : 'Tracking Link'}</h1>
        {link.data && !link.data.active && <Badge variant="secondary">Inactive</Badge>}
        {link.data && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil size={14} />
            Edit
          </Button>
        )}
      </div>

      {link.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : notFound ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Link not found.
        </div>
      ) : link.isError ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Failed to load link details.{' '}
          <button className="underline" onClick={() => link.refetch()}>
            Retry
          </button>
        </div>
      ) : link.data ? (
        <div className="space-y-4">
          <Card title="Summary">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <span className="flex items-center gap-1">
                  <span className="text-muted-foreground">URL:</span>
                  <span className="font-mono text-xs">{absoluteLinkUrl(link.data.url)}</span>
                  <CopyButton value={absoluteLinkUrl(link.data.url)} label="Copy link URL" />
                </span>
                <span>
                  <span className="text-muted-foreground">Source:</span> {link.data.source}
                </span>
                {link.data.fullSource && (
                  <span>
                    <span className="text-muted-foreground">Full source:</span>{' '}
                    {link.data.fullSource}
                  </span>
                )}
                <span>
                  <span className="text-muted-foreground">Creator:</span> {link.data.creator}
                </span>
                <span>
                  <span className="text-muted-foreground">Destination:</span>{' '}
                  <span className="font-mono text-xs">{link.data.destination}</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatTile label="Opens" value={link.data.opens} />
                <StatTile label="Wallets" value={link.data.wallets} />
                <StatTile label="Bridged" value={link.data.bridgedWallets} />
                <StatTile label="Bridge value" value={formatUsd(link.data.bridgeValueUsd)} />
                <StatTile label="Activated" value={link.data.activatedWallets} />
              </div>
            </div>
          </Card>

          <Card
            title="History"
            subtitle="Engagement and attributed value over time — per day or cumulative."
          >
            {link.data.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No history yet — data appears once the link is opened.
              </p>
            ) : (
              <HistoryChart history={link.data.history} />
            )}
          </Card>

          <Card title="Activity summary" subtitle="On-chain events attributed to this link.">
            <ActivityTiles summary={link.data.activitySummary} />
          </Card>

          <Card
            title="Visitor locations"
            subtitle="Where this link was opened (excluding bots and previews)."
          >
            {link.data.geoPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No location data yet — locations are recorded when the link is opened.
              </p>
            ) : (
              <WorldMap points={link.data.geoPoints} />
            )}
          </Card>

          <Card title="Wallets" subtitle="Click a wallet for its full activity history.">
            {link.data.walletSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No wallets connected yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={thClass}>Wallet</th>
                      <th className={thClass}>Connector</th>
                      <th className={thClass}>Activity</th>
                      <th className={thClass}>Last activity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {link.data.walletSummaries.map((wallet) => (
                      <tr
                        key={wallet.address}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedWallet(wallet.address)}
                      >
                        <td className={tdClass}>
                          <div className="flex flex-col gap-0.5">
                            <AddressCell address={wallet.externalWalletAddress} />
                            <AddressCell address={wallet.stratoAddress} />
                          </div>
                        </td>
                        <td className={tdClass}>{wallet.connector ?? '—'}</td>
                        <td className={tdClass}>
                          <WalletActivityChips wallet={wallet} />
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>
                          {wallet.lastActivityAt
                            ? formatDistanceToNow(new Date(wallet.lastActivityAt), {
                                addSuffix: true,
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Bridge-ins">
            {link.data.bridgeIns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed bridge-ins yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      <th className={thClass}>Wallet</th>
                      <th className={thClass}>Asset</th>
                      <th className={`${thClass} text-right`}>Amount</th>
                      <th className={`${thClass} text-right`}>Value</th>
                      <th className={thClass}>STRATO Tx</th>
                      <th className={thClass}>External Tx</th>
                      <th className={thClass}>Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {link.data.bridgeIns.map((bridge, i) => (
                      <tr key={i}>
                        <td className={tdClass}>
                          <AddressCell address={bridge.address} />
                        </td>
                        <td className={tdClass}>{bridge.asset}</td>
                        <td className={`${tdClass} text-right font-mono text-xs`}>
                          {bridge.amount}
                        </td>
                        <td className={`${tdClass} text-right`}>{formatUsd(bridge.amountUsd)}</td>
                        <td className={tdClass}>
                          {bridge.txHash ? (
                            <span className="flex items-center font-mono text-xs">
                              {bridge.txHash.slice(0, 10)}…
                              <ExplorerLink path={`/tx/${bridge.txHash}`} />
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className={tdClass}>
                          <ExternalTxCell bridge={bridge} />
                        </td>
                        <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>
                          {format(new Date(bridge.at), 'MMM d, yyyy HH:mm')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Activity" subtitle="Events attributed to this link, latest first.">
            {link.data.activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No STRATO activity yet.</p>
            ) : (
              <div className="space-y-2">
                {link.data.activity.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Badge>{ACTIVITY_CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                      <span className="text-muted-foreground">{item.description}</span>
                      <AddressCell address={item.address} />
                    </span>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {id && (
        <WalletPanel linkId={id} address={selectedWallet} onClose={() => setSelectedWallet(null)} />
      )}
      <EditLinkModal link={editing ? link.data ?? null : null} onClose={() => setEditing(false)} />
    </div>
  );
};

export default LinkDetailPage;
