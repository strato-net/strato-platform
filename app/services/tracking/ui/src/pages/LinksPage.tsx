import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Pencil, Plus } from 'lucide-react';
import { absoluteLinkUrl, formatUsd, LinkSummary, listLinks, setLinkActive } from '../api';
import CreateLinkModal from '../components/CreateLinkModal';
import EditLinkModal from '../components/EditLinkModal';
import { Button, CopyButton, Skeleton, Switch, tdClass, thClass } from '../components/primitives';

// Fixed-width columns (table-fixed + colgroup); overflowing text truncates
// with the full value in the title tooltip.
const COLUMNS: { label: string; width: number; align?: 'right' }[] = [
  { label: 'Link', width: 170 },
  { label: 'Source', width: 110 },
  { label: 'Full source', width: 150 },
  { label: 'Creator', width: 120 },
  { label: 'Opens', width: 70, align: 'right' },
  { label: 'Wallets', width: 80, align: 'right' },
  { label: 'Bridged', width: 80, align: 'right' },
  { label: 'Bridge value', width: 105, align: 'right' },
  { label: 'Activated', width: 90, align: 'right' },
  { label: 'Last activity', width: 120 },
  { label: 'Active', width: 60 },
  { label: '', width: 44 },
];
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, col) => sum + col.width, 0);

const truncatedTdClass = `${tdClass} truncate`;

const LinksPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LinkSummary | null>(null);

  const links = useQuery({
    queryKey: ['links'],
    queryFn: listLinks,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setLinkActive(id, active),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['links'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Tracking Links</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} />
          New Tracking Link
        </Button>
      </div>

      {links.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : links.isError ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          Failed to load tracking links.{' '}
          <button className="underline" onClick={() => links.refetch()}>
            Retry
          </button>
        </div>
      ) : links.data.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No tracking links yet — create your first one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full table-fixed" style={{ minWidth: TABLE_MIN_WIDTH }}>
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.label} style={{ width: col.width }} />
              ))}
            </colgroup>
            <thead className="border-b border-border">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    className={`${thClass} ${col.align === 'right' ? 'text-right' : ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {links.data.map((link) => (
                <tr
                  key={link.id}
                  onClick={() => navigate(`/links/${link.id}`)}
                  className={`cursor-pointer hover:bg-muted/50 ${link.active ? '' : 'opacity-60'}`}
                >
                  <td className={truncatedTdClass}>
                    <div className="flex items-center gap-1">
                      <span className="truncate font-mono text-xs">/t/{link.slug}</span>
                      <CopyButton value={absoluteLinkUrl(link.url)} label="Copy link URL" />
                    </div>
                    <div className="truncate text-xs text-muted-foreground" title={link.label}>
                      {link.label}
                    </div>
                  </td>
                  <td className={truncatedTdClass} title={link.source}>
                    {link.source}
                  </td>
                  <td className={truncatedTdClass} title={link.fullSource}>
                    {link.fullSource}
                  </td>
                  <td className={truncatedTdClass} title={link.creator}>
                    {link.creator}
                  </td>
                  <td className={`${tdClass} text-right`}>{link.opens}</td>
                  <td className={`${tdClass} text-right`}>{link.wallets}</td>
                  <td className={`${tdClass} text-right`}>{link.bridgedWallets}</td>
                  <td className={`${tdClass} text-right`}>{formatUsd(link.bridgeValueUsd)}</td>
                  <td className={`${tdClass} text-right`}>{link.activatedWallets}</td>
                  <td className={`${tdClass} truncate text-muted-foreground`}>
                    {link.lastActivityAt
                      ? formatDistanceToNow(new Date(link.lastActivityAt), { addSuffix: true })
                      : '—'}
                  </td>
                  <td className={tdClass}>
                    <Switch
                      checked={link.active}
                      onChange={(active) => setActive.mutate({ id: link.id, active })}
                      label={link.active ? 'Deactivate link' : 'Activate link'}
                    />
                  </td>
                  <td className={tdClass}>
                    <button
                      type="button"
                      aria-label="Edit link"
                      title="Edit link"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(link);
                      }}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateLinkModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <EditLinkModal link={editing} onClose={() => setEditing(null)} />
    </div>
  );
};

export default LinksPage;
