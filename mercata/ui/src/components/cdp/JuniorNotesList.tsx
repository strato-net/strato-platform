import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreVertical, RefreshCw } from "lucide-react";
import { cdpService } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { usdstAddress } from "@/lib/constants";

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

interface JuniorNote {
  id: string;                    // Unique identifier
  asset: string;                 // Collateral asset address
  assetSymbol: string;           // Asset symbol (e.g., "ETH", "WBTC")
  owner: string;                 // Owner address
  capUSDST: string;              // Remaining cap in wei (18 decimals)
  entryIndex: string;            // Entry index in RAY format (27 decimals)
  claimableAmount: string;       // Currently claimable amount in wei (18 decimals)
  createdAt: string;             // Creation timestamp
}

interface JuniorNotesListProps {
  refreshTrigger?: number;
  onNoteActionSuccess?: () => void;
}

const JuniorNotesList: React.FC<JuniorNotesListProps> = ({ refreshTrigger, onNoteActionSuccess }) => {
  const [notes, setNotes] = useState<JuniorNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();
  const { activeTokens } = useUserTokens();
  
  // State for active action and input amounts for each note
  const [activeActions, setActiveActions] = useState<Record<string, 'claim' | 'topup' | null>>({});
  const [inputAmounts, setInputAmounts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Get user's USDST balance for top-up validation
  const getUsdstBalance = (): string => {
    const usdstToken = activeTokens.find(token => 
      token.address.toLowerCase() === usdstAddress.toLowerCase()
    );
    return usdstToken?.balance || "0";
  };

  // Fetch junior notes from backend
  const fetchJuniorNotes = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      // For now, use dummy data since backend endpoints aren't implemented
      // In real implementation: const fetchedNotes = await cdpService.getJuniorNotes();
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Dummy data - simulate multiple junior notes
      const dummyNotes: JuniorNote[] = [
        {
          id: "note-1",
          asset: "0x93fb7295859b2d70199e0a4883b7c320cf874e6c",
          assetSymbol: "ETH",
          owner: "0x1234567890123456789012345678901234567890",
          capUSDST: "2200000000000000000000", // 2,200 USDST remaining
          entryIndex: "1000000000000000000000000000", // 1e27 RAY
          claimableAmount: "150000000000000000000", // 150 USDST claimable
          createdAt: "2024-01-15T10:30:00Z"
        },
        {
          id: "note-2", 
          asset: "0x1234567890123456789012345678901234567890",
          assetSymbol: "WBTC",
          owner: "0x1234567890123456789012345678901234567890",
          capUSDST: "550000000000000000000", // 550 USDST remaining
          entryIndex: "1050000000000000000000000000", // 1.05e27 RAY
          claimableAmount: "75000000000000000000", // 75 USDST claimable
          createdAt: "2024-01-20T14:45:00Z"
        }
      ];
      
      setNotes(dummyNotes);
      
      // Initialize state for each note
      const initialActiveActions: Record<string, null> = {};
      const initialAmounts: Record<string, string> = {};
      const initialLoading: Record<string, boolean> = {};
      dummyNotes.forEach(note => {
        initialActiveActions[note.id] = null;
        initialAmounts[note.id] = "";
        initialLoading[note.id] = false;
      });
      setActiveActions(initialActiveActions);
      setInputAmounts(initialAmounts);
      setActionLoading(initialLoading);
      
    } catch (error) {
      console.error("Failed to fetch junior notes:", error);
      toast({
        title: "Error",
        description: "Failed to load junior notes. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  // Handle dropdown action selection
  const handleActionSelect = (noteId: string, action: 'claim' | 'topup') => {
    const currentAction = activeActions[noteId];
    
    if (currentAction === action) {
      // If selecting the same action, hide the input/button
      setActiveActions(prev => ({ ...prev, [noteId]: null }));
      setInputAmounts(prev => ({ ...prev, [noteId]: "" }));
    } else {
      // Show the selected action input/button
      setActiveActions(prev => ({ ...prev, [noteId]: action }));
      setInputAmounts(prev => ({ ...prev, [noteId]: "" })); // Reset input amount
    }
  };

  // Handle input amount changes for top-up
  const handleInputChange = (noteId: string, value: string) => {
    setInputAmounts(prev => ({ ...prev, [noteId]: value }));
  };

  // Handle MAX button for top-up
  const handleMaxClick = (noteId: string) => {
    const balance = getUsdstBalance();
    if (balance && parseFloat(balance) > 0) {
      const formattedBalance = formatWeiToDecimal(balance, 18);
      setInputAmounts(prev => ({ ...prev, [noteId]: formattedBalance }));
    }
  };

  // Check if amount exceeds balance for top-up
  const isAmountAboveMax = (noteId: string): boolean => {
    const currentAmount = parseFloat(inputAmounts[noteId] || "0");
    const balance = getUsdstBalance();
    if (!balance) return false;
    
    const maxAmount = parseFloat(formatWeiToDecimal(balance, 18));
    return currentAmount > maxAmount;
  };

  // Handle actions (claim or top-up)
  const handleAction = async (noteId: string, action: 'claim' | 'topup') => {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    if (action === 'topup') {
      const amount = inputAmounts[noteId];
      if (!amount || parseFloat(amount) <= 0) {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid top-up amount",
          variant: "destructive",
        });
        return;
      }

      if (isAmountAboveMax(noteId)) {
        toast({
          title: "Insufficient Balance",
          description: "Amount exceeds your USDST balance",
          variant: "destructive",
        });
        return;
      }
    }

    setActionLoading(prev => ({ ...prev, [noteId]: true }));
    
    try {
      // Simulate API calls
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (action === 'claim') {
        const claimableAmount = parseFloat(formatWeiToDecimal(note.claimableAmount, 18));
        toast({
          title: "Claim Successful",
          description: `Claimed ${formatNumber(claimableAmount)} USDST from ${note.assetSymbol} note`,
        });
      } else {
        const topupAmount = parseFloat(inputAmounts[noteId]);
        toast({
          title: "Top-up Successful", 
          description: `Added ${formatNumber(topupAmount)} USDST to ${note.assetSymbol} note`,
        });
      }

      // Clear the input and reset states after successful action
      setInputAmounts(prev => ({ ...prev, [noteId]: "" }));
      setActiveActions(prev => ({ ...prev, [noteId]: null }));
      
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
      setActionLoading(prev => ({ ...prev, [noteId]: false }));
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
            <div className="text-gray-500">Loading junior notes...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (notes.length === 0) {
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
          {notes.map((note) => {
            const remainingCap = parseFloat(formatWeiToDecimal(note.capUSDST, 18));
            const claimableAmount = parseFloat(formatWeiToDecimal(note.claimableAmount, 18));
            const hasClaimable = claimableAmount > 0;
            const activeAction = activeActions[note.id];
            const inputAmount = inputAmounts[note.id] || "";
            const isLoading = actionLoading[note.id];
            
            return (
              <div
                key={note.id}
                className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-xs font-semibold text-green-700">
                      {note.assetSymbol.slice(0, 2)}
                    </div>
                    <div>
                      <h4 className="font-semibold">{note.assetSymbol} Junior Note</h4>
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
                        onClick={() => handleActionSelect(note.id, 'claim')}
                        disabled={!hasClaimable}
                      >
                        Claim Rewards
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleActionSelect(note.id, 'topup')}>
                        Top-up Note
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Remaining Cap</p>
                    <p className="font-semibold">{formatNumber(remainingCap)} USDST</p>
                    <p className="text-xs text-gray-400">Max rewards left</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Claimable Now</p>
                    <p className={`font-semibold ${hasClaimable ? 'text-green-600' : 'text-gray-600'}`}>
                      {formatNumber(claimableAmount)} USDST
                    </p>
                    <p className="text-xs text-gray-400">{hasClaimable ? 'Ready to claim' : 'No rewards'}</p>
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
                            onChange={(e) => handleInputChange(note.id, e.target.value)}
                            className={`flex-1 ${
                              isAmountAboveMax(note.id)
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
                            onClick={() => handleMaxClick(note.id)}
                          >
                            MAX
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="min-w-[80px]"
                            onClick={() => handleAction(note.id, 'topup')}
                            disabled={isLoading || isAmountAboveMax(note.id) || !inputAmount || parseFloat(inputAmount) <= 0}
                          >
                            {isLoading ? "Adding..." : "Top-up"}
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
                          onClick={() => handleAction(note.id, 'claim')}
                          disabled={isLoading || !hasClaimable}
                        >
                          {isLoading ? "Claiming..." : `Claim ${formatNumber(claimableAmount)} USDST`}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default JuniorNotesList;
