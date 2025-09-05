import { useState, Suspense, lazy } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Coins, DollarSign, Droplets, Settings, ArrowLeft, ToggleLeft, Cog, CreditCard, TrendingUp } from 'lucide-react';

// Lazy load admin components
const CreateTokenForm = lazy(() => import('@/components/admin/CreateTokenForm'));
const CreatePoolForm = lazy(() => import('@/components/admin/CreatePoolForm'));
const SetAssetPriceForm = lazy(() => import('@/components/admin/SetAssetPriceForm'));
const TokenConfigTable = lazy(() => import('@/components/admin/TokenConfigTable'));
const TokenStatusTable = lazy(() => import('@/components/admin/TokenStatusTable'));
const SwapPoolsTable = lazy(() => import('@/components/admin/SwapPoolsTable'));
const LendingTab = lazy(() => import('@/components/admin/LendingTab'));

const Admin = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('tokens');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/dashboard')}
                className="flex items-center space-x-2"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Dashboard</span>
              </Button>
              <div className="flex items-center space-x-2">
                <Shield className="h-6 w-6 text-strato-blue" />
                <h1 className="text-xl font-bold">Admin Panel</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Platform Administration</h2>
          <p className="text-gray-600">Manage tokens, pools, liquidity, and asset pricing</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="w-full overflow-x-auto">
            <TabsList className="grid grid-cols-7 w-full max-w-7xl min-w-[900px] md:min-w-0">
              <TabsTrigger value="tokens" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <Coins className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Create Tokens</span>
                <span className="sm:hidden">Tokens</span>
              </TabsTrigger>
              <TabsTrigger value="pools" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <Droplets className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Create Pools</span>
                <span className="sm:hidden">Pools</span>
              </TabsTrigger>
              <TabsTrigger value="lending" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <TrendingUp className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Lending</span>
                <span className="sm:hidden">Lending</span>
              </TabsTrigger>
              <TabsTrigger value="pricing" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <DollarSign className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Set Prices</span>
                <span className="sm:hidden">Prices</span>
              </TabsTrigger>
              <TabsTrigger value="configs" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <Cog className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Token Configs</span>
                <span className="sm:hidden">Configs</span>
              </TabsTrigger>
              <TabsTrigger value="status" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <ToggleLeft className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Token Status</span>
                <span className="sm:hidden">Status</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="tokens" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Create New Token</CardTitle>
                <CardDescription>
                  Deploy a new ERC20 token on the STRATO blockchain
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<div className="h-96 bg-gray-200 rounded animate-pulse"></div>}>
                  <CreateTokenForm />
                </Suspense>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pools" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Create Swap Pool</CardTitle>
                <CardDescription>
                  Select pairing  tokens and set initial liquidity
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<div className="h-64 bg-gray-200 rounded animate-pulse"></div>}>
                  <CreatePoolForm />
                </Suspense>
              </CardContent>
            </Card>
            <Suspense fallback={<div className="h-96 bg-gray-200 rounded animate-pulse"></div>}>
              <SwapPoolsTable />
            </Suspense>
          </TabsContent>

          <TabsContent value="lending" className="space-y-6">
            <Suspense fallback={<div className="h-96 bg-gray-200 rounded animate-pulse"></div>}>
              <LendingTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="pricing" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Set Asset Prices</CardTitle>
                <CardDescription>
                  Configure oracle pricing for assets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Suspense fallback={<div className="h-64 bg-gray-200 rounded animate-pulse"></div>}>
                  <SetAssetPriceForm />
                </Suspense>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configs" className="space-y-6">
            <Suspense fallback={<div className="h-96 bg-gray-200 rounded animate-pulse"></div>}>
              <TokenConfigTable />
            </Suspense>
          </TabsContent>

          <TabsContent value="status" className="space-y-6">
            <Suspense fallback={<div className="h-96 bg-gray-200 rounded animate-pulse"></div>}>
              <TokenStatusTable />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;