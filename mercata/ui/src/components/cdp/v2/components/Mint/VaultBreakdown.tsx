import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits } from 'ethers';
import { NumericFormat } from 'react-number-format';
import type { VaultCandidate, WEI } from '@/components/cdp/v2/cdpTypes';
import {
  formatPercentage,
  getAssetColor,
  convertStabilityFeeRateToAnnualPercentage,
  calculateAggregateHealthFactor,
  calculateVaultMinHF,
  calculateVaultHFRaw,
  calculateVaultHF,
  calculateMaxMintForVault,
  calculateMaxMintUnitsForVault,
  truncateForDisplay,
  getHFColorClass,
} from '@/components/cdp/v2/cdpUtils';
import { useTokenContext } from '@/context/TokenContext';
import { useUserTokens } from '@/context/UserTokensContext';
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
}) => {

  // ============================================================================
  // Context Hooks
  // ============================================================================

  const { earningAssets, inactiveTokens } = useTokenContext();
  const { activeTokens } = useUserTokens();



  // ============================================================================
  // State - UI Controls
  // ============================================================================

  const [isOpen, setIsOpen] = useState(!autoAllocate);
  const [displayMode, setDisplayMode] = useState<'Value' | 'Amount'>('Value');
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // ============================================================================
  // State - Input Values
  // ============================================================================

  const [depositDisplayInputs, setDepositDisplayInputs] = useState<Record<ADDRESS, string>>({});
  const [depositCanonical, setDepositCanonical] = useState<Record<ADDRESS, string>>({});
  const [mintInputs, setMintInputs] = useState<Record<ADDRESS, string>>({});

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



  // ============================================================================
  // Callbacks - Utility Functions
  // ============================================================================

  const toNumber = useCallback((input: string): DECIMAL => {
    const num = parseFloat(input || '0');
    return isNaN(num) ? 0 : num;
  }, []);

  const getPrice = useCallback((assetAddress: ADDRESS): USD => {
    const c = vaultCandidates.find(v => v.vaultConfig.assetAddress === assetAddress);
    return c ? parseFloat(formatUnits(c.oraclePrice, 18)) : 0;
  }, [vaultCandidates]);

  const getAvailableBalance = useCallback((candidate: VaultCandidate): UNITS => {
    const userToken = activeTokens.find(token => 
      token.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
    );
    return userToken?.balance ? BigInt(userToken.balance) : 0n;
  }, [activeTokens]);

  const wadToUSD = useCallback((wadAmount: string, assetAddress: ADDRESS, roundForDisplay: boolean = true): string => {
    if (!wadAmount || wadAmount === '0') return '';
    const tokenAmount: DECIMAL = toNumber(wadAmount);
    const price: USD = getPrice(assetAddress);
    const usdValue: USD = tokenAmount * price;
    if (usdValue <= 0) return '';
    return roundForDisplay ? usdValue.toFixed(2) : String(usdValue);
  }, [toNumber, getPrice]);

  const usdToWad = useCallback((usdValue: string, assetAddress: ADDRESS): string => {
    if (!usdValue || usdValue === '0') return '';
    const usd: USD = toNumber(usdValue);
    const price: USD = getPrice(assetAddress);
    const tokenAmount: DECIMAL = price > 0 ? usd / price : 0;
    return tokenAmount > 0 ? String(tokenAmount) : '';
  }, [toNumber, getPrice]);



  // ============================================================================
  // Memos - Derived State
  // ============================================================================

  const isSliderAtMin = targetHF !== undefined && minHF !== undefined && Math.abs(targetHF - minHF) < 0.01;
  const isFullMaxMode = autoAllocate && isMaxMode && isSliderAtMin;

  const projectedVaultHealth = useMemo(() => {
    if (vaultCandidates.length === 0) return null;

    const vaultData = vaultCandidates.map(candidate => {
      let depositAmt: DECIMAL = 0;
      let mintAmt: DECIMAL = 0;
      
      if (autoAllocate) {
        if (candidate.allocation) {
          const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
          depositAmt = parseFloat(formatUnits(candidate.allocation.depositAmount, decimals));
          mintAmt = parseFloat(formatUnits(candidate.allocation.mintAmount, 18));
        }
      } else {
        depositAmt = toNumber(depositCanonical[candidate.vaultConfig.assetAddress] || '');
        mintAmt = toNumber(mintInputs[candidate.vaultConfig.assetAddress] || '');
      }
      
      return {
        currentCollateral: candidate.currentCollateral,
        currentDebt: candidate.currentDebt,
        depositAmount: depositAmt,
        mintAmount: mintAmt,
        oraclePrice: candidate.oraclePrice,
        unitScale: candidate.vaultConfig.unitScale,
        liquidationRatio: candidate.vaultConfig.liquidationRatio,
        decimals: candidate.vaultConfig.unitScale.toString().length - 1,
      };
    }).filter(v => v.currentDebt > 0n || v.depositAmount > 0 || v.mintAmount > 0);

    return calculateAggregateHealthFactor(vaultData);
  }, [vaultCandidates, depositCanonical, mintInputs, toNumber, autoAllocate]);

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

  useEffect(() => {
    if (onAverageVaultHealthChange) {
      onAverageVaultHealthChange(autoAllocate ? projectedVaultHealth : null);
    }
  }, [projectedVaultHealth, autoAllocate, onAverageVaultHealthChange]);

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

      const newMintMaxVaults = new Set<string>();
      const newCanonical: Record<ADDRESS, string> = {};
      const newDisplay: Record<ADDRESS, string> = {};
      const newMints: Record<ADDRESS, string> = {};

      vaultCandidates.forEach(c => {
        const decimals = c.vaultConfig.unitScale.toString().length - 1;
        const depositBigInt = c.allocation?.depositAmount || 0n;
        const mintBigInt = c.allocation?.mintAmount || 0n;

        // Initialize deposit canonical and display
        if (depositBigInt > 0n) {
          const canonicalVal = formatUnits(depositBigInt, decimals);
          newCanonical[c.vaultConfig.assetAddress] = canonicalVal;
          newDisplay[c.vaultConfig.assetAddress] = displayMode === 'Value' 
            ? wadToUSD(canonicalVal, c.vaultConfig.assetAddress, false) 
            : canonicalVal;
        } else {
          newCanonical[c.vaultConfig.assetAddress] = '';
          newDisplay[c.vaultConfig.assetAddress] = '';
        }

        // Initialize mint inputs and check for max
        if (mintBigInt > 0n) {
          newMints[c.vaultConfig.assetAddress] = formatUnits(mintBigInt, 18);
          
          const depositUnits = depositBigInt || 0n;
          const maxMintUnits = calculateMaxMintUnitsForVault(c, depositUnits);
          if (mintBigInt === maxMintUnits && maxMintUnits > 0n) {
            newMintMaxVaults.add(c.vaultConfig.assetAddress);
          }
        } else {
          newMints[c.vaultConfig.assetAddress] = '';
        }
      });

      setDepositCanonical(newCanonical);
      setDepositDisplayInputs(newDisplay);
      setMintInputs(newMints);
      setMintMaxVaults(newMintMaxVaults);
    }
    
    prevAutoSupplyRef.current = autoAllocate;
  }, [autoAllocate, vaultCandidates, displayMode, wadToUSD]);

  // ============================================================================
  // Effects - Auto Mode Sync
  // ============================================================================

  useEffect(() => {
    if (!autoAllocate) return;

    // Sync deposit canonical values
    setDepositCanonical(prev => {
      const newCanonical: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        if (depositBigInt > 0n) {
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          newCanonical[c.vaultConfig.assetAddress] = formatUnits(depositBigInt, decimals);
        } else {
          newCanonical[c.vaultConfig.assetAddress] = '';
        }
      });
      const hasChanges = Object.keys(newCanonical).some(key => newCanonical[key] !== prev[key]) ||
        Object.keys(prev).some(key => !newCanonical[key] && prev[key]);
      return hasChanges ? newCanonical : prev;
    });

    // Sync deposit display values
    setDepositDisplayInputs(prev => {
      const newDisplay: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        if (depositBigInt > 0n) {
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const canonicalVal = formatUnits(depositBigInt, decimals);
          newDisplay[c.vaultConfig.assetAddress] = displayMode === 'Value' 
            ? wadToUSD(canonicalVal, c.vaultConfig.assetAddress, true) 
            : canonicalVal;
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      const hasChanges = Object.keys(newDisplay).some(key => newDisplay[key] !== prev[key]) ||
        Object.keys(prev).some(key => !newDisplay[key] && prev[key]);
      return hasChanges ? newDisplay : prev;
    });

    // Sync mint inputs
    setMintInputs(prev => {
      const newMints: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const mintBigInt = c.allocation?.mintAmount || 0n;
        if (mintBigInt > 0n) {
          const mintDecimal = formatUnits(mintBigInt, 18);
          newMints[c.vaultConfig.assetAddress] = displayMode === 'Value' 
            ? parseFloat(mintDecimal).toFixed(2) 
            : mintDecimal;
        } else {
          newMints[c.vaultConfig.assetAddress] = '';
        }
      });
      const hasChanges = Object.keys(newMints).some(key => newMints[key] !== prev[key]) ||
        Object.keys(prev).some(key => !newMints[key] && prev[key]);
      return hasChanges ? newMints : prev;
    });

    // Check for mint max matches
    const newMintMaxVaults = new Set<ADDRESS>();
    vaultCandidates.forEach(c => {
      const depositBigInt = c.allocation?.depositAmount || 0n;
      const mintBigInt = c.allocation?.mintAmount || 0n;
      if (mintBigInt > 0n) {
        const maxMintUnits = calculateMaxMintUnitsForVault(c, depositBigInt);
        if (mintBigInt === maxMintUnits && maxMintUnits > 0n) {
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
    if (autoAllocate) {
      // Auto mode: convert from allocation amounts
      const newDisplay: Record<ADDRESS, string> = {};
      const newMints: Record<ADDRESS, string> = {};
      
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        const mintBigInt = c.allocation?.mintAmount || 0n;
        const decimals = c.vaultConfig.unitScale.toString().length - 1;
        
        if (depositBigInt > 0n) {
          const canonicalVal = formatUnits(depositBigInt, decimals);
          newDisplay[c.vaultConfig.assetAddress] = displayMode === 'Value' 
            ? wadToUSD(canonicalVal, c.vaultConfig.assetAddress, true) 
            : canonicalVal;
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
        
        if (mintBigInt > 0n) {
          const mintDecimal = formatUnits(mintBigInt, 18);
          newMints[c.vaultConfig.assetAddress] = displayMode === 'Value' 
            ? parseFloat(mintDecimal).toFixed(2) 
            : mintDecimal;
        } else {
          newMints[c.vaultConfig.assetAddress] = '';
        }
      });
      
      setDepositDisplayInputs(newDisplay);
      setMintInputs(newMints);
    } else {
      // Manual mode: convert using canonical values
      const newDepositDisplay: Record<ADDRESS, string> = {};
      
      vaultCandidates.forEach(c => {
        const canonical = depositCanonical[c.vaultConfig.assetAddress] || '';
        if (!canonical) {
          newDepositDisplay[c.vaultConfig.assetAddress] = '';
          return;
        }
        
        const depositBigInt = c.allocation?.depositAmount || 0n;
        const isDepositMax = depositBigInt > 0n && depositBigInt === c.potentialCollateral;
        const decimals = c.vaultConfig.unitScale.toString().length - 1;
        
        if (isDepositMax) {
          const potentialDecimal = formatUnits(c.potentialCollateral, decimals);
          const potentialNum = parseFloat(potentialDecimal);
          newDepositDisplay[c.vaultConfig.assetAddress] = displayMode === 'Value'
            ? (potentialNum * getPrice(c.vaultConfig.assetAddress)).toFixed(2)
            : potentialDecimal;
        } else {
          newDepositDisplay[c.vaultConfig.assetAddress] = displayMode === 'Value'
            ? (parseFloat(canonical) * getPrice(c.vaultConfig.assetAddress)).toFixed(2)
            : canonical;
        }
      });
      
      setDepositDisplayInputs(newDepositDisplay);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode]);

  // ============================================================================
  // Effects - Validation
  // ============================================================================

  useEffect(() => {
    if (!onHFValidationChange || autoAllocate) return;

    let hasLowHF = false;
    for (const candidate of vaultCandidates) {
      const mintAmt = toNumber(mintInputs[candidate.vaultConfig.assetAddress] || '');
      if (mintAmt === 0) continue;
      
      const depositAmt = toNumber(depositCanonical[candidate.vaultConfig.assetAddress] || '');
      const hfRaw = calculateVaultHFRaw(candidate, depositAmt, mintAmt);
      const vaultMinHF = calculateVaultMinHF(candidate);
      
      if (hfRaw !== null && hfRaw < vaultMinHF) {
        hasLowHF = true;
        break;
      }
    }
    
    onHFValidationChange(hasLowHF);
  }, [depositCanonical, mintInputs, vaultCandidates, autoAllocate, onHFValidationChange, toNumber]);

  useEffect(() => {
    if (!onBalanceExceededChange || autoAllocate) return;

    let exceedsBalance = false;
    for (const candidate of vaultCandidates) {
      const depositAmt = toNumber(depositCanonical[candidate.vaultConfig.assetAddress] || '');
      if (depositAmt === 0) continue;
      
      const availableBalanceUnits = getAvailableBalance(candidate);
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const availableBalance = parseFloat(formatUnits(availableBalanceUnits, decimals));
      
      if (depositAmt - availableBalance > 0.000001) {
        exceedsBalance = true;
        break;
      }
    }
    
    onBalanceExceededChange(exceedsBalance);
  }, [depositCanonical, vaultCandidates, autoAllocate, onBalanceExceededChange, toNumber, getAvailableBalance]);

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
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    if (floatValue === undefined || formattedValue === '') {
      setDepositDisplayInputs(prev => ({ ...prev, [assetAddress]: '' }));
      setDepositCanonical(prev => ({ ...prev, [assetAddress]: '' }));
      if (!autoAllocate && onDepositAmountChange) {
        onDepositAmountChange(assetAddress, '0');
      }
      return;
    }

    setDepositDisplayInputs(prev => ({ ...prev, [assetAddress]: formattedValue }));
    
    const valueStr = String(floatValue);
    let canonicalValue = displayMode === 'Value' ? usdToWad(valueStr, assetAddress) : valueStr;
    let useExactPotentialCollateral = false;
    
    if (candidate.potentialCollateral > 0n) {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      let inputUnits: UNITS;

      if (displayMode === 'Value') {
        const roundedUSD = parseFloat(floatValue.toFixed(2));
        const price = getPrice(assetAddress);
        const tokenAmount = price > 0 ? roundedUSD / price : 0;
        inputUnits = tokenAmount > 0 ? parseUnitsWithTruncation(tokenAmount.toString(), decimals) : 0n;
      } else {
        inputUnits = parseUnitsWithTruncation(String(floatValue), decimals);
      }

      if (inputUnits === candidate.potentialCollateral) {
        canonicalValue = formatUnits(candidate.potentialCollateral, decimals);
        useExactPotentialCollateral = true;
      }
    }
    
    setDepositCanonical(prev => ({ ...prev, [assetAddress]: canonicalValue }));
    
    if (!autoAllocate && onDepositAmountChange) {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const depositAmountStr = useExactPotentialCollateral
        ? candidate.potentialCollateral.toString()
        : parseUnitsWithTruncation(canonicalValue, decimals).toString();
      onDepositAmountChange(assetAddress, depositAmountStr);
    }
  }, [vaultCandidates, autoAllocate, displayMode, getPrice, usdToWad, onDepositAmountChange]);

  const handleMintChange = useCallback((
    assetAddress: ADDRESS, 
    floatValue: DECIMAL | undefined, 
    formattedValue: string
  ) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    if (floatValue === undefined || formattedValue === '') {
      setMintInputs(prev => ({ ...prev, [assetAddress]: '' }));
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

    setMintInputs(prev => ({ ...prev, [assetAddress]: formattedValue }));

    const depositAmt = parseFloat(depositCanonical[assetAddress] || '0');
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    const depositUnits = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
    const maxMintUnits = calculateMaxMintUnitsForVault(candidate, depositUnits);
    const inputUnits = parseUnitsWithTruncation(String(floatValue), 18);
    
    if (inputUnits === maxMintUnits && maxMintUnits > 0n) {
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
    
    if (!autoAllocate && onMintAmountChange) {
      onMintAmountChange(assetAddress, inputUnits.toString());
    }
  }, [vaultCandidates, depositCanonical, autoAllocate, onMintAmountChange]);

  const handleDepositAvailableClick = useCallback((
    e: React.MouseEvent, 
    candidate: VaultCandidate
  ) => {
    e.preventDefault();
    e.stopPropagation();
    
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    const canonicalVal = formatUnits(candidate.potentialCollateral, decimals);
    const availableAmountNum = parseFloat(canonicalVal);
    
    if (displayMode === 'Value') {
      const availableUSD = availableAmountNum * getPrice(candidate.vaultConfig.assetAddress);
      setDepositDisplayInputs(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: availableUSD.toFixed(2) }));
    } else {
      setDepositDisplayInputs(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: canonicalVal }));
    }
    setDepositCanonical(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: canonicalVal }));
    
    if (!autoAllocate && onDepositAmountChange) {
      onDepositAmountChange(candidate.vaultConfig.assetAddress, candidate.potentialCollateral.toString());
    }
    
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
    
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    const maxDepositAmount = parseFloat(formatUnits(candidate.potentialCollateral, decimals));
    const maxMint = calculateMaxMintForVault(candidate, maxDepositAmount);
    
    setMintMaxVaults(prev => {
      const newSet = new Set(prev);
      newSet.add(candidate.vaultConfig.assetAddress);
      return newSet;
    });
    
    // Populate both deposit and mint
    if (displayMode === 'Value') {
      const maxDepositUSD = maxDepositAmount * getPrice(candidate.vaultConfig.assetAddress);
      handleDepositChange(candidate.vaultConfig.assetAddress, maxDepositUSD, String(maxDepositUSD));
    } else {
      const maxDepositStr = formatUnits(candidate.potentialCollateral, decimals);
      handleDepositChange(candidate.vaultConfig.assetAddress, maxDepositAmount, maxDepositStr);
    }
    
    handleMintChange(candidate.vaultConfig.assetAddress, maxMint, String(maxMint));
    
    setTimeout(() => {
      depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
      mintInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
      setFocusedInput(null);
    }, 0);
  }, [displayMode, getPrice, handleDepositChange, handleMintChange]);



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
              
              {vaultCandidates.map((candidate) => {
                const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(candidate.vaultConfig.stabilityFeeRate);
                const token = [...earningAssets, ...inactiveTokens].find(
                  t => t.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
                );
                const tokenImage = token?.images?.[0]?.value;

                const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
                const depositAmt = toNumber(canonicalDeposit);
                const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                const mintAmt = toNumber(mintInput);
                
                const hf = calculateVaultHF(candidate, depositAmt, mintAmt);
                const hfNum = parseFloat(hf);
                const hfColor = getHFColorClass(hf, hfNum);
                
                const vaultMinHF = calculateVaultMinHF(candidate);
                const vaultHasLowHF = !autoAllocate && 
                  mintInput && mintAmt > 0 &&
                  hfNum !== Infinity && !isNaN(hfNum) && hfNum < vaultMinHF;

                const availableBalanceUnits = getAvailableBalance(candidate);
                const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                const availableBalance = parseFloat(formatUnits(availableBalanceUnits, decimals));
                const vaultExceedsBalance = !autoAllocate && depositAmt > 0 && (depositAmt - availableBalance > 0.000001);

                const depositDisplayValue = depositDisplayInputs[candidate.vaultConfig.assetAddress] || '';
                const depositDisplayNum = toNumber(depositDisplayValue);
                let depositMatchesAvailable = false;
                if (depositDisplayNum > 0) {
                  if (displayMode === 'Value') {
                    const availableUSD = availableBalance * getPrice(candidate.vaultConfig.assetAddress);
                    depositMatchesAvailable = Math.abs(depositDisplayNum - availableUSD) < 0.01;
                  } else {
                    depositMatchesAvailable = Math.abs(depositDisplayNum - availableBalance) < 0.000001;
                  }
                }

                const mintDisplayNum = toNumber(mintInput);
                let mintMatchesAvailable = false;
                if (mintDisplayNum > 0) {
                  const maxMint = calculateMaxMintForVault(candidate, availableBalance);
                  mintMatchesAvailable = Math.abs(mintDisplayNum - maxMint) < 0.01;
                }

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
                          value={depositDisplayInputs[candidate.vaultConfig.assetAddress] || ''}
                          onValueChange={(values) => handleDepositChange(candidate.vaultConfig.assetAddress, values.floatValue, values.formattedValue)}
                          onFocus={() => { 
                            setFocusedInput(`deposit-${candidate.vaultConfig.assetAddress}`);
                          }}
                          onBlur={() => { 
                            setFocusedInput(null);
                          }}
                          getInputRef={(el) => { depositInputRefs.current[candidate.vaultConfig.assetAddress] = el; }}
                          allowNegative={false}
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
                          const availableUSD = availableAmountNum * getPrice(candidate.vaultConfig.assetAddress);
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
                            value={mintInputs[candidate.vaultConfig.assetAddress] || ''}
                            onValueChange={(values) => handleMintChange(candidate.vaultConfig.assetAddress, values.floatValue, values.formattedValue)}
                            onFocus={() => { 
                              setFocusedInput(`mint-${candidate.vaultConfig.assetAddress}`);
                            }}
                            onBlur={() => { 
                              setFocusedInput(null);
                            }}
                            getInputRef={(el) => { mintInputRefs.current[candidate.vaultConfig.assetAddress] = el; }}
                            allowNegative={false}
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
            {!autoAllocate && (
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Total Mint Amount:</span>
                  <span className="text-sm font-bold tabular-nums">
                    {vaultCandidates.reduce((sum, candidate) => {
                      return sum + toNumber(mintInputs[candidate.vaultConfig.assetAddress] || '');
                    }, 0)} USDST
                  </span>
                </div>
                {projectedVaultHealth && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Projected Vault Health:</span>
                    <span className="text-sm font-bold tabular-nums">{projectedVaultHealth}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};

export default VaultBreakdown;
