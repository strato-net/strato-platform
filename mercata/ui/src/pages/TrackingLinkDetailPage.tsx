import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { ArrowLeft, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import CopyButton from '@/components/ui/copy';
import ExplorerButton from '@/components/ui/explorer';
import ActivitySummaryTiles from '@/components/tracking/ActivitySummaryTiles';
import WalletDetailSheet from '@/components/tracking/WalletDetailSheet';
import WorldMap from '@/components/tracking/WorldMap';
import { useTrackingAccess, useTrackingLink } from '@/hooks/useTracking';
import {
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CATEGORY_ORDER,
  formatUsd,
  TrackingApiError,
  TrackingWalletSummary,
} from '@/lib/trackingApi';
import { getStratoChain } from '@/lib/stratoChain';

const shortAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;

const explorerBase = () => getStratoChain()?.blockExplorers?.default?.url ?? null;

const AddressCell = ({ address }: { address: string | null }) => {
  if (!address) return <span className="text-muted-foreground">—</span>;
  const base = explorerBase();
  return (
    <span className="flex items-center font-mono text-xs">
      {shortAddress(address)}
      <CopyButton address={address} />
      {base && <ExplorerButton url={`${base}/address/${address}`} />}
    </span>
  );
};

const TxCell = ({ txHash }: { txHash: string | null }) => {
  if (!txHash) return <span className="text-muted-foreground">—</span>;
  const base = explorerBase();
  return (
    <span className="flex items-center font-mono text-xs">
      {shortAddress(txHash)}
      <CopyButton address={txHash} />
      {base && <ExplorerButton url={`${base}/tx/${txHash}`} />}
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
const WalletActivityChips = ({ wallet }: { wallet: TrackingWalletSummary }) => {
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
        <Badge key={category} variant="secondary" className="text-[11px] font-normal">
          {ACTIVITY_CATEGORY_LABELS[category]}: {wallet.activitySummary[category]}
        </Badge>
      ))}
      {entries.length > shown.length && (
        <Badge variant="outline" className="text-[11px] font-normal">
          +{entries.length - shown.length} more
        </Badge>
      )}
    </span>
  );
};

const TrackingLinkDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { authorized, isLoading: accessLoading } = useTrackingAccess();
  const link = useTrackingLink(authorized ? id : undefined);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);

  const notFound = link.error instanceof TrackingApiError && link.error.status === 404;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-14 md:h-16 gap-2 md:space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard/tracking')}
              className="flex items-center gap-1 md:space-x-2 px-2 md:px-3"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-xs md:text-sm">Back</span>
            </Button>
            <div className="flex items-center gap-1 md:space-x-2">
              <Link2 className="h-5 w-5 md:h-6 md:w-6 text-strato-blue" />
              <h1 className="text-base md:text-xl font-bold whitespace-nowrap">
                {link.data ? link.data.label : 'Tracking Link'}
              </h1>
              {link.data && !link.data.active && <Badge variant="secondary">Inactive</Badge>}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 space-y-6">
        {accessLoading || (authorized && link.isPending) ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !authorized && !accessLoading ? (
          <Card className="mx-auto max-w-md">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              You don't have access to tracking links.
            </CardContent>
          </Card>
        ) : notFound ? (
          <Card className="mx-auto max-w-md">
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Link not found.
            </CardContent>
          </Card>
        ) : link.isError ? (
          <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
            Failed to load link details.{' '}
            <button className="underline" onClick={() => link.refetch()}>
              Retry
            </button>
          </div>
        ) : link.data ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">URL:</span>
                    <span className="font-mono text-xs">{link.data.url}</span>
                    <CopyButton address={link.data.url} />
                  </span>
                  <span>
                    <span className="text-muted-foreground">Source:</span> {link.data.source}
                  </span>
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Activity summary</CardTitle>
                <p className="text-xs text-muted-foreground">
                  On-chain events attributed to this link.
                </p>
              </CardHeader>
              <CardContent>
                <ActivitySummaryTiles summary={link.data.activitySummary} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Visitor locations</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Where this link was opened (excluding bots and previews).
                </p>
              </CardHeader>
              <CardContent>
                {link.data.geoPoints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No location data yet — locations are recorded when the link is opened.
                  </p>
                ) : (
                  <WorldMap points={link.data.geoPoints} />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Wallets</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Click a wallet for its full activity history.
                </p>
              </CardHeader>
              <CardContent>
                {link.data.walletSummaries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No wallets connected yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Connector</TableHead>
                        <TableHead>Activity</TableHead>
                        <TableHead>Last activity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {link.data.walletSummaries.map((wallet) => (
                        <TableRow
                          key={wallet.address}
                          className="cursor-pointer"
                          onClick={() => setSelectedWallet(wallet.address)}
                        >
                          <TableCell>
                            {/* Copy/explorer clicks must not open the sheet */}
                            <div
                              className="flex flex-col gap-0.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <AddressCell address={wallet.externalWalletAddress} />
                              <AddressCell address={wallet.stratoAddress} />
                            </div>
                          </TableCell>
                          <TableCell>{wallet.connector ?? '—'}</TableCell>
                          <TableCell>
                            <WalletActivityChips wallet={wallet} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {wallet.lastActivityAt
                              ? formatDistanceToNow(new Date(wallet.lastActivityAt), {
                                  addSuffix: true,
                                })
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bridge-ins</CardTitle>
              </CardHeader>
              <CardContent>
                {link.data.bridgeIns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No confirmed bridge-ins yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Tx</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {link.data.bridgeIns.map((bridge, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <AddressCell address={bridge.address} />
                          </TableCell>
                          <TableCell>{bridge.asset}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{bridge.amount}</TableCell>
                          <TableCell className="text-right">{formatUsd(bridge.amountUsd)}</TableCell>
                          <TableCell>
                            <TxCell txHash={bridge.txHash} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {format(new Date(bridge.at), 'MMM d, yyyy HH:mm')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {link.data.activity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No STRATO activity yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Wallet</TableHead>
                        <TableHead>Tx</TableHead>
                        <TableHead>When</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {link.data.activity.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Badge variant="outline">
                              {ACTIVITY_CATEGORY_LABELS[item.category] ?? item.category}
                            </Badge>
                          </TableCell>
                          <TableCell>{item.description}</TableCell>
                          <TableCell>
                            <AddressCell address={item.address} />
                          </TableCell>
                          <TableCell>
                            <TxCell txHash={item.txHash} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>

      {id && (
        <WalletDetailSheet
          linkId={id}
          address={selectedWallet}
          onClose={() => setSelectedWallet(null)}
        />
      )}
    </div>
  );
};

export default TrackingLinkDetailPage;
