import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, RefreshCw } from "lucide-react";
import { cdpService, JuniorNote } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { usdstAddress } from "@/lib/constants";
import CopyableHash from "../common/CopyableHash";

// Convert wei string to decimal for display
const formatWeiToDecimal = (weiString: string, decimals: number): string => {
  if (!weiString || weiString === '0') return '0';
  
  const wei = BigInt(weiString);
  const divisor = BigInt(10) ** BigInt(decimals);
  const quotient = wei / divisor;
  const remainder = wei % divisor;
  
  if (remainder === 0n) {
    return quotient.toString();
  }
  
  const decimalPart = remainder.toString().padStart(decimals, '0');
  const trimmedDecimal = decimalPart.replace(/0+$/, '');
  
  if (trimmedDecimal === '') {
    return quotient.toString();
  }
  
  return `${quotient}.${trimmedDecimal}`;
};

// Format large numbers for display
const formatNumber = (num: number | string, decimals: number = 2): string => {
  const value = typeof num === 'string' ? parseFloat(num) : num;
  if (isNaN(value)) return '0';
  
  if (value >= 1e9) {
    return (value / 1e9).toFixed(1) + 'B';
  }
  if (value >= 1e6) {
    return (value / 1e6).toFixed(1) + 'M';
  }
  if (value >= 1e3) {
    return (value / 1e3).toFixed(1) + 'K';
  }
  
  return value.toFixed(decimals);
};

interface UserJuniorNote extends JuniorNote {
  claimableAmount: string;       // Currently claimable amount in wei (18 decimals) - calculated from backend data
}

interface JuniorNotesListProps {
  refreshTrigger?: number;
  onNoteActionSuccess?: () => void;
}

const JuniorNotesList: React.FC<JuniorNotesListProps> = ({ refreshTrigger, onNoteActionSuccess }) => {
  const [note, setNote] = useState<UserJuniorNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();
  const { userAddress } = useUser();
  
  // State for active action and input amounts for the note
  const [activeAction, setActiveAction] = useState<'claim' | 'topup' | null>(null);
  const [inputAmount, setInputAmount] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  // Get user's USDST balance for top-up validation
  const getUsdstBalance = (): string => {
    const usdstToken = activeTokens.find(token => 
      token.address.toLowerCase() === usdstAddress.toLowerCase()
    );
    return usdstToken?.balance || "0";
  };

  // Fetch junior notes from backend
  const fetchJuniorNotes = useCallback(async (showRefreshing = false) => {
    if (!userAddress) {
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
      setActiveAction(null);
      setInputAmount("");
      setActionLoading(false);
      
    } catch (error) {
      console.error("Failed to fetch junior notes:", error);
      toast({
        title: "Error",
        description: "Failed to load junior notes. Please try again.",
        variant: "destructive",
      });
      setNote(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userAddress, toast]);

  // Handle dropdown action selection
  const handleActionSelect = (action: 'claim' | 'topup') => {
    if (activeAction === action) {
      // If selecting the same action, hide the input/button
      setActiveAction(null);
      setInputAmount("");
    } else {
      // Show the selected action input/button
      setActiveAction(action);
      setInputAmount(""); // Reset input amount
    }
  };

  // Handle input amount changes for top-up
  const handleInputChange = (value: string) => {
    setInputAmount(value);
  };

  // Handle MAX button for top-up
  const handleMaxClick = () => {
    const balance = getUsdstBalance();
    if (balance && parseFloat(balance) > 0) {
      const formattedBalance = formatWeiToDecimal(balance, 18);
      setInputAmount(formattedBalance);
    }
  };

  // Check if amount exceeds balance for top-up
  const isAmountAboveMax = (): boolean => {
    const currentAmount = parseFloat(inputAmount || "0");
    const balance = getUsdstBalance();
    if (!balance) return false;
    
    const maxAmount = parseFloat(formatWeiToDecimal(balance, 18));
    return currentAmount > maxAmount;
  };

  // Handle actions (claim or top-up)
  const handleAction = async (action: 'claim' | 'topup') => {
    if (!note) return;

    if (action === 'topup') {
      if (!inputAmount || parseFloat(inputAmount) <= 0) {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid top-up amount",
          variant: "destructive",
        });
        return;
      }

      if (isAmountAboveMax()) {
        toast({
          title: "Insufficient Balance",
          description: "Amount exceeds your USDST balance",
          variant: "destructive",
        });
        return;
      }
    }

    setActionLoading(true);
    
    try {
      if (action === 'claim') {
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
      } else {
        // Top-up functionality
        const topupAmount = parseFloat(inputAmount);
        const amountInWei = (BigInt(Math.floor(topupAmount * 1e6)) * BigInt(1e12)).toString(); // Convert to 18 decimals
        
        const result = await cdpService.topUpJuniorNote(amountInWei);
        
        if (result.status === "success") {
          toast({
            title: "Top-up Successful",
            description: (
              <div className="space-y-2">
                <p>Added {formatNumber(topupAmount)} USDST to Junior Note</p>
                <CopyableHash 
                  hash={result.hash}
                  truncate={true}
                  truncateLength={12}
                />
              </div>
            ),
          });
        } else {
          throw new Error("Top-up transaction failed");
        }
      }

      // Clear the input and reset states after successful action
      setInputAmount("");
      setActiveAction(null);
      
      // Refresh notes data
      await fetchJuniorNotes();
      
      // Call the callback to refresh other components
      if (onNoteActionSuccess) {
        onNoteActionSuccess();
      }
      
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      toast({
        title: "Transaction Failed",
        description: `Failed to ${action}. Please try again.`,
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
    }
  };


  useEffect(() => {
    fetchJuniorNotes();
  }, [refreshTrigger, fetchJuniorNotes]);

  const handleRefresh = () => {
    fetchJuniorNotes(true);
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Your Junior Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin mr-2 text-blue-500" />
            <div className="text-gray-500">Loading junior notes...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!note) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Your Junior Notes
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="text-gray-500 mb-4">No junior notes found</div>
            <div className="text-sm text-gray-400">Open your first junior note to participate in bad debt recovery</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Your Junior Notes
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Active
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <style>{`
          input[type="number"]::-webkit-outer-spin-button,
          input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none;
            margin: 0;
          }
          input[type="number"] {
            -moz-appearance: textfield;
          }
        `}</style>
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-xs font-semibold text-green-700">
                  JN
                </div>
                <div>
                  <h4 className="font-semibold">Junior Note</h4>
                  <Badge variant="secondary" className="mt-1">Active</Badge>
                </div>
              </div>
              
              {/* 3-dot options menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem 
                    onClick={() => handleActionSelect('claim')}
                    disabled={parseFloat(note.claimableAmount) <= 0}
                  >
                    Claim Rewards
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleActionSelect('topup')}>
                    Top-up Note
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500 mb-1">Remaining Cap</p>
                <p className="font-semibold">{formatNumber(parseFloat(formatWeiToDecimal(note.capUSDST, 18)))} USDST</p>
                <p className="text-xs text-gray-400">Max rewards left</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Claimable Now</p>
                <p className={`font-semibold ${parseFloat(note.claimableAmount) > 0 ? 'text-green-600' : 'text-gray-600'}`}>
                  {formatNumber(parseFloat(formatWeiToDecimal(note.claimableAmount, 18)))} USDST
                </p>
                <p className="text-xs text-gray-400">
                  {parseFloat(note.claimableAmount) > 0 ? 'Ready to claim' : 'No rewards'} • Gas-free calculation
                </p>
              </div>
            </div>

            {/* Conditional Action Input/Button */}
            {activeAction && (
              <div className="mt-4 pt-4 border-t">
                {activeAction === 'topup' ? (
                  <div>
                    <div className="mb-2">
                      <p className="text-xs text-gray-500">
                        Transaction Fee: 0.02 USDST
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Top-up amount"
                        value={inputAmount}
                        onChange={(e) => handleInputChange(e.target.value)}
                        className={`flex-1 ${
                          isAmountAboveMax()
                            ? 'text-red-600 bg-red-50 border-red-300'
                            : ''
                        }`}
                        type="number"
                        step="any"
                      />
                      <Button 
                        variant="outline"
                        size="sm" 
                        className="min-w-[50px]"
                        onClick={handleMaxClick}
                      >
                        MAX
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="min-w-[80px]"
                        onClick={() => handleAction('topup')}
                        disabled={actionLoading || isAmountAboveMax() || !inputAmount || parseFloat(inputAmount) <= 0}
                      >
                        {actionLoading ? "Adding..." : "Top-up"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="mb-2">
                      <p className="text-xs text-gray-500">
                        Transaction Fee: 0.01 USDST
                      </p>
                    </div>
                    <Button 
                      className="w-full" 
                      onClick={() => handleAction('claim')}
                      disabled={actionLoading || parseFloat(note.claimableAmount) <= 0}
                    >
                      {actionLoading ? "Claiming..." : `Claim ${formatNumber(parseFloat(formatWeiToDecimal(note.claimableAmount, 18)))} USDST`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default JuniorNotesList;
