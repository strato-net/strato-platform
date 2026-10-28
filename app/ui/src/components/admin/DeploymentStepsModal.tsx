import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import CopyButton from '../ui/copy';
import {
  missingValue,
  stepStatus,
  voteArgs,
  votesNeeded,
  type Deployment,
  type DeploymentStep,
  type Network,
  type RegistryState,
} from './deployments';

const errorMessage = (error: unknown): string => {
  const failure = error as { response?: { data?: { error?: { message?: string } | string } }; message?: string } | null;
  const nested = failure?.response?.data?.error;
  return (typeof nested === 'object' ? nested?.message : nested) || failure?.message || 'Request failed';
};

const Marker = ({ index, state }: { index: number; state: 'done' | 'current' | 'todo' }) => (
  <div
    aria-hidden
    className={[
      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
      state === 'done' ? 'border-primary bg-primary text-primary-foreground' : state === 'current' ? 'border-primary text-primary' : 'border-border text-muted-foreground',
    ].join(' ')}
  >
    {state === 'done' ? <Check className="h-3.5 w-3.5" /> : index}
  </div>
);

// A value the step filled in, shown read-only.
const ValueRow = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
  <div className="flex items-center gap-x-3 rounded-md border border-border px-3 py-1.5 text-sm">
    <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
    <span className={`min-w-0 flex-1 truncate text-xs ${mono ? 'font-mono' : ''}`}>{value}</span>
    {mono && value.length >= 40 && <CopyButton address={value} />}
  </div>
);

interface DeploymentStepsModalProps {
  deployment: Deployment | null;
  network: Network;
  state: RegistryState;
  onOpenChange: (open: boolean) => void;
  // Called after every approval so the caller can refetch the registry.
  onApproved: () => Promise<void>;
}

const DeploymentStepsModal = ({ deployment, network, state, onOpenChange, onApproved }: DeploymentStepsModalProps) => {
  const { toast } = useToast();
  const { userAddress, castVoteOnIssue, castVoteOnIssueById } = useUser();
  const [busy, setBusy] = useState<number | null>(null);

  if (!deployment) return null;
  const steps = deployment.steps(network);
  const statuses = steps.map((step) => stepStatus(step, state, userAddress));
  const currentIndex = steps.findIndex((step, i) => step.kind !== 'manual' && !statuses[i].executed);

  const approve = async (index: number, step: DeploymentStep) => {
    if (step.kind === 'manual') return;
    setBusy(index);
    try {
      const openIssue = statuses[index].openIssue;
      if (step.kind === 'vote') await castVoteOnIssue(`0x${step.target}`, step.func, voteArgs(step));
      else if (openIssue) await castVoteOnIssueById(openIssue.issueId);
      toast({ title: 'Approved', description: step.title });
      await onApproved();
    } catch (error) {
      toast({ title: 'Approval failed', description: errorMessage(error), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => busy === null && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{deployment.title}</DialogTitle>
          <DialogDescription>
            {deployment.description} Every value is filled in; each approval is your vote on that issue, and it executes once enough admins have approved.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-6 overflow-y-auto flex-1 py-2">
          {steps.map((step, index) => {
            const { executed, openIssue, votesCast, voted } = statuses[index];
            const state_ = executed ? 'done' : index === currentIndex ? 'current' : 'todo';
            const missing = missingValue(step);

            return (
              <li key={step.title} className="flex gap-3">
                <Marker index={index + 1} state={state_} />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className={`text-sm font-medium ${state_ === 'todo' ? 'text-muted-foreground' : ''}`}>{step.title}</p>
                  <p className="text-sm text-muted-foreground">{step.why}</p>

                  {step.kind === 'vote' && (
                    <div className="space-y-1">
                      <ValueRow label={step.targetName} value={step.target} />
                      <ValueRow label="function" value={step.func} />
                      {step.args.map((arg) => (
                        <ValueRow key={arg.label} label={arg.label} value={arg.value ?? `waiting on ${arg.label}`} mono={arg.value !== null} />
                      ))}
                    </div>
                  )}
                  {step.kind === 'create' && (
                    <div className="space-y-1">
                      <ValueRow label="contract" value={step.contractName} />
                      <ValueRow label="raised by" value={step.command} />
                    </div>
                  )}
                  {step.kind === 'manual' && <ValueRow label="run as the deployer" value={step.command} />}

                  {step.kind !== 'manual' && (
                    <div className="flex items-center gap-3">
                      {executed ? (
                        <span className="text-xs text-muted-foreground">Executed</span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => approve(index, step)}
                            disabled={busy !== null || voted || missing !== null || (step.kind === 'create' && !openIssue)}
                            className="bg-strato-blue hover:bg-strato-blue/90"
                          >
                            {busy === index ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {voted ? 'You approved' : 'Approve'}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {missing
                              ? `Waiting on ${missing}`
                              : openIssue
                                ? `${votesCast} of ${votesNeeded(state, openIssue)} approvals`
                                : step.kind === 'create'
                                  ? 'Waiting for the deploy script to raise the issue'
                                  : 'Not raised yet; your approval raises it'}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </DialogContent>
    </Dialog>
  );
};

export default DeploymentStepsModal;
