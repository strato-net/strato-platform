import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WithdrawalCancellationStatus } from '@strato/shared-types';
import { api, extractApiErrorMessage } from '@/lib/axios';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTokenContext } from '@/context/TokenContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { useUser } from '@/context/UserContext';

export default function WithdrawalCancellation({ source, withdrawalId, onCanceled }: {
  source: 'external' | 'native'; withdrawalId: string; onCanceled: () => void;
}) {
  const queryClient = useQueryClient();
  const submissionPending = useRef(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { userAddress } = useUser();
  const { fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const request = { source, withdrawalId };
  const queryKey = ['withdrawal-cancellation', userAddress, source, withdrawalId];
  const submittedKey = [...queryKey, 'submitted'];
  const submitted = useQuery({ queryKey: submittedKey, queryFn: () => false, enabled: false, gcTime: Infinity });
  const status = useQuery({
    queryKey,
    queryFn: async () => (await api.get<WithdrawalCancellationStatus>('/bridge/withdrawalCancellation', { params: request })).data,
    enabled: !!userAddress && submitted.data !== true, staleTime: 0, refetchInterval: 10_000,
  });
  const submit = async () => {
    if (submissionPending.current || queryClient.getQueryData(submittedKey) || status.isFetching || !status.data?.eligible || status.isError) return;
    submissionPending.current = true;
    setSubmitting(true); setError('');
    try {
      await api.post('/bridge/withdrawalCancellation', request);
      queryClient.setQueryData(submittedKey, true);
      queryClient.setQueryData<WithdrawalCancellationStatus>(queryKey, current => current ? { ...current, eligible: false } : current);
      void queryClient.invalidateQueries({ queryKey, exact: true });
      setOpen(false); onCanceled();
    } catch (e) { setError(extractApiErrorMessage(e) || 'Cancellation failed. Refresh the withdrawal status before trying again.'); }
    finally { submissionPending.current = false; setSubmitting(false); void fetchUsdstBalance(); void fetchTokens(); }
  };
  const cancellationAvailable = status.isFetchedAfterMount && !status.isFetching && !status.isError && status.data?.eligible;
  return <>
    {(submitted.data === true || cancellationAvailable) &&
      <Button variant="outline" size="sm" disabled={submitting || submitted.data === true} onClick={() => { setError(''); setOpen(true); }}>{submitted.data ? 'Cancellation submitted' : status.data?.requestOnly ? 'Request cancellation' : 'Cancel withdrawal'}</Button>}
    <Dialog open={open} onOpenChange={value => { if (!submitting) setOpen(value); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cancel withdrawal #{withdrawalId}</DialogTitle><DialogDescription>
          Cancellation returns escrow to the original STRATO account. An external payment that has already started cannot be canceled here.
        </DialogDescription></DialogHeader>
        <p className="text-sm">{submitted.data ? 'Cancellation submitted. Waiting for the withdrawal status to update.' : status.isFetching ? 'Checking cancellation availability…' : status.data?.message}</p>
        {status.data && !status.data.eligible && Number(status.data.availableAt) * 1000 > Date.now() &&
          <p className="text-sm">Available after {new Date(Number(status.data.availableAt) * 1000).toLocaleString()}</p>}
        {(error || status.isError) && <p role="alert" className="text-sm text-destructive">{error || 'Cancellation status is unavailable. Please try again.'}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={submitting} onClick={() => setOpen(false)}>Close</Button>
          <Button disabled={submitting || submitted.data === true || status.isFetching || status.isError || !status.data?.eligible} onClick={submit}>{submitting ? 'Canceling…' : status.data?.requestOnly ? 'Request cancellation' : 'Confirm cancellation'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
