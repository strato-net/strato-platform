import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Pencil, Plus, Search } from 'lucide-react';
import { absoluteLinkUrl, formatUsd, LinkSummary, listLinks, setLinkActive } from '../api';
import CreateLinkModal from '../components/CreateLinkModal';
import DailySnapshotPanel from '../components/DailySnapshotPanel';
import EditLinkModal from '../components/EditLinkModal';
import {
  Button,
  CopyButton,
  inputClass,
  Skeleton,
  SortDirection,
  SortHeader,
  Switch,
  tdClass,
  thClass,
} from '../components/primitives';

type SortKey =
  | 'label'
  | 'source'
  | 'fullSource'
  | 'creator'
  | 'opens'
  | 'wallets'
  | 'bridgedWallets'
  | 'bridgeValueUsd'
  | 'activatedWallets'
  | 'lastActivityAt'
  | 'active';

// Fixed-width columns (table-fixed + colgroup); overflowing text truncates
// with the full value in the title tooltip. Every data column is sortable.
const COLUMNS: { label: string; width: number; align?: 'right'; sort?: SortKey }[] = [
  { label: 'Link', width: 170, sort: 'label' },
  { label: 'Source', width: 110, sort: 'source' },
  { label: 'Full source', width: 150, sort: 'fullSource' },
  { label: 'Creator', width: 120, sort: 'creator' },
  { label: 'Opens', width: 70, align: 'right', sort: 'opens' },
  { label: 'Wallets', width: 80, align: 'right', sort: 'wallets' },
  { label: 'Bridged', width: 80, align: 'right', sort: 'bridgedWallets' },
  { label: 'Bridge value', width: 105, align: 'right', sort: 'bridgeValueUsd' },
  { label: 'Activated', width: 90, align: 'right', sort: 'activatedWallets' },
  { label: 'Last activity', width: 120, sort: 'lastActivityAt' },
  { label: 'Active', width: 60, sort: 'active' },
  { label: '', width: 44 },
];
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, col) => sum + col.width, 0);

// Comparable value per sortable column; null (missing value, blank text) always
// sinks to the bottom, whichever direction is active.
const SORT_VALUES: Record<SortKey, (link: LinkSummary) => string | number | null> = {
  label: (link) => link.label.trim().toLowerCase() || null,
  source: (link) => link.source.trim().toLowerCase() || null,
  fullSource: (link) => link.fullSource.trim().toLowerCase() || null,
  creator: (link) => link.creator.trim().toLowerCase() || null,
  opens: (link) => link.opens,
  wallets: (link) => link.wallets,
  bridgedWallets: (link) => link.bridgedWallets,
  bridgeValueUsd: (link) => link.bridgeValueUsd,
  activatedWallets: (link) => link.activatedWallets,
  lastActivityAt: (link) => (link.lastActivityAt ? Date.parse(link.lastActivityAt) : null),
  active: (link) => (link.active ? 1 : 0),
};

// Free-text search runs over everything the row shows plus the shareable URL.
const searchHaystack = (link: LinkSummary) =>
  [link.slug, link.url, link.label, link.source, link.fullSource, link.creator]
    .join(' ')
    .toLowerCase();

const truncatedTdClass = `${tdClass} truncate`;

const LinksPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LinkSummary | null>(null);
  const [search, setSearch] = useState('');
  // null = the server's own order (newest first)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);

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

  // The endpoint returns the full list, so filtering and sorting stay client-side.
  const visibleLinks = useMemo(() => {
    const all = links.data ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = needle ? all.filter((link) => searchHaystack(link).includes(needle)) : all;
    if (!sort) return filtered;
    const valueOf = SORT_VALUES[sort.key];
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      if (left === null || right === null) {
        if (left === right) return 0;
        return left === null ? 1 : -1;
      }
      if (typeof left === 'string' && typeof right === 'string') {
        return factor * left.localeCompare(right);
      }
      return factor * (Number(left) - Number(right));
    });
  }, [links.data, search, sort]);

  // asc → desc → back to the server order
  const toggleSort = (key: SortKey) =>
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'asc' };
      return current.direction === 'asc' ? { key, direction: 'desc' } : null;
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

      <DailySnapshotPanel />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h2 className="text-sm font-semibold">All links</h2>
        {links.data && links.data.length > 0 && (
          <div className="flex items-center gap-3">
            {search.trim() && (
              <span className="text-xs text-muted-foreground">
                {visibleLinks.length} of {links.data.length}
              </span>
            )}
            <div className="relative w-64 max-w-full">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search links…"
                aria-label="Search tracking links"
                className={`${inputClass} pl-8`}
              />
            </div>
          </div>
        )}
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
      ) : visibleLinks.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">
          No links match “{search.trim()}”.{' '}
          <button className="underline" onClick={() => setSearch('')}>
            Clear search
          </button>
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
                {COLUMNS.map(({ label, align, sort: key }) =>
                  key ? (
                    <SortHeader
                      key={label}
                      label={label}
                      align={align}
                      active={sort?.key === key}
                      direction={sort?.key === key ? sort.direction : 'asc'}
                      onClick={() => toggleSort(key)}
                    />
                  ) : (
                    <th key={label} className={`${thClass} ${align === 'right' ? 'text-right' : ''}`}>
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleLinks.map((link) => (
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
