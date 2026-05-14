import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import CopyButton from '../ui/copy';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CastVoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: {
    issueId: string;
    target: string;
    func: string;
    args: unknown[];
    votesCast: number;
    votesNeeded: number;
    threshold: number;
    timelock?: {
      queuedAt: number;
      executableAt: number;
      expiresAt: number;
    };
  } | null;
  onCastVote: (issueId: string) => Promise<void> | void;
  onExecuteIssue?: (target: string, func: string, args: unknown[]) => Promise<void> | void;
  onWithdrawVote?: (target: string, func: string, args: unknown[]) => Promise<void> | void;
  onDismissIssue?: (issueId: string) => Promise<void> | void;
  votes?: Array<{ issueId: string; index: number; voter: string }>;
  userAddress?: string | null;
}

const normalizeAddress = (addr?: string | null): string => (addr || '').toLowerCase().replace(/^0x/, '');

const CastVoteModal: React.FC<CastVoteModalProps> = ({
  open,
  onOpenChange,
  issue,
  onCastVote,
  onExecuteIssue,
  onWithdrawVote,
  onDismissIssue,
  votes = [],
  userAddress,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleSubmit = async () => {
    if (!issue) return;

    setIsSubmitting(true);
    try {
      await onCastVote(issue.issueId);
      
      toast({
        title: 'Vote Cast Successfully',
        description: 'Your vote has been recorded on the blockchain.',
      });

      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    if (!issue || !onDismissIssue) return;

    setIsDismissing(true);
    try {
      await onDismissIssue(issue.issueId);
      
      toast({
        title: 'Issue Dismissed Successfully',
        description: 'The issue has been dismissed.',
      });

      onOpenChange(false);
    } finally {
      setIsDismissing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!issue || !onWithdrawVote) return;

    setIsWithdrawing(true);
    try {
      await onWithdrawVote(issue.target, issue.func, issue.args);
      
      toast({
        title: 'Vote Withdrawn Successfully',
        description: 'Your vote has been withdrawn.',
      });

      onOpenChange(false);
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleExecute = async () => {
    if (!issue || !onExecuteIssue) return;

    setIsExecuting(true);
    try {
      await onExecuteIssue(issue.target, issue.func, issue.args);

      toast({
        title: 'Issue Executed Successfully',
        description: 'The queued issue has been executed.',
      });

      onOpenChange(false);
    } finally {
      setIsExecuting(false);
    }
  };

  const issueVotes = issue ? votes.filter(v => v.issueId === issue.issueId) : [];
  const hasUserVoted = !!userAddress && issueVotes.some(v => v.voter === userAddress);
  const isQueued = Number(issue?.timelock?.executableAt || 0) > 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const executableAt = Number(issue?.timelock?.executableAt || 0);
  const expiresAt = Number(issue?.timelock?.expiresAt || 0);
  const canExecute = !!onExecuteIssue && isQueued && nowSeconds >= executableAt && nowSeconds <= expiresAt;
  const isExpired = isQueued && expiresAt > 0 && nowSeconds > expiresAt;

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleString();
  };

  // Check if dismiss button should be enabled
  const canDismiss = issue && onDismissIssue && userAddress && votes.length > 0
    ? (() => {
        return issueVotes.length === 1 && issueVotes[0]?.voter === userAddress;
      })()
    : false;
  const canWithdraw = !!onWithdrawVote && hasUserVoted;

  // Get tooltip message for disabled button
  const getTooltipMessage = (): string | null => {
    if (!issue || !onDismissIssue || !userAddress || votes.length === 0) {
      return null;
    }
    
    if (issueVotes.length === 0) {
      return null;
    }
    
    if (issueVotes.length > 1) {
      return "Only issues with a single vote can be dismissed";
    }
    
    if (normalizeAddress(issueVotes[0]?.voter) !== normalizeAddress(userAddress)) {
      return "Only the proposer can dismiss this issue";
    }
    
    return null;
  };

  const tooltipMessage = getTooltipMessage();

  if (!issue) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && !isDismissing && !isWithdrawing && !isExecuting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Vote on Issue</DialogTitle>
          <DialogDescription>
            Review the issue details below and confirm your vote.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1">
          {/* Issue ID */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Issue ID</div>
            <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg border border-border">
              <code className="text-sm font-mono break-all">{issue.issueId}</code>
              <CopyButton address={issue.issueId} />
            </div>
          </div>

          {/* Contract Address */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Contract Address</div>
            <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg border border-border">
              <code className="text-sm font-mono break-all">{issue.target}</code>
              <CopyButton address={issue.target} />
            </div>
          </div>

          {/* Function Name */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Function Name</div>
            <div className="p-3 bg-muted/50 rounded-lg border border-border">
              <code className="text-sm font-mono">{issue.func}</code>
            </div>
          </div>

          {/* Arguments */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-foreground">Arguments</div>
            <div className="p-3 bg-muted/50 rounded-lg border border-border max-h-[120px] overflow-y-auto">
              {issue.args.length > 0 ? (
                <div className="space-y-2">
                  {issue.args.map((arg, index) => (
                    <div key={index} className="flex items-start space-x-2">
                      <span className="text-sm font-semibold text-muted-foreground min-w-[60px]">
                        Arg {index + 1}:
                      </span>
                      <code className="text-sm font-mono break-all flex-1">{String(arg)}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">No arguments</span>
              )}
            </div>
          </div>

          {/* Voting Status */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">Votes Cast</div>
              <div className="text-2xl font-bold text-strato-blue">{issue.votesCast}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">Votes Needed</div>
              <div className="text-2xl font-bold text-strato-blue">{issue.votesNeeded}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">Threshold</div>
              <div className="text-2xl font-bold text-strato-blue">{issue.threshold}%</div>
            </div>
          </div>

          {isQueued && (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-foreground">Queue Status</div>
              <div className="grid grid-cols-1 gap-2 p-3 bg-muted/50 rounded-lg border border-border text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Queued</span>
                  <span className="font-mono text-right">{formatTime(issue.timelock?.queuedAt)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Executable</span>
                  <span className="font-mono text-right">{formatTime(issue.timelock?.executableAt)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Expires</span>
                  <span className="font-mono text-right">{formatTime(issue.timelock?.expiresAt)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between gap-3 pt-4 border-t flex-shrink-0">
          <div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDismiss}
                      disabled={!onDismissIssue || !canDismiss || isQueued || isDismissing || isSubmitting || isWithdrawing || isExecuting}
                      className="text-red-600 border-red-600 hover:bg-red-50"
                    >
                      {isDismissing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Dismissing...
                        </>
                      ) : (
                        'Dismiss Issue'
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {(!onDismissIssue || !canDismiss) && tooltipMessage && (
                  <TooltipContent>
                    <p>{tooltipMessage}</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex gap-3">
            {hasUserVoted && (
              <Button
                type="button"
                variant="outline"
                onClick={handleWithdraw}
                disabled={!canWithdraw || isSubmitting || isDismissing || isWithdrawing || isExecuting}
                className="text-red-600 border-red-600 hover:bg-red-50"
              >
                {isWithdrawing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Withdrawing...
                  </>
                ) : (
                  'Withdraw Vote'
                )}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting || isDismissing || isWithdrawing || isExecuting}
            >
              Cancel
            </Button>
            <Button
              onClick={isQueued ? handleExecute : handleSubmit}
              disabled={(isQueued ? !canExecute : hasUserVoted) || isSubmitting || isDismissing || isWithdrawing || isExecuting}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              {isSubmitting || isExecuting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isExecuting ? 'Executing...' : 'Casting Vote...'}
                </>
              ) : (
                isQueued ? (canExecute ? 'Execute' : isExpired ? 'Expired' : 'Queued') : hasUserVoted ? 'Vote Cast' : 'Confirm Vote'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CastVoteModal;

