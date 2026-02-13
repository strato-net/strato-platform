import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Settings, ChevronDown, Pause, Play, Ban, Check } from "lucide-react";
import { useSwapContext } from '@/context/SwapContext';
import { Pool } from '@/interface';
import { formatBalance } from '@/utils/numberUtils';
import SetPoolRatesModal from './SetPoolRatesModal';
import CopyButton from '../ui/copy';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

const SwapPoolsTable = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [showSetRatesModal, setShowSetRatesModal] = useState(false);

  const { fetchPools, togglePause, toggleDisable, refetchSwappableTokens } = useSwapContext();

  const fetchAndEnrichPools = useCallback(async () => {
    try {
      setLoading(true);
      const tempPools = await fetchPools();
      setPools(tempPools);
    } catch (err) {
      console.error("Failed to fetch pools:", err);
    } finally {
      setLoading(false);
    }
  }, [fetchPools]);

  const handleTogglePause = useCallback(async (pool: Pool, isPaused: boolean) => {
    try {
      setLoading(true);
      await togglePause(pool.address, isPaused);
      await fetchAndEnrichPools();
      refetchSwappableTokens();
    } catch (error) {
      console.error('Failed to toggle pause:', error);
    } finally {
      setLoading(false);
    }
  }, [togglePause, fetchAndEnrichPools, refetchSwappableTokens]);

  const handleToggleDisable = useCallback(async (pool: Pool, isDisabled: boolean) => {
    try {
      setLoading(true);
      await toggleDisable(pool.address, isDisabled);
      await fetchAndEnrichPools();
      refetchSwappableTokens();
    } catch (error) {
      console.error('Failed to toggle disable:', error);
    } finally {
      setLoading(false);
    }
  }, [toggleDisable, fetchAndEnrichPools, refetchSwappableTokens]);

  useEffect(() => {
    fetchAndEnrichPools();
  }, [fetchAndEnrichPools]);

  const filteredPools = pools.filter(pool => 
    pool.poolName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Swap Pools Overview</CardTitle>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
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
          <div className="flex justify-center items-center h-12 text-muted-foreground">
            <div>No pools available</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[768px]">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">Pool</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">Pool Address</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">Status</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">Liquidity</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">Swap Fee Rate</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">LP Share %</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">APY</th>
                  <th className="text-left py-3 px-2 md:px-4 font-medium whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPools.map((pool, index) => (
                  <tr key={index} className="border-b hover:bg-muted/50">
                    <td className="py-4 px-2 md:px-4">
                      <div className="flex items-center">
                        <div className="flex items-center mr-3">
                          <div className="relative">
                            {pool.tokenA?.images?.[0]?.value ? (
                              <img
                                src={pool.tokenA.images[0].value}
                                alt={pool.tokenA._name || pool.poolName?.split('/')[0]}
                                className="w-8 h-8 md:w-6 md:h-6 rounded-full border-2 border-background object-contain bg-background"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 md:w-6 md:h-6 rounded-full flex items-center justify-center text-xs text-white font-medium border-2 border-background flex-shrink-0"
                                style={{ backgroundColor: "#ef4444" }}
                              >
                                {pool.poolName?.slice(0, 2)}
                              </div>
                            )}
                          </div>
                          <div className="relative -ml-3 md:-ml-2">
                            {pool.tokenB?.images?.[0]?.value ? (
                              <img
                                src={pool.tokenB.images[0].value}
                                alt={pool.tokenB._name || pool.poolName?.split('/')[1]}
                                className="w-8 h-8 md:w-6 md:h-6 rounded-full border-2 border-background object-contain bg-background"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 md:w-6 md:h-6 rounded-full flex items-center justify-center text-xs text-white font-medium border-2 border-background flex-shrink-0"
                                style={{ backgroundColor: "#ef4444" }}
                              >
                                {pool.poolName?.split('/')[1]?.slice(0, 2)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{pool.poolName}</div>
                          <div className="text-sm text-muted-foreground truncate">{pool.poolSymbol}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <div className="flex items-center space-x-1 md:space-x-2">
                        <span className="font-mono text-xs md:text-sm text-muted-foreground">
                          {pool.address ? `${pool.address.slice(0, 6)}...${pool.address.slice(-4)}` : 'N/A'}
                        </span>
                        {pool.address && (
                          <CopyButton address={pool.address} />
                        )}
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <div className="flex flex-wrap gap-1">
                        <Badge 
                          variant={(pool.isPaused || pool.isDisabled) ? "destructive" : "default"} 
                          className="text-[10px] md:text-xs"
                        >
                          {pool.isDisabled ? 'Disabled' : pool.isPaused ? 'Paused' : 'Active'}
                        </Badge>
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <div className="font-medium text-sm">
                        {formatBalance(pool.lpToken._totalSupply, undefined, 18, 1, 6)} {pool.lpToken._symbol}
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <div className="font-medium text-sm md:text-base">
                        {pool.swapFeeRate !== undefined && pool.swapFeeRate !== null ? `${(pool.swapFeeRate / 100).toFixed(2)}%` : "N/A"}
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <div className="font-medium text-sm md:text-base">
                        {pool.lpSharePercent !== undefined && pool.lpSharePercent !== null ? `${(pool.lpSharePercent / 100).toFixed(1)}%` : "N/A"}
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <div className="font-medium text-green-600 text-sm md:text-base">
                        {pool.apy ? `${pool.apy}%` : "N/A"}
                      </div>
                    </td>
                    <td className="py-4 px-2 md:px-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            className="flex items-center gap-1"
                          >
                            <Settings className="h-3 w-3" />
                            Actions
                            <ChevronDown className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedPool(pool);
                              setShowSetRatesModal(true);
                            }}
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            Set Rates
                          </DropdownMenuItem>
                          {pool.isPaused ? (
                            <DropdownMenuItem
                              onClick={() => handleTogglePause(pool, false)}
                              disabled={loading || pool.isDisabled}
                            >
                              <Play className="h-4 w-4 mr-2" />
                              Unpause
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleTogglePause(pool, true)}
                              disabled={loading || pool.isDisabled}
                            >
                              <Pause className="h-4 w-4 mr-2" />
                              Pause
                            </DropdownMenuItem>
                          )}
                          {pool.isDisabled ? (
                            <DropdownMenuItem
                              onClick={() => handleToggleDisable(pool, false)}
                              disabled={loading}
                            >
                              <Check className="h-4 w-4 mr-2" />
                              Enable
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleToggleDisable(pool, true)}
                              disabled={loading}
                              className="text-destructive focus:text-destructive"
                            >
                              <Ban className="h-4 w-4 mr-2" />
                              Disable
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <SetPoolRatesModal
        open={showSetRatesModal}
        onOpenChange={setShowSetRatesModal}
        pool={selectedPool}
        onSuccess={fetchAndEnrichPools}
      />
    </Card>
  );
};

export default SwapPoolsTable;