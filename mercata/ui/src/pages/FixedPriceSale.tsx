import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import { Loader2, Rocket } from "lucide-react";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import { safeParseUnits } from "@/utils/numberUtils";
import {
  fixedPriceSaleService,
  SaleInfo,
  SalePurchaseRecord,
  UserSalePosition,
} from "@/services/fixedPriceSaleService";

const WAD = 10n ** 18n;

const formatTokenAmount = (value: string, decimals: number = 18, maxFractionDigits: number = 4): string => {
  try {
    const num = parseFloat(formatUnits(value || "0", decimals));
    if (!Number.isFinite(num) || num === 0) return "0";
    return num.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
  } catch {
    return "0";
  }
};

const formatUsd = (value: string | bigint, decimals = 18): string => {
  try {
    const v = typeof value === "bigint" ? value : BigInt(value || "0");
    const num = parseFloat(formatUnits(v, decimals));
    return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return "0.00";
  }
};

const formatShortAddress = (addr: string): string => {
  if (!addr) return "";
  const cleaned = addr.startsWith("0x") ? addr : `0x${addr}`;
  return `${cleaned.slice(0, 6)}…${cleaned.slice(-4)}`;
};

const formatCountdown = (targetUnix: bigint, now: bigint): string => {
  if (now >= targetUnix) return "now";
  let secs = Number(targetUnix - now);
  const d = Math.floor(secs / 86400); secs -= d * 86400;
  const h = Math.floor(secs / 3600); secs -= h * 3600;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

const FixedPriceSalePage = () => {
  const { isLoggedIn, isExternalEvmWalletConnected } = useUser();
  const { toast } = useToast();
  const guestMode = !isLoggedIn;
  // When MetaMask (or any non-STRATO EVM wallet) is connected, sign with it.
  // The bridge gates this on `!isAppAuthenticated`, but for sale purchases we
  // want the connected wallet to take precedence even if a STRATO OAuth session
  // also exists — otherwise the backend tries the STRATO-wallet signing path
  // and 401s because the user is actually intending to spend their MetaMask funds.
  const useExternalWalletSigning = isExternalEvmWalletConnected;

  const [info, setInfo] = useState<SaleInfo | null>(null);
  const [position, setPosition] = useState<UserSalePosition>({ purchased: "0", remainingForWallet: "0" });
  const [purchases, setPurchases] = useState<SalePurchaseRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [paymentToken, setPaymentToken] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [quotePayment, setQuotePayment] = useState<string>("0");
  const [quoteUsd, setQuoteUsd] = useState<string>("0");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);

  const [now, setNow] = useState<bigint>(BigInt(Math.floor(Date.now() / 1000)));

  useEffect(() => {
    document.title = "STRATO Token Sale | STRATO";
    window.scrollTo(0, 0);
  }, []);

  // Tick clock so countdowns update.
  useEffect(() => {
    const id = setInterval(() => setNow(BigInt(Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [infoRes, purchasesRes] = await Promise.all([
        fixedPriceSaleService.getInfo(),
        fixedPriceSaleService.getRecentPurchases(20),
      ]);
      setInfo(infoRes);
      setPurchases(purchasesRes.purchases);
      if (infoRes?.paymentTokens.length && !paymentToken) {
        setPaymentToken(infoRes.paymentTokens[0].address);
      }
      if (!guestMode) {
        const pos = await fixedPriceSaleService.getUserPosition();
        setPosition(pos);
      }
    } finally {
      setLoading(false);
    }
  }, [guestMode, paymentToken]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-quote whenever amount or payment token changes
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!amount || !paymentToken || !info) {
        setQuotePayment("0");
        setQuoteUsd("0");
        return;
      }
      let amountWei: bigint;
      try {
        amountWei = parseUnits(amount, info.saleToken?.decimals ?? 18);
      } catch {
        setQuotePayment("0");
        setQuoteUsd("0");
        return;
      }
      if (amountWei <= 0n) {
        setQuotePayment("0");
        setQuoteUsd("0");
        return;
      }
      setQuoteLoading(true);
      try {
        const q = await fixedPriceSaleService.quote(paymentToken, amountWei.toString());
        if (!cancelled) {
          setQuotePayment(q.paymentAmount);
          setQuoteUsd(q.usdValue);
        }
      } catch (error) {
        if (!cancelled) {
          setQuotePayment("0");
          setQuoteUsd("0");
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [amount, paymentToken, info]);

  const saleToken = info?.saleToken;
  const saleDecimals = saleToken?.decimals ?? 18;
  const symbol = saleToken?.symbol || "TOKEN";

  const startBN = useMemo(() => BigInt(info?.startTime || "0"), [info?.startTime]);
  const endBN = useMemo(() => BigInt(info?.endTime || "0"), [info?.endTime]);
  const beforeStart = info ? now < startBN : false;
  const afterEnd = info ? now >= endBN : false;

  const progressPct = useMemo(() => {
    if (!info) return 0;
    const sold = BigInt(info.totalSold || "0");
    const cap = BigInt(info.hardCap || "0");
    if (cap === 0n) return 0;
    const pct = Number((sold * 10000n) / cap) / 100;
    return Math.min(Math.max(pct, 0), 100);
  }, [info]);

  const selectedPayment = useMemo(
    () => info?.paymentTokens.find((p) => p.address === paymentToken) || null,
    [info, paymentToken]
  );

  const canBuy = useMemo(() => {
    if (!info || !info.active) return false;
    if (guestMode) return false;
    if (!paymentToken || !amount) return false;
    const amountWei = safeParseUnits(amount, saleDecimals);
    if (amountWei <= 0n) return false;
    const remainingSale = BigInt(info.remainingForSale || "0");
    if (amountWei > remainingSale) return false;
    if (info.perWalletCap !== "0") {
      const remainingWallet = BigInt(position.remainingForWallet || "0");
      if (amountWei > remainingWallet) return false;
    }
    return BigInt(quotePayment || "0") > 0n;
  }, [info, guestMode, paymentToken, amount, saleDecimals, position.remainingForWallet, quotePayment]);

  const handleBuy = async () => {
    if (!info || !paymentToken || !amount) return;
    const amountWei = safeParseUnits(amount, saleDecimals);
    if (amountWei <= 0n || !quotePayment || quotePayment === "0") return;

    setBuyLoading(true);
    try {
      const result = await fixedPriceSaleService.buy(
        paymentToken,
        amountWei.toString(),
        quotePayment,
        useExternalWalletSigning ? { walletAuth: true } : undefined,
      );
      toast({
        title: "Purchase successful",
        description: '',
      });
      setAmount("");
      await refresh();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Purchase failed",
        description: error?.response?.data?.error || error?.message || "Unknown error",
      });
    } finally {
      setBuyLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <DashboardSidebar />

      <div
        className="transition-all duration-300 md:pl-64"
        style={{ paddingLeft: "var(--sidebar-width, 0rem)" }}
      >
        <DashboardHeader title="STRATO Token Sale" />

        <main className="p-4 md:p-6 pb-16 md:pb-6 space-y-6">
          {guestMode && (
            <GuestSignInBanner message="Sign in to participate in the STRATO token sale." />
          )}

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : !info ? (
            <Alert>
              <AlertDescription>
                The token sale is not yet configured on this network. Check back soon.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {/* Sale overview */}
              <Card>
                <CardContent className="p-6 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full bg-primary/10 p-2">
                        <Rocket className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold">
                          {saleToken?.name || symbol} Launch
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Fixed price: ${formatUsd(info.pricePerTokenUSD)} per {symbol}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs uppercase text-muted-foreground">Status</p>
                      <p className="font-medium">
                        {info.paused
                          ? "Paused"
                          : beforeStart
                            ? `Opens in ${formatCountdown(startBN, now)}`
                            : afterEnd
                              ? "Ended"
                              : `Ends in ${formatCountdown(endBN, now)}`}
                      </p>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>
                        Sold {formatTokenAmount(info.totalSold, saleDecimals)} / {formatTokenAmount(info.hardCap, saleDecimals)} {symbol}
                      </span>
                      <span className="text-muted-foreground">{progressPct.toFixed(2)}%</span>
                    </div>
                    <div className="h-2 rounded bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Remaining</p>
                      <p className="font-medium">
                        {formatTokenAmount(info.remainingForSale, saleDecimals)} {symbol}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Per-wallet cap</p>
                      <p className="font-medium">
                        {info.perWalletCap === "0"
                          ? "No cap"
                          : `${formatTokenAmount(info.perWalletCap, saleDecimals)} ${symbol}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Inventory</p>
                      <p className="font-medium">
                        {formatTokenAmount(info.inventory, saleDecimals)} {symbol}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-muted-foreground">Your purchase</p>
                      <p className="font-medium">
                        {formatTokenAmount(position.purchased, saleDecimals)} {symbol}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Buy form */}
              <Card>
                <CardContent className="p-6 space-y-4">
                  <h3 className="text-lg font-semibold">Buy {symbol}</h3>

                  {info.paymentTokens.length === 0 ? (
                    <Alert>
                      <AlertDescription>
                        No payment tokens are configured yet for this sale.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Pay with</label>
                          <Select value={paymentToken} onValueChange={setPaymentToken}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select payment token" />
                            </SelectTrigger>
                            <SelectContent>
                              {info.paymentTokens.map((t) => (
                                <SelectItem key={t.address} value={t.address}>
                                  {t.symbol}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">{symbol} amount</label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="any"
                            placeholder="0.0"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            disabled={!info.active || guestMode}
                          />
                        </div>
                      </div>

                      <div className="rounded border p-3 text-sm space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">USD value</span>
                          <span>${formatUsd(quoteUsd)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Cost in {selectedPayment?.symbol || "payment"}
                          </span>
                          <span>
                            {quoteLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin inline" />
                            ) : (
                              `${formatTokenAmount(quotePayment, selectedPayment?.decimals ?? 18, 6)} ${
                                selectedPayment?.symbol || ""
                              }`
                            )}
                          </span>
                        </div>
                        {info.perWalletCap !== "0" && !guestMode && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Your wallet remaining</span>
                            <span>
                              {formatTokenAmount(position.remainingForWallet, saleDecimals)} {symbol}
                            </span>
                          </div>
                        )}
                      </div>

                      <Button
                        onClick={handleBuy}
                        disabled={!canBuy || buyLoading}
                        className="w-full"
                      >
                        {buyLoading ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Submitting…
                          </>
                        ) : info.paused ? (
                          "Sale paused"
                        ) : beforeStart ? (
                          "Sale not started"
                        ) : afterEnd ? (
                          "Sale ended"
                        ) : guestMode ? (
                          "Sign in to buy"
                        ) : (
                          `Buy ${symbol}`
                        )}
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Recent purchases */}
              <Card>
                <CardContent className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Recent purchases</h3>
                  {purchases.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No purchases yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-muted-foreground">
                            <th className="py-2">Buyer</th>
                            <th className="py-2">{symbol}</th>
                            <th className="py-2">Paid</th>
                            <th className="py-2">USD</th>
                            <th className="py-2">When</th>
                          </tr>
                        </thead>
                        <tbody>
                          {purchases.map((p, i) => (
                            <tr key={`${p.hash || ""}-${i}`} className="border-t">
                              <td className="py-2">{formatShortAddress(p.buyer)}</td>
                              <td className="py-2">{formatTokenAmount(p.saleAmount, saleDecimals)}</td>
                              <td className="py-2">
                                {formatTokenAmount(p.paymentAmount, 18, 4)} {p.paymentTokenSymbol}
                              </td>
                              <td className="py-2">${formatUsd(p.usdValue)}</td>
                              <td className="py-2">{p.timestamp ? new Date(p.timestamp).toLocaleString() : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default FixedPriceSalePage;
