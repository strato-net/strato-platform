import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BridgeReviewItem, BridgeReviewVote } from '@strato/shared-types';
import { api } from '@/lib/axios';
import { useUser } from '@/context/UserContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CopyButton from '@/components/ui/copy';
import { getChainName } from '@/lib/bridge/utils';
import { truncateAddress } from '@/utils/numberUtils';
import { Loader2, RefreshCw } from 'lucide-react';

const actionLabels = { approve: 'Approve deposit / vote', reject: 'Reject / vote', refund: 'Prepare refund / vote', settle: 'Settle approved deposit' };

const BridgeReviewQueue = () => {
  const { castVoteOnIssue } = useUser();
  const [selected, setSelected] = useState<{ item: BridgeReviewItem; action: BridgeReviewItem['actions'][number] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const reviews = useQuery({
    queryKey: ['admin-bridge-reviews'],
    queryFn: async () => (await api.get<BridgeReviewItem[]>('/bridge/admin/reviews')).data,
    refetchInterval: 30_000,
  });
  const submit = async () => {
    if (!selected) return;
    setSubmitting(true); setError(''); setMessage('');
    try {
      const { data } = await api.post<BridgeReviewVote | { transactionHash: string }>('/bridge/admin/reviews/prepare', {
        id: selected.item.id, action: selected.action,
      });
      if ('transactionHash' in data) {
        setMessage('Deposit settlement submitted. Refresh the transaction history for its outcome.');
      } else {
        await castVoteOnIssue(data.target, data.func, data.args);
        setMessage('Governance vote submitted. The required approvals must complete before the action executes.');
      }
      setSelected(null);
      await reviews.refetch();
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Unable to complete this review action.');
    } finally { setSubmitting(false); }
  };
  return <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-3">
      <div><CardTitle>Action Required</CardTitle><p className="text-sm text-muted-foreground mt-2">Deposit reviews, withdrawals pending review, and refunds. Safe approvals are handled in Safe.</p></div>
      <Button variant="outline" size="sm" onClick={() => reviews.refetch()} disabled={reviews.isFetching}>
        <RefreshCw className={`h-4 w-4 mr-2 ${reviews.isFetching ? 'animate-spin' : ''}`} />Refresh
      </Button>
    </CardHeader>
    <CardContent className="space-y-4">
      {message && <p role="status" className="text-sm text-green-700 dark:text-green-400">{message}</p>}
      {reviews.isError && <p role="alert" className="text-sm text-destructive">The review queue is unavailable. Check the STRATO connection; this does not mean there are no pending reviews.</p>}
      {reviews.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : !reviews.isError && !reviews.data?.length ? <p className="text-sm text-muted-foreground">No transactions currently require review.</p> : null}
      {reviews.data?.map(item => <div key={item.id} className="border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="font-medium">{item.kind === 'withdrawal_refund' ? 'Withdrawal refund review' : item.kind === 'deposit_review' ? 'Deposit review' : 'Withdrawal pending review'} #{item.reference}</h3>
          <span className="text-sm text-muted-foreground">{item.source === 'eab' ? 'EAB' : item.source === 'native' ? 'Native bridge' : 'Legacy bridge'} · {getChainName(Number(item.chainId))} ({item.chainId})</span>
        </div>
        <p className="text-sm">{item.reason}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">Account: {truncateAddress(item.account)}<CopyButton address={item.account} /></span>
          <span className="inline-flex items-center gap-2">Token: {truncateAddress(item.token)}<CopyButton address={item.token} /></span>
          <span>Amount (raw units): {item.amount}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.kind === 'withdrawal_review' && <span className="text-sm text-muted-foreground">Approval handled in Safe</span>}
          {item.safeProposalHash && <span className="inline-flex items-center gap-2 text-sm">Proposal: {truncateAddress(item.safeProposalHash)}<CopyButton address={item.safeProposalHash} /></span>}
          {item.actions.map(action => <Button key={action} variant={action === 'reject' ? 'destructive' : 'outline'} size="sm" onClick={() => { setError(''); setSelected({ item, action }); }}>{actionLabels[action]}</Button>)}
        </div>
      </div>)}
    </CardContent>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !submitting) setSelected(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{selected && actionLabels[selected.action]}</DialogTitle><DialogDescription>
          {selected?.action === 'reject' ? 'Rejecting marks this deposit canceled on STRATO. It does not refund external funds. Confirm the recovery plan before voting.'
            : selected?.action === 'refund' ? 'Verifiers must confirm external non-payment before your STRATO governance vote is submitted. A refund executes only after the required governance approvals.'
            : selected?.action === 'settle' ? 'Re-verify custody and collect verifier attestations, then settle the deposit. On-chain governance approval is required first. Routing may use the authorized fallback.'
            : 'Vote to authorize this recorded deposit. Settlement still requires valid custody evidence and verifier attestations. After approval, use Settle approved deposit.'}
        </DialogDescription></DialogHeader>
        {selected && <p className="text-sm break-all">Reference: {selected.item.id}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={submitting} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={submitting} onClick={submit}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{selected?.action === 'settle' ? 'Confirm settlement' : 'Confirm vote'}</Button></div>
      </DialogContent>
    </Dialog>
  </Card>;
};

export default BridgeReviewQueue;
