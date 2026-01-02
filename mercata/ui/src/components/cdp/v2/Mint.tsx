import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useOracleContext } from '@/context/OracleContext';
import { cdpService } from '@/services/cdpService';
import { getOptimalAllocations, computeTotalHeadroom, getMaxAllocations, type VaultCandidate } from '@/services/mintPlanService';
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
} from '@/utils/loanUtils';

interface MintProps {
  onSuccess?: () => void;
  refreshTrigger?: number;
}

const Mint: React.FC<MintProps> = ({ onSuccess, refreshTrigger }) => {
  const [mintAmountInput, setMintAmountInput] = useState('10');
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

  const mintAmount = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || '').replace(/,/g, ''));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [mintAmountInput]);

  // When auto-supply is checked and mint amount or risk buffer changes, fetch fresh allocations
  useEffect(() => {
    if (!autoSupplyCollateral) return;
    if (vaultCandidates.length === 0) return;
    
    // Fetch fresh vault candidates to get latest balances and prices
    const fetchFreshAllocations = async () => {
      try {
        await fetchAllPrices();
        const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
        setVaultCandidates([...existingVaults, ...potentialVaults]);
      } catch (error) {
        // Silently fail - allocations will use existing candidates
        console.error('Failed to fetch fresh allocations:', error);
      }
    };

    // Only fetch if we have a valid mint amount or are in max mode
    if (mintAmount > 0 || isMaxMode) {
      fetchFreshAllocations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintAmount, riskBuffer, autoSupplyCollateral, isMaxMode, fetchAllPrices]);

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

  const { optimalAllocations } = useMemo(() => {
    if (isMaxMode) return { optimalAllocations: maxAllocations };
    if (mintAmountWei <= 0n || vaultCandidates.length === 0) return { optimalAllocations: [] };
    
    try {
      const result = getOptimalAllocations(mintAmountWei, riskBuffer, vaultCandidates);
      return {
        optimalAllocations: convertAllocationsToPlanItems(result.allocations, vaultCandidates),
      };
    } catch {
      return { optimalAllocations: [] };
    }
  }, [mintAmountWei, riskBuffer, vaultCandidates, isMaxMode, maxAllocations]);

  const totalHeadroomWei = useMemo(() => 
    vaultCandidates.length === 0 ? 0n : computeTotalHeadroom(riskBuffer, vaultCandidates),
  [riskBuffer, vaultCandidates]);

  const totalMaxMintWei = useMemo(() => 
    calculateTotalMaxMintWei(maxAllocations),
  [maxAllocations]);

  const availableToMint = useMemo(() => 
    calculateAvailableToMint(totalMaxMintWei),
  [totalMaxMintWei]);

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

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    const cursorPosition = e.target.selectionStart || 0;
    
    if (rawValue === '') {
      setMintAmountInput('');
      setIsMaxMode(false);
      return;
    }
    
    const beforeCursor = rawValue.substring(0, cursorPosition);
    const beforeCursorNoCommas = parseCommaNumber(beforeCursor);
    const parsed = parseCommaNumber(rawValue);
    
    if (parsed === '' || parsed === '.' || /^\d*\.?\d*$/.test(parsed)) {
      const formatted = formatNumberWithCommas(parsed);
      setMintAmountInput(formatted);
      
      if (totalMaxMintWei > 0n) {
        const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, '');
        const normalizedInput = parsed.replace(/\.?0+$/, '');
        setIsMaxMode(normalizedInput === maxMint.replace(/\.?0+$/, ''));
      } else {
        setIsMaxMode(false);
      }
      
      setTimeout(() => {
        const input = e.target;
        if (input) {
          let unformattedPos = 0;
          let formattedPos = 0;
          while (formattedPos < formatted.length && unformattedPos < beforeCursorNoCommas.length) {
            if (formatted[formattedPos] !== ',') unformattedPos++;
            formattedPos++;
          }
          input.setSelectionRange(formattedPos, formattedPos);
        }
      }, 0);
    }
  }, [totalMaxMintWei]);

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
      await fetchAllPrices();
      const { existingVaults, potentialVaults } = await cdpService.getVaultCandidates();
      const freshCandidates = [...existingVaults, ...potentialVaults];
      
      let freshAllocations: PlanItem[];
      if (isMaxMode) {
        const maxResult = getMaxAllocations(freshCandidates, riskBuffer);
        freshAllocations = convertAllocationsToPlanItems(maxResult, freshCandidates);
      } else {
        const freshTargetMintUSD = parseUnits(mintAmount.toFixed(18), 18);
        const result = getOptimalAllocations(freshTargetMintUSD, riskBuffer, freshCandidates);
        freshAllocations = convertAllocationsToPlanItems(result.allocations, freshCandidates);
      }

      const transactions: Array<{ type: 'deposit' | 'mint'; asset: string; amount: string; symbol: string }> = [];
      for (const allocation of freshAllocations) {
        if (parseFloat(allocation.depositAmount || '0') > 0) {
          transactions.push({ type: 'deposit', asset: allocation.assetAddress, amount: allocation.depositAmount, symbol: allocation.symbol });
        }
        if (parseFloat(allocation.mintAmount || '0') > 0) {
          transactions.push({ type: 'mint', asset: allocation.assetAddress, amount: allocation.mintAmount, symbol: allocation.symbol });
        }
      }

      setProgressTransactions(transactions.map(tx => ({
        symbol: tx.symbol,
        type: tx.type,
        amount: formatUSD(parseFloat(tx.amount), tx.type === 'deposit' ? 4 : 2),
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
              return updated;
            });
            throw new Error(`Deposit failed for ${tx.symbol}: ${result.status}`);
          }

          setProgressTransactions(prev => {
            const updated = [...prev];
            updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'completed', hash: result.hash };
            return updated;
          });
          await fetchAllPrices();
        } catch (err) {
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
          const maxMintResult = await cdpService.getMaxMint(tx.asset);
          const maxMintableWei = BigInt(maxMintResult.maxAmount);
          const plannedMintWei = parseUnits(tx.amount, 18);
          const safeMaxMintableWei = (maxMintableWei * (BPS_SCALE - SAFETY_BUFFER_BPS)) / BPS_SCALE;

          if (plannedMintWei > safeMaxMintableWei) {
            if (safeMaxMintableWei <= 0n) {
              setProgressTransactions(prev => {
                const updated = [...prev];
                updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: 'Insufficient collateral after deposits' };
                return updated;
              });
              currentTxIndex++;
              continue;
            }
            tx.amount = formatUnits(safeMaxMintableWei, 18);
          }

          const result = await cdpService.mint(tx.asset, tx.amount);
          if (result.status.toLowerCase() !== 'success') {
            allSuccessful = false;
            setProgressTransactions(prev => {
              const updated = [...prev];
              updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'error', error: `Mint failed: ${result.status}` };
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
          setProgressError(err instanceof Error ? err.message : 'Mint transaction failed');
          setCurrentProgressStep('error');
          throw err;
        }
        currentTxIndex++;
      }

      if (allSuccessful) setCurrentProgressStep('complete');
      await Promise.all([fetchVaultCandidates(), fetchAllPrices()]);
      setMintAmountInput('10');
      setIsMaxMode(false);
      if (onSuccess) onSuccess();
    } catch {
      try { await Promise.all([fetchVaultCandidates(), fetchAllPrices()]); } catch { /* silent refetch */ }
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, optimalAllocations, fetchVaultCandidates, fetchAllPrices, onSuccess, riskBuffer, isMaxMode]);

  // Find CDP activity for rewards display
  const cdpActivity = useMemo(() => {
    if (!userRewards) return null;
    return userRewards.activities.find((a) => {
      const name = a.activity.name.toLowerCase();
      return name.includes('cdp') || name.includes('mint') || (name.includes('borrow') && !name.includes('lending'));
    });
  }, [userRewards]);

  const handleMintAmountChange = useCallback((value: string) => {
    setMintAmountInput(value);
  }, []);

  const handleRiskBufferChange = useCallback((value: number) => {
    setRiskBuffer(value);
  }, []);

  return (
    <>
      <style>{`
        .risk-slider-track { background-color: hsl(var(--secondary)) !important; }
        .risk-slider-range { background-color: var(--risk-slider-color, #10b981) !important; transition: background-color 0.2s ease; }
      `}</style>
      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Mint against collateral (CDP)</h2>
            <Select defaultValue="quick-mint">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="quick-mint">Quick Mint</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Loan Form */}
          <LoanForm
            availableLabel="Available to Mint"
            actionButtonLabel="Confirm Mint"
            availableAmount={availableToMint}
            averageStabilityFee={weightedAverageAPR || 1.5}
            mintAmountInput={mintAmountInput}
            onMintAmountChange={handleMintAmountChange}
            onMaxClick={handleMaxClick}
            isMaxMode={isMaxMode}
            riskBuffer={riskBuffer}
            onRiskBufferChange={handleRiskBufferChange}
            minHF={sliderMinHF}
            currentHF={undefined}
            onConfirm={handleQuickMint}
            isProcessing={transactionLoading}
            disabled={mintAmount <= 0 || optimalAllocations.length === 0}
          />

          {/* Allocation Section */}
          <Allocation
            optimalAllocations={optimalAllocations}
            vaultCandidates={vaultCandidates}
            showMintAmounts={true}
          />

          {/* Auto Supply Collateral */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="auto-supply"
              checked={autoSupplyCollateral}
              onCheckedChange={(checked) => setAutoSupplyCollateral(checked === true)}
            />
            <Label htmlFor="auto-supply" className="text-sm cursor-pointer">
              Automatically supply collateral (if needed)
            </Label>
          </div>

          {/* Transaction Fee */}
          <div className="text-sm text-muted-foreground">
            Transaction Fee: {formatUSD(totalFees, 2)} USDST ({transactionCount} {transactionCount === 1 ? 'voucher' : 'vouchers'})
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

