import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useOracleContext } from '@/context/OracleContext';
import { cdpService } from '@/services/cdpService';
import { getOptimalAllocations, computeTotalHeadroom, getMaxAllocations, getAbsoluteMaxAllocations } from '@/components/cdp/v2/MintService';
import type { VaultCandidate, Allocation } from '@/components/cdp/v2/cdpTypes';
import { formatUnits, parseUnits } from 'ethers';
import { formatNumberWithCommas, parseCommaNumber } from '@/utils/numberUtils';
import { useToast } from '@/hooks/use-toast';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
import { CompactRewardsDisplay } from '@/components/rewards/CompactRewardsDisplay';
import MintProgressModal, { type MintStep } from '../../../MintProgressModal';
import LoanForm from './LoanForm';
import VaultBreakdown from './VaultBreakdown';
import {
  SAFETY_BUFFER_BPS,
  BPS_SCALE,
  DEPOSIT_FEE_USDST,
  MINT_FEE_USDST,
  formatUSD,
  parseInputToWei,
  addAllocationsToVaultCandidates,
  calculateTransactionCount,
  calculateTotalFees,
  calculateTotalMaxMintWei,
  calculateAvailableToMint,
  calculateWeightedAverageAPR,
  calculateSliderMinHF,
  calculatePositionMetrics,
  calculateAggregateHealthFactor,
} from '@/components/cdp/v2/cdpUtils';
import { formatWeiToDecimalHP } from '@/utils/numberUtils';
import { UNITS, USD, DECIMAL, ADDRESS } from '@/components/cdp/v2/cdpTypes';

interface MintProps {
  onSuccess?: () => void;
  refreshTrigger?: number;
}

const Mint: React.FC<MintProps> = ({ onSuccess, refreshTrigger }) => {
  const [mintAmountInput, setMintAmountInput] = useState('');
  const [riskBuffer, setRiskBuffer] = useState<DECIMAL>(2.1);
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
  const [currentPositionHF, setCurrentPositionHF] = useState<DECIMAL | undefined>(undefined);
  const [shouldRefreshOnClose, setShouldRefreshOnClose] = useState(false);

  const navigate = useNavigate();
  const { fetchAllPrices } = useOracleContext();
  const { toast } = useToast();
  const { userRewards } = useRewardsUserInfo();

  // Calculate slider minHF from actual vault candidates
  // minHF = max(minCR) / max(liquidationRatio) across all vaults
  const sliderMinHF = useMemo(() => {
    return calculateSliderMinHF(vaultCandidates);
  }, [vaultCandidates]);

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
      const candidates = [...existingVaults, ...potentialVaults];
      console.log('[Mint] vaultCandidates arrived:', candidates);
      setVaultCandidates(candidates);
    } catch {
      setVaultCandidates([]);
    }
  }, []);

  useEffect(() => {
    fetchVaultCandidates();
  }, [fetchVaultCandidates, refreshTrigger]);

  useEffect(() => {
    console.log('[Mint] vaultCandidates changed:', vaultCandidates);
  }, [vaultCandidates]);

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
        setCurrentPositionHF(metrics.overallHealthFactor === Infinity ? undefined : metrics.overallHealthFactor);
      } catch {
        setCurrentPositionHF(undefined);
      }
    };
    fetchCurrentPosition();
  }, [refreshTrigger]);

  const mintAmount: USD = useMemo(() => {
    const parsed = parseFloat((mintAmountInput || '').replace(/,/g, ''));
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [mintAmountInput]);

  const mintAmountWei = useMemo(() => parseInputToWei(mintAmountInput), [mintAmountInput]);

  const maxAllocations = useMemo<VaultCandidate[]>(() => {
    if (vaultCandidates.length === 0) return [];
    try {
      // When slider is at minimum HF (rightmost), use absolute max calculation
      // which matches "Available: x" exactly
      const isAtMinHF = Math.abs(riskBuffer - sliderMinHF) < 0.01;
      const result = isAtMinHF 
        ? getAbsoluteMaxAllocations(vaultCandidates)
        : getMaxAllocations(vaultCandidates, riskBuffer);
      return addAllocationsToVaultCandidates(result, vaultCandidates);
    } catch {
      return [];
    }
  }, [riskBuffer, sliderMinHF, vaultCandidates]);

  // Store allocations - updated by auto-supply or manual edits
  // Optimal allocations computed from MintService (auto mode)
  const [optimalAllocations, setOptimalAllocations] = useState<VaultCandidate[]>([]);
  // Custom allocations from UI edits (manual mode)
  const [customAllocations, setCustomAllocations] = useState<VaultCandidate[]>([]);
  const [debtFloorHit, setDebtFloorHit] = useState(false);
  const [debtCeilingHit, setDebtCeilingHit] = useState(false);
  const [hasLowHF, setHasLowHF] = useState(false);
  const [exceedsBalance, setExceedsBalance] = useState(false);
  const [totalManualMint, setTotalManualMint] = useState('0');
  const [exceedsMaxMint, setExceedsMaxMint] = useState(false);
  const [mintMaxVaults, setMintMaxVaults] = useState<Set<ADDRESS>>(new Set()); // Vaults that should use mintMax

  // Compute optimal allocations from MintService when auto-supply is enabled
  useEffect(() => {
    if (!autoSupplyCollateral) {
      // Manual mode: keep optimal allocations as-is (don't recompute)
      return;
    }

    if (isMaxMode) {
      console.log('[Mint] optimalAllocations updated (max mode from MintService):', {
        maxAllocations: maxAllocations.map(v => ({
          assetAddress: v.vaultConfig.assetAddress,
          symbol: v.vaultConfig.symbol,
          depositAmount: v.allocation?.depositAmount?.toString(),
          mintAmount: v.allocation?.mintAmount?.toString(),
        })),
      });
      setOptimalAllocations(maxAllocations);
      setDebtFloorHit(false);
      setDebtCeilingHit(false);
      
      // In max mode, mark ALL vaults as mintMax to use on-chain mintMax() for absolute maximum
      const maxVaultAddresses = maxAllocations
        .filter(v => v.allocation && v.allocation.mintAmount > 0n)
        .map(v => v.vaultConfig.assetAddress);
      setMintMaxVaults(new Set(maxVaultAddresses));
      return;
    }
    
    // Not in max mode - clear mintMax vaults
    setMintMaxVaults(new Set());
    
    if (mintAmountWei <= 0n || vaultCandidates.length === 0) {
      console.log('[Mint] optimalAllocations cleared (no mint amount or no candidates)');
      setOptimalAllocations([]);
      setDebtFloorHit(false);
      setDebtCeilingHit(false);
      return;
    }
    
    try {
      const result = getOptimalAllocations(mintAmountWei, riskBuffer, vaultCandidates);
      const candidatesWithAllocations = addAllocationsToVaultCandidates(result.allocations, vaultCandidates);
      console.log('[Mint] optimalAllocations updated (computed from MintService):', {
        mintAmountWei: mintAmountWei.toString(),
        riskBuffer,
        allocations: candidatesWithAllocations.map(v => ({
          assetAddress: v.vaultConfig.assetAddress,
          symbol: v.vaultConfig.symbol,
          depositAmount: v.allocation?.depositAmount?.toString(),
          mintAmount: v.allocation?.mintAmount?.toString(),
        })),
      });
      setOptimalAllocations(candidatesWithAllocations);
      setDebtFloorHit(result.debtFloorHit);
      setDebtCeilingHit(result.debtCeilingHit);
    } catch {
      console.log('[Mint] optimalAllocations cleared (error computing allocations)');
      setOptimalAllocations([]);
      setDebtFloorHit(false);
      setDebtCeilingHit(false);
    }
  }, [mintAmountWei, riskBuffer, vaultCandidates, isMaxMode, maxAllocations, autoSupplyCollateral]);

  // Initialize customAllocations from optimalAllocations when switching to manual mode
  useEffect(() => {
    if (!autoSupplyCollateral && optimalAllocations.length > 0 && customAllocations.length === 0) {
      console.log('[Mint] Initializing customAllocations from optimalAllocations (switching to manual mode):', {
        optimalAllocations: optimalAllocations.map(v => ({
          assetAddress: v.vaultConfig.assetAddress,
          symbol: v.vaultConfig.symbol,
          depositAmount: v.allocation?.depositAmount?.toString(),
          mintAmount: v.allocation?.mintAmount?.toString(),
        })),
      });
      setCustomAllocations(optimalAllocations);
    }
  }, [autoSupplyCollateral, optimalAllocations, customAllocations.length]);

  // Unified allocations: use optimal when auto mode, custom when manual mode
  const allocations = autoSupplyCollateral ? optimalAllocations : customAllocations;

  // Calculate aggregate HF for projected position (current + planned deposits/mints)
  // Uses the same calculation as DebtPosition.tsx and Allocation.tsx
  const averageVaultHealth = useMemo(() => {
    if (!autoSupplyCollateral || vaultCandidates.length === 0 || allocations.length === 0) {
      return null;
    }

    // Build vault data for all vaults with debt or planned changes
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
  }, [autoSupplyCollateral, vaultCandidates, allocations]);

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
  // If available to mint becomes 0 or less, disable max mode
  useEffect(() => {
    if (isMaxMode) {
      if (totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18).replace(/\.?0+$/, '');
      setMintAmountInput(formatNumberWithCommas(maxMint));
      } else {
        // Available to mint is now 0 or less - disable max mode and clear input
        setIsMaxMode(false);
        setMintAmountInput('');
      }
    }
  }, [isMaxMode, totalMaxMintWei, riskBuffer]);

  const weightedAverageAPR = useMemo(() => 
    calculateWeightedAverageAPR(allocations),
  [allocations]);

  const transactionCount = useMemo(() => 
    calculateTransactionCount(allocations),
  [allocations]);

  const totalFees = useMemo(() => 
    calculateTotalFees(allocations),
  [allocations]);

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
    const effectiveMintAmount: DECIMAL = autoSupplyCollateral ? mintAmount : parseFloat(totalManualMint);
    if (effectiveMintAmount <= 0 || allocations.length === 0) {
      return;
    }
    setTransactionLoading(true);
    setProgressModalOpen(true);
    setProgressError(undefined);
    setShouldRefreshOnClose(true); // Mark that we should refresh when modal closes
    
    try {
      // Use the exact displayed allocations - no recalculation to avoid precision drift
      // Build transactions in execution order: all deposits first, then all mints
      const transactions: Array<{ type: 'deposit' | 'mint'; asset: ADDRESS; amount: string; symbol: string }> = [];
      
      // First, add all deposits
      for (const candidate of allocations) {
        if (!candidate.allocation) continue;
        const hasDeposit = candidate.allocation.depositAmount > 0n;

        if (hasDeposit) {
          const depositWei = candidate.allocation.depositAmount.toString();
          console.log('[Mint] 📊 DEPOSIT VALUE - Sending to backend:', {
            assetAddress: candidate.vaultConfig.assetAddress,
            symbol: candidate.vaultConfig.symbol,
            depositWei,
            depositWeiType: typeof depositWei,
            note: 'Raw wei value sent directly to backend (no decimal conversion)'
          });
          transactions.push({ type: 'deposit', asset: candidate.vaultConfig.assetAddress, amount: depositWei, symbol: candidate.vaultConfig.symbol });
        }
      }

      // Then, add all mints
      for (const candidate of allocations) {
        if (!candidate.allocation) continue;
        const hasMint = candidate.allocation.mintAmount > 0n;

        if (hasMint) {
          const mintWei = candidate.allocation.mintAmount.toString();
          console.log('[Mint] 📊 MINT VALUE - Sending to backend:', {
            assetAddress: candidate.vaultConfig.assetAddress,
            symbol: candidate.vaultConfig.symbol,
            mintWei,
            mintWeiType: typeof mintWei,
            note: 'Raw wei value sent directly to backend (no decimal conversion)'
          });
          transactions.push({ type: 'mint', asset: candidate.vaultConfig.assetAddress, amount: mintWei, symbol: candidate.vaultConfig.symbol });
        }
      }

      console.log('[Mint] Transactions built for backend (Confirm Mint clicked):', {
        effectiveMintAmount,
        autoSupplyCollateral,
        allocationSource: autoSupplyCollateral ? 'optimalAllocations (from MintService)' : 'customAllocations (from UI)',
        mintMaxVaults: Array.from(mintMaxVaults),
        transactions: transactions.map(tx => ({
          type: tx.type,
          asset: tx.asset,
          amount: tx.amount,
          symbol: tx.symbol,
          willUseMintMax: tx.type === 'mint' && mintMaxVaults.has(tx.asset),
        })),
        backendPayloads: transactions.map(tx => {
          if (tx.type === 'deposit') {
            return {
              endpoint: '/cdp/deposit',
              payload: { asset: tx.asset, amount: tx.amount },
              note: 'amount is raw wei string (no conversion needed)',
            };
          } else {
            const useMintMax = mintMaxVaults.has(tx.asset);
            return {
              endpoint: useMintMax ? '/cdp/mint-max' : '/cdp/mint',
              payload: useMintMax ? { asset: tx.asset } : { asset: tx.asset, amount: tx.amount },
              note: useMintMax ? 'uses on-chain mintMax()' : 'amount is raw wei string (no conversion needed)',
            };
          }
        }),
      });

      if (transactions.length === 0) {
        setTransactionLoading(false);
        setProgressModalOpen(false);
        return;
      }

      // Convert wei amounts to decimals for display in progress modal
      setProgressTransactions(transactions.map(tx => {
        let displayAmount: string;
        
        if (tx.type === 'deposit') {
          // Find the candidate to get decimals
          const candidate = allocations.find(c => c.vaultConfig.assetAddress === tx.asset);
          if (candidate) {
            const decimals = candidate.vaultConfig.unitScale.toString().length - 1;
            displayAmount = formatUnits(tx.amount, decimals);
          } else {
            displayAmount = tx.amount; // Fallback to wei if candidate not found
          }
        } else {
          // Mint amounts are always 18 decimals (USDST)
          displayAmount = formatUnits(tx.amount, 18);
        }
        
        return {
          symbol: tx.symbol,
          type: tx.type,
          amount: displayAmount, // Display decimal amount
          status: 'pending' as const,
        };
      }));

      let allSuccessful = true;
      let currentTxIndex = 0;

      const depositTransactions = transactions.filter(tx => tx.type === 'deposit');
      const mintTransactions = transactions.filter(tx => tx.type === 'mint');

      setCurrentProgressStep('depositing');
      for (const tx of transactions) {
        if (tx.type !== 'deposit') continue;

        setProgressTransactions(prev => {
          const updated = [...prev];
          updated[currentTxIndex] = { ...updated[currentTxIndex], status: 'processing' };
          return updated;
        });

        try {
          console.log('[Mint] Sending deposit to backend:', {
            endpoint: '/cdp/deposit',
            payload: { asset: tx.asset, amount: tx.amount, isWei: true },
            symbol: tx.symbol,
            amountType: typeof tx.amount,
            note: 'amount is raw wei string (sent directly to blockchain)',
          });
          const result = await cdpService.deposit(tx.asset, tx.amount, true); // true = isWei
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
          // Use mintMax for vaults marked as such (from "Available: x" click)
          // This uses the contract's on-chain calculation for max mint
          // Otherwise use exact amount for manual inputs
          const useMintMax = mintMaxVaults.has(tx.asset);
          
          if (useMintMax) {
            console.log('[Mint] Sending mintMax to backend:', {
              endpoint: '/cdp/mint-max',
              payload: { asset: tx.asset },
              symbol: tx.symbol,
              note: 'uses on-chain mintMax() contract function',
            });
          } else {
            console.log('[Mint] Sending mint to backend:', {
              endpoint: '/cdp/mint',
              payload: { asset: tx.asset, amount: tx.amount },
              symbol: tx.symbol,
              amountType: typeof tx.amount,
              note: 'amount is raw wei string (sent directly to blockchain)',
            });
          }
          
          const result = useMintMax 
            ? await cdpService.mintMax(tx.asset)
            : await cdpService.mint(tx.asset, tx.amount, true); // true = isWei
            
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

      if (allSuccessful) {
        setCurrentProgressStep('complete');
      }
    } catch (err) {
      // Errors are already captured in progressTransactions, but log unexpected errors
      console.error('[Mint] handleQuickMint unexpected error:', err);
    } finally {
      setTransactionLoading(false);
    }
  }, [mintAmount, totalManualMint, autoSupplyCollateral, allocations, mintMaxVaults]);

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
    const inputAmount: DECIMAL = parseFloat(parsed);
    
    // Check if input matches or exceeds max available to mint
    if (totalMaxMintWei > 0n) {
      const maxMint = formatUnits(totalMaxMintWei, 18);
      const maxMintNum: DECIMAL = parseFloat(maxMint);
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

  const handleRiskBufferChange = useCallback((value: DECIMAL) => {
    setRiskBuffer(value);
  }, []);

  // Handle manual deposit amount changes from VaultBreakdown component
  // Amount comes in as wei string (already in wei format from VaultBreakdown)
  const handleAllocationDepositChange = useCallback((assetAddress: ADDRESS, depositWei: string) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    setCustomAllocations(prev => {
      const existing = prev.find(v => v.vaultConfig.assetAddress === assetAddress);
      const updated = existing
        ? prev.map(v => v.vaultConfig.assetAddress === assetAddress 
            ? { 
                ...v, 
                allocation: { 
                  assetAddress,
                  depositAmount: BigInt(depositWei),
                  mintAmount: v.allocation?.mintAmount || 0n
                } 
              }
            : v
          )
        : [...prev, {
            ...candidate,
            allocation: {
              assetAddress,
              depositAmount: BigInt(depositWei),
              mintAmount: 0n,
            },
          }];
      
      console.log('[Mint] customAllocations updated (deposit change from UI):', {
        assetAddress,
        depositWei,
        symbol: candidate.vaultConfig.symbol,
        updatedAllocations: updated.map(v => ({
          assetAddress: v.vaultConfig.assetAddress,
          symbol: v.vaultConfig.symbol,
          depositAmount: v.allocation?.depositAmount?.toString(),
          mintAmount: v.allocation?.mintAmount?.toString(),
        })),
      });
      
      return updated;
    });
  }, [vaultCandidates]);

  // Handle manual mint amount changes from VaultBreakdown component
  // Amount comes in as wei string (already in wei format from VaultBreakdown)
  const handleAllocationMintChange = useCallback((assetAddress: ADDRESS, mintWei: string) => {
    const candidate = vaultCandidates.find(c => c.vaultConfig.assetAddress === assetAddress);
    if (!candidate) return;
    
    setCustomAllocations(prev => {
      const existing = prev.find(v => v.vaultConfig.assetAddress === assetAddress);
      const updated = existing
        ? prev.map(v => v.vaultConfig.assetAddress === assetAddress 
            ? { 
                ...v, 
                allocation: { 
                  assetAddress,
                  depositAmount: v.allocation?.depositAmount || 0n,
                  mintAmount: BigInt(mintWei)
                } 
              }
            : v
          )
        : [...prev, {
            ...candidate,
            allocation: {
              assetAddress,
              depositAmount: 0n,
              mintAmount: BigInt(mintWei),
            },
          }];
      
      console.log('[Mint] customAllocations updated (mint change from UI):', {
        assetAddress,
        mintWei,
        symbol: candidate.vaultConfig.symbol,
        updatedAllocations: updated.map(v => ({
          assetAddress: v.vaultConfig.assetAddress,
          symbol: v.vaultConfig.symbol,
          depositAmount: v.allocation?.depositAmount?.toString(),
          mintAmount: v.allocation?.mintAmount?.toString(),
        })),
      });
      
      return updated;
    });
  }, [vaultCandidates]);

  const getButtonText = () => {
    // Button text should always be "Confirm Mint" - warnings are shown separately above the button
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
            showButton={false}
            actionButtonLabel={getButtonText()}
            onConfirm={handleQuickMint}
            isProcessing={transactionLoading}
            buttonDisabled={
              (autoSupplyCollateral 
                ? (mintAmount <= 0 && !isMaxMode) 
                : parseFloat(totalManualMint) <= 0) || 
              allocations.length === 0 || 
              (autoSupplyCollateral && (exceedsMaxCollateral || shouldLockInput)) || 
              hasLowHF || exceedsBalance
            }
          />

          {/* Auto Supply Collateral - always shown */}
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

          {/* Warning Messages - Always shown above buttons (priority order: most critical first) */}
          {/* Hide "Insufficient Collateral" errors in custom mode - user controls allocation manually */}
          {shouldLockInput && autoSupplyCollateral ? (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                Zero USDST can be minted with your current asset balances and selected Risk value. Try moving the Risk Slider to the right to increase headroom.
              </p>
            </div>
          ) : exceedsMaxCollateral && autoSupplyCollateral ? (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-sm font-semibold text-red-800 dark:text-red-200 mb-2">Insufficient Collateral</p>
              <p className="text-xs text-red-700 dark:text-red-300">
                The requested mint amount exceeds your maximum borrowing capacity ({availableToMint} USDST). Try decreasing the mint amount or moving the Risk Slider to the right.
              </p>
            </div>
          ) : allocations.length === 0 && parseFloat(availableToMint.replace(/,/g, '')) <= 0 && autoSupplyCollateral ? (
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
          ) : null}

          {/* Warning for partial allocation due to debt constraints */}
          {(debtFloorHit || debtCeilingHit) && (
            <div className="p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-200">
                ⚠️ One or more vaults have hit a debt {debtFloorHit && debtCeilingHit ? 'floor/ceiling' : debtFloorHit ? 'floor' : 'ceiling'}. Effective mint amount may be lower than requested.
              </p>
            </div>
          )}

          {/* Confirm Button - shown in both auto and manual modes */}
          <Button
            disabled={
              (autoSupplyCollateral 
                ? (mintAmount <= 0 && !isMaxMode) 
                : parseFloat(totalManualMint) <= 0) || 
              allocations.length === 0 || 
              transactionLoading || 
              (autoSupplyCollateral && (exceedsMaxCollateral || shouldLockInput)) || 
              hasLowHF || exceedsBalance
            }
            onClick={handleQuickMint}
            className="w-full"
          >
            {transactionLoading ? 'Processing...' : getButtonText()}
          </Button>

          {/* Allocation Section - always shown when auto-supply is off (custom mode), or when there's a valid allocation in auto mode */}
          {(!autoSupplyCollateral || !(allocations.length === 0 && parseFloat(availableToMint.replace(/,/g, '')) <= 0)) && (
          <VaultBreakdown
            vaultCandidates={vaultCandidates.map(candidate => {
              // Find matching allocation and merge it into the candidate
              const allocation = allocations.find(a => 
                a.vaultConfig.assetAddress === candidate.vaultConfig.assetAddress
              );
              return allocation || candidate;
            })}
            showMintAmounts={true}
              autoSupplyCollateral={autoSupplyCollateral}
              isMaxMode={isMaxMode}
              onDepositAmountChange={handleAllocationDepositChange}
              onMintAmountChange={handleAllocationMintChange}
              targetHF={riskBuffer}
              onHFValidationChange={setHasLowHF}
              onBalanceExceededChange={setExceedsBalance}
              onTotalManualMintChange={setTotalManualMint}
              onMintMaxVaultsChange={setMintMaxVaults}
              exceedsBalance={exceedsBalance}
              hasLowHF={hasLowHF}
            />
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
          
          // Only refresh if transactions were actually executed
          if (shouldRefreshOnClose) {
            setShouldRefreshOnClose(false);
            // Use navigate(0) to reload the current route and refresh all components
            navigate(0);
          }
        }}
      />
    </>
  );
};

export default Mint;

