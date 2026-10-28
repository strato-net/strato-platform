import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { useNetwork } from '@/context/NetworkContext';
import { api } from '@/lib/axios';
import CopyButton from '../ui/copy';
import { issueForStep, launchSteps, missingValue, normalizeArg, voteArgs, type LaunchStep, type RegistryIssue } from './launchSteps';

type OpenIssues = {
  issues: RegistryIssue[];
  votes: Array<{ issueId: string; voter: string }>;
  admins: Array<{ address: string }>;
  globalThreshold: number;
  thresholds: Array<{ target: string; func: string; threshold: number }>;
};

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

const LaunchChecklistTab = () => {
  const { toast } = useToast();
  const { userAddress, castVoteOnIssue, castVoteOnIssueById } = useUser();
  const { isTestnet } = useNetwork();
  const steps = launchSteps(isTestnet ? 'helium' : 'upquark');

  const [open, setOpen] = useState<OpenIssues | null>(null);
  const [executed, setExecuted] = useState<RegistryIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, executedRes] = await Promise.all([
        api.get('/user/admin/issues', { params: { page: 1, limit: 100 } }),
        api.get('/user/admin/issues/executed', { params: { page: 1, limit: 200 } }),
      ]);
      setOpen(openRes.data);
      setExecuted(executedRes.data?.executed || []);
    } catch (error) {
      toast({ title: 'Could not load issues', description: errorMessage(error), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const votesNeeded = (issue: RegistryIssue): number => {
    if (!open) return 0;
    const own = open.thresholds.find((t) => normalizeArg(t.target) === normalizeArg(issue.target) && t.func === issue.func)?.threshold;
    return Math.ceil((open.admins.length * (own || open.globalThreshold)) / 10000);
  };

  const approve = async (index: number, step: LaunchStep, openIssue?: RegistryIssue) => {
    if (step.kind === 'manual') return;
    setBusy(index);
    try {
      if (step.kind === 'vote') await castVoteOnIssue(`0x${step.target}`, step.func, voteArgs(step));
      else if (openIssue) await castVoteOnIssueById(openIssue.issueId);
      toast({ title: 'Approved', description: step.title });
      await load();
    } catch (error) {
      toast({ title: 'Approval failed', description: errorMessage(error), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const done = steps.map((step) => step.kind === 'manual' || Boolean(issueForStep(step, executed)));
  const currentIndex = done.findIndex((d) => !d);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>STRATO as gas: launch checklist</CardTitle>
          <CardDescription>
            Every value is filled in. Each approval is your vote on that AdminRegistry issue; it executes once enough admins have approved.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="space-y-6">
          {steps.map((step, index) => {
            const state = done[index] && step.kind !== 'manual' ? 'done' : index === currentIndex ? 'current' : 'todo';
            const openIssue = open ? issueForStep(step, open.issues) : undefined;
            const votesCast = openIssue ? open!.votes.filter((v) => v.issueId === openIssue.issueId).length : 0;
            const voted = Boolean(openIssue && open!.votes.some((v) => v.issueId === openIssue.issueId && normalizeArg(v.voter) === normalizeArg(userAddress)));
            const missing = missingValue(step);

            return (
              <li key={step.title} className="flex gap-3">
                <Marker index={index + 1} state={state} />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className={`text-sm font-medium ${state === 'todo' ? 'text-muted-foreground' : ''}`}>{step.title}</p>
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
                      {state === 'done' ? (
                        <span className="text-xs text-muted-foreground">Executed</span>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            onClick={() => approve(index, step, openIssue)}
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
                                ? `${votesCast} of ${votesNeeded(openIssue)} approvals`
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
      </CardContent>
    </Card>
  );
};

export default LaunchChecklistTab;
