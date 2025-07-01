import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Wallet, Copy } from 'lucide-react';
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
import { useAccount, useDisconnect } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const generatePriceData = (basePrice: number, days: number = 30) => {
  const data = [];
  let currentPrice = basePrice;

  for (let i = 0; i < days; i++) {
    // Random price fluctuation between -2% and +2%
    const change = currentPrice * (Math.random() * 0.04 - 0.02);
    currentPrice += change;

    data.push({
      date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000).toLocaleDateString(),
      price: formatUnits(currentPrice?.toLocaleString("fullwide", { useGrouping: false }), 18),
    });
  }

  return data;
};

const AssetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Token | null>(null);
  const [priceData, setPriceData] = useState<any[]>([]);
  const { userAddress } = useUser()
  const { tokens: assets, loading, fetchTokens } = useUserTokens()
  const navigate = useNavigate();
  
  // Wallet connection state from wagmi
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { toast } = useToast();

  useEffect(() => {
    fetchTokens(userAddress)
  }, [userAddress])

  useEffect(() => {
    // Find the asset with the matching id
    const foundAsset = assets.find(a => a?.address === id);
    if (foundAsset) {
      setAsset(foundAsset);
      document.title = `${foundAsset?.token?._name} | Asset Details`;

      if (foundAsset?.price) {
        const basePrice = parseFloat(foundAsset.price);
        if (!isNaN(basePrice)) {
          setPriceData(generatePriceData(basePrice));
        }
      }
    }
  }, [id, assets]);

  if (!asset) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <DashboardSidebar />
        <div className="flex-1 ml-64">
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
                <Link to="/dashboard/assets">
                  <Button>Back to Assets</Button>
                </Link>
              </div>
            </main>
          }
        </div>
      </div>
    );
  }

  const handleBuyNow = () => { };

  const handleBridge = () => {
    if (asset?.token?._name) {
      const assetName = encodeURIComponent(asset.token._name);
      navigate(`/dashboard/bridge?asset=${assetName}`);
    } else {
      navigate('/dashboard/bridge');
    }
  };

  const copyToClipboard = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      toast({
        title: "Address copied!",
        description: "Wallet address copied to clipboard",
        duration: 2000,
      });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />

      <div className="flex-1 ml-64">
        <DashboardHeader title={`${asset?.token?._symbol} Details`} />

        <main className="p-6">
          <div className="mb-6">
            <Link to="/dashboard/assets" className="inline-flex items-center text-blue-600 hover:text-blue-800">
              <ChevronLeft size={16} className="mr-1" /> Back to Assets
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
                        {asset?.price ? formatUnits(BigInt(asset.price), 18) : '0'}
                      </span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Asset Deposits:</span>
                      <span className="font-medium">{asset?.balance ? formatUnits(BigInt(asset.balance), 18) : '0'}</span>
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
                      <span className="text-gray-500">Provider:</span>
                      <span className="font-medium">{asset?.provider || 'N/A'}</span>
                    </div>

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

                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Vault Service:</span>
                      <span className="font-medium">{asset?.vaulter || 'N/A'}</span>
                    </div>
                  </div>
                  {!isConnected ? (
                    <div className="w-full mb-4">
                      <ConnectButton label="Connect Ethereum Wallet" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 justify-center mb-4">
                      <div
                        onClick={() => disconnect()}
                        className="relative group cursor-pointer"
                      >
                        <div className="px-4 py-2 bg-green-50 text-green-600 rounded-xl font-semibold group-hover:opacity-0 transition-opacity">
                          Wallet Connected
                        </div>
                        <div className="absolute inset-0 bg-red-50 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-red-600 font-semibold">
                            Disconnect
                          </span>
                        </div>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 text-xs bg-green-100/50 px-2 py-1 rounded-md font-mono text-green-700 cursor-pointer">
                              {address?.slice(0, 6)}...{address?.slice(-4)}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard();
                                }}
                                className="hover:text-green-900 transition-colors cursor-pointer"
                              >
                                <Copy size={12} />
                              </button>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{address}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      onClick={handleBuyNow}
                      disabled={!asset?.available || !isConnected}
                      className="w-full"
                    >
                      Buy Now
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={handleBridge}
                      disabled={!isConnected}
                      className="w-full"
                    >
                      Bridge
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts and Description */}
            <div className="lg:col-span-2">

              {/* <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Price History</CardTitle>
                </CardHeader>

                <CardContent>
                  {priceData.length > 0 ? (
                    <div className="h-80">
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
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={priceData}
                            margin={{ top: 5, right: 5, left: 0, bottom: 5 }}
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
                                return `${date.getDate()}/${date.getMonth() + 1}`;
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
              </Card> */}

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
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="font-semibold mb-2">Key Features</h4>
                    <ul className="list-disc pl-5 space-y-1 text-gray-700">
                      <li>100% backed by real assets</li>
                      <li>Regular independent audits</li>
                      <li>Secure cold storage</li>
                      <li>Instant liquidity</li>
                      <li>Low transaction fees</li>
                    </ul>
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
