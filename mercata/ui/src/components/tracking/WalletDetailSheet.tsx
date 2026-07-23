import { format, formatDistanceToNow } from 'date-fns';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import CopyButton from '@/components/ui/copy';
import ExplorerButton from '@/components/ui/explorer';
import ActivitySummaryTiles from '@/components/tracking/ActivitySummaryTiles';
import { useTrackingWallet } from '@/hooks/useTracking';
import { ACTIVITY_CATEGORY_LABELS, formatUsd } from '@/lib/trackingApi';
import { getStratoChain } from '@/lib/stratoChain';

const shortAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;

const explorerBase = () => getStratoChain()?.blockExplorers?.default?.url ?? null;

const AddressLine = ({ label, address }: { label: string; address: string | null }) => {
  if (!address) return null;
  const base = explorerBase();
  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono text-xs">{shortAddress(address)}</span>
      <CopyButton address={address} />
      {base && <ExplorerButton url={`${base}/address/${address}`} />}
    </div>
  );
};

interface WalletDetailSheetProps {
  linkId: string;
  address: string | null;
  onClose: () => void;
}

// Per-user drill-down. Shows the wallet's FULL on-chain history — including
// activity from before the link was opened — which is deliberately broader
// than the link's attributed metrics.
const WalletDetailSheet = ({ linkId, address, onClose }: WalletDetailSheetProps) => {
  const wallet = useTrackingWallet(linkId, address);

  return (
    <Sheet open={!!address} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">
            {address ? shortAddress(address) : ''}
          </SheetTitle>
          <SheetDescription>
            All on-chain activity for this wallet (not limited to activity attributed to this
            link).
          </SheetDescription>
        </SheetHeader>

        {wallet.isPending && address ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : wallet.isError ? (
          <p className="mt-4 text-sm text-muted-foreground">Failed to load wallet activity.</p>
        ) : wallet.data ? (
          <div className="mt-4 space-y-6">
            <div className="space-y-1">
              <AddressLine label="External wallet" address={wallet.data.externalWalletAddress} />
              <AddressLine label="STRATO address" address={wallet.data.stratoAddress} />
              <div className="text-sm text-muted-foreground">
                Connector: {wallet.data.connector ?? '—'} · First connected{' '}
                {format(new Date(wallet.data.connectedAt), 'MMM d, yyyy')}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-medium">Activity summary</h3>
              <ActivitySummaryTiles summary={wallet.data.activitySummary} />
            </div>

            {wallet.data.bridgeIns.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">Bridge-ins</h3>
                <div className="space-y-2">
                  {wallet.data.bridgeIns.map((bridge, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                    >
                      <span>
                        {bridge.amount} {bridge.asset}
                        <span className="ml-2 text-muted-foreground">
                          {formatUsd(bridge.amountUsd)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        {format(new Date(bridge.at), 'MMM d, yyyy')}
                        {bridge.txHash && explorerBase() && (
                          <ExplorerButton url={`${explorerBase()}/tx/${bridge.txHash}`} />
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-medium">Activity</h3>
              {wallet.data.activity.length === 0 ? (
                <p className="text-sm text-muted-foreground">No STRATO activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {wallet.data.activity.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">
                          {ACTIVITY_CATEGORY_LABELS[item.category] ?? item.category}
                        </Badge>
                        <span className="text-muted-foreground">{item.description}</span>
                      </span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(item.at), { addSuffix: true })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

export default WalletDetailSheet;
