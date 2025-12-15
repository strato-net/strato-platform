import { useEffect, useMemo, useState } from "react";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { formatUnits } from "ethers";
import { useToast } from "@/hooks/use-toast";
import { useLendingContext } from "@/context/LendingContext";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileSidebar from "../components/dashboard/MobileSidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CollateralData } from "@/interface";
import PositionSection from "@/components/Positions";
import CollateralModal from "@/components/borrow/CollateralModal";
import { WITHDRAW_COLLATERAL_FEE, SUPPLY_COLLATERAL_FEE } from "@/lib/constants";
import BorrowForm from "@/components/borrow/BorrowForm";
import RepayForm from "@/components/borrow/RepayForm";
import CollateralManagementTable from "@/components/borrow/CollateralManagementTable";
import { useSmartPolling } from "@/hooks/useSmartPolling";
import { useRewardsUserInfo } from '@/hooks/useRewardsUserInfo';
// NOTE: deposit amount validation is handled locally to allow 0/empty planned deposits

const Borrow = () => {
  const { userAddress } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
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
  const [depositCollateralAddress, setDepositCollateralAddress] = useState<string>("");
  const [depositCollateralAmount, setDepositCollateralAmount] = useState<string>("");
  const [depositCollateralAmountError, setDepositCollateralAmountError] = useState<string>("");
  const { userRewards, loading: rewardsLoading } = useRewardsUserInfo();

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

  // Use the new smart polling hook for balance updates
  const { startPolling, stopPolling } = useSmartPolling({
    fetchFn: fetchUsdstBalance,
    shouldPoll: () => true,
    interval: 10000,
    onError: (error) => console.error("Balance polling error:", error)
  });

  useEffect(() => {
    document.title = "Borrow Assets | STRATO";
  }, []);


  // Refresh data when page loads
  useEffect(() => {
    const refreshData = async () => {
      try {
        await Promise.all([
          refreshLoans(),
          refreshCollateral(),
          fetchUsdstBalance(),
        ]);
      } catch (error) {
        console.error("Error refreshing data:", error);
      }
    };
    refreshData();
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

  useEffect(() => {
    // Default dropdown selection to the first available collateral with wallet balance
    if (!depositCollateralAddress && eligibleCollateral.length > 0) {
      setDepositCollateralAddress(eligibleCollateral[0].address);
    }
  }, [depositCollateralAddress, eligibleCollateral]);

  const selectedDepositCollateral = useMemo(() => {
    if (!eligibleCollateral.length) return null;
    return (
      eligibleCollateral.find((a) => a.address === depositCollateralAddress) ??
      eligibleCollateral[0]
    );
  }, [eligibleCollateral, depositCollateralAddress]);

  const depositMaxWei = useMemo(() => {
    try {
      if (!selectedDepositCollateral) return 0n;
      return BigInt(selectedDepositCollateral.userBalance || 0);
    } catch {
      return 0n;
    }
  }, [selectedDepositCollateral]);

  const depositDecimals = selectedDepositCollateral?.customDecimals ?? 18;
  const depositMaxDisplay = useMemo(() => {
    if (!selectedDepositCollateral) return "-";
    return formatBalance(depositMaxWei, selectedDepositCollateral?._symbol, depositDecimals, 0, 8);
  }, [depositMaxWei, depositDecimals, selectedDepositCollateral]);

  const handleDepositAmountChange = (rawValue: string) => {
    // Allow 0 (and empty) for planned deposit; we only submit supply if amount > 0.
    const input = rawValue.replace(/,/g, "").trim();
    const basicPattern = /^\d*\.?\d*$/;
    if (!basicPattern.test(input)) {
      setDepositCollateralAmountError("Invalid input format");
      return;
    }

    setDepositCollateralAmount(input);

    if (!input) {
      setDepositCollateralAmountError("");
      return;
    }

    if (input.includes(".")) {
      const decimalPart = input.split(".")[1];
      if (decimalPart && decimalPart.length > depositDecimals) {
        setDepositCollateralAmountError(`Maximum ${depositDecimals} decimal places allowed`);
        return;
      }
    }

    // Only enforce upper bound; 0 is allowed.
    const amountWei = safeParseUnits(input || "0", depositDecimals);
    if (amountWei > depositMaxWei) {
      setDepositCollateralAmountError("Maximum amount exceeded");
      return;
    }

    setDepositCollateralAmountError("");
  };

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
        fetchUsdstBalance(),
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
        fetchUsdstBalance(),
      ]);
    } catch (error) {
      console.log(error, "error");
      setModalLoading(false);
      setModalState({ isOpen: false, type: null });
      // Error toast is now handled globally by axios interceptor
    }
  };


  const executeEmbeddedBorrow = async (amount: string): Promise<boolean> => {
    try {
      setBorrowLoading(true);
      // If user specified a deposit amount, submit supply first (same submit as borrow).
      if (selectedDepositCollateral) {
        const supplyWei = safeParseUnits(depositCollateralAmount || "0", depositDecimals);
        if (supplyWei > 0n) {
          const feeWei = safeParseUnits(SUPPLY_COLLATERAL_FEE);
          const usdstWei = BigInt(usdstBalance || "0");
          const voucherWei = BigInt(voucherBalance || "0");
          if ((usdstWei + voucherWei) < feeWei) {
            toast({
              title: "Insufficient balance for deposit fee",
              description: "You don't have enough USDST + vouchers to pay the collateral deposit transaction fee.",
              variant: "destructive",
            });
            setBorrowLoading(false);
            return false;
          }

          await supplyCollateral({
            asset: selectedDepositCollateral.address,
            amount: supplyWei.toString(),
          });
          await Promise.all([
            refreshLoans(),
            refreshCollateral(),
            fetchUsdstBalance(),
          ]);
        }
      }

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
        fetchUsdstBalance(),
      ]);
      setDepositCollateralAmount("");
      setDepositCollateralAmountError("");
      return true;
    } catch (error) {
      setBorrowLoading(false);
      return false;
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
        fetchUsdstBalance(),
      ]);
    } catch (error) {
      console.error("Error repaying loan:", error);
      setRepayLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar 
        isOpen={isMobileSidebarOpen} 
        onClose={() => setIsMobileSidebarOpen(false)} 
      />
      <div className="transition-all duration-300 md:pl-64" style={{ paddingLeft: 'var(--sidebar-width, 0rem)' }}>
        <DashboardHeader title="Borrow" onMenuClick={() => setIsMobileSidebarOpen(true)} />

        <main className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Left Column - Borrow/Repay Tabbed Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Borrow & Repay</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="borrow" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="borrow">Borrow</TabsTrigger>
                    <TabsTrigger value="repay">Repay</TabsTrigger>
                  </TabsList>
                  <TabsContent value="borrow">
                    <div className="mb-4 rounded-lg border bg-muted/30 p-4">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">Deposit Collateral</div>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Select a collateral asset and amount. It will be submitted together with your borrow.
                      </p>

                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Select
                          value={depositCollateralAddress}
                          onValueChange={setDepositCollateralAddress}
                          disabled={loadingCollateral || eligibleCollateral.length === 0}
                        >
                          <SelectTrigger>
                            {selectedDepositCollateral ? (
                              <div className="flex items-center gap-2 min-w-0">
                                {selectedDepositCollateral?.images?.[0]?.value ? (
                                  <img
                                    src={selectedDepositCollateral.images[0].value}
                                    alt={selectedDepositCollateral._name}
                                    className="w-5 h-5 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-muted-foreground" />
                                )}
                                <span className="truncate">{selectedDepositCollateral?._symbol ?? selectedDepositCollateral?._name}</span>
                              </div>
                            ) : (
                              <SelectValue placeholder="Select collateral" />
                            )}
                          </SelectTrigger>
                          <SelectContent>
                            {eligibleCollateral.map((asset) => (
                              <SelectItem key={asset.address} value={asset.address}>
                                <div className="flex items-center gap-2 min-w-0">
                                  {asset?.images?.[0]?.value ? (
                                    <img
                                      src={asset.images[0].value}
                                      alt={asset._name}
                                      className="w-5 h-5 rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-muted-foreground" />
                                  )}
                                  <span className="truncate">{asset?._symbol ?? asset?._name ?? asset.address}</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="relative">
                          <Input
                            placeholder="0.00"
                            value={depositCollateralAmount}
                            onChange={(e) => {
                              handleDepositAmountChange(e.target.value);
                            }}
                            disabled={loadingCollateral || !selectedDepositCollateral}
                            className={`pr-20 ${depositCollateralAmountError ? "text-red-600" : ""}`}
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                            {selectedDepositCollateral?._symbol ?? ""}
                          </span>
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          disabled={loadingCollateral || !selectedDepositCollateral || depositMaxWei <= 0n}
                          onClick={() => {
                            try {
                              setDepositCollateralAmount(formatUnits(depositMaxWei, depositDecimals));
                              setDepositCollateralAmountError("");
                            } catch {}
                          }}
                        >
                          Max
                        </Button>
                      </div>

                      {depositCollateralAmountError && (
                        <div className="mt-2 text-sm text-red-600">{depositCollateralAmountError}</div>
                      )}
                      {!loadingCollateral && selectedDepositCollateral && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Max available: {depositMaxDisplay}
                        </div>
                      )}

                      {!loadingCollateral && eligibleCollateral.length === 0 && (
                        <div className="mt-3 text-sm text-muted-foreground">
                          No collateral assets available in your wallet to deposit.
                        </div>
                      )}
                    </div>
                    <BorrowForm
                      loans={loans}
                      borrowLoading={borrowLoading}
                      onBorrow={executeEmbeddedBorrow}
                      usdstBalance={usdstBalance}
                      voucherBalance={voucherBalance}
                      collateralInfo={eligibleCollateral}
                      disableBorrow={!!depositCollateralAmountError}
                      plannedDepositAsset={selectedDepositCollateral}
                      plannedDepositAmount={depositCollateralAmount}
                      startPolling={startPolling}
                      stopPolling={stopPolling}
                      userRewards={userRewards}
                      rewardsLoading={rewardsLoading}
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
            <div className="space-y-6">
              <PositionSection loanData={loans} userCollaterals={collateralInfo} />
              <CollateralManagementTable
                collateralInfo={collateralInfo}
                loadingCollateral={loadingCollateral}
                loans={loans}
                onSupply={handleSupply}
                onWithdraw={handleWithdraw}
              />
            </div>
          </div>
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
