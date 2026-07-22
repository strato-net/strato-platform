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
import { useTrackingAccess, useTrackingLink } from '@/hooks/useTracking';
import { formatUsd, TrackingApiError } from '@/lib/trackingApi';
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

const ACTIVITY_KIND_LABELS: Record<string, string> = {
  first_action: 'First action',
  metal_purchase: 'Metal purchase',
  swap: 'Swap',
  other: 'Activity',
};

const TrackingLinkDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { authorized, isLoading: accessLoading } = useTrackingAccess();
  const link = useTrackingLink(authorized ? id : undefined);

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
                <CardTitle className="text-base">Connected wallets</CardTitle>
              </CardHeader>
              <CardContent>
                {link.data.connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No wallets connected yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>External wallet</TableHead>
                        <TableHead>STRATO address</TableHead>
                        <TableHead>Connector</TableHead>
                        <TableHead>Connected</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {link.data.connections.map((conn, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <AddressCell address={conn.externalWalletAddress} />
                          </TableCell>
                          <TableCell>
                            <AddressCell address={conn.stratoAddress} />
                          </TableCell>
                          <TableCell>{conn.connector ?? '—'}</TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {format(new Date(conn.connectedAt), 'MMM d, yyyy HH:mm')}
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
                            <Badge variant="outline">{ACTIVITY_KIND_LABELS[item.kind] ?? item.kind}</Badge>
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
    </div>
  );
};

export default TrackingLinkDetailPage;
