import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import DashboardHeader from '../components/dashboard/DashboardHeader';
import DashboardSidebar from '../components/dashboard/DashboardSidebar';
import MobileBottomNav from '../components/dashboard/MobileBottomNav';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import SwapPoolsSection from '@/components/dashboard/SwapPoolsSection';
import BadDebtView from '@/components/cdp/BadDebtView';
import { useUser } from '@/context/UserContext';
import GuestSignInBanner from '@/components/ui/GuestSignInBanner';
import DirectMintPSMSection from '@/components/dashboard/DirectMintPSMSection';
import VaultOverview from '@/components/vault/VaultOverview';
import VaultUserPosition from '@/components/vault/VaultUserPosition';
import VaultTransactions from '@/components/vault/VaultTransactions';
import VaultUserActivity from '@/components/vault/VaultUserActivity';
import VaultDepositModal from '@/components/vault/VaultDepositModal';
import VaultWithdrawModal from '@/components/vault/VaultWithdrawModal';
import { useVaultContext } from '@/context/VaultContext';

// Hidden imports - temporarily disabled 
// import LiquidationsSection from '@/components/dashboard/LiquidationsSection';
// import SafetyModuleSection from '@/components/dashboard/SafetyModuleSection';
// import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
// import { CardHeader, CardTitle } from "@/components/ui/card";
// import LendingPoolSection from '@/components/dashboard/LendingPoolSection';
// import { safeParseUnits } from "@/utils/numberUtils";
// import { formatUnits } from "ethers";
// import { useToast } from "@/hooks/use-toast";
// import { useLendingContext } from "@/context/LendingContext";
// import { useTokenContext } from "@/context/TokenContext";
// import { CollateralData } from "@/interface";
// import PositionSection from "@/components/Positions";
// import CollateralModal from "@/components/borrow/CollateralModal";
// import { WITHDRAW_COLLATERAL_FEE, SUPPLY_COLLATERAL_FEE } from "@/lib/constants";
// import BorrowForm from "@/components/borrow/BorrowForm";
// import RepayForm from "@/components/borrow/RepayForm";
// import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";
// import { useSmartPolling } from "@/hooks/useSmartPolling";
// import LiquidationAlertBanner from '@/components/ui/LiquidationAlertBanner';

type TopTab = "swap" | "vault" | "psm" | "bad-debt";
// Hidden type - temporarily disabled 
// type TopTab = "borrow" | "lending" | "swap" | "liquidations" | "safety" | "psm" | "vault";

const Advanced = () => {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<TopTab>("swap");
  const { isLoggedIn } = useUser();
  const [isVaultDepositOpen, setIsVaultDepositOpen] = useState(false);
  const [isVaultWithdrawOpen, setIsVaultWithdrawOpen] = useState(false);
  const { refreshVault } = useVaultContext();

  const guestMode = !isLoggedIn;

  useEffect(() => {
    const tabParam = searchParams.get('tab');

    if (tabParam && ['swap', 'vault', 'psm', 'bad-debt'].includes(tabParam)) {
      setActiveTab(tabParam as TopTab);
    }
  }, [searchParams]);

  /* Hidden state and functions - temporarily disabled 
  const [borrowActiveTab, setBorrowActiveTab] = useState<"borrow" | "repay">("borrow");
  const { userAddress } = useUser();
  const { toast } = useToast();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

  useEffect(() => {
    const subtabParam = searchParams.get('subtab');
    if (subtabParam && ['borrow', 'repay'].includes(subtabParam)) {
      setBorrowActiveTab(subtabParam as "borrow" | "repay");
    }
  }, [searchParams]);

  const {
    refreshLoans,
    loans,
    borrowAsset: borrowAssetFn,
    collateralInfo,
    loadingCollateral,
    refreshCollateral,
    supplyCollateral,
    withdrawCollateral,
    repayLoan: repayLoanFn,
    repayAll,
    withdrawCollateralMax,
    borrowMax
  } = useLendingContext();

  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "supply" | "withdraw" | null;
  }>({ isOpen: false, type: null });
  const [modalLoading, setModalLoading] = useState(false);
  const [repayLoading, setRepayLoading] = useState(false);

  const { startPolling, stopPolling } = useSmartPolling({
    fetchFn: fetchUsdstBalance,
    shouldPoll: () => isLoggedIn,
    interval: 10000,
    onError: (error) => console.error("Balance polling error:", error)
  });

  useEffect(() => {
    if (!isLoggedIn) return;
    const refreshData = async () => {
      try {
        await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
      } catch (error) {
        console.error("Error refreshing data:", error);
      }
    };
    refreshData();
  }, [userAddress, isLoggedIn, refreshLoans, refreshCollateral, fetchUsdstBalance]);

  const handleSupply = (asset: CollateralData) => {
    setSelectedAsset(asset);
    setModalState({ isOpen: true, type: "supply" });
  };

  const handleWithdraw = (asset: CollateralData) => {
    setSelectedAsset(asset);
    setModalState({ isOpen: true, type: "withdraw" });
  };

  const closeModal = () => {
    setSelectedAsset(null);
    setModalState({ isOpen: false, type: null });
  };

  const executeSupply = async (asset: CollateralData, amount: string) => {
    try {
      setModalLoading(true);
      await supplyCollateral({ asset: asset.address, amount: safeParseUnits(amount).toString() });
      toast({ title: "Supply Initiated", description: `You supplied ${amount} ${asset._symbol}`, variant: "success" });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
    }
  };

  const executeWithdraw = async (asset: CollateralData, amount: string) => {
    try {
      setModalLoading(true);
      if (amount === 'ALL') {
        await withdrawCollateralMax({ asset: asset.address });
      } else {
        await withdrawCollateral({ asset: asset.address, amount: safeParseUnits(amount).toString() });
      }
      toast({ title: "Withdraw Initiated", description: `Withdrawal submitted: ${amount === 'ALL' ? 'max available' : amount} ${asset._symbol}`, variant: "success" });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
    }
  };

  const executeEmbeddedBorrow = async (amount: string) => {
    try {
      setBorrowLoading(true);
      if (amount === 'ALL') {
        await borrowMax();
        toast({ title: "Borrow Initiated", description: `Borrowed max available USDST`, variant: "success" });
      } else {
        await borrowAssetFn({ amount: safeParseUnits(amount).toString() });
        toast({ title: "Borrow Initiated", description: `You borrowed ${amount} USDST`, variant: "success" });
      }
      setBorrowLoading(false);
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      setBorrowLoading(false);
      throw error;
    }
  };

  const executeEmbeddedRepay = async (amount: string) => {
    try {
      setRepayLoading(true);
      if (amount === 'ALL') {
        const res = await repayAll();
        const sent = res?.estimatedDebtAtRead ? formatUnits(BigInt(res.estimatedDebtAtRead)) : 'all';
        toast({ title: "Success", description: `Successfully repaid ${sent} USDST`, variant: "success" });
      } else {
        const res = await repayLoanFn({ amount: safeParseUnits(amount).toString() } as any);
        const sent = res?.amountSent ? formatUnits(BigInt(res.amountSent)) : amount;
        toast({ title: "Success", description: `Successfully repaid ${sent} USDST`, variant: "success" });
      }
      setRepayLoading(false);
      await Promise.all([refreshLoans(), refreshCollateral(), fetchUsdstBalance()]);
    } catch (error) {
      console.error("Error repaying loan:", error);
      setRepayLoading(false);
    }
  };
  */

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: 'var(--sidebar-width, 0px)' }}>
        <DashboardHeader title="Advanced" />
        
        <main className="px-3 md:px-6 pt-2 md:pt-3 pb-2 md:pb-6 max-w-7xl mx-auto">
          <Card className="mb-2 md:mb-6 bg-transparent border-0 rounded-none shadow-none">
            <CardContent className="p-0 md:pt-4">
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TopTab)} className="w-full">
                <TabsList className="grid w-full grid-cols-4 mb-3 md:mb-4 h-auto gap-0.5 md:gap-1">
                  <TabsTrigger value="swap" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Swap Pools
                  </TabsTrigger>
                  <TabsTrigger value="vault" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Vault
                  </TabsTrigger>
                  <TabsTrigger value="psm" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    PSM
                  </TabsTrigger>
                  <TabsTrigger value="bad-debt" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                    Bad Debt
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="swap">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to add liquidity to swap pools and earn rewards" />
                  )}
                  <SwapPoolsSection />
                </TabsContent>

                <TabsContent value="vault">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to deposit or withdraw from the vault" />
                  )}
                  <div className="space-y-8">
                    <VaultOverview />
                    <VaultUserPosition
                      onDeposit={() => setIsVaultDepositOpen(true)}
                      onWithdraw={() => setIsVaultWithdrawOpen(true)}
                      guestMode={guestMode}
                    />
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                      <VaultTransactions />
                      {!guestMode && <VaultUserActivity />}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="psm">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to use the Direct Mint PSM" />
                  )}
                  <DirectMintPSMSection />
                </TabsContent>

                <TabsContent value="bad-debt">
                  <BadDebtView guestMode={!isLoggedIn} />
                </TabsContent>

                {/* Hidden tabs - temporarily disabled      
                <TabsTrigger value="borrow" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                  Borrow
                </TabsTrigger>
                <TabsTrigger value="lending" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                  Lending
                </TabsTrigger>
                <TabsTrigger value="safety" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                  Safety
                </TabsTrigger>
                <TabsTrigger value="liquidations" className="text-[10px] md:text-sm py-1.5 md:py-2 px-0.5 md:px-3">
                  Liquidations
                </TabsTrigger>

                <TabsContent value="borrow">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to borrow USDST" />
                  )}
                  {isLoggedIn && <LiquidationAlertBanner />}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle>Borrow & Repay</CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Tabs value={borrowActiveTab} onValueChange={(v) => setBorrowActiveTab(v as "borrow" | "repay")} className="w-full">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="borrow">Borrow</TabsTrigger>
                            <TabsTrigger value="repay">Repay</TabsTrigger>
                          </TabsList>
                          <TabsContent value="borrow">
                            <BorrowForm
                              loans={loans}
                              borrowLoading={borrowLoading}
                              onBorrow={executeEmbeddedBorrow}
                              usdstBalance={usdstBalance}
                              voucherBalance={voucherBalance}
                              collateralInfo={collateralInfo}
                              startPolling={startPolling}
                              stopPolling={stopPolling}
                              userRewards={userRewards}
                              rewardsLoading={rewardsLoading}
                              guestMode={guestMode}
                            />
                          </TabsContent>
                          <TabsContent value="repay">
                            <RepayForm
                              loans={loans}
                              repayLoading={repayLoading}
                              onRepay={executeEmbeddedRepay}
                              usdstBalance={usdstBalance}
                              voucherBalance={voucherBalance}
                              guestMode={guestMode}
                            />
                          </TabsContent>
                        </Tabs>
                      </CardContent>
                    </Card>

                    <div className="space-y-6">
                      {!guestMode && (
                        <PositionSection loanData={loans} userCollaterals={collateralInfo} />
                      )}
                      <CollateralManagementTable
                        collateralInfo={collateralInfo}
                        loadingCollateral={loadingCollateral}
                        loans={loans}
                        onSupply={handleSupply}
                        onWithdraw={handleWithdraw}
                        guestMode={guestMode}
                      />
                    </div>
                  </div>

                  {!guestMode && modalState.isOpen && modalState.type && selectedAsset && (
                    <CollateralModal 
                      type={modalState.type}
                      loading={modalLoading}
                      asset={selectedAsset}
                      loanData={loans}
                      isOpen={modalState.isOpen}
                      onClose={closeModal}
                      onAction={(amount) => {
                        if (modalState.type === "supply") {
                          executeSupply(selectedAsset, amount);
                        } else if (modalState.type === "withdraw") {
                          executeWithdraw(selectedAsset, amount);
                        }
                      }}
                      usdstBalance={usdstBalance}
                      voucherBalance={voucherBalance}
                      transactionFee={modalState.type === "supply" ? SUPPLY_COLLATERAL_FEE : WITHDRAW_COLLATERAL_FEE}
                    />
                  )}
                </TabsContent>

                <TabsContent value="lending">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to deposit liquidity and start earning" />
                  )}
                  <LendingPoolSection />
                </TabsContent>

                <TabsContent value="safety">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to stake USDST in the Safety Module" />
                  )}
                  <SafetyModuleSection />
                </TabsContent>

                <TabsContent value="liquidations">
                  {!isLoggedIn && (
                    <GuestSignInBanner message="Sign in to view and liquidate unhealthy positions" />
                  )}
                  <LiquidationsSection />
                </TabsContent>
                */}
              </Tabs>
            </CardContent>
          </Card>
        </main>
      </div>

      <MobileBottomNav />

      {!guestMode && (
        <>
          <VaultDepositModal
            isOpen={isVaultDepositOpen}
            onClose={() => setIsVaultDepositOpen(false)}
            onSuccess={() => refreshVault(false)}
          />
          <VaultWithdrawModal
            isOpen={isVaultWithdrawOpen}
            onClose={() => setIsVaultWithdrawOpen(false)}
            onSuccess={() => refreshVault(false)}
          />
        </>
      )}
    </div>
  );
};

export default Advanced;
