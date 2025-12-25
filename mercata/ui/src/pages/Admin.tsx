import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Coins, DollarSign, Droplets, Settings, ArrowLeft, ToggleLeft, Cog, TrendingUp, Vote, Database, ChevronDown, ArrowRightLeft } from 'lucide-react';
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
        <div className="container mx-auto px-3 md:px-6 lg:px-8">
          <div className="flex items-center h-14 md:h-16 gap-2 md:gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/dashboard')}
              className="flex items-center p-1.5 md:p-2 h-auto"
            >
              <ArrowLeft className="h-4 w-4 md:h-5 md:w-5" />
              <span className="hidden md:inline ml-2">Back to Dashboard</span>
            </Button>
            <div className="flex items-center gap-1.5 md:gap-2">
              <Shield className="h-5 w-5 md:h-6 md:w-6 text-strato-blue shrink-0" />
              <h1 className="text-base md:text-xl font-bold whitespace-nowrap">Admin Panel</h1>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-3 md:px-6 lg:px-8 py-4 md:py-8">
        <div className="mb-4 md:mb-6">
          <h2 className="text-xl md:text-3xl font-bold mb-1 md:mb-2 text-foreground">Platform Administration</h2>
          <p className="text-xs md:text-base text-muted-foreground">Manage tokens, pools, liquidity, and asset pricing</p>
        </div>

        {/* Underline Tabs */}
        <div className="flex border-b border-border mb-4 md:mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('pools')}
            className={`flex items-center gap-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === 'pools'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Droplets className="h-3 w-3 md:h-4 md:w-4" />
            <span className="hidden sm:inline">Pools</span>
            <span className="sm:hidden">Pools</span>
          </button>
          
          {/* Lending Dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                className={`flex items-center gap-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  ['lending', 'configs'].includes(activeTab)
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <TrendingUp className="h-3 w-3 md:h-4 md:w-4" />
                <span>Lending</span>
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
          
          {/* Token Dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                className={`flex items-center gap-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  ['tokens', 'pricing', 'status'].includes(activeTab)
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Settings className="h-3 w-3 md:h-4 md:w-4" />
                <span>Token</span>
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
          
          <button
            onClick={() => setActiveTab('cdp')}
            className={`flex items-center gap-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === 'cdp'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Database className="h-3 w-3 md:h-4 md:w-4" />
            <span>CDP</span>
          </button>
          
          <button
            onClick={() => setActiveTab('vote')}
            className={`flex items-center gap-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === 'vote'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Vote className="h-3 w-3 md:h-4 md:w-4" />
            <span>Vote</span>
          </button>
          
          <button
            onClick={() => setActiveTab('bridge')}
            className={`flex items-center gap-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === 'bridge'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <ArrowRightLeft className="h-3 w-3 md:h-4 md:w-4" />
            <span>Bridge</span>
          </button>
        </div>

        {/* Tab Contents */}
        {activeTab === 'tokens' && (
          <div className="space-y-4 md:space-y-6">
            <Card className="rounded-lg md:rounded-xl">
              <CardHeader className="px-4 md:px-6">
                <CardTitle className="text-base md:text-lg">Create New Token</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Deploy a new ERC20 token on the STRATO blockchain
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 md:px-6">
                <CreateTokenForm />
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'pools' && (
          <div className="space-y-4 md:space-y-6">
            <Card className="rounded-lg md:rounded-xl">
              <CardHeader className="px-4 md:px-6">
                <CardTitle className="text-base md:text-lg">Create Swap Pool</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Select pairing tokens and set initial liquidity
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 md:px-6">
                <CreatePoolForm />
              </CardContent>
            </Card>
            <SwapPoolsTable />
          </div>
        )}

        {activeTab === 'lending' && (
          <div className="space-y-4 md:space-y-6">
            <LendingTab />
          </div>
        )}

        {activeTab === 'pricing' && (
          <div className="space-y-4 md:space-y-6">
            <Card className="rounded-lg md:rounded-xl">
              <CardHeader className="px-4 md:px-6">
                <CardTitle className="text-base md:text-lg">Set Asset Prices</CardTitle>
                <CardDescription className="text-xs md:text-sm">
                  Configure oracle pricing for assets
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4 md:px-6">
                <SetAssetPriceForm />
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'configs' && (
          <div className="space-y-4 md:space-y-6">
            <TokenConfigTable />
          </div>
        )}

        {activeTab === 'status' && (
          <div className="space-y-4 md:space-y-6">
            <TokenStatusTable />
          </div>
        )}

        {activeTab === 'cdp' && (
          <div className="space-y-4 md:space-y-6">
            <CollateralConfigManager />
          </div>
        )}

        {activeTab === 'vote' && (
          <div className="space-y-4 md:space-y-6">
            <VoteTab />
          </div>
        )}

        {activeTab === 'bridge' && (
          <div className="space-y-4 md:space-y-6">
            <BridgeTransactionsPage isAdmin={true} />
          </div>
        )}
      </div>
    </div>
  );
};

export default Admin;