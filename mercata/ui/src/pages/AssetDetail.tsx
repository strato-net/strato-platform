import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Wallet, ArrowUp, ArrowDown } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { Token, PriceHistoryEntry, SwapHistoryEntry } from '@/interface';
import { formatUnits } from 'ethers';
import { api } from '@/lib/axios';
import PriceChart from '@/components/charts/PriceChart';
import CopyButton from '@/components/ui/copy';
import { addCommasToInput, roundToDecimals } from '@/utils/numberUtils';

type PricePoint = {
  date: string;
  price: string;
  timestamp?: number;
};

type SwapPricePoint = {
  date: string;
  price: string;
  timestamp: number;
  poolAddress: string;
  volume: string;
};

interface PriceHistoryApiEntry {
  id: string;
  timestamp: string;
  asset: string;
  price: string;
  blockTimestamp: string;
}

interface Pool {
  address: string;
  tokenA: { address: string; _symbol: string };
  tokenB: { address: string; _symbol: string };
  aToBRatio: string;
  bToARatio: string;
}

const fetchPriceHistory = async (assetAddress: string): Promise<PricePoint[]> => {
  try {
    const response = await api.get<{ data: PriceHistoryApiEntry[] }>(`/oracle/price-history/${assetAddress}`);
    
    const processedData = response.data.data
      .filter((entry: PriceHistoryApiEntry) => entry.price && entry.price !== "0") // Filter out zero prices
      .map((entry: PriceHistoryApiEntry) => {
        const date = new Date(entry.blockTimestamp);
        const price = formatUnits(entry.price, 18);
        return {
          date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
          price: price,
          timestamp: date.getTime()
        };
      });
    
    
    return processedData;
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return [];
  }
};

const fetchPoolsForAsset = async (assetAddress: string): Promise<Pool[]> => {
  try {
    const response = await api.get('/swap-pools');
    const pools = response.data || [];
    
    // Filter pools that contain this asset
    return pools.filter((pool: Pool) => 
      pool.tokenA?.address?.toLowerCase() === assetAddress.toLowerCase() ||
      pool.tokenB?.address?.toLowerCase() === assetAddress.toLowerCase()
    );
  } catch (error) {
    console.error('Failed to fetch pools for asset:', error);
    return [];
  }
};

const fetchSwapPoolPrices = async (assetAddress: string): Promise<SwapPricePoint[]> => {
  try {
    // First, get all pools containing this asset
    const pools = await fetchPoolsForAsset(assetAddress);
    
    if (pools.length === 0) {
      return [];
    }

    // Fetch swap history for each pool and combine the data
    const allSwapPrices: SwapPricePoint[] = [];
    
    for (const pool of pools) {
      try {
        const response = await api.get(`/swap-history/${pool.address}`, {
          params: {
            limit: '1000', // Get more history for better chart
            order: 'block_timestamp.desc'
          }
        });
        
        const swapHistory: SwapHistoryEntry[] = response.data.data || [];
        
        // Convert swap history to price points
        const poolPrices = swapHistory
          .filter(swap => swap.impliedPrice && swap.impliedPrice !== "0")
          .map(swap => {
            const date = new Date(swap.timestamp);
            return {
              date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
              price: swap.impliedPrice,
              timestamp: date.getTime(),
              poolAddress: pool.address,
              volume: swap.amountIn
            };
          });
        
        allSwapPrices.push(...poolPrices);
      } catch (poolError) {
        console.error(`Failed to fetch swap history for pool ${pool.address}:`, poolError);
      }
    }
    
    // Sort by timestamp and return last 30 days worth of data
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return allSwapPrices
      .filter(point => point.timestamp >= thirtyDaysAgo)
      .sort((a, b) => a.timestamp - b.timestamp);
      
  } catch (error) {
    console.error('Failed to fetch swap pool prices:', error);
    return [];
  }
};

// Consistent color scheme for all charts
const CHART_COLORS = {
  GREEN: "#10b981", // Consistent green for upward trends
  RED: "#ef4444",   // Consistent red for downward trends  
  BLUE: "#2563eb"   // Default blue for neutral/no data
};

const AssetDetail = () => {

  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Token | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [priceDataLoading, setPriceDataLoading] = useState(false);
  const [swapPriceData, setSwapPriceData] = useState<SwapPricePoint[]>([]);
  const [swapPriceDataLoading, setSwapPriceDataLoading] = useState(false);
  const [showPriceTooltip, setShowPriceTooltip] = useState(false);
  const { userAddress } = useUser()
  const { activeTokens: assets, inactiveTokens, loading, fetchTokens, allActiveTokens } = useUserTokens()

  const PRICE_WINDOW = 30; // Number of days to show in the price chart
  const getChartColor = (currentPrice: string | undefined, priceData: PricePoint[]): string => {
    if (!currentPrice || priceData.length === 0) return CHART_COLORS.BLUE;
    
    const current = parseFloat(formatUnits(currentPrice.toString(), 18));
    const first = parseFloat(priceData[0].price);
    return current > first ? CHART_COLORS.GREEN : CHART_COLORS.RED;
  };
  
  const getSwapChartColor = (swapPriceData: SwapPricePoint[]): string => {
    if (swapPriceData.length === 0) return CHART_COLORS.BLUE;
    
    const first = parseFloat(swapPriceData[0].price);
    const last = parseFloat(swapPriceData[swapPriceData.length - 1].price);
    return last > first ? CHART_COLORS.GREEN : CHART_COLORS.RED;
  };
  
  useEffect(() => {
    fetchTokens()
  }, [userAddress])

  useEffect(() => {
    // Helper function to handle asset setup and price fetching
    const setupAsset = (foundAsset: Token) => {
      setAsset(foundAsset);
      document.title = `${foundAsset?.token?._name || foundAsset?._name} | Asset Details`;

      // Fetch oracle price history if address exists
      if (foundAsset?.address) {
        setPriceDataLoading(true);
        fetchPriceHistory(foundAsset.address)
          .then(data => setPriceData(data.slice(-(PRICE_WINDOW * 24)))) // Show last N days (24 hours each)
          .finally(() => setPriceDataLoading(false));

        // Fetch swap pool price history
        setSwapPriceDataLoading(true);
        fetchSwapPoolPrices(foundAsset.address)
          .then(data => setSwapPriceData(data))
          .finally(() => setSwapPriceDataLoading(false));
      }
    };

    // Find asset across all token sources
    const foundAsset = 
      assets.find(a => a?.address === id) ||
      inactiveTokens.find(a => a?.address === id) ||
      allActiveTokens.find(a => a?.address === id);

    if (foundAsset) {
      setupAsset(foundAsset);
    }
  }, [id, assets, inactiveTokens, allActiveTokens]);  

  if (!asset) {
    return (
      <div className="min-h-screen bg-gray-50">
        <DashboardSidebar />
        <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
          <DashboardHeader title="Asset Not Found" />
          {loading ?
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-primary"></div>
            </div>
            :
            <main className="p-6">
              <div className="text-center py-12">
                <h2 className="text-2xl font-bold mb-4">Asset Not Found</h2>
                <p className="text-gray-600 mb-6">The asset you are looking for does not exist or has been removed.</p>
                <Link to="/dashboard/deposits">
                  <Button>Back to Deposits</Button>
                </Link>
              </div>
            </main>
          }
        </div>
      </div>
    );
  }

  // const handleConnectWallet = () => { };

  // const handleBuyNow = () => { };

  // const handleBridge = () => { };

  
  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 16rem)' }}>
        <DashboardHeader title={`${asset?.token?._symbol || asset?._symbol} Details`} />

        <main className="p-6">
          <div className="mb-6">
            <Link to="/dashboard/deposits" className="inline-flex items-center text-blue-600 hover:text-blue-800">
              <ChevronLeft size={16} className="mr-1" /> Back to Deposits
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Asset Summary Card */}
            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-6 space-y-6">
                <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-blue-600">{asset?.token?._symbol || asset?._symbol}</p>
                      <CardTitle className="text-xl">{asset?.token?._name || asset?._name}</CardTitle>
                    </div>
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white text-sm font-bold overflow-hidden"
                      style={{ backgroundColor: asset?.color || "#EF4444" }} // fallback to red if no color
                    >
                      {asset?.token?._symbol?.toUpperCase() || asset?._symbol?.toUpperCase() || "N/A"}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="flex justify-center mb-6">
                    <div
                      className="w-32 h-32 rounded-full bg-white border-4 flex items-center justify-center overflow-hidden relative"
                    >
                      {asset?.token?.images?.length > 0 || asset?.images?.length > 0 ? (
                        <img
                          src={asset?.token?.images[0]?.value || asset?.images[0]?.value}
                          alt={asset?.token?._name || asset?._name}
                          className="w-full h-full object-contain"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-center text-sm font-semibold text-gray-500 p-2">
                          {asset?.token?._name || asset?._name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 mb-6">
                    <div 
                      className="flex justify-between text-sm relative cursor-help"
                      onMouseEnter={() => setShowPriceTooltip(true)}
                      onMouseLeave={() => setShowPriceTooltip(false)}
                    >
                      <span className="text-gray-500">Current Price:</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {addCommasToInput(formatUnits(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), 18))} USDST
                        </span>
                        
                        {/* Price trend indicator */}
                        {/* {priceData.length > 0 && asset?.price && (() => {
                          const chartColor = getChartColor(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), priceData);
                          const isUp = chartColor === CHART_COLORS.GREEN;
                          const firstPrice = parseFloat(priceData[0].price);
                          
                          return (
                            <div title={isUp ? `Up from initial: $${firstPrice.toFixed(2)}` : `Down from initial: $${firstPrice.toFixed(2)}`}>
                              {isUp ? (
                                <ArrowUp size={14} style={{ color: CHART_COLORS.GREEN }} />
                              ) : (
                                <ArrowDown size={14} style={{ color: CHART_COLORS.RED }} />
                              )}
                            </div>
                          );
                        })()} */}
                      </div>
                      
                      {/* Price timestamp tooltip */}
                      {showPriceTooltip && priceData.length > 0 && (
                        <div className="absolute right-0 top-full mt-1 z-10 bg-gray-800 text-white text-xs rounded py-1 px-2 whitespace-nowrap shadow-lg">
                          Last updated: {(() => {
                            const latestEntry = priceData[priceData.length - 1];
                            if (latestEntry?.timestamp) {
                              return new Date(latestEntry.timestamp).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: true
                              });
                            }
                            return 'Unknown';
                          })()}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">User Balance:</span>
                      <span className="font-medium">{formatUnits(BigInt(asset?.balance || "0"), 18)}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Owner:</span>
                      <span className="font-medium">
                        {asset?.token?._owner
                          ? `${asset.token._owner.slice(0, 6)}...${asset.token._owner.slice(-4)}`
                          : asset?._owner ? `${asset?._owner?.slice(0, 6)}...${asset?._owner?.slice(-4)}` : 'N/A'}
                      <CopyButton address={asset?.token?._owner || asset?._owner} />
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Address:</span>
                      <span className="font-medium">
                        {asset?.address
                          ? `${asset.address.slice(0, 6)}...${asset.address.slice(-4)}`
                          : 'N/A'}
                        <CopyButton address={asset?.address} />
                      </span>
                    </div>
                  </div>
                  {/* {!isWalletConnected ? (
                    <Button
                      onClick={handleConnectWallet}
                      className="w-full flex items-center justify-center gap-2 mb-4"
                    >
                      <Wallet size={16} />
                      Connect Ethereum Wallet
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 justify-center mb-4 text-green-600">
                      <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                      <span className="text-sm font-medium">Wallet Connected</span>
                      <span className="text-gray-500">Address:</span>
                      <span className="font-medium">{asset?.address}</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      onClick={handleBuyNow}
                      disabled={!asset?.available || !isWalletConnected}
                      className="w-full"
                    >
                      Buy Now
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={handleBridge}
                      disabled={!isWalletConnected}
                      className="w-full"
                    >
                      Bridge
                    </Button>
                  </div> */}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>About {asset?.token?._name || asset?._name}</CardTitle>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    <div
                      className="prose max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: asset?.token?.description || asset?.description }}
                    />
                  </div>
                </CardContent>
              </Card>
              </div>
            </div>

            <div className="lg:col-span-2">
                <PriceChart
                  data={priceData}
                  loading={priceDataLoading}
                  title="Spot Price History"
                  subtitle={priceData.length > 0 ? "Hourly price data from first available oracle price to present" : undefined}
                  loadingMessage="Loading price history..."
                  emptyMessage="No price history available for this asset"
                  chartColor={getChartColor(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), priceData)}
                  gradientId="colorPrice"
                />

                <PriceChart
                  data={swapPriceData}
                  loading={swapPriceDataLoading}
                  title="Swap Pool Price History"
                  subtitle={swapPriceData.length > 0 ? "Actual trading prices from swap pools (Last 30 days)" : undefined}
                  loadingMessage="Loading swap pool prices..."
                  emptyMessage="No swap pool data available for this asset"
                  chartColor={getSwapChartColor(swapPriceData)}
                  gradientId="colorSwapPrice"
                />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AssetDetail;
