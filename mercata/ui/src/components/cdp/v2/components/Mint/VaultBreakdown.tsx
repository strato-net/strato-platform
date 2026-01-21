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
  calculateVaultMinHF,
  calculateVaultHFRaw,
  calculateVaultHF,
  calculateMaxMintForVault,
  calculateMaxMintUnitsForVault,
  truncateForDisplay,
  getHFColorClass,
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



  // ============================================================================
  // Refs
  // ============================================================================

  const prevMintMaxVaultsRef = useRef<Set<ADDRESS>>(new Set());
  const prevAutoSupplyRef = useRef<boolean>(autoAllocate);
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



  // ============================================================================
  // Memos - Derived State
  // ============================================================================

  const isSliderAtMin = targetHF !== undefined && minHF !== undefined && Math.abs(targetHF - minHF) < 0.01;
  const isFullMaxMode = autoAllocate && isMaxMode && isSliderAtMin;

  // projectedVaultHealth is now passed as a prop from Mint.tsx to avoid duplication

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

  // Log mintMaxVaults whenever it changes
  useEffect(() => {
    const vaultSymbols = Array.from(mintMaxVaults).map(address => {
      const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === address);
      return candidate ? candidate.vaultConfig.symbol : address;
    });
    console.log('[VaultBreakdown] mintMaxVaults changed:', {
      addresses: Array.from(mintMaxVaults),
      symbols: vaultSymbols,
      count: mintMaxVaults.size,
    });
  }, [mintMaxVaults, vaultCandidates]);

  // Log display values (vaultInputs) whenever they change
  useEffect(() => {
    const displayData = Object.entries(vaultInputs).map(([address, inputs]) => {
      const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === address);
      return {
        symbol: candidate?.vaultConfig.symbol || address,
        assetAddress: address,
        depositAmount: inputs.depositAmount,
        mintAmount: inputs.mintAmount,
      };
    });
    console.log('[VaultBreakdown] 📊 Display values (vaultInputs) changed:', {
      displayMode,
      vaults: displayData,
      count: displayData.length,
    });
  }, [vaultInputs, vaultCandidates, displayMode]);

  // Log depositMaxVaults (vaults where depositAmount === potentialCollateral) whenever they change
  useEffect(() => {
    const depositMaxVaults = vaultCandidates
      .filter(c => c.allocation && c.allocation.depositAmount === c.potentialCollateral && c.potentialCollateral > 0n)
      .map(c => ({
        address: c.vaultConfig.assetAddress,
        symbol: c.vaultConfig.symbol,
        depositAmount: c.allocation!.depositAmount.toString(),
        potentialCollateral: c.potentialCollateral.toString(),
      }));
    
    console.log('[VaultBreakdown] depositMaxVaults changed:', {
      vaults: depositMaxVaults,
      count: depositMaxVaults.length,
    });
  }, [vaultCandidates]);

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
      if (!hasAllocations) return;

      // Set flag to prevent callbacks during initialization
      isInitializingRef.current = true;

      const newMintMaxVaults = new Set<string>();
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
        if (depositBigInt > 0n) {
          const tokenAmount = formatUnits(depositBigInt, decimals);
          depositAmountDisplay = tokenAmount;
          depositValueDisplay = amountToValue(tokenAmount, c.vaultConfig.assetAddress, false);
        }

        // Pre-calculate BOTH representations for mint
        let mintAmountDisplay = '';
        let mintValueDisplay = '';
        if (mintBigInt > 0n) {
          const mintDecimal = formatUnits(mintBigInt, 18);
          mintAmountDisplay = mintDecimal;
          mintValueDisplay = parseFloat(mintDecimal).toFixed(2);
          
          const depositUnits = depositBigInt || 0n;
          const maxMintUnits = calculateMaxMintUnitsForVault(c, depositUnits);
          const shouldAddToMintMax = mintBigInt === maxMintUnits && maxMintUnits > 0n;
          if (shouldAddToMintMax) {
            newMintMaxVaults.add(c.vaultConfig.assetAddress);
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
      
      // Clear flag after a brief delay to allow NumericFormat to settle
      setTimeout(() => {
        isInitializingRef.current = false;
      }, 100);
    }
    
    prevAutoSupplyRef.current = autoAllocate;
  }, [autoAllocate, vaultCandidates, displayMode, amountToValue]);

  // ============================================================================
  // Effects - Display Mode Sync (Manual Mode)
  // When display mode changes, recalculate display values
  // For vaults in max arrays, use the same raw values that "Available: x" click uses
  // ============================================================================
  
  useEffect(() => {
    if (autoAllocate) return;
    
    // Set flag to prevent callbacks during display mode switch
    isInitializingRef.current = true;
    
    const newInputs: Record<ADDRESS, { depositAmount: string; mintAmount: string }> = {};
    
    vaultCandidates.forEach(c => {
      const decimals = c.vaultConfig.unitScale.toString().length - 1;
      const isDepositMax = c.allocation && c.allocation.depositAmount === c.potentialCollateral && c.potentialCollateral > 0n;
      const isMintMax = mintMaxVaults.has(c.vaultConfig.assetAddress);
      
      let depositDisplay = '';
      let mintDisplay = '';
      
      // For deposit: if in deposit max, use raw potentialCollateral value
      if (isDepositMax) {
        const depositAmountRaw = formatUnits(c.potentialCollateral, decimals);
        depositDisplay = displayMode === 'Value' 
          ? amountToValue(depositAmountRaw, c.vaultConfig.assetAddress, true)
          : depositAmountRaw;
      } else if (c.allocation?.depositAmount && c.allocation.depositAmount > 0n) {
        const tokenAmount = formatUnits(c.allocation.depositAmount, decimals);
        depositDisplay = displayMode === 'Value' 
          ? amountToValue(tokenAmount, c.vaultConfig.assetAddress, true)
          : tokenAmount;
      }
      
      // For mint: if in mint max, use raw calculateMaxMintUnitsForVault value
      if (isMintMax) {
        const depositForCalc = c.allocation?.depositAmount || c.potentialCollateral || 0n;
        const maxMintUnits = calculateMaxMintUnitsForVault(c, depositForCalc);
        const mintAmountRaw = formatUnits(maxMintUnits, 18);
        mintDisplay = displayMode === 'Value' 
          ? parseFloat(mintAmountRaw).toFixed(2)
          : mintAmountRaw;
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
  }, [displayMode, autoAllocate, vaultCandidates, mintMaxVaults, amountToValue]);

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

    // Check for mint max matches
    const newMintMaxVaults = new Set<ADDRESS>();
    vaultCandidates.forEach(c => {
      const depositBigInt = c.allocation?.depositAmount || 0n;
      const mintBigInt = c.allocation?.mintAmount || 0n;
      if (mintBigInt > 0n) {
        const maxMintUnits = calculateMaxMintUnitsForVault(c, depositBigInt);
        const shouldAddToMintMax = mintBigInt === maxMintUnits && maxMintUnits > 0n;
        if (shouldAddToMintMax) {
          newMintMaxVaults.add(c.vaultConfig.assetAddress);
        }
      }
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

  // Validate Health Factor - Checks if any vault has health factor below minimum
  useEffect(() => {
    if (!onHFValidationChange || autoAllocate) return;

    let hasLowHF = false;
    const failingVaults: Array<{
      symbol: string;
      assetAddress: ADDRESS;
      healthFactor: number;
      minimumHF: number;
      depositAmount: string;
      mintAmount: string;
    }> = [];

    for (const candidate of vaultCandidates) {
      if (!candidate.allocation) continue;
      
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const depositAmt = parseFloat(formatUnits(candidate.allocation.depositAmount, decimals));
      const mintAmt = parseFloat(formatUnits(candidate.allocation.mintAmount, 18));
      
      if (mintAmt === 0) continue;
      
      const hfRaw = calculateVaultHFRaw(candidate, depositAmt, mintAmt);
      const vaultMinHF = calculateVaultMinHF(candidate);
      
      if (hfRaw !== null && hfRaw < vaultMinHF) {
        hasLowHF = true;
        failingVaults.push({
          symbol: candidate.vaultConfig.symbol,
          assetAddress: candidate.vaultConfig.assetAddress,
          healthFactor: hfRaw,
          minimumHF: vaultMinHF,
          depositAmount: depositAmt.toLocaleString('en-US', { maximumFractionDigits: 6 }),
          mintAmount: mintAmt.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        });
      }
    }
    
    if (hasLowHF && failingVaults.length > 0) {
      console.error('[VaultBreakdown] ❌ HEALTH FACTOR BELOW MINIMUM WARNING:', {
        failingCondition: 'healthFactor < minimumHF',
        failingVaults: failingVaults.map(v => ({
          symbol: v.symbol,
          assetAddress: v.assetAddress,
          expected: `≥ ${v.minimumHF.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
          actual: `${v.healthFactor.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
          depositAmount: `${v.depositAmount} ${v.symbol}`,
          mintAmount: `${v.mintAmount} USD`,
        })),
      });
    }
    
    onHFValidationChange(hasLowHF);
  }, [vaultCandidates, autoAllocate, onHFValidationChange]);

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
    if (isInitializingRef.current) {
      return;
    }
    
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    if (floatValue === undefined || formattedValue === '') {
      setVaultInputs(prev => ({ 
        ...prev, 
        [assetAddress]: { ...prev[assetAddress], depositAmount: '' } 
      }));
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
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      let depositUnits: UNITS;

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
        depositUnits = parseUnitsWithTruncation(String(floatValue), decimals);
      }

      // GUARD: Check if this matches a pre-calculated representation
      // This detects display mode switches vs real user edits
      const representations = allocationRepresentations[assetAddress];
      if (representations && depositUnits === representations.depositAmountToken) {
        return;
      }

      // Check if input matches potential collateral exactly
      if (depositUnits === candidate.potentialCollateral && candidate.potentialCollateral > 0n) {
        onDepositAmountChange(assetAddress, candidate.potentialCollateral.toString());
      } else {
        onDepositAmountChange(assetAddress, depositUnits.toString());
      }
    }
  }, [vaultCandidates, autoAllocate, displayMode, getPrice, onDepositAmountChange, allocationRepresentations]);

  const handleMintChange = useCallback((
    assetAddress: ADDRESS, 
    floatValue: DECIMAL | undefined, 
    formattedValue: string
  ) => {
    // GUARD: Skip all callbacks during auto-to-manual initialization
    if (isInitializingRef.current) {
      return;
    }
    
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
      const depositUnits = candidate.allocation?.depositAmount || 0n;
      const maxMintUnits = calculateMaxMintUnitsForVault(candidate, depositUnits);
      const inputUnits = parseUnitsWithTruncation(String(floatValue), 18);
      
      // GUARD: Check if this matches a pre-calculated representation
      const representations = allocationRepresentations[assetAddress];
      if (representations && inputUnits === representations.mintAmountToken) {
        return;
      }
      
      const shouldAddToMintMax = inputUnits === maxMintUnits && maxMintUnits > 0n;
      
      if (shouldAddToMintMax) {
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
      
      onMintAmountChange(assetAddress, inputUnits.toString());
    }
  }, [vaultCandidates, autoAllocate, onMintAmountChange, allocationRepresentations, displayMode]);

  const handleDepositAvailableClick = useCallback((
    e: React.MouseEvent, 
    candidate: VaultCandidate
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Set flag to prevent handleDepositChange from being triggered
    // when NumericFormat fires onValueChange after we programmatically set values
    isInitializingRef.current = true;
    
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    const tokenAmount = formatUnits(candidate.potentialCollateral, decimals);
    
    let displayValue: string;
    if (displayMode === 'Value') {
      const price: WEI = getPrice(candidate.vaultConfig.assetAddress);
      // value = (amount * price) / unitScale
      const valueUnits: WEI = (candidate.potentialCollateral * price) / candidate.vaultConfig.unitScale;
      const usdValue = parseFloat(formatUnits(valueUnits, 18));
      displayValue = usdValue.toFixed(2);
    } else {
      displayValue = tokenAmount;
    }

    setVaultInputs(prev => ({ 
      ...prev, 
      [candidate.vaultConfig.assetAddress]: { 
        ...prev[candidate.vaultConfig.assetAddress], 
        depositAmount: displayValue 
      } 
    }));
    
    if (!autoAllocate && onDepositAmountChange) {
      onDepositAmountChange(candidate.vaultConfig.assetAddress, candidate.potentialCollateral.toString());
    }
    
    // Clear the flag after NumericFormat has settled
    setTimeout(() => {
      isInitializingRef.current = false;
    }, 100);
    
    setTimeout(() => {
      depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
      setFocusedInput(null);
    }, 0);
  }, [displayMode, getPrice, autoAllocate, onDepositAmountChange]);

  const handleMintAvailableClick = useCallback((
    e: React.MouseEvent, 
    candidate: VaultCandidate
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Set flag to prevent handleMintChange/handleDepositChange from being triggered
    // when NumericFormat fires onValueChange after we programmatically set values
    isInitializingRef.current = true;
    
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    
    // Use exact BigInt calculation to avoid precision loss from float conversion
    // This ensures the value matches exactly what calculateMaxMintUnitsForVault returns
    const maxMintUnits: WEI = calculateMaxMintUnitsForVault(candidate, candidate.potentialCollateral);
    const maxMintDecimal = formatUnits(maxMintUnits, 18);
    
    // Add to mintMaxVaults
    setMintMaxVaults(prev => {
      const newSet = new Set(prev);
      newSet.add(candidate.vaultConfig.assetAddress);
      return newSet;
    });
    
    // Populate deposit input and call parent callback
    let depositDisplayValue: string;
    if (displayMode === 'Value') {
      const price: WEI = getPrice(candidate.vaultConfig.assetAddress);
      const valueUnits: WEI = (candidate.potentialCollateral * price) / candidate.vaultConfig.unitScale;
      const usdValue = parseFloat(formatUnits(valueUnits, 18));
      depositDisplayValue = usdValue.toFixed(2);
    } else {
      depositDisplayValue = formatUnits(candidate.potentialCollateral, decimals);
    }
    
    // Populate mint input - use exact BigInt formatted value
    let mintDisplayValue: string;
    if (displayMode === 'Value') {
      mintDisplayValue = parseFloat(maxMintDecimal).toFixed(2);
    } else {
      mintDisplayValue = maxMintDecimal;
    }
    
    // Update display values
    setVaultInputs(prev => ({ 
      ...prev, 
      [candidate.vaultConfig.assetAddress]: { 
        depositAmount: depositDisplayValue,
        mintAmount: mintDisplayValue,
      } 
    }));
    
    // Call parent callbacks with exact BigInt strings
    if (!autoAllocate) {
      if (onDepositAmountChange) {
        onDepositAmountChange(candidate.vaultConfig.assetAddress, candidate.potentialCollateral.toString());
      }
      if (onMintAmountChange) {
        onMintAmountChange(candidate.vaultConfig.assetAddress, maxMintUnits.toString());
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
  }, [displayMode, getPrice, autoAllocate, onDepositAmountChange, onMintAmountChange]);



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
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Health Factor Below Minimum</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  One or more vaults have a health factor below the required minimum.
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

                // Get actual amounts from allocation (source of truth)
                const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                const depositAmt = candidate.allocation 
                  ? parseFloat(formatUnits(candidate.allocation.depositAmount, decimals))
                  : 0;
                const mintAmt = candidate.allocation 
                  ? parseFloat(formatUnits(candidate.allocation.mintAmount, 18))
                  : 0;
                
                const hf = calculateVaultHF(candidate, depositAmt, mintAmt);
                const hfNum = parseFloat(hf);
                const hfColor = getHFColorClass(hf, hfNum);
                
                const vaultMinHF = calculateVaultMinHF(candidate);
                const vaultHasLowHF = !autoAllocate && 
                  mintAmt > 0 &&
                  hfNum !== Infinity && !isNaN(hfNum) && hfNum < vaultMinHF;

                const vaultExceedsBalance = !autoAllocate && 
                  candidate.allocation && 
                  candidate.allocation.depositAmount > candidate.potentialCollateral;

                // Get display values from vaultInputs
                const inputs = vaultInputs[candidate.vaultConfig.assetAddress] || { depositAmount: '', mintAmount: '' };
                const depositDisplayValue = inputs.depositAmount;
                const depositDisplayNum = toNumber(depositDisplayValue);
                
                // Check if deposit matches available balance (for blue border)
                const depositMatchesAvailable = candidate.allocation 
                  ? candidate.allocation.depositAmount === candidate.potentialCollateral && candidate.potentialCollateral > 0n
                  : false;


                const mintDisplayValue = inputs.mintAmount;
                const mintDisplayNum = toNumber(mintDisplayValue);
                
                // Check if mint matches max mintable (for blue border)
                // Use mintMaxVaults set as source of truth (set explicitly when user clicks Available)
                // Also check allocation match as fallback for when values sync
                const depositForMintCalc = candidate.allocation?.depositAmount || candidate.potentialCollateral || 0n;
                const maxMintUnits = depositForMintCalc > 0n
                  ? calculateMaxMintUnitsForVault(candidate, depositForMintCalc)
                  : 0n;
                const mintMatchesAvailable = mintMaxVaults.has(candidate.vaultConfig.assetAddress) || (
                  candidate.allocation 
                    ? candidate.allocation.mintAmount === maxMintUnits && maxMintUnits > 0n
                    : false
                );


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
                            vaultHasLowHF || vaultExceedsBalance 
                              ? 'border-red-500 focus-visible:ring-red-500' 
                              : depositMatchesAvailable 
                              ? 'border-blue-500 focus-visible:ring-blue-500' 
                              : ''
                          }`}
                          disabled={autoAllocate}
                        />
                      </div>
                      {focusedInput === `deposit-${candidate.vaultConfig.assetAddress}` && (() => {
                        const availableAmount = formatUnits(candidate.potentialCollateral, decimals);
                        const availableAmountNum = parseFloat(availableAmount);
                        
                        if (displayMode === 'Value') {
                          const price: WEI = getPrice(candidate.vaultConfig.assetAddress);
                          // value = (amount * price) / unitScale
                          const valueUnits: WEI = (candidate.potentialCollateral * price) / candidate.vaultConfig.unitScale;
                          const availableUSD = parseFloat(formatUnits(valueUnits, 18));
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={(e) => handleDepositAvailableClick(e, candidate)}
                            >
                              Available: ${truncateForDisplay(availableUSD)}
                            </div>
                          );
                        } else {
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={(e) => handleDepositAvailableClick(e, candidate)}
                            >
                              Available: {truncateForDisplay(availableAmountNum)} {candidate.vaultConfig.symbol}
                            </div>
                          );
                        }
                      })()}
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
                              vaultHasLowHF || vaultExceedsBalance 
                                ? 'border-red-500 focus-visible:ring-red-500' 
                                : mintMatchesAvailable 
                                ? 'border-blue-500 focus-visible:ring-blue-500' 
                                : ''
                            }`}
                            disabled={autoAllocate}
                          />
                        </div>
                        {focusedInput === `mint-${candidate.vaultConfig.assetAddress}` && (() => {
                          const maxDepositAmount = parseFloat(formatUnits(candidate.potentialCollateral, decimals));
                          const maxMint = calculateMaxMintForVault(candidate, maxDepositAmount);
                          
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={(e) => handleMintAvailableClick(e, candidate)}
                            >
                              Available: {truncateForDisplay(maxMint)} USDST
                            </div>
                          );
                        })()}
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
                          <span className="text-sm font-bold tabular-nums cursor-help">
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
