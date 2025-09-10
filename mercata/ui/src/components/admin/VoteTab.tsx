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
import { Loader2, MoreVertical } from 'lucide-react';
import CopyButton from '../ui/copy';
import CreateAdminIssueModal from './CreateAdminIssueModal';


const VoteTab = () => {
  const { userAddress, openIssuesLoading, openIssues, getOpenIssues, castVoteOnIssue } = useUser();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    getOpenIssues();
  }, []);

  const handleCastVoteOnIssue = (target: string, func: string, args: string[]) => {
    castVoteOnIssue(target, func, args);
  };

  const flatten = (arr: any[]) => {
    let ret = [];
    for (let i = 0; i < arr.length; i++) {
      if (Array.isArray(arr[i])) {
        ret = [ ...ret, ...arr[i]];
      } else {
        ret = [ ...ret, arr[i]];
      }
    }
    return ret;
  }


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
  const executed: object[] = (openIssues && openIssues['executed']) || [];

  return (
    <div className="space-y-6">
      { }
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Vote on Issues</CardTitle>
            <CardDescription>Vote on pending administrative issues</CardDescription>
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
            <span className="text-sm text-gray-500">
              Showing {issues.length} open issues
            </span>
          </div>
          
          {issues.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No open issues found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Issue ID</TableHead>
                    <TableHead className="w-[120px]">Contract</TableHead>
                    <TableHead className="w-[80px]">Function</TableHead>
                    <TableHead className="w-[180px]">Arguments</TableHead>
                    <TableHead className="w-[60px]">Votes Cast</TableHead>
                    <TableHead className="w-[60px]">Votes Needed</TableHead>
                    <TableHead className="w-[60px]">Voting Threshold</TableHead>
                    <TableHead className="w-[60px]">Vote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {issues.map((issue: any, index) => {
                    const issueId = issue.issueId;
                    const address = issue.target;
                    const threshold = (thresholds.find((v) => v.target === address && v.func === issue.func)?.threshold || 6666)/100;
                    const votesNeeded = Math.floor((admins.length * threshold)/100) + 1;
                    const alreadyVoted = votes.find((v) => v.issueId === issueId && v.voter === userAddress);

                    return (
                      <TableRow key={`${issueId}-${index}`}>
                        <TableCell className="font-medium text-sm max-w-[120px] truncate">
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
                        <TableCell className="font-mono text-xs max-w-[120px]">
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
                        <TableCell className="text-sm max-w-[90px]">
                          {issue.func}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[180px] truncate">
                          {issue.args.join(', ')}
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px]">
                          {votes.filter((v) => v.issueId === issueId).length}
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px]">
                          {votesNeeded}
                        </TableCell>
                        <TableCell className="text-sm max-w-[90px]">
                          {`${threshold}%`}
                        </TableCell>
                        <TableCell className="max-w-[60px]">
                          <Button 
                            size="sm" 
                            onClick={() => handleCastVoteOnIssue(address, issue.func, flatten(issue.args))}
                            disabled={alreadyVoted}
                            className="bg-strato-blue hover:bg-strato-blue/90 text-xs"
                          >
                            Cast Vote
                          </Button>
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
      <Card>
        <CardHeader>
          <CardTitle>Executed Issues</CardTitle>
          <CardDescription>
            Issues that have already been executed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <span className="text-sm text-gray-500">
              Showing {executed.length} executed issues
            </span>
          </div>
          
          {executed.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No executed issues found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Issue ID</TableHead>
                    <TableHead className="w-[80px]">Contract</TableHead>
                    <TableHead className="w-[80px]">Function</TableHead>
                    <TableHead className="w-[190px]">Arguments</TableHead>
                    <TableHead className="w-[80px]">Executor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executed.map((issue: any, index) => {
                    const issueId = issue.issueId;
                    const address = issue.target;

                    return (
                      <TableRow key={`${issueId}-${index}`}>
                        <TableCell className="font-mono text-xs max-w-[80px] truncate">
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
                        <TableCell className="font-mono text-xs max-w-[80px] truncate">
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
                        <TableCell className="text-sm max-w-[80px]">
                          {issue.func}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[300px] truncate">
                          {issue.args.join(', ')}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[80px] truncate">
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
    </div>
  );
};

export default VoteTab;