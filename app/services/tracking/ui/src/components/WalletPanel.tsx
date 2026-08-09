import { format, formatDistanceToNow } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { ACTIVITY_CATEGORY_LABELS, formatUsd, getWallet, shortAddress } from '../api';
import ActivityTiles from './ActivityTiles';
import { AddressCell, Badge, ExplorerLink, SidePanel, Skeleton } from './primitives';

interface WalletPanelProps {
  linkId: string;
  address: string | null;
  onClose: () => void;
}

// Per-user drill-down. Shows the wallet's FULL on-chain history — including
// activity from before the link was opened — which is deliberately broader
// than the link's attributed metrics.
const WalletPanel = ({ linkId, address, onClose }: WalletPanelProps) => {
  const wallet = useQuery({
    queryKey: ['links', linkId, 'wallets', address],
    queryFn: () => getWallet(linkId, address!),
    enabled: !!address,
  });

  return (
    <SidePanel
      open={!!address}
      onClose={onClose}
      title={address ? shortAddress(address) : ''}
      description="All on-chain activity for this wallet (not limited to activity attributed to this link)."
    >
      {wallet.isPending && address ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : wallet.isError ? (
        <p className="text-sm text-muted-foreground">Failed to load wallet activity.</p>
      ) : wallet.data ? (
        <div className="space-y-6">
          <div className="space-y-1">
            {wallet.data.externalWalletAddress && (
              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground">External wallet:</span>
                <AddressCell address={wallet.data.externalWalletAddress} />
              </div>
            )}
            {wallet.data.stratoAddress && (
              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground">STRATO address:</span>
                <AddressCell address={wallet.data.stratoAddress} />
              </div>
            )}
            <div className="text-sm text-muted-foreground">
              Connector: {wallet.data.connector ?? '—'} · First connected{' '}
              {format(new Date(wallet.data.connectedAt), 'MMM d, yyyy')}
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium">Activity summary</h3>
            <ActivityTiles summary={wallet.data.activitySummary} />
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
                      {bridge.txHash && <ExplorerLink path={`/tx/${bridge.txHash}`} />}
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
                      <Badge>{ACTIVITY_CATEGORY_LABELS[item.category] ?? item.category}</Badge>
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
    </SidePanel>
  );
};

export default WalletPanel;
