import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronLeft, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  ChartContainer, 
  ChartTooltip, 
  ChartTooltipContent
} from "@/components/ui/chart";
import { 
  Area, 
  AreaChart, 
  ResponsiveContainer, 
  XAxis, 
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";

interface Asset {
  id: string;
  name: string;
  symbol: string;
  price: string;
  priceUSDT?: string;
  deposit: string;
  image: string;
  description: string;
  color: string;
  logoText: string;
  available: boolean;
  soldOut?: boolean;
  provider?: string;
  vaulter?: string;
  detailedDescription?: string;
}

// Mock price data for the chart
const generatePriceData = (basePrice: number, days: number = 30) => {
  const data = [];
  let currentPrice = basePrice;
  
  for (let i = 0; i < days; i++) {
    // Random price fluctuation between -2% and +2%
    const change = currentPrice * (Math.random() * 0.04 - 0.02);
    currentPrice += change;
    
    data.push({
      date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000).toLocaleDateString(),
      price: currentPrice.toFixed(2),
    });
  }
  
  return data;
};

const assets: Asset[] = [
  {
    id: '1',
    name: 'GOLDST',
    symbol: 'GOLDST',
    price: '$3349.99',
    priceUSDT: '3349.99 USDT',
    deposit: '$71,800.37',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'GOLDST is a secure, blockchain-based gold investment product',
    detailedDescription: 'GOLDST represents a tokenized version of physical gold stored in secure vaults. Each token is backed 1:1 by real gold, providing investors with a safe and liquid way to gain exposure to gold markets without the hassle of physical storage. The tokens are fully audited and insured, with regular verification of the underlying assets.',
    color: '#DAA520',
    logoText: 'G',
    available: true,
    provider: 'GoldSecure Inc.',
    vaulter: 'HSBC Vault Services'
  },
  {
    id: '2',
    name: 'Ethereum Staking Token',
    symbol: 'ETHST',
    price: '$1838.78',
    priceUSDT: '1838.78 USDT',
    deposit: '$121,438.08',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'Ethereum Staking on Mercata',
    detailedDescription: 'ETHST allows users to participate in Ethereum staking without running a validator node. By holding ETHST, you earn rewards from the Ethereum network while maintaining liquidity. The token is backed by ETH staked on the Ethereum 2.0 network, with rewards automatically distributed to token holders proportional to their holdings.',
    color: '#3671E3',
    logoText: 'ETH',
    available: true,
    provider: 'Ethereum Foundation',
    vaulter: 'Coinbase Custody'
  },
  {
    id: '3',
    name: 'Silver - Fractional',
    symbol: 'Silver',
    price: '$33.84',
    priceUSDT: '33.84 USDT',
    deposit: '$135,089.70',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'Silver offers the benefits of being a safe haven asset',
    detailedDescription: 'Silver Fractional is a tokenized representation of physical silver, allowing investors to own fractions of silver bars stored in secure vaults. This provides unprecedented accessibility to silver markets with minimal investment requirements. Each token represents 1 gram of 99.9% pure silver, fully backed and independently audited on a quarterly basis.',
    color: '#C0C0C0',
    logoText: 'AG',
    available: true,
    provider: 'Silver Standard Corp.',
    vaulter: 'Brinks Secure Storage'
  },
  {
    id: '4',
    name: 'WBTCST',
    symbol: 'WBTCST',
    price: '$96291.19',
    priceUSDT: '96291.19 USDT',
    deposit: '$58,670.02',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'WBTCST is a digital asset on STRATO',
    detailedDescription: 'WBTCST is a wrapped Bitcoin token on the STRATO blockchain, providing Bitcoin holders with access to the STRATO DeFi ecosystem. Each WBTCST token is backed 1:1 by Bitcoin held in multi-signature wallets managed by a consortium of trusted custodians. Regular proof-of-reserves audits ensure full transparency and trust in the backing assets.',
    color: '#F7931A',
    logoText: 'BTC',
    available: true,
    provider: 'BitGo',
    vaulter: 'Genesis Trading'
  },
  {
    id: '5',
    name: 'USDTST',
    symbol: 'USDTST',
    price: 'No Price Available',
    deposit: '$2.71',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'USDTST is a digital asset on STRATO',
    detailedDescription: 'USDTST is the STRATO blockchain version of the popular USDT stablecoin. Each token is backed 1:1 by US Dollars held in reserve by Tether, providing a stable unit of account on the STRATO blockchain. USDTST enables fast, low-cost transactions with the stability of the US dollar.',
    color: '#26A17B',
    logoText: 'T',
    available: false,
    soldOut: true,
    provider: 'Tether Operations',
    vaulter: 'Prime Trust'
  },
  {
    id: '6',
    name: 'USDCST',
    symbol: 'USDCST',
    price: 'No Price Available',
    deposit: '$9.12',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'USDCST is a digital asset on STRATO',
    detailedDescription: 'USDCST brings the stability and reliability of USDC to the STRATO blockchain. Each token is backed 1:1 by US Dollars held in regulated financial institutions. USDCST undergoes regular audits to ensure full reserves, providing users with transparency and confidence in their stablecoin holdings.',
    color: '#2775CA',
    logoText: '$',
    available: false,
    soldOut: true,
    provider: 'Circle Financial',
    vaulter: 'Signature Bank'
  },
  {
    id: '7',
    name: 'PAXGST',
    symbol: 'PAXGST',
    price: 'No Price Available',
    deposit: '$7.44',
    image: '/lovable-uploads/e84dd071-eaba-4a52-82d6-8c9f36a7fa3a.png',
    description: 'PAXGST is a digital asset on STRATO',
    detailedDescription: 'PAXGST is a gold-backed token on the STRATO blockchain, where each token represents one fine troy ounce of a London Good Delivery gold bar, stored in professional vaults. The token combines the benefits of physical gold ownership with the speed and mobility of a digital asset, all while maintaining full physical backing verified through regular audits.',
    color: '#F2C94C',
    logoText: 'PAX',
    available: false,
    soldOut: true,
    provider: 'Paxos Trust Company',
    vaulter: 'Loomis International'
  }
];

const AssetDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [isWalletConnected, setIsWalletConnected] = useState(false);
  const { toast } = useToast();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [priceData, setPriceData] = useState<any[]>([]);

  useEffect(() => {
    // Find the asset with the matching id
    const foundAsset = assets.find(a => a.id === id);
    if (foundAsset) {
      setAsset(foundAsset);
      document.title = `${foundAsset.name} | Asset Details`;

      // Generate price data if the asset has a numeric price
      if (foundAsset.priceUSDT) {
        const basePrice = parseFloat(foundAsset.priceUSDT.split(' ')[0]);
        if (!isNaN(basePrice)) {
          setPriceData(generatePriceData(basePrice));
        }
      }
    }
  }, [id]);

  const handleConnectWallet = () => {
    toast({
      title: "Wallet Connected",
      description: "Your Ethereum wallet has been connected successfully.",
    });
    setIsWalletConnected(true);
  };

  const handleBuyNow = () => {
    if (!isWalletConnected) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: `${asset?.name} Purchase`,
      description: `You're about to purchase ${asset?.name}.`,
    });
  };

  const handleBridge = () => {
    if (!isWalletConnected) {
      toast({
        title: "Wallet Required",
        description: "Please connect your wallet first.",
        variant: "destructive",
      });
      return;
    }
    
    toast({
      title: `${asset?.name} Bridge`,
      description: `You're about to bridge ${asset?.name}.`,
    });
  };

  if (!asset) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <DashboardSidebar />
        <div className="flex-1 ml-64">
          <DashboardHeader title="Asset Not Found" />
          <main className="p-6">
            <div className="text-center py-12">
              <h2 className="text-2xl font-bold mb-4">Asset Not Found</h2>
              <p className="text-gray-600 mb-6">The asset you are looking for does not exist or has been removed.</p>
              <Link to="/dashboard/assets">
                <Button>Back to Assets</Button>
              </Link>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <DashboardSidebar />
      
      <div className="flex-1 ml-64">
        <DashboardHeader title={`${asset.symbol} Details`} />
        
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
                      <p className="text-sm font-semibold text-blue-600">{asset.symbol}</p>
                      <CardTitle className="text-xl">{asset.name}</CardTitle>
                    </div>
                    <div 
                      className="w-16 h-16 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ backgroundColor: asset.color }}
                    >
                      {asset.logoText}
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="flex justify-center mb-6">
                    <div 
                      className="w-32 h-32 rounded-full bg-white border-4 flex items-center justify-center overflow-hidden"
                      style={{ borderColor: asset.color }}
                    >
                      <img 
                        src={asset.image} 
                        alt={asset.name} 
                        className="w-full h-full object-contain"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Current Price:</span>
                      <span className="font-medium">
                        {asset.price}
                        {asset.priceUSDT && (
                          <span className="text-xs text-gray-400 ml-1">({asset.priceUSDT})</span>
                        )}
                      </span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Asset Deposits:</span>
                      <span className="font-medium">{asset.deposit}</span>
                    </div>
                    
                    {asset.available ? (
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
                      <span className="font-medium">{asset.provider}</span>
                    </div>
                    
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Vault Service:</span>
                      <span className="font-medium">{asset.vaulter}</span>
                    </div>
                  </div>
                  
                  {!isWalletConnected ? (
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
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <Button 
                      onClick={handleBuyNow}
                      disabled={!asset.available || !isWalletConnected}
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
                  </div>
                </CardContent>
              </Card>
            </div>
            
            {/* Charts and Description */}
            <div className="lg:col-span-2">
              <Card className="mb-6">
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
                              light: asset.color,
                              dark: asset.color,
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
                                <stop offset="5%" stopColor={asset.color} stopOpacity={0.8}/>
                                <stop offset="95%" stopColor={asset.color} stopOpacity={0}/>
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
                              tickFormatter={(value) => `$${value}`}
                            />
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <ChartTooltip 
                              content={<ChartTooltipContent />} 
                            />
                            <Area 
                              type="monotone" 
                              dataKey="price" 
                              name="Price"
                              stroke={asset.color} 
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
                  <CardTitle>About {asset.name}</CardTitle>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-gray-700 leading-relaxed">
                      {asset.detailedDescription || asset.description}
                    </p>
                    {!asset.detailedDescription && (
                      <p className="text-gray-700 leading-relaxed">
                        {asset.description} Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
                        Nullam at justo vel nisi fermentum ultricies. Sed auctor, tortor vel ullamcorper 
                        sagittis, nulla nisi congue velit, id commodo est turpis eget libero. Vivamus 
                        ultrices fermentum metus, vel congue magna tincidunt a. Proin eu nulla vitae 
                        magna laoreet volutpat eget vel nulla.
                      </p>
                    )}
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
