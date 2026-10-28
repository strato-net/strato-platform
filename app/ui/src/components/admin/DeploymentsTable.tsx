import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { useNetwork } from '@/context/NetworkContext';
import { api } from '@/lib/axios';
import DeploymentStepsModal from './DeploymentStepsModal';
import { DEPLOYMENTS, stepStatus, type Deployment, type RegistryState } from './deployments';

// Every deployment an admin may have to approve, with how far along it is and whether this
// admin still owes approvals. Clicking a row opens the step-by-step list.
const DeploymentsTable = () => {
  const { toast } = useToast();
  const { userAddress } = useUser();
  const { isTestnet } = useNetwork();
  const network = isTestnet ? 'helium' : 'upquark';

  const [state, setState] = useState<RegistryState | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Deployment | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [open, executed] = await Promise.all([
        api.get('/user/admin/issues', { params: { page: 1, limit: 100 } }),
        api.get('/user/admin/issues/executed', { params: { page: 1, limit: 200 } }),
      ]);
      setState({ ...open.data, executed: executed.data?.executed || [] });
    } catch (error) {
      toast({ title: 'Could not load deployments', description: error instanceof Error ? error.message : 'Request failed', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = DEPLOYMENTS.map((deployment) => {
    const steps = deployment.steps(network).filter((step) => step.kind !== 'manual');
    const statuses = state ? steps.map((step) => stepStatus(step, state, userAddress)) : [];
    const executed = statuses.filter((s) => s.executed).length;
    const owed = statuses.filter((s) => !s.executed && !s.voted).length;
    return { deployment, total: steps.length, executed, owed };
  });

  return (
    <Card className="dark:bg-card overflow-hidden">
      <CardHeader className="px-4 md:px-6">
        <CardTitle className="text-base md:text-xl dark:text-foreground">Deployments</CardTitle>
        <CardDescription className="text-xs md:text-sm dark:text-muted-foreground">Feature rollouts that need your approval, one step at a time</CardDescription>
      </CardHeader>
      <CardContent className="px-4 md:px-6">
        <div className="overflow-x-auto -mx-4 md:mx-0 relative">
          {loading && (
            <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow className="dark:border-border dark:hover:bg-transparent">
                <TableHead className="text-xs md:text-sm pl-4 md:pl-4 dark:text-muted-foreground">Deployment</TableHead>
                <TableHead className="text-xs md:text-sm dark:text-muted-foreground whitespace-nowrap">Executed</TableHead>
                <TableHead className="text-xs md:text-sm dark:text-muted-foreground whitespace-nowrap">Needs You</TableHead>
                <TableHead className="text-xs md:text-sm pr-4 md:pr-4 dark:text-muted-foreground"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className={loading ? 'opacity-50 pointer-events-none' : ''}>
              {rows.map(({ deployment, total, executed, owed }) => (
                <TableRow key={deployment.id} className="border-border hover:bg-muted/50 cursor-pointer" onClick={() => setSelected(deployment)}>
                  <TableCell className="pl-4 md:pl-4 dark:text-foreground">
                    <div className="text-xs md:text-sm font-medium">{deployment.title}</div>
                    <div className="text-xs text-muted-foreground hidden md:block">{deployment.description}</div>
                  </TableCell>
                  <TableCell className="text-xs md:text-sm dark:text-foreground whitespace-nowrap">{executed} of {total}</TableCell>
                  <TableCell className="text-xs md:text-sm whitespace-nowrap">
                    {owed > 0 ? <span className="text-strato-blue font-medium">{owed} approval{owed === 1 ? '' : 's'}</span> : <span className="text-muted-foreground">Nothing</span>}
                  </TableCell>
                  <TableCell className="pr-4 md:pr-4 text-right">
                    <Button size="sm" variant="outline" className="text-xs md:text-sm">Review</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {state && (
        <DeploymentStepsModal deployment={selected} network={network} state={state} onOpenChange={(o) => !o && setSelected(null)} onApproved={load} />
      )}
    </Card>
  );
};

export default DeploymentsTable;
