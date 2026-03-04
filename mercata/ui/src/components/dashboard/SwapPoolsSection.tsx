import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CircleArrowDown, CircleArrowUp, Search, LineChart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useUser } from '@/context/UserContext';
import { useTokenContext } from '@/context/TokenContext';
import { formatBalance } from '@/utils/numberUtils';
import { useSwapContext } from '@/context/SwapContext';
import { Pool } from '@/interface';
import { rewardsEnabled } from '@/lib/constants';
import LiquidityDepositModal from './LiquidityDepositModal';
import LiquidityWithdrawModal from './LiquidityWithdrawModal';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

const SwapPoolsSection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const poolPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const operationInProgressRef = useRef(false);

  const { fetchPools, getPoolByAddress } = useSwapContext();
  const { fetchUsdstBalance, usdstBalance, voucherBalance } = useTokenContext();
  const { isLoggedIn } = useUser();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  useEffect(() => {
    fetchAndEnrichPools();
  }, [fetchPools]);

  useEffect(() => {
    // Only fetch user balance when logged in
    if (isLoggedIn) {
      fetchUsdstBalance();
    }
  }, [fetchUsdstBalance, isLoggedIn]);

  useEffect(() => {
    if (selectedPool && isDepositModalOpen) {
      const pollPool = async () => {
        try {
          const updatedPool = await getPoolByAddress(selectedPool.address);
          if (updatedPool) {
            setSelectedPool(updatedPool);
          }
          await fetchUsdstBalance();
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
  }, [selectedPool?.address, isDepositModalOpen, getPoolByAddress, fetchUsdstBalance]);

  const fetchAndEnrichPools = async () => {
    if (operationInProgressRef.current) return;
    
    try {
      setLoading(true);
      const tempPools = await fetchPools();
      setPools(tempPools);
    } catch (err) {
      console.error("Failed to fetch pools:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDepositModal = async (pool: Pool) => {
    if (operationInProgressRef.current) return;
    
    setSelectedPool(pool);
    setIsDepositModalOpen(true);
  };

  const handleOpenWithdrawModal = async (pool: Pool): Promise<void> => {
    if (operationInProgressRef.current) return;

    setSelectedPool(pool);
    setIsWithdrawModalOpen(true);
  };

  const handleCloseWithdrawModal = () => {
    setIsWithdrawModalOpen(false);
    setSelectedPool(null);
  };

  const handleCloseDepositModal = () => {
    setIsDepositModalOpen(false);
    setSelectedPool(null);
  };

  const handleDepositSuccess = async () => {
    // Refresh all data after successful deposit
    await fetchAndEnrichPools();
    await fetchUsdstBalance();
  };

  const handleWithdrawSuccess = async () => {
    // Refresh all data after successful withdrawal
    await fetchAndEnrichPools();
    await fetchUsdstBalance();
  };


  const filteredPools = pools.filter(pool => 
    !pool.isDisabled && pool.poolName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatYourLiquidityValue = (pool: Pool): string => {
    const totalBalance = BigInt(pool.lpToken.totalBalance || "0");
    const price = BigInt(pool.lpToken.price || "0");
    if (price === 0n || totalBalance === 0n) return "$0.00";
    const valueInWei = (totalBalance * price) / BigInt(10**18);
    return formatBalance(valueInWei, undefined, 18, 2, 2, true);
  };

  useEffect(() => {
    return () => {
      if (poolPollIntervalRef.current) {
        clearInterval(poolPollIntervalRef.current);
      }
    };
  }, []);

  const navigate = useNavigate();

  return (
    <div>
      {/* Trading Desk Panel */}
      <div className="mb-4 md:mb-6">
        <div className="bg-card shadow-sm rounded-xl p-4 md:p-6 border border-border">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 md:p-3 bg-blue-500 rounded-lg shrink-0">
                <LineChart className="text-white" size={20} />
              </div>
              <div>
                <h3 className="text-base md:text-lg font-semibold">Trading Desk</h3>
                <p className="text-xs md:text-sm text-muted-foreground">
                  Track multiple tokens and pools with advanced charting and arbitrage tools
                </p>
              </div>
            </div>
            <Button
              onClick={() => navigate("/dashboard/trading-desk")}
              className="w-full md:w-auto flex items-center justify-center gap-2"
            >
              <LineChart className="h-4 w-4" />
              Open Trading Desk
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0 gap-4">
                  <div className="flex items-center">
                    <div className="flex items-center -space-x-2 mr-3">
                      {pool.tokenA?.images?.[0]?.value ? (
                        <img
                          src={pool.tokenA.images[0].value}
                          alt={pool.tokenA._name || pool.poolName?.split('/')[0]}
                          className="w-8 h-8 rounded-full z-10 border-2 border-white object-cover"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool.poolName?.slice(0, 2)}
                        </div>
                      )}
                      {pool.tokenB?.images?.[0]?.value ? (
                        <img
                          src={pool.tokenB.images[0].value}
                          alt={pool.tokenB._name || pool.poolName?.split('/')[1]}
                          className="w-8 h-8 rounded-full border-2 border-white object-cover"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool.poolName?.split('/')[1].slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-medium">{pool.poolName}</h3>
                      <div className="flex items-center text-xs text-muted-foreground mt-1">
                        <span>TVL: {formatBalance(pool.totalLiquidityUSD, undefined, 18, 0, 0, true)}</span>
                      </div>
                      {/* User-specific data - only show when logged in */}
                      {isLoggedIn && (
                        <>
                          <div className="flex items-center text-xs text-muted-foreground mt-1">
                            <span>Your Liquidity: {formatYourLiquidityValue(pool)}</span>
                          </div>
                          {rewardsEnabled && pool.lpToken.stakedBalance !== undefined && (
                            <>
                              <div className="flex items-center text-xs text-muted-foreground mt-1 ml-2">
                                <span>• Staked: {formatBalance(pool.lpToken.stakedBalance || "0", undefined, 18, 1, 6)} {pool.lpToken._symbol}</span>
                              </div>
                              <div className="flex items-center text-xs text-muted-foreground mt-1 ml-2">
                                <span>• Unstaked: {formatBalance(pool.lpToken.balance || "0", undefined, 18, 1, 6)} {pool.lpToken._symbol}</span>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {pool.isPaused && (
                    <div className="flex flex-1 items-center justify-center">
                      <span className="text-xs text-muted-foreground">Pool is paused by admin at this time.</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between sm:justify-end space-x-4">
                    <div className="text-left sm:text-right">
                      <div className="text-sm text-muted-foreground">APY</div>
                      <div className="font-medium">{pool.apy ? `${pool.apy}%` : "N/A"}</div>
                    </div>
               
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex space-x-2">
                        <Button
                        size="sm"
                        className="bg-strato-blue hover:bg-strato-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => handleOpenDepositModal(pool)}
                        disabled={!isLoggedIn || pool.isPaused}
                      >
                        <CircleArrowDown className="mr-1 h-4 w-4" />
                        <span className="hidden sm:inline">Deposit</span>
                        <span className="sm:hidden">+</span>
                        </Button>
                        <Button
                        size="sm"
                        variant="outline"
                        className="border-strato-blue text-strato-blue hover:bg-strato-blue/10 dark:border-blue-400 dark:text-blue-400 dark:hover:bg-blue-400/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-auto disabled:border-muted disabled:text-muted-foreground disabled:hover:bg-transparent disabled:dark:border-muted disabled:dark:text-muted-foreground"
                        onClick={() => handleOpenWithdrawModal(pool)}
                        disabled={!isLoggedIn || BigInt(pool.lpToken.totalBalance || "0") === BigInt(0)}
                        title={!isLoggedIn ? "Sign in to withdraw" : BigInt(pool.lpToken.totalBalance || "0") === BigInt(0) ? "No LP tokens to withdraw" : "Withdraw"}
                      >
                        <CircleArrowUp className="mr-1 h-4 w-4" />
                        <span className="hidden sm:inline">Withdraw</span>
                        <span className="sm:hidden">-</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <LiquidityDepositModal
        isOpen={isDepositModalOpen}
        onClose={handleCloseDepositModal}
        selectedPool={selectedPool}
        onDepositSuccess={handleDepositSuccess}
        operationInProgressRef={operationInProgressRef}
        usdstBalance={usdstBalance}
        voucherBalance={voucherBalance}
      />

      <LiquidityWithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={handleCloseWithdrawModal}
        selectedPool={selectedPool}
        onWithdrawSuccess={handleWithdrawSuccess}
        operationInProgressRef={operationInProgressRef}
        usdstBalance={usdstBalance}
        voucherBalance={voucherBalance}
      />
    </div>
  );
};

export default SwapPoolsSection;