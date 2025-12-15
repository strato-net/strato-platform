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
      <Card>
        <CardHeader>
          <CardTitle>Vote on Issues</CardTitle>
          <CardDescription>
            Vote on Issues
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading open issues...</span>
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
    <div className="space-y-6">
      {/* List of Admins */}
      <Card className="dark:bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="dark:text-foreground">Admins</CardTitle>
            <CardDescription className="dark:text-muted-foreground">Current administrators with voting rights</CardDescription>
          </div>

          <div className="flex flex-row gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => setAddAdminOpen(true)}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              Add Admin
            </Button>
            <Button
              size="sm"
              onClick={() => setRemoveAdminOpen(true)}
              disabled={admins.length <= 1}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Remove Admin
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <span className="text-sm text-muted-foreground">
              {admins.length} admin{admins.length !== 1 ? 's' : ''} registered
            </span>
          </div>
          
          {admins.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No admins found</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {admins.map((admin: {address: string}, index: number) => (
                <div 
                  key={`${admin.address}-${index}`}
                  className="flex items-center justify-between p-3 border rounded-lg bg-muted/50 hover:bg-muted transition-colors border-border"
                >
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-sm dark:text-foreground">
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
                    <span className="text-xs bg-strato-blue text-white px-2 py-1 rounded">You</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


      { }
      <Card className="dark:bg-card">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="dark:text-foreground">Vote on Issues</CardTitle>
            <CardDescription className="dark:text-muted-foreground">Vote on pending administrative issues</CardDescription>
          </div>

          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="bg-strato-blue hover:bg-strato-blue/90 shrink-0"
          >
            Create New Issue
          </Button>
        </CardHeader>

        <CardContent>
          <div className="mb-4">
            <span className="text-sm text-muted-foreground">
              Showing {issues.length} open issues
            </span>
          </div>
          
          {issues.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No open issues found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="dark:border-border dark:hover:bg-transparent">
                    <TableHead className="w-[120px] dark:text-muted-foreground">Issue ID</TableHead>
                    <TableHead className="w-[120px] dark:text-muted-foreground">Contract</TableHead>
                    <TableHead className="w-[80px] dark:text-muted-foreground">Function</TableHead>
                    <TableHead className="w-[60px] dark:text-muted-foreground">Votes Cast</TableHead>
                    <TableHead className="w-[60px] dark:text-muted-foreground">Votes Needed</TableHead>
                    <TableHead className="w-[60px] dark:text-muted-foreground">Voting Threshold</TableHead>
                    <TableHead className="w-[60px] dark:text-muted-foreground">Vote</TableHead>
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
                        <TableCell className="font-medium text-sm max-w-[120px] truncate dark:text-foreground">
                          <div className="flex items-center space-x-2">
                            {hasUserVoted && (
                              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                            )}
                            <span>
                              {issueId && issueId !== 'Unknown' 
                                ? `${issueId.slice(0, 6)}...${issueId.slice(-4)}`
                                : issueId
                              }
                            </span>
                            {issueId && issueId !== 'Unknown' && (
                              <CopyButton address={issueId} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[120px] dark:text-foreground">
                          <div className="flex items-center space-x-2">
                            <span>
                              {address && address !== 'Unknown' 
                                ? `${address.slice(0, 6)}...${address.slice(-4)}`
                                : address
                              }
                            </span>
                            {address && address !== 'Unknown' && (
                              <CopyButton address={address} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px] dark:text-foreground">
                          {issue.func}
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px] dark:text-foreground">
                          {votes.filter((v) => v.issueId === issueId).length}
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px] dark:text-foreground">
                          {votesNeeded}
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px] dark:text-foreground">
                          {`${threshold}%`}
                        </TableCell>
                        <TableCell className="max-w-[60px]">
                          <div className="flex flex-col items-start gap-1">
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
                              className="bg-strato-blue hover:bg-strato-blue/90 text-xs dark:text-white"
                            >
                              View Vote
                            </Button>
                            {hasUserVoted && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">You voted</span>
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
      <Card className="dark:bg-card">
        <CardHeader>
          <CardTitle className="dark:text-foreground">Executed Issues</CardTitle>
          <CardDescription className="dark:text-muted-foreground">
            Issues that have already been executed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <span className="text-sm text-muted-foreground">
              Showing {executed.length} executed issues
            </span>
          </div>
          
          {executed.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No executed issues found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="dark:border-border dark:hover:bg-transparent">
                    <TableHead className="w-[80px] dark:text-muted-foreground">Issue ID</TableHead>
                    <TableHead className="w-[80px] dark:text-muted-foreground">Contract</TableHead>
                    <TableHead className="w-[80px] dark:text-muted-foreground">Function</TableHead>
                    <TableHead className="w-[190px] dark:text-muted-foreground">Arguments</TableHead>
                    <TableHead className="w-[80px] dark:text-muted-foreground">Executor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executed.map((issue: any, index) => {
                    const issueId = issue.issueId;
                    const address = issue.target;
                    const issueArgs = parseJsonBigInt(typeof issue.args === 'string' ? issue.args : JSON.stringify(issue.args), { fallback: [] }) as any[];
                    return (
                      <TableRow key={`${issueId}-${index}`} className="dark:border-border dark:hover:bg-muted/50">
                        <TableCell className="font-mono text-xs max-w-[80px] truncate dark:text-foreground">
                          <div className="flex items-center space-x-2">
                            <span>
                              {issueId && issueId !== 'Unknown' 
                                ? `${issueId.slice(0, 6)}...${issueId.slice(-4)}`
                                : issueId
                              }
                            </span>
                            {issueId && issueId !== 'Unknown' && (
                              <CopyButton address={issueId} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[80px] truncate dark:text-foreground">
                          <div className="flex items-center space-x-2">
                            <span>
                              {address && address !== 'Unknown' 
                                ? `${address.slice(0, 6)}...${address.slice(-4)}`
                                : address
                              }
                            </span>
                            {address && address !== 'Unknown' && (
                              <CopyButton address={address} />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm max-w-[80px] dark:text-foreground">
                          {issue.func}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[300px] truncate dark:text-foreground">
                          {issueArgs.join(', ')}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[80px] truncate dark:text-foreground">
                          <div className="flex items-center space-x-2">
                            <span>
                              {issue.executor && issue.executor !== 'Unknown' 
                                ? `${issue.executor.slice(0, 6)}...${issue.executor.slice(-4)}`
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