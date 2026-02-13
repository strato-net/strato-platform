import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw } from "lucide-react";
import { cdpService, JuniorNote as JuniorNoteType } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { formatWeiToDecimalHP, formatNumber } from "@/utils/numberUtils";
import CopyableHash from "../common/CopyableHash";


interface UserJuniorNote extends JuniorNoteType {
  claimableAmount: string;       // Currently claimable amount in wei (18 decimals) - calculated from backend data
}

interface JuniorNoteProps {
  refreshTrigger?: number;
  onNoteActionSuccess?: () => void;
  guestMode?: boolean;
}

const JuniorNote: React.FC<JuniorNoteProps> = ({ refreshTrigger, onNoteActionSuccess, guestMode = false }) => {
  const [note, setNote] = useState<UserJuniorNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { userAddress } = useUser();
  
  // State for showing claim button
  const [showClaimButton, setShowClaimButton] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [isGlobalPaused, setIsGlobalPaused] = useState<boolean>(false);

  // Fetch junior note from backend
  const fetchJuniorNote = useCallback(async (showRefreshing = false) => {
    // Skip API call for guests
    if (guestMode || !userAddress) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      // Fetch global pause status
      try {
        const globalPauseStatus = await cdpService.getGlobalPaused();
        setIsGlobalPaused(globalPauseStatus.isPaused);
      } catch (error) {
        console.error("Failed to fetch global pause status:", error);
        setIsGlobalPaused(false); // Default to not paused if we can't fetch
      }
      
      // Fetch the user's junior note from the backend
      const fetchedNote = await cdpService.getJuniorNotes(userAddress);
      
      if (fetchedNote) {
        // Use the real claimable amount from the backend
        const userNote: UserJuniorNote = {
          ...fetchedNote,
          claimableAmount: fetchedNote.claimableAmount || "0"
        };
        setNote(userNote);
      } else {
        setNote(null);
      }
      
      // Reset action states
      setShowClaimButton(false);
      setActionLoading(false);
      
    } catch (error) {
      console.error("Failed to fetch junior note:", error);
      toast({
        title: "Error",
        description: "Failed to load junior note. Please try again.",
        variant: "destructive",
      });
      setNote(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userAddress, toast, guestMode]);

  // Handle claimable amount click
  const handleClaimableClick = () => {
    if (parseFloat(note?.claimableAmount || "0") > 0 && !isGlobalPaused) {
      setShowClaimButton(!showClaimButton);
    }
  };

  // Handle claim action
  const handleClaimAction = async () => {
    if (!note) return;


    setActionLoading(true);
    
    try {
      // Call the backend to claim junior note rewards
      const result = await cdpService.claimJuniorNote();
      
      if (result.status === "success") {
        toast({
          title: "Claim Successful",
          description: (
            <div className="space-y-2">
              <p>Transaction completed successfully</p>
              <CopyableHash 
                hash={result.hash}
                truncate={true}
                truncateLength={12}
              />
            </div>
          ),
        });
      } else {
        throw new Error("Claim transaction failed");
      }

      // Hide claim button after successful action
      setShowClaimButton(false);
      
      // Refresh note data
      await fetchJuniorNote();
      
      // Call the callback to refresh other components
      if (onNoteActionSuccess) {
        onNoteActionSuccess();
      }
      
    } catch (error) {
      console.error("Failed to claim:", error);
      toast({
        title: "Transaction Failed",
        description: "Failed to claim. Please try again.",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };


  useEffect(() => {
    fetchJuniorNote();
  }, [refreshTrigger, fetchJuniorNote]);

  const handleRefresh = () => {
    fetchJuniorNote(true);
  };

  // Guest mode: show sign-in prompt (user-specific data requires login)
  if (guestMode) {
    return (
      <div className="text-center py-6">
        <p className="text-sm text-muted-foreground mb-4">
          Sign in to view your Junior Note details, claimable rewards, and remaining cap.
        </p>
        <Button
          onClick={() => {
            const theme = localStorage.getItem('theme') || 'light';
            window.location.href = `/login?theme=${theme}`;
          }}
        >
          Sign In to View Your Junior Note
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <RefreshCw className="h-6 w-6 animate-spin mr-2 text-blue-500" />
        <div className="text-muted-foreground">Loading junior note...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="text-sm text-muted-foreground">Cover bad debt to participate in recovery rewards</div>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center text-xs font-semibold text-green-500">
            JN
          </div>
          <div>
            <h4 className="font-semibold">Junior Note</h4>
            <Badge variant="secondary" className="mt-1">Active</Badge>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh junior note data"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs text-muted-foreground mb-1">Remaining Cap</p>
          <p className="font-semibold">{formatNumber(parseFloat(formatWeiToDecimalHP(note.capUSDST, 18)))} USDST</p>
          <p className="text-xs text-muted-foreground">Max rewards left</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Claimable Now</p>
          <p 
            className={`font-semibold ${
              parseFloat(note.claimableAmount) > 0 && !isGlobalPaused
                ? 'text-green-600 cursor-pointer hover:text-green-700 hover:underline' 
                : parseFloat(note.claimableAmount) > 0 && isGlobalPaused
                  ? 'text-muted-foreground cursor-not-allowed'
                  : 'text-muted-foreground'
            }`}
            onClick={handleClaimableClick}
            title={
              parseFloat(note.claimableAmount) > 0 && !isGlobalPaused
                ? "Click to claim rewards" 
                : parseFloat(note.claimableAmount) > 0 && isGlobalPaused
                  ? "Claim paused by admin"
                  : "No rewards available"
            }
          >
            {formatNumber(parseFloat(formatWeiToDecimalHP(note.claimableAmount, 18)))} USDST
          </p>
          <p className="text-xs text-muted-foreground">
            {parseFloat(note.claimableAmount) > 0 && !isGlobalPaused
              ? 'Click to claim' 
              : parseFloat(note.claimableAmount) > 0 && isGlobalPaused
                ? 'Claim paused'
                : 'No rewards'
            } • Gas-free calculation
          </p>
        </div>
      </div>

      {/* Claim Button - shown when claimable amount is clicked */}
      {showClaimButton && parseFloat(note.claimableAmount) > 0 && (
        <div className="mt-4 pt-4 border-t">
          <div>
            <div className="mb-2">
              <p className="text-xs text-muted-foreground">
                Transaction Fee: 0.01 USDST
              </p>
            </div>
            <Button 
              className="w-full" 
              onClick={handleClaimAction}
              disabled={actionLoading || isGlobalPaused}
            >
              {actionLoading 
                ? "Claiming..." 
                : isGlobalPaused
                  ? "Claim paused by admin at this time"
                  : `Claim ${formatNumber(parseFloat(formatWeiToDecimalHP(note.claimableAmount, 18)))} USDST`
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default JuniorNote;
