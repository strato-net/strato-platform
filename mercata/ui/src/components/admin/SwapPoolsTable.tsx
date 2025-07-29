import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useSwapContext } from '@/context/SwapContext';
import { LiquidityPool } from '@/interface';
import { formatBalance } from '@/utils/numberUtils';

const SwapPoolsTable = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [pools, setPools] = useState<LiquidityPool[]>([]);
  const [loading, setLoading] = useState(false);

  const { fetchPools, enrichPools } = useSwapContext();

  useEffect(() => {
    fetchAndEnrichPools();
  }, [fetchPools]);

  const fetchAndEnrichPools = async () => {
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

  const filteredPools = pools.filter(pool => 
    pool._name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Swap Pools Overview</CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search pool pairs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-12">
            <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
          </div>
        ) : !pools.length ? (
          <div className="flex justify-center items-center h-12 text-gray-500">
            <div>No pools available</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Pool</th>
                  <th className="text-left py-3 px-4 font-medium">Liquidity</th>
                  <th className="text-left py-3 px-4 font-medium">APY</th>
                </tr>
              </thead>
              <tbody>
                {filteredPools.map((pool, index) => (
                  <tr key={index} className="border-b hover:bg-gray-50">
                    <td className="py-4 px-4">
                      <div className="flex items-center">
                        <div className="flex items-center -space-x-2 mr-3">
                          {pool.tokenA?.images?.[0]?.value ? (
                            <img
                              src={pool.tokenA.images[0].value}
                              alt={pool.tokenA.name || pool._name?.split('/')[0]}
                              className="w-6 h-6 rounded-full z-10 border-2 border-white object-cover"
                            />
                          ) : (
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium z-10 border-2 border-white"
                              style={{ backgroundColor: "#ef4444" }}
                            >
                              {pool._name?.slice(0, 2)}
                            </div>
                          )}
                          {pool.tokenB?.images?.[0]?.value ? (
                            <img
                              src={pool.tokenB.images[0].value}
                              alt={pool.tokenB.name || pool._name?.split('/')[1]}
                              className="w-6 h-6 rounded-full border-2 border-white object-cover"
                            />
                          ) : (
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-medium border-2 border-white"
                              style={{ backgroundColor: "#ef4444" }}
                            >
                              {pool._name?.split('/')[1]?.slice(0, 2)}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{pool._name}</div>
                          <div className="text-sm text-gray-500">{pool._symbol}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-medium">
                        {formatBalance(pool.lpToken._totalSupply, undefined, 18, 1, 6)} {pool.lpToken._symbol}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="font-medium text-green-600">
                        {pool.apy ? `${pool.apy}%` : "N/A"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SwapPoolsTable;