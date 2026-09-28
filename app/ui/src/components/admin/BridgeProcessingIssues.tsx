import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BridgeProcessingIssuesPage } from '@strato/shared-types';
import { api } from '@/lib/axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import CopyButton from '@/components/ui/copy';
import { getChainName } from '@/lib/bridge/utils';
import { truncateAddress } from '@/utils/numberUtils';
import { AlertCircle, ChevronDown, Loader2, RefreshCw } from 'lucide-react';

const date = (timestamp: number) => new Date(timestamp).toLocaleString();

const BridgeProcessingIssues = () => {
  const [state, setState] = useState<'active' | 'cleared'>('active');
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const issues = useQuery({
    queryKey: ['admin-bridge-processing-issues', state, offset],
    queryFn: async () => (await api.get<BridgeProcessingIssuesPage>('/bridge/admin/processing-issues', { params: { state, offset, limit } })).data,
    refetchInterval: 30_000,
  });
  return <Card>
    <Collapsible>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-3">
        <CardTitle className="min-w-0 flex-1 text-sm">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-full justify-start px-2">
              <span>Processing issues{state === 'cleared' ? ' · Cleared' : ''} ·</span>
              <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center tabular-nums" aria-live="polite">
                {issues.isLoading ? <><Loader2 className="animate-spin" /><span className="sr-only">Loading processing issues</span></>
                  : issues.isError ? <><AlertCircle className="text-destructive" /><span className="sr-only">Processing issues unavailable</span></>
                  : issues.data?.total ?? '—'}
              </span>
              <ChevronDown className="ml-auto group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
        </CardTitle>
        <Button variant="outline" size="sm" aria-label="Refresh processing issues" onClick={() => issues.refetch()} disabled={issues.isFetching}>
          <RefreshCw className={`h-4 w-4 ${issues.isFetching ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Refresh</span>
        </Button>
      </CardHeader>
      <CollapsibleContent asChild>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Recorded blockers from the EAB service, including native transfers. Limits and balances reflect the last attempt. A cleared blocker does not necessarily mean the transfer completed.</p>
          <div className="flex flex-wrap items-center gap-2">
            {(['active', 'cleared'] as const).map(value => <Button key={value} size="sm" variant={state === value ? 'default' : 'outline'} aria-pressed={state === value} onClick={() => { setState(value); setOffset(0); }}>{value === 'active' ? 'Active' : 'Cleared'}</Button>)}
            {issues.data && <span className="text-xs text-muted-foreground">Fetched {date(issues.data.fetchedAt)}</span>}
          </div>
          {issues.isError && <p role="alert" className="text-sm text-destructive">Processing records are unavailable{issues.data ? '; displayed records may be stale' : ''}. Governance reviews and transaction history remain available.</p>}
          {issues.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading processing issues…</p>}
          {!issues.isLoading && !issues.isError && issues.data?.total === 0 && <p className="text-sm text-muted-foreground">No {state} processing issues recorded.</p>}
          {issues.data?.items.map(record => <div key={record.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="break-all font-medium">{record.context.stage.replace(/-/g, ' ')} · #{record.context.reference}</h3>
              <span className="text-sm text-muted-foreground">{record.context.source === 'eab' ? 'EAB' : 'Native bridge'} · {getChainName(Number(record.context.chainId))} ({record.context.chainId})</span>
            </div>
            {record.resolvedAt && <p className="text-sm font-medium text-green-700 dark:text-green-400">{record.outcome === 'completed' ? 'Transfer completed' : 'Blocker cleared · processing resumed'} · {date(record.resolvedAt)}</p>}
            {record.issues.map((issue, index) => <div key={`${issue.code}:${index}`} className="space-y-1">
              <p className={`text-sm font-medium ${record.resolvedAt ? '' : 'text-destructive'}`}>{issue.message}</p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{issue.code} · View recorded details</summary>
                <dl className="mt-2 grid gap-1 break-all">{Object.entries(issue.details).map(([key, value]) => <div key={key}><dt className="inline font-medium">{key}: </dt><dd className="inline">{value}</dd></div>)}</dl>
                <p className="mt-1">Amounts use the recorded units; unlabelled integer amounts are raw token units.</p>
              </details>
            </div>)}
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {record.context.account && <span className="inline-flex items-center gap-2">Account: {truncateAddress(record.context.account)}<CopyButton address={record.context.account} /></span>}
              {record.context.token && <span className="inline-flex items-center gap-2">Token: {truncateAddress(record.context.token)}<CopyButton address={record.context.token} /></span>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>First seen: {date(record.firstSeenAt)}</span><span>Last failed attempt: {date(record.lastSeenAt)}</span><span>Failed attempts: {record.attempts}</span>
              {!record.resolvedAt && <span>Next retry eligible: {date(record.nextRetryAt)}</span>}
            </div>
          </div>)}
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" disabled={offset === 0 || issues.isFetching} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
            <span className="text-xs text-muted-foreground">Page {Math.floor(offset / limit) + 1}</span>
            <Button size="sm" variant="outline" disabled={issues.isError || issues.isFetching || !issues.data || offset + limit >= issues.data.total} onClick={() => setOffset(offset + limit)}>Next</Button>
          </div>
        </CardContent>
      </CollapsibleContent>
    </Collapsible>
  </Card>;
};

export default BridgeProcessingIssues;
