import { useEffect, useMemo, useState } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useNavigate } from "react-router-dom";
import { formatUnits } from "ethers";
import { ArrowLeft } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import VaultWithdrawModal, { WithdrawMode } from "@/components/vault/VaultWithdrawModal";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useVaultContext } from "@/context/VaultContext";
import { useUser } from "@/context/UserContext";

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
    if (num === 0) return "0";
    return num.toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  } catch {
    return "0";
  }
};

const formatTotalShares = (value: string): string => {
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

const EarnVault = () => {
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState(false);
  const [withdrawMode, setWithdrawMode] = useState<WithdrawMode>("usd");

  const openWithdraw = (mode: WithdrawMode) => {
    setWithdrawMode(mode);
    setIsWithdrawModalOpen(true);
  };

  const { refreshVault, vaultState } = useVaultContext();
  const { isLoggedIn } = useUser();
  const navigate = useNavigate();
  const guestMode = !isLoggedIn;

  const {
    totalEquity,
    totalShares,
    alpha,
    assets,
    userShares,
    userValueUsd,
    loading,
    loadingUser,
    paused,
  } = vaultState;

  const hasPosition = BigInt(userShares || "0") > 0n;

  const allocationRows = useMemo(() => {
    const totalEquityBN = BigInt(totalEquity || "0");
    return [...assets]
      .map((asset) => {
        const valueBN = BigInt(asset.valueUsd || "0");
        const pct = totalEquityBN > 0n ? Number((valueBN * 10000n) / totalEquityBN) / 100 : 0;
        return {
          ...asset,
          allocationPercent: pct.toFixed(2),
        };
      })
      .sort((a, b) => Number(BigInt(b.valueUsd || "0") - BigInt(a.valueUsd || "0")));
  }, [assets, totalEquity]);

  usePageTitle("Earn Vault");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handleWithdrawSuccess = () => {
    refreshVault(false);
  };

  const alphaDisplay = formatApy(alpha);

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="STRATO Vault" />

        <main className="pb-16 md:pb-6">
          {guestMode && (
            <GuestSignInBanner message="Sign in to withdraw from the vault" />
          )}

          <div className="w-full">
            <Card className="bg-card border-0 rounded-none">
              <CardContent className="p-4 md:p-6 space-y-8">
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
                        {loading ? "..." : formatTotalShares(totalShares)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border bg-muted/40 p-4">
                      <p className="text-xs md:text-sm text-muted-foreground">Alpha vs HODL</p>
                      <p
                        className={`mt-1 text-2xl md:text-3xl font-semibold ${
                          alphaDisplay.positive
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {loading ? "..." : alphaDisplay.text}
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

                {/* <section className="space-y-3">
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
                </section> */}

                <section className="space-y-3">
                  <h2 className="text-xl font-semibold">Your Position</h2>
                  <div className="rounded-xl border border-border bg-muted/30 p-4">
                    <p className="text-sm text-muted-foreground">Your Shares</p>
                    <p className="text-2xl font-semibold mt-1">
                      {guestMode || loadingUser
                        ? "-"
                        : <>{formatShares(userShares)} <span className="text-base text-muted-foreground">(${formatUsd(userValueUsd)})</span></>
                      }
                    </p>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    This vault is no longer accepting deposits. Existing holders can withdraw at any time.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <Button
                      onClick={() => openWithdraw("all")}
                      disabled={guestMode || paused || !hasPosition}
                      className="w-full"
                    >
                      Withdraw All
                    </Button>
                    <Button
                      onClick={() => openWithdraw("usd")}
                      disabled={guestMode || paused || !hasPosition}
                      variant="outline"
                      className="w-full"
                    >
                      Withdraw Amount
                    </Button>
                  </div>
                </section>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      <MobileBottomNav />

      {!guestMode && (
        <VaultWithdrawModal
          isOpen={isWithdrawModalOpen}
          onClose={() => setIsWithdrawModalOpen(false)}
          onSuccess={handleWithdrawSuccess}
          defaultMode={withdrawMode}
        />
      )}
    </div>
  );
};

export default EarnVault;
