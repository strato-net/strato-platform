import { useEffect, useState } from "react";
import { safeParseUnits } from "@/utils/numberUtils";
import { formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tabs as AntdTabs } from 'antd';
import { CollateralData } from "@/interface";
import PositionSection from "@/components/Positions";
import CollateralModal from "@/components/borrow/CollateralModal";
import { WITHDRAW_COLLATERAL_FEE, SUPPLY_COLLATERAL_FEE } from "@/lib/constants";
import BorrowForm from "@/components/borrow/BorrowForm";
import RepayForm from "@/components/borrow/RepayForm";
import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";
import { useBalancePolling } from "@/hooks/useSmartPolling";
import CDPBorrowWidget from '@/components/cdp/MintWidget';
import VaultsList from '@/components/cdp/VaultsList';
import LiquidationsView from '@/components/cdp/LiquidationsView';
import BadDebtView from '@/components/cdp/BadDebtView';
import { useCDP } from '@/context/CDPContext';

const Borrow = () => {
  const { userAddress } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useUserTokens();
  const [selectedAsset, setSelectedAsset] = useState<CollateralData | null>(null);
  const [borrowLoading, setBorrowLoading] = useState(false);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "supply" | "withdraw" | null;
  }>({ isOpen: false, type: null });
  const [modalLoading, setModalLoading] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [repayLoading, setRepayLoading] = useState(false);
  const [eligibleCollateral, setEligibleCollateral] = useState<CollateralData[]>([]);

  // State for main borrow flow tabs
  const [mainBorrowTab, setMainBorrowTab] = useState('lending');

  // State for CDP sub-tabs
  const [cdpActiveTab, setCdpActiveTab] = useState('vaults');
  const [vaultsRefreshTrigger, setVaultsRefreshTrigger] = useState(0);

  const { toast } = useToast();
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

  const { refreshVaults } = useCDP();

  // Use the new smart polling hook for balance updates
  const { startPolling, stopPolling } = useBalancePolling(
    userAddress || "",
    fetchUsdstBalance,
    (amount) => amount && parseFloat(amount) > 0
  );

  useEffect(() => {
    document.title = "Borrow Assets | STRATO Mercata";
  }, []);


  // Refresh data when page loads and when userAddress changes
  useEffect(() => {
    if (userAddress) {
      const refreshData = async () => {
        try {
          await Promise.all([
            refreshLoans(),
            refreshCollateral(),
            fetchUsdstBalance(userAddress),
          ]);
        } catch (error) {
          console.error("Error refreshing data:", error);
        }
      };
      refreshData();
    }
  }, [userAddress, refreshLoans, refreshCollateral, fetchUsdstBalance]);

    useEffect(() => {
    if (collateralInfo && Array.isArray(collateralInfo)) {
      // Only show assets that have a balance > 0
      const eligibleWithBalance = collateralInfo.filter((item) => 
        BigInt(item.userBalance || 0) > 0n
      );
      setEligibleCollateral(eligibleWithBalance);
    }
  }, [collateralInfo])

  const handleSupply = (asset) => {
    setSelectedAsset(asset);
    setModalState({ isOpen: true, type: "supply" });
  };

  const handleWithdraw = (asset) => {
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
      await supplyCollateral({
        asset: asset.address,
        amount: safeParseUnits(amount).toString(),
      });
      toast({
        title: "Supply Initiated",
        description: `You supplied ${amount} ${asset._symbol}`,
        variant: "success",
      });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Refresh all data after successful supply
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
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
        await withdrawCollateral({
          asset: asset.address,
          amount: safeParseUnits(amount).toString(),
        });
      }
      toast({
        title: "Withdraw Initiated",
        description: `Withdrawal submitted: ${amount === 'ALL' ? 'max available' : amount} ${asset._symbol}`,
        variant: "success",
      });
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Refresh all data after successful withdraw
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      console.log(error, "error");
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Error toast is now handled globally by axios interceptor
    }
  };


  const executeEmbeddedBorrow = async (amount: string) => {
    try {
      setBorrowLoading(true);
      if (amount === 'ALL') {
        await borrowMax();
        toast({
          title: "Borrow Initiated",
          description: `Borrowed max available USDST`,
          variant: "success",
        });
      } else {
        await borrowAssetFn({ amount: safeParseUnits(amount).toString() });
        toast({
          title: "Borrow Initiated",
          description: `You borrowed ${amount} USDST`,
          variant: "success",
        });
      }
      setBorrowLoading(false);
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      setBorrowLoading(false);
    }
  };

  const executeEmbeddedRepay = async (amount: string) => {
    try {
      setRepayLoading(true);
      if (amount === 'ALL') {
        const res = await repayAll();
        const sent = res?.estimatedDebtAtRead ? formatUnits(BigInt(res.estimatedDebtAtRead)) : 'all';
        toast({
          title: "Success",
          description: `Successfully repaid ${sent} USDST`,
          variant: "success",
        });
      } else {
        const res = await repayLoanFn({ amount: safeParseUnits(amount).toString() } as any);
        const sent = res?.amountSent ? formatUnits(BigInt(res.amountSent)) : amount;
        toast({
          title: "Success",
          description: `Successfully repaid ${sent} USDST`,
          variant: "success",
        });
      }
      setRepayLoading(false);
      await Promise.all([
        refreshLoans(),
        refreshCollateral(),
        fetchUsdstBalance(userAddress || ""),
      ]);
    } catch (error) {
      console.error("Error repaying loan:", error);
      setRepayLoading(false);
    }
  };

  // CDP callbacks
  const handleCDPBorrowSuccess = () => {
    setVaultsRefreshTrigger(prev => prev + 1);
  };

  const handleVaultActionSuccess = () => {
    refreshVaults();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Borrow" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <style>{`
            .custom-tabs .ant-tabs-tab {
              justify-content: center !important;
            }
            .custom-tabs .ant-tabs-tab-btn {
              justify-content: center !important;
              text-align: center !important;
              width: 100% !important;
            }
          `}</style>

          {/* Main tabs for different borrow flows */}
          <Tabs value={mainBorrowTab} onValueChange={setMainBorrowTab} className="w-full mb-6">
            <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto">
              <TabsTrigger value="lending">Lending Pool</TabsTrigger>
              <TabsTrigger value="cdp">CDP Vaults</TabsTrigger>
            </TabsList>

            {/* Lending Pool Borrow Flow */}
            <TabsContent value="lending">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                {/* Left Column - Borrow/Repay Tabbed Card */}
                <Card>
                  <CardHeader>
                    <CardTitle>Borrow & Repay</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Tabs defaultValue="borrow" className="w-full">
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
                          collateralInfo={eligibleCollateral}
                          startPolling={startPolling}
                          stopPolling={stopPolling}
                        />
                      </TabsContent>
                      <TabsContent value="repay">
                        <RepayForm
                          loans={loans}
                          repayLoading={repayLoading}
                          onRepay={executeEmbeddedRepay}
                          usdstBalance={usdstBalance}
                          voucherBalance={voucherBalance}
                        />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>

                {/* Right Column - Your Position */}
                <div>
                  <PositionSection loanData={loans} userCollaterals={collateralInfo} />
                </div>
              </div>
              <CollateralManagementTable
                collateralInfo={collateralInfo}
                loadingCollateral={loadingCollateral}
                loans={loans}
                onSupply={handleSupply}
                onWithdraw={handleWithdraw}
              />
            </TabsContent>

            {/* CDP Vaults Borrow Flow */}
            <TabsContent value="cdp">
              <div className="w-full bg-white/90 p-1.5 rounded-xl border border-gray-200 shadow-sm mb-6">
                <AntdTabs
                  activeKey={cdpActiveTab}
                  items={[
                    {
                      key: 'vaults',
                      label: 'Vaults',
                    },
                    {
                      key: 'bad-debt',
                      label: 'Bad Debt',
                    },
                    {
                      key: 'liquidations',
                      label: 'Liquidations',
                    },
                  ]}
                  onChange={(value) => setCdpActiveTab(value)}
                  className="custom-tabs"
                  style={{
                    '--ant-primary-color': '#3b82f6',
                    '--ant-primary-color-hover': '#2563eb',
                  } as React.CSSProperties}
                />
              </div>

              {cdpActiveTab === 'vaults' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Left Column - CDP Borrow Widget */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Create Vault</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="border-2 border-gray-300 rounded-xl p-4 pb-[60px] flex flex-col">
                        <CDPBorrowWidget onSuccess={handleCDPBorrowSuccess} />
                      </div>
                    </CardContent>
                  </Card>

                  {/* Right Column - Your Vaults */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Your Vaults</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <VaultsList
                        refreshTrigger={vaultsRefreshTrigger}
                        onVaultActionSuccess={handleVaultActionSuccess}
                      />
                    </CardContent>
                  </Card>
                </div>
              ) : cdpActiveTab === 'bad-debt' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Bad Debt</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <BadDebtView />
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Liquidations</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <LiquidationsView />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </main>
      </div>


      {modalState.isOpen && modalState.type && (
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

    </div>
  );
};

export default Borrow;
