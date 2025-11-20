import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileSidebar from '../components/dashboard/MobileSidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, TrendingUp, Droplets, Users, Clock, PieChart, ArrowUpDown, CircleArrowDown, CircleArrowUp } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// Helper function to format currency values for mockup
const formatCurrency = (value: string, decimals: number = 2): string => {
  return parseFloat(value).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

const SwapPoolDetail = () => {
  const { poolId } = useParams();
  const navigate = useNavigate();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Mockup data - replace with actual API call
  const mockPoolData = {
    id: poolId,
    name: 'USDST/ETH',
    tokenA: {
      symbol: 'USDST',
      name: 'USD Stablecoin Token',
      address: '0x1234...',
      logo: 'https://via.placeholder.com/40/3b82f6/ffffff?text=U',
      reserve: '125000.50',
      price: '1.00'
    },
    tokenB: {
      symbol: 'ETH',
      name: 'Ethereum',
      address: '0x5678...',
      logo: 'https://via.placeholder.com/40/6366f1/ffffff?text=E',
      reserve: '42.75',
      price: '2923.45'
    },
    lpToken: {
      symbol: 'USDST-ETH-LP',
      totalSupply: '73182.25',
      userBalance: '150.50',
      userStaked: '120.00',
      userUnstaked: '30.50'
    },
    tvl: '250000.00',
    volume24h: '45678.90',
    volume7d: '312456.78',
    fees24h: '136.89',
    apy: '12.45',
    feeRate: '0.30',
    yourShare: '0.206',
    createdAt: '2024-01-15',
    transactions: [
      { type: 'Add', amount: '5000 USDST + 1.71 ETH', user: '0x1a2b...3c4d', time: '2 mins ago' },
      { type: 'Remove', amount: '2500 USDST + 0.85 ETH', user: '0x5e6f...7g8h', time: '15 mins ago' },
      { type: 'Swap', amount: '1000 USDST → 0.34 ETH', user: '0x9i0j...1k2l', time: '1 hour ago' },
      { type: 'Add', amount: '10000 USDST + 3.42 ETH', user: '0x3m4n...5o6p', time: '3 hours ago' },
    ]
  };

  // Mock chart data for liquidity over time
  const liquidityChartData = [
    { date: 'Jan 15', tvl: 180000, volume: 32000 },
    { date: 'Jan 16', tvl: 195000, volume: 38000 },
    { date: 'Jan 17', tvl: 210000, volume: 42000 },
    { date: 'Jan 18', tvl: 205000, volume: 35000 },
    { date: 'Jan 19', tvl: 225000, volume: 45000 },
    { date: 'Jan 20', tvl: 235000, volume: 48000 },
    { date: 'Jan 21', tvl: 250000, volume: 46000 },
  ];

  // Mock chart data for price ratio
  const priceChartData = [
    { date: 'Jan 15', price: 2850.25 },
    { date: 'Jan 16', price: 2875.50 },
    { date: 'Jan 17', price: 2920.75 },
    { date: 'Jan 18', price: 2895.00 },
    { date: 'Jan 19', price: 2910.25 },
    { date: 'Jan 20', price: 2935.50 },
    { date: 'Jan 21', price: 2923.45 },
  ];

  useEffect(() => {
    document.title = `${mockPoolData.name} Pool | STRATO Mercata`;
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title={`${mockPoolData.name} Pool`} onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          {/* Back Button */}
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard/pools/swap')}
            className="mb-4 hover:bg-gray-100"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Pools
          </Button>

          {/* Pool Header */}
          <Card className="mb-6">
            <CardContent className="p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center">
                  <div className="flex items-center -space-x-3 mr-4">
                    <img
                      src={mockPoolData.tokenA.logo}
                      alt={mockPoolData.tokenA.symbol}
                      className="w-12 h-12 rounded-full border-2 border-white z-10"
                    />
                    <img
                      src={mockPoolData.tokenB.logo}
                      alt={mockPoolData.tokenB.symbol}
                      className="w-12 h-12 rounded-full border-2 border-white"
                    />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">{mockPoolData.name}</h1>
                    <p className="text-sm text-gray-500">
                      {mockPoolData.tokenA.name} / {mockPoolData.tokenB.name}
                    </p>
                  </div>
                </div>
                <div className="flex space-x-3">
                  <Button className="bg-strato-blue hover:bg-strato-blue/90">
                    <CircleArrowDown className="mr-2 h-4 w-4" />
                    Add Liquidity
                  </Button>
                  <Button variant="outline" className="border-strato-blue text-strato-blue hover:bg-strato-blue/10">
                    <CircleArrowUp className="mr-2 h-4 w-4" />
                    Remove Liquidity
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-500 flex items-center">
                  <Droplets className="mr-2 h-4 w-4" />
                  Total Value Locked
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${formatCurrency(mockPoolData.tvl)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-500 flex items-center">
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Volume (24h)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${formatCurrency(mockPoolData.volume24h)}</p>
                <p className="text-xs text-gray-500 mt-1">7d: ${formatCurrency(mockPoolData.volume7d)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-500 flex items-center">
                  <PieChart className="mr-2 h-4 w-4" />
                  APY
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-green-600">{mockPoolData.apy}%</p>
                <p className="text-xs text-gray-500 mt-1">Fee: {mockPoolData.feeRate}%</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-500 flex items-center">
                  <Users className="mr-2 h-4 w-4" />
                  Your Share
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{mockPoolData.yourShare}%</p>
                <p className="text-xs text-gray-500 mt-1">Fees earned: ${mockPoolData.fees24h}</p>
              </CardContent>
            </Card>
          </div>

          {/* Pool Analytics Chart */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Pool Analytics</CardTitle>
              <CardDescription>Historical data for liquidity, volume, and price</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="liquidity" className="w-full">
                <TabsList className="grid w-full grid-cols-3 max-w-md">
                  <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
                  <TabsTrigger value="volume">Volume</TabsTrigger>
                  <TabsTrigger value="price">Price Ratio</TabsTrigger>
                </TabsList>

                <TabsContent value="liquidity" className="mt-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={liquidityChartData}>
                      <defs>
                        <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" stroke="#6b7280" />
                      <YAxis
                        stroke="#6b7280"
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, 'TVL']}
                      />
                      <Area
                        type="monotone"
                        dataKey="tvl"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorTvl)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </TabsContent>

                <TabsContent value="volume" className="mt-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={liquidityChartData}>
                      <defs>
                        <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" stroke="#6b7280" />
                      <YAxis
                        stroke="#6b7280"
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, 'Volume']}
                      />
                      <Area
                        type="monotone"
                        dataKey="volume"
                        stroke="#10b981"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorVolume)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </TabsContent>

                <TabsContent value="price" className="mt-6">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={priceChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="date" stroke="#6b7280" />
                      <YAxis
                        stroke="#6b7280"
                        domain={['dataMin - 50', 'dataMax + 50']}
                        tickFormatter={(value) => `$${value.toFixed(0)}`}
                      />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                        formatter={(value: number) => [`$${value.toFixed(2)}`, `1 ${mockPoolData.tokenA.symbol}`]}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={{ fill: '#6366f1', r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Pool Composition */}
            <Card>
              <CardHeader>
                <CardTitle>Pool Composition</CardTitle>
                <CardDescription>Current token reserves in the pool</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <img
                      src={mockPoolData.tokenA.logo}
                      alt={mockPoolData.tokenA.symbol}
                      className="w-8 h-8 rounded-full mr-3"
                    />
                    <div>
                      <p className="font-medium">{mockPoolData.tokenA.symbol}</p>
                      <p className="text-xs text-gray-500">{mockPoolData.tokenA.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(mockPoolData.tokenA.reserve)}</p>
                    <p className="text-xs text-gray-500">${formatCurrency((parseFloat(mockPoolData.tokenA.reserve) * parseFloat(mockPoolData.tokenA.price)).toString())}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <img
                      src={mockPoolData.tokenB.logo}
                      alt={mockPoolData.tokenB.symbol}
                      className="w-8 h-8 rounded-full mr-3"
                    />
                    <div>
                      <p className="font-medium">{mockPoolData.tokenB.symbol}</p>
                      <p className="text-xs text-gray-500">{mockPoolData.tokenB.name}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(mockPoolData.tokenB.reserve, 4)}</p>
                    <p className="text-xs text-gray-500">${formatCurrency((parseFloat(mockPoolData.tokenB.reserve) * parseFloat(mockPoolData.tokenB.price)).toString())}</p>
                  </div>
                </div>

                <div className="pt-4 border-t">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Pool Ratio</span>
                    <span className="font-medium">
                      1 {mockPoolData.tokenA.symbol} = {(parseFloat(mockPoolData.tokenB.reserve) / parseFloat(mockPoolData.tokenA.reserve)).toFixed(6)} {mockPoolData.tokenB.symbol}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Your Position */}
            <Card>
              <CardHeader>
                <CardTitle>Your Position</CardTitle>
                <CardDescription>Your liquidity and earnings in this pool</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">LP Tokens</span>
                    <span className="font-medium">{formatCurrency(mockPoolData.lpToken.userBalance)} {mockPoolData.lpToken.symbol}</span>
                  </div>
                  <div className="flex justify-between items-center pl-4">
                    <span className="text-xs text-gray-400">• Staked</span>
                    <span className="text-sm">{formatCurrency(mockPoolData.lpToken.userStaked)}</span>
                  </div>
                  <div className="flex justify-between items-center pl-4">
                    <span className="text-xs text-gray-400">• Unstaked</span>
                    <span className="text-sm">{formatCurrency(mockPoolData.lpToken.userUnstaked)}</span>
                  </div>
                </div>

                <div className="pt-4 border-t space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Pooled {mockPoolData.tokenA.symbol}</span>
                    <span className="font-medium">{formatCurrency((parseFloat(mockPoolData.lpToken.userBalance) / parseFloat(mockPoolData.lpToken.totalSupply) * parseFloat(mockPoolData.tokenA.reserve)).toString())}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Pooled {mockPoolData.tokenB.symbol}</span>
                    <span className="font-medium">{formatCurrency((parseFloat(mockPoolData.lpToken.userBalance) / parseFloat(mockPoolData.lpToken.totalSupply) * parseFloat(mockPoolData.tokenB.reserve)).toString(), 4)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Your Pool Share</span>
                    <span className="font-medium text-strato-blue">{mockPoolData.yourShare}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Transactions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Clock className="mr-2 h-5 w-5" />
                Recent Transactions
              </CardTitle>
              <CardDescription>Latest activity in this pool</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mockPoolData.transactions.map((tx, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-full ${
                        tx.type === 'Add' ? 'bg-green-100 text-green-600' :
                        tx.type === 'Remove' ? 'bg-red-100 text-red-600' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {tx.type === 'Add' ? <CircleArrowDown className="h-4 w-4" /> :
                         tx.type === 'Remove' ? <CircleArrowUp className="h-4 w-4" /> :
                         <ArrowUpDown className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{tx.type} Liquidity</p>
                        <p className="text-xs text-gray-500">{tx.amount}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">{tx.user}</p>
                      <p className="text-xs text-gray-400">{tx.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
};

export default SwapPoolDetail;
