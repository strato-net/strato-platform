import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useUser } from '@/context/UserContext';
import Vaults from './Vaults';
import BadDebtView from '../../BadDebtView';
import LiquidationsView from '../../LiquidationsView';
import { useCDP } from '@/context/CDPContext';
import { useUserTokens } from '@/context/UserTokensContext';
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';

const CDP = () => {
  const navigate = useNavigate();
  const { userName } = useUser();
  const [activeTab, setActiveTab] = useState<'vaults' | 'bad-debt' | 'liquidations'>('vaults');
  const [refreshKey, setRefreshKey] = useState(0);
  const { refreshVaults } = useCDP();
  const { fetchTokens } = useUserTokens();
  const { refetch: refetchRewards } = useRewardsUserInfo();

  const handleRefresh = useCallback(async () => {
    setRefreshKey(prev => prev + 1);
    await Promise.all([
      refreshVaults(),
      fetchTokens(),
      refetchRewards(),
    ]);
  }, [refreshVaults, fetchTokens, refetchRewards]);

  const handleMintSuccess = useCallback(async () => {
    await handleRefresh();
  }, [handleRefresh]);

  const handleVaultActionSuccess = useCallback(async () => {
    await handleRefresh();
  }, [handleRefresh]);

  const userInitials = userName ? userName.substring(0, 2).toUpperCase() : 'VI';

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-background border-b border-border py-4 px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="p-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold">Advanced</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="p-2"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Avatar className="w-8 h-8 bg-strato-blue cursor-pointer">
            <AvatarFallback className="text-white text-xs bg-strato-blue">
              {userInitials}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Navigation Tabs and Main Content */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <div className="border-b border-border px-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="vaults">Vaults</TabsTrigger>
            <TabsTrigger value="bad-debt">Bad Debt</TabsTrigger>
            <TabsTrigger value="liquidations">Liquidations</TabsTrigger>
          </TabsList>
        </div>

        <main className="px-6 pt-6 pb-6 max-w-7xl mx-auto">
          <TabsContent value="vaults" className="mt-0">
            <Vaults
              refreshKey={refreshKey}
              onMintSuccess={handleMintSuccess}
              onVaultActionSuccess={handleVaultActionSuccess}
            />
          </TabsContent>

          <TabsContent value="bad-debt" className="mt-0">
            <BadDebtView />
          </TabsContent>

          <TabsContent value="liquidations" className="mt-0">
            <LiquidationsView />
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
};

export default CDP;
