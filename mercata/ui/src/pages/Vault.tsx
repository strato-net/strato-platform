import { useState, useEffect, useMemo } from "react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileSidebar from "@/components/dashboard/MobileSidebar";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import VaultDepositModal from "@/components/vault/VaultDepositModal";
import VaultWithdrawModal from "@/components/vault/VaultWithdrawModal";
import { useVaultContext } from "@/context/VaultContext";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { formatUnits } from "ethers";
import { useNavigate } from "react-router-dom";

const formatUsd = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value || "0", 18));
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0.00";
  }
};

const formatShares = (value: string): string => {
  try {
    const num = parseFloat(formatUnits(value || "0", 18));
    return num.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  } catch {
    return "0";
  }
};

const formatApy = (value: string): { text: string; positive: boolean } => {
  if (value === "-") return { text: "-", positive: true };
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return { text: "-", positive: true };
  const sign = parsed >= 0 ? "+" : "-";
  return {
    text: `${sign}${Math.abs(parsed).toFixed(2)}%`,
    positive: parsed >= 0,
  };
};

const Vault = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);

  const { refreshVault, vaultState } = useVaultContext();
  const { isLoggedIn } = useUser();
  const guestMode = !isLoggedIn;
  const navigate = useNavigate();

  const {
    totalEquity,
    totalShares,
    apy,
    assets,
    userShares,
    userValueUsd,
    allTimeEarnings,
    loading,
    loadingUser,
  } = vaultState;

  const allocationRows = useMemo(() => {
    const totalEquityBN = BigInt(totalEquity || "0");
    return [...assets]
      .map((asset) => {
        const valueBN = BigInt(asset.valueUsd || "0");
        const pct = totalEquityBN > 0n
          ? Number((valueBN * 10000n) / totalEquityBN) / 100
          : 0;
        return {
          ...asset,
          allocationPercent: pct.toFixed(2),
        };
      })
      .sort((a, b) => Number(BigInt(b.valueUsd || "0") - BigInt(a.valueUsd || "0")));
  }, [assets, totalEquity]);

  const earningsFormatted = useMemo(() => {
    try {
      const value = parseFloat(formatUnits(allTimeEarnings || "0", 18));
      const abs = Math.abs(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      if (Math.abs(value) < 0.005) return { text: "$0.00", positive: true };
      return {
        text: `${value >= 0 ? "+" : "-"}$${abs}`,
        positive: value >= 0,
      };
    } catch {
      return { text: "$0.00", positive: true };
    }
  }, [allTimeEarnings]);

  useEffect(() => {
    document.title = "STRATO Vault | STRATO";
    window.scrollTo(0, 0);
  }, []);

  const handleDepositSuccess = () => {
    refreshVault(false);
  };

  const handleWithdrawSuccess = () => {
    refreshVault(false);
  };

  const apyDisplay = formatApy(apy);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />
      <MobileSidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setIsMobileSidebarOpen(false)}
      />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader
          title="STRATO Vault"
          onMenuClick={() => setIsMobileSidebarOpen(true)}
        />

        <main className="p-4 md:p-6 pb-16 md:pb-6">
          {guestMode && (
            <GuestSignInBanner message="Sign in to deposit or withdraw from the vault" />
          )}

          <div className="max-w-5xl mx-auto mt-4 md:mt-6">
            <Card className="bg-card border-border">
              <CardContent className="p-4 md:p-8 space-y-8">
                <button
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => navigate(-1)}
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>

                <div className="space-y-5">
                  <h1 className="text-2xl md:text-4xl font-semibold">STRATO Vault</h1>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <p className="text-xs md:text-sm text-muted-foreground">TVL</p>
                      <p className="mt-1 text-2xl md:text-3xl font-semibold">
                        {loading ? "..." : `$${formatUsd(totalEquity)}`}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Total Value Locked</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <p className="text-xs md:text-sm text-muted-foreground">Total Shares</p>
                      <p className="mt-1 text-2xl md:text-3xl font-semibold">
                        {loading ? "..." : formatShares(totalShares)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <p className="text-xs md:text-sm text-muted-foreground">APY</p>
                      <p
                        className={`mt-1 text-2xl md:text-3xl font-semibold ${
                          apyDisplay.positive
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {loading ? "..." : apyDisplay.text}
                      </p>
                    </div>
                  </div>
                </div>

                <section className="space-y-2">
                  <h2 className="text-xl font-semibold">Strategy</h2>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                    Diversified real asset vault holding gold, silver, ETH, BTC, and stables.
                    Actively managed allocation across tokenized assets with rebalancing based
                    on market conditions.
                  </p>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Allocation Breakdown</h2>
                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px]">
                        <thead>
                          <tr className="bg-muted/40 text-muted-foreground text-sm">
                            <th className="text-left px-4 py-3 font-medium">Asset</th>
                            <th className="text-right px-4 py-3 font-medium">Allocation %</th>
                            <th className="text-right px-4 py-3 font-medium">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {loading ? (
                            <tr>
                              <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={3}>
                                Loading allocation...
                              </td>
                            </tr>
                          ) : allocationRows.length === 0 ? (
                            <tr>
                              <td className="px-4 py-6 text-sm text-muted-foreground" colSpan={3}>
                                No assets in vault
                              </td>
                            </tr>
                          ) : (
                            allocationRows.map((asset) => (
                              <tr key={asset.address} className="border-t border-border text-sm">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {asset.images?.[0]?.value ? (
                                      <img
                                        src={asset.images[0].value}
                                        alt={asset.symbol}
                                        className="w-5 h-5 rounded-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-5 h-5 rounded-full bg-muted" />
                                    )}
                                    <span>{asset.symbol}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right">{asset.allocationPercent}%</td>
                                <td className="px-4 py-3 text-right font-medium">
                                  ${formatUsd(asset.valueUsd)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Fees</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">Service Fee</p>
                      <p className="text-2xl font-semibold mt-1">1%</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">Reward Fee</p>
                      <p className="text-2xl font-semibold mt-1">10%</p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">Withdrawal Period</p>
                      <p className="text-2xl font-semibold mt-1">~24h</p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Your Position</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">Your Shares</p>
                      <p className="text-2xl font-semibold mt-1">
                        {guestMode || loadingUser ? "-" : formatShares(userShares)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">USD Value</p>
                      <p className="text-2xl font-semibold mt-1">
                        {guestMode || loadingUser ? "-" : `$${formatUsd(userValueUsd)}`}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/30 p-4">
                      <p className="text-sm text-muted-foreground">All-Time Earnings</p>
                      <p
                        className={`text-2xl font-semibold mt-1 ${
                          earningsFormatted.positive
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {guestMode || loadingUser ? "-" : earningsFormatted.text}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <Button
                      onClick={() => setIsDepositModalOpen(true)}
                      disabled={guestMode}
                      className="w-full"
                    >
                      Deposit
                    </Button>
                    <Button
                      onClick={() => setIsWithdrawModalOpen(true)}
                      disabled={guestMode}
                      variant="outline"
                      className="w-full"
                    >
                      Withdraw
                    </Button>
                  </div>
                </section>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <MobileBottomNav />

      {/* Modals */}
      {!guestMode && (
        <>
          <VaultDepositModal
            isOpen={isDepositModalOpen}
            onClose={() => setIsDepositModalOpen(false)}
            onSuccess={handleDepositSuccess}
          />

          <VaultWithdrawModal
            isOpen={isWithdrawModalOpen}
            onClose={() => setIsWithdrawModalOpen(false)}
            onSuccess={handleWithdrawSuccess}
          />
        </>
      )}
    </div>
  );
};

export default Vault;
