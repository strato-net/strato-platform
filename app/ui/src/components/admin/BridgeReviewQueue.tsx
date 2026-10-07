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
import { getBridgeReviewNextStep, getChainName } from '@/lib/bridge/utils';
import { truncateAddress } from '@/utils/numberUtils';
import { AlertCircle, ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

const actionLabels = { approve: 'Approve deposit / vote', reject: 'Reject — no funds received / vote', refund: 'Refund / vote', confirm_refund: 'Confirm refund / vote', cancel_withdrawal: 'Request cancellation / vote', confirm_cancellation: 'Verify cancellation and refund / vote' };
const reviewActionLabel = (item: BridgeReviewItem, action: BridgeReviewGovernanceAction) =>
  action === 'refund' && item.kind !== 'withdrawal_refund' ? 'Reject and refund / vote'
    : action === 'approve' && item.kind === 'deposit_recovery' ? 'Complete delivery / vote' : actionLabels[action];

const DetailRow = ({ label, value, shorten = false, copy = false }: { label: string; value: string; shorten?: boolean; copy?: boolean }) =>
  <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
    <span className="shrink-0 text-muted-foreground">{label}</span>
    <span className="flex min-w-0 items-center gap-2 text-right">
      <span className="break-all">{shorten ? truncateAddress(value) : value}</span>
      {copy && <CopyButton address={value} />}
    </span>
  </div>;

const BridgeReviewQueue = () => {
  const { castVoteOnIssue, userAddress } = useUser();
  const [submittedVotes, setSubmittedVotes] = useState<Record<string, number>>({});
  const voteKey = (item: BridgeReviewItem, action: string) => `${userAddress}:${item.id}:${action}`;
  const isVotePending = (item: BridgeReviewItem, action: BridgeReviewGovernanceAction) =>
    !item.governance?.[action]?.hasVoted && Date.now() - (submittedVotes[voteKey(item, action)] ?? 0) < 60_000;
  const [selected, setSelected] = useState<{ item: BridgeReviewItem; action: BridgeReviewGovernanceAction } | null>(null);
  const [noFundsConfirmed, setNoFundsConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const reviews = useQuery({
    queryKey: ['admin-bridge-reviews', userAddress],
    queryFn: async () => (await api.get<BridgeReviewItem[]>('/bridge/admin/reviews')).data,
    refetchInterval: 30_000,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const submit = async () => {
    if (!selected || (selected.action === 'reject' && !noFundsConfirmed)) return;
    setSubmitting(true); setError(''); setMessage('');
    try {
      const { data } = await api.post<BridgeReviewVote>('/bridge/admin/reviews/prepare', {
        id: selected.item.id, action: selected.action,
      });
      if ((selected.action === 'confirm_refund' || selected.action === 'confirm_cancellation') && (data.func !== (selected.action === 'confirm_cancellation' ? 'refundCanceledWithdrawal' : 'finalizeDepositRefund') ||
          data.args[0] !== selected.item.reference || data.args[1]?.replace(/^0x/i, '').toLowerCase() !== selected.item.refundEvidenceHash?.replace(/^0x/i, '').toLowerCase())) {
        setError('Refund evidence changed. Refresh the queue and review the new transaction before voting.');
        return;
      }
      const vote = await castVoteOnIssue(data.target, data.func, data.args, true);
      if (vote.status !== 'Success' || !vote.governed || !vote.issueId) {
        throw new Error(vote.message || `Governance vote ${vote.hash || ''} was not recorded`);
      }
      setSubmittedVotes(previous => ({ ...previous, [voteKey(selected.item, selected.action)]: Date.now() }));
      setMessage(`Governance vote recorded · Issue ${vote.issueId} · Transaction ${vote.hash}. Refreshing the queue; the vote alone does not confirm that funds were delivered or returned.`);
      setSelected(null);
      await reviews.refetch();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : extractApiErrorMessage(e));
    } finally { setSubmitting(false); }
  };
  const actionsFor = (item: BridgeReviewItem) => item.actions.filter((action): action is BridgeReviewGovernanceAction =>
    Object.prototype.hasOwnProperty.call(actionLabels, action) && (action !== 'approve' || item.approvalStatus !== 'approved'));
  const isUnavailable = (item: BridgeReviewItem) => reviews.isError || item.approvalStatus === 'unavailable' ||
    (item.kind === 'withdrawal_refund' && !['pending', 'ready'].includes(item.refundStatus || '')) ||
    (item.actions.length > 0 && (item.governanceStatus !== 'available' || item.actions.some(action => !item.governance?.[action])));
  const nextStepFor = (item: BridgeReviewItem) =>
    getBridgeReviewNextStep(item, item.actions.some(action => isVotePending(item, action)));
  const isSafeAttention = (item: BridgeReviewItem) => nextStepFor(item).startsWith('Safe signers');
  const needsAdminAttention = (item: BridgeReviewItem) =>
    isUnavailable(item) || isSafeAttention(item) || nextStepFor(item).startsWith('STRATO admin');
  const attentionItems = reviews.data?.filter(needsAdminAttention) ?? [];
  const remainingItems = reviews.data?.filter(item => !attentionItems.includes(item)) ?? [];
  const automatedItems = remainingItems.filter(item => nextStepFor(item).startsWith('Bridge service'));
  const waitingItems = remainingItems.filter(item => !automatedItems.includes(item));
  const renderItems = (items: BridgeReviewItem[]) => items.map(item => {
        const deposit = item.kind === 'deposit_review' || item.kind === 'deposit_recovery';
        const unavailable = isUnavailable(item);
        return <div key={item.id} className="border rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <h3 className="font-medium">{item.scenario || (item.kind.startsWith('deposit') ? 'Deposit review' : 'Withdrawal review')} #{item.reference}</h3>
          <span className="text-sm text-muted-foreground">{item.source === 'eab' ? 'EAB' : item.source === 'native' ? 'Native bridge' : 'Legacy bridge'} · {getChainName(Number(item.chainId))} ({item.chainId})</span>
        </div>
        {item.approvalStatus === 'approved' && <p role="status" className="text-sm font-medium text-green-700 dark:text-green-400">Approved · awaiting settlement</p>}
        {item.recoveryStatus === 'refund_pending' && <p role="status" className="text-sm font-medium">{item.refundEvidenceHash ? 'Refund confirmation requires governance approval' : `Refund processing${item.safeProposalHash ? ' · Safe approval required' : ''}`}</p>}
        {item.approvalStatus === 'unavailable' && <p role="alert" className="text-sm text-destructive">Deposit approval status is unavailable.</p>}
        {item.actions.some(action => Object.prototype.hasOwnProperty.call(actionLabels, action)) && item.governanceStatus !== 'available' && <p role="alert" className="text-sm text-destructive">Voting status is unavailable. Refresh before voting.</p>}
        <p role={unavailable ? 'alert' : 'status'} className={`text-sm font-medium${unavailable ? ' text-destructive' : ''}`}>Next step: {reviews.isError ? 'Admin — refresh the queue. Displayed transaction and voting status may be stale.' : nextStepFor(item)}</p>
        <details className="rounded-md border bg-muted/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">Evidence and transaction details</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{deposit ? 'External evidence' : 'External destination'}</p>
              {item.externalTxHash && <DetailRow label="Source transaction" value={item.externalTxHash} shorten copy />}
              {item.refundEvidenceHash && <DetailRow label={item.kind === 'withdrawal_cancellation' ? 'Cancellation transaction' : 'Refund transaction'} value={item.refundEvidenceHash} shorten copy />}
              {item.safeProposalHash && <DetailRow label="Safe proposal" value={item.safeProposalHash} shorten copy />}
              {item.externalBridge && <DetailRow label="Bridge" value={item.externalBridge} shorten copy />}
              {item.externalAccount && <DetailRow label={deposit ? 'Sender' : 'Recipient'} value={item.externalAccount} shorten copy />}
              {item.externalToken && <DetailRow label="Token" value={item.externalToken} shorten copy />}
              {item.externalAmount && <DetailRow label="Amount (raw)" value={item.externalAmount} />}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{deposit ? 'STRATO delivery' : 'STRATO escrow'}</p>
              <DetailRow label={deposit ? 'Recipient' : 'Sender'} value={item.account} shorten copy />
              <DetailRow label="Token" value={item.token} shorten copy />
              <DetailRow label="Amount (raw)" value={item.amount} />
            </div>
          </div>
        </details>
        {isSafeAttention(item) && item.safeProposalHash && <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="https://app.safe.global/transactions/queue" target="_blank" rel="noreferrer">
              Open Safe queue <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            Proposal {truncateAddress(item.safeProposalHash)}<CopyButton address={item.safeProposalHash} />
          </span>
        </div>}
        <div className="flex flex-wrap gap-2">
          {!isSafeAttention(item) && actionsFor(item).map(action => {
            const progress = item.governance?.[action];
            const quorum = progress && progress.votesCast >= progress.votesRequired;
            const pending = isVotePending(item, action);
            const readinessUnavailable = reviews.isError || !progress || item.governanceStatus !== 'available' ||
              (action === 'refund' && item.kind === 'withdrawal_refund' && item.refundStatus !== 'ready');
            const disabled = submitting || readinessUnavailable || pending || (progress?.hasVoted && !quorum);
            const nextVoteStep = pending ? 'Awaiting STRATO indexing'
              : readinessUnavailable ? 'Voting unavailable until readiness is confirmed'
              : quorum ? 'Quorum reached; STRATO admin must execute'
              : progress.hasVoted ? 'Awaiting votes from other STRATO admins' : 'STRATO admins: remaining votes required';
            return <div key={action} className="space-y-1">
              <Button variant="outline" size="sm" disabled={!!disabled} onClick={() => { setError(''); setNoFundsConfirmed(false); setSelected({ item, action }); }}>
                {pending ? quorum ? 'Execution submitted' : 'Vote submitted' : quorum ? `Execute ${action === 'cancel_withdrawal' ? 'cancellation request' : action === 'confirm_cancellation' ? 'verified cancellation refund' : action === 'approve' ? 'approval' : action === 'reject' ? 'rejection' : action === 'confirm_refund' ? 'refund confirmation' : item.kind === 'withdrawal_refund' ? 'refund' : 'return decision'}` : progress?.hasVoted ? 'You voted' : reviewActionLabel(item, action)}
              </Button>
              {progress && <p className="text-xs text-muted-foreground">{action === 'cancel_withdrawal' ? 'Cancellation' : action === 'confirm_cancellation' ? 'Cancellation refund' : action === 'approve' ? 'Approval' : action === 'reject' ? 'Rejection' : action === 'confirm_refund' ? 'Refund confirmation' : 'Refund'}: {progress.votesCast} of {progress.votesRequired} votes{progress.hasVoted ? ' · You voted' : ''} · {nextVoteStep}</p>}
              {pending && <p role="status" className="text-xs text-muted-foreground">Waiting for indexed status…</p>}
            </div>;
          })}
        </div>
      </div>;
  });
  return <Card>
    <Collapsible defaultOpen>
    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 p-3">
      <CardTitle className="min-w-0 flex-1 text-sm">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group w-full justify-start px-2">
            <span>Action Required ·</span>
            <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center tabular-nums" aria-live="polite">
              {reviews.isLoading ? <><Loader2 className="animate-spin" /><span className="sr-only">Loading review count</span></>
                : reviews.isError ? <><AlertCircle className="text-destructive" /><span className="sr-only">Review queue unavailable</span></>
                : attentionItems.length}
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
      <p className="text-sm text-muted-foreground">Items requiring this administrator’s attention are shown first. Safe approvals are handled in Safe.</p>
      {message && <p role="status" className="text-sm text-green-700 dark:text-green-400">{message}</p>}
      {reviews.isError && <p role="alert" className="text-sm text-destructive">The review queue is unavailable. Check the STRATO connection; this does not mean there are no pending reviews.</p>}
      {reviews.isLoading ? <div role="status" className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading review items…</div> : !reviews.isError && !reviews.data?.length ? <p className="text-sm text-muted-foreground">No transactions currently require review.</p> : null}
      {!reviews.isLoading && !reviews.isError && reviews.data?.length && !attentionItems.length ? <p className="text-sm text-muted-foreground">No items currently require your action.</p> : null}
      {renderItems(attentionItems)}
      {!!waitingItems.length && <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Waiting on others · {waitingItems.length}</summary>
        <div className="mt-3 space-y-4">{renderItems(waitingItems)}</div>
      </details>}
      {!!automatedItems.length && <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Automated processing · {automatedItems.length}</summary>
        <div className="mt-3 space-y-4">{renderItems(automatedItems)}</div>
      </details>}
    </CardContent>
    </CollapsibleContent>
    </Collapsible>
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !submitting) setSelected(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{selected && reviewActionLabel(selected.item, selected.action)}</DialogTitle><DialogDescription>
          {selected?.action === 'cancel_withdrawal' ? 'This stops normal withdrawal processing and requests permanent cancellation of its mint identity on the external bridge. Safe signers must execute the cancellation. Escrow remains locked until STRATO governance verifies the confirmed cancellation. If minting has already succeeded, the withdrawal will complete instead.'
            : selected?.action === 'confirm_cancellation' ? 'Independently verify the successful NativeMintCanceled transaction on the destination bridge, its source STRATO chain, source bridge, withdrawal ID and required confirmations. The operator report alone is not proof. This vote returns STRATO escrow; never approve it if the external mint occurred.'
            : selected?.action === 'confirm_refund' ? 'Independently verify this transaction on the source network: successful execution, sufficient confirmations, the original bridge and redemption ID, representation token, sender and exact amount. The hash is an operator report, not independent proof. This vote marks the refund completed; it does not send funds.'
            : selected?.action === 'reject' ? 'Use this only after verifying that no external funds were received for this deposit (or no valid external burn occurred for a native redemption). This closes the record without crediting STRATO assets or issuing a refund. An unavailable RPC or missing index entry is not evidence that no funds were received.'
            : selected?.action === 'refund' ? selected.item.kind === 'withdrawal_refund'
              ? 'Verifier checks are complete. STRATO admin approval is now required to return the escrowed tokens to the user’s STRATO wallet. The contract rechecks verifier confirmation when the refund executes.'
              : 'This permanently disables STRATO delivery for this deposit. After governance approval, the bridge verifies the original deposit and returns the original asset to its sender on the source network. Native STRATO custody remains locked when external representations are restored. Completion requires a confirmed refund transaction.'
            : selected?.item.kind === 'deposit_recovery' ? 'Reopen this deposit for verified delivery on STRATO. This does not bypass custody checks, policy limits or verifier requirements. The original route and fallback protections still apply.'
            : 'Vote to authorize this recorded deposit. Settlement still requires valid custody evidence and verifier attestations. After approval, the bridge automatically retries settlement.'}
        </DialogDescription></DialogHeader>
        {(selected?.action === 'refund' || selected?.action === 'confirm_refund') && selected.item.kind !== 'withdrawal_refund' && <div className="space-y-2 text-sm">
          <p className="flex items-center gap-2">Return to: {truncateAddress(selected.item.refundRecipient || '')}<CopyButton address={selected.item.refundRecipient || ''} /></p>
          <p className="flex items-center gap-2">Original asset: {truncateAddress(selected.item.refundToken || '')}<CopyButton address={selected.item.refundToken || ''} /></p>
          <p>Amount (raw units): {selected.item.refundAmount}</p>
          {selected.action === 'confirm_refund' && <>
            <p className="flex items-center gap-2">External bridge: {truncateAddress(selected.item.refundBridge || '')}<CopyButton address={selected.item.refundBridge || ''} /></p>
            <p>Redemption ID: {selected.item.refundRedemptionId}</p>
          </>}
          {selected.item.source === 'eab' && <p className="text-muted-foreground">Verify that the refund vault received the original deposit, especially if custody has since migrated. This decision cannot be changed back to delivery.</p>}
        </div>}
        {selected?.action === 'reject' && <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={noFundsConfirmed} onChange={event => setNoFundsConfirmed(event.target.checked)} />
          I independently verified that no funds were received or valid native redemption burn occurred. No refund is due.
        </label>}
        {(selected?.action === 'confirm_refund' || selected?.action === 'confirm_cancellation') && <p className="text-sm break-all">External transaction to verify: {selected.item.refundEvidenceHash}</p>}
        {selected && <p className="text-sm break-all">Reference: {selected.item.id}</p>}
        {selected?.action === 'refund' && selected.item.refundVault && <p className="text-sm break-all">External custody vault: {selected.item.refundVault}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={submitting} onClick={() => setSelected(null)}>Cancel</Button><Button disabled={submitting || (selected?.action === 'reject' && !noFundsConfirmed)} onClick={submit}>{submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Confirm vote</Button></div>
      </DialogContent>
    </Dialog>
  </Card>;
};

export default BridgeReviewQueue;
