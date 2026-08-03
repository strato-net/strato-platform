import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Plus } from 'lucide-react';
import { absoluteLinkUrl, formatUsd, listLinks, setLinkActive } from '../api';
import CreateLinkModal from '../components/CreateLinkModal';
import { Button, CopyButton, Skeleton, Switch, tdClass, thClass } from '../components/primitives';

const LinksPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

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
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                <th className={thClass}>Link</th>
                <th className={thClass}>Source</th>
                <th className={thClass}>Creator</th>
                <th className={`${thClass} text-right`}>Opens</th>
                <th className={`${thClass} text-right`}>Wallets</th>
                <th className={`${thClass} text-right`}>Bridged wallets</th>
                <th className={`${thClass} text-right`}>Bridge value</th>
                <th className={`${thClass} text-right`}>Activated wallets</th>
                <th className={thClass}>Last activity</th>
                <th className={thClass}>Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {links.data.map((link) => (
                <tr
                  key={link.id}
                  onClick={() => navigate(`/links/${link.id}`)}
                  className={`cursor-pointer hover:bg-muted/50 ${link.active ? '' : 'opacity-60'}`}
                >
                  <td className={tdClass}>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-xs">/t/{link.slug}</span>
                      <CopyButton value={absoluteLinkUrl(link.url)} label="Copy link URL" />
                    </div>
                    <div className="text-xs text-muted-foreground">{link.label}</div>
                  </td>
                  <td className={tdClass}>{link.source}</td>
                  <td className={tdClass}>{link.creator}</td>
                  <td className={`${tdClass} text-right`}>{link.opens}</td>
                  <td className={`${tdClass} text-right`}>{link.wallets}</td>
                  <td className={`${tdClass} text-right`}>{link.bridgedWallets}</td>
                  <td className={`${tdClass} text-right`}>{formatUsd(link.bridgeValueUsd)}</td>
                  <td className={`${tdClass} text-right`}>{link.activatedWallets}</td>
                  <td className={`${tdClass} whitespace-nowrap text-muted-foreground`}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateLinkModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
};

export default LinksPage;
