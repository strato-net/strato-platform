import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useOracleContext } from '@/context/OracleContext';
import { cdpService } from '@/services/cdpService';
import { getOptimalAllocations, getMaxAllocations, getAbsoluteMaxAllocations } from '@/components/cdp/v2/MintService';
import { computeTotalHeadroom } from '@/components/cdp/v2/cdpUtils';
import type { VaultCandidate, Allocation, TransactionProgress, WEI } from '@/components/cdp/v2/cdpTypes';
import { formatUnits } from 'ethers';
import { formatNumberWithCommas, parseCommaNumber } from '@/utils/numberUtils';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { RewardsWidget } from '@/components/rewards/RewardsWidget';
import MintProgressModal, { type ProgressStep } from '../../../MintProgressModal';
import LoanForm from './LoanForm';
import VaultBreakdown from './VaultBreakdown';
import {
  formatUSD,
  parseDecimalToUnits,
  addAllocationsToVaultCandidates,
  calculateTransactionCount,
  calculateTotalFees,
  calculateTotalMaxMint,
  calculateAvailableToMint,
  calculateWeightedAverageAPR,
  calculateSliderMinHF,
  calculatePositionMetrics,
  calculateAggregateHealthFactor,
  computeOptimalAllocations,
  getSliderColor,
  findMaxAchievableHF,
  type OptimalAllocationResult,
} from '@/components/cdp/v2/cdpUtils';
import { formatWeiToDecimalHP } from '@/utils/numberUtils';
import { DECIMAL, ADDRESS, UNITS, USD } from '@/components/cdp/v2/cdpTypes';

interface MintProps {
  onSuccess?: () => void;
  refreshTrigger?: number;
  guestMode?: boolean;
}

const Mint: React.FC<MintProps> = ({ onSuccess, refreshTrigger, guestMode = false }) => {


  // ============================================================================
  // Context Hooks
  // ============================================================================

  const navigate = useNavigate();
  const { fetchAllPrices } = useOracleContext();
  const { userRewards } = useRewardsUserInfo();



  // ============================================================================
  // State - UI Controls
  // ============================================================================

  const [mintAmountInput, setMintAmountInput] = useState('');
  const [targetHF, setTargetHF] = useState<DECIMAL>(2.1);
  const [isMaxMode, setIsMaxMode] = useState(false);
  const [autoAllocate, setAutoAllocate] = useState(true);
  const [hasInitializedHF, setHasInitializedHF] = useState(false);

  // ============================================================================
  // State - Data
  // ============================================================================

  const [vaultCandidates, setVaultCandidates] = useState<VaultCandidate[]>([]);
  const [optimalAllocations, setOptimalAllocations] = useState<VaultCandidate[]>([]);
  const [manualAllocations, setManualAllocations] = useState<VaultCandidate[]>([]);
  const [currentAverageHF, setCurrentAverageHF] = useState<DECIMAL | undefined>(undefined);

  // ============================================================================
  // State - Validation Flags
  // ============================================================================

  const [debtFloorHit, setDebtFloorHit] = useState(false);
  const [debtCeilingHit, setDebtCeilingHit] = useState(false);
  const [hasLowHF, setHasLowHF] = useState(false);
  const [exceedsBalance, setExceedsBalance] = useState(false);
  const [exceedsMaxMint, setExceedsMaxMint] = useState(false);
  const [mintExceedsMax, setMintExceedsMax] = useState(false);

  // ============================================================================
  // State - Transaction Progress
  // ============================================================================

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionsExecuting, setTransactionsExecuting] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [currentProgressStep, setCurrentProgressStep] = useState<ProgressStep>("");
  const [transactionsToSend, setTransactionsToSend] = useState<TransactionProgress[]>([]);
  const [progressError, setProgressError] = useState<string | undefined>();
  const [shouldRefreshOnClose, setShouldRefreshOnClose] = useState(false);

  // ============================================================================
  // State - Manual Mode Tracking
  // ============================================================================

  const [totalManualMint, setTotalManualMint] = useState('0');
  const [mintMaxVaults, setMintMaxVaults] = useState<Set<ADDRESS>>(new Set());



  // ============================================================================
  // Refs
  // ============================================================================

  const prevAutoSupplyRef = useRef<boolean>(autoAllocate);
  const optimalAllocationsRef = useRef<VaultCandidate[]>(optimalAllocations);



  // ============================================================================
  // Memos - Parsed Values
  // ============================================================================

  const mintAmount: DECIMAL = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || '').replace(/,/g, ''));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [mintAmountInput]);

  const mintAmountUSDST: WEI = useMemo(() => parseDecimalToUnits(mintAmountInput), [mintAmountInput]);

  // ============================================================================
  // Memos - Slider Configuration
  // ============================================================================

  const sliderMinHF = useMemo(() => calculateSliderMinHF(vaultCandidates), [vaultCandidates]);
  const sliderColor = useMemo(() => getSliderColor(targetHF), [targetHF]);

  // ============================================================================
  // Memos - Allocations
  // ============================================================================

  const maxAllocationsForTargetHF = useMemo<VaultCandidate[]>(() => {
    if (vaultCandidates.length === 0) return [];
    try {
      const isAtMinHF = Math.abs(targetHF - sliderMinHF) < 0.01;
      const result = isAtMinHF 
        ? getAbsoluteMaxAllocations(vaultCandidates)
        : getMaxAllocations(vaultCandidates, targetHF);
      return addAllocationsToVaultCandidates(result, vaultCandidates);
    } catch {
      return [];
    }
  }, [targetHF, sliderMinHF, vaultCandidates]);

  const allocations = autoAllocate ? optimalAllocations : manualAllocations;

  const mergedVaultCandidates = useMemo(() => {
    const result = vaultCandidates.map(candidate => {
      const allocationCandidate = allocations.find(a => 
        a.vaultConfig.assetAddress === candidate.vaultConfig.assetAddress
      );
      // Always use CURRENT candidate data (fresh potentialCollateral, etc.)
      // and only attach the allocation from the computed allocations
      if (allocationCandidate?.allocation) {
        return { ...candidate, allocation: allocationCandidate.allocation };
      }
      return candidate;
    });
    return result;
  }, [vaultCandidates, allocations]);

  // ============================================================================
  // Memos - Calculations
  // ============================================================================

  const totalHeadroom: WEI = useMemo(() => 
    vaultCandidates.length === 0 ? 0n : computeTotalHeadroom(targetHF, vaultCandidates),
  [targetHF, vaultCandidates]);

  const totalMaxMint: WEI = useMemo(() => 
    calculateTotalMaxMint(maxAllocationsForTargetHF),
  [maxAllocationsForTargetHF]);

  const availableToMint = useMemo(() => 
    calculateAvailableToMint(totalMaxMint),
  [totalMaxMint]);

  // Recalculates whenever allocations change (optimalAllocations or manualAllocations)
  const projectedVaultHealth = useMemo(() => {
    // Need vaultCandidates and allocations to calculate
    if (vaultCandidates.length === 0 || allocations.length === 0) {
      return null;
    }

    // Map vaultCandidates with their allocations
    const vaultData = vaultCandidates.map(candidate => {
      const withAllocation = allocations.find(v => v.vaultConfig.assetAddress === candidate.vaultConfig.assetAddress);
      const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
      const depositAmt: DECIMAL = withAllocation?.allocation 
        ? parseFloat(formatUnits(withAllocation.allocation.depositAmount, decimals))
        : 0;
      const mintAmt: DECIMAL = withAllocation?.allocation 
        ? parseFloat(formatUnits(withAllocation.allocation.mintAmount, 18))
        : 0;

      return {
        currentCollateral: candidate.currentCollateral,
        currentDebt: candidate.currentDebt,
        depositAmount: depositAmt,
        mintAmount: mintAmt,
        oraclePrice: candidate.oraclePrice,
        unitScale: candidate.vaultConfig.unitScale,
        liquidationRatio: candidate.vaultConfig.liquidationRatio,
        decimals,
      };
    }).filter(v => v.currentDebt > 0n || v.depositAmount > 0 || v.mintAmount > 0);

    return calculateAggregateHealthFactor(vaultData);
  }, [vaultCandidates, allocations]); // Recalculates when vaultCandidates or allocations change

  const displayedStabilityFee = useMemo(
    () => calculateWeightedAverageAPR(mergedVaultCandidates),
    [mergedVaultCandidates]
  );

  // Only show stability fee when there are allocations with mint amounts
  const hasAllocationsWithMint = useMemo(
    () => allocations.some(v => v.allocation && v.allocation.mintAmount > 0n),
    [allocations]
  );

  const transactionCount = useMemo(() => calculateTransactionCount(allocations), [allocations]);

  const totalFees = useMemo(() => calculateTotalFees(allocations), [allocations]);

  // ============================================================================
  // Memos - Rewards
  // ============================================================================

  const cdpActivity = useMemo(() => {
    if (!userRewards) return null;
    return userRewards.activities.find((a) => {
      const name = a.activity.name.toLowerCase();
      return name.includes('cdp') || name.includes('mint') || (name.includes('borrow') && !name.includes('lending'));
    });
  }, [userRewards]);



  // ============================================================================
  // Derived Values
  // ============================================================================

  const shouldLockInput = maxAllocationsForTargetHF.length === 0 || totalMaxMint === 0n;
  const exceedsMaxCollateral = !isMaxMode && mintAmountUSDST > 0n && mintAmountUSDST > totalHeadroom;



  // ============================================================================
  // Effects - Data Fetching
  // ============================================================================

  const fetchVaultCandidates = useCallback(async () => {
    // Skip API call for guests
    if (guestMode) {
      setVaultCandidates([]);
      return;
    }
    try {
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      const candidates = [...existingVaults, ...potentialVaults];
      setVaultCandidates(candidates);
    } catch {
      setVaultCandidates([]);
    }
  }, [guestMode]);

  useEffect(() => {
    fetchVaultCandidates();
  }, [fetchVaultCandidates, refreshTrigger]);

  // Initialize targetHF to the maximum achievable HF on first load
  useEffect(() => {
    if (!hasInitializedHF && vaultCandidates.length > 0 && sliderMinHF > 0) {
      const optimalHF = findMaxAchievableHF(vaultCandidates, sliderMinHF, 2.1, 0.01);
      setTargetHF(optimalHF);
      setHasInitializedHF(true);
    }
  }, [vaultCandidates, sliderMinHF, hasInitializedHF]);

  useEffect(() => {
    // Skip for guests
    if (guestMode) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchAllPrices()
      .catch(() => setError('Could not load CDP data'))
      .finally(() => setLoading(false));
  }, [fetchAllPrices, refreshTrigger, guestMode]);

  useEffect(() => {
    // Skip for guests
    if (guestMode) {
      setCurrentAverageHF(undefined);
      return;
    }
    const fetchCurrentPosition = async () => {
      try {
        const positions = await cdpService.getVaults();
        const metrics = calculatePositionMetrics(
          positions.map(pos => ({
            debtAmount: pos.debtAmount,
            collateralValueUSD: pos.collateralValueUSD,
            stabilityFeeRate: pos.stabilityFeeRate,
            liquidationRatio: pos.liquidationRatio,
            collateralizationRatio: pos.collateralizationRatio,
          })),
          formatWeiToDecimalHP
        );
        setCurrentAverageHF(metrics.overallHealthFactor === Infinity ? undefined : metrics.overallHealthFactor);
      } catch {
        setCurrentAverageHF(undefined);
      }
    };
    fetchCurrentPosition();
  }, [refreshTrigger, guestMode]);

  // ============================================================================
  // Effects - Allocation Computation
  // ============================================================================

  useEffect(() => {
    if (!autoAllocate) return;

    let result: OptimalAllocationResult;

    if (isMaxMode) {
      result = {
        optimalAllocations: maxAllocationsForTargetHF,
        debtFloorHit: false,
        debtCeilingHit: false,
      };
    } else {
      result = computeOptimalAllocations(
        mintAmountUSDST,
        targetHF,
        vaultCandidates,
        getOptimalAllocations
      );
      setMintMaxVaults(new Set());
    }

    setOptimalAllocations(result.optimalAllocations);
    setDebtFloorHit(result.debtFloorHit);
    setDebtCeilingHit(result.debtCeilingHit);
  }, [mintAmountUSDST, targetHF, vaultCandidates, isMaxMode, maxAllocationsForTargetHF, autoAllocate]);

  useEffect(() => {
    prevAutoSupplyRef.current = autoAllocate;
  }, [autoAllocate]);

  useEffect(() => {
    optimalAllocationsRef.current = optimalAllocations;
  }, [optimalAllocations]);

  // ============================================================================
  // Effects - Max Mode Sync
  // ============================================================================

  useEffect(() => {
    if (isMaxMode) {
      if (totalMaxMint > 0n) {
        const maxMint = formatUnits(totalMaxMint, 18).replace(/\.?0+$/, '');
        setMintAmountInput(formatNumberWithCommas(maxMint));
      } else {
        setIsMaxMode(false);
        setMintAmountInput('');
      }
    }
  }, [isMaxMode, totalMaxMint, targetHF]);




  // ============================================================================
  // Callbacks - Input Handlers
  // ============================================================================

  const handleMintAmountChange = useCallback((formattedValue: string) => {
    if (formattedValue === '') {
      setMintAmountInput('');
      setIsMaxMode(false);
      setExceedsMaxMint(false);
      return;
    }
    
    setMintAmountInput(formattedValue);
    
    const parsed = parseCommaNumber(formattedValue);
    const inputAmount: DECIMAL = parseFloat(parsed);
    
    if (totalMaxMint > 0n) {
      const maxMint = formatUnits(totalMaxMint, 18);
      const maxMintNum: DECIMAL = parseFloat(maxMint);
      const normalizedInput = parsed.replace(/\.?0+$/, '');
      const normalizedMax = maxMint.replace(/\.?0+$/, '');
      
      setIsMaxMode(normalizedInput === normalizedMax);
      setExceedsMaxMint(!isNaN(inputAmount) && inputAmount > maxMintNum);
    } else {
      setIsMaxMode(false);
      setExceedsMaxMint(false);
    }
  }, [totalMaxMint]);

  const handleRiskBufferChange = useCallback((value: DECIMAL) => {
    setTargetHF(value);
  }, []);

  // Recalculate exceedsMaxMint whenever totalMaxMint or mintAmountInput changes
  // This ensures the red highlight disappears when HF is adjusted to accommodate the entered amount
  useEffect(() => {
    if (!mintAmountInput || mintAmountInput === '') {
      setExceedsMaxMint(false);
      return;
    }

    const parsed = parseCommaNumber(mintAmountInput);
    const inputAmount: DECIMAL = parseFloat(parsed);

    if (totalMaxMint > 0n) {
      const maxMint = formatUnits(totalMaxMint, 18);
      const maxMintNum: DECIMAL = parseFloat(maxMint);
      setExceedsMaxMint(!isNaN(inputAmount) && inputAmount > maxMintNum);
    } else {
      setExceedsMaxMint(false);
    }
  }, [totalMaxMint, mintAmountInput]);

  const handleMaxClick = useCallback(() => {
    if (isMaxMode) {
      setIsMaxMode(false);
      setMintAmountInput('');
    } else if (totalMaxMint > 0n) {
      const maxMint = formatUnits(totalMaxMint, 18).replace(/\.?0+$/, '');
      setMintAmountInput(formatNumberWithCommas(maxMint));
      setIsMaxMode(true);
    }
  }, [totalMaxMint, isMaxMode]);

  const handleAutoAllocateChange = useCallback((checked: boolean) => {
    // When switching to manual mode, snapshot current optimal allocations
    if (!checked && optimalAllocationsRef.current.length > 0) {
      setManualAllocations(optimalAllocationsRef.current);
    }
    setAutoAllocate(checked);
  }, []);

  // ============================================================================
  // Callbacks - Allocation Handlers
  // ============================================================================

  const handleAllocationDepositChange = useCallback((assetAddress: ADDRESS, depositAmountStr: string) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    setManualAllocations(prev => {
      const existing = prev.find(v => v.vaultConfig.assetAddress === assetAddress);
      return existing
        ? prev.map(v => v.vaultConfig.assetAddress === assetAddress 
            ? { 
                ...v, 
                allocation: { 
                  assetAddress,
                  depositAmount: BigInt(depositAmountStr),
                  mintAmount: v.allocation?.mintAmount || 0n
                } 
              }
            : v
          )
        : [...prev, {
            ...candidate,
            allocation: {
              assetAddress,
              depositAmount: BigInt(depositAmountStr),
              mintAmount: 0n,
            },
          }];
    });
  }, [vaultCandidates]);

  const handleAllocationMintChange = useCallback((assetAddress: ADDRESS, mintAmountStr: string) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    setManualAllocations(prev => {
      const existing = prev.find(v => v.vaultConfig.assetAddress === assetAddress);
      return existing
        ? prev.map(v => v.vaultConfig.assetAddress === assetAddress 
            ? { 
                ...v, 
                allocation: { 
                  assetAddress,
                  depositAmount: v.allocation?.depositAmount || 0n,
                  mintAmount: BigInt(mintAmountStr)
                } 
              }
            : v
          )
        : [...prev, {
            ...candidate,
            allocation: {
              assetAddress,
              depositAmount: 0n,
              mintAmount: BigInt(mintAmountStr),
            },
          }];
    });
  }, [vaultCandidates]);

  // Log transaction data structure (manualAllocations) whenever it changes
  useEffect(() => {
    if (autoAllocate) return; // Only log in manual mode
    
    const transactionData = manualAllocations
      .filter(v => v.allocation && (v.allocation.depositAmount > 0n || v.allocation.mintAmount > 0n))
      .map(v => {
        const decimals = v.vaultConfig.unitScale.toString().length - 1;
        const depositAmount = v.allocation!.depositAmount;
        const mintAmount = v.allocation!.mintAmount;
        const depositFormatted = depositAmount > 0n 
          ? parseFloat(formatUnits(depositAmount, decimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })
          : '0';
        const mintFormatted = mintAmount > 0n
          ? parseFloat(formatUnits(mintAmount, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 })
          : '0';
        
        return {
          symbol: v.vaultConfig.symbol,
          depositAmount: {
            raw: depositAmount.toString(),
            formatted: `${depositFormatted} ${v.vaultConfig.symbol}`,
          },
          mintAmount: {
            raw: mintAmount.toString(),
            formatted: `${mintFormatted} USD`,
          },
        };
      });
    
  }, [manualAllocations, autoAllocate]);

  // ============================================================================
  // Callbacks - Transaction Execution
  // ============================================================================

  const handleConfirmMint = useCallback(async () => {
    const effectiveMintAmount: DECIMAL = autoAllocate ? mintAmount : parseFloat(totalManualMint);
    if (effectiveMintAmount <= 0 || allocations.length === 0) return;

    setTransactionsExecuting(true);
    setProgressModalOpen(true);
    setProgressError(undefined);
    setShouldRefreshOnClose(true);
    
    try {
      // Build transactions: deposits first, then mints
      const transactions: Array<{ type: 'deposit' | 'mint'; asset: ADDRESS; amount: string; symbol: string }> = [];
      
      for (const candidate of allocations) {
        if (!candidate.allocation) continue;
        if (candidate.allocation.depositAmount > 0n) {
          transactions.push({ 
            type: 'deposit', 
            asset: candidate.vaultConfig.assetAddress, 
            amount: candidate.allocation.depositAmount.toString(), 
            symbol: candidate.vaultConfig.symbol 
          });
        }
      }

      for (const candidate of allocations) {
        if (!candidate.allocation) continue;
        if (candidate.allocation.mintAmount > 0n) {
          transactions.push({ 
            type: 'mint', 
            asset: candidate.vaultConfig.assetAddress, 
            amount: candidate.allocation.mintAmount.toString(), 
            symbol: candidate.vaultConfig.symbol 
          });
        }
      }

      if (transactions.length === 0) {
        setTransactionsExecuting(false);
        setProgressModalOpen(false);
        return;
      }

      // Convert to display format for progress modal
      setTransactionsToSend(transactions.map(tx => {
        let displayAmount: string;
        if (tx.type === 'deposit') {
          const candidate = allocations.find(c => c.vaultConfig.assetAddress === tx.asset);
          const decimals = candidate ? candidate.vaultConfig.unitScale.toString().length - 1 : 18;
          displayAmount = formatUnits(tx.amount, decimals);
        } else {
          displayAmount = formatUnits(tx.amount, 18);
        }
        return { symbol: tx.symbol, type: tx.type, amount: displayAmount, status: 'pending' as const };
      }));

      let currentTxIndex = 0;

      // Execute deposits
      setCurrentProgressStep('depositing');
      for (const tx of transactions) {
        if (tx.type !== 'deposit') continue;

        setTransactionsToSend(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'processing' };
          return updated;
        });

        try {
          const result = await cdpService.deposit(tx.asset, tx.amount, true);
          if (result.status.toLowerCase() !== 'success') {
            throw new Error(`Deposit failed for ${tx.symbol}: ${result.status}`);
          }

          setTransactionsToSend(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'completed', hash: result.hash };
            return updated;
          });
        } catch (err) {
          setTransactionsToSend(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: err instanceof Error ? err.message : 'Deposit failed' };
            for (let i = currentTxIndex + 1; i < updated.length; i++) {
              if (updated[i].status === 'pending') {
                updated[i] = { ...updated[i], status: 'error' as const, error: 'Skipped due to prior failure' };
              }
            }
            return updated;
          });
          setProgressError(err instanceof Error ? err.message : 'Deposit failed');
          setCurrentProgressStep('error');
          throw err;
        }
        currentTxIndex++;
      }

      // Execute mints
      setCurrentProgressStep('minting');
      for (const tx of transactions) {
        if (tx.type !== 'mint') continue;

        setTransactionsToSend(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'processing' };
          return updated;
        });

        try {
          const useMintMax = mintMaxVaults.has(tx.asset);
          const result = useMintMax 
            ? await cdpService.mintMax(tx.asset)
            : await cdpService.mint(tx.asset, tx.amount, true);
            
          if (result.status.toLowerCase() !== 'success') {
            throw new Error(`Mint failed for ${tx.symbol}: ${result.status}`);
          }

          setTransactionsToSend(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'completed', hash: result.hash };
            return updated;
          });
        } catch (err) {
          setTransactionsToSend(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: err instanceof Error ? err.message : 'Mint failed' };
            for (let i = currentTxIndex + 1; i < updated.length; i++) {
              if (updated[i].status === 'pending') {
                updated[i] = { ...updated[i], status: 'error' as const, error: 'Skipped due to prior failure' };
              }
            }
            return updated;
          });
          setProgressError(err instanceof Error ? err.message : 'Mint failed');
          setCurrentProgressStep('error');
          throw err;
        }
        currentTxIndex++;
      }

      setCurrentProgressStep('complete');
    } catch (err) {
      console.error('[Mint] handleConfirmMint error:', err);
    } finally {
      setTransactionsExecuting(false);
    }
  }, [mintAmount, totalManualMint, autoAllocate, allocations, mintMaxVaults]);



  // ============================================================================
  // Render
  // ============================================================================

  const isButtonDisabled = 
    guestMode ||
    (autoAllocate ? (mintAmount <= 0 && !isMaxMode) : parseFloat(totalManualMint) <= 0) || 
    allocations.length === 0 || 
    transactionsExecuting || 
    (autoAllocate && (exceedsMaxCollateral || shouldLockInput || exceedsMaxMint)) || 
    hasLowHF || 
    exceedsBalance ||
    mintExceedsMax;

  return (
    <>
      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Mint against collateral (CDP)</h2>
          </div>

          {/* Loan Form */}
          <LoanForm
            availableLabel="Available to Mint"
            availableAmount={availableToMint}
            averageStabilityFee={displayedStabilityFee}
            showStabilityFee={hasAllocationsWithMint}
            mintAmountInput={mintAmountInput}
            onMintAmountChange={handleMintAmountChange}
            onMaxClick={handleMaxClick}
            isMaxMode={isMaxMode}
            exceedsMaxMint={exceedsMaxMint}
            targetHF={targetHF}
            onTargetHFChange={handleRiskBufferChange}
            minHF={sliderMinHF}
            currentHF={currentAverageHF}
            sliderRangeColor={sliderColor}
            inputDisabled={guestMode || !autoAllocate}
            sliderDisabled={guestMode || !autoAllocate}
            averageVaultHealth={projectedVaultHealth}
            showButton={false}
            actionButtonLabel="Confirm Mint"
            onConfirm={handleConfirmMint}
            isProcessing={transactionsExecuting}
            buttonDisabled={isButtonDisabled}
          />

          {/* Auto Allocate Toggle */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="auto-supply"
              checked={autoAllocate}
              onCheckedChange={(checked) => handleAutoAllocateChange(checked === true)}
              disabled={guestMode}
            />
            <Label htmlFor="auto-supply" className={`text-sm ${guestMode ? 'text-muted-foreground' : 'cursor-pointer'}`}>
              Automatically allocate across vaults
            </Label>
          </div>

          {/* Warning Messages - only for logged-in users */}
          {!guestMode && (shouldLockInput && autoAllocate ? (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                Zero USDST can be minted with your current asset balances and selected Risk value. Try moving the Risk Slider to the right to increase headroom.
              </p>
            </div>
          ) : exceedsMaxCollateral && autoAllocate ? (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                The requested mint amount exceeds your maximum borrowing capacity ({availableToMint} USDST). Try decreasing the mint amount or moving the Risk Slider to the right.
              </p>
            </div>
          ) : allocations.length === 0 && parseFloat(availableToMint.replace(/,/g, '')) <= 0 && autoAllocate ? (
            <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                {debtFloorHit ? 'Debt floor prevents allocation' : totalHeadroom <= 0n ? 'Vaults at capacity for current risk value' : 'No suitable vaults found'}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300">
                {debtFloorHit
                  ? 'Each vault requires a minimum debt amount. Try increasing your mint amount or use a different vault.'
                  : totalHeadroom <= 0n
                  ? 'Your vaults have reached their borrowing limit at the current risk value. Try moving the Risk Slider to the right to allow more borrowing.'
                  : 'No vaults are available for minting at this time.'}
              </p>
            </div>
          ) : null)}

          {/* Debt Constraint Warning - only for logged-in users */}
          {!guestMode && (debtFloorHit || debtCeilingHit) && (
            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                ⚠️ One or more vaults have hit a debt {debtFloorHit && debtCeilingHit ? 'floor/ceiling' : debtFloorHit ? 'floor' : 'ceiling'}. Effective mint amount may be lower than requested.
              </p>
            </div>
          )}

          {/* Confirm Button / Sign In Button */}
          {guestMode ? (
            <Button
              onClick={() => {
                const theme = localStorage.getItem('theme') || 'light';
                window.location.href = `/login?theme=${theme}`;
              }}
              className="w-full"
            >
              Sign in to mint USDST
            </Button>
          ) : (
            <Button
              disabled={isButtonDisabled}
              onClick={handleConfirmMint}
              className="w-full"
            >
              {transactionsExecuting ? 'Processing...' : 'Confirm Mint'}
            </Button>
          )}

          {/* Vault Breakdown - only for logged-in users */}
          {!guestMode && (!autoAllocate || !(allocations.length === 0 && parseFloat(availableToMint.replace(/,/g, '')) <= 0)) && (
            <VaultBreakdown
              vaultCandidates={mergedVaultCandidates}
              showMintAmounts={true}
              autoAllocate={autoAllocate}
              isMaxMode={isMaxMode}
              onDepositAmountChange={handleAllocationDepositChange}
              onMintAmountChange={handleAllocationMintChange}
              targetHF={targetHF}
              minHF={sliderMinHF}
              onHFValidationChange={setHasLowHF}
              onBalanceExceededChange={setExceedsBalance}
              onMintExceedsMaxChange={setMintExceedsMax}
              onTotalManualMintChange={setTotalManualMint}
              onMintMaxVaultsChange={setMintMaxVaults}
              exceedsBalance={exceedsBalance}
              hasLowHF={hasLowHF}
              projectedVaultHealth={projectedVaultHealth}
            />
          )}

          {/* Transaction Fee - only for logged-in users */}
          {!guestMode && (
            <div className="text-sm text-muted-foreground">
              Transaction Fee: {formatUSD(totalFees, 2)} USDST ({Math.round(totalFees * 100)} vouchers)
            </div>
          )}

          {/* Rewards Display */}
          {userRewards && cdpActivity && (
            <RewardsWidget
              key={mintAmount}
              userRewards={userRewards}
              activityName={cdpActivity.activity.name}
              inputAmount={mintAmount > 0 ? mintAmount.toString() : undefined}
              actionLabel="Mint"
            />
          )}
        </CardContent>
      </Card>

      <MintProgressModal
        open={progressModalOpen}
        currentStep={currentProgressStep}
        transactions={transactionsToSend}
        error={progressError}
        onClose={() => {
          setProgressModalOpen(false);
          setCurrentProgressStep('depositing');
          setTransactionsToSend([]);
          setProgressError(undefined);
          
          if (shouldRefreshOnClose) {
            setShouldRefreshOnClose(false);
            navigate(0);
          }
        }}
      />
    </>
  );
};

export default Mint;
