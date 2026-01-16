import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { formatUnits, parseUnits } from 'ethers';
import { NumericFormat } from 'react-number-format';
import type { Allocation } from '@/components/cdp/v2/cdpTypes';
import type { VaultCandidate } from '@/components/cdp/v2/cdpTypes';
import { formatPercentage, getAssetColor, convertStabilityFeeRateToAnnualPercentage, calculateAggregateHealthFactor } from '@/components/cdp/v2/cdpUtils';
import { useTokenContext } from '@/context/TokenContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { parseUnitsWithTruncation } from '@/utils/numberUtils';
import { UNITS, USD, DECIMAL, ADDRESS } from '@/components/cdp/v2/cdpTypes';

interface VaultBreakdownProps {
  vaultCandidates: VaultCandidate[];
  vaultAllocations: Allocation[];
  showMintAmounts?: boolean;
  onDepositAmountChange?: (assetAddress: ADDRESS, amount: string) => void;
  onMintAmountChange?: (assetAddress: ADDRESS, amount: string) => void;
  autoSupplyCollateral?: boolean;
  isMaxMode?: boolean; // Whether max mode is enabled (forces sync even in manual mode)
  targetHF?: DECIMAL; // Target HF from slider (riskBuffer)
  onHFValidationChange?: (hasLowHF: boolean) => void; // Callback when HF validation changes
  onBalanceExceededChange?: (exceedsBalance: boolean) => void; // Callback when deposit exceeds balance
  onTotalManualMintChange?: (totalMint: string) => void; // Callback with total mint from all vaults in manual mode
  onAverageVaultHealthChange?: (averageHF: string | null) => void; // Callback with average vault health
  onMintMaxVaultsChange?: (vaults: Set<ADDRESS>) => void; // Callback when vaults using mintMax changes
  exceedsBalance?: boolean; // Whether any deposit exceeds available balance
  hasLowHF?: boolean; // Whether any vault has HF below minimum
}

const VaultBreakdown: React.FC<VaultBreakdownProps> = ({
  vaultAllocations,
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
  const [mintMaxVaults, setMintMaxVaults] = useState<Set<ADDRESS>>(new Set());
  
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
  const [depositDisplayInputs, setDepositDisplayInputs] = useState<Record<ADDRESS, string>>({});
  const [mintInputs, setMintInputs] = useState<Record<ADDRESS, string>>({});
  // Store canonical WAD values for deposits (token amounts, not USD)
  const [depositCanonical, setDepositCanonical] = useState<Record<ADDRESS, string>>({});
  
  // Track which input is currently being edited (to show "Available" message)
  const editingInputRef = useRef<string | null>(null);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  // Refs for input elements to blur them after populating from "Available" click
  const depositInputRefs = useRef<Record<ADDRESS, HTMLInputElement | null>>({});
  const mintInputRefs = useRef<Record<ADDRESS, HTMLInputElement | null>>({});
  
  // Track when we're programmatically populating from "Available: x" click
  // This prevents NumericFormat's onValueChange from removing the vault from mintMaxVaults
  const populatingFromAvailableRef = useRef<ADDRESS | null>(null);

  // Get oracle price for an asset (returns USD per token)
  const getPrice = useCallback((assetAddress: ADDRESS): USD => {
    const c = vaultCandidates.find(v => v.vaultConfig.assetAddress === assetAddress);
    return c ? parseFloat(formatUnits(c.oraclePrice, 18)) : 0;
  }, [vaultCandidates]);

  // Get available balance for deposit - returns UNITS as bigint
  const getAvailableBalance = useCallback((candidate: VaultCandidate): UNITS => {
    // Find the user's balance for this token (same as VaultsList.tsx line 236-242)
    const userToken = activeTokens.find(token => 
      token.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
    );
    
    if (userToken?.balance) {
      // Return raw wei balance as bigint
      return BigInt(userToken.balance);
    }
    
    // Fallback to 0n if no balance found
    return 0n;
  }, [activeTokens]);

  // Parse input to DECIMAL number
  const toNumber = useCallback((input: string): DECIMAL => {
    const num = parseFloat(input || '0');
    return isNaN(num) ? 0 : num;
  }, []);

  // Truncate number for display (6 significant figures)
  const truncateForDisplay = useCallback((value: USD | DECIMAL): string => {
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

  // Convert WAD token amount (DECIMAL) to USD value
  // roundForDisplay: true in auto mode (2 decimal places), false in manual mode (no rounding)
  const wadToUSD = useCallback((wadAmount: string, assetAddress: ADDRESS, roundForDisplay: boolean = true): string => {
    if (!wadAmount || wadAmount === '0') return '';
    const tokenAmount: DECIMAL = toNumber(wadAmount);
    const price: USD = getPrice(assetAddress);
    const usdValue: USD = tokenAmount * price;
    if (usdValue <= 0) return '';
    return roundForDisplay ? usdValue.toFixed(2) : String(usdValue);
  }, [toNumber, getPrice]);

  // Convert USD value to WAD token amount (DECIMAL) - never rounds - preserves full precision
  const usdToWad = useCallback((usdValue: string, assetAddress: ADDRESS): string => {
    if (!usdValue || usdValue === '0') return '';
    const usd: USD = toNumber(usdValue);
    const price: USD = getPrice(assetAddress);
    const tokenAmount: DECIMAL = price > 0 ? usd / price : 0;
    return tokenAmount > 0 ? String(tokenAmount) : '';
  }, [toNumber, getPrice]);

  // Track previous autoSupplyCollateral value to detect transitions
  const prevAutoSupplyRef = useRef<boolean>(autoSupplyCollateral);
  
  // When transitioning from auto to manual mode, initialize inputs from vaultAllocations
  useEffect(() => {
    // Detect transition from auto (true) to manual (false)
    if (prevAutoSupplyRef.current === true && autoSupplyCollateral === false) {
      // Initialize canonical deposit values from vaultAllocations
      const newCanonical: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const depositBigInt = alloc?.depositAmount ?? 0n;
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
      const newDisplay: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const canonicalVal = newCanonical[c.vaultConfig.assetAddress];
        
        if (displayMode === 'USD' && canonicalVal) {
          newDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonicalVal, c.vaultConfig.assetAddress, false);
        } else if (canonicalVal) {
          newDisplay[c.vaultConfig.assetAddress] = canonicalVal;
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      setDepositDisplayInputs(newDisplay);

      // Initialize mint inputs (no rounding in custom mode)
      const newMints: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const mintBigInt = alloc?.mintAmount ?? 0n;
        
        if (mintBigInt <= 0n) {
          newMints[c.vaultConfig.assetAddress] = '';
        } else {
          // Convert from wei (18 decimals) to decimal string
          const mintDecimal = formatUnits(mintBigInt, 18);
          newMints[c.vaultConfig.assetAddress] = mintDecimal;
        }
      });
      setMintInputs(newMints);
    }
    
    // Update ref for next render
    prevAutoSupplyRef.current = autoSupplyCollateral;
  }, [autoSupplyCollateral, vaultAllocations, vaultCandidates, displayMode, wadToUSD]);

  // Calculate minimum HF for a specific vault based on its minCR and liquidationRatio
  // Data flow: Blockchain (CDPEngine.collateralConfigs) → Backend (Cirrus) → Frontend (VaultCandidate)
  // Each vault has its own minCR constraint from the blockchain - no defaults or hardcoded values
  const calculateVaultMinHF = useCallback((candidate: VaultCandidate): DECIMAL => {
    // minHF = minCR / liquidationRatio (both in WAD format from blockchain)
    // e.g., if minCR = 1.5e18 (150%) and liquidationRatio = 1.33e18 (133%)
    // then minHF = 150 / 133 = 1.13
    const minCRPercent = parseFloat(formatUnits(candidate.vaultConfig.minCR, 18)) * 100;
    const ltPercent = parseFloat(formatUnits(candidate.vaultConfig.liquidationRatio, 18)) * 100;
    
    if (ltPercent <= 0) return 1.0;
    
    const minHF: DECIMAL = minCRPercent / ltPercent;
    return Math.round(minHF * 100) / 100; // Round to 2 decimal places
  }, []);

  // Calculate raw HF value for a vault - returns DECIMAL for precise calculations
  // Returns null for infinite/invalid values
  const calculateHFRaw = useCallback((candidate: VaultCandidate, depositAmt: DECIMAL, mintAmt: DECIMAL): DECIMAL | null => {
    try {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      // Use parseUnitsWithTruncation to handle amounts with too many decimal places
      const depositWei: UNITS = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
      const mintWei: UNITS = mintAmt > 0 ? parseUnitsWithTruncation(mintAmt.toString(), 18) : 0n;

      const totalCollateral: UNITS = candidate.currentCollateral + depositWei;
      const totalDebt: UNITS = candidate.currentDebt + mintWei;

      if (totalDebt <= 0n) return null; // Infinite HF

      // Calculate collateral value in USD (18 decimals)
      const collateralValueUSD: UNITS = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
      
      // Convert to numbers for percentage calculation
      const collateralUSD: USD = parseFloat(formatUnits(collateralValueUSD, 18));
      const debtUSD: USD = parseFloat(formatUnits(totalDebt, 18));

      // CR = (collateralUSD / debtUSD) * 100 (as percentage, e.g., 200 for 200%)
      const cr: DECIMAL = (collateralUSD / debtUSD) * 100;
      
      // LT = liquidationRatio converted from WAD to percentage (e.g., 1.5e18 -> 150)
      const lt: DECIMAL = parseFloat(formatUnits(candidate.vaultConfig.liquidationRatio, 18)) * 100;

      // HF = CR / LT (same as VaultsList)
      const hf: DECIMAL = cr / lt;

      if (!isFinite(hf) || isNaN(hf) || hf >= 999) return null;
      return hf;
    } catch {
      return null;
    }
  }, []);

  // Format HF for display - rounds to 2 decimal places
  const calculateHF = useCallback((candidate: VaultCandidate, depositAmt: DECIMAL, mintAmt: DECIMAL): string => {
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const mintWei: UNITS = mintAmt > 0 ? parseUnitsWithTruncation(mintAmt.toString(), 18) : 0n;
    const totalDebt: UNITS = candidate.currentDebt + mintWei;

    if (totalDebt <= 0n) return '∞';

    const hfRaw: DECIMAL | null = calculateHFRaw(candidate, depositAmt, mintAmt);
    if (hfRaw === null) return '∞';
    return hfRaw.toFixed(2);
  }, [calculateHFRaw]);

  // Calculate maximum available mint amount for a vault based on current collateral + deposit
  // Applies a safety buffer to account for the strict `<` inequality in CDPEngine.sol mint()
  // CDPEngine requires: currentDebt + amountUSD < maxBorrowableUSD (not <=)
  const calculateMaxMint = useCallback((candidate: VaultCandidate, depositAmt: DECIMAL): DECIMAL => {
    // Match backend's exact calculation from cdp.service.ts getMaxMint (lines 846-950)
    const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
    // Use parseUnitsWithTruncation to handle amounts with too many decimal places
    const depositWei: UNITS = depositAmt > 0 ? parseUnitsWithTruncation(depositAmt.toString(), decimals) : 0n;
    const totalCollateral: UNITS = candidate.currentCollateral + depositWei;
    
    // Calculate collateral value in USD (WAD precision)
    const collateralValueUSD: UNITS = (totalCollateral * candidate.oraclePrice) / candidate.vaultConfig.unitScale;
    
    // Backend uses minCR directly, not liquidationRatio
    // maxBorrowableUSD = (collateralValueUSD * WAD) / minCR
    const WAD: UNITS = 10n ** 18n;
    const maxBorrowableUSD: UNITS = (collateralValueUSD * WAD) / candidate.vaultConfig.minCR;
    
    const currentDebt: UNITS = candidate.currentDebt;
    
    let maxAmount: UNITS;
    if (maxBorrowableUSD <= currentDebt) {
      maxAmount = 0n;
    } else {
      const available: UNITS = maxBorrowableUSD - currentDebt;
      // Apply 1 wei buffer (matches backend line 924)
      maxAmount = available > 1n ? (available - 1n) : 0n;
    }
    
    // Convert to decimal USDST
    // No safety buffer needed - we track mintMax vaults and use mintMax() contract function
    // which calculates the max on-chain at execution time
    const maxMintUSD: DECIMAL = parseFloat(formatUnits(maxAmount, 18));
    return maxMintUSD;
  }, []);

  // Sync from vaultAllocations when they change
  // This always uses the canonical WAD values from vaultAllocations
  // In manual mode, skip syncing UNLESS max mode is enabled
  useEffect(() => {
    // In manual mode, user controls the inputs - don't sync from vaultAllocations
    // EXCEPTION: When max mode is enabled, we must sync the max values
    // This prevents flickering caused by the feedback loop:
    // user input → parent callback → vaultAllocations update → sync back → flickering
    if (!autoSupplyCollateral && !isMaxMode) {
      return;
    }
    
    // Update canonical deposit values from vaultAllocations
    setDepositCanonical(prev => {
      const newCanonical: Record<ADDRESS, string> = {};
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const depositBigInt = alloc?.depositAmount ?? 0n;
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

    // Update display deposit values from vaultAllocations (with rounding in auto mode)
    setDepositDisplayInputs(prev => {
      const newDisplay: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const depositBigInt = alloc?.depositAmount ?? 0n;
        if (depositBigInt > 0n) {
          // Convert from wei to decimal
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const canonicalVal = formatUnits(depositBigInt, decimals);
          
          if (displayMode === 'USD') {
            // In auto mode, round to 2 decimal places
            newDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonicalVal, c.vaultConfig.assetAddress, true);
          } else {
            // WAD mode: full precision
            newDisplay[c.vaultConfig.assetAddress] = canonicalVal;
          }
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      return newDisplay;
    });

    // Update mint inputs from vaultAllocations (with rounding in auto mode)
    setMintInputs(prev => {
      const newMints: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const mintBigInt = alloc?.mintAmount ?? 0n;
        if (mintBigInt <= 0n) {
          newMints[c.vaultConfig.assetAddress] = '';
          return;
        }
        
        // Convert from wei (18 decimals) to decimal string
        const mintDecimal = formatUnits(mintBigInt, 18);
        const mintNum = parseFloat(mintDecimal);
        
        // In auto mode, format to 2 decimal places in USD mode
        if (displayMode === 'USD') {
          newMints[c.vaultConfig.assetAddress] = mintNum.toFixed(2);
        } else {
          newMints[c.vaultConfig.assetAddress] = mintDecimal;
        }
      });
      return newMints;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultAllocations, vaultCandidates, autoSupplyCollateral, isMaxMode]);

  // When display mode changes, handle conversion based on auto/manual mode
  useEffect(() => {
    if (autoSupplyCollateral) {
      // AUTO MODE: Convert from optimal allocation amounts (wei) to display
      // This ensures we always use the original allocation values, not derived ones
      const newDisplay: Record<string, string> = {};
      
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const depositBigInt = alloc?.depositAmount ?? 0n;
        
        if (depositBigInt > 0n) {
          // Convert from wei to decimal
          const decimals = c.vaultConfig.unitScale.toString().length - 1;
          const canonicalVal = formatUnits(depositBigInt, decimals);
          
          if (displayMode === 'USD') {
            newDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonicalVal, c.vaultConfig.assetAddress, true); // Round for display
          } else {
            newDisplay[c.vaultConfig.assetAddress] = canonicalVal; // WAD full precision
          }
        } else {
          newDisplay[c.vaultConfig.assetAddress] = '';
        }
      });
      
      setDepositDisplayInputs(newDisplay);

      // Convert mint amounts from optimal allocation
      const newMints: Record<string, string> = {};
      vaultCandidates.forEach(c => {
        const alloc = vaultAllocations.find(a => a.assetAddress === c.vaultConfig.assetAddress);
        const mintBigInt = alloc?.mintAmount ?? 0n;
        
        if (mintBigInt <= 0n) {
          newMints[c.vaultConfig.assetAddress] = '';
          return;
        }
        
        // Convert from wei (18 decimals) to decimal string
        const mintDecimal = formatUnits(mintBigInt, 18);
        const mintNum = parseFloat(mintDecimal);
        
        // Round to 2 decimal places in USD mode
        if (displayMode === 'USD') {
          newMints[c.vaultConfig.assetAddress] = mintNum.toFixed(2);
        } else {
          newMints[c.vaultConfig.assetAddress] = mintDecimal;
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
        
        if (displayMode === 'USD') {
          // Converting WAD to USD - use canonical value (no rounding)
          newDepositDisplay[c.vaultConfig.assetAddress] = wadToUSD(canonical, c.vaultConfig.assetAddress, false);
        } else {
          // Converting to WAD display - use canonical value directly (full precision)
          newDepositDisplay[c.vaultConfig.assetAddress] = canonical;
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
      const mintAmt: DECIMAL = toNumber(mintInput);
      
      // Skip validation for vaults with empty or zero mint amount
      if (!mintInput || mintInput.trim() === '' || mintAmt === 0) {
        continue;
      }
      
      // Use canonical token amounts for HF calculation
      const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
      const depositAmt: DECIMAL = toNumber(canonicalDeposit);
      
      // Use raw HF value for precise comparison
      const hfRaw: DECIMAL | null = calculateHFRaw(candidate, depositAmt, mintAmt);
      
      // Calculate this vault's minimum HF based on its specific minCR and liquidationRatio
      const vaultMinHF: DECIMAL = calculateVaultMinHF(candidate);
      
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
      const depositAmt: DECIMAL = toNumber(canonicalDeposit);
      
      // Skip validation for vaults with empty or zero deposit
      if (!canonicalDeposit || canonicalDeposit.trim() === '' || depositAmt === 0) {
        continue;
      }
      
      // Get available balance (uses same calculation as VaultsList.tsx)
      const availableBalanceWei: UNITS = getAvailableBalance(candidate);
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const availableBalance: DECIMAL = parseFloat(formatUnits(availableBalanceWei, decimals));
      
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

    let totalMint: DECIMAL = 0;
    for (const candidate of vaultCandidates) {
      const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
      const mintAmt: DECIMAL = toNumber(mintInput);
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
      let depositAmt: DECIMAL = 0;
      let mintAmt: DECIMAL = 0;
      
      if (autoSupplyCollateral) {
        // In auto mode, use values from vaultAllocations (convert from wei)
        const allocation = vaultAllocations.find(a => a.assetAddress === candidate.vaultConfig.assetAddress);
        const depositBigInt: UNITS = allocation?.depositAmount ?? 0n;
        const mintBigInt: UNITS = allocation?.mintAmount ?? 0n;
        const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
        depositAmt = parseFloat(formatUnits(depositBigInt, decimals));
        mintAmt = parseFloat(formatUnits(mintBigInt, 18));
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
  }, [vaultCandidates, depositCanonical, mintInputs, toNumber, autoSupplyCollateral, vaultAllocations]);

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

  const handleDepositChange = (assetAddress: ADDRESS, floatValue: USD | DECIMAL | undefined, formattedValue: string) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    // Handle empty input
    if (floatValue === undefined || formattedValue === '') {
      setDepositDisplayInputs(prev => ({ ...prev, [assetAddress]: '' }));
      setDepositCanonical(prev => ({ ...prev, [assetAddress]: '' }));
      if (!autoSupplyCollateral && onDepositAmountChange) {
        onDepositAmountChange(assetAddress, '0'); // Pass wei string
      }
      return;
    }

    // Store the formatted display value
    setDepositDisplayInputs(prev => ({ ...prev, [assetAddress]: formattedValue }));
    
    // Calculate and store canonical WAD value (decimal token amount)
    const valueStr = String(floatValue);
    const canonicalValue = displayMode === 'USD' ? usdToWad(valueStr, assetAddress) : valueStr;
    setDepositCanonical(prev => ({ ...prev, [assetAddress]: canonicalValue }));
    
    // Convert to wei and pass to callback
    if (!autoSupplyCollateral && onDepositAmountChange) {
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const depositWei: UNITS = parseUnitsWithTruncation(canonicalValue, decimals);
      onDepositAmountChange(assetAddress, depositWei.toString()); // Pass wei string
    }
  };

  const handleMintChange = (assetAddress: ADDRESS, floatValue: DECIMAL | undefined, formattedValue: string, isFromAvailableClick: boolean = false) => {
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
      const mintWei: UNITS = parseUnitsWithTruncation(String(floatValue), 18);
      onMintAmountChange(assetAddress, mintWei.toString()); // Pass wei string
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
                const allocation = vaultAllocations.find(a => a.assetAddress === candidate.vaultConfig.assetAddress);
                const stabilityFeeRate = convertStabilityFeeRateToAnnualPercentage(candidate.vaultConfig.stabilityFeeRate);
                
                const token = [...earningAssets, ...inactiveTokens].find(
                  t => t.address?.toLowerCase() === candidate.vaultConfig.assetAddress?.toLowerCase()
                );
                const tokenImage = token?.images?.[0]?.value;

                // Use canonical (WAD) values for calculations
                const canonicalDeposit = depositCanonical[candidate.vaultConfig.assetAddress] || '';
                const depositAmt: DECIMAL = toNumber(canonicalDeposit);
                const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                const mintAmt: DECIMAL = toNumber(mintInput);
                const hf: string = calculateHF(candidate, depositAmt, mintAmt);
                const hfNum: DECIMAL = parseFloat(hf);
                const hfColor = isNaN(hfNum) || hf === '∞' 
                  ? 'text-green-600' 
                  : hfNum >= 2.0 ? 'text-green-600' 
                  : hfNum >= 1.5 ? 'text-yellow-600' 
                  : 'text-red-600';
                
                // Check if HF is below this vault's minimum HF (only when auto-supply is off and mint amount is not empty/zero)
                const vaultMinHF: DECIMAL = calculateVaultMinHF(candidate);
                const hasLowHF = !autoSupplyCollateral && 
                  mintInput && mintInput.trim() !== '' && mintAmt > 0 &&
                  hfNum !== Infinity && !isNaN(hfNum) && hfNum < vaultMinHF;

                // Check if deposit exceeds available balance (uses same calculation as VaultsList.tsx)
                const availableBalanceWei: UNITS = getAvailableBalance(candidate);
                const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                const availableBalance: DECIMAL = parseFloat(formatUnits(availableBalanceWei, decimals));
                // Use tolerance for floating-point precision (same as blue highlighting logic)
                const TOLERANCE = 0.000001;
                const exceedsBalance = !autoSupplyCollateral && depositAmt > 0 && (depositAmt - availableBalance > TOLERANCE);

                // Check if deposit input matches available amount (for blue highlighting)
                const depositDisplayValue = depositDisplayInputs[candidate.vaultConfig.assetAddress] || '';
                const depositDisplayNum: DECIMAL = toNumber(depositDisplayValue);
                let depositMatchesAvailable = false;
                if (depositDisplayNum > 0) {
                  if (displayMode === 'USD') {
                    const availableUSD: USD = availableBalance * getPrice(candidate.vaultConfig.assetAddress);
                    // Compare with tolerance for floating point precision (0.01 USD)
                    depositMatchesAvailable = Math.abs(depositDisplayNum - availableUSD) < 0.01;
                  } else {
                    // Compare with tolerance for floating point precision (0.000001 tokens)
                    depositMatchesAvailable = Math.abs(depositDisplayNum - availableBalance) < 0.000001;
                  }
                }

                // Check if mint input matches available amount (for blue highlighting)
                const mintDisplayValue = mintInputs[candidate.vaultConfig.assetAddress] || '';
                const mintDisplayNum: DECIMAL = toNumber(mintDisplayValue);
                let mintMatchesAvailable = false;
                if (mintDisplayNum > 0) {
                  // Calculate max mint based on existing collateral + max possible deposit
                  const maxMint: DECIMAL = calculateMaxMint(candidate, availableBalance);
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
                        // Use potentialCollateral from candidate
                        const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                        const availableAmount: string = formatUnits(candidate.potentialCollateral, decimals);
                        const availableAmountNum: DECIMAL = parseFloat(availableAmount);
                        
                        const handleAvailableClick = (e: React.MouseEvent) => {
                          e.preventDefault(); // Prevent blur event
                          e.stopPropagation();
                          
                          if (displayMode === 'USD') {
                            // Populate with USD value (full precision)
                            const availableUSD: USD = availableAmountNum * getPrice(candidate.vaultConfig.assetAddress);
                            handleDepositChange(candidate.vaultConfig.assetAddress, availableUSD, String(availableUSD));
                          } else {
                            // Populate with token amount (full precision)
                            handleDepositChange(candidate.vaultConfig.assetAddress, availableAmountNum, availableAmount);
                          }
                          
                          // Blur the input after populating
                          setTimeout(() => {
                            depositInputRefs.current[candidate.vaultConfig.assetAddress]?.blur();
                            setFocusedInput(null);
                            editingInputRef.current = null;
                          }, 0);
                        };
                        
                        if (displayMode === 'USD') {
                          // Show in USD (truncated for display)
                          const availableUSD: USD = availableAmountNum * getPrice(candidate.vaultConfig.assetAddress);
                          return (
                            <div 
                              className="text-xs text-muted-foreground cursor-pointer hover:text-foreground hover:underline"
                              onMouseDown={handleAvailableClick}
                            >
                              Available: ${truncateForDisplay(availableUSD)}
                            </div>
                          );
                        } else {
                          // Show in token amount (truncated for display)
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
                          // Use potentialCollateral from candidate
                          const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
                          const maxDepositAmount: DECIMAL = parseFloat(formatUnits(candidate.potentialCollateral, decimals));
                          
                          // Calculate max mint based on existing collateral + max possible deposit
                          const maxMint: DECIMAL = calculateMaxMint(candidate, maxDepositAmount);
                          
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
                            
                            // Populate BOTH deposit and mint fields with their max values (full precision)
                            if (displayMode === 'USD') {
                              // Deposit in USD (full precision)
                              const maxDepositUSD: USD = maxDepositAmount * getPrice(candidate.vaultConfig.assetAddress);
                              handleDepositChange(candidate.vaultConfig.assetAddress, maxDepositUSD, String(maxDepositUSD));
                            } else {
                              // Deposit in token amount (full precision)
                              const maxDepositStr: string = formatUnits(candidate.potentialCollateral, decimals);
                              handleDepositChange(candidate.vaultConfig.assetAddress, maxDepositAmount, maxDepositStr);
                            }
                            
                            // Mint amount (always in USDST, full precision)
                            handleMintChange(candidate.vaultConfig.assetAddress, maxMint, String(maxMint), true);
                            
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
                              Available: {truncateForDisplay(maxMint)} USDST
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
                    {autoSupplyCollateral
                      ? vaultCandidates.reduce((sum, candidate) => {
                          const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                          return sum + toNumber(mintInput);
                        }, 0).toFixed(2)
                      : String(vaultCandidates.reduce((sum, candidate) => {
                          const mintInput = mintInputs[candidate.vaultConfig.assetAddress] || '';
                          return sum + toNumber(mintInput);
                        }, 0))
                    } USDST
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
