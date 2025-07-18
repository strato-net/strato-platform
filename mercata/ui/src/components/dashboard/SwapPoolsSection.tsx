import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BanknoteIcon, CircleArrowDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { formatUnits, parseUnits } from 'ethers';
import { useSwapContext } from '@/context/SwapContext';
import { usdstAddress, DEPOSIT_FEE } from "@/lib/contants";
import { LiquidityPool } from '@/interface';
import { safeParseUnits } from '@/utils/numberUtils';
import DepositLiquidityModal from './DepositLiquidityModal';
import WithdrawLiquidityModal from './WithdrawLiquidityModal';


const SwapPoolsSection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<LiquidityPool | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
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

  // Remove form hook as it's no longer needed

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
  };

  const handleCloseDepositModal = () => {
    setIsDepositModalOpen(false);
    setSelectedPool(null);
  };

  const handleDeposit = async (token1Amount: string, token2Amount: string) => {
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

  const handleWithdraw = async (percent: string) => {
    if (!selectedPool || operationInProgressRef.current) return;

    try {
      operationInProgressRef.current = true;
      setWithdrawLoading(true);
      
      const value = BigInt(selectedPool.lpToken.balances?.[0]?.balance || "0");
      const percentNum = percent ? parseFloat(percent) : 0;
      const percentScaled = BigInt(Math.round(percentNum * 100));
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
                      {pool.tokenB?.images?.[0] ? (
                        <img
                          src={pool.tokenB.images[0].value}
                          alt={pool._name?.split('/')[0]}
                          className="w-8 h-8 rounded-full object-cover z-10 border-2 border-white"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool._name?.slice(0, 2)}
                        </div>
                      )}
                      {pool.tokenA?.images?.[0] ? (
                        <img
                          src={pool.tokenA.images[0].value}
                          alt={pool._name?.split('/')[1]}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool._name?.split('/')[1].slice(0, 2)}
                        </div>
                      )}
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
      <DepositLiquidityModal
        isOpen={isDepositModalOpen}
        onOpenChange={setIsDepositModalOpen}
        selectedPool={selectedPool}
        onDeposit={handleDeposit}
        tokenABalance={tokenABalance}
        tokenBBalance={tokenBBalance}
        usdstBalance={usdstBalance}
        balanceLoading={balanceLoading}
        depositLoading={depositLoading}
        usdstAddress={usdstAddress}
      />

      {/* Withdraw Modal */}
      <WithdrawLiquidityModal
        isOpen={isWithdrawModalOpen}
        onOpenChange={setIsWithdrawModalOpen}
        selectedPool={selectedPool}
        onWithdraw={handleWithdraw}
        usdstBalance={usdstBalance}
        balanceLoading={balanceLoading}
        withdrawLoading={withdrawLoading}
      />
    </div>
  );
};

export default SwapPoolsSection;
