import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Wallet } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { Token, PriceHistoryEntry } from '@/interface';
import { formatUnits } from 'ethers';
import { api } from '@/lib/axios';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import CopyButton from '@/components/ui/copy';

type PricePoint = {
  date: string;
  price: string; // formatted price string
  timestamp?: number; // raw timestamp for chart handling
};

interface PriceHistoryApiEntry {
  id: string;
  timestamp: string;
  asset: string;
  price: string;
  blockTimestamp: string;
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
          // Format as MM/DD HH:mm for better hourly resolution display
          date: `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`,
          price: price,
          timestamp: date.getTime() // Add raw timestamp for better chart handling
        };
      });
    
    console.log(`[fetchPriceHistory] Received ${response.data.data.length} entries, filtered to ${processedData.length} valid entries`);
    if (processedData.length > 0) {
      console.log(`[fetchPriceHistory] Price range: ${processedData[0].price} to ${processedData[processedData.length - 1].price}`);
    }
    
    return processedData;
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return [];
  }
};

const AssetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Token | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const [priceDataLoading, setPriceDataLoading] = useState(false);
  const { userAddress } = useUser()
  const { activeTokens: assets, inactiveTokens, loading, fetchTokens, allActiveTokens } = useUserTokens()

  
  useEffect(() => {
    fetchTokens()
  }, [userAddress])

  useEffect(() => {
    // Find the asset with the matching id
    const foundAsset = assets.find(a => a?.address === id);
    const foundInActiveAsset = inactiveTokens.find(a => a?.address === id)
    const foundInAllActiveTokens = allActiveTokens.find(a => a?.address === id)
    if (foundAsset) {
      setAsset(foundAsset);
      document.title = `${foundAsset?.token?._name} | Asset Details`;

      // Fetch real price history
      if (foundAsset?.address) {
        setPriceDataLoading(true);
        fetchPriceHistory(foundAsset.address)
          .then(setPriceData)
          .finally(() => setPriceDataLoading(false));
      }
    } else if (foundInActiveAsset){
      setAsset(foundInActiveAsset);
      document.title = `${foundInActiveAsset?.token?._name} | Asset Details`;

      // Fetch real price history
      if (foundInActiveAsset?.address) {
        setPriceDataLoading(true);
        fetchPriceHistory(foundInActiveAsset.address)
          .then(setPriceData)
          .finally(() => setPriceDataLoading(false));
      }
    } else if (foundInAllActiveTokens){
      setAsset(foundInAllActiveTokens);
      document.title = `${foundInAllActiveTokens?.token?._name} | Asset Details`;

      // Fetch real price history
      if (foundInAllActiveTokens?.address) {
        setPriceDataLoading(true);
        fetchPriceHistory(foundInAllActiveTokens.address)
          .then(setPriceData)
          .finally(() => setPriceDataLoading(false));
      }
    }
  }, [id, assets]);  

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
              <Card className="mb-6">
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
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Current Price:</span>
                      <span className="font-medium">
                        {formatUnits(asset?.price?.toLocaleString("fullwide", { useGrouping: false }), 18)}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">User Balance:</span>
                      <span className="font-medium">{formatUnits(BigInt(asset?.balance || "0"), 18)}</span>
                    </div>

                    {asset?.status == "2" ? (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Status:</span>
                        <span className="font-medium text-green-500">Available</span>
                      </div>
                    ) : (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Status:</span>
                        <span className="font-medium text-red-500">Sold Out</span>
                      </div>
                    )}

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
            </div>

            {/* Charts and Description */}
            <div className="lg:col-span-2">

              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Price History (Hourly Oracle Data)</CardTitle>
                  {priceData.length > 0 && (
                    <p className="text-sm text-gray-600">
                      Hourly price data from first available oracle price to present
                    </p>
                  )}
                </CardHeader>

                <CardContent className="overflow-hidden">
                  {priceDataLoading ? (
                    <div className="flex items-center justify-center h-80 bg-gray-100 rounded-md">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                      <p className="text-gray-500 ml-3">Loading price history...</p>
                    </div>
                  ) : priceData.length > 0 ? (
                    <div className="h-80 w-full">
                      <ChartContainer
                        config={{
                          price: {
                            theme: {
                              light: asset?.color || "#EF4444",
                              dark: asset?.color || "#EF4466",
                            }
                          },
                          tooltip: {
                            theme: {
                              light: "gray",
                              dark: "gray"
                            }
                          }
                        }}
                        className="w-full h-full"
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={priceData}
                            margin={{ top: 5, right: 30, left: 5, bottom: 5 }}
                          >
                            <defs>
                              <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={asset.color} stopOpacity={0.8} />
                                <stop offset="95%" stopColor={asset.color} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis
                              dataKey="date"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 10 }}
                              tickCount={8}
                              tickFormatter={(value, index) => {
                                // Show date ticks distributed across the chart width
                                const parts = value.split(' ');
                                return parts[0]; // Just show MM/DD
                              }}
                            />
                            <YAxis
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 12 }}
                              domain={['auto', 'auto']}
                              tickFormatter={(value) => `$${parseFloat(value).toFixed(2)}`}
                            />
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <ChartTooltip
                              content={<ChartTooltipContent 
                                labelFormatter={(value) => `Time: ${value}`}
                                formatter={(value: string | number) => [`$${parseFloat(value.toString()).toFixed(6)}`, 'Price']}
                              />}
                            />
                            <Area
                              type="monotone"
                              dataKey="price"
                              name="Price"
                              stroke={asset?.color || "#EF4444"}
                              fillOpacity={1}
                              fill="url(#colorPrice)"
                              activeDot={{ r: 8 }}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-80 bg-gray-100 rounded-md">
                      <p className="text-gray-500">No price history available for this asset</p>
                    </div>
                  )}
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
        </main>
      </div>
    </div>
  );
};

export default AssetDetail;
