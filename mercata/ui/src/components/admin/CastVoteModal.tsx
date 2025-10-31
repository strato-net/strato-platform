import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import CopyButton from '../ui/copy';

interface CastVoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: {
    issueId: string;
    target: string;
    func: string;
    args: any[];
    votesCast: number;
    votesNeeded: number;
    threshold: number;
  } | null;
  onCastVote: (issueId: string) => Promise<void> | void;
}

const CastVoteModal: React.FC<CastVoteModalProps> = ({
  open,
  onOpenChange,
  issue,
  onCastVote,
}) => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    } catch (err) {
      console.error('Cast vote failed:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!issue) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
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
            <div className="text-sm font-semibold text-gray-700">Issue ID</div>
            <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg border">
              <code className="text-sm font-mono break-all">{issue.issueId}</code>
              <CopyButton address={issue.issueId} />
            </div>
          </div>

          {/* Contract Address */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-700">Contract Address</div>
            <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg border">
              <code className="text-sm font-mono break-all">{issue.target}</code>
              <CopyButton address={issue.target} />
            </div>
          </div>

          {/* Function Name */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-700">Function Name</div>
            <div className="p-3 bg-gray-50 rounded-lg border">
              <code className="text-sm font-mono">{issue.func}</code>
            </div>
          </div>

          {/* Arguments */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-gray-700">Arguments</div>
            <div className="p-3 bg-gray-50 rounded-lg border max-h-[120px] overflow-y-auto">
              {issue.args.length > 0 ? (
                <div className="space-y-2">
                  {issue.args.map((arg, index) => (
                    <div key={index} className="flex items-start space-x-2">
                      <span className="text-sm font-semibold text-gray-500 min-w-[60px]">
                        Arg {index + 1}:
                      </span>
                      <code className="text-sm font-mono break-all flex-1">{String(arg)}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-gray-500">No arguments</span>
              )}
            </div>
          </div>

          {/* Voting Status */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-500">Votes Cast</div>
              <div className="text-2xl font-bold text-strato-blue">{issue.votesCast}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-500">Votes Needed</div>
              <div className="text-2xl font-bold text-strato-blue">{issue.votesNeeded}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-semibold text-gray-500">Threshold</div>
              <div className="text-2xl font-bold text-strato-blue">{issue.threshold}%</div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t flex-shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-strato-blue hover:bg-strato-blue/90"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Casting Vote...
              </>
            ) : (
              'Confirm Vote'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CastVoteModal;

