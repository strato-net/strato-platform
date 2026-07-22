import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import CopyButton from '@/components/ui/copy';
import { useSetTrackingLinkActive } from '@/hooks/useTracking';
import { formatUsd, TrackingLinkSummary } from '@/lib/trackingApi';

const TrackingLinksTable = ({ links }: { links: TrackingLinkSummary[] }) => {
  const navigate = useNavigate();
  const setActive = useSetTrackingLinkActive();

  if (links.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
        No tracking links yet — create your first one.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Link</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Creator</TableHead>
            <TableHead className="text-right">Opens</TableHead>
            <TableHead className="text-right">Wallets</TableHead>
            <TableHead className="text-right">Bridged wallets</TableHead>
            <TableHead className="text-right">Bridge value</TableHead>
            <TableHead className="text-right">Activated wallets</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => (
            <TableRow
              key={link.id}
              onClick={() => navigate(`/dashboard/tracking/${link.id}`)}
              className={`cursor-pointer ${link.active ? '' : 'opacity-60'}`}
            >
              <TableCell>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-xs">/t/{link.slug}</span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <CopyButton address={link.url} />
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">{link.label}</div>
              </TableCell>
              <TableCell>{link.source}</TableCell>
              <TableCell>{link.creator}</TableCell>
              <TableCell className="text-right">{link.opens}</TableCell>
              <TableCell className="text-right">{link.wallets}</TableCell>
              <TableCell className="text-right">{link.bridgedWallets}</TableCell>
              <TableCell className="text-right">{formatUsd(link.bridgeValueUsd)}</TableCell>
              <TableCell className="text-right">{link.activatedWallets}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {link.lastActivityAt
                  ? formatDistanceToNow(new Date(link.lastActivityAt), { addSuffix: true })
                  : '—'}
              </TableCell>
              <TableCell onClick={(e) => e.stopPropagation()}>
                <Switch
                  checked={link.active}
                  onCheckedChange={(active) => setActive.mutate({ id: link.id, active })}
                  aria-label={link.active ? 'Deactivate link' : 'Activate link'}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default TrackingLinksTable;
