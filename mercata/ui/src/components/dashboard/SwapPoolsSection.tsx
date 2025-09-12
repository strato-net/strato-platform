import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CircleArrowDown, CircleArrowUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { formatBalance } from '@/utils/numberUtils';
import { useSwapContext } from '@/context/SwapContext';
import { LiquidityPool } from '@/interface';
import LiquidityDepositModal from './LiquidityDepositModal';
import LiquidityWithdrawModal from './LiquidityWithdrawModal';

const SwapPoolsSection = () => {
  // ===== STATE =====
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<LiquidityPool | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [loading, setLoading] = useState(false);
  
  // ===== REFS =====
  const poolPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const operationInProgressRef = useRef(false);

  // ===== CONTEXT =====
  const { fetchPools, getPoolByAddress, enrichPools, fetchLpTokensPositions } = useSwapContext();
  const { fetchUsdstBalance } = useUserTokens();
  const { userAddress } = useUser();

  // ===== HELPER FUNCTIONS =====
  const hasTokensForPool = (pool: LiquidityPool): boolean => {
    if (!userAddress) return false;
    
    const tokenABalance = pool.tokenA?.balances?.[0]?.balance || "0";
    const tokenBBalance = pool.tokenB?.balances?.[0]?.balance || "0";
    
    return BigInt(tokenABalance) > 0n || BigInt(tokenBBalance) > 0n;
  };

  const enrichPoolsWithLpData = (pools: LiquidityPool[], positions: any[]): LiquidityPool[] => {
    return pools.map(pool => {
      const lpTokenData = positions.find((lp: any) => lp.address === pool.address);
      
      return {
        ...pool,
        lpToken: {
          ...pool.lpToken,
          balances: lpTokenData?.lpToken?.balances || []
        }
      };
    });
  };

  // ===== DATA FETCHING =====
  const fetchAndEnrichPools = async (ignoreGuard = false) => {
    if (!ignoreGuard && operationInProgressRef.current) return;
    
    try {
      setLoading(true);
      const [tempPools, positions] = await Promise.all([
        fetchPools(),
        fetchLpTokensPositions(),
      ]);
      const enriched = enrichPools(tempPools);
      setPools(enrichPoolsWithLpData(enriched, positions));
    } catch (err) {
      console.error("Failed to fetch pools:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOperationSuccess = async () => {
    const [positions] = await Promise.all([
      fetchLpTokensPositions(),
      userAddress ? fetchUsdstBalance(userAddress) : Promise.resolve(),
    ]);
    const base = await fetchPools();
    const enriched = enrichPools(base);
    setPools(enrichPoolsWithLpData(enriched, positions));

    if (selectedPool) {
      const updatedPool = await getPoolByAddress(selectedPool.address);
      if (updatedPool) {
        setSelectedPool(prev => ({ ...prev!, ...updatedPool }));
        setPools(prev => prev.map(p => p.address === updatedPool.address ? { ...p, ...updatedPool } : p));
      }
    }
  };

  // ===== MODAL HANDLERS =====
  const handleOpenModal = (pool: LiquidityPool, type: 'deposit' | 'withdraw') => {
    if (operationInProgressRef.current) return;
    
    setSelectedPool(pool);
    if (type === 'deposit') {
      setIsDepositModalOpen(true);
    } else {
      setIsWithdrawModalOpen(true);
    }
  };

  const handleCloseModal = (type: 'deposit' | 'withdraw') => {
    if (type === 'deposit') {
      setIsDepositModalOpen(false);
    } else {
      setIsWithdrawModalOpen(false);
    }
    setSelectedPool(null);
  };

  // ===== EFFECTS =====
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

  useEffect(() => {
    return () => {
      if (poolPollIntervalRef.current) {
        clearInterval(poolPollIntervalRef.current);
      }
    };
  }, []);

  // ===== COMPUTED VALUES =====
  const filteredPools = pools.filter(pool => 
    pool._name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ===== RENDER HELPERS =====
  const renderTokenImage = (token: any, fallbackText: string, isFirst: boolean = false) => {
    if (token?.images?.[0]?.value) {
      return (
        <img
          src={token.images[0].value}
          alt={token.name || fallbackText}
          className={`w-8 h-8 rounded-full border-2 border-white object-cover ${isFirst ? 'z-10' : ''}`}
        />
      );
    }
    
    return (
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium border-2 border-white ${isFirst ? 'z-10' : ''}`}
        style={{ backgroundColor: "red" }}
      >
        {fallbackText}
      </div>
    );
  };

  const renderPoolCard = (pool: LiquidityPool) => {
    const userBalance = pool.lpToken.balances?.find(b => 
      b.user?.toLowerCase() === userAddress?.toLowerCase()
    )?.balance ?? "0";

    return (
      <Card key={pool.address} className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            {/* Pool Info */}
            <div className="flex items-center">
              <div className="flex items-center -space-x-2 mr-3">
                {renderTokenImage(pool.tokenA, pool._name?.split('/')[0] || 'A', true)}
                {renderTokenImage(pool.tokenB, pool._name?.split('/')[1] || 'B')}
              </div>
              <div>
                <h3 className="font-medium">{pool._name}</h3>
                <div className="flex items-center text-xs text-gray-500 mt-1">
                  <span>Liquidity: {formatBalance(pool.lpToken._totalSupply, undefined, 18, 1, 6)} {pool.lpToken._symbol}</span>
                </div>
                <div className="flex items-center text-xs text-gray-500 mt-1">
                  <span>Your Liquidity: {formatBalance(userBalance, undefined, 18, 1, 6)} {pool.lpToken._symbol}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between sm:justify-end space-x-4">
              <div className="text-left sm:text-right">
                <div className="text-sm text-gray-500">APY</div>
                <div className="font-medium">{pool.apy ? `${pool.apy}%` : "N/A"}</div>
              </div>
              <div className="flex space-x-2">
                <Button
                  size="sm"
                  className="bg-strato-blue hover:bg-strato-blue/90"
                  onClick={() => handleOpenModal(pool, 'deposit')}
                  disabled={!userAddress || !hasTokensForPool(pool)}
                  title="Deposit liquidity"
                >
                  <CircleArrowDown className="mr-1 h-4 w-4" />
                  <span className="hidden sm:inline">Deposit</span>
                  <span className="sm:hidden">+</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-strato-blue text-strato-blue hover:bg-strato-blue/10"
                  onClick={() => handleOpenModal(pool, 'withdraw')}
                  disabled={!userBalance || BigInt(userBalance) === 0n}
                  title="Withdraw liquidity"
                >
                  <CircleArrowUp className="mr-1 h-4 w-4" />
                  <span className="hidden sm:inline">Withdraw</span>
                  <span className="sm:hidden">-</span>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // ===== MAIN RENDER =====
  return (
    <div>
      {/* Search */}
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

      {/* Pools Grid */}
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
          filteredPools.map(renderPoolCard)
        )}
      </div>

      {/* Modals */}
      <LiquidityDepositModal
        isOpen={isDepositModalOpen}
        onClose={() => handleCloseModal('deposit')}
        selectedPool={selectedPool}
        onDepositSuccess={handleOperationSuccess}
        operationInProgressRef={operationInProgressRef}
      />

      <LiquidityWithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={() => handleCloseModal('withdraw')}
        selectedPool={selectedPool}
        onWithdrawSuccess={handleOperationSuccess}
        operationInProgressRef={operationInProgressRef}
      />
    </div>
  );
};

export default SwapPoolsSection;