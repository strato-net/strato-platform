import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MoreVertical, Loader2 } from "lucide-react";
import { cdpService, Vault } from "@/services/cdpService";
import { useToast } from "@/hooks/use-toast";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { useOracleContext } from "@/context/OracleContext";
import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { formatWeiToDecimalHP, formatNumber, formatDecimalToWeiHP, formatNumberWithCommas, parseCommaNumber } from "@/utils/numberUtils";
import { getAssetColor } from "@/components/cdp/v2/cdpUtils";
import { usdstAddress } from "@/lib/constants";
import type { WalletTxProgressEvent } from "@/lib/axios";
import VaultActionProgressModal, { type VaultActionProgressStep } from "./VaultActionProgressModal";
import { isTxPending, isTxSubmitted } from "@/utils/transactionStatus";

// Calculate Health Factor: CR / LT (Liquidation Threshold)
const calculateHealthFactor = (cr: number, lt: number): number => {
  return cr / lt;
};

// Get health factor color based on value
const getHealthFactorColor = (healthFactor: number): string => {
  if (healthFactor >= 1.5) return "text-foreground"; // Healthy - standard text color
  if (healthFactor >= 1.0) return "text-warning"; // Warning
  return "text-destructive"; // Danger
};

// Format percentage with reasonable precision
const formatPercentage = (num: number, decimals: number = 2): string => {
  if (isNaN(num)) return '0.00%';
  return num.toFixed(decimals) + '%';
};

interface VaultsListProps {
  refreshTrigger?: number; // Increment this to trigger a refresh
  onVaultActionSuccess?: () => void; // Callback when vault actions succeed
}

type VaultAction = 'deposit' | 'withdraw' | 'mint' | 'repay';

const getVaultActionLabel = (
  action: VaultAction,
  symbol: string,
  useMaxEndpoint: boolean,
  useRepayAll: boolean
): string => {
  if (action === 'deposit') return `Deposit ${symbol}`;
  if (action === 'withdraw') return useMaxEndpoint ? `Withdraw Max ${symbol}` : `Withdraw ${symbol}`;
  if (action === 'mint') return useMaxEndpoint ? "Mint Max USDST" : "Mint USDST";
  if (action === 'repay') return useRepayAll ? "Repay All USDST" : "Repay USDST";
  return "Vault Action";
};

const getStepLabel = (
  functionName: string | undefined,
  action: VaultAction,
  symbol: string,
  useMaxEndpoint: boolean,
  useRepayAll: boolean
): string => {
  switch (functionName) {
    case "approve":
      return action === "repay" ? "Approve USDST" : `Approve ${symbol}`;
    case "deposit":
      return `Deposit ${symbol}`;
    case "withdraw":
      return `Withdraw ${symbol}`;
    case "withdrawMax":
      return `Withdraw Max ${symbol}`;
    case "mint":
      return "Mint USDST";
    case "mintMax":
      return "Mint Max USDST";
    case "repay":
      return "Repay USDST";
    case "repayAll":
      return "Repay All USDST";
    default:
      return getVaultActionLabel(action, symbol, useMaxEndpoint, useRepayAll);
  }
};

const getStepDescription = (
  functionName: string | undefined,
  action: VaultAction,
  symbol: string,
  amount: string,
  useMaxEndpoint: boolean,
  useRepayAll: boolean
): string => {
  switch (functionName) {
    case "approve":
      return action === "repay"
        ? `Approve ${amount} USDST for repayment.`
        : `Approve ${amount} ${symbol} for this vault action.`;
    case "deposit":
      return `Deposit ${amount} ${symbol} into your vault.`;
    case "withdraw":
      return `Withdraw ${amount} ${symbol} from your vault.`;
    case "withdrawMax":
      return `Withdraw the maximum safe ${symbol} amount from your vault.`;
    case "mint":
      return `Mint ${amount} USDST against this vault.`;
    case "mintMax":
      return "Mint the maximum safe USDST amount against this vault.";
    case "repay":
      return `Repay ${amount} USDST against this vault.`;
    case "repayAll":
      return "Repay this vault's outstanding USDST debt.";
    default:
      return getVaultActionLabel(action, symbol, useMaxEndpoint, useRepayAll);
  }
};

const buildProgressStep = (
  index: number,
  functionName: string | undefined,
  action: VaultAction,
  symbol: string,
  amount: string,
  useMaxEndpoint: boolean,
  useRepayAll: boolean
): VaultActionProgressStep => ({
  id: `${functionName || action}-${index}`,
  label: getStepLabel(functionName, action, symbol, useMaxEndpoint, useRepayAll),
  description: getStepDescription(functionName, action, symbol, amount, useMaxEndpoint, useRepayAll),
  status: "pending",
});

const buildInitialProgressSteps = (
  action: VaultAction,
  symbol: string,
  amount: string,
  useMaxEndpoint: boolean,
  useRepayAll: boolean
): VaultActionProgressStep[] => {
  if (action === "deposit") {
    return [
      buildProgressStep(0, "approve", action, symbol, amount, useMaxEndpoint, useRepayAll),
      buildProgressStep(1, "deposit", action, symbol, amount, useMaxEndpoint, useRepayAll),
    ];
  }

  if (action === "repay") {
    return [
      buildProgressStep(0, "approve", action, symbol, amount, useMaxEndpoint, useRepayAll),
      buildProgressStep(1, useRepayAll ? "repayAll" : "repay", action, symbol, amount, useMaxEndpoint, useRepayAll),
    ];
  }

  if (action === "withdraw") {
    return [buildProgressStep(0, useMaxEndpoint ? "withdrawMax" : "withdraw", action, symbol, amount, useMaxEndpoint, useRepayAll)];
  }

  return [buildProgressStep(0, useMaxEndpoint ? "mintMax" : "mint", action, symbol, amount, useMaxEndpoint, useRepayAll)];
};

/**
 * VaultsList component displays user's CDP vaults
 * Each vault represents a collateral position with corresponding debt
 * Connected to backend API for real-time data
 */
const VaultsList: React.FC<VaultsListProps> = ({ refreshTrigger, onVaultActionSuccess }) => {
  const [positions, setPositions] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { activeTokens, fetchTokens } = useUserTokens();
  const { fetchUsdstBalance, earningAssets, inactiveTokens } = useTokenContext();
  const { getPrice } = useOracleContext();
  const { isConnected } = useAccount();
  const { isAppAuthenticated } = useUser();
  const useExternalWalletSigning = isConnected && !isAppAuthenticated;
  
  // State for active action and input amounts for each position
  const [activeActions, setActiveActions] = useState<Record<string, 'deposit' | 'withdraw' | 'mint' | 'repay' | null>>({});
  const [inputAmounts, setInputAmounts] = useState<Record<string, string>>({});
  const [maxStates, setMaxStates] = useState<Record<string, boolean>>({});
  const [maxValues, setMaxValues] = useState<Record<string, number>>({});  // Store max values for comparison
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});  // Track loading state per asset
  const [isGlobalPaused, setIsGlobalPaused] = useState<boolean>(false);
  const [assetPauseStates, setAssetPauseStates] = useState<Record<string, boolean>>({});
  const [assetSupportedStates, setAssetSupportedStates] = useState<Record<string, boolean>>({});
  const [processingActions, setProcessingActions] = useState<Record<string, boolean>>({});
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [progressActionLabel, setProgressActionLabel] = useState("Vault Action");
  const [progressSteps, setProgressSteps] = useState<VaultActionProgressStep[]>([]);
  const [progressError, setProgressError] = useState<string | undefined>();

  // Fetch positions from backend
  useEffect(() => {
    const fetchPositions = async () => {
      setLoading(true);
      try {
        const fetchedPositions = await cdpService.getVaults();
        setPositions(fetchedPositions);

        // Check global pause status
        try {
          const globalPauseStatus = await cdpService.getGlobalPaused();
          setIsGlobalPaused(globalPauseStatus.isPaused);
        } catch (error) {
          console.error("Failed to fetch global pause status:", error);
          setIsGlobalPaused(true); // Default to paused if we can't fetch
        }
        
        // Initialize state for each position and check asset pause/support status
        const initialActiveActions: Record<string, null> = {};
        const initialAmounts: Record<string, string> = {};
        const initialMaxStates: Record<string, boolean> = {};
        const initialAssetPauseStates: Record<string, boolean> = {};
        const initialAssetSupportedStates: Record<string, boolean> = {};
        
        // Check pause and support status for each asset
        for (const position of fetchedPositions) {
          initialActiveActions[position.asset] = null;
          initialAmounts[position.asset] = "";
          initialMaxStates[position.asset] = false;
          
          try {
            const assetConfig = await cdpService.getAssetConfig(position.asset);
            initialAssetPauseStates[position.asset] = assetConfig?.isPaused || false;
            initialAssetSupportedStates[position.asset] = assetConfig?.isSupported !== false; // Default to true if not found
          } catch (error) {
            console.error(`Failed to fetch asset config for ${position.symbol}:`, error);
            initialAssetPauseStates[position.asset] = true; // Default to paused if we can't fetch
            initialAssetSupportedStates[position.asset] = false; // Default to unsupported if we can't fetch
          }
        }
        
        setActiveActions(initialActiveActions);
        setInputAmounts(initialAmounts);
        setMaxStates(initialMaxStates);
        setAssetPauseStates(initialAssetPauseStates);
        setAssetSupportedStates(initialAssetSupportedStates);
      } catch (error) {
        console.error("Failed to fetch positions:", error);
        toast({
          title: "Error",
          description: "Failed to load your vaults. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPositions();
  }, [toast, refreshTrigger]);

  // Handle dropdown action selection
  const handleActionSelect = (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay') => {
    const currentAction = activeActions[asset];
    
    if (currentAction === action) {
      // If selecting the same action, hide the input/button
      setActiveActions(prev => ({ ...prev, [asset]: null }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" }));
      setMaxStates(prev => ({ ...prev, [asset]: false }));
    } else {
      // Show the selected action input/button
      setActiveActions(prev => ({ ...prev, [asset]: action }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" })); // Reset input amount
      setMaxStates(prev => ({ ...prev, [asset]: false })); // Reset max state
    }
  };

  // Check if amount is above maximum for the given action (synchronous)
  const isAmountAboveMax = (asset: string, inputAmount: string): boolean => {
    const parsed = parseCommaNumber(inputAmount || "0");
    const currentAmount = parseFloat(parsed);
    if (currentAmount <= 0) return false;
    
    const maxAmount = maxValues[asset] || 0;
    return currentAmount > maxAmount;
  };

  // Handle input amount changes
  const handleInputChange = async (asset: string, value: string, event?: React.ChangeEvent<HTMLInputElement>) => {
    // Store cursor position before any state updates
    const cursorPosition = event?.target.selectionStart || 0;
    const inputElement = event?.target;
    
    // Get the part before cursor (without commas) to track position in unformatted string
    const beforeCursor = value.substring(0, cursorPosition);
    const beforeCursorNoCommas = parseCommaNumber(beforeCursor);
    
    // Remove commas and validate format
    const parsed = parseCommaNumber(value);
    
    // Allow: empty, numbers, single decimal point, or number with decimal
    if (parsed !== "" && parsed !== "." && !/^\d*\.?\d*$/.test(parsed)) {
      // Invalid format, don't update (prevents invalid input)
      return;
    }
    
    // Format with commas for display
    const formatted = formatNumberWithCommas(parsed);
    
    const currentAmount = parseFloat(parsed || "0");
    const position = positions.find(p => p.asset === asset);
    const currentAction = activeActions[asset];
    
    // Always update the input amount first to prevent cursor jumping
    setInputAmounts(prev => ({ ...prev, [asset]: formatted }));
    
    // Restore cursor position after state update, adjusting for added/removed commas
    if (inputElement) {
      setTimeout(() => {
        // Find position in formatted string matching the unformatted cursor position
        let unformattedPos = 0;
        let formattedPos = 0;
        
        while (formattedPos < formatted.length && unformattedPos < beforeCursorNoCommas.length) {
          if (formatted[formattedPos] !== ',') {
            unformattedPos++;
          }
          formattedPos++;
        }
        
        inputElement.setSelectionRange(formattedPos, formattedPos);
      }, 0);
    }
    
    if (!position || !currentAction) {
      return;
    }

    try {
      const maxValue = await calculateMaxValue(position, currentAction);
      const maxAmount = parseFloat(maxValue);
      
      // Store the max value for comparison
      setMaxValues(prev => ({ ...prev, [asset]: maxAmount }));
      
      const isTypingMaxAmount = Math.abs(currentAmount - maxAmount) < 0.000001 && maxAmount > 0;
      
      if (isTypingMaxAmount && !maxStates[asset]) {
        // User typed the max amount, activate MAX styling
        setMaxStates(prev => ({ ...prev, [asset]: true }));
      } else if (maxStates[asset]) {
        // If MAX is currently enabled, check if user changed the value
        if (currentAmount < maxAmount) {
          // User reduced the amount below max, disable MAX mode
          setMaxStates(prev => ({ ...prev, [asset]: false }));
        } else if (currentAmount > maxAmount) {
          // User increased above max, disable MAX mode so red styling shows
          setMaxStates(prev => ({ ...prev, [asset]: false }));
        }
      }
    } catch (error) {
      console.error("Failed to calculate max value during input change:", error);
    }
  };

  // Calculate maximum allowed value for each action
  const calculateMaxValue = async (position: Vault, action: 'deposit' | 'withdraw' | 'mint' | 'repay'): Promise<string> => {
    switch (action) {
      case 'deposit': {
        // Find the user's balance for this token
        const userToken = activeTokens.find(token => 
          token.address.toLowerCase() === position.asset.toLowerCase()
        );
        
        if (userToken?.balance) {
          // Convert balance from wei to decimal format
          return formatWeiToDecimalHP(userToken.balance, position.collateralAmountDecimals);
        }
        
        // Fallback to 0 if no balance found
        return "0";
      }
      
      case 'withdraw': {
        try {
          // Use the backend endpoint that simulates the contract's withdrawMax logic
          const result = await cdpService.getMaxWithdraw(position.asset);
          // Convert from wei to decimal format
          return formatWeiToDecimalHP(result.maxAmount, position.collateralAmountDecimals);
        } catch (error) {
          console.error("Failed to get max withdraw amount:", error);
          return "0";
        }
      }
      
      case 'mint': {
        try {
          // Use the backend endpoint that calculates max mintable amount (now without safety buffer)
          const result = await cdpService.getMaxMint(position.asset);
          // Convert from wei to decimal format (USDST is 18 decimals)
          return formatWeiToDecimalHP(result.maxAmount, 18);
        } catch (error) {
          console.error("Failed to get max mint amount:", error);
          return "0";
        }
      }
      
      case 'repay': {
        // Maximum repay is min(current debt, available USDST balance)
        const currentDebt = parseFloat(formatWeiToDecimalHP(position.debtAmount, 18));
        const availableUSDST = parseFloat(formatWeiToDecimalHP(activeTokens.find(token => 
          token.address.toLowerCase() === usdstAddress.toLowerCase()
        )?.balance || "0", 18));
        
        const maxRepayAmount = Math.min(currentDebt, availableUSDST);
        return maxRepayAmount.toString();
      }
      
      default:
        return "0";
    }
  };

  // Handle MAX button click
  const handleMaxClick = async (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay') => {
    const position = positions.find(p => p.asset === asset);
    if (!position) return;

    const isCurrentlyMax = maxStates[asset];
    
    if (isCurrentlyMax) {
      // If currently in max state, disable it and clear input
      setMaxStates(prev => ({ ...prev, [asset]: false }));
      setInputAmounts(prev => ({ ...prev, [asset]: "" }));
    } else {
      try {
        // Enable max state and set max value
        const maxValue = await calculateMaxValue(position, action);
        const maxAmount = parseFloat(maxValue);
        
        // Store the max value for comparison
        setMaxValues(prev => ({ ...prev, [asset]: maxAmount }));
        setMaxStates(prev => ({ ...prev, [asset]: true }));
        // Format max value with commas for display
        const formattedMaxValue = formatNumberWithCommas(maxValue);
        setInputAmounts(prev => ({ ...prev, [asset]: formattedMaxValue }));
      } catch (error) {
        console.error("Failed to calculate max value:", error);
        toast({
          title: "Error",
          description: "Failed to calculate maximum amount. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  // Calculate preview values based on input
  const calculatePreviewValues = (position: Vault, action: 'deposit' | 'withdraw' | 'mint' | 'repay', inputAmount: string) => {
    const parsed = parseCommaNumber(inputAmount);
    const amount = parseFloat(parsed);
    if (isNaN(amount) || amount <= 0) return null;

    // Convert wei strings to decimal numbers for calculations
    const currentCollateral = parseFloat(formatWeiToDecimalHP(position.collateralAmount, position.collateralAmountDecimals));
    const currentDebt = parseFloat(formatWeiToDecimalHP(position.debtAmount, 18));
    const currentCollateralUSD = parseFloat(formatWeiToDecimalHP(position.collateralValueUSD, 18));
    const currentDebtUSD = currentDebt; // USDST is 1:1 with USD
    
    // Get the actual token price from oracle
    const priceWei = getPrice(position.asset);
    let pricePerUnit = 0;
    
    if (priceWei) {
      // Convert price from wei (18 decimals) to decimal
      pricePerUnit = parseFloat(formatWeiToDecimalHP(priceWei, 18));
    } else {
      // Fallback: calculate from current values if oracle price is not available
      if (currentCollateral > 0 && currentCollateralUSD > 0) {
        pricePerUnit = currentCollateralUSD / currentCollateral;
      }
    }
    
    let newCollateral = currentCollateral;
    let newCollateralUSD = currentCollateralUSD;
    let newDebt = currentDebt;
    let newDebtUSD = currentDebtUSD;

    switch (action) {
      case 'deposit':
        newCollateral = currentCollateral + amount;
        newCollateralUSD = newCollateral * pricePerUnit;
        break;
      case 'withdraw':
        newCollateral = Math.max(0, currentCollateral - amount);
        newCollateralUSD = newCollateral * pricePerUnit;
        break;
      case 'mint':
        newDebt = currentDebt + amount;
        newDebtUSD = newDebt; // Assuming 1:1 USD peg for USDST
        break;
      case 'repay':
        newDebt = Math.max(0, currentDebt - amount);
        newDebtUSD = newDebt;
        break;
    }

    // Calculate new health factor with safety checks
    let newCR = 999999;
    let newHealthFactor = Infinity;
    
    if (newDebt > 0 && newDebtUSD > 0) {
      newCR = (newCollateralUSD / newDebtUSD) * 100;
      newHealthFactor = calculateHealthFactor(newCR, position.liquidationRatio);
    }

    return {
      collateralAmount: formatNumber(newCollateral),
      collateralValueUSD: formatNumber(newCollateralUSD),
      debtAmount: formatNumber(newDebt),
      healthFactor: newHealthFactor
    };
  };

  // Validate debt floor and ceiling constraints for mint actions
  const validateDebtConstraints = async (asset: string, mintAmountDecimal: number): Promise<boolean> => {
    if (mintAmountDecimal <= 0) return true;

    try {
      // Get current asset debt info
      const debtInfo = await cdpService.getAssetDebtInfo(asset);
      
      // Keep everything in wei for accurate comparison (like blockchain)
      const currentAssetTotalDebtWei = BigInt(debtInfo.currentTotalDebt);
      const debtFloorWei = BigInt(debtInfo.debtFloor);
      const debtCeilingWei = BigInt(debtInfo.debtCeiling);
      
      // Convert mint amount to wei (18 decimals) with exact precision
      const mintAmountWei = BigInt(formatDecimalToWeiHP(mintAmountDecimal.toString(), 18));

      // Check debt ceiling constraint (total debt for this asset across all users)
      if (debtCeilingWei > 0n) {
        const newAssetTotalDebtWei = currentAssetTotalDebtWei + mintAmountWei;
        if (newAssetTotalDebtWei > debtCeilingWei) {
          const availableRoomWei = debtCeilingWei > currentAssetTotalDebtWei ? debtCeilingWei - currentAssetTotalDebtWei : 0n;
          const availableRoom = parseFloat(formatWeiToDecimalHP(availableRoomWei.toString(), 18));
          const debtCeilingDecimal = parseFloat(formatWeiToDecimalHP(debtCeilingWei.toString(), 18));
          
          toast({
            title: "Debt Ceiling Exceeded",
            description: `Cannot mint ${mintAmountDecimal.toFixed(2)} USDST. Maximum available: ${availableRoom.toFixed(2)} USDST (asset debt ceiling: ${debtCeilingDecimal.toFixed(2)} USDST)`,
            variant: "destructive",
          });
          return false;
        }
      }

      // Check debt floor constraint (per-user minimum debt)
      // We need to simulate the exact contract calculation to avoid precision gaps
      if (debtFloorWei > 0n) {
        const position = positions.find(p => p.asset === asset);
        if (position) {
          // Simulate the exact contract calculation:
          // 1. Convert mint amount to scaled debt: scaledAdd = (amountUSD * RAY) / rateAccumulator
          // 2. Add to existing scaled debt: newScaledDebt = scaledDebt + scaledAdd  
          // 3. Convert back to debt: totalDebtAfter = (newScaledDebt * rateAccumulator) / RAY
          
          const RAY = BigInt("1000000000000000000000000000"); // 1e27
          const existingScaledDebtWei = BigInt(position.scaledDebt || "0");
          const rateAccumulatorWei = BigInt(position.rateAccumulator || "1000000000000000000000000000");
          
          // Step 1: Convert mint amount to scaled debt (same as contract)
          const scaledAddWei = (mintAmountWei * RAY + rateAccumulatorWei - 1n) / rateAccumulatorWei;
          
          // Step 2: Add to existing scaled debt (same as contract)
          const newScaledDebtWei = existingScaledDebtWei + scaledAddWei;
          
          // Step 3: Convert back to debt for floor check (same as contract)
          const totalDebtAfterWei = (newScaledDebtWei * rateAccumulatorWei) / RAY;
          

          if (totalDebtAfterWei > 0n && totalDebtAfterWei < debtFloorWei) {
            toast({
              title: "Below Debt Floor",
              description: `Mint more USDST to reach the minimum debt floor`,
              variant: "destructive",
            });
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error("Failed to validate debt constraints:", error);
      // Don't block the transaction if validation fails
      return true;
    }
  };

  // Handle action button clicks
  const handleAction = async (asset: string, action: 'deposit' | 'withdraw' | 'mint' | 'repay', amount: string) => {
    // Parse commas from input
    const parsedAmount = parseCommaNumber(amount);
    if (!parsedAmount || parseFloat(parsedAmount) <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount greater than 0",
        variant: "destructive",
      });
      return;
    }

    // Validate debt constraints for mint actions
    if (action === 'mint') {
      const mintAmountDecimal = parseFloat(parsedAmount);
      const isValid = await validateDebtConstraints(asset, mintAmountDecimal);
      if (!isValid) {
        return; // Validation failed, error already shown
      }
    }

    const position = positions.find(p => p.asset === asset);
    if (!position) {
      toast({
        title: "Vault Not Found",
        description: "Could not find the selected vault. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }

    const useMaxEndpoint = !!maxStates[asset] && (action === 'withdraw' || action === 'mint');
    let useRepayAll = false;
    if (action === 'repay' && maxStates[asset]) {
      const currentDebt = parseFloat(formatWeiToDecimalHP(position.debtAmount, 18));
      const availableUSDST = parseFloat(formatWeiToDecimalHP(activeTokens.find(token =>
        token.address.toLowerCase() === usdstAddress.toLowerCase()
      )?.balance || "0", 18));
      useRepayAll = availableUSDST >= currentDebt;
    }

    const actionLabel = getVaultActionLabel(action, position.symbol, useMaxEndpoint, useRepayAll);
    setProgressError(undefined);
    if (useExternalWalletSigning) {
      setProgressActionLabel(actionLabel);
      setProgressSteps(buildInitialProgressSteps(action, position.symbol, parsedAmount, useMaxEndpoint, useRepayAll));
      setProgressModalOpen(true);
    } else {
      setProgressModalOpen(false);
      setProgressSteps([]);
    }

    const walletTxProgress = (event: WalletTxProgressEvent) => {
      setProgressSteps(prev => {
        const updated = [...prev];
        while (updated.length < event.total) {
          updated.push(buildProgressStep(updated.length, undefined, action, position.symbol, parsedAmount, useMaxEndpoint, useRepayAll));
        }

        const current = updated[event.index] || buildProgressStep(event.index, event.functionName, action, position.symbol, parsedAmount, useMaxEndpoint, useRepayAll);
        const status =
          event.status === "failed"
            ? "error"
            : event.status === "submitted" || event.status === "completed"
              ? "completed"
              : "processing";
        const nextStatus = current.status === "completed" && status === "processing" ? "completed" : status;

        updated[event.index] = {
          ...current,
          label: event.functionName
            ? getStepLabel(event.functionName, action, position.symbol, useMaxEndpoint, useRepayAll)
            : current.label,
          description: event.functionName
            ? getStepDescription(event.functionName, action, position.symbol, parsedAmount, useMaxEndpoint, useRepayAll)
            : current.description,
          status: nextStatus,
          hash: event.hash || current.hash,
          error: nextStatus === "error" ? event.error || current.error || "Transaction failed" : undefined,
        };

        for (let i = 0; i < event.index; i++) {
          if (updated[i] && updated[i].status !== "completed" && updated[i].status !== "error") {
            updated[i] = { ...updated[i], status: "completed" };
          }
        }

        if (nextStatus === "error") {
          for (let i = event.index + 1; i < updated.length; i++) {
            if (updated[i].status === "pending") {
              updated[i] = { ...updated[i], status: "error", error: "Skipped due to prior failure" };
            }
          }
        }

        return updated;
      });

      if (event.status === "failed" && event.error) {
        setProgressError(event.error);
      }
    };

    const txOptions = useExternalWalletSigning ? { walletTxProgress } : undefined;

    // Set processing state
    const actionKey = `${asset}-${action}`;
    setProcessingActions(prev => ({ ...prev, [actionKey]: true }));

    try {
      let result;
      
      switch (action) {
        case 'deposit':
          result = await cdpService.deposit(asset, parsedAmount, false, txOptions);
          break;
        case 'withdraw':
          // If user is in max state, use withdrawMax endpoint
          if (maxStates[asset]) {
            result = await cdpService.withdrawMax(asset, txOptions);
          } else {
            result = await cdpService.withdraw(asset, parsedAmount, txOptions);
          }
          break;
        case 'mint':
          // If user is in max state, use mintMax endpoint
          if (maxStates[asset]) {
            result = await cdpService.mintMax(asset, txOptions);
          } else {
            result = await cdpService.mint(asset, parsedAmount, false, txOptions);
          }
          break;
        case 'repay':
          // If user is in max state, check if they can repay all debt or just partial
          if (maxStates[asset]) {
            if (position) {
              const currentDebt = parseFloat(formatWeiToDecimalHP(position.debtAmount, 18));
              const availableUSDST = parseFloat(formatWeiToDecimalHP(activeTokens.find(token => 
                token.address.toLowerCase() === usdstAddress.toLowerCase()
              )?.balance || "0", 18));
              
              // Use repayAll only if user has enough USDST to cover full debt
              if (availableUSDST >= currentDebt) {
                result = await cdpService.repayAll(asset, txOptions);
              } else {
                // Use regular repay with the limited amount they can afford
                result = await cdpService.repay(asset, parsedAmount, txOptions);
              }
            } else {
              result = await cdpService.repay(asset, parsedAmount, txOptions);
            }
          } else {
            result = await cdpService.repay(asset, parsedAmount, txOptions);
          }
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      if (isTxSubmitted(result.status)) {
        if (useExternalWalletSigning) {
          setProgressSteps(prev => prev.map((step, index) => ({
            ...step,
            status: "completed",
            hash: step.hash || (index === 0 ? result.hash : undefined),
            error: undefined,
          })));
        }

        toast({
          title: isTxPending(result.status) ? "Submitted" : "Success",
          description: isTxPending(result.status)
            ? `${action.charAt(0).toUpperCase() + action.slice(1)} submitted. Tx: ${result.hash}`
            : `${action.charAt(0).toUpperCase() + action.slice(1)} completed successfully. Tx: ${result.hash}`,
        });
        
        // Clear the input and reset states after successful action
        setInputAmounts(prev => ({ ...prev, [asset]: "" }));
        setMaxStates(prev => ({ ...prev, [asset]: false }));
        setActiveActions(prev => ({ ...prev, [asset]: null }));

        // Refresh positions data and balances in the background so the action button
        // re-enables immediately instead of waiting on follow-up reads.
        cdpService.getVaults().then(setPositions).catch(() => {});
        fetchUsdstBalance();
        fetchTokens();

        // Call the callback to refresh other components (like deposits)
        if (onVaultActionSuccess) {
          onVaultActionSuccess();
        }
      } else {
        throw new Error(`${action} failed`);
      }
    } catch (error) {
      console.error(`Failed to ${action}:`, error);
      
      // Extract detailed error information
      let errorMessage = `Failed to ${action}. Please try again.`;
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        // Handle API errors
        const apiError = error as { 
          response?: { 
            data?: { 
              error?: { message?: string }; 
              message?: string 
            } 
          }; 
          message?: string 
        };
        if (apiError.response?.data?.error?.message) {
          // Backend sends errors in { error: { message, status, type } } format
          errorMessage = apiError.response.data.error.message;
        } else if (apiError.response?.data?.message) {
          // Fallback for direct message format
          errorMessage = apiError.response.data.message;
        } else if (apiError.message) {
          errorMessage = apiError.message;
        }
      }

      setProgressError(errorMessage);
      if (useExternalWalletSigning) {
        setProgressSteps(prev => {
          const updated = [...prev];
          const activeIndex = updated.findIndex(step => step.status === "processing");
          const pendingIndex = updated.findIndex(step => step.status === "pending");
          const failedIndex = activeIndex >= 0 ? activeIndex : pendingIndex;

          if (failedIndex >= 0) {
            updated[failedIndex] = { ...updated[failedIndex], status: "error", error: errorMessage };
            for (let i = failedIndex + 1; i < updated.length; i++) {
              if (updated[i].status === "pending") {
                updated[i] = { ...updated[i], status: "error", error: "Skipped due to prior failure" };
              }
            }
          }

          return updated;
        });
      }
      
      toast({
        title: "Transaction Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      // Clear processing state
      setProcessingActions(prev => ({ ...prev, [actionKey]: false }));
    }
  };

  const progressModal = (
    <VaultActionProgressModal
      open={progressModalOpen}
      actionLabel={progressActionLabel}
      steps={progressSteps}
      error={progressError}
      onClose={() => {
        setProgressModalOpen(false);
        setProgressSteps([]);
        setProgressError(undefined);
      }}
    />
  );

  if (loading) {
    return (
      <>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Your positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground">Loading positions...</div>
            </div>
          </CardContent>
        </Card>
        {progressModal}
      </>
    );
  }

  // Filter out vaults with 0 collateral for display
  const vaultsWithCollateral = positions.filter(position => {
    const collateralAmount = parseFloat(formatWeiToDecimalHP(position.collateralAmount, position.collateralAmountDecimals));
    return collateralAmount > 0;
  });

  if (vaultsWithCollateral.length === 0) {
    return (
      <>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Your vaults</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="text-muted-foreground mb-4">No positions yet</div>
              <div className="text-sm text-muted-foreground/70">Deposit collateral and mint USDST above to open your first position</div>
            </div>
          </CardContent>
        </Card>
        {progressModal}
      </>
    );
  }

  return (
    <TooltipProvider>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Your vaults</CardTitle>
        </CardHeader>
        <CardContent>
        <style>{`
          /* Hide number input arrows */
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
          {vaultsWithCollateral.map((position, index) => {
            const currentDebt = parseFloat(formatWeiToDecimalHP(position.debtAmount, 18));
            const hasDebt = currentDebt > 0;
            const healthFactor = hasDebt 
              ? calculateHealthFactor(position.collateralizationRatio, position.liquidationRatio)
              : Infinity;
            const activeAction = activeActions[position.asset];
            const inputAmount = inputAmounts[position.asset] || "";
            const previewValues = activeAction && inputAmount ? calculatePreviewValues(position, activeAction, inputAmount) : null;
            
            return (
            <div
              key={`${position.asset}-${index}`}
              className="border border-border rounded-lg p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {(() => {
                    const token = [...earningAssets, ...inactiveTokens].find(
                      t => t.address?.toLowerCase() === position.asset?.toLowerCase()
                    );
                    const tokenImage = token?.images?.[0]?.value;
                    
                    return tokenImage ? (
                      <img src={tokenImage} alt={position.symbol} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                        style={{ backgroundColor: getAssetColor(position.symbol) }}
                      >
                        {position.symbol.slice(0, 2)}
                      </div>
                    );
                  })()}
                  <div>
                    <h4 className="font-semibold">{position.symbol}</h4>
                  </div>
                </div>
                
                {/* 3-dot options menu - only render if asset is supported */}
                {assetSupportedStates[position.asset] !== false && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 w-8 p-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem 
                        onClick={() => handleActionSelect(position.asset, 'deposit')}
                      >
                        Deposit
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleActionSelect(position.asset, 'withdraw')}
                      >
                        Withdraw
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleActionSelect(position.asset, 'mint')}
                      >
                        Mint
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => handleActionSelect(position.asset, 'repay')}
                      >
                        Repay
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Collateral</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="font-semibold cursor-help tabular-nums">{formatNumber(parseFloat(formatWeiToDecimalHP(position.collateralAmount, position.collateralAmountDecimals)))} {position.symbol}</p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        {formatNumberWithCommas(formatWeiToDecimalHP(position.collateralAmount, position.collateralAmountDecimals))} {position.symbol}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-muted-foreground cursor-help tabular-nums">${formatNumber(parseFloat(formatWeiToDecimalHP(position.collateralValueUSD, 18)))}</p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        ${formatNumberWithCommas(formatWeiToDecimalHP(position.collateralValueUSD, 18))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Debt</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="font-semibold cursor-help tabular-nums">{formatNumber(parseFloat(formatWeiToDecimalHP(position.debtAmount, 18)))} USDST</p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        {formatNumberWithCommas(formatWeiToDecimalHP(position.debtAmount, 18))} USDST
                      </div>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-xs text-muted-foreground cursor-help tabular-nums">${formatNumber(parseFloat(formatWeiToDecimalHP(position.debtAmount, 18)))}</p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        ${formatNumberWithCommas(formatWeiToDecimalHP(position.debtAmount, 18))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Health factor</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className={`font-semibold cursor-help tabular-nums ${hasDebt ? getHealthFactorColor(healthFactor) : 'text-success'}`}>
                        {hasDebt ? formatNumber(healthFactor) : '∞'}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="whitespace-pre-line text-center">
                        {hasDebt 
                          ? `Full precision: ${formatNumberWithCommas(healthFactor.toString())}\n\nHealth Factor = CR ÷ Liquidation Threshold\n${formatNumber(position.collateralizationRatio)}% ÷ ${formatNumber(position.liquidationRatio)}% = ${formatNumber(healthFactor)}`
                          : 'Health Factor = CR ÷ Liquidation Threshold'
                        }
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Stability fee</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="font-semibold cursor-help tabular-nums">{formatPercentage(position.stabilityFeeRate)}</p>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="text-xs">
                        {formatNumberWithCommas(position.stabilityFeeRate.toString())}%
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Warning for disabled/unsupported assets */}
              {assetSupportedStates[position.asset] === false && (
                <div className="mb-4 p-3 bg-destructive/10 border border-destructive/50 rounded-lg">
                  <p className="text-sm text-destructive font-medium text-center">
                    ⚠️ Admin has disabled {position.symbol} at this time. All operations are disabled.
                  </p>
                </div>
              )}

              {/* Preview Values */}
              {previewValues && (
                <div className="mt-4 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                  <h5 className="text-sm font-medium text-foreground mb-2">New Values After {activeAction}:</h5>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-primary mb-1">Collateral</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="font-semibold text-foreground cursor-help tabular-nums">{previewValues.collateralAmount} {position.symbol}</p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            {formatNumberWithCommas(parseCommaNumber(previewValues.collateralAmount))} {position.symbol}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-xs text-primary cursor-help tabular-nums">${previewValues.collateralValueUSD}</p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            ${formatNumberWithCommas(parseCommaNumber(previewValues.collateralValueUSD))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div>
                      <p className="text-xs text-primary mb-1">Debt</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="font-semibold text-foreground cursor-help tabular-nums">{previewValues.debtAmount} USDST</p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            {formatNumberWithCommas(parseCommaNumber(previewValues.debtAmount))} USDST
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="text-xs text-primary cursor-help tabular-nums">${previewValues.debtAmount}</p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            ${formatNumberWithCommas(parseCommaNumber(previewValues.debtAmount))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div>
                      <p className="text-xs text-primary mb-1">Health factor</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className={`font-semibold cursor-help tabular-nums ${previewValues.healthFactor === Infinity ? 'text-success' : getHealthFactorColor(previewValues.healthFactor)}`}>
                            {previewValues.healthFactor === Infinity ? '∞' : formatNumber(previewValues.healthFactor)}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="whitespace-pre-line text-center">
                            {previewValues.healthFactor === Infinity 
                              ? 'Health Factor = CR ÷ Liquidation Threshold'
                              : `Full precision: ${formatNumberWithCommas(previewValues.healthFactor.toString())}\n\nHealth Factor = CR ÷ Liquidation Threshold\n${formatNumber((parseFloat(previewValues.collateralValueUSD) / parseFloat(previewValues.debtAmount)) * 100)}% ÷ ${formatNumber(position.liquidationRatio)}% = ${formatNumber(previewValues.healthFactor)}`
                            }
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div>
                      <p className="text-xs text-primary mb-1">Stability fee</p>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="font-semibold text-foreground cursor-help tabular-nums">{formatPercentage(position.stabilityFeeRate)}</p>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            {formatNumberWithCommas(position.stabilityFeeRate.toString())}%
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              )}

              {/* Conditional Action Input/Button */}
              {activeActions[position.asset] && (
                <div className="mt-4">
                  {/* Show unsupported message for all actions when asset is unsupported */}
                  {assetSupportedStates[position.asset] === false ? (
                    <div className="p-3 bg-destructive/10 border border-destructive/50 rounded-lg text-center">
                      <p className="text-sm text-destructive font-medium">
                        {activeActions[position.asset]!.charAt(0).toUpperCase() + activeActions[position.asset]!.slice(1)} disabled - {position.symbol} is not supported
                      </p>
                    </div>
                  ) : (isGlobalPaused || assetPauseStates[position.asset]) && (activeActions[position.asset] === 'mint' || activeActions[position.asset] === 'withdraw') ? (
                    <div className="p-3 bg-warning/10 border border-warning/40 rounded-lg text-center">
                      <p className="text-sm text-warning font-medium">
                        {isGlobalPaused 
                          ? `${activeActions[position.asset] === 'mint' ? 'Mint' : 'Withdraw'} paused by admin at this time`
                          : `${activeActions[position.asset] === 'mint' ? 'Mint' : 'Withdraw'} for ${position.symbol} paused by admin at this time`
                        }
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2">
                        <p className="text-xs text-muted-foreground">
                          Transaction fee: {activeActions[position.asset] === 'deposit' || activeActions[position.asset] === 'repay' ? '0.02' : '0.01'} USDST
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Amount"
                          value={inputAmounts[position.asset] || ""}
                          onChange={(e) => handleInputChange(position.asset, e.target.value, e)}
                          className={`flex-1 ${
                            maxStates[position.asset]
                              ? 'text-primary bg-primary/10 border-primary/30'
                              : isAmountAboveMax(position.asset, inputAmounts[position.asset] || "")
                                ? 'text-destructive bg-destructive/10 border-destructive/50'
                                : ''
                          }`}
                          inputMode="decimal"
                        />
                      <Button 
                        variant={maxStates[position.asset] ? "default" : "outline"}
                        size="sm" 
                        className={`min-w-[50px] ${maxStates[position.asset] ? 'bg-primary hover:bg-primary/90 text-primary-foreground' : ''}`}
                        onClick={() => handleMaxClick(position.asset, activeActions[position.asset]!)}
                      >
                        MAX
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="min-w-[80px]"
                        onClick={() => handleAction(position.asset, activeActions[position.asset]!, inputAmounts[position.asset] || "")}
                        disabled={isAmountAboveMax(position.asset, inputAmounts[position.asset] || "") || processingActions[`${position.asset}-${activeActions[position.asset]}`]}
                      >
                        {processingActions[`${position.asset}-${activeActions[position.asset]}`]
                          ? "Processing..."
                          : isAmountAboveMax(position.asset, inputAmounts[position.asset] || "") 
                            ? "Amount exceeds maximum"
                            : activeActions[position.asset]!.charAt(0).toUpperCase() + activeActions[position.asset]!.slice(1)
                        }
                      </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
    {progressModal}
    </TooltipProvider>
  );
};

export default VaultsList;
