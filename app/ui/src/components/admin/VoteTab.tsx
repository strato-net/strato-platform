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
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import { useUser } from '@/context/UserContext';
import { Loader2, CheckCircle2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import CopyButton from '../ui/copy';
import CreateAdminIssueModal from './CreateAdminIssueModal';
import CastVoteModal from './CastVoteModal';
import AddAdminModal from './AddAdminModal';
import RemoveAdminModal from './RemoveAdminModal';
import { parseJsonBigInt } from '@/utils/numberUtils';
import { ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE, ADMIN_VOTE_OPEN_ISSUES_PER_PAGE } from '@/lib/constants';

const VoteTab = () => {
  const { userAddress, openIssuesLoading, openIssues, getOpenIssues, executedIssues, executedIssuesLoading, getExecutedIssues, castVoteOnIssue, castVoteOnIssueById, dismissIssue, addAdmin, removeAdmin } = useUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [voteModalOpen, setVoteModalOpen] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [removeAdminOpen, setRemoveAdminOpen] = useState(false);
  const [executedPage, setExecutedPage] = useState(1);
  const [openIssuesPage, setOpenIssuesPage] = useState(1);
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

  useEffect(() => {
    getExecutedIssues(executedPage, ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
  }, [executedPage]);

  const handleCastVoteOnIssue = async (target: string, func: string, args: string[]) => {
    await castVoteOnIssue(target, func, args);
    // Reset to page 1 to show the recently executed issue
    setExecutedPage(1);
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
    // Reset to page 1 to show the recently executed issue
    setExecutedPage(1);
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
  const allIssues: any[] = (openIssues && openIssues['issues']) || [];
  const votes: any[] = (openIssues && openIssues['votes']) || [];
  const thresholds: any[] = (openIssues && openIssues['thresholds']) || [];
  const globalThreshold: number = (openIssues && openIssues['globalThreshold']) || 6000;
  const executed: object[] = (executedIssues && executedIssues['executed']) || [];
  const executedTotal: number = (executedIssues && executedIssues['executedTotal']) || 0;
  const executedTotalPages = Math.ceil(executedTotal / ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE);
  
  // Paginate open issues client-side
  const openIssuesTotalPages = Math.ceil(allIssues.length / ADMIN_VOTE_OPEN_ISSUES_PER_PAGE);
  const openIssuesStartIndex = (openIssuesPage - 1) * ADMIN_VOTE_OPEN_ISSUES_PER_PAGE;
  const openIssuesEndIndex = openIssuesStartIndex + ADMIN_VOTE_OPEN_ISSUES_PER_PAGE;
  const issues = allIssues.slice(openIssuesStartIndex, openIssuesEndIndex);

  return (
    <div className="space-y-6">
      {/* List of Admins */}
      <Card className="dark:bg-card overflow-hidden">
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 md:px-6">
          <div className="space-y-0.5 md:space-y-1">
            <CardTitle className="text-base md:text-xl dark:text-foreground">Admins</CardTitle>
            <CardDescription className="text-xs md:text-sm dark:text-muted-foreground">Current administrators with voting rights</CardDescription>
          </div>

          <div className="flex flex-row gap-2 shrink-0">
            <Button
              size="sm"
              onClick={() => setAddAdminOpen(true)}
              className="bg-strato-blue hover:bg-strato-blue/90 text-xs md:text-sm"
            >
              Add Admin
            </Button>
            <Button
              size="sm"
              onClick={() => setRemoveAdminOpen(true)}
              disabled={admins.length <= 1}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed text-xs md:text-sm"
            >
              Remove Admin
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
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
                  <div className="flex items-center gap-1.5 md:space-x-2 min-w-0">
                    <span className="font-mono text-xs md:text-sm dark:text-foreground truncate">
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
                    <span className="text-[10px] md:text-xs bg-strato-blue text-white px-1.5 md:px-2 py-0.5 md:py-1 rounded shrink-0">You</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


      { }
      <Card className="dark:bg-card overflow-hidden">
        <CardHeader className="flex flex-col md:flex-row md:items-start justify-between gap-3 px-4 md:px-6">
          <div className="space-y-0.5 md:space-y-1">
            <CardTitle className="text-base md:text-xl dark:text-foreground whitespace-nowrap">Vote on Issues</CardTitle>
            <CardDescription className="text-xs md:text-sm dark:text-muted-foreground">Vote on pending administrative issues</CardDescription>
          </div>

          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="bg-strato-blue hover:bg-strato-blue/90 shrink-0 text-xs md:text-sm whitespace-nowrap"
          >
            Create New Issue
          </Button>
        </CardHeader>

        <CardContent className="px-4 md:px-6">
          <div className="mb-3 md:mb-4">
            <span className="text-xs md:text-sm text-muted-foreground">
              {allIssues.length > 0 ? (
                <>
                  Showing {openIssuesStartIndex + 1}-{Math.min(openIssuesEndIndex, allIssues.length)} of {allIssues.length} open issues
                </>
              ) : (
                <>No open issues</>
              )}
            </span>
          </div>
          
          {issues.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No open issues found</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <Table>
                  <TableHeader>
                    <TableRow className="dark:border-border dark:hover:bg-transparent">
                      <TableHead className="text-xs md:text-sm pl-4 md:pl-4 dark:text-muted-foreground whitespace-nowrap">Issue ID</TableHead>
                      <TableHead className="text-xs md:text-sm dark:text-muted-foreground hidden md:table-cell">Contract</TableHead>
                      <TableHead className="text-xs md:text-sm dark:text-muted-foreground hidden md:table-cell">Function</TableHead>
                      <TableHead className="text-xs md:text-sm dark:text-muted-foreground whitespace-nowrap">Votes Needed</TableHead>
                      <TableHead className="text-xs md:text-sm dark:text-muted-foreground whitespace-nowrap">Voting Threshold</TableHead>
                      <TableHead className="text-xs md:text-sm pr-4 md:pr-4 dark:text-muted-foreground">Vote</TableHead>
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
                        <TableCell className="font-medium text-xs md:text-sm pl-4 md:pl-4 dark:text-foreground">
                          <div className="flex items-center gap-1 md:space-x-2">
                            {hasUserVoted && (
                              <CheckCircle2 className="h-3 w-3 md:h-4 md:w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                            )}
                            <span className="truncate">
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
                        <TableCell className="font-mono text-xs hidden md:table-cell dark:text-foreground">
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
                        <TableCell className="text-sm hidden md:table-cell dark:text-foreground">
                          {issue.func}
                        </TableCell>
                        <TableCell className="text-xs md:text-sm dark:text-foreground">
                          {votesNeeded}
                        </TableCell>
                        <TableCell className="text-xs md:text-sm dark:text-foreground">
                          {`${threshold}%`}
                        </TableCell>
                        <TableCell className="pr-4 md:pr-4">
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
                              className="bg-strato-blue hover:bg-strato-blue/90 text-[10px] md:text-xs px-2 md:px-3 dark:text-white whitespace-nowrap"
                            >
                              View Vote
                            </Button>
                            {hasUserVoted && (
                              <span className="text-[10px] md:text-xs text-green-600 dark:text-green-400 font-medium whitespace-nowrap">You voted</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  </TableBody>
                </Table>
              </div>
              {openIssuesTotalPages > 1 && (
                <div className="mt-4 flex items-center justify-center">
                  <Pagination>
                    <PaginationContent>
                      {openIssuesPage > 2 && (
                        <PaginationItem>
                          <PaginationLink
                            onClick={() => setOpenIssuesPage(1)}
                            className={openIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          >
                            <ChevronsLeft className="h-4 w-4" />
                            <span className="sr-only">Go to first page</span>
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      <PaginationItem>
                        <PaginationPrevious 
                          onClick={() => setOpenIssuesPage(prev => Math.max(1, prev - 1))}
                          className={openIssuesPage === 1 || openIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <span className="text-sm text-muted-foreground px-4">
                          Page {openIssuesPage} of {openIssuesTotalPages}
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext 
                          onClick={() => setOpenIssuesPage(prev => Math.min(openIssuesTotalPages, prev + 1))}
                          className={openIssuesPage === openIssuesTotalPages || openIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      {openIssuesPage < openIssuesTotalPages - 1 && (
                        <PaginationItem>
                          <PaginationLink
                            onClick={() => setOpenIssuesPage(openIssuesTotalPages)}
                            className={openIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          >
                            <ChevronsRight className="h-4 w-4" />
                            <span className="sr-only">Go to last page</span>
                          </PaginationLink>
                        </PaginationItem>
                      )}
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* List Executed Issues */}
      <Card className="dark:bg-card overflow-hidden">
        <CardHeader className="px-4 md:px-6">
          <CardTitle className="text-base md:text-xl dark:text-foreground whitespace-nowrap">Executed Issues</CardTitle>
          <CardDescription className="text-xs md:text-sm dark:text-muted-foreground">
            Issues that have already been executed
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 md:px-6">
          <div className="mb-3 md:mb-4">
            <span className="text-xs md:text-sm text-muted-foreground">
              {executedTotal > 0 ? (
                <>
                  Showing {((executedPage - 1) * ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE) + 1}-{Math.min(executedPage * ADMIN_VOTE_EXECUTED_ISSUES_PER_PAGE, executedTotal)} of {executedTotal} executed issues
                </>
              ) : (
                <>No executed issues</>
              )}
            </span>
          </div>
          
          {executed.length === 0 && !executedIssuesLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-sm">No executed issues found</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-4 md:mx-0 relative">
                {executedIssuesLoading && (
                  <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow className="dark:border-border dark:hover:bg-transparent">
                      <TableHead className="text-sm pl-4 dark:text-muted-foreground whitespace-nowrap">Issue ID</TableHead>
                      <TableHead className="text-sm dark:text-muted-foreground whitespace-nowrap">Contract</TableHead>
                      <TableHead className="text-sm dark:text-muted-foreground whitespace-nowrap">Function</TableHead>
                      <TableHead className="text-sm dark:text-muted-foreground whitespace-nowrap">Arguments</TableHead>
                      <TableHead className="text-sm pr-4 dark:text-muted-foreground whitespace-nowrap">Executor</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className={executedIssuesLoading ? "opacity-50 pointer-events-none" : ""}>
                    {executed.map((issue: any, index) => {
                      const issueId = issue.issueId;
                      const address = issue.target;
                      const issueArgs = parseJsonBigInt(typeof issue.args === 'string' ? issue.args : JSON.stringify(issue.args), { fallback: [] }) as any[];
                      return (
                        <TableRow key={`${issueId}-${index}`} className="dark:border-border dark:hover:bg-muted/50">
                          <TableCell className="font-mono text-xs pl-4 dark:text-foreground">
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
                          <TableCell className="font-mono text-xs dark:text-foreground">
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
                          <TableCell className="text-sm dark:text-foreground whitespace-nowrap">
                            {issue.func}
                          </TableCell>
                          <TableCell className="font-mono text-xs max-w-[200px] truncate dark:text-foreground">
                            {issueArgs.join(', ')}
                          </TableCell>
                          <TableCell className="font-mono text-xs pr-4 dark:text-foreground">
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
              {executedTotalPages > 1 && (
                <div className="mt-4 flex items-center justify-center">
                  <Pagination>
                    <PaginationContent>
                      {executedPage > 2 && (
                        <PaginationItem>
                          <PaginationLink
                            onClick={() => setExecutedPage(1)}
                            className={executedIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          >
                            <ChevronsLeft className="h-4 w-4" />
                            <span className="sr-only">Go to first page</span>
                          </PaginationLink>
                        </PaginationItem>
                      )}
                      <PaginationItem>
                        <PaginationPrevious 
                          onClick={() => setExecutedPage(prev => Math.max(1, prev - 1))}
                          className={executedPage === 1 || executedIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <span className="text-sm text-muted-foreground px-4">
                          Page {executedPage} of {executedTotalPages}
                        </span>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext 
                          onClick={() => setExecutedPage(prev => Math.min(executedTotalPages, prev + 1))}
                          className={executedPage === executedTotalPages || executedIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                        />
                      </PaginationItem>
                      {executedPage < executedTotalPages - 1 && (
                        <PaginationItem>
                          <PaginationLink
                            onClick={() => setExecutedPage(executedTotalPages)}
                            className={executedIssuesLoading ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                          >
                            <ChevronsRight className="h-4 w-4" />
                            <span className="sr-only">Go to last page</span>
                          </PaginationLink>
                        </PaginationItem>
                      )}
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
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