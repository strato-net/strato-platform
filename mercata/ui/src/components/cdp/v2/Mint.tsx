import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useOracleContext } from '@/context/OracleContext';
import { cdpService } from '@/services/cdpService';
import { getOptimalAllocations, computeTotalHeadroom, getMaxAllocations, type VaultCandidate } from '@/services/MintService';
import type { PlanItem } from '@/services/cdpTypes';
import { formatUnits, parseUnits } from 'ethers';
import { formatNumberWithCommas, parseCommaNumber } from '@/utils/numberUtils';
import { useToast } from '@/hooks/use-toast';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { CompactRewardsDisplay } from '@/components/rewards/CompactRewardsDisplay';
import MintProgressModal, { type MintStep } from '../MintProgressModal';
import LoanForm from './LoanForm';
import Allocation from './Allocation';
import {
  SAFETY_BUFFER_BPS,
  BPS_SCALE,
  DEPOSIT_FEE_USDST,
  MINT_FEE_USDST,
  formatUSD,
  parseInputToWei,
  convertAllocationsToPlanItems,
  calculateTransactionCount,
  calculateTotalFees,
  calculateTotalMaxMintWei,
  calculateAvailableToMint,
  calculateWeightedAverageAPR,
  calculateSliderMinHFFromPercentages,
  calculatePositionMetrics,
} from '@/utils/loanUtils';
import { formatWeiToDecimalHP } from '@/utils/numberUtils';

interface MintProps {
  onSuccess?: () => void;
  refreshTrigger?: number;
}

const Mint: React.FC<MintProps> = ({ onSuccess, refreshTrigger }) => {
  const [mintAmountInput, setMintAmountInput] = useState('');
  const [riskBuffer, setRiskBuffer] = useState(2.1);
  const [isMaxMode, setIsMaxMode] = useState(false);
  const [vaultCandidates, setVaultCandidates] = useState<VaultCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [currentProgressStep, setCurrentProgressStep] = useState<MintStep>('depositing');
  const [progressTransactions, setProgressTransactions] = useState<Array<{
    symbol: string;
    type: 'deposit' | 'mint';
    amount: string;
    status: 'pending' | 'processing' | 'completed' | 'error';
    hash?: string;
    error?: string;
  }>>([]);
  const [progressError, setProgressError] = useState<string | undefined>();
  const [autoSupplyCollateral, setAutoSupplyCollateral] = useState(true);
  const [currentPositionHF, setCurrentPositionHF] = useState<number | undefined>(undefined);

  const { fetchAllPrices } = useOracleContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  // Calculate slider minHF only once on mount
  // minHF = max(minCR) / max(liquidationRatio) across all vaults
  // Currently using hardcoded values - TODO: calculate from actual vault data
  const sliderMinHF = useMemo(() => {
    console.log('[Mint] Calculating slider minHF on component mount');
    return calculateSliderMinHFFromPercentages([150], [133]);
  }, []); // Empty deps = only runs once on mount

  // Calculate slider color based on health factor (riskBuffer)
  const sliderColor = useMemo(() => {
    if (riskBuffer >= 2.5) return '#10b981'; // green
    if (riskBuffer >= 2.0) return '#3b82f6'; // blue
    if (riskBuffer >= 1.5) return '#eab308'; // yellow
    return '#ef4444'; // red
  }, [riskBuffer]);

  const fetchVaultCandidates = useCallback(async () => {
    try {
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      setVaultCandidates([...existingVaults, ...potentialVaults]);
    } catch {
      setVaultCandidates([]);
    }
  }, []);

  useEffect(() => {
    fetchVaultCandidates();
  }, [fetchVaultCandidates, refreshTrigger]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchAllPrices()
      .catch(() => setError('Could not load CDP data'))
      .finally(() => setLoading(false));
  }, [fetchAllPrices, refreshTrigger]);

  // Fetch current position and calculate health factor (same as DebtPosition.tsx)
  useEffect(() => {
    const fetchCurrentPosition = async () => {
      try {
        const positions = await cdpService.getVaults();
        const { overallHealthFactor } = calculatePositionMetrics(
          positions.map(pos => ({
            debtAmount: pos.debtAmount,
            collateralValueUSD: pos.collateralValueUSD,
            stabilityFeeRate: pos.stabilityFeeRate,
            liquidationRatio: pos.liquidationRatio,
            collateralizationRatio: pos.collateralizationRatio,
          })),
          formatWeiToDecimalHP
        );
        setCurrentPositionHF(overallHealthFactor === Infinity ? undefined : overallHealthFactor);
      } catch {
        setCurrentPositionHF(undefined);
      }
    };
    fetchCurrentPosition();
  }, [refreshTrigger]);

  const mintAmount = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || '').replace(/,/g, ''));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [mintAmountInput]);

  const mintAmountWei = useMemo(() => parseInputToWei(mintAmountInput), [mintAmountInput]);

  const maxAllocations = useMemo<PlanItem[]>(() => {
    if (vaultCandidates.length === 0) return [];
    try {
      const result = getMaxAllocations(vaultCandidates, riskBuffer);
      return convertAllocationsToPlanItems(result, vaultCandidates);
    } catch {
      return [];
    }
  }, [riskBuffer, vaultCandidates]);

  // Store allocations - updated by auto-supply or manual edits
  const [customAllocations, setCustomAllocations] = useState<PlanItem[]>([]);
  const [debtFloorHit, setDebtFloorHit] = useState(false);
  const [debtCeilingHit, setDebtCeilingHit] = useState(false);
  const [hasLowHF, setHasLowHF] = useState(false);
  const [exceedsBalance, setExceedsBalance] = useState(false);
  const [totalManualMint, setTotalManualMint] = useState('0');
  const [averageVaultHealth, setAverageVaultHealth] = useState<string | null>(null);
  const [exceedsMaxMint, setExceedsMaxMint] = useState(false);

  // Compute fresh allocations when auto-supply is enabled
  useEffect(() => {
    if (!autoSupplyCollateral) {
      // Manual mode: keep existing allocations (don't clear) so users can see and adjust them
      return;
    }
    
    if (isMaxMode) {
      setCustomAllocations(maxAllocations);
      setDebtFloorHit(false);
      setDebtCeilingHit(false);
      return;
    }
    
    if (mintAmountWei <= 0n || vaultCandidates.length === 0) {
      setCustomAllocations([]);
      setDebtFloorHit(false);
      setDebtCeilingHit(false);
      return;
    }
    
    try {
      const result = getOptimalAllocations(mintAmountWei, riskBuffer, vaultCandidates);
      const allocations = convertAllocationsToPlanItems(result.allocations, vaultCandidates);
      setCustomAllocations(allocations);
      setDebtFloorHit(result.debtFloorHit);
      setDebtCeilingHit(result.debtCeilingHit);
    } catch {
      setCustomAllocations([]);
      setDebtFloorHit(false);
      setDebtCeilingHit(false);
    }
  }, [mintAmountWei, riskBuffer, vaultCandidates, isMaxMode, maxAllocations, autoSupplyCollateral]);

  // Use customAllocations as the source of truth
  const optimalAllocations = customAllocations;

  const totalHeadroomWei = useMemo(() => 
    vaultCandidates.length === 0 ? 0n : computeTotalHeadroom(riskBuffer, vaultCandidates),
  [riskBuffer, vaultCandidates]);

  const totalMaxMintWei = useMemo(() => 
    calculateTotalMaxMintWei(maxAllocations),
  [maxAllocations]);

  const availableToMint = useMemo(() => 
    calculateAvailableToMint(totalMaxMintWei),
  [totalMaxMintWei]);

  // Edge case flags
  const shouldLockInput = maxAllocations.length === 0 || totalMaxMintWei === 0n;
  const exceedsMaxCollateral = !isMaxMode && mintAmountWei > 0n && mintAmountWei > totalHeadroomWei;

  // When MAX mode is enabled and slider changes, update the mint amount input
  useEffect(() => {
    if (isMaxMode && totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, '');
      setMintAmountInput(formatNumberWithCommas(maxMint));
    }
  }, [isMaxMode, totalMaxMintWei, riskBuffer]);

  const weightedAverageAPR = useMemo(() => 
    calculateWeightedAverageAPR(optimalAllocations),
  [optimalAllocations]);

  const transactionCount = useMemo(() => 
    calculateTransactionCount(optimalAllocations),
  [optimalAllocations]);

  const totalFees = useMemo(() => 
    calculateTotalFees(optimalAllocations),
  [optimalAllocations]);

  const handleMaxClick = useCallback(() => {
    if (isMaxMode) {
      setIsMaxMode(false);
      setMintAmountInput('');
    } else if (totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, '');
      setMintAmountInput(formatNumberWithCommas(maxMint));
      setIsMaxMode(true);
    }
  }, [totalMaxMintWei, isMaxMode]);

  const handleQuickMint = useCallback(async () => {
    if (mintAmount <= 0 || optimalAllocations.length === 0) return;

    setTransactionLoading(true);
    setProgressModalOpen(true);
    setProgressError(undefined);
    
    try {
      // Use the exact displayed allocations - no recalculation to avoid precision drift
      // Build transactions in execution order: all deposits first, then all mints
      const transactions: Array<{ type: 'deposit' | 'mint'; asset: string; amount: string; symbol: string }> = [];
      
      // First, add all deposits
      for (const allocation of optimalAllocations) {
        const depositNum = parseFloat(allocation.depositAmount || '0');
        const hasDeposit = allocation.depositAmount && depositNum > 0;
        
        if (hasDeposit) {
          transactions.push({ type: 'deposit', asset: allocation.assetAddress, amount: allocation.depositAmount, symbol: allocation.symbol });
        }
      }
      
      // Then, add all mints
      for (const allocation of optimalAllocations) {
        const mintNum = parseFloat(allocation.mintAmount || '0');
        const hasMint = allocation.mintAmount && mintNum > 0;
        
        if (hasMint) {
          transactions.push({ type: 'mint', asset: allocation.assetAddress, amount: allocation.mintAmount, symbol: allocation.symbol });
        }
      }

      setProgressTransactions(transactions.map(tx => ({
        symbol: tx.symbol,
        type: tx.type,
        amount: tx.amount,
        status: 'pending' as const,
      })));

      let allSuccessful = true;
      let currentTxIndex = 0;

      setCurrentProgressStep('depositing');
      for (const tx of transactions) {
        if (tx.type !== 'deposit') continue;

        setProgressTransactions(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'processing' };
          return updated;
        });

        try {
          const result = await cdpService.deposit(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== 'success') {
            allSuccessful = false;
            setProgressTransactions(prev => {
              const updated = [...prev];
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: `Deposit failed: ${result.status}` };
              // Mark all remaining pending transactions as cancelled
              for (let i = currentTxIndex + 1; i < updated.length; i++) {
                if (updated[i].status === 'pending') {
                  updated[i] = { ...updated[i], status: 'error' as const, error: 'Skipped due to prior failure' };
                }
              }
              return updated;
            });
            throw new Error(`Deposit failed for ${tx.symbol}: ${result.status}`);
          }

          setProgressTransactions(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'completed', hash: result.hash };
            return updated;
          });
        } catch (err) {
          // If transaction was processing and failed, mark it as error and cancel remaining
          setProgressTransactions(prev => {
            const updated = [...prev];
            if (updated[currentTxIndex]?.status === 'processing') {
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: err instanceof Error ? err.message : 'Deposit transaction failed' };
            }
            // Mark all remaining pending transactions as cancelled
            for (let i = currentTxIndex + 1; i < updated.length; i++) {
              if (updated[i].status === 'pending') {
                updated[i] = { ...updated[i], status: 'error' as const, error: 'Skipped due to prior failure' };
              }
            }
            return updated;
          });
          setProgressError(err instanceof Error ? err.message : 'Deposit transaction failed');
          setCurrentProgressStep('error');
          throw err;
        }
        currentTxIndex++;
      }

      setCurrentProgressStep('minting');
      for (const tx of transactions) {
        if (tx.type !== 'mint') continue;

        setProgressTransactions(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'processing' };
          return updated;
        });

        try {
          // Execute with exact planned amount (no safety check adjustment)
          // The plan is already calculated with proper constraints
          const result = await cdpService.mint(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== 'success') {
            allSuccessful = false;
            setProgressTransactions(prev => {
              const updated = [...prev];
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: `Mint failed: ${result.status}` };
              // Mark all remaining pending transactions as cancelled
              for (let i = currentTxIndex + 1; i < updated.length; i++) {
                if (updated[i].status === 'pending') {
                  updated[i] = { ...updated[i], status: 'error' as const, error: 'Skipped due to prior failure' };
                }
              }
              return updated;
            });
            throw new Error(`Mint failed for ${tx.symbol}: ${result.status}`);
          }

          setProgressTransactions(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'completed', hash: result.hash };
            return updated;
          });
        } catch (err) {
          // If transaction was processing and failed, mark it as error and cancel remaining
          setProgressTransactions(prev => {
            const updated = [...prev];
            if (updated[currentTxIndex]?.status === 'processing') {
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: err instanceof Error ? err.message : 'Mint transaction failed' };
            }
            // Mark all remaining pending transactions as cancelled
            for (let i = currentTxIndex + 1; i < updated.length; i++) {
              if (updated[i].status === 'pending') {
                updated[i] = { ...updated[i], status: 'error' as const, error: 'Skipped due to prior failure' };
              }
            }
            return updated;
          });
          setProgressError(err instanceof Error ? err.message : 'Mint transaction failed');
          setCurrentProgressStep('error');
          throw err;
        }
        currentTxIndex++;
      }

      if (allSuccessful) setCurrentProgressStep('complete');
      await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
      setMintAmountInput('');
      setIsMaxMode(false);
      if (onSuccess) onSuccess();
    } catch {
      try { await Promise.all([fetchVaultCandidates(), fetchAllPrices()]); } catch { /* silent refetch */ }
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, optimalAllocations, fetchVaultCandidates, fetchAllPrices, onSuccess]);

  // Find CDP activity for rewards display
  const cdpActivity = useMemo(() => {
    if (!userRewards) return null;
    return userRewards.activities.find((a) => {
      const name = a.activity.name.toLowerCase();
      return name.includes('cdp') || name.includes('mint') || (name.includes('borrow') && !name.includes('lending'));
    });
  }, [userRewards]);

  const handleMintAmountChange = useCallback((formattedValue: string) => {
    if (formattedValue === '') {
      setMintAmountInput('');
      setIsMaxMode(false);
      setExceedsMaxMint(false);
      return;
    }
    
    // Store the formatted value (with commas)
    setMintAmountInput(formattedValue);
    
    // Parse to get raw value for comparison
    const parsed = parseCommaNumber(formattedValue);
    const inputAmount = parseFloat(parsed);
    
    // Check if input matches or exceeds max available to mint
    if (totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18);
      const maxMintNum = parseFloat(maxMint);
      const normalizedInput = parsed.replace(/\.?0+$/, '');
      const normalizedMax = maxMint.replace(/\.?0+$/, '');
      
      // Set MAX mode if values match
      setIsMaxMode(normalizedInput === normalizedMax);
      
      // Check if input exceeds max
      setExceedsMaxMint(!isNaN(inputAmount) && inputAmount > maxMintNum);
    } else {
      setIsMaxMode(false);
      setExceedsMaxMint(false);
    }
  }, [totalMaxMintWei]);

  const handleRiskBufferChange = useCallback((value: number) => {
    setRiskBuffer(value);
  }, []);

  // Handle manual deposit amount changes from Allocation component
  const handleAllocationDepositChange = useCallback((assetAddress: string, amount: string) => {
    setCustomAllocations(prev => {
      const existing = prev.find(a => a.assetAddress === assetAddress);
      if (existing) {
        return prev.map(a => a.assetAddress === assetAddress 
          ? { ...a, depositAmount: amount }
          : a
        );
      }
      // Add new allocation if not found
      const candidate = vaultCandidates.find(c => c.assetAddress === assetAddress);
      if (!candidate) return prev;
      return [...prev, {
        assetAddress,
        symbol: candidate.symbol,
        depositAmount: amount,
        depositAmountUSD: '0',
        mintAmount: '0',
        stabilityFeeRate: 0,
        existingCollateralUSD: '0',
        userBalance: '0',
        userBalanceUSD: '0',
      }];
    });
  }, [vaultCandidates]);

  // Handle manual mint amount changes from Allocation component
  const handleAllocationMintChange = useCallback((assetAddress: string, amount: string) => {
    setCustomAllocations(prev => {
      const existing = prev.find(a => a.assetAddress === assetAddress);
      if (existing) {
        return prev.map(a => a.assetAddress === assetAddress 
          ? { ...a, mintAmount: amount }
          : a
        );
      }
      // Add new allocation if not found
      const candidate = vaultCandidates.find(c => c.assetAddress === assetAddress);
      if (!candidate) return prev;
      return [...prev, {
        assetAddress,
        symbol: candidate.symbol,
        depositAmount: '0',
        depositAmountUSD: '0',
        mintAmount: amount,
        stabilityFeeRate: 0,
        existingCollateralUSD: '0',
        userBalance: '0',
        userBalanceUSD: '0',
      }];
    });
  }, [vaultCandidates]);

  const getButtonText = () => {
    if (transactionLoading) return 'Processing...';
    if (shouldLockInput) return 'Insufficient Collateral: Move Risk Slider to the right';
    // In manual mode, check total manual mint amount; in auto mode, check mint amount input
    const effectiveMintAmount = !autoSupplyCollateral ? parseFloat(totalManualMint) : mintAmount;
    if (effectiveMintAmount <= 0 && !isMaxMode) return 'Enter mint amount';
    if (exceedsMaxCollateral) return 'Insufficient Collateral: Decrease Mint Amount or move Risk Slider to the right';
    if (optimalAllocations.length === 0 && debtFloorHit) return 'Debt Floor: Increase Mint Amount';
    if (optimalAllocations.length === 0 && totalHeadroomWei <= 0n) return 'Vaults at Capacity: Move Risk Slider to the right';
    if (optimalAllocations.length === 0) return 'No vaults available';
    if (exceedsBalance && !autoSupplyCollateral) return 'Deposit exceeds available balance';
    if (hasLowHF && !autoSupplyCollateral) return 'Health Factor below minimum: Reduce mint amounts or increase deposits';
    return 'Confirm Mint';
  };

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
            averageStabilityFee={weightedAverageAPR || 1.5}
            mintAmountInput={mintAmountInput}
            onMintAmountChange={handleMintAmountChange}
            onMaxClick={handleMaxClick}
            isMaxMode={isMaxMode}
            exceedsMaxMint={exceedsMaxMint}
            riskBuffer={riskBuffer}
            onRiskBufferChange={handleRiskBufferChange}
            minHF={sliderMinHF}
            currentHF={currentPositionHF}
            sliderRangeColor={sliderColor}
            inputDisabled={!autoSupplyCollateral}
            sliderDisabled={!autoSupplyCollateral}
            averageVaultHealth={averageVaultHealth}
            showButton={autoSupplyCollateral}
            actionButtonLabel={getButtonText()}
            onConfirm={handleQuickMint}
            isProcessing={transactionLoading}
            buttonDisabled={
              (autoSupplyCollateral ? (mintAmount <= 0 && !isMaxMode) : parseFloat(totalManualMint) <= 0) || 
              optimalAllocations.length === 0 || exceedsMaxCollateral || shouldLockInput || hasLowHF || exceedsBalance
            }
          />

          {/* Auto Supply Collateral - only show if available to mint > 0 */}
          {parseFloat(availableToMint.replace(/,/g, '')) > 0 && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="auto-supply"
                checked={autoSupplyCollateral}
                onCheckedChange={(checked) => setAutoSupplyCollateral(checked === true)}
              />
              <Label htmlFor="auto-supply" className="text-sm cursor-pointer">
                Automatically allocate across vaults
              </Label>
            </div>
          )}

          {/* Status Messages and Allocation Section */}
          {shouldLockInput ? (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                Zero USDST can be minted with your current asset balances and selected Risk value. Try moving the Risk Slider to the right to increase headroom.
              </p>
            </div>
          ) : exceedsMaxCollateral ? (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                The requested mint amount exceeds your maximum borrowing capacity ({availableToMint} USDST). Try decreasing the mint amount or moving the Risk Slider to the right.
              </p>
            </div>
          ) : optimalAllocations.length === 0 && parseFloat(availableToMint.replace(/,/g, '')) <= 0 ? (
            <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                {debtFloorHit ? 'Debt floor prevents allocation' : totalHeadroomWei <= 0n ? 'Vaults at capacity for current risk value' : 'No suitable vaults found'}
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300">
                {debtFloorHit
                  ? 'Each vault requires a minimum debt amount. Try increasing your mint amount or use a different vault.'
                  : totalHeadroomWei <= 0n
                  ? 'Your vaults have reached their borrowing limit at the current risk value. Try moving the Risk Slider to the right to allow more borrowing.'
                  : 'No vaults are available for minting at this time.'}
              </p>
            </div>
          ) : (
            <>
              {/* Allocation Section - shown when there's a valid allocation OR when auto-supply is off and available to mint > 0 */}
              <Allocation
                optimalAllocations={optimalAllocations}
                vaultCandidates={vaultCandidates}
                showMintAmounts={true}
                autoSupplyCollateral={autoSupplyCollateral}
                onDepositAmountChange={handleAllocationDepositChange}
                onMintAmountChange={handleAllocationMintChange}
                targetHF={riskBuffer}
                onHFValidationChange={setHasLowHF}
                onBalanceExceededChange={setExceedsBalance}
                onTotalManualMintChange={setTotalManualMint}
                onAverageVaultHealthChange={setAverageVaultHealth}
              />
              {/* Warning for partial allocation due to debt constraints */}
              {(debtFloorHit || debtCeilingHit) && (
                <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    ⚠️ One or more vaults have hit a debt {debtFloorHit && debtCeilingHit ? 'floor/ceiling' : debtFloorHit ? 'floor' : 'ceiling'}. Effective mint amount may be lower than requested.
                  </p>
                </div>
              )}
              {/* Warning for deposit exceeding available balance */}
              {exceedsBalance && !autoSupplyCollateral && (
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Deposit Exceeds Available Balance</p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    One or more vaults have a deposit amount that exceeds your available balance. Please reduce the deposit amounts.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Confirm Button - only shown when auto supply is unchecked */}
          {!autoSupplyCollateral && (
            <Button
              disabled={
                parseFloat(totalManualMint) <= 0 || 
                optimalAllocations.length === 0 || transactionLoading || exceedsMaxCollateral || shouldLockInput || hasLowHF || exceedsBalance
              }
              onClick={handleQuickMint}
              className="w-full"
            >
              {getButtonText()}
            </Button>
          )}

          {/* Transaction Fee */}
          <div className="text-sm text-muted-foreground">
            Transaction Fee: {formatUSD(totalFees, 2)} USDST ({Math.round(totalFees * 100)} vouchers)
          </div>

          {/* Rewards Display */}
          {userRewards && cdpActivity && (
            <CompactRewardsDisplay
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
        transactions={progressTransactions}
        error={progressError}
        onClose={() => {
          setProgressModalOpen(false);
          setCurrentProgressStep('depositing');
          setProgressTransactions([]);
          setProgressError(undefined);
        }}
      />
    </>
  );
};

export default Mint;

