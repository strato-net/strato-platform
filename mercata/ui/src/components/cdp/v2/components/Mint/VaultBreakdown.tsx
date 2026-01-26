import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits } from 'ethers';
import { NumericFormat } from 'react-number-format';
import type { VaultCandidate, WEI } from '@/components/cdp/v2/cdpTypes';
import {
  formatPercentage,
  getAssetColor,
  convertStabilityFeeRateToAnnualPercentage,
  calculateVaultMinHFRaw,
  calculateVaultHFRaw,
  calculateVaultHF,
  calculateMaxMintForVault,
  calculateMaxMintUnitsForVault,
  truncateForDisplay,
  getHFColorClass,
  WAD_UNIT,
} from '@/components/cdp/v2/cdpUtils';
import { useTokenContext } from '@/context/TokenContext';
import { parseUnitsWithTruncation } from '@/utils/numberUtils';
import { UNITS, USD, DECIMAL, ADDRESS } from '@/components/cdp/v2/cdpTypes';

interface VaultBreakdownProps {
  vaultCandidates: VaultCandidate[];
  showMintAmounts?: boolean;
  onDepositAmountChange?: (assetAddress: ADDRESS, amount: string) => void;
  onMintAmountChange?: (assetAddress: ADDRESS, amount: string) => void;
  autoAllocate?: boolean;
  isMaxMode?: boolean;
  targetHF?: DECIMAL;
  minHF?: DECIMAL;
  onHFValidationChange?: (hasLowHF: boolean) => void;
  onBalanceExceededChange?: (exceedsBalance: boolean) => void;
  onMintExceedsMaxChange?: (mintExceedsMax: boolean) => void;
  onTotalManualMintChange?: (totalMint: string) => void;
  onAverageVaultHealthChange?: (averageHF: string | null) => void;
  onMintMaxVaultsChange?: (vaults: Set<ADDRESS>) => void;
  exceedsBalance?: boolean;
  hasLowHF?: boolean;
  projectedVaultHealth?: string | null; // Passed from parent (Mint.tsx)
}

const VaultBreakdown: React.FC<VaultBreakdownProps> = ({
  vaultCandidates,
  showMintAmounts = false,
  onDepositAmountChange,
  onMintAmountChange,
  autoAllocate = true,
  isMaxMode = false,
  exceedsBalance = false,
  hasLowHF = false,
  targetHF,
  minHF,
  onHFValidationChange,
  onBalanceExceededChange,
  onMintExceedsMaxChange,
  onTotalManualMintChange,
  onAverageVaultHealthChange,
  onMintMaxVaultsChange,
  projectedVaultHealth,
}) => {

  // ============================================================================
  // Context Hooks
  // ============================================================================

  const { earningAssets, inactiveTokens } = useTokenContext();



  // ============================================================================
  // State - UI Controls
  // ============================================================================

  const [isOpen, setIsOpen] = useState(!autoAllocate);
  const [displayMode, setDisplayMode] = useState<'Value' | 'Amount'>('Value');
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // ============================================================================
  // State - Input Display Values (what's shown in input fields)
  // Source of truth for chain values is vaultCandidates.allocation (from parent)
  // ============================================================================

  const [vaultInputs, setVaultInputs] = useState<Record<ADDRESS, { depositAmount: string; mintAmount: string }>>({});
  
  // ============================================================================
  // State - Pre-calculated representations for auto-to-manual transition
  // Stores both Amount and Value representations to detect display mode switches vs real edits
  // ============================================================================
  
  const [allocationRepresentations, setAllocationRepresentations] = useState<Record<ADDRESS, {
    depositAmountToken: UNITS;  // Source of truth in token units
    depositAmountDisplay: string;  // Amount mode representation
    depositValueDisplay: string;   // Value mode representation
    mintAmountToken: WEI;  // Source of truth
    mintAmountDisplay: string;  // Amount mode representation (always same as token for mint)
    mintValueDisplay: string;   // Value mode representation
  }>>({});

  // ============================================================================
  // State - Tracking
  // ============================================================================

  const [mintMaxVaults, setMintMaxVaults] = useState<Set<ADDRESS>>(new Set());
  const [depositMaxVaults, setDepositMaxVaults] = useState<Set<ADDRESS>>(new Set());



  // ============================================================================
  // Refs
  // ============================================================================

  const prevMintMaxVaultsRef = useRef<Set<ADDRESS>>(new Set());
  const prevAutoSupplyRef = useRef<boolean>(autoAllocate);
  const prevDisplayModeRef = useRef<'Value' | 'Amount'>(displayMode);
  const depositInputRefs = useRef<Record<ADDRESS, HTMLInputElement | null>>({});
  const mintInputRefs = useRef<Record<ADDRESS, HTMLInputElement | null>>({});
  const isInitializingRef = useRef<boolean>(false);



  // ============================================================================
  // Callbacks - Utility Functions
  // ============================================================================

  const toNumber = useCallback((input: string): DECIMAL => {
    const num = parseFloat(input || '0');
    return isNaN(num) ? 0 : num;
  }, []);

  const getPrice = useCallback((assetAddress: ADDRESS): WEI => {
    const vaultCandidate = vaultCandidates.find(candidate => candidate.vaultConfig.assetAddress === assetAddress);
    return vaultCandidate ? vaultCandidate.oraclePrice : 0n;
  }, [vaultCandidates]);

  const amountToValue = useCallback((amount: string, assetAddress: ADDRESS, roundForDisplay: boolean = true): string => {
    if (!amount || amount === '0') return '';
    const vaultCandidate = vaultCandidates.find(candidate => candidate.vaultConfig.assetAddress === assetAddress);
    if (!vaultCandidate) return '';
    
    const price: WEI = getPrice(assetAddress);
    if (price === 0n) return '';
    
    const decimals = vaultCandidate.vaultConfig.unitScale.toString().length - 1;
    const amountUnits: UNITS = parseUnitsWithTruncation(amount, decimals);
    
    // value = (amount * price) / unitScale
    const valueUnits: WEI = (amountUnits * price) / vaultCandidate.vaultConfig.unitScale;
    if (valueUnits <= 0n) return '';
    
    const usdValue = parseFloat(formatUnits(valueUnits, 18));
    return roundForDisplay ? usdValue.toFixed(2) : String(usdValue);
  }, [vaultCandidates, getPrice]);

  const valueToAmount = useCallback((value: string, assetAddress: ADDRESS): string => {
    if (!value || value === '0') return '';
    const vaultCandidate = vaultCandidates.find(candidate => candidate.vaultConfig.assetAddress === assetAddress);
    if (!vaultCandidate) return '';
    
    const price: WEI = getPrice(assetAddress);
    if (price === 0n) return '';
    
    const decimals = vaultCandidate.vaultConfig.unitScale.toString().length - 1;
    const valueUnits: WEI = parseUnitsWithTruncation(value, 18);
    
    // amount = (value * unitScale) / price
    const amountUnits: UNITS = (valueUnits * vaultCandidate.vaultConfig.unitScale) / price;
    if (amountUnits <= 0n) return '';
    
    return formatUnits(amountUnits, decimals);
  }, [vaultCandidates, getPrice]);

  /**
   * Check if a vault's CR is below minCR using exact BigInt math
   * Matches on-chain validation: require(crAfter >= minCR)
   * 
   * @param candidate - The vault candidate to check
   * @param skipIfMaxMode - If true, returns false when both deposit and mint are at max
   * @returns true if CR < minCR (insufficient collateralization)
   */
  const checkVaultHasLowCR = useCallback((
    candidate: VaultCandidate,
    skipIfMaxMode: boolean = true
  ): boolean => {
    if (autoAllocate || !candidate.allocation) return false;
    
    // Skip if both inputs are in max mode (by definition, max values are valid)
    // This includes the case where deposit=0 (potentialCollateral=0) but still "at max"
    if (skipIfMaxMode) {
      const isInMaxMode = depositMaxVaults.has(candidate.vaultConfig.assetAddress) && 
                         mintMaxVaults.has(candidate.vaultConfig.assetAddress);
      if (isInMaxMode) return false;
    }
    
    const depositUnits: UNITS = candidate.allocation.depositAmount;
    const mintUnits: WEI = candidate.allocation.mintAmount;
    
    // Skip if no debt (infinite CR)
    if (mintUnits === 0n) return false;
    
    // Calculate total collateral and debt using exact BigInt math
    const totalCollateral: UNITS = candidate.currentCollateral + depositUnits;
    const totalDebt: WEI = candidate.currentDebt + mintUnits;
    
    if (totalDebt === 0n) return false;
    
    // Calculate collateral value in USD: (collateral * price) / unitScale
    const collateralValueUSD: WEI = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
    
    // Calculate CR in WAD format: (collateralValueUSD * WAD) / totalDebt
    const actualCR: bigint = (collateralValueUSD * WAD_UNIT) / totalDebt;
    const minCR: bigint = candidate.vaultConfig.minCR;
    
    // Return true if CR at or below minimum (on-chain mint requires: actualCR > minCR, strict)
    return actualCR <= minCR;
  }, [autoAllocate, depositMaxVaults, mintMaxVaults]);



  // ============================================================================
  // Memos - Derived State
  // ============================================================================

  const isSliderAtMin = targetHF !== undefined && minHF !== undefined && Math.abs(targetHF - minHF) < 0.01;
  const isFullMaxMode = autoAllocate && isMaxMode && isSliderAtMin;

  // projectedVaultHealth is now passed as a prop from Mint.tsx to avoid duplication

  // Memoized computed values for each vault - used for validation and display
  type VaultComputedValues = {
    // Deposit (potentialCollateral)
    depositMaxUnits: UNITS;           // Raw potentialCollateral units
    depositMaxAmount: string;         // Formatted token amount (e.g., "1234.567890")
    depositMaxValue: string;          // Formatted USD value (e.g., "2345.67")
    depositMaxAmountNum: number;      // Parsed number for comparison
    depositMaxValueNum: number;       // Parsed number for comparison
    // Mint (max mintable at full deposit)
    mintMaxUnits: WEI;                // Raw max mint units
    mintMaxAmount: string;            // Formatted USDST amount (same as value for stablecoin)
    mintMaxValue: string;             // Formatted USD value (same as amount for stablecoin)
    mintMaxAmountNum: number;         // Parsed number for comparison
    mintMaxValueNum: number;          // Parsed number for comparison
    // Decimals for convenience
    decimals: number;
  };

  const vaultComputedValues = useMemo<Record<ADDRESS, VaultComputedValues>>(() => {
    const values: Record<ADDRESS, VaultComputedValues> = {};
    
    for (const candidate of vaultCandidates) {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const price: WEI = candidate.oraclePrice;
      
      // Deposit max calculations
      const depositMaxUnits = candidate.potentialCollateral;
      const depositMaxAmount = formatUnits(depositMaxUnits, decimals);
      const depositMaxAmountNum = parseFloat(depositMaxAmount);
      
      // Calculate deposit value: value = (amount * price) / unitScale
      let depositMaxValue = '0.00';
      let depositMaxValueNum = 0;
      if (price > 0n && depositMaxUnits > 0n) {
        const valueUnits: WEI = (depositMaxUnits * price) / candidate.vaultConfig.unitScale;
        depositMaxValueNum = parseFloat(formatUnits(valueUnits, 18));
        depositMaxValue = depositMaxValueNum.toFixed(2);
      }
      
      // Mint max calculations
      const mintMaxUnits = calculateMaxMintUnitsForVault(candidate, candidate.potentialCollateral);
      const mintMaxAmount = formatUnits(mintMaxUnits, 18);
      const mintMaxAmountNum = parseFloat(mintMaxAmount);
      // For USDST, amount === value (it's a stablecoin)
      const mintMaxValue = mintMaxAmountNum.toFixed(2);
      const mintMaxValueNum = parseFloat(mintMaxValue);
      
      values[candidate.vaultConfig.assetAddress] = {
        depositMaxUnits,
        depositMaxAmount,
        depositMaxValue,
        depositMaxAmountNum,
        depositMaxValueNum,
        mintMaxUnits,
        mintMaxAmount,
        mintMaxValue,
        mintMaxAmountNum,
        mintMaxValueNum,
        decimals,
      };
    }
    
    return values;
  }, [vaultCandidates]);

  const getGridClass = useCallback(() => {
    if (showMintAmounts) {
      return !autoAllocate 
        ? 'grid-cols-[minmax(100px,auto)_minmax(80px,auto)_1fr_1fr_minmax(60px,auto)]' 
        : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr]';
    }
    return !autoAllocate 
      ? 'grid-cols-[minmax(100px,auto)_minmax(80px,auto)_1fr_minmax(60px,auto)]' 
      : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr]';
  }, [showMintAmounts, autoAllocate]);



  // ============================================================================
  // Effects - Parent Notification
  // ============================================================================

  useEffect(() => {
    if (onMintMaxVaultsChange) {
      const prev = prevMintMaxVaultsRef.current;
      const changed = prev.size !== mintMaxVaults.size || 
        Array.from(mintMaxVaults).some(v => !prev.has(v));
      
      if (changed) {
        onMintMaxVaultsChange(mintMaxVaults);
        prevMintMaxVaultsRef.current = new Set(mintMaxVaults);
      }
    }
  }, [mintMaxVaults, onMintMaxVaultsChange]);


  // No longer needed - projectedVaultHealth is passed as prop

  // ============================================================================
  // Effects - UI State Sync
  // ============================================================================

  useEffect(() => {
    setIsOpen(!autoAllocate);
  }, [autoAllocate]);

  // ============================================================================
  // Effects - Full Max Mode
  // ============================================================================

  useEffect(() => {
    if (!autoAllocate) return;

    if (isFullMaxMode) {
      const vaultsWithMint = new Set<string>();
      vaultCandidates.forEach(c => {
        if ((c.allocation?.mintAmount || 0n) > 0n) {
          vaultsWithMint.add(c.vaultConfig.assetAddress);
        }
      });
      setMintMaxVaults(vaultsWithMint);
    }
  }, [isFullMaxMode, vaultCandidates, autoAllocate]);

  // ============================================================================
  // Effects - Mode Transition (Auto to Manual)
  // ============================================================================

  useEffect(() => {
    if (prevAutoSupplyRef.current === true && autoAllocate === false) {
      const hasAllocations = vaultCandidates.some(c => c.allocation?.depositAmount || c.allocation?.mintAmount);
      if (!hasAllocations) {
        prevAutoSupplyRef.current = autoAllocate;
        return;
      }
      
      // Set flag to prevent callbacks during initialization
      isInitializingRef.current = true;

      const newMintMaxVaults = new Set<string>();
      const newDepositMaxVaults = new Set<string>();
      const newInputs: Record<ADDRESS, { depositAmount: string; mintAmount: string }> = {};
      const newRepresentations: Record<ADDRESS, {
        depositAmountToken: UNITS;
        depositAmountDisplay: string;
        depositValueDisplay: string;
        mintAmountToken: WEI;
        mintAmountDisplay: string;
        mintValueDisplay: string;
      }> = {};

      vaultCandidates.forEach(c => {
        const decimals = c.vaultConfig.unitScale.toString().length - 1;
        const depositBigInt = c.allocation?.depositAmount || 0n;
        const mintBigInt = c.allocation?.mintAmount || 0n;

        // Pre-calculate BOTH representations for deposit
        let depositAmountDisplay = '';
        let depositValueDisplay = '';
        
        // Check if deposit equals potentialCollateral (max mode)
        // Note: If potentialCollateral = 0 and depositBigInt = 0, that's also "at max" (nothing to deposit)
        const isDepositAtMax = depositBigInt === c.potentialCollateral;
        
        if (isDepositAtMax) {
          // Use memoized formatted display values for max mode to avoid precision issues
          const computed = vaultComputedValues[c.vaultConfig.assetAddress];
          if (computed && c.potentialCollateral > 0n) {
            depositAmountDisplay = computed.depositMaxAmount;
            depositValueDisplay = computed.depositMaxValue;
          } else if (depositBigInt > 0n) {
            // Fallback if computed not available but there is a deposit
            const tokenAmount = formatUnits(depositBigInt, decimals);
            depositAmountDisplay = tokenAmount;
            depositValueDisplay = amountToValue(tokenAmount, c.vaultConfig.assetAddress, false);
          }
          // else: depositBigInt = 0 and potentialCollateral = 0, display stays empty
          newDepositMaxVaults.add(c.vaultConfig.assetAddress);
        } else if (depositBigInt > 0n) {
          // For non-max values, use standard conversion
          const tokenAmount = formatUnits(depositBigInt, decimals);
          depositAmountDisplay = tokenAmount;
          depositValueDisplay = amountToValue(tokenAmount, c.vaultConfig.assetAddress, false);
        }

        // Pre-calculate BOTH representations for mint
        let mintAmountDisplay = '';
        let mintValueDisplay = '';
        if (mintBigInt > 0n) {
          // Check if mint equals max mintable for current deposit (max mode)
          const depositUnits = depositBigInt || 0n;
          const maxMintUnits = calculateMaxMintUnitsForVault(c, depositUnits);
          const shouldAddToMintMax = mintBigInt === maxMintUnits && maxMintUnits > 0n;
          
          if (shouldAddToMintMax) {
            newMintMaxVaults.add(c.vaultConfig.assetAddress);
            
            // Only use pre-computed values if deposit is ALSO at max
            // (computed mint max is calculated for full potentialCollateral deposit)
            // Note: isDepositAtMax includes the case where potentialCollateral = 0
            const computed = vaultComputedValues[c.vaultConfig.assetAddress];
            
            if (isDepositAtMax && computed && c.potentialCollateral > 0n) {
              // Safe to use pre-computed mint max (calculated for full deposit)
              mintAmountDisplay = computed.mintMaxAmount;
              mintValueDisplay = computed.mintMaxValue;
            } else {
              // Deposit not at max OR potentialCollateral is 0, format mint from actual BigInt
              const mintDecimal = formatUnits(mintBigInt, 18);
              mintAmountDisplay = mintDecimal;
              mintValueDisplay = parseFloat(mintDecimal).toFixed(2);
            }
          } else {
            // For non-max values, use standard conversion
            const mintDecimal = formatUnits(mintBigInt, 18);
            mintAmountDisplay = mintDecimal;
            mintValueDisplay = parseFloat(mintDecimal).toFixed(2);
          }
        }

        // Store both representations
        newRepresentations[c.vaultConfig.assetAddress] = {
          depositAmountToken: depositBigInt,
          depositAmountDisplay,
          depositValueDisplay,
          mintAmountToken: mintBigInt,
          mintAmountDisplay,
          mintValueDisplay,
        };

        // Set display based on current mode
        newInputs[c.vaultConfig.assetAddress] = {
          depositAmount: displayMode === 'Value' ? depositValueDisplay : depositAmountDisplay,
          mintAmount: displayMode === 'Value' ? mintValueDisplay : mintAmountDisplay,
        };
      });

      setAllocationRepresentations(newRepresentations);
      setVaultInputs(newInputs);
      setMintMaxVaults(newMintMaxVaults);
      setDepositMaxVaults(newDepositMaxVaults);
      
      // Clear flag after a brief delay to allow NumericFormat to settle
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }
    
    prevAutoSupplyRef.current = autoAllocate;
  }, [autoAllocate, vaultCandidates, displayMode, amountToValue, vaultComputedValues]);

  // ============================================================================
  // Effects - Display Mode Sync (Manual Mode)
  // When display mode changes, recalculate display values
  // For vaults in max arrays, use the same raw values that "Available: x" click uses
  // ============================================================================
  
  useEffect(() => {
    const displayModeChanged = prevDisplayModeRef.current !== displayMode;
    
    if (autoAllocate) {
      prevDisplayModeRef.current = displayMode;
      return;
    }
    
    // Only execute when displayMode actually changes, not on every vaultCandidates update
    if (!displayModeChanged) {
      return;
    }
    
    // Set flag to prevent callbacks during display mode switch
    isInitializingRef.current = true;
    
    const newInputs: Record<ADDRESS, { depositAmount: string; mintAmount: string }> = {};
    
    vaultCandidates.forEach(c => {
      const computed = vaultComputedValues[c.vaultConfig.assetAddress];
      const decimals = computed?.decimals || (c.vaultConfig.unitScale.toString().length - 1);
      const isDepositMax = c.allocation && c.allocation.depositAmount === c.potentialCollateral && c.potentialCollateral > 0n;
      const isMintMax = mintMaxVaults.has(c.vaultConfig.assetAddress);
      
      let depositDisplay = '';
      let mintDisplay = '';
      
      // For deposit: if in deposit max, use memoized values
      if (isDepositMax && computed) {
        depositDisplay = displayMode === 'Value' 
          ? computed.depositMaxValue
          : computed.depositMaxAmount;
      } else if (c.allocation?.depositAmount && c.allocation.depositAmount > 0n) {
        const tokenAmount = formatUnits(c.allocation.depositAmount, decimals);
        depositDisplay = displayMode === 'Value' 
          ? amountToValue(tokenAmount, c.vaultConfig.assetAddress, true)
          : tokenAmount;
      }
      
      // For mint: if in mint max, use memoized values
      if (isMintMax && computed) {
        mintDisplay = displayMode === 'Value' 
          ? computed.mintMaxValue
          : computed.mintMaxAmount;
      } else if (c.allocation?.mintAmount && c.allocation.mintAmount > 0n) {
        const mintDecimal = formatUnits(c.allocation.mintAmount, 18);
        mintDisplay = displayMode === 'Value' 
          ? parseFloat(mintDecimal).toFixed(2)
          : mintDecimal;
      }

      newInputs[c.vaultConfig.assetAddress] = {
        depositAmount: depositDisplay,
        mintAmount: mintDisplay,
      };
    });
    
    setVaultInputs(newInputs);
    
    // Clear flag after NumericFormat settles
    setTimeout(() => {
      isInitializingRef.current = false;
    }, 100);
    
    prevDisplayModeRef.current = displayMode;
  }, [displayMode, autoAllocate, vaultCandidates, vaultComputedValues, mintMaxVaults, amountToValue]);

  // ============================================================================
  // Effects - Auto Mode Sync
  // ============================================================================

  useEffect(() => {
    if (!autoAllocate) return;

    setVaultInputs(prev => {
      const newInputs: Record<ADDRESS, { depositAmount: string; mintAmount: string }> = {};
      
      vaultCandidates.forEach(c => {
        const decimals = c.vaultConfig.unitScale.toString().length - 1;
        const depositBigInt = c.allocation?.depositAmount || 0n;
        const mintBigInt = c.allocation?.mintAmount || 0n;

        // Deposit display value
        let depositDisplay = '';
        if (depositBigInt > 0n) {
          const tokenAmount = formatUnits(depositBigInt, decimals);
          depositDisplay = displayMode === 'Value' 
            ? amountToValue(tokenAmount, c.vaultConfig.assetAddress, true) 
            : tokenAmount;
        }

        // Mint display value
        let mintDisplay = '';
        if (mintBigInt > 0n) {
          const mintDecimal = formatUnits(mintBigInt, 18);
          mintDisplay = displayMode === 'Value' 
            ? parseFloat(mintDecimal).toFixed(2) 
            : mintDecimal;
        }

        newInputs[c.vaultConfig.assetAddress] = {
          depositAmount: depositDisplay,
          mintAmount: mintDisplay,
        };
      });

      // Check if anything changed
      const hasChanges = vaultCandidates.some(c => {
        const oldInput = prev[c.vaultConfig.assetAddress];
        const newInput = newInputs[c.vaultConfig.assetAddress];
        return !oldInput || oldInput.depositAmount !== newInput.depositAmount || oldInput.mintAmount !== newInput.mintAmount;
      });

      return hasChanges ? newInputs : prev;
    });

    // Check for mint max and deposit max matches
    const newMintMaxVaults = new Set<ADDRESS>();
    const newDepositMaxVaults = new Set<ADDRESS>();
    vaultCandidates.forEach(c => {
      const depositBigInt = c.allocation?.depositAmount || 0n;
      const mintBigInt = c.allocation?.mintAmount || 0n;
      
      // Check deposit max
      if (depositBigInt > 0n) {
        const shouldAddToDepositMax = depositBigInt === c.potentialCollateral && c.potentialCollateral > 0n;
        if (shouldAddToDepositMax) {
          newDepositMaxVaults.add(c.vaultConfig.assetAddress);
        }
      }
      
      // Check mint max
      if (mintBigInt > 0n) {
        const maxMintUnits = calculateMaxMintUnitsForVault(c, depositBigInt);
        const shouldAddToMintMax = mintBigInt === maxMintUnits && maxMintUnits > 0n;
        if (shouldAddToMintMax) {
          newMintMaxVaults.add(c.vaultConfig.assetAddress);
        }
      }
    });

    setDepositMaxVaults(prev => {
      const changed = prev.size !== newDepositMaxVaults.size ||
        Array.from(newDepositMaxVaults).some(v => !prev.has(v));
      return changed ? newDepositMaxVaults : prev;
    });

    setMintMaxVaults(prev => {
      const changed = prev.size !== newMintMaxVaults.size ||
        Array.from(newMintMaxVaults).some(v => !prev.has(v));
      return changed ? newMintMaxVaults : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultCandidates, autoAllocate]);

  // ============================================================================
  // Effects - Display Mode Change
  // ============================================================================

  useEffect(() => {
    // Convert display values when displayMode changes
    const newInputs: Record<ADDRESS, { depositAmount: string; mintAmount: string }> = {};
    
    vaultCandidates.forEach(c => {
      const decimals = c.vaultConfig.unitScale.toString().length - 1;
      const depositBigInt = c.allocation?.depositAmount || 0n;
      const mintBigInt = c.allocation?.mintAmount || 0n;
      
      // Deposit display
      let depositDisplay = '';
      if (depositBigInt > 0n) {
        const tokenAmount = formatUnits(depositBigInt, decimals);
        depositDisplay = displayMode === 'Value' 
          ? amountToValue(tokenAmount, c.vaultConfig.assetAddress, true) 
          : tokenAmount;
      }
      
      // Mint display
      let mintDisplay = '';
      if (mintBigInt > 0n) {
        const mintDecimal = formatUnits(mintBigInt, 18);
        mintDisplay = displayMode === 'Value' 
          ? parseFloat(mintDecimal).toFixed(2) 
          : mintDecimal;
      }

      newInputs[c.vaultConfig.assetAddress] = {
        depositAmount: depositDisplay,
        mintAmount: mintDisplay,
      };
    });
    
    setVaultInputs(newInputs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode]);

  // ============================================================================
  // Effects - Validation
  // ============================================================================

  // Validate Collateralization Ratio - Checks if any vault has CR at or below minCR
  // Uses exact BigInt math to match on-chain validation (CDPEngine line 306: requires CR > minCR, strict)
  useEffect(() => {
    if (!onHFValidationChange || autoAllocate) return;

    let hasLowHF = false;
    const failingVaults: Array<{
      symbol: string;
      assetAddress: ADDRESS;
      actualCR: string;
      minCR: string;
      depositAmount: string;
      mintAmount: string;
    }> = [];

    for (const candidate of vaultCandidates) {
      if (!candidate.allocation) continue;
      
      // Use helper function to check if CR is below minimum
      if (checkVaultHasLowCR(candidate, true)) {
        hasLowHF = true;
        
        const depositUnits: UNITS = candidate.allocation.depositAmount;
        const mintUnits: WEI = candidate.allocation.mintAmount;
        const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
        
        // Format amounts for error reporting
        const depositAmtFormatted = parseFloat(formatUnits(depositUnits, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 });
        const mintAmtFormatted = parseFloat(formatUnits(mintUnits, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 });
        
        // Calculate CR values for error reporting
        const totalCollateral: UNITS = candidate.currentCollateral + depositUnits;
        const totalDebt: WEI = candidate.currentDebt + mintUnits;
        const collateralValueUSD: WEI = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
        const actualCR: bigint = (collateralValueUSD * WAD_UNIT) / totalDebt;
        const minCR: bigint = candidate.vaultConfig.minCR;
        
        // Convert CR from WAD to percentage for display (e.g., 1.5e18 → 150%)
        const actualCRPercent = parseFloat(formatUnits(actualCR, 18)) * 100;
        const minCRPercent = parseFloat(formatUnits(minCR, 18)) * 100;
        
        failingVaults.push({
          symbol: candidate.vaultConfig.symbol,
          assetAddress: candidate.vaultConfig.assetAddress,
          actualCR: actualCRPercent.toFixed(2) + '%',
          minCR: minCRPercent.toFixed(2) + '%',
          depositAmount: depositAmtFormatted,
          mintAmount: mintAmtFormatted,
        });
      }
    }
    
    if (hasLowHF && failingVaults.length > 0) {
      console.error('[VaultBreakdown] ❌ COLLATERALIZATION RATIO BELOW MINIMUM WARNING:', {
        failingCondition: 'actualCR <= minCR (on-chain mint requires: actualCR > minCR, strict)',
        failingVaults: failingVaults.map(v => ({
          symbol: v.symbol,
          assetAddress: v.assetAddress,
          expected: `> ${v.minCR}`,
          actual: v.actualCR,
          depositAmount: `${v.depositAmount} ${v.symbol}`,
          mintAmount: `${v.mintAmount} USDST`,
        })),
      });
    }
    
    onHFValidationChange(hasLowHF);
  }, [vaultCandidates, autoAllocate, checkVaultHasLowCR, onHFValidationChange]);

  // Validate Balance - Checks if any deposit amount exceeds available user balance
  useEffect(() => {
    if (!onBalanceExceededChange || autoAllocate) return;

    let exceedsBalance = false;
    const failingVaults: Array<{
      symbol: string;
      assetAddress: ADDRESS;
      depositAmount: string;
      availableBalance: string;
      depositAmountFormatted: string;
      availableBalanceFormatted: string;
    }> = [];

    for (const candidate of vaultCandidates) {
      if (!candidate.allocation) continue;
      
      const depositAmount: UNITS = candidate.allocation.depositAmount;
      if (depositAmount === 0n) continue;
      
      const availableBalance: UNITS = candidate.potentialCollateral;
      
      if (depositAmount > availableBalance) {
        exceedsBalance = true;
        const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
        const depositFormatted = formatUnits(depositAmount, decimals);
        const availableFormatted = formatUnits(availableBalance, decimals);
        
        failingVaults.push({
          symbol: candidate.vaultConfig.symbol,
          assetAddress: candidate.vaultConfig.assetAddress,
          depositAmount: depositAmount.toString(),
          availableBalance: availableBalance.toString(),
          depositAmountFormatted: parseFloat(depositFormatted).toLocaleString('en-US', { maximumFractionDigits: 6 }),
          availableBalanceFormatted: parseFloat(availableFormatted).toLocaleString('en-US', { maximumFractionDigits: 6 }),
        });
      }
    }
    
    if (exceedsBalance && failingVaults.length > 0) {
      console.error('[VaultBreakdown] ❌ INSUFFICIENT COLLATERAL WARNING:', {
        failingCondition: 'depositAmount > availableBalance',
        failingVaults: failingVaults.map(v => ({
          symbol: v.symbol,
          assetAddress: v.assetAddress,
          expected: `≤ ${v.availableBalanceFormatted} ${v.symbol}`,
          actual: `${v.depositAmountFormatted} ${v.symbol}`,
          expectedRaw: v.availableBalance,
          actualRaw: v.depositAmount,
        })),
      });
    }
    
    onBalanceExceededChange(exceedsBalance);
  }, [vaultCandidates, autoAllocate, onBalanceExceededChange]);

  // Validate Mint Exceeds Max - Checks if any mint amount exceeds max available
  useEffect(() => {
    if (!onMintExceedsMaxChange || autoAllocate) return;

    let anyMintExceedsMax = false;

    for (const candidate of vaultCandidates) {
      if (!candidate.allocation) continue;
      
      const mintAmount = candidate.allocation.mintAmount;
      if (mintAmount === 0n) continue;
      
      // Use memoized max mint units
      const computed = vaultComputedValues[candidate.vaultConfig.assetAddress];
      if (!computed) continue;
      
      // Check if mint exceeds max
      if (mintAmount > computed.mintMaxUnits) {
        anyMintExceedsMax = true;
        break;
      }
    }
    
    onMintExceedsMaxChange(anyMintExceedsMax);
  }, [vaultCandidates, vaultComputedValues, autoAllocate, onMintExceedsMaxChange]);

  // Calculate Total Manual Mint - Sums all mint amounts across vaults for display
  useEffect(() => {
    if (!onTotalManualMintChange || autoAllocate) return;

    let totalMintUnits: WEI = 0n;
    for (const candidate of vaultCandidates) {
      totalMintUnits += candidate.allocation?.mintAmount || 0n;
    }
    
    const totalMintDecimal: DECIMAL = parseFloat(formatUnits(totalMintUnits, 18));
    onTotalManualMintChange(totalMintDecimal > 0 ? String(totalMintDecimal) : '0');
  }, [vaultCandidates, autoAllocate, onTotalManualMintChange]);



  // ============================================================================
  // Event Handlers
  // ============================================================================

  const handleDepositChange = useCallback((
    assetAddress: ADDRESS, 
    floatValue: USD | DECIMAL | undefined, 
    formattedValue: string
  ) => {
    // GUARD: Skip all callbacks during auto-to-manual initialization
    if (isInitializingRef.current) return;
    
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    if (floatValue === undefined || formattedValue === '') {
      setVaultInputs(prev => ({ 
        ...prev, 
        [assetAddress]: { ...prev[assetAddress], depositAmount: '' } 
      }));
      setDepositMaxVaults(prev => {
        const newSet = new Set(prev);
        newSet.delete(assetAddress);
        return newSet;
      });
      if (!autoAllocate && onDepositAmountChange) {
        onDepositAmountChange(assetAddress, '0');
      }
      return;
    }

    setVaultInputs(prev => ({ 
      ...prev, 
      [assetAddress]: { ...prev[assetAddress], depositAmount: formattedValue } 
    }));
    
    if (!autoAllocate && onDepositAmountChange) {
      const computed = vaultComputedValues[assetAddress];
      if (!computed) return;
      
      // Get the max display value based on displayMode
      // Parse the display string to match what user sees/types
      const maxDisplayNum = displayMode === 'Value' 
        ? parseFloat(computed.depositMaxValue)
        : parseFloat(computed.depositMaxAmount);
      
      // Check if input matches max available
      const matchesMax = floatValue === maxDisplayNum && maxDisplayNum > 0;
      
      // If input matches max, use exact potentialCollateral to avoid precision loss
      // Otherwise, convert the input to units
      let depositUnits: UNITS;
      if (matchesMax) {
        depositUnits = computed.depositMaxUnits;
      } else {
        if (displayMode === 'Value') {
          // User entered USD value, convert to token amount
          const roundedUSD = parseFloat(floatValue.toFixed(2));
          const price: WEI = getPrice(assetAddress);
          if (price > 0n) {
            const valueUnits: WEI = parseUnitsWithTruncation(roundedUSD.toString(), 18);
            // amount = (value * unitScale) / price
            depositUnits = (valueUnits * candidate.vaultConfig.unitScale) / price;
          } else {
            depositUnits = 0n;
          }
        } else {
          // User entered token amount directly
          depositUnits = parseUnitsWithTruncation(String(floatValue), computed.decimals);
        }
      }

      // GUARD: Check if this matches a pre-calculated representation
      // This detects display mode switches vs real user edits
      const representations = allocationRepresentations[assetAddress];
      if (representations && depositUnits === representations.depositAmountToken) {
        return;
      }
      
      // Update depositMaxVaults set
      if (matchesMax) {
        setDepositMaxVaults(prev => {
          const newSet = new Set(prev);
          newSet.add(assetAddress);
          return newSet;
        });
      } else {
        setDepositMaxVaults(prev => {
          const newSet = new Set(prev);
          newSet.delete(assetAddress);
          return newSet;
        });
      }
      
      onDepositAmountChange(assetAddress, depositUnits.toString());
    }
  }, [vaultCandidates, vaultComputedValues, autoAllocate, displayMode, getPrice, onDepositAmountChange, allocationRepresentations]);

  const handleMintChange = useCallback((
    assetAddress: ADDRESS, 
    floatValue: DECIMAL | undefined, 
    formattedValue: string
  ) => {
    // GUARD: Skip all callbacks during auto-to-manual initialization
    if (isInitializingRef.current) return;
    
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    if (floatValue === undefined || formattedValue === '') {
      setVaultInputs(prev => ({ 
        ...prev, 
        [assetAddress]: { ...prev[assetAddress], mintAmount: '' } 
      }));
      setMintMaxVaults(prev => {
        const newSet = new Set(prev);
        newSet.delete(assetAddress);
        return newSet;
      });
      if (!autoAllocate && onMintAmountChange) {
        onMintAmountChange(assetAddress, '0');
      }
      return;
    }

    setVaultInputs(prev => ({ 
      ...prev, 
      [assetAddress]: { ...prev[assetAddress], mintAmount: formattedValue } 
    }));

    if (!autoAllocate && onMintAmountChange) {
      const computed = vaultComputedValues[assetAddress];
      if (!computed) return;
      
      // Get the max display value based on displayMode (for USDST, amount === value)
      // Parse the display string to match what user sees/types
      const maxDisplayNum = displayMode === 'Value' 
        ? parseFloat(computed.mintMaxValue)
        : parseFloat(computed.mintMaxAmount);
      
      // Check if input matches max available
      const matchesMax = floatValue === maxDisplayNum && maxDisplayNum > 0;
      
      // If input matches max, use exact maxMintUnits to avoid precision loss
      // Otherwise, convert the input to units
      let mintUnits: WEI;
      if (matchesMax) {
        mintUnits = computed.mintMaxUnits;
      } else {
        mintUnits = parseUnitsWithTruncation(String(floatValue), 18);
      }
      
      // GUARD: Check if this matches a pre-calculated representation
      const representations = allocationRepresentations[assetAddress];
      if (representations && mintUnits === representations.mintAmountToken) {
        return;
      }
      
      // Update mintMaxVaults set
      if (matchesMax) {
        setMintMaxVaults(prev => {
          const newSet = new Set(prev);
          newSet.add(assetAddress);
          return newSet;
        });
      } else {
        setMintMaxVaults(prev => {
          const newSet = new Set(prev);
          newSet.delete(assetAddress);
          return newSet;
        });
      }
      
      onMintAmountChange(assetAddress, mintUnits.toString());
    }
  }, [vaultCandidates, vaultComputedValues, autoAllocate, onMintAmountChange, allocationRepresentations, displayMode]);

  const handleDepositAvailableClick = useCallback((
    e: React.MouseEvent, 
    candidate: VaultCandidate
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const computed = vaultComputedValues[candidate.vaultConfig.assetAddress];
    if (!computed) return;
    
    // Set flag to prevent handleDepositChange from being triggered
    // when NumericFormat fires onValueChange after we programmatically set values
    isInitializingRef.current = true;
    
    // Add to depositMaxVaults
    setDepositMaxVaults(prev => {
      const newSet = new Set(prev);
      newSet.add(candidate.vaultConfig.assetAddress);
      return newSet;
    });
    
    // Use memoized display value based on displayMode
    const displayValue = displayMode === 'Value' 
      ? computed.depositMaxValue 
      : computed.depositMaxAmount;

    setVaultInputs(prev => ({ 
      ...prev, 
      [candidate.vaultConfig.assetAddress]: { 
        ...prev[candidate.vaultConfig.assetAddress], 
        depositAmount: displayValue 
      } 
    }));
    
    if (!autoAllocate && onDepositAmountChange) {
      // Use exact memoized units to avoid precision loss
      onDepositAmountChange(candidate.vaultConfig.assetAddress, computed.depositMaxUnits.toString());
    }
    
    // Clear the flag after NumericFormat has settled
    setTimeout(() => {
      isInitializingRef.current = false;
    }, 100);
    
    setTimeout(() => {
      depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
      setFocusedInput(null);
    }, 0);
  }, [displayMode, vaultComputedValues, autoAllocate, onDepositAmountChange]);

  const handleMintAvailableClick = useCallback((
    e: React.MouseEvent, 
    candidate: VaultCandidate
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const computed = vaultComputedValues[candidate.vaultConfig.assetAddress];
    if (!computed) return;
    
    // Set flag to prevent handleMintChange/handleDepositChange from being triggered
    // when NumericFormat fires onValueChange after we programmatically set values
    isInitializingRef.current = true;
    
    // Add to both mintMaxVaults and depositMaxVaults since we're setting both to max
    setMintMaxVaults(prev => {
      const newSet = new Set(prev);
      newSet.add(candidate.vaultConfig.assetAddress);
      return newSet;
    });
    
    setDepositMaxVaults(prev => {
      const newSet = new Set(prev);
      newSet.add(candidate.vaultConfig.assetAddress);
      return newSet;
    });
    
    // Use memoized display values based on displayMode
    const depositDisplayValue = displayMode === 'Value' 
      ? computed.depositMaxValue 
      : computed.depositMaxAmount;
    
    const mintDisplayValue = displayMode === 'Value' 
      ? computed.mintMaxValue 
      : computed.mintMaxAmount;
    
    // Update display values
    setVaultInputs(prev => ({ 
      ...prev, 
      [candidate.vaultConfig.assetAddress]: { 
        depositAmount: depositDisplayValue,
        mintAmount: mintDisplayValue,
      } 
    }));
    
    // Call parent callbacks with exact memoized BigInt strings
    if (!autoAllocate) {
      if (onDepositAmountChange) {
        onDepositAmountChange(candidate.vaultConfig.assetAddress, computed.depositMaxUnits.toString());
      }
      if (onMintAmountChange) {
        onMintAmountChange(candidate.vaultConfig.assetAddress, computed.mintMaxUnits.toString());
      }
    }
    
    // Clear the flag after NumericFormat has settled
    setTimeout(() => {
      isInitializingRef.current = false;
    }, 100);
    
    setTimeout(() => {
      depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
      mintInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
      setFocusedInput(null);
    }, 0);
  }, [displayMode, vaultComputedValues, autoAllocate, onDepositAmountChange, onMintAmountChange]);



  // ============================================================================
  // Render
  // ============================================================================


  return (
    <div className="space-y-2">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full flex items-center justify-between p-3 rounded-md border border-border hover:bg-muted/80"
          >
            <Label className="text-sm font-medium cursor-pointer">Vault Breakdown</Label>
            <div className="flex items-center gap-2">
              {isOpen && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setDisplayMode(prev => prev === 'Value' ? 'Amount' : 'Value');
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="h-6 px-2 text-xs rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center cursor-pointer"
                >
                  {displayMode === 'Value' ? 'Value' : 'Amount'}
                </span>
              )}
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 px-3 pt-3 pb-3 border border-border rounded-md bg-muted/50 space-y-3">
            {/* Warnings */}
            {exceedsBalance && !autoAllocate && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Deposit Exceeds Available Balance</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  One or more vaults have a deposit amount that exceeds your available balance.
                </p>
              </div>
            )}

            {hasLowHF && !autoAllocate && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateralization</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  One or more vaults have insufficient collateral for the mint amount. Increase deposit or decrease mint amount.
                </p>
              </div>
            )}

            {/* Vault Grid */}
            <div className="space-y-2">
              <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border ${getGridClass()}`}>
                <div>Asset</div>
                <div>Stability Fee</div>
                <div>Deposit</div>
                {showMintAmounts && <div>Mint</div>}
                {!autoAllocate && <div className="text-right pr-3">HF</div>}
              </div>
              
              {vaultCandidates
                .filter((candidate) => {
                  // In auto mode, omit vaults with 0 deposit and 0 mint
                  if (autoAllocate) {
                    const hasDeposit = candidate.allocation?.depositAmount && candidate.allocation.depositAmount > 0n;
                    const hasMint = candidate.allocation?.mintAmount && candidate.allocation.mintAmount > 0n;
                    return hasDeposit || hasMint;
                  }
                  // In manual mode, show all vaults
                  return true;
                })
                .map((candidate) => {
                const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(candidate.vaultConfig.stabilityFeeRate);
                const token = [...earningAssets, ...inactiveTokens].find(
                  t => t.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
                );
                const tokenImage = token?.images?.[0]?.value;

                // Get memoized computed values for this vault
                const computed = vaultComputedValues[candidate.vaultConfig.assetAddress];
                const decimals = computed?.decimals || (candidate.vaultConfig.unitScale.toString().length - 1);
                
                // Get actual amounts from allocation (source of truth)
                const depositAmt = candidate.allocation 
                  ? parseFloat(formatUnits(candidate.allocation.depositAmount, decimals))
                  : 0;
                const mintAmt = candidate.allocation 
                  ? parseFloat(formatUnits(candidate.allocation.mintAmount, 18))
                  : 0;
                
                const hf = calculateVaultHF(candidate, depositAmt, mintAmt);
                const hfNum = parseFloat(hf);
                const hfColor = getHFColorClass(hf, hfNum);
                
                // Validate CR using exact BigInt math (matches on-chain validation)
                const vaultHasLowHF = checkVaultHasLowCR(candidate, true);

                // Get display values from vaultInputs
                const inputs = vaultInputs[candidate.vaultConfig.assetAddress] || { depositAmount: '', mintAmount: '' };
                const depositDisplayNum = toNumber(inputs.depositAmount);
                const mintDisplayNum = toNumber(inputs.mintAmount);
                
                // Use memoized max values based on displayMode
                // Parse the display strings to match what user sees/types
                const maxDepositDisplayNum = computed 
                  ? (displayMode === 'Value' ? parseFloat(computed.depositMaxValue) : parseFloat(computed.depositMaxAmount))
                  : 0;
                const maxMintDisplayNum = computed
                  ? (displayMode === 'Value' ? parseFloat(computed.mintMaxValue) : parseFloat(computed.mintMaxAmount))
                  : 0;
                
                // Check if deposit exceeds max available (red border condition for deposit)
                const depositExceedsMax = !autoAllocate && 
                  depositDisplayNum > 0 && 
                  depositDisplayNum > maxDepositDisplayNum;
                
                // Check if deposit matches available balance (for blue border)
                // Only show blue highlight if in max set AND value is not 0
                const depositMatchesAvailable = depositMaxVaults.has(candidate.vaultConfig.assetAddress) && 
                  depositDisplayNum > 0;
                
                // Check if mint exceeds max available (red border condition for mint)
                const mintExceedsMax = !autoAllocate && 
                  mintDisplayNum > 0 && 
                  mintDisplayNum > maxMintDisplayNum;
                
                // Check if mint matches max mintable (for blue border)
                // Only show blue highlight if in max set AND value is not 0
                const mintMatchesAvailable = mintMaxVaults.has(candidate.vaultConfig.assetAddress) && 
                  mintDisplayNum > 0;


                return (
                  <div key={candidate.vaultConfig.assetAddress} className={`grid gap-2 items-center text-sm ${getGridClass()}`}>
                    {/* Asset */}
                    <div className="flex items-center gap-2">
                      {tokenImage ? (
                        <img src={tokenImage} alt={candidate.vaultConfig.symbol} className="w-6 h-6 rounded-full object-cover" />
                      ) : (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                          style={{ backgroundColor: getAssetColor(candidate.vaultConfig.symbol) }}
                        >
                          {candidate.vaultConfig.symbol.slice(0, 2)}
                        </div>
                      )}
                      <span className="font-medium">{candidate.vaultConfig.symbol}</span>
                    </div>
                    
                    {/* Stability Fee */}
                    <div className="text-muted-foreground">{formatPercentage(stabilityFeeRate)}</div>
                    
                    {/* Deposit Input */}
                    <div className="space-y-1">
                      <div className="relative">
                        {displayMode === 'Value' && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none z-10">$</span>
                        )}
                        <NumericFormat
                          value={inputs.depositAmount}
                          onValueChange={(values) => handleDepositChange(candidate.vaultConfig.assetAddress, values.floatValue, values.formattedValue)}
                          onFocus={() => { 
                            setFocusedInput(`deposit-${candidate.vaultConfig.assetAddress}`);
                          }}
                          onBlur={() => { 
                            setFocusedInput(null);
                          }}
                          getInputRef={(el) => { depositInputRefs.current[candidate.vaultConfig.assetAddress] = el; }}
                          allowNegative={false}
                          thousandSeparator=","
                          decimalScale={autoAllocate && displayMode === 'Value' ? 2 : undefined}
                          customInput={Input}
                          placeholder="0"
                          className={`h-8 text-xs ${displayMode === 'Value' ? 'pl-5' : ''} ${
                            vaultHasLowHF || depositExceedsMax
                              ? 'border-red-500 focus-visible:ring-red-500' 
                              : depositMatchesAvailable 
                              ? 'border-blue-500 focus-visible:ring-blue-500' 
                              : ''
                          }`}
                          disabled={autoAllocate}
                        />
                      </div>
                      {focusedInput === `deposit-${candidate.vaultConfig.assetAddress}` && computed && (
                        displayMode === 'Value' ? (
                          <div 
                            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                            onMouseDown={(e) => handleDepositAvailableClick(e, candidate)}
                          >
                            Available: ${truncateForDisplay(computed.depositMaxValueNum)}
                          </div>
                        ) : (
                          <div 
                            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                            onMouseDown={(e) => handleDepositAvailableClick(e, candidate)}
                          >
                            Available: {truncateForDisplay(computed.depositMaxAmountNum)} {candidate.vaultConfig.symbol}
                          </div>
                        )
                      )}
                    </div>
                    
                    {/* Mint Input */}
                    {showMintAmounts && (
                      <div className="space-y-1">
                        <div className="relative">
                          {displayMode === 'Value' && (
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none z-10">$</span>
                          )}
                          <NumericFormat
                            value={inputs.mintAmount}
                            onValueChange={(values) => handleMintChange(candidate.vaultConfig.assetAddress, values.floatValue, values.formattedValue)}
                            onFocus={() => { 
                              setFocusedInput(`mint-${candidate.vaultConfig.assetAddress}`);
                            }}
                            onBlur={() => { 
                              setFocusedInput(null);
                            }}
                            getInputRef={(el) => { mintInputRefs.current[candidate.vaultConfig.assetAddress] = el; }}
                            allowNegative={false}
                            thousandSeparator=","
                            decimalScale={autoAllocate && displayMode === 'Value' ? 2 : undefined}
                            customInput={Input}
                            placeholder="0"
                            className={`h-8 text-xs ${displayMode === 'Value' ? 'pl-5' : ''} ${
                              vaultHasLowHF || mintExceedsMax
                                ? 'border-red-500 focus-visible:ring-red-500' 
                                : mintMatchesAvailable 
                                ? 'border-blue-500 focus-visible:ring-blue-500' 
                                : ''
                            }`}
                            disabled={autoAllocate}
                          />
                        </div>
                        {focusedInput === `mint-${candidate.vaultConfig.assetAddress}` && computed && (
                          <div 
                            className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                            onMouseDown={(e) => handleMintAvailableClick(e, candidate)}
                          >
                            Available: {truncateForDisplay(computed.mintMaxAmountNum)} USDST
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* HF */}
                    {!autoAllocate && (
                      <div className={`font-medium text-right pr-3 ${hfColor}`}>{hf}</div>
                    )}
                  </div>
                );
              })}
              
              {vaultCandidates.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-2">No vault candidates available</div>
              )}
            </div>

            {/* Summary Section */}
            {!autoAllocate && (() => {
              // Calculate total wei and formatted display value
              const totalMintWei: WEI = vaultCandidates.reduce((sum, candidate) => {
                return sum + (candidate.allocation?.mintAmount || 0n);
              }, 0n);
              
              const totalMintDisplay = vaultCandidates.reduce((sum, candidate) => {
                const mintAmt = candidate.allocation 
                  ? parseFloat(formatUnits(candidate.allocation.mintAmount, 18))
                  : 0;
                return sum + mintAmt;
              }, 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

              return (
                <div className="pt-2 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Total Mint Amount:</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm font-bold tabular-nums cursor-help text-blue-600">
                            {totalMintDisplay} USDST
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs font-mono">{totalMintWei.toString()} USDST</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {projectedVaultHealth && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-muted-foreground">Projected Vault Health:</span>
                      <span className="text-sm font-bold tabular-nums">{projectedVaultHealth}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default VaultBreakdown;
