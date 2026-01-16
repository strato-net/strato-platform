import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits, parseUnits } from 'ethers';
import { NumericFormat } from 'react-number-format';
import type { VaultCandidate } from '@/components/cdp/v2/cdpTypes';
import { formatPercentage, getAssetColor, convertStabilityFeeRateToAnnualPercentage, calculateAggregateHealthFactor } from '@/components/cdp/v2/cdpUtils';
import { useTokenContext } from '@/context/TokenContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { formatNumberWithCommas, parseCommaNumber, formatWeiToDecimalHP, parseUnitsWithTruncation } from '@/utils/numberUtils';

interface VaultBreakdownProps {
  vaultCandidates: VaultCandidate[];  // VaultCandidates with optional allocation field
  showMintAmounts?: boolean;
  onDepositAmountChange?: (assetAddress: string, amount: string) => void;
  onMintAmountChange?: (assetAddress: string, amount: string) => void;
  autoSupplyCollateral?: boolean;
  isMaxMode?: boolean; // Whether max mode is enabled (forces sync even in manual mode)
  targetHF?: number; // Target HF from slider (riskBuffer)
  onHFValidationChange?: (hasLowHF: boolean) => void; // Callback when HF validation changes
  onBalanceExceededChange?: (exceedsBalance: boolean) => void; // Callback when deposit exceeds balance
  onTotalManualMintChange?: (totalMint: string) => void; // Callback with total mint from all vaults in manual mode
  onAverageVaultHealthChange?: (averageHF: string | null) => void; // Callback with average vault health
  onMintMaxVaultsChange?: (vaults: Set<string>) => void; // Callback when vaults using mintMax changes
  exceedsBalance?: boolean; // Whether any deposit exceeds available balance
  hasLowHF?: boolean; // Whether any vault has HF below minimum
}

const VaultBreakdown: React.FC<VaultBreakdownProps> = ({
  vaultCandidates,
  showMintAmounts = false,
  onDepositAmountChange,
  onMintAmountChange,
  autoSupplyCollateral = true,
  isMaxMode = false,
  exceedsBalance = false,
  hasLowHF = false,
  targetHF,
  onHFValidationChange,
  onBalanceExceededChange,
  onTotalManualMintChange,
  onAverageVaultHealthChange,
  onMintMaxVaultsChange,
}) => {
  const [isOpen, setIsOpen] = useState(!autoSupplyCollateral);
  const [displayMode, setDisplayMode] = useState<'USD' | 'WAD'>('USD');
  const { earningAssets, inactiveTokens } = useTokenContext();
  const { activeTokens } = useUserTokens();
  
  // Track which vaults are using mintMax (populated from "Available: x" click)
  const [mintMaxVaults, setMintMaxVaults] = useState<Set<string>>(new Set());
  
  // Track which deposits match potentialCollateral exactly (for precision preservation)
  const [depositMaxVaults, setDepositMaxVaults] = useState<Set<string>>(new Set());
  
  // Log depositMaxVaults whenever it updates
  useEffect(() => {
    console.log('[VaultBreakdown] depositMaxVaults updated:', Array.from(depositMaxVaults));
  }, [depositMaxVaults]);
  
  // Notify parent when mintMaxVaults changes
  useEffect(() => {
    if (onMintMaxVaultsChange) {
      onMintMaxVaultsChange(mintMaxVaults);
    }
  }, [mintMaxVaults, onMintMaxVaultsChange]);

  // Expand vault breakdown when auto-allocate is unchecked, close when checked
  useEffect(() => {
    setIsOpen(!autoSupplyCollateral);
  }, [autoSupplyCollateral]);

  // Store display values (what the user sees/types - may be USD or WAD depending on mode)
  const [depositDisplayInputs, setDepositDisplayInputs] = useState<Record<string, string>>({});
  const [mintInputs, setMintInputs] = useState<Record<string, string>>({});
  // Store canonical WAD values for deposits (token amounts, not USD)
  const [depositCanonical, setDepositCanonical] = useState<Record<string, string>>({});
  
  // Track which input is currently being edited (to show "Available" message)
  const editingInputRef = useRef<string | null>(null);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  // Refs for input elements to blur them after populating from "Available" click
  const depositInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const mintInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  
  // Track when we're programmatically populating from "Available: x" click
  // This prevents NumericFormat's onValueChange from removing the vault from mintMaxVaults
  const populatingFromAvailableRef = useRef<string | null>(null);

  // Get oracle price for an asset
  const getPrice = useCallback((assetAddress: string): number => {
    const c = vaultCandidates.find(v => v.vaultConfig.assetAddress === assetAddress);
    return c ? parseFloat(formatUnits(c.oraclePrice, 18)) : 0;
  }, [vaultCandidates]);

  // Get available balance for deposit - returns raw wei string
  const getAvailableBalance = useCallback((candidate: VaultCandidate): string => {
    // Find the user's balance for this token (same as VaultsList.tsx line 236-242)
    const userToken = activeTokens.find(token => 
      token.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
    );
    
    if (userToken?.balance) {
      // Return raw wei balance as string
      return userToken.balance;
    }
    
    // Fallback to '0' if no balance found
    return '0';
  }, [activeTokens]);

  // Parse input to number (handles commas)
  const toNumber = useCallback((input: string): number => {
    const cleaned = parseCommaNumber(input || '0');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }, []);

  // Truncate number for display (6 significant figures) - only for "Available: x" text
  const truncateForDisplay = useCallback((value: number): string => {
    const str = String(value);
    const num = parseFloat(str);
    if (isNaN(num) || num === 0) return '0';
    
    // For very small numbers, use exponential notation
    if (Math.abs(num) < 0.000001) {
      return num.toExponential(2);
    }
    
    // For normal numbers, show up to 6 significant figures
    const precision = Math.max(0, 6 - Math.floor(Math.log10(Math.abs(num))) - 1);
    return num.toFixed(Math.min(precision, 6));
  }, []);

  // Convert WAD token amount to USD
  // roundForDisplay: true in auto mode (2 decimal places), false in manual mode (no rounding)
  const wadToUSD = useCallback((wadAmount: string, assetAddress: string, roundForDisplay: boolean = true): string => {
    if (!wadAmount || wadAmount === '0') return '';
    const tokenAmount = toNumber(wadAmount);
    const price = getPrice(assetAddress);
    const usdValue = tokenAmount * price;
    if (usdValue <= 0) return '';
    const formatted = roundForDisplay ? usdValue.toFixed(2) : String(usdValue);
    return formatNumberWithCommas(formatted);
  }, [toNumber, getPrice]);

  // Convert USD to WAD token amount (never rounds - preserves full precision)
  const usdToWad = useCallback((usdValue: string, assetAddress: string): string => {
    if (!usdValue || usdValue === '0') return '';
    const usd = toNumber(usdValue);
    const price = getPrice(assetAddress);
    const tokenAmount = price > 0 ? usd / price : 0;
    return tokenAmount > 0 ? String(tokenAmount) : '';
  }, [toNumber, getPrice]);

  // Track previous autoSupplyCollateral value to detect transitions
  const prevAutoSupplyRef = useRef<boolean>(autoSupplyCollateral);
  
  // When transitioning from auto to manual mode, initialize inputs from vaults
  useEffect(() => {
    // Detect transition from auto (true) to manual (false)
    if (prevAutoSupplyRef.current === true && autoSupplyCollateral === false) {
      // Initialize canonical deposit values from vaultCandidates
      const newCanonical: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        if (depositBigInt > 0n) {
          // Convert from wei to decimal for canonical storage
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const canonicalVal = formatUnits(depositBigInt, decimals);
          newCanonical[c.vaultConfig.assetAddress] = canonicalVal;
        } else {
          newCanonical[c.vaultConfig.assetAddress] = '';
        }
      });
      setDepositCanonical(newCanonical);

      // Initialize display deposit values
      const newDisplay: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const canonicalVal = newCanonical[c.vaultConfig.assetAddress];
        
        if (displayMode === 'USD' && canonicalVal) {
          newDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonicalVal, c.vaultConfig.assetAddress, false);
        } else if (canonicalVal) {
          newDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(canonicalVal);
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      setDepositDisplayInputs(newDisplay);

      // Initialize mint inputs (no rounding in custom mode)
      const newMints: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const mintBigInt = c.allocation?.mintAmount || 0n;
        
        if (mintBigInt <= 0n) {
          newMints[c.vaultConfig.assetAddress] = '';
        } else {
          // Convert from wei (18 decimals) to decimal string
          const mintDecimal = formatUnits(mintBigInt, 18);
          newMints[c.vaultConfig.assetAddress] = formatNumberWithCommas(mintDecimal);
        }
      });
      setMintInputs(newMints);
    }
    
    // Update ref for next render
    prevAutoSupplyRef.current = autoSupplyCollateral;
  }, [autoSupplyCollateral, vaultCandidates, displayMode, wadToUSD]);

  // Calculate minimum HF for a specific vault based on its minCR and liquidationRatio
  // Data flow: Blockchain (CDPEngine.collateralConfigs) → Backend (Cirrus) → Frontend (VaultCandidate)
  // Each vault has its own minCR constraint from the blockchain - no defaults or hardcoded values
  const calculateVaultMinHF = useCallback((candidate: VaultCandidate): number => {
    // minHF = minCR / liquidationRatio (both in WAD format from blockchain)
    // e.g., if minCR = 1.5e18 (150%) and liquidationRatio = 1.33e18 (133%)
    // then minHF = 150 / 133 = 1.13
    const minCRPercent = parseFloat(formatUnits(candidate.vaultConfig.minCR, 18)) * 100;
    const ltPercent = parseFloat(formatUnits(candidate.vaultConfig.liquidationRatio, 18)) * 100;
    
    if (ltPercent <= 0) return 1.0;
    
    const minHF = minCRPercent / ltPercent;
    return Math.round(minHF * 100) / 100; // Round to 2 decimal places
  }, []);

  // Calculate raw HF value for a vault - returns number for precise calculations
  // Returns null for infinite/invalid values
  const calculateHFRaw = useCallback((candidate: VaultCandidate, depositAmt: number, mintAmt: number): number | null => {
    try {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      // Use parseUnitsWithTruncation to handle amounts with too many decimal places
      const depositWei = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
      const mintWei = mintAmt > 0 ? parseUnitsWithTruncation(mintAmt.toString(), 18) : 0n;

      const totalCollateral = candidate.currentCollateral + depositWei;
      const totalDebt = candidate.currentDebt + mintWei;

      if (totalDebt <= 0n) return null; // Infinite HF

      // Calculate collateral value in USD (18 decimals)
      const collateralValueUSD = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
      
      // Convert to numbers for percentage calculation
      const collateralUSD = parseFloat(formatUnits(collateralValueUSD, 18));
      const debtUSD = parseFloat(formatUnits(totalDebt, 18));

      // CR = (collateralUSD / debtUSD) * 100 (as percentage, e.g., 200 for 200%)
      const cr = (collateralUSD / debtUSD) * 100;
      
      // LT = liquidationRatio converted from WAD to percentage (e.g., 1.5e18 -> 150)
      const lt = parseFloat(formatUnits(candidate.vaultConfig.liquidationRatio, 18)) * 100;

      // HF = CR / LT (same as VaultsList)
      const hf = cr / lt;

      if (!isFinite(hf) || isNaN(hf) || hf >= 999) return null;
      return hf;
    } catch {
      return null;
    }
  }, []);

  // Format HF for display - rounds to 2 decimal places
  const calculateHF = useCallback((candidate: VaultCandidate, depositAmt: number, mintAmt: number): string => {
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const mintWei = mintAmt > 0 ? parseUnitsWithTruncation(mintAmt.toString(), 18) : 0n;
    const totalDebt = candidate.currentDebt + mintWei;

    if (totalDebt <= 0n) return '∞';

    const hfRaw = calculateHFRaw(candidate, depositAmt, mintAmt);
    if (hfRaw === null) return '∞';
    return hfRaw.toFixed(2);
  }, [calculateHFRaw]);

  // Calculate maximum available mint amount for a vault based on current collateral + deposit
  // Applies a safety buffer to account for the strict `<` inequality in CDPEngine.sol mint()
  // CDPEngine requires: currentDebt + amountUSD < maxBorrowableUSD (not <=)
  const calculateMaxMint = useCallback((candidate: VaultCandidate, depositAmt: number): number => {
    // Match backend's exact calculation from cdp.service.ts getMaxMint (lines 846-950)
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const depositWei = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
    const totalCollateral = candidate.currentCollateral + depositWei;
    
    // Calculate collateral value in USD (WAD precision)
    const collateralValueUSD = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
    
    // Backend uses minCR directly, not liquidationRatio
    // maxBorrowableUSD = (collateralValueUSD * WAD) / minCR
    const WAD = 10n ** 18n; // Use BigInt literal instead of parseUnitsWithTruncation for constant
    const maxBorrowableUSD = (collateralValueUSD * WAD) / candidate.vaultConfig.minCR;
    
    const currentDebt = candidate.currentDebt;
    
    let maxAmount: bigint;
    if (maxBorrowableUSD <= currentDebt) {
      maxAmount = 0n;
    } else {
      const available = maxBorrowableUSD - currentDebt;
      // Apply 1 wei buffer (matches backend line 924)
      maxAmount = available > 1n ? (available - 1n) : 0n;
    }
    
    // Convert to decimal USDST
    // No safety buffer needed - we track mintMax vaults and use mintMax() contract function
    // which calculates the max on-chain at execution time
    const maxMintUSD = parseFloat(formatUnits(maxAmount, 18));
    return maxMintUSD;
  }, []);

  // Sync from vaults when they change
  // This always uses the canonical WAD values from vaults
  // In manual mode, skip syncing UNLESS max mode is enabled
  useEffect(() => {
    // In manual mode, user controls the inputs - don't sync from vaults
    // EXCEPTION: When max mode is enabled, we must sync the max values
    // This prevents flickering caused by the feedback loop:
    // user input → parent callback → vaults update → sync back → flickering
    if (!autoSupplyCollateral && !isMaxMode) {
      return;
    }
    
    // Update canonical deposit values from vaultCandidates
    setDepositCanonical(prev => {
      const newCanonical: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        
        if (depositBigInt > 0n) {
          // Convert from wei to decimal for canonical storage
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          newCanonical[c.vaultConfig.assetAddress] = formatUnits(depositBigInt, decimals);
        } else {
          newCanonical[c.vaultConfig.assetAddress] = '';
        }
      });
      return newCanonical;
    });

    // Update display deposit values from vaultCandidates (with rounding in auto mode)
    setDepositDisplayInputs(prev => {
      const newDisplay: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        
        if (depositBigInt > 0n) {
          // Convert from wei to decimal
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const canonicalVal = formatUnits(depositBigInt, decimals);
          
          if (displayMode === 'USD') {
            // In auto mode, round to 2 decimal places
            newDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonicalVal, c.vaultConfig.assetAddress, true);
          } else {
            // WAD mode: format with commas
            newDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(canonicalVal);
          }
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      return newDisplay;
    });

    // Update mint inputs from vaultCandidates (with rounding in auto mode)
    setMintInputs(prev => {
      const newMints: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const mintBigInt = c.allocation?.mintAmount || 0n;
        
        if (mintBigInt <= 0n) {
          newMints[c.vaultConfig.assetAddress] = '';
          return;
        }
        
        // Convert from wei (18 decimals) to decimal string
        const mintDecimal = formatUnits(mintBigInt, 18);
        const mintNum = parseFloat(mintDecimal);
        
        // In auto mode, format to 2 decimal places in USD mode
        // Always format with commas for display
        if (displayMode === 'USD') {
          newMints[c.vaultConfig.assetAddress] = formatNumberWithCommas(mintNum.toFixed(2));
        } else {
          newMints[c.vaultConfig.assetAddress] = formatNumberWithCommas(mintDecimal);
        }
      });
      return newMints;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultCandidates, autoSupplyCollateral, isMaxMode]);

  // When display mode changes, handle conversion based on auto/manual mode
  useEffect(() => {
    if (autoSupplyCollateral) {
      // AUTO MODE: Convert from optimal allocation amounts (wei) to display
      // This ensures we always use the original allocation values, not derived ones
      const newDisplay: Record<string, string> = {};
      
      vaultCandidates.forEach(c => {
        const depositBigInt = c.allocation?.depositAmount || 0n;
        
        if (depositBigInt > 0n) {
          // Convert from wei to decimal
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const canonicalVal = formatUnits(depositBigInt, decimals);
          
          if (displayMode === 'USD') {
            newDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonicalVal, c.vaultConfig.assetAddress, true); // Round for display (includes commas)
          } else {
            newDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(canonicalVal); // WAD with commas
          }
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      
      setDepositDisplayInputs(newDisplay);

      // Convert mint amounts from optimal allocation
      const newMints: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const mintBigInt = c.allocation?.mintAmount || 0n;
        
        if (mintBigInt <= 0n) {
          newMints[c.vaultConfig.assetAddress] = '';
          return;
        }
        
        // Convert from wei (18 decimals) to decimal string
        const mintDecimal = formatUnits(mintBigInt, 18);
        const mintNum = parseFloat(mintDecimal);
        
        // Round to 2 decimal places in USD mode, always format with commas
        if (displayMode === 'USD') {
          newMints[c.vaultConfig.assetAddress] = formatNumberWithCommas(mintNum.toFixed(2));
        } else {
          newMints[c.vaultConfig.assetAddress] = formatNumberWithCommas(mintDecimal);
        }
      });
      setMintInputs(newMints);
    } else {
      // MANUAL MODE: Convert using canonical values to preserve precision (no rounding)
      const newDepositDisplay: Record<string, string> = {};
      
      vaultCandidates.forEach(c => {
        const canonical = depositCanonical[c.vaultConfig.assetAddress] || '';
        if (!canonical) {
          newDepositDisplay[c.vaultConfig.assetAddress] = '';
          return;
        }
        
        // Check if this vault is in depositMax state
        const isDepositMax = depositMaxVaults.has(c.vaultConfig.assetAddress);
        
        if (isDepositMax) {
          // For depositMax vaults, repopulate as if "Available: x" was clicked in the new mode
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const potentialDecimal = formatUnits(c.potentialCollateral, decimals);
          const potentialNum = parseFloat(potentialDecimal);
          
          if (displayMode === 'USD') {
            // Switching to USD mode: convert potentialCollateral to USD and round to 2 decimals
            const availableUSD = potentialNum * getPrice(c.vaultConfig.assetAddress);
            const roundedUSD = availableUSD.toFixed(2);
            newDepositDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(roundedUSD);
          } else {
            // Switching to WAD mode: use raw decimal from potentialCollateral
            newDepositDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(potentialDecimal);
          }
        } else {
          // For normal vaults, convert using canonical value
          if (displayMode === 'USD') {
            // Converting WAD to USD - round to 2 decimals for display consistency
            const usdValue = parseFloat(canonical) * getPrice(c.vaultConfig.assetAddress);
            newDepositDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(usdValue.toFixed(2));
          } else {
            // Converting to WAD display - use canonical value directly (full precision with commas)
            newDepositDisplay[c.vaultConfig.assetAddress] = formatNumberWithCommas(canonical);
          }
        }
      });
      
      setDepositDisplayInputs(newDepositDisplay);

      // For mint amounts (USDST = $1), no conversion needed
      // In manual mode, no rounding - keep current values (they should already be formatted)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode]);

  // Check for low HF and notify parent - now checks each vault against its own minimum HF
  useEffect(() => {
    if (!onHFValidationChange || autoSupplyCollateral) {
      return;
    }

    let hasLowHF = false;
    for (const candidate of vaultCandidates) {
      const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
      const mintAmt = toNumber(mintInput);
      
      // Skip validation for vaults with empty or zero mint amount
      if (!mintInput || mintInput.trim() === '' || mintAmt === 0) {
        continue;
      }
      
      // Use canonical token amounts for HF calculation
      const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
      const depositAmt = toNumber(canonicalDeposit);
      
      // Use raw HF value for precise comparison
      const hfRaw = calculateHFRaw(candidate, depositAmt, mintAmt);
      
      // Calculate this vault's minimum HF based on its specific minCR and liquidationRatio
      const vaultMinHF = calculateVaultMinHF(candidate);
      
      // Check if HF is below this vault's minimum (not the global slider value)
      if (hfRaw !== null && hfRaw < vaultMinHF) {
        hasLowHF = true;
        break;
      }
    }
    
    onHFValidationChange(hasLowHF);
  }, [depositCanonical, mintInputs, vaultCandidates, autoSupplyCollateral, onHFValidationChange, toNumber, calculateVaultMinHF, calculateHFRaw]);

  // Check for deposits exceeding available balance and notify parent
  useEffect(() => {
    if (!onBalanceExceededChange || autoSupplyCollateral) {
      return;
    }

    let exceedsBalance = false;
    for (const candidate of vaultCandidates) {
      // Use canonical token amounts for balance check
      const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
      const depositAmt = toNumber(canonicalDeposit);
      
      // Skip validation for vaults with empty or zero deposit
      if (!canonicalDeposit || canonicalDeposit.trim() === '' || depositAmt === 0) {
        continue;
      }
      
      // Get available balance (uses same calculation as VaultsList.tsx)
      const availableBalanceWei = getAvailableBalance(candidate);
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const availableBalance = parseFloat(formatWeiToDecimalHP(availableBalanceWei, decimals));
      
      // Use tolerance for floating-point precision (same as blue highlighting logic)
      const TOLERANCE = 0.000001;
      if (depositAmt - availableBalance > TOLERANCE) {
        exceedsBalance = true;
        break;
      }
    }
    
    onBalanceExceededChange(exceedsBalance);
  }, [depositCanonical, vaultCandidates, autoSupplyCollateral, onBalanceExceededChange, toNumber, getAvailableBalance]);

  // Calculate total mint amount from all vaults in manual mode and notify parent
  useEffect(() => {
    if (!onTotalManualMintChange || autoSupplyCollateral) {
      return;
    }

    let totalMint = 0;
    for (const candidate of vaultCandidates) {
      const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
      const mintAmt = toNumber(mintInput);
      totalMint += mintAmt;
    }
    
    // Return as string with exact precision
    onTotalManualMintChange(totalMint > 0 ? String(totalMint) : '0');
  }, [mintInputs, vaultCandidates, autoSupplyCollateral, onTotalManualMintChange, toNumber]);

  // Calculate aggregate HF for projected position (current + planned deposits/mints)
  // Uses the same shared utility as Mint.tsx and DebtPosition.tsx
  const averageVaultHealth = React.useMemo(() => {
    if (vaultCandidates.length === 0) return null;

    // Build vault data for all vaults with debt or planned changes
    const vaultData = vaultCandidates.map(candidate => {
      let depositAmt = 0;
      let mintAmt = 0;
      
      if (autoSupplyCollateral) {
        // In auto mode, use values from vaultCandidates (convert from wei)
        if (candidate.allocation) {
          const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
          depositAmt = parseFloat(formatUnits(candidate.allocation.depositAmount, decimals));
          mintAmt = parseFloat(formatUnits(candidate.allocation.mintAmount, 18));
        }
      } else {
        // In manual mode, use user input values
        const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
        depositAmt = toNumber(canonicalDeposit);
        const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
        mintAmt = toNumber(mintInput);
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
  }, [vaultCandidates, depositCanonical, mintInputs, toNumber, autoSupplyCollateral]);

  // Notify parent component when average vault health changes (for display in Allocation summary)
  useEffect(() => {
    if (onAverageVaultHealthChange) {
      if (autoSupplyCollateral) {
        onAverageVaultHealthChange(averageVaultHealth);
      } else {
        onAverageVaultHealthChange(null);
      }
    }
  }, [averageVaultHealth, autoSupplyCollateral, onAverageVaultHealthChange]);

  const handleDepositChange = (assetAddress: string, floatValue: number | undefined, formattedValue: string) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    // Handle empty input
    if (floatValue === undefined || formattedValue === '') {
      setDepositDisplayInputs(prev => ({ ...prev, [assetAddress]: '' }));
      setDepositCanonical(prev => ({ ...prev, [assetAddress]: '' }));
      // Remove from depositMax tracking
      setDepositMaxVaults(prev => {
        const newSet = new Set(prev);
        newSet.delete(assetAddress);
        return newSet;
      });
      if (!autoSupplyCollateral && onDepositAmountChange) {
        console.log('[VaultBreakdown] 🚀 TX VALUE - Deposit amount being sent to blockchain (empty input):', {
          assetAddress,
          source: 'handleDepositChange (empty)',
          depositWei: '0',
          depositWeiType: typeof '0'
        });
        onDepositAmountChange(assetAddress, '0'); // Pass wei string
      }
      return;
    }

    // Store the formatted display value
    setDepositDisplayInputs(prev => ({ ...prev, [assetAddress]: formattedValue }));
    
    // Calculate and store canonical WAD value (decimal token amount)
    const valueStr = String(floatValue);
    let canonicalValue = displayMode === 'USD' ? usdToWad(valueStr, assetAddress) : valueStr;
    let useExactPotentialCollateral = false;
    
    // Check if value matches potentialCollateral in current display mode
    // If so, use raw potentialCollateral for precision
    if (candidate.potentialCollateral > 0n) {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const potentialDecimal = formatUnits(candidate.potentialCollateral, decimals);
      const potentialNum = parseFloat(potentialDecimal);
      let matchesPotential = false;

      if (displayMode === 'USD') {
        // In USD mode: check if input matches potentialCollateral's USD value (rounded to 2 decimals)
        const price = getPrice(assetAddress);
        const potentialUSD = potentialNum * price;
        const roundedPotentialUSD = parseFloat(potentialUSD.toFixed(2));
        
        console.log('[VaultBreakdown] Deposit max check (USD mode):', {
          assetAddress,
          displayMode: 'USD',
          inputValue: floatValue,
          inputType: typeof floatValue,
          potentialCollateral: candidate.potentialCollateral.toString(),
          potentialDecimal,
          potentialNum,
          price,
          potentialUSD,
          potentialUSD_toFixed2: potentialUSD.toFixed(2),
          roundedPotentialUSD,
          roundedType: typeof roundedPotentialUSD,
          comparison: `${floatValue} === ${roundedPotentialUSD}`,
          matches: floatValue === roundedPotentialUSD
        });
        
        matchesPotential = floatValue === roundedPotentialUSD;
      } else {
        // In WAD mode: check if input matches potentialCollateral's token amount
        console.log('[VaultBreakdown] Deposit max check (WAD mode):', {
          assetAddress,
          displayMode: 'WAD',
          inputValue: floatValue,
          inputType: typeof floatValue,
          potentialCollateral: candidate.potentialCollateral.toString(),
          potentialDecimal,
          potentialNum,
          potentialType: typeof potentialNum,
          comparison: `${floatValue} === ${potentialNum}`,
          matches: floatValue === potentialNum
        });
        
        matchesPotential = floatValue === potentialNum;
      }

      if (matchesPotential) {
        // Value matches potentialCollateral exactly - use raw decimal value
        console.log('[VaultBreakdown] ✓ MATCH - Using exact potentialCollateral for deposit:', assetAddress);
        canonicalValue = potentialDecimal;
        useExactPotentialCollateral = true;
        // Track this deposit as matching potentialCollateral
        setDepositMaxVaults(prev => {
          const newSet = new Set(prev);
          newSet.add(assetAddress);
          return newSet;
        });
      } else {
        // Value doesn't match - remove from tracking
        console.log('[VaultBreakdown] ✗ NO MATCH - Removing from depositMax tracking:', assetAddress);
        setDepositMaxVaults(prev => {
          const newSet = new Set(prev);
          newSet.delete(assetAddress);
          return newSet;
        });
      }
    } else {
      // No potentialCollateral - remove from tracking
      setDepositMaxVaults(prev => {
        const newSet = new Set(prev);
        newSet.delete(assetAddress);
        return newSet;
      });
    }
    
    setDepositCanonical(prev => ({ ...prev, [assetAddress]: canonicalValue }));
    
    // Convert to wei and pass to callback
    if (!autoSupplyCollateral && onDepositAmountChange) {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      // If this deposit matches potentialCollateral exactly, use it directly in wei
      const depositWei = useExactPotentialCollateral
        ? candidate.potentialCollateral.toString()
        : parseUnitsWithTruncation(canonicalValue, decimals).toString();
      
      console.log('[VaultBreakdown] 🚀 TX VALUE - Deposit amount being sent to blockchain:', {
        assetAddress,
        source: 'handleDepositChange',
        displayMode,
        useExactPotentialCollateral,
        canonicalValue,
        decimals,
        depositWei,
        depositWeiType: typeof depositWei,
        potentialCollateral: candidate.potentialCollateral.toString(),
        potentialCollateralType: typeof candidate.potentialCollateral.toString(),
        matches: useExactPotentialCollateral ? depositWei === candidate.potentialCollateral.toString() : 'N/A (computed)',
        note: useExactPotentialCollateral ? 'Using exact potentialCollateral' : 'Parsed with truncation (handles excess decimals)'
      });
      
      onDepositAmountChange(assetAddress, depositWei); // Pass wei string
    }
  };

  const handleMintChange = (assetAddress: string, floatValue: number | undefined, formattedValue: string, isFromAvailableClick: boolean = false) => {
    // Check if this change is from programmatic population via "Available: x" click
    const isPopulatingFromAvailable = populatingFromAvailableRef.current === assetAddress;
    
    // Handle empty input
    if (floatValue === undefined || formattedValue === '') {
      setMintInputs(prev => ({ ...prev, [assetAddress]: '' }));
      // Remove from mintMax vaults since user cleared the input (unless we're currently populating)
      if (!isPopulatingFromAvailable) {
        setMintMaxVaults(prev => {
          const newSet = new Set(prev);
          if (newSet.has(assetAddress)) {
            newSet.delete(assetAddress);
          }
          return newSet;
        });
      }
      if (!autoSupplyCollateral && onMintAmountChange) {
        onMintAmountChange(assetAddress, '0'); // Pass wei string
      }
      return;
    }

    // Store the formatted display value
    setMintInputs(prev => ({ ...prev, [assetAddress]: formattedValue }));
    
    // If user manually typed (not from "Available: x" click or programmatic population), remove from mintMax vaults
    if (!isFromAvailableClick && !isPopulatingFromAvailable) {
      setMintMaxVaults(prev => {
        const newSet = new Set(prev);
        if (newSet.has(assetAddress)) {
          newSet.delete(assetAddress);
        }
        return newSet;
      });
    }
    
    // Convert to wei and pass to callback
    if (!autoSupplyCollateral && onMintAmountChange) {
      // Mint is always USDST (18 decimals)
      const mintWei = parseUnitsWithTruncation(String(floatValue), 18).toString();
      onMintAmountChange(assetAddress, mintWei); // Pass wei string
    }
  };

  const getGridClass = () => {
    if (showMintAmounts) {
      return !autoSupplyCollateral 
        ? 'grid-cols-[minmax(100px,auto)_minmax(80px,auto)_1fr_1fr_minmax(60px,auto)]' 
        : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr_1fr]';
    }
    return !autoSupplyCollateral 
      ? 'grid-cols-[minmax(100px,auto)_minmax(80px,auto)_1fr_minmax(60px,auto)]' 
      : 'grid-cols-[minmax(120px,auto)_minmax(100px,auto)_1fr]';
  };

  // Always show all vault candidates when expanded - never filter them out
  // Vault candidates should persist in memory and always be visible when breakdown is open
  const vaultsToDisplay = vaultCandidates;

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
                    setDisplayMode(prev => prev === 'USD' ? 'WAD' : 'USD');
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                }}
                className="h-6 px-2 text-xs rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground inline-flex items-center justify-center cursor-pointer"
              >
                  {displayMode === 'USD' ? 'Value' : 'Amount'}
              </span>
              )}
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </div>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 px-3 pt-3 pb-3 border border-border rounded-md bg-muted/50 space-y-3">
            {/* Vault-specific warnings - shown between header and form */}
            {exceedsBalance && !autoSupplyCollateral && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Deposit Exceeds Available Balance</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  One or more vaults have a deposit amount that exceeds your available balance. Please reduce the deposit amounts.
                </p>
              </div>
            )}

            {hasLowHF && !autoSupplyCollateral && (
              <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Health Factor Below Minimum</p>
                <p className="text-xs text-red-700 dark:text-red-300">
                  One or more vaults have a health factor below the required minimum. Please reduce mint amounts or increase deposits.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className={`grid gap-2 text-xs font-medium text-muted-foreground pb-2 border-b border-border ${getGridClass()}`}>
                <div>Asset</div>
                <div>Stability Fee</div>
                <div>Deposit</div>
                {showMintAmounts && <div>Mint</div>}
                {!autoSupplyCollateral && <div className="text-right pr-3">HF</div>}
              </div>
              {vaultsToDisplay.map((candidate) => {
                const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(candidate.vaultConfig.stabilityFeeRate);
                
                const token = [...earningAssets, ...inactiveTokens].find(
                  t => t.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
                );
                const tokenImage = token?.images?.[0]?.value;

                // Use canonical (WAD) values for calculations
                const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
                const depositAmt = toNumber(canonicalDeposit);
                const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                const mintAmt = toNumber(mintInput);
                const hf = calculateHF(candidate, depositAmt, mintAmt);
                const hfNum = parseFloat(hf);
                const hfColor = isNaN(hfNum) || hf === '∞' 
                  ? 'text-green-600' 
                  : hfNum >= 2.0 ? 'text-green-600' 
                  : hfNum >= 1.5 ? 'text-yellow-600' 
                  : 'text-red-600';
                
                // Check if HF is below this vault's minimum HF (only when auto-supply is off and mint amount is not empty/zero)
                const vaultMinHF = calculateVaultMinHF(candidate);
                const hasLowHF = !autoSupplyCollateral && 
                  mintInput && mintInput.trim() !== '' && mintAmt > 0 &&
                  hfNum !== Infinity && !isNaN(hfNum) && hfNum < vaultMinHF;

                // Check if deposit exceeds available balance (uses same calculation as VaultsList.tsx)
                const availableBalanceWei = getAvailableBalance(candidate);
                const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                const availableBalance = parseFloat(formatWeiToDecimalHP(availableBalanceWei, decimals));
                // Use tolerance for floating-point precision (same as blue highlighting logic)
                const TOLERANCE = 0.000001;
                const exceedsBalance = !autoSupplyCollateral && depositAmt > 0 && (depositAmt - availableBalance > TOLERANCE);

                // Check if deposit input matches available amount (for blue highlighting)
                const depositDisplayValue = depositDisplayInputs[candidate.vaultConfig.assetAddress] || '';
                const depositDisplayNum = toNumber(depositDisplayValue);
                let depositMatchesAvailable = false;
                if (depositDisplayNum > 0) {
                  if (displayMode === 'USD') {
                    const availableUSD = availableBalance * getPrice(candidate.vaultConfig.assetAddress);
                    // Compare with tolerance for floating point precision (0.01 USD)
                    depositMatchesAvailable = Math.abs(depositDisplayNum - availableUSD) < 0.01;
                  } else {
                    // Compare with tolerance for floating point precision (0.000001 tokens)
                    depositMatchesAvailable = Math.abs(depositDisplayNum - availableBalance) < 0.000001;
                  }
                }

                // Check if mint input matches available amount (for blue highlighting)
                const mintDisplayValue = mintInputs[candidate.vaultConfig.assetAddress] || '';
                const mintDisplayNum = toNumber(mintDisplayValue);
                let mintMatchesAvailable = false;
                if (mintDisplayNum > 0) {
                  // Calculate max mint based on existing collateral + max possible deposit
                  const maxMint = calculateMaxMint(candidate, availableBalance);
                  // Compare with tolerance for floating point precision (0.01 USDST)
                  mintMatchesAvailable = Math.abs(mintDisplayNum - maxMint) < 0.01;
                }

                return (
                  <div key={candidate.vaultConfig.assetAddress} className={`grid gap-2 items-center text-sm ${getGridClass()}`}>
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
                    <div className="text-muted-foreground">{formatPercentage(stabilityFeeRate)}</div>
                    <div className="space-y-1">
                      <div className="relative">
                        {displayMode === 'USD' && (
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none z-10">$</span>
                        )}
                        <NumericFormat
                          value={depositDisplayInputs[candidate.vaultConfig.assetAddress] || ''}
                          onValueChange={(values) => handleDepositChange(candidate.vaultConfig.assetAddress, values.floatValue, values.formattedValue)}
                          onFocus={() => { 
                            editingInputRef.current = `deposit-${candidate.vaultConfig.assetAddress}`;
                            setFocusedInput(`deposit-${candidate.vaultConfig.assetAddress}`);
                          }}
                          onBlur={() => { 
                            editingInputRef.current = null;
                            setFocusedInput(null);
                          }}
                          getInputRef={(el) => {
                            depositInputRefs.current[candidate.vaultConfig.assetAddress] = el;
                          }}
                          thousandSeparator=","
                          allowNegative={false}
                          decimalScale={autoSupplyCollateral && displayMode === 'USD' ? 2 : undefined}
                          customInput={Input}
                        placeholder="0"
                          className={`h-8 text-xs ${displayMode === 'USD' ? 'pl-5' : ''} ${
                            hasLowHF || exceedsBalance 
                              ? 'border-red-500 focus-visible:ring-red-500' 
                              : depositMatchesAvailable 
                              ? 'border-blue-500 focus-visible:ring-blue-500' 
                              : ''
                          }`}
                          disabled={autoSupplyCollateral}
                        />
                      </div>
                      {focusedInput === `deposit-${candidate.vaultConfig.assetAddress}` && (() => {
                        // Use potentialCollateral from candidate (already in wei format)
                        const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                        // Convert to decimal string without truncation
                        const availableAmountDecimal = formatUnits(candidate.potentialCollateral, decimals);
                        const availableAmountNum = parseFloat(availableAmountDecimal);
                        
                        const handleAvailableClick = (e: React.MouseEvent) => {
                          e.preventDefault(); // Prevent blur event
                          e.stopPropagation();
                          
                          const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                          // Convert potentialCollateral directly to decimal string (full precision)
                          const canonicalVal = formatUnits(candidate.potentialCollateral, decimals);
                          
                          // Mark this deposit as using potentialCollateral exactly
                          setDepositMaxVaults(prev => {
                            const newSet = new Set(prev);
                            newSet.add(candidate.vaultConfig.assetAddress);
                            return newSet;
                          });
                          
                          // Update display inputs
                          if (displayMode === 'USD') {
                            // Convert decimal token amount to USD and round to 2 decimals
                            const availableUSD = availableAmountNum * getPrice(candidate.vaultConfig.assetAddress);
                            const roundedUSD = availableUSD.toFixed(2);
                            const formattedUSD = formatNumberWithCommas(roundedUSD);
                            
                            // Update display with rounded USD value
                            setDepositDisplayInputs(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: formattedUSD }));
                            // Update canonical with exact decimal from potentialCollateral
                            setDepositCanonical(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: canonicalVal }));
                            
                            // In manual mode, directly update allocation with potentialCollateral value (in wei)
                            if (!autoSupplyCollateral && onDepositAmountChange) {
                              const depositWei = candidate.potentialCollateral.toString();
                              console.log('[VaultBreakdown] 🚀 TX VALUE - Deposit amount being sent to blockchain (Available click - USD mode):', {
                                assetAddress: candidate.vaultConfig.assetAddress,
                                source: 'handleAvailableClick (USD)',
                                displayMode: 'USD',
                                potentialCollateral: candidate.potentialCollateral.toString(),
                                depositWei,
                                depositWeiType: typeof depositWei,
                                canonicalVal,
                                formattedUSD
                              });
                              onDepositAmountChange(candidate.vaultConfig.assetAddress, depositWei);
                            }
                          } else {
                            // Use raw decimal value from formatUnits, no truncation
                            const formattedWAD = formatNumberWithCommas(canonicalVal);
                            
                            // Update display and canonical values
                            setDepositDisplayInputs(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: formattedWAD }));
                            setDepositCanonical(prev => ({ ...prev, [candidate.vaultConfig.assetAddress]: canonicalVal }));
                            
                            // In manual mode, directly update allocation with potentialCollateral value (in wei)
                            if (!autoSupplyCollateral && onDepositAmountChange) {
                              const depositWei = candidate.potentialCollateral.toString();
                              console.log('[VaultBreakdown] 🚀 TX VALUE - Deposit amount being sent to blockchain (Available click - WAD mode):', {
                                assetAddress: candidate.vaultConfig.assetAddress,
                                source: 'handleAvailableClick (WAD)',
                                displayMode: 'WAD',
                                potentialCollateral: candidate.potentialCollateral.toString(),
                                depositWei,
                                depositWeiType: typeof depositWei,
                                canonicalVal,
                                formattedWAD
                              });
                              onDepositAmountChange(candidate.vaultConfig.assetAddress, depositWei);
                            }
                          }
                          
                          // Blur the input after populating
                          setTimeout(() => {
                            depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
                            setFocusedInput(null);
                            editingInputRef.current = null;
                          }, 0);
                        };
                        
                        if (displayMode === 'USD') {
                          // Show in USD (rounded to 2 decimals)
                          const availableUSD = availableAmountNum * getPrice(candidate.vaultConfig.assetAddress);
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={handleAvailableClick}
                            >
                              Available: ${formatNumberWithCommas(availableUSD.toFixed(2))}
                            </div>
                          );
                        } else {
                          // Show in token amount (truncated for display only)
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={handleAvailableClick}
                            >
                              Available: {truncateForDisplay(availableAmountNum)} {candidate.vaultConfig.symbol}
                            </div>
                          );
                        }
                      })()}
                    </div>
                    {showMintAmounts && (
                      <div className="space-y-1">
                        <div className="relative">
                          {displayMode === 'USD' && (
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none z-10">$</span>
                          )}
                          <NumericFormat
                            value={mintInputs[candidate.vaultConfig.assetAddress] || ''}
                            onValueChange={(values) => handleMintChange(candidate.vaultConfig.assetAddress, values.floatValue, values.formattedValue)}
                            onFocus={() => { 
                              editingInputRef.current = `mint-${candidate.vaultConfig.assetAddress}`;
                              setFocusedInput(`mint-${candidate.vaultConfig.assetAddress}`);
                            }}
                            onBlur={() => { 
                              editingInputRef.current = null;
                              setFocusedInput(null);
                            }}
                            getInputRef={(el) => {
                              mintInputRefs.current[candidate.vaultConfig.assetAddress] = el;
                            }}
                            thousandSeparator=","
                            allowNegative={false}
                            decimalScale={autoSupplyCollateral && displayMode === 'USD' ? 2 : undefined}
                            customInput={Input}
                          placeholder="0"
                            className={`h-8 text-xs ${displayMode === 'USD' ? 'pl-5' : ''} ${
                              hasLowHF || exceedsBalance 
                                ? 'border-red-500 focus-visible:ring-red-500' 
                                : mintMatchesAvailable 
                                ? 'border-blue-500 focus-visible:ring-blue-500' 
                                : ''
                            }`}
                            disabled={autoSupplyCollateral}
                          />
                        </div>
                        {focusedInput === `mint-${candidate.vaultConfig.assetAddress}` && (() => {
                          // Calculate max deposit from available balance (uses same calculation as VaultsList.tsx)
                          const availableBalanceWei = getAvailableBalance(candidate);
                          const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                          const maxDepositAmount = parseFloat(formatWeiToDecimalHP(availableBalanceWei, decimals));
                          
                          // Calculate max mint based on existing collateral + max possible deposit
                          const maxMint = calculateMaxMint(candidate, maxDepositAmount);
                          const formattedMaxMint = formatNumberWithCommas(String(maxMint));
                          
                          const handleAvailableClick = (e: React.MouseEvent) => {
                            e.preventDefault(); // Prevent blur event
                            e.stopPropagation();
                            
                            // Mark this vault as using mintMax (will use mintMax contract function)
                            setMintMaxVaults(prev => {
                              const newSet = new Set(prev);
                              newSet.add(candidate.vaultConfig.assetAddress);
                              return newSet;
                            });
                            
                            // Set ref to prevent NumericFormat's onValueChange from removing vault from mintMax
                            populatingFromAvailableRef.current = candidate.vaultConfig.assetAddress;
                            
                            // Populate BOTH deposit and mint fields with their max values
                            if (displayMode === 'USD') {
                              // Deposit in USD
                              const maxDepositUSD = maxDepositAmount * getPrice(candidate.vaultConfig.assetAddress);
                              // In custom mode: no rounding, full precision
                              // In auto mode: round to 2 decimals
                              const formattedDepositUSD = autoSupplyCollateral
                                ? formatNumberWithCommas(maxDepositUSD.toFixed(2))
                                : formatNumberWithCommas(String(maxDepositUSD));
                              handleDepositChange(candidate.vaultConfig.assetAddress, maxDepositUSD, formattedDepositUSD);
                            } else {
                              // Deposit in token amount (WAD)
                              // In custom mode: no rounding, full precision
                              // In auto mode: round to 6 decimals
                              const formattedDepositWAD = autoSupplyCollateral
                                ? formatNumberWithCommas(maxDepositAmount.toFixed(6))
                                : formatNumberWithCommas(String(maxDepositAmount));
                              handleDepositChange(candidate.vaultConfig.assetAddress, maxDepositAmount, formattedDepositWAD);
                            }
                            
                            // Mint amount (always in USDST)
                            // In custom mode: no rounding, full precision
                            // In auto mode: round to 2 decimals
                            const finalFormattedMaxMint = autoSupplyCollateral
                              ? formatNumberWithCommas(maxMint.toFixed(2))
                              : formattedMaxMint; // Already unrounded (String(maxMint))
                            // Pass true for isFromAvailableClick to indicate this is a max mint
                            handleMintChange(candidate.vaultConfig.assetAddress, maxMint, finalFormattedMaxMint, true);
                            
                            // Clear the ref after a short delay (after NumericFormat's onValueChange has fired)
                            setTimeout(() => {
                              populatingFromAvailableRef.current = null;
                            }, 100);
                            
                            // Blur both inputs after populating
                            setTimeout(() => {
                              depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
                              mintInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
                              setFocusedInput(null);
                              editingInputRef.current = null;
                            }, 0);
                          };
                          
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={handleAvailableClick}
                            >
                              Available: {formattedMaxMint} USDST
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    {!autoSupplyCollateral && (
                      <div className={`font-medium text-right pr-3 ${hfColor}`}>{hf}</div>
                    )}
                  </div>
                );
              })}
              {vaultCandidates.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-2">No vault candidates available</div>
              )}
            </div>

            {/* Summary section - only shown in manual mode when breakdown is expanded */}
            {!autoSupplyCollateral && (
              <div className="pt-2 border-t border-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Total Mint Amount:</span>
                  <span className="text-sm font-bold tabular-nums">
                    {formatNumberWithCommas(
                      autoSupplyCollateral
                        ? vaultCandidates.reduce((sum, candidate) => {
                            const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                            return sum + toNumber(mintInput);
                          }, 0).toFixed(2)
                        : String(vaultCandidates.reduce((sum, candidate) => {
                            const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                            return sum + toNumber(mintInput);
                          }, 0))
                    )} USDST
                  </span>
                </div>
                {averageVaultHealth && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Average Vault Health:</span>
                    <span className="text-sm font-bold tabular-nums">
                      {averageVaultHealth}
                    </span>
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
