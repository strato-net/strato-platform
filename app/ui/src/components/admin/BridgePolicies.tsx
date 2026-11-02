import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BridgePolicyField, BridgePolicyOverview } from '@strato/shared-types';
import { api } from '@/lib/axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import CopyButton from '@/components/ui/copy';
import { getChainName } from '@/lib/bridge/utils';
import { formatUnits, truncateAddress } from '@/utils/numberUtils';
import { AlertCircle, ChevronDown, Loader2, RefreshCw } from 'lucide-react';

const fieldValue = (field: BridgePolicyField) => {
  if (field.value === null) return 'Unavailable';
  if (field.kind === 'timestamp') return field.value === '0' ? 'Not recorded' : new Date(Number(field.value) * 1000).toLocaleString();
  if (field.kind !== 'amount') return field.value;
  const raw = `${field.value} raw units${field.unit ? ` (${field.unit})` : ''}`;
  if (field.decimals === undefined) return raw;
  try { return `${formatUnits(field.value, field.decimals)}${field.unit ? ` ${field.unit}` : ''}`; }
  catch { return raw; }
};

const BridgePolicies = () => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const policies = useQuery({
    queryKey: ['admin-bridge-policies'],
    queryFn: async () => (await api.get<BridgePolicyOverview>('/bridge/admin/policies')).data,
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });
  const query = search.trim().toLowerCase();
  const items = policies.data?.items.filter(item => [item.symbol, item.token, item.externalToken, item.externalSymbol,
    item.chainId, item.chainId ? getChainName(Number(item.chainId)) : '', item.source, item.kind].some(value => value?.toLowerCase().includes(query)));
  return <Card>
    <Collapsible open={open} onOpenChange={setOpen}>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-3">
        <CardTitle className="min-w-0 flex-1 text-sm">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-full justify-start px-2">
              <span>Policies &amp; Limits</span>
              {policies.isLoading && <Loader2 className="animate-spin" aria-label="Loading policies" />}
              {policies.isError && <AlertCircle className="text-destructive" aria-label="Policies unavailable" />}
              <ChevronDown className="ml-auto group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
        </CardTitle>
        {open && <Button variant="outline" size="sm" aria-label="Refresh policies" onClick={() => policies.refetch()} disabled={policies.isFetching}>
          <RefreshCw className={`h-4 w-4 ${policies.isFetching ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Refresh</span>
        </Button>}
      </CardHeader>
      <CollapsibleContent asChild>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Read-only STRATO settings indexed by Cirrus. Mint capacity is recorded at the last refill; it does not include subsequent refill accrual. External-vault limits, liquidity, and verifier-local policies are not included. Enabled settings do not guarantee a transfer can proceed.</p>
          <Input aria-label="Search bridge policies" placeholder="Search token, address, network, or bridge…" value={search} onChange={event => setSearch(event.target.value)} />
          {policies.data && <p className="text-xs text-muted-foreground">Fetched {new Date(policies.data.fetchedAt).toLocaleString()} · Refreshes every 30 seconds while open. Cirrus indexing may lag chain state.</p>}
          {policies.isError && <p role="alert" className="text-sm text-destructive">Indexed bridge policies are unavailable{policies.data ? '; displayed values may be stale' : ''}. Refresh after the STRATO connection recovers.</p>}
          {policies.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading policies…</p>}
          {policies.data?.unconfigured.map(source => <p key={source} className="text-sm text-muted-foreground">{source === 'eab' ? 'EAB' : 'Native bridge'} is not configured for this app.</p>)}
          {!policies.isLoading && !policies.isError && items?.length === 0 && <p className="text-sm text-muted-foreground">{query ? 'No policies match this search.' : 'No token policies or routes are indexed.'}</p>}
          {items?.map(item => <details key={item.id} className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {item.symbol || truncateAddress(item.token)} · {item.source === 'eab' ? 'EAB' : 'Native bridge'} · {item.kind}
              {item.chainId ? ` · ${getChainName(Number(item.chainId))} (${item.chainId})${item.externalSymbol ? ` · ${item.externalSymbol}` : ''}` : ' · All routes'}
            </summary>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">STRATO token: {truncateAddress(item.token)}<CopyButton address={item.token} /></span>
              {item.externalToken && <span className="inline-flex items-center gap-2">External token: {truncateAddress(item.externalToken)}<CopyButton address={item.externalToken} /></span>}
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {item.fields.map(field => <div key={field.label}><dt className="text-muted-foreground">{field.label}</dt><dd className={`break-words font-medium ${field.value === null ? 'text-destructive' : ''}`}>{fieldValue(field)}</dd></div>)}
            </dl>
          </details>)}
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  </Card>;
};

export default BridgePolicies;
