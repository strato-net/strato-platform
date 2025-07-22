import { useEffect, useState, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BanknoteIcon, CircleArrowDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from '@/hooks/use-toast';
import { formatBalance } from '@/utils/numberUtils';
import { useSwapContext } from '@/context/SwapContext';
import { LiquidityPool } from '@/interface';
import LiquidityDepositModal from './LiquidityDepositModal';
import LiquidityWithdrawModal from './LiquidityWithdrawModal';


const SwapPoolsSection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPool, setSelectedPool] = useState<LiquidityPool | null>(null);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [loading, setLoading] = useState(false);
  const poolPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const operationInProgressRef = useRef(false);

  const { fetchPools, getPoolByAddress, enrichPools } = useSwapContext();
  const { toast } = useToast();

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
      console.error("Failed to fetch pools:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDepositModal = async (pool: LiquidityPool) => {
    if (operationInProgressRef.current) return;
    
    setSelectedPool(pool);
    setIsDepositModalOpen(true);
  };

  const handleOpenWithdrawModal = async (pool: LiquidityPool): Promise<void> => {
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
  };

  const handleWithdrawSuccess = async () => {
    // Refresh all data after successful withdrawal
    await fetchAndEnrichPools();
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
                      {pool.tokenA?.images?.[0]?.value ? (
                        <img
                          src={pool.tokenA.images[0].value}
                          alt={pool.tokenA.name || pool._name?.split('/')[0]}
                          className="w-8 h-8 rounded-full z-10 border-2 border-white object-cover"
                        />
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                          style={{ backgroundColor: "red" }}
                        >
                          {pool._name?.slice(0, 2)}
                        </div>
                      )}
                      {pool.tokenB?.images?.[0]?.value ? (
                        <img
                          src={pool.tokenB.images[0].value}
                          alt={pool.tokenB.name || pool._name?.split('/')[1]}
                          className="w-8 h-8 rounded-full border-2 border-white object-cover"
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
                        <span>Liquidity: {formatBalance(pool.lpToken._totalSupply, undefined, 18, 1, 6)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end space-x-4">
                    <div className="text-left sm:text-right">
                      <div className="text-sm text-gray-500">APY</div>
                      <div className="font-medium">{pool.apy ? `${pool.apy}%` : "N/A"}</div>
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

      <LiquidityDepositModal
        isOpen={isDepositModalOpen}
        onClose={handleCloseDepositModal}
        selectedPool={selectedPool}
        onDepositSuccess={handleDepositSuccess}
        operationInProgressRef={operationInProgressRef}
      />

      <LiquidityWithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={handleCloseWithdrawModal}
        selectedPool={selectedPool}
        onWithdrawSuccess={handleWithdrawSuccess}
        operationInProgressRef={operationInProgressRef}
      />
    </div>
  );
};

export default SwapPoolsSection;