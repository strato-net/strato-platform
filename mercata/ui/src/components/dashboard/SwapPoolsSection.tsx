import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BanknoteIcon, CircleArrowDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { formatUnits, parseUnits } from 'ethers';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress, DEPOSIT_FEE, WITHDRAW_FEE } from "@/lib/contants";
import { LiquidityPool } from '@/interface';
import { safeParseUnits } from '@/utils/numberUtils';

// Helper function to safely format numbers
const formatNumber = (value: string | number): string => {
  try {
    // Convert to wei (18 decimals) to handle small numbers
    const weiValue = parseUnits(value.toString(), 18);
    // Format back to human readable
    return formatUnits(weiValue, 18);
  } catch (error) {
    console.error('Error formatting number:', error);
    return '0';
  }
};

interface DepositFormValues {
  amount: string;
  token: string;
}

const SwapPoolsSection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<LiquidityPool | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [token1Amount, setToken1Amount] = useState('');
  const [token2Amount, setToken2Amount] = useState('');
  const [withdrawPercent, setWithdrawPercent] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [loading, setLoading] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [tokenABalance, setTokenABalance] = useState('');
  const [tokenBBalance, setTokenBBalance] = useState('');
  const [usdstBalance, setUsdstBalance] = useState('');
  const [balanceLoading, setBalanceLoading] = useState(false);
  const poolPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const operationInProgressRef = useRef(false);

  const { fetchPools, addLiquidity, removeLiquidity, getPoolByAddress, fetchTokenBalances, enrichPools } = useSwapContext();
  const { toast } = useToast();
  const { userAddress } = useUser();

  const form = useForm<DepositFormValues>({
    defaultValues: {
      amount: '',
      token: 'token1'
    },
  });

  useEffect(() => {
    fetchAndEnrichPools();
  }, [fetchPools]);

  useEffect(() => {
    if (selectedPool && isDepositModalOpen) {
      const pollPool = async () => {
        try {
          const updatedPool = await getPoolByAddress(selectedPool.address);
          if (updatedPool) {
            setSelectedPool(prev => ({
              ...prev,
              ...updatedPool,
              _name: prev?._name,
              _symbol: prev?._symbol
            }));
          }
        } catch (error) {
          console.error('Error polling pool:', error);
        }
      };

      pollPool();
      
      poolPollIntervalRef.current = setInterval(pollPool, 10000);

      return () => {
        if (poolPollIntervalRef.current) {
          clearInterval(poolPollIntervalRef.current);
        }
      };
    }
  }, [selectedPool?.address, isDepositModalOpen, getPoolByAddress]);

  const fetchAndEnrichPools = async () => {
    if (operationInProgressRef.current) return;
    
    try {
      setLoading(true);
      const tempPools = await fetchPools();
      const enrichedPools = enrichPools(tempPools);
      setPools(enrichedPools);
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to fetch pools",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDepositModal = async (pool: LiquidityPool) => {
    if (operationInProgressRef.current) return;
    
    setToken1Amount('');
    setToken2Amount('');
    setSelectedPool(pool);
    setIsDepositModalOpen(true);
    try {
      setBalanceLoading(true)
      const balances = await fetchTokenBalances(pool, userAddress, usdstAddress);
      setTokenABalance(balances.tokenABalance);
      setTokenBBalance(balances.tokenBBalance);
      setUsdstBalance(balances.usdstBalance);
      setBalanceLoading(false)
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch token balances",
        variant: "destructive",
      });
      setBalanceLoading(false)
    }
  };

  const handleOpenWithdrawModal = async (pool: LiquidityPool): Promise<void> => {
    if (operationInProgressRef.current) return;

    setSelectedPool(pool);
    setIsWithdrawModalOpen(true);

    try {
      setBalanceLoading(true)
      const balances = await fetchTokenBalances(pool, userAddress, usdstAddress);
      setTokenABalance(balances.tokenABalance);
      setTokenBBalance(balances.tokenBBalance);
      setUsdstBalance(balances.usdstBalance);
      setBalanceLoading(false)
    } catch (error) {
      setBalanceLoading(false)
      toast({
        title: "Error",
        description: "Failed to fetch token balances",
        variant: "destructive",
      });
    }
  };

  const handleCloseWithdrawModal = () => {
    setIsWithdrawModalOpen(false);
    setSelectedPool(null);
    setWithdrawPercent('');
  };

  const handleCloseDepositModal = () => {
    setIsDepositModalOpen(false);
    setSelectedPool(null);
    setToken1Amount('');
    setToken2Amount('');
  };

  const handleDepositSubmit = async (values: DepositFormValues) => {
    if (!selectedPool || operationInProgressRef.current) return;

    const decimals = 18;
    const token1AmountWei = safeParseUnits(token1Amount, decimals);
    const token2AmountWei = safeParseUnits(token2Amount, decimals);
    const token1Balance = BigInt(tokenABalance || "0");
    const token2Balance = BigInt(tokenBBalance || "0");

    if (token1AmountWei > token1Balance || token2AmountWei > token2Balance) {
      toast({
        title: "Error",
        description: "Insufficient balance",
        variant: "destructive",
      });
      return;
    }

    try {
      operationInProgressRef.current = true;
      setDepositLoading(true);
      
      const isInitialLiquidity = BigInt(selectedPool.lpToken._totalSupply) === BigInt(0);
      const tokenAAmount = isInitialLiquidity 
        ? safeParseUnits(token1Amount, 18)
        : safeParseUnits((parseFloat(token1Amount) * 1.02).toFixed(18), 18);
      const tokenBAmount = safeParseUnits(token2Amount, 18);

      await addLiquidity({
        poolAddress: selectedPool.address,
        maxTokenAAmount: tokenAAmount.toString(),
        tokenBAmount: tokenBAmount.toString(),
      });

      // Wait for transaction to be mined
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Refresh all data
      const [updatedPool, newPools] = await Promise.all([
        getPoolByAddress(selectedPool.address),
        fetchPools()
      ]);

      if (updatedPool) {
        // Update selected pool
        setSelectedPool(prev => ({
          ...prev,
          ...updatedPool,
          _name: prev?._name,
          _symbol: prev?._symbol
        }));

        // Update pools list
        const enrichedPools = enrichPools(newPools);
        setPools(enrichedPools);

        // Refresh balances
        setBalanceLoading(true)
        const balances = await fetchTokenBalances(updatedPool, userAddress, usdstAddress);
        setTokenABalance(balances.tokenABalance);
        setTokenBBalance(balances.tokenBBalance);
        setUsdstBalance(balances.usdstBalance);
      }

      handleCloseDepositModal();
      toast({
        title: "Success",
        description: `${selectedPool._name} deposited successfully.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    } finally {
      setBalanceLoading(false)
      setDepositLoading(false);
      operationInProgressRef.current = false;
    }
  };

  const handleWithdrawSubmit = async () => {
    if (!selectedPool || operationInProgressRef.current) return;

    try {
      operationInProgressRef.current = true;
      setWithdrawLoading(true);
      
      const value = BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0");
      const percent = parseFloat(withdrawPercent || "0");
      const percentScaled = BigInt(Math.round(percent * 100));
      const calculatedAmount = (value * percentScaled) / BigInt(10000);

      await removeLiquidity({
        poolAddress: selectedPool.address,
        lpTokenAmount: calculatedAmount.toString(),
      });

      // Wait for transaction to be mined
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Refresh all data
      const [updatedPool, newPools] = await Promise.all([
        getPoolByAddress(selectedPool.address),
        fetchPools()
      ]);

      if (updatedPool) {
        // Update selected pool
        setSelectedPool(prev => ({
          ...prev,
          ...updatedPool,
          _name: prev?._name,
          _symbol: prev?._symbol
        }));

        // Update pools list
        const enrichedPools = enrichPools(newPools);
        setPools(enrichedPools);

        // Refresh balances
        setBalanceLoading(true)
        const balances = await fetchTokenBalances(updatedPool, userAddress, usdstAddress);
        setTokenABalance(balances.tokenABalance);
        setTokenBBalance(balances.tokenBBalance);
        setUsdstBalance(balances.usdstBalance);
      }

      handleCloseWithdrawModal();
      toast({
        title: "Success",
        description: `${calculatedAmount.toString()} ${selectedPool._name} withdrawn successfully.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Something went wrong - ${error}`,
        variant: "destructive",
      });
    } finally {
      setBalanceLoading(false)
      setWithdrawLoading(false);
      operationInProgressRef.current = false;
    }
  };

  const handleMaxClick = (isFirstToken: boolean) => {
    const balance = isFirstToken ? tokenABalance : tokenBBalance;
    const token = isFirstToken ? selectedPool.tokenA : selectedPool.tokenB;
    const isUSDST = token.address.toLowerCase() === usdstAddress.toLowerCase();

    let maxBigInt = BigInt(balance || "0");

    if (isUSDST) {
      const fee = parseUnits(DEPOSIT_FEE, 18);
      if (maxBigInt > fee) {
        maxBigInt = maxBigInt - fee;
      } else {
        maxBigInt = BigInt(0);
      }
    }

    const maxVal = formatUnits(maxBigInt, 18);

    if (isFirstToken) {
      setToken1Amount(maxVal);
      handleInputChange(maxVal, 'token1');
    } else {
      setToken2Amount(maxVal);
      handleInputChange(maxVal, 'token2');
    }
  };

  const handleInputChange = (value: string, token: 'token1' | 'token2') => {
    try {
      if (token === 'token1') {
        setToken1Amount(value);
        if (
          value &&
          selectedPool?.aToBRatio &&
          BigInt(safeParseUnits(selectedPool.aToBRatio, 18)) > BigInt(0)
        ) {
          const token1Wei = safeParseUnits(value, 18);
          const ratioWei = safeParseUnits(selectedPool.aToBRatio, 18);
          const token2Wei = (token1Wei * ratioWei) / BigInt(10 ** 18);
          setToken2Amount(formatUnits(token2Wei.toString(), 18));
        }
      } else {
        setToken2Amount(value);
        if (
          value &&
          selectedPool?.bToARatio &&
          BigInt(safeParseUnits(selectedPool.bToARatio, 18)) > BigInt(0)
        ) {
          const token2Wei = safeParseUnits(value, 18);
          const ratioWei = safeParseUnits(selectedPool.bToARatio, 18);
          const token1Wei = (token2Wei * ratioWei) / BigInt(10 ** 18);
          setToken1Amount(formatUnits(token1Wei.toString(), 18));
        }
      }
    } catch (error) {
      console.error('Error handling input change:', error);
      // Only set the value if it's a valid number or empty
      if (value === '' || /^\d*\.?\d*$/.test(value)) {
        if (token === 'token1') {
          setToken1Amount(value);
        } else {
          setToken2Amount(value);
        }
      }
    }
  };

  const filteredPools = pools.filter(pool => 
    pool._name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    return () => {
      if (poolPollIntervalRef.current) {
        clearInterval(poolPollIntervalRef.current);
      }
    };
  }, []);

  return (
    <div>
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search pairs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {loading ? (
          <div className="flex justify-center items-center h-12">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
          </div>
        ) : !pools.length ? (
          <div className="flex justify-center items-center h-12">
            <div>No pools available</div>
          </div>
        ) : (
          filteredPools.map((pool, id) => (
            <Card key={id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
                  <div className="flex items-center">
                    <div className="flex items-center -space-x-2 mr-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                        style={{ backgroundColor: "red" }}
                      >
                        {pool._name?.slice(0, 2)}
                      </div>
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                        style={{ backgroundColor: "red" }}
                      >
                        {pool._name?.split('/')[1].slice(0, 2)}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-medium">{pool._name}</h3>
                      <div className="flex items-center text-xs text-gray-500 mt-1">
                        <span>Liquidity: {Number(formatUnits(pool.lpToken._totalSupply, 18)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 6 })}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end space-x-4">
                    <div className="text-left sm:text-right">
                      <div className="text-sm text-gray-500">APY</div>
                      <div className="font-medium">-</div>
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        size="sm"
                        className="bg-strato-blue hover:bg-strato-blue/90"
                        onClick={() => handleOpenDepositModal(pool)}
                      >
                        <CircleArrowDown className="mr-1 h-4 w-4" />
                        <span className="hidden sm:inline">Deposit</span>
                        <span className="sm:hidden">+</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-strato-blue text-strato-blue hover:bg-strato-blue/10"
                        onClick={() => handleOpenWithdrawModal(pool)}
                        disabled={!pool.lpToken.balances?.length}
                        title={!pool.lpToken.balances?.length ? "No stake in this pool" : "Withdraw"}
                      >
                        <BanknoteIcon className="mr-1 h-4 w-4" />
                        <span className="hidden sm:inline">Withdraw</span>
                        <span className="sm:hidden">-</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Deposit Modal */}
      <Dialog open={isDepositModalOpen} onOpenChange={setIsDepositModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deposit Liquidity</DialogTitle>
            <DialogDescription>
              Add liquidity to the {selectedPool?._name} pool.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleDepositSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              {/* First Token */}
              <div className="rounded-lg border p-2">
                <span className="text-sm text-gray-500">Amount</span>
                <div className="flex items-center gap-2">
                  <Input
                    disabled={balanceLoading}
                    placeholder="0.0"
                    className={`border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                      safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ? "text-red-500" : ""
                    }`}
                    value={token1Amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Only allow valid decimal input
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        // Handle the case where user types just "."
                        if (value === '.') {
                          handleInputChange('0.', 'token1');
                        } else {
                          handleInputChange(value, 'token1');
                        }
                      }
                    }}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool._name?.split('/')[0]?.slice(0, 2)}
                        </div>
                        <span className="font-medium">{selectedPool._name?.split('/')[0]}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className='flex items-center'>
                  <span className="text-sm text-gray-500 flex gap-1">
                    Balance: {balanceLoading ?
                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                      : formatUnits(tokenABalance || "0", 18)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-blue-500"
                    onClick={() => handleMaxClick(true)}
                    disabled={balanceLoading}
                  >
                    Max
                  </Button>
                </div>
                {safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") && (
                  <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
                )}
                {selectedPool?.tokenA.address === usdstAddress && token1Amount && 
                 safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") - parseUnits(DEPOSIT_FEE, 18) && 
                 safeParseUnits(token1Amount, 18) <= BigInt(tokenABalance || "0") && (
                  <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
                )}
                {selectedPool?.tokenA.address !== usdstAddress && 
                 selectedPool?.tokenB.address !== usdstAddress && 
                 BigInt(usdstBalance || "0") < parseUnits(DEPOSIT_FEE, 18) && (
                  <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
                )}
                {(() => {
                  // Low balance warning for token A when it's USDST
                  if (selectedPool?.tokenA.address === usdstAddress && token1Amount) {
                    const inputAmountWei = safeParseUnits(token1Amount, 18);
                    const balanceWei = BigInt(tokenABalance || "0");
                    const feeWei = parseUnits(DEPOSIT_FEE, 18);
                    const lowBalanceThreshold = parseUnits("0.10", 18);
                    const remainingBalance = balanceWei - inputAmountWei - feeWei;
                    const isLowBalanceWarning = inputAmountWei > 0n && 
                                             remainingBalance >= 0n && 
                                             remainingBalance <= lowBalanceThreshold &&
                                             inputAmountWei <= balanceWei - feeWei;
                    
                    return isLowBalanceWarning ? (
                      <p className="text-yellow-600 text-sm mt-1">
                        Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                      </p>
                    ) : null;
                  }
                  return null;
                })()}
              </div>

              {/* Second Token */}
              <div className="rounded-lg border p-3">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-500">Amount</span>
                </div>
                <div className="flex items-center">
                  <Input
                    disabled={balanceLoading}
                    placeholder="0.0"
                    className={`border-none text-xl font-medium p-0 h-auto focus-visible:ring-0 ${
                      safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") ? "text-red-500" : ""
                    }`}
                    value={token2Amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Only allow valid decimal input
                      if (value === '' || /^\d*\.?\d*$/.test(value)) {
                        // Handle the case where user types just "."
                        if (value === '.') {
                          handleInputChange('0.', 'token2');
                        } else {
                          handleInputChange(value, 'token2');
                        }
                      }
                    }}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool._name?.split('/')[1]?.slice(0, 2)}
                        </div>
                        <span className="font-medium">{selectedPool._name?.split('/')[1]}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className='flex items-center'>
                  <span className="text-sm text-gray-500 flex gap-1">
                    Balance: {balanceLoading ?
                      <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                      : formatUnits(tokenBBalance || "0", 18)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-blue-500"
                    onClick={() => handleMaxClick(false)}
                    disabled={balanceLoading}
                  >
                    Max
                  </Button>
                </div>
                {safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") && (
                  <p className="text-red-600 text-sm mt-1">Insufficient balance</p>
                )}
                {selectedPool?.tokenB.address === usdstAddress && token2Amount &&
                 safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") - parseUnits(DEPOSIT_FEE, 18) && 
                 safeParseUnits(token2Amount, 18) <= BigInt(tokenBBalance || "0") && (
                  <p className="text-yellow-600 text-sm mt-1">Insufficient balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
                )}
                {selectedPool?.tokenA.address !== usdstAddress && 
                 selectedPool?.tokenB.address !== usdstAddress && 
                 BigInt(usdstBalance || "0") < parseUnits(DEPOSIT_FEE, 18) && (
                  <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({DEPOSIT_FEE} USDST)</p>
                )}
                {(() => {
                  // Low balance warning for token B when it's USDST
                  if (selectedPool?.tokenB.address === usdstAddress && token2Amount) {
                    const inputAmountWei = safeParseUnits(token2Amount, 18);
                    const balanceWei = BigInt(tokenBBalance || "0");
                    const feeWei = parseUnits(DEPOSIT_FEE, 18);
                    const lowBalanceThreshold = parseUnits("0.10", 18);
                    const remainingBalance = balanceWei - inputAmountWei - feeWei;
                    const isLowBalanceWarning = inputAmountWei > 0n && 
                                             remainingBalance >= 0n && 
                                             remainingBalance <= lowBalanceThreshold &&
                                             inputAmountWei <= balanceWei - feeWei;
                    
                    return isLowBalanceWarning ? (
                      <p className="text-yellow-600 text-sm mt-1">
                        Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                      </p>
                    ) : null;
                  }
                  return null;
                })()}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3">
              <div className="flex justify-between items-center text-sm text-gray-500">
                <span>APY</span>
                <span className="font-medium">-</span>
              </div>
              <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                <span>Current pool ratio</span>
                <span className="font-medium">
                  {selectedPool && `1 ${selectedPool._name?.split('/')[0]} = ${formatNumber(selectedPool.aToBRatio)} ${selectedPool._name?.split('/')[1]}`}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                <span>Transaction fee</span>
                <span>{DEPOSIT_FEE} USDST</span>
              </div>
              {selectedPool && BigInt(selectedPool.lpToken._totalSupply) === BigInt(0) && (
                <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                  <span>Initial liquidity provider:</span>
                  <span>You set the initial price ratio</span>
                </div>
              )}
              {selectedPool && BigInt(selectedPool.lpToken._totalSupply) > BigInt(0) && (
                <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
                  <span>Subsequent liquidity:</span>
                  <span className="text-right">Token A amount is calculated based on current pool ratio</span>
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button 
                disabled={
                  depositLoading || 
                  !token1Amount || 
                  !token2Amount || 
                  safeParseUnits(token1Amount, 18) > BigInt(tokenABalance || "0") ||
                  safeParseUnits(token2Amount, 18) > BigInt(tokenBBalance || "0") ||
                  BigInt(usdstBalance || "0") < parseUnits("0.3", 18)
                } 
                type="submit" 
                className="w-full bg-strato-blue hover:bg-strato-blue/90"
              >
                {depositLoading ? (
                  <div className="flex justify-center items-center h-12">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  "Confirm Deposit"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Withdraw Modal */}
      <Dialog open={isWithdrawModalOpen} onOpenChange={setIsWithdrawModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Liquidity</DialogTitle>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(handleWithdrawSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="rounded-lg border p-3">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-gray-500">Percent</span>
                </div>
                <div className="flex items-center">
                  <Input
                    placeholder="0.0"
                    className="border-none text-xl font-medium p-0 pl-2 h-auto focus-visible:ring-0"
                    value={withdrawPercent}
                    onChange={(e) => {
                      const value = e.target.value;
                      const percentRegex = /^(100|[0-9]{1,2})(\.[0-9]{0,2})?$/;
                      if (value === '' || percentRegex.test(value)) {
                        setWithdrawPercent(value);
                      }
                    }}
                  />
                  <div className="flex items-center space-x-2 bg-gray-100 rounded-md px-2 py-1">
                    {selectedPool && (
                      <>
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {selectedPool._symbol?.slice(0, 2)}
                        </div>
                        <span className="font-medium">{selectedPool._symbol}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 p-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-500">{selectedPool?._name?.split('/')[0]} position</span>
                <span className="font-medium">
                  {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                    (Number(BigInt(selectedPool?.lpToken?.balances?.[0]?.balance || "0") * BigInt(selectedPool?.tokenABalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm mt-1">
                <span className="text-gray-500">{selectedPool?._name?.split('/')[1]} position</span>
                <span className="font-medium">
                  {selectedPool?.lpToken?._totalSupply === "0" ? "0" : 
                    (Number(BigInt(selectedPool?.lpToken?.balances?.[0]?.balance || "0") * BigInt(selectedPool?.tokenBBalance || "0") / BigInt(selectedPool?.lpToken?._totalSupply || "1")) / 1e18).toFixed(10)}
                </span>
              </div>
              {/* Withdraw Fee Display */}
              <div className="flex justify-between items-center text-sm mt-2 text-gray-500">
                <span>Transaction fee</span>
                <span>{WITHDRAW_FEE} USDST</span>
              </div>
              {/* Withdraw Fee Warning */}
              {!balanceLoading && BigInt(usdstBalance || "0") < parseUnits(WITHDRAW_FEE, 18) && (
                <p className="text-yellow-600 text-sm mt-1">Insufficient USDST balance for transaction fee ({WITHDRAW_FEE} USDST)</p>
              )}
              {(() => {
                // Low balance warning for withdraw
                const usdstBalanceWei = BigInt(usdstBalance || "0");
                const feeWei = parseUnits(WITHDRAW_FEE, 18);
                const lowBalanceThreshold = parseUnits("0.10", 18);
                const remainingBalance = usdstBalanceWei - feeWei;
                const isLowBalanceWarning = remainingBalance >= 0n && remainingBalance <= lowBalanceThreshold;
                
                return isLowBalanceWarning && usdstBalanceWei >= feeWei ? (
                  <p className="text-yellow-600 text-sm mt-1">
                    Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.
                  </p>
                ) : null;
              })()}
              {selectedPool && withdrawPercent && selectedPool.lpToken._totalSupply !== "0" && (
                <>
                  <div className="w-full flex justify-between">
                    <span className='text-gray-500'>
                      New {selectedPool._name?.split("/")[0]} position
                    </span>
                    <span>
                      {(Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenABalance || "0") * (BigInt(10000) - BigInt((Number(withdrawPercent) * 100 || 0))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                    </span>
                  </div>
                  <div className="w-full flex justify-between">
                    <span className='text-gray-500'>
                      New {selectedPool._name?.split("/")[1]} position
                    </span>
                    <span>
                      {(Number(BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0") * BigInt(selectedPool.tokenBBalance || "0") * (BigInt(10000) - BigInt((Number(withdrawPercent) * 100))) / (BigInt(selectedPool.lpToken._totalSupply || "1") * BigInt(10000))) / 1e18).toFixed(10)}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="pt-2">
              <Button disabled={withdrawLoading || BigInt(usdstBalance || "0") < parseUnits(WITHDRAW_FEE, 18)} type="submit" className="w-full bg-strato-blue hover:bg-strato-blue/90">
                {withdrawLoading ? (
                  <div className="flex justify-center items-center h-12">
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  "Confirm Withdraw"
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SwapPoolsSection;
