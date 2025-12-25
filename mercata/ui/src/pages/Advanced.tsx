import { useState } from 'react';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import LendingPoolSection from '@/components/dashboard/LendingPoolSection';
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';
import LiquidationsSection from '@/components/dashboard/LiquidationsSection';
import SafetyModuleSection from '@/components/dashboard/SafetyModuleSection';
import MintWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BadDebtView from '@/components/cdp/BadDebtView';
import { useCDP } from '@/context/CDPContext';

const Advanced = () => {
  const [activeTab, setActiveTab] = useState<"lending" | "swap" | "liquidations" | "safety" | "mint">("mint");
  const [borrowActiveTab, setBorrowActiveTab] = useState<'vaults' | 'bad-debt' | 'liquidations'>('vaults');
  const { refreshVaults } = useCDP();
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);

  const handleBorrowSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
  };

  const handleVaultActionSuccess = () => {
    refreshVaults();
  };

  const mainTabs = [
    { value: 'mint', label: 'Mint', shortLabel: 'Mint' },
    { value: 'lending', label: 'Lending Pools', shortLabel: 'Lending' },
    { value: 'swap', label: 'Swap Pools', shortLabel: 'Swap' },
    { value: 'safety', label: 'Safety Module', shortLabel: 'Safety' },
    { value: 'liquidations', label: 'Liquidations', shortLabel: 'Liquidations' },
  ] as const;

  const mintSubTabs = [
    { value: 'vaults', label: 'Vaults' },
    { value: 'bad-debt', label: 'Bad Debt' },
    { value: 'liquidations', label: 'Liquidations' },
  ] as const;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />
      <MobileBottomNav />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Advanced" />
        
        <main className="p-3 md:p-6 max-w-7xl mx-auto">
          {/* Main Tabs - Underline Style */}
          <div className="flex border-b border-border mb-4 md:mb-6">
            {mainTabs.map(tab => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`flex-1 py-2.5 px-1.5 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                  activeTab === tab.value
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="hidden md:inline">{tab.label}</span>
                <span className="md:hidden">{tab.shortLabel}</span>
              </button>
            ))}
          </div>

          {/* Mint Tab Content */}
          {activeTab === 'mint' && (
            <>
              {/* Sub Tabs - Underline Style */}
              <div className="flex border-b border-border mb-4">
                {mintSubTabs.map(tab => (
                  <button
                    key={tab.value}
                    onClick={() => setBorrowActiveTab(tab.value)}
                    className={`flex-1 py-2.5 px-2 md:px-4 text-xs md:text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                      borrowActiveTab === tab.value
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {borrowActiveTab === 'vaults' && (
                <div className="space-y-4 md:space-y-6">
                  <div className="border border-border bg-card rounded-xl p-3 md:p-4 flex flex-col shadow-sm">
                    <MintWidget onSuccess={handleBorrowSuccess} />
                  </div>
                  <VaultsList 
                    refreshTrigger={vaultsRefreshTrigger} 
                    onVaultActionSuccess={handleVaultActionSuccess}
                  />
                </div>
              )}

              {borrowActiveTab === 'bad-debt' && <BadDebtView />}
              {borrowActiveTab === 'liquidations' && <LiquidationsView />}
            </>
          )}

          {activeTab === 'lending' && <LendingPoolSection />}
          {activeTab === 'swap' && <SwapPoolsSection />}
          {activeTab === 'safety' && <SafetyModuleSection />}
          {activeTab === 'liquidations' && <LiquidationsSection />}
        </main>
      </div>
    </div>
  );
};

export default Advanced;

