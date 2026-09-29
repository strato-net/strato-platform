import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BridgeReviewGovernanceAction, BridgeReviewItem, BridgeReviewVote } from '@strato/shared-types';
import { api, extractApiErrorMessage } from '@/lib/axios';
import { useUser } from '@/context/UserContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import CopyButton from '@/components/ui/copy';
import { getChainName } from '@/lib/bridge/utils';
import { truncateAddress } from '@/utils/numberUtils';
import { AlertCircle, ChevronDown, Loader2, RefreshCw } from 'lucide-react';

const actionLabels = { approve: 'Approve deposit / vote', reject: 'Reject / vote', refund: 'Refund / vote' };

const BridgeReviewQueue = () => {
  const { castVoteOnIssue, userAddress } = useUser();
  const [submittedVotes, setSubmittedVotes] = useState<Record<string, number>>({});
  const voteKey = (item: BridgeReviewItem, action: string) => `${userAddress}:${item.id}:${action}`;
  const [selected, setSelected] = useState<{ item: BridgeReviewItem; action: BridgeReviewGovernanceAction } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const reviews = useQuery({
    queryKey: ['admin-bridge-reviews', userAddress],
    queryFn: async () => (await api.get<BridgeReviewItem[]>('/bridge/admin/reviews')).data,
    refetchInterval: 30_000,
  });
  const submit = async () => {
    if (!selected) return;
    setSubmitting(true); setError(''); setMessage('');
    try {
      const { data } = await api.post<BridgeReviewVote>('/bridge/admin/reviews/prepare', {
        id: selected.item.id, action: selected.action,
      });
      await castVoteOnIssue(data.target, data.func, data.args);
      setSubmittedVotes(previous => ({ ...previous, [voteKey(selected.item, selected.action)]: Date.now() }));
      setMessage('Vote submitted. Waiting for indexed governance status; settlement is a separate stage.');
      setSelected(null);
      await reviews.refetch();
    } catch (e: unknown) {
      setError(extractApiErrorMessage(e));
    } finally { setSubmitting(false); }
  };
  return <Card>
    <Collapsible>
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-3">
      <CardTitle className="min-w-0 flex-1 text-sm">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group w-full justify-start px-2">
            <span>Action Required ·</span>
            <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center tabular-nums" aria-live="polite">
              {reviews.isLoading ? <><Loader2 className="animate-spin" /><span className="sr-only">Loading review count</span></>
                : reviews.isError ? <><AlertCircle className="text-destructive" /><span className="sr-only">Review queue unavailable</span></>
                : reviews.data?.length ?? '—'}
            </span>
            <ChevronDown className="ml-auto group-data-[state=open]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
      </CardTitle>
      <Button variant="outline" size="sm" aria-label="Refresh review queue" onClick={() => reviews.refetch()} disabled={reviews.isFetching}>
        <RefreshCw className={`h-4 w-4 ${reviews.isFetching ? 'animate-spin' : ''}`} /><span className="hidden sm:inline">Refresh</span>
      </Button>
    </CardHeader>
    <CollapsibleContent asChild>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Deposit reviews, withdrawals pending review, and refunds. Safe approvals are handled in Safe.</p>
      {message && <p role="status" className="text-sm text-green-700 dark:text-green-400">{message}</p>}
      {reviews.isError && <p role="alert" className="text-sm text-destructive">The review queue is unavailable. Check the STRATO connection; this does not mean there are no pending reviews.</p>}
      {reviews.isLoading ? <div role="status" className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading review items…</div> : !reviews.isError && !reviews.data?.length ? <p className="text-sm text-muted-foreground">No transactions currently require review.</p> : null}
      {reviews.data?.map(item => <div key={item.id} className="border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="font-medium">{item.kind === 'withdrawal_refund' ? 'Withdrawal refund review' : item.kind === 'deposit_review' ? 'Deposit review' : 'Withdrawal pending review'} #{item.reference}</h3>
          <span className="text-sm text-muted-foreground">{item.source === 'eab' ? 'EAB' : item.source === 'native' ? 'Native bridge' : 'Legacy bridge'} · {getChainName(Number(item.chainId))} ({item.chainId})</span>
        </div>
        {item.approvalStatus === 'approved' && <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">Approved · awaiting settlement</p>}
        {item.approvalStatus === 'unavailable' && <p role="alert" className="text-sm text-destructive">Deposit approval status is unavailable.</p>}
        {item.actions.some(action => action !== 'settle') && item.governanceStatus !== 'available' && <p role="alert" className="text-sm text-destructive">Voting status is unavailable. Refresh before voting.</p>}
        <p className="text-sm">{item.reason}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">Account: {truncateAddress(item.account)}<CopyButton address={item.account} /></span>
          <span className="inline-flex items-center gap-2">Token: {truncateAddress(item.token)}<CopyButton address={item.token} /></span>
          <span>Amount (raw units): {item.amount}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {item.kind === 'withdrawal_review' && <span className="text-sm text-muted-foreground">Approval handled in Safe</span>}
          {item.safeProposalHash && <span className="inline-flex items-center gap-2 text-sm">Proposal: {truncateAddress(item.safeProposalHash)}<CopyButton address={item.safeProposalHash} /></span>}
          {item.actions.filter((action): action is BridgeReviewGovernanceAction => action !== 'settle' && (action !== 'approve' || item.approvalStatus !== 'approved')).map(action => {
            const progress = item.governance?.[action];
            const quorum = progress && progress.votesCast >= progress.votesRequired;
            const pending = !progress?.hasVoted && Date.now() - (submittedVotes[voteKey(item, action)] ?? 0) < 60_000;
            const disabled = submitting || reviews.isError || !progress || item.governanceStatus !== 'available' || pending ||
              (progress?.hasVoted && !quorum) || (action === 'refund' && item.refundStatus !== 'ready');
            return <div key={action} className="space-y-1">
              <Button variant={action === 'reject' ? 'destructive' : 'outline'} size="sm" disabled={!!disabled} onClick={() => { setError(''); setSelected({ item, action }); }}>
                {pending ? 'Vote submitted' : quorum ? `Execute ${action === 'approve' ? 'approval' : action === 'reject' ? 'rejection' : 'refund'}` : progress?.hasVoted ? 'You voted' : actionLabels[action]}
              </Button>
              {progress && <p className="text-xs text-muted-foreground">{action === 'approve' ? 'Approval' : action === 'reject' ? 'Rejection' : 'Refund'}: {progress.votesCast} of {progress.votesRequired} votes{progress.hasVoted ? ' · You voted' : ''}{quorum ? ' · Quorum reached; execution pending' : ' · Awaiting votes'}</p>}
              {pending && <p role="status" className="text-xs text-muted-foreground">Waiting for indexed status…</p>}
            </div>;
          })}
          {item.kind === 'withdrawal_refund' && item.refundStatus === 'pending' && <p role="status" className="text-sm text-muted-foreground">Awaiting verifier attestations. The bridge prepares refund evidence automatically.</p>}
          {item.kind === 'withdrawal_refund' && (!item.refundStatus || item.refundStatus === 'unavailable') && <p role="alert" className="text-sm text-destructive">Refund attestation status is unavailable. Refresh before voting.</p>}
        </div>
      </div>)}
    </CardContent>
    </CollapsibleContent>
    </Collapsible>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !submitting) setSelected(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{selected && actionLabels[selected.action]}</DialogTitle><DialogDescription>
          {selected?.action === 'reject' ? 'Rejecting marks this deposit canceled on STRATO. It does not refund external funds. Confirm the recovery plan before voting.'
            : selected?.action === 'refund' ? 'On-chain verifier attestations must confirm external non-payment. A refund executes only after the required governance approvals.'
            : 'Vote to authorize this recorded deposit. Settlement still requires valid custody evidence and verifier attestations. After approval, the bridge automatically retries settlement.'}
        </DialogDescription></DialogHeader>
        {selected && <p className="text-sm break-all">Reference: {selected.item.id}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={submitting} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={submitting} onClick={submit}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Confirm vote</Button></div>
      </DialogContent>
    </Dialog>
  </Card>;
};

export default BridgeReviewQueue;
