import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Wallet } from 'lucide-react';
import { useUser } from '@/context/UserContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { Token } from '@/interface';
import { formatUnits } from 'ethers';
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
import { generatePriceData } from '@/utils';

type PricePoint = {
  date: string;
  price: string; // since you're using `formatUnits`, it's a string
};

const AssetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Token | null>(null);
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const [priceData, setPriceData] = useState<PricePoint[]>([]);
  const { userAddress } = useUser()
  const { activeTokens: assets, inactiveTokens, loading, fetchTokens } = useUserTokens()

  
  useEffect(() => {
    fetchTokens()
  }, [userAddress])

  useEffect(() => {
    // Find the asset with the matching id
    const foundAsset = assets.find(a => a?.address === id);
    const foundInActiveAsset = inactiveTokens.find(a => a?.address === id)
    if (foundAsset) {
      setAsset(foundAsset);
      document.title = `${foundAsset?.token?._name} | Asset Details`;

      if (foundAsset?.price) {
        const basePrice = parseFloat(foundAsset.price.toString());
        if (!isNaN(basePrice)) {
          setPriceData(generatePriceData(basePrice));
        }
      }
    } else if (foundInActiveAsset){
      setAsset(foundInActiveAsset);
      document.title = `${foundInActiveAsset?.token?._name} | Asset Details`;

      if (foundInActiveAsset?.price) {
        const basePrice = parseFloat(foundInActiveAsset.price.toString());
        if (!isNaN(basePrice)) {
          setPriceData(generatePriceData(basePrice));
        }
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
        <DashboardHeader title={`${asset?.token?._symbol} Details`} />

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
                      <p className="text-sm font-semibold text-blue-600">{asset?.token?._symbol}</p>
                      <CardTitle className="text-xl">{asset?.token?._name}</CardTitle>
                    </div>
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white text-sm font-bold overflow-hidden"
                      style={{ backgroundColor: asset?.color || "#EF4444" }} // fallback to red if no color
                    >
                      {asset?.token?._symbol?.toUpperCase() || "N/A"}
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="flex justify-center mb-6">
                    <div
                      className="w-32 h-32 rounded-full bg-white border-4 flex items-center justify-center overflow-hidden relative"
                    >
                      {asset?.token?.images?.length > 0 ? (
                        <img
                          src={asset.token.images[0].value}
                          alt={asset.token?._name}
                          className="w-full h-full object-contain"
                          onError={(e) => (e.currentTarget.style.display = "none")}
                        />
                      ) : (
                        <span className="absolute inset-0 flex items-center justify-center text-center text-sm font-semibold text-gray-500 p-2">
                          {asset?.token?._name}
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

                    {asset?.available ? (
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
                          : 'N/A'}
                      <CopyButton address={asset?.token?._owner} />
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
                  <CardTitle>Price History</CardTitle>
                </CardHeader>

                <CardContent className="overflow-hidden">
                  {priceData.length > 0 ? (
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
                              tick={{ fontSize: 12 }}
                              tickFormatter={(value) => {
                                const date = new Date(value);
                                return `${date.getMonth() + 1}/${date.getDate()}`;
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
                              content={<ChartTooltipContent />}
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
                      <p className="text-gray-500">Price data not available</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>About {asset?.token?._name}</CardTitle>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    <div
                      className="prose max-w-none text-sm"
                      dangerouslySetInnerHTML={{ __html: asset?.token?.description }}
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
