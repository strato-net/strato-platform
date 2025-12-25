import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useUser } from '@/context/UserContext';
import { Loader2, MoreVertical, CheckCircle2 } from 'lucide-react';
import CopyButton from '../ui/copy';
import CreateAdminIssueModal from './CreateAdminIssueModal';
import CastVoteModal from './CastVoteModal';
import AddAdminModal from './AddAdminModal';
import RemoveAdminModal from './RemoveAdminModal';
import { parseJsonBigInt } from '@/utils/numberUtils';


const VoteTab = () => {
  const { userAddress, openIssuesLoading, openIssues, getOpenIssues, castVoteOnIssue, castVoteOnIssueById, dismissIssue, addAdmin, removeAdmin } = useUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [voteModalOpen, setVoteModalOpen] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [removeAdminOpen, setRemoveAdminOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<{
    issueId: string;
    target: string;
    func: string;
    args: any[];
    votesCast: number;
    votesNeeded: number;
    threshold: number;
  } | null>(null);

  useEffect(() => {
    getOpenIssues();
  }, []);

  const handleCastVoteOnIssue = (target: string, func: string, args: string[]) => {
    castVoteOnIssue(target, func, args);
  };

  const handleOpenVoteModal = (issueData: {
    issueId: string;
    target: string;
    func: string;
    args: any[];
    votesCast: number;
    votesNeeded: number;
    threshold: number;
  }) => {
    setSelectedIssue(issueData);
    setVoteModalOpen(true);
  };

  const handleCastVoteOnIssueById = async (issueId: string) => {
    await castVoteOnIssueById(issueId);
    // Refresh the issues after voting
    getOpenIssues();
  };

  const handleAddAdmin = async (userAddress: string) => {
    await addAdmin(userAddress);
  };

  const handleRemoveAdmin = async (userAddress: string) => {
    await removeAdmin(userAddress);
  };

  if (openIssuesLoading) {
    return (
      <Card className="rounded-none md:rounded-xl border-x-0 md:border-x">
        <CardHeader className="px-3 md:px-6">
          <CardTitle className="text-base md:text-lg">Vote on Issues</CardTitle>
          <CardDescription className="text-xs md:text-sm">
            Vote on Issues
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 md:h-6 md:w-6 animate-spin" />
            <span className="ml-2 text-sm">Loading open issues...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const admins: any[] = (openIssues && openIssues['admins']) || [];
  const issues: any[] = (openIssues && openIssues['issues']) || [];
  const votes: any[] = (openIssues && openIssues['votes']) || [];
  const thresholds: any[] = (openIssues && openIssues['thresholds']) || [];
  const globalThreshold: number = (openIssues && openIssues['globalThreshold']) || 6000;
  const executed: object[] = (openIssues && openIssues['executed']) || [];

  return (
    <div className="space-y-4 md:space-y-6">
      {/* List of Admins */}
      <Card className="dark:bg-card rounded-none md:rounded-xl border-x-0 md:border-x overflow-hidden">
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-0 px-3 md:px-6">
          <div className="space-y-0.5 md:space-y-1">
            <CardTitle className="dark:text-foreground text-base md:text-lg">Admins</CardTitle>
            <CardDescription className="dark:text-muted-foreground text-xs md:text-sm">Current administrators with voting rights</CardDescription>
          </div>

          <div className="flex flex-row gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => setAddAdminOpen(true)}
              className="bg-strato-blue hover:bg-strato-blue/90 text-xs md:text-sm h-8 px-2 md:px-3"
            >
              Add Admin
            </Button>
            <Button
              size="sm"
              onClick={() => setRemoveAdminOpen(true)}
              disabled={admins.length <= 1}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm h-8 px-2 md:px-3"
            >
              Remove
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <div className="mb-3 md:mb-4">
            <span className="text-xs md:text-sm text-muted-foreground">
              {admins.length} admin{admins.length !== 1 ? 's' : ''} registered
            </span>
          </div>
          
          {admins.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No admins found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
              {admins.map((admin: {address: string}, index: number) => (
                <div 
                  key={`${admin.address}-${index}`}
                  className="flex items-center justify-between p-2 md:p-3 border rounded-lg bg-muted/50 hover:bg-muted transition-colors border-border"
                >
                  <div className="flex items-center gap-1.5 md:gap-2">
                    <span className="font-mono text-[10px] md:text-sm dark:text-foreground">
                      {admin && admin.address !== 'Unknown' 
                        ? `${admin.address.slice(0, 6)}...${admin.address.slice(-4)}`
                        : admin.address
                      }
                    </span>
                    {admin?.address && admin.address !== 'Unknown' && (
                      <CopyButton address={admin.address} />
                    )}
                  </div>
                  {admin.address === userAddress && (
                    <span className="text-[10px] md:text-xs bg-strato-blue text-white px-1.5 md:px-2 py-0.5 md:py-1 rounded">You</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


      { }
      <Card className="dark:bg-card rounded-none md:rounded-xl border-x-0 md:border-x overflow-hidden">
        <CardHeader className="flex flex-col md:flex-row md:items-start justify-between gap-3 md:gap-0 px-3 md:px-6">
          <div className="space-y-0.5 md:space-y-1">
            <CardTitle className="dark:text-foreground text-base md:text-lg">Vote on Issues</CardTitle>
            <CardDescription className="dark:text-muted-foreground text-xs md:text-sm">Vote on pending administrative issues</CardDescription>
          </div>

          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="bg-strato-blue hover:bg-strato-blue/90 shrink-0 text-xs md:text-sm h-8 px-2 md:px-3 w-fit"
          >
            Create Issue
          </Button>
        </CardHeader>

        <CardContent className="px-3 md:px-6">
          <div className="mb-3 md:mb-4">
            <span className="text-xs md:text-sm text-muted-foreground">
              Showing {issues.length} open issues
            </span>
          </div>
          
          {issues.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No open issues found</p>
            </div>
          ) : (
            <div className="-mx-3 md:mx-0 overflow-x-auto">
              <Table className="min-w-[600px]">
                <TableHeader>
                  <TableRow className="dark:border-border dark:hover:bg-transparent">
                    <TableHead className="w-[100px] text-xs dark:text-muted-foreground">Issue ID</TableHead>
                    <TableHead className="w-[100px] text-xs dark:text-muted-foreground">Contract</TableHead>
                    <TableHead className="w-[70px] text-xs dark:text-muted-foreground">Function</TableHead>
                    <TableHead className="w-[50px] text-xs dark:text-muted-foreground">Votes</TableHead>
                    <TableHead className="w-[50px] text-xs dark:text-muted-foreground">Needed</TableHead>
                    <TableHead className="w-[60px] text-xs dark:text-muted-foreground">Threshold</TableHead>
                    <TableHead className="w-[60px] text-xs dark:text-muted-foreground">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue: any, index) => {
                    const issueId = issue.issueId;
                    const address = issue.target;
                    const issueArgs = parseJsonBigInt(typeof issue.args === 'string' ? issue.args : JSON.stringify(issue.args), { fallback: [] }) as any[];
                    const threshold = (thresholds.find((v) => v.target === address && v.func === issue.func)?.threshold || globalThreshold)/100;
                    const votesNeeded = Math.ceil((admins.length * threshold)/100);
                    const hasUserVoted = votes.some((v) => v.issueId === issueId && v.voter === userAddress);

                    return (
                      <TableRow key={`${issueId}-${index}`} className={`border-border hover:bg-muted/50 ${hasUserVoted ? 'bg-green-500/10' : ''}`}>
                        <TableCell className="font-medium text-[10px] md:text-sm max-w-[100px] dark:text-foreground">
                          <div className="flex items-center gap-1">
                            {hasUserVoted && (
                              <CheckCircle2 className="h-3 w-3 md:h-4 md:w-4 text-green-600 dark:text-green-400 shrink-0" />
                            )}
                            <span className="truncate">
                              {issueId && issueId !== 'Unknown' 
                                ? `${issueId.slice(0, 4)}...${issueId.slice(-3)}`
                                : issueId
                              }
                            </span>
                            {issueId && issueId !== 'Unknown' && (
                              <CopyButton address={issueId} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] md:text-xs max-w-[100px] dark:text-foreground">
                          <div className="flex items-center gap-1">
                            <span className="truncate">
                              {address && address !== 'Unknown' 
                                ? `${address.slice(0, 4)}...${address.slice(-3)}`
                                : address
                              }
                            </span>
                            {address && address !== 'Unknown' && (
                              <CopyButton address={address} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px] md:text-sm max-w-[70px] dark:text-foreground truncate">
                          {issue.func}
                        </TableCell>
                        <TableCell className="text-[10px] md:text-sm dark:text-foreground">
                          {votes.filter((v) => v.issueId === issueId).length}
                        </TableCell>
                        <TableCell className="text-[10px] md:text-sm dark:text-foreground">
                          {votesNeeded}
                        </TableCell>
                        <TableCell className="text-[10px] md:text-sm dark:text-foreground">
                          {`${threshold}%`}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-0.5">
                            <Button 
                              size="sm" 
                              onClick={() => handleOpenVoteModal({
                                issueId,
                                target: address,
                                func: issue.func,
                                args: issueArgs,
                                votesCast: votes.filter((v) => v.issueId === issueId).length,
                                votesNeeded,
                                threshold
                              })}
                              className="bg-strato-blue hover:bg-strato-blue/90 text-[10px] md:text-xs dark:text-white h-6 md:h-7 px-2"
                            >
                              View
                            </Button>
                            {hasUserVoted && (
                              <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">Voted</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* List Executed Issues */}
      <Card className="dark:bg-card rounded-none md:rounded-xl border-x-0 md:border-x overflow-hidden">
        <CardHeader className="px-3 md:px-6">
          <CardTitle className="dark:text-foreground text-base md:text-lg">Executed Issues</CardTitle>
          <CardDescription className="dark:text-muted-foreground text-xs md:text-sm">
            Issues that have already been executed
          </CardDescription>
        </CardHeader>
        <CardContent className="px-3 md:px-6">
          <div className="mb-3 md:mb-4">
            <span className="text-xs md:text-sm text-muted-foreground">
              Showing {executed.length} executed issues
            </span>
          </div>
          
          {executed.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No executed issues found</p>
            </div>
          ) : (
            <div className="-mx-3 md:mx-0 overflow-x-auto">
              <Table className="min-w-[500px]">
                <TableHeader>
                  <TableRow className="dark:border-border dark:hover:bg-transparent">
                    <TableHead className="w-[80px] text-xs dark:text-muted-foreground">Issue ID</TableHead>
                    <TableHead className="w-[80px] text-xs dark:text-muted-foreground">Contract</TableHead>
                    <TableHead className="w-[70px] text-xs dark:text-muted-foreground">Function</TableHead>
                    <TableHead className="w-[120px] text-xs dark:text-muted-foreground">Arguments</TableHead>
                    <TableHead className="w-[80px] text-xs dark:text-muted-foreground">Executor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executed.map((issue: any, index) => {
                    const issueId = issue.issueId;
                    const address = issue.target;
                    const issueArgs = parseJsonBigInt(typeof issue.args === 'string' ? issue.args : JSON.stringify(issue.args), { fallback: [] }) as any[];
                    return (
                      <TableRow key={`${issueId}-${index}`} className="dark:border-border dark:hover:bg-muted/50">
                        <TableCell className="font-mono text-[10px] md:text-xs max-w-[80px] dark:text-foreground">
                          <div className="flex items-center gap-1">
                            <span className="truncate">
                              {issueId && issueId !== 'Unknown' 
                                ? `${issueId.slice(0, 4)}...${issueId.slice(-3)}`
                                : issueId
                              }
                            </span>
                            {issueId && issueId !== 'Unknown' && (
                              <CopyButton address={issueId} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] md:text-xs max-w-[80px] dark:text-foreground">
                          <div className="flex items-center gap-1">
                            <span className="truncate">
                              {address && address !== 'Unknown' 
                                ? `${address.slice(0, 4)}...${address.slice(-3)}`
                                : address
                              }
                            </span>
                            {address && address !== 'Unknown' && (
                              <CopyButton address={address} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px] md:text-sm max-w-[70px] dark:text-foreground truncate">
                          {issue.func}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] md:text-xs max-w-[120px] dark:text-foreground truncate">
                          {issueArgs.join(', ')}
                        </TableCell>
                        <TableCell className="font-mono text-[10px] md:text-xs max-w-[80px] dark:text-foreground">
                          <div className="flex items-center gap-1">
                            <span className="truncate">
                              {issue.executor && issue.executor !== 'Unknown' 
                                ? `${issue.executor.slice(0, 4)}...${issue.executor.slice(-3)}`
                                : issue.executor
                              }
                            </span>
                            {issue.executor && issue.executor !== 'Unknown' && (
                              <CopyButton address={issue.executor} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      <CreateAdminIssueModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        handleCastVoteOnIssue={handleCastVoteOnIssue}
      />
      <CastVoteModal
        open={voteModalOpen}
        onOpenChange={setVoteModalOpen}
        issue={selectedIssue}
        onCastVote={handleCastVoteOnIssueById}
        onDismissIssue={dismissIssue}
        votes={votes}
        userAddress={userAddress}
      />
      <AddAdminModal
        open={addAdminOpen}
        onOpenChange={setAddAdminOpen}
        onAddAdmin={handleAddAdmin}
        admins={admins}
      />
      <RemoveAdminModal
        open={removeAdminOpen}
        onOpenChange={setRemoveAdminOpen}
        onRemoveAdmin={handleRemoveAdmin}
        admins={admins}
      />
    </div>
  );
};

export default VoteTab;