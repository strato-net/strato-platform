import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, Coins, DollarSign, Droplets, Settings, ArrowLeft, ToggleLeft, Cog, CreditCard, TrendingUp, Vote, Database, ChevronDown, ArrowRightLeft } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import CreateTokenForm from '@/components/admin/CreateTokenForm';
import CreatePoolForm from '@/components/admin/CreatePoolForm';
import SetAssetPriceForm from '@/components/admin/SetAssetPriceForm';
import TokenConfigTable from '@/components/admin/TokenConfigTable';
import TokenStatusTable from '@/components/admin/TokenStatusTable';
import SwapPoolsTable from '@/components/admin/SwapPoolsTable';
import LendingTab from '@/components/admin/LendingTab';
import CollateralConfigManager from '@/components/admin/CollateralConfigManager';
import VoteTab from '@/components/admin/VoteTab';
import BridgeTransactionsPage from '@/components/dashboard/BridgeTransactionsPage';

const Admin = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('tokens');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            <div className="flex items-center gap-2 md:space-x-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-1 md:space-x-2 px-2 md:px-3"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="text-xs md:text-sm">Back</span>
              </Button>
              <div className="flex items-center gap-1 md:space-x-2">
                <Shield className="h-5 w-5 md:h-6 md:w-6 text-strato-blue" />
                <h1 className="text-base md:text-xl font-bold whitespace-nowrap">Admin Panel</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <div className="mb-4 md:mb-8">
          <h2 className="text-xl md:text-3xl font-bold mb-1 md:mb-2 text-foreground">Platform Administration</h2>
          <p className="text-xs md:text-base text-muted-foreground">Manage tokens, pools, liquidity, and asset pricing</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6 ">
          <div className="w-full overflow-x-auto">
            <TabsList className="grid grid-cols-6 w-full min-w-[600px] md:min-w-0">
              <TabsTrigger value="pools" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <Droplets className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Create Pools</span>
                <span className="sm:hidden">Pools</span>
              </TabsTrigger>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-xs md:text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 space-x-1 md:space-x-2 ${
                      ['lending', 'configs'].includes(activeTab)
                        ? 'bg-background text-foreground shadow-sm dark:bg-muted dark:text-primary-foreground'
                        : 'hover:bg-muted hover:text-accent-foreground dark:hover:bg-muted/50 dark:hover:text-primary-foreground'
                    }`}
                  >
                    <TrendingUp className="h-3 w-3 md:h-4 md:w-4" />
                    <span className="hidden sm:inline">Lending</span>
                    <span className="sm:hidden">Lending</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setActiveTab('lending')}>
                    <TrendingUp className="h-4 w-4 mr-2" />
                    Lending Config
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTab('configs')}>
                    <Cog className="h-4 w-4 mr-2" />
                    Token Configs
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-xs md:text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 space-x-1 md:space-x-2 ${
                      ['tokens', 'pricing', 'status'].includes(activeTab)
                        ? 'bg-background text-foreground shadow-sm dark:bg-muted dark:text-primary-foreground'
                        : 'hover:bg-muted hover:text-accent-foreground dark:hover:bg-muted/50 dark:hover:text-primary-foreground'
                    }`}
                  >
                    <Settings className="h-3 w-3 md:h-4 md:w-4" />
                    <span className="hidden sm:inline">Token</span>
                    <span className="sm:hidden">Token</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setActiveTab('tokens')}>
                    <Coins className="h-4 w-4 mr-2" />
                    Create Tokens
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTab('pricing')}>
                    <DollarSign className="h-4 w-4 mr-2" />
                    Set Prices
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setActiveTab('status')}>
                    <ToggleLeft className="h-4 w-4 mr-2" />
                    Token Status
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <TabsTrigger value="cdp" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <Database className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">CDP Config</span>
                <span className="sm:hidden">CDP</span>
              </TabsTrigger>
              <TabsTrigger value="vote" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <Vote className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Vote on Issues</span>
                <span className="sm:hidden">Vote</span>
              </TabsTrigger>
              <TabsTrigger value="bridge" className="flex items-center space-x-1 md:space-x-2 text-xs md:text-sm">
                <ArrowRightLeft className="h-3 w-3 md:h-4 md:w-4" />
                <span className="hidden sm:inline">Bridge</span>
                <span className="sm:hidden">Bridge</span>
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
                <CreateTokenForm />
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
                <CreatePoolForm />
              </CardContent>
            </Card>
            <SwapPoolsTable />
          </TabsContent>

          <TabsContent value="lending" className="space-y-6">
            <LendingTab />
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
                <SetAssetPriceForm />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="configs" className="space-y-6">
            <TokenConfigTable />
          </TabsContent>

          <TabsContent value="status" className="space-y-6">
            <TokenStatusTable />
          </TabsContent>

          <TabsContent value="cdp" className="space-y-6">
            <CollateralConfigManager />
          </TabsContent>

          <TabsContent value="vote" className="space-y-6">
            <VoteTab />
          </TabsContent>
          <TabsContent value="bridge" className="space-y-6">
            <BridgeTransactionsPage isAdmin={true} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Admin;