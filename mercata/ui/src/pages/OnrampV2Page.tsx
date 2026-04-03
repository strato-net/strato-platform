import { useState, useCallback, useRef, useEffect } from "react";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import PurchaseHistory from "../components/onramp/PurchaseHistory";
import { useUser } from "@/context/UserContext";
import { useNetwork } from "@/context/NetworkContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { api } from "@/lib/axios";
import { getConfig } from "@/lib/config";
import {
  Loader2,
  AlertCircle,
  Info,
  CreditCard,
  ArrowDown,
  Wallet,
  ExternalLink,
  Star,
} from "lucide-react";

const ONRAMP_NODES: Record<string, string[]> = {
  testnet: ["https://buildtest.testnet.strato.nexus", "localhost:3000"],
  mainnet: ["https://app.strato.nexus"],
};

const CRYPTO_OPTIONS = [
  { code: "USDC", label: "USDC → USDST" },
  { code: "ETH", label: "ETH → ETH" },
];

interface Quote {
  serviceProvider: string;
  sourceAmount: number;
  destinationAmount: number;
  destinationCurrencyCode: string;
  totalFee: number;
  exchangeRate: number;
  paymentMethodType: string;
  rampIntelligence?: { rampScore: number; lowKyc: boolean };
}

const OnrampV2Page = () => {
  const { isLoggedIn } = useUser();
  const { isTestnet } = useNetwork();
  const onrampNodeUrls = isTestnet ? ONRAMP_NODES.testnet : ONRAMP_NODES.mainnet;
  const isOnrampNode =
    typeof window !== "undefined" &&
    onrampNodeUrls.some((url) => url.includes(window.location.hostname));

  // Form state
  const [amount, setAmount] = useState("100");
  const [crypto, setCrypto] = useState("USDC");

  // Quote state
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");

  // Session state
  const [sessionLoading, setSessionLoading] = useState<string | null>(null);
  const [purchaseInProgress, setPurchaseInProgress] = useState(false);
  const [sessionError, setSessionError] = useState("");

  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Config
  const [meldEnabled, setMeldEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    getConfig().then((cfg) => setMeldEnabled(cfg.meldEnabled ?? false));
  }, []);

  const fetchQuotes = useCallback(async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setQuoteError("Enter a valid amount");
      return;
    }
    setQuoteLoading(true);
    setQuoteError("");
    setQuotes([]);
    try {
      const { data } = await api.post("/onramp/v2/quote", {
        sourceAmount: amount,
        destinationCurrencyCode: crypto,
      });
      const sortedQuotes = (data.data?.quotes || []).sort(
        (a: Quote, b: Quote) =>
          (b.rampIntelligence?.rampScore || 0) - (a.rampIntelligence?.rampScore || 0)
      );
      setQuotes(sortedQuotes);
      if (sortedQuotes.length === 0) setQuoteError("No providers available for this configuration.");
    } catch (err: any) {
      setQuoteError(err?.response?.data?.error?.message || "Failed to get quotes.");
    } finally {
      setQuoteLoading(false);
    }
  }, [amount, crypto]);

  const stopRefresh = useCallback(() => {
    if (refreshRef.current) {
      clearInterval(refreshRef.current);
      refreshRef.current = null;
    }
  }, []);

  const buyWithProvider = useCallback(
    async (quote: Quote) => {
      setSessionLoading(quote.serviceProvider);
      setSessionError("");
      try {
        const { data } = await api.post("/onramp/v2/session", {
          sourceAmount: amount,
          destinationCurrencyCode: crypto,
          serviceProvider: quote.serviceProvider,
        });

        const { widgetUrl } = data.data;
        window.open(widgetUrl, "meld-onramp", "width=500,height=750,scrollbars=yes,resizable=yes");

        setPurchaseInProgress(true);
        stopRefresh();
        refreshRef.current = setInterval(() => {
          setPurchaseRefreshKey((k) => k + 1);
        }, 15000);
      } catch (err: any) {
        setSessionError(
          err?.response?.data?.error?.message || "Failed to create onramp session."
        );
      } finally {
        setSessionLoading(null);
      }
    },
    [amount, crypto, stopRefresh]
  );

  const dismissBanner = useCallback(() => {
    setPurchaseInProgress(false);
    stopRefresh();
    setPurchaseRefreshKey((k) => k + 1);
  }, [stopRefresh]);

  useEffect(() => {
    return stopRefresh;
  }, [stopRefresh]);

  const formatProvider = (name: string) =>
    name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

  return (
    <div className="h-screen bg-background overflow-hidden pb-16 md:pb-0">
      <DashboardSidebar />

      <div
        className="h-screen flex flex-col transition-all duration-300"
        style={{ paddingLeft: "var(--sidebar-width, 0px)" }}
      >
        <DashboardHeader title="Buy Crypto" />

        <main className="flex-1 p-4 md:p-6 pb-10 md:pb-6 overflow-y-auto">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to purchase crypto with card, bank transfer, or Apple Pay" />
          )}

          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left Column — Purchase Form */}
            <div className="space-y-4 max-w-lg w-full mx-auto lg:mx-0">
              {meldEnabled === null ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !meldEnabled ? (
                <div className="rounded-xl border bg-card p-6 text-center space-y-4">
                  <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">
                    Crypto onramp is not configured on this node.
                  </p>
                </div>
              ) : !isOnrampNode ? (
                <div className="rounded-xl border bg-card p-6 text-center space-y-4">
                  <CreditCard className="h-10 w-10 text-muted-foreground mx-auto" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      Crypto onramp is available on the main STRATO node
                    </p>
                    <p className="text-xs text-muted-foreground">
                      To purchase crypto with card, bank transfer, or Apple Pay, please
                      use the designated onramp node.
                    </p>
                  </div>
                  <a
                    href={`${onrampNodeUrls[0]}/dashboard/onramp`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Go to {isTestnet ? "Testnet " : ""}Onramp
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : (
                <>
                  {/* Amount & Crypto Selection */}
                  <div className="rounded-xl border bg-card p-5 space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        Amount (USD)
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="100"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium text-foreground">
                        Receive
                      </label>
                      <select
                        value={crypto}
                        onChange={(e) => {
                          setCrypto(e.target.value);
                          setQuotes([]);
                        }}
                        className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {CRYPTO_OPTIONS.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      onClick={fetchQuotes}
                      disabled={quoteLoading || !amount}
                      className="w-full py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {quoteLoading && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Get Quotes
                    </button>
                  </div>

                  {/* Error */}
                  {(quoteError || sessionError) && (
                    <div className="flex items-start gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg text-sm">
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>{quoteError || sessionError}</span>
                    </div>
                  )}

                  {/* Purchase In Progress Banner */}
                  {purchaseInProgress && (
                    <div className="flex items-center justify-between text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5 rounded-lg text-sm">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        <span>
                          Complete the payment in the popup. Your purchase will
                          appear in the history below once processed.
                        </span>
                      </div>
                      <button
                        onClick={dismissBanner}
                        className="text-xs underline shrink-0 ml-2 hover:text-blue-800"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {/* Quotes List */}
                  {quotes.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground px-1">
                        Available Providers
                      </p>
                      {quotes.map((q, i) => (
                        <div
                          key={q.serviceProvider}
                          className="rounded-lg border bg-card p-4 flex items-center justify-between gap-3"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                {formatProvider(q.serviceProvider)}
                              </span>
                              {i === 0 && (
                                <span className="flex items-center gap-0.5 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded-full">
                                  <Star className="h-3 w-3" />
                                  Best
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1 space-x-3">
                              <span>
                                You get:{" "}
                                <span className="text-foreground font-medium">
                                  {q.destinationAmount} {q.destinationCurrencyCode}
                                </span>
                              </span>
                              <span>Fee: ${q.totalFee.toFixed(2)}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => buyWithProvider(q)}
                            disabled={sessionLoading !== null}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5"
                          >
                            {sessionLoading === q.serviceProvider && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            Buy
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Info */}
                  <div className="flex items-start gap-2 text-xs text-muted-foreground px-1">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Powered by Meld. Purchases are processed by third-party
                      providers — STRATO never sees your card or bank details.
                      Once crypto arrives at STRATO's receiving address, we
                      automatically credit the equivalent tokens to your
                      account.
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Right Column — How It Works + Purchase History */}
            {isLoggedIn && (
              <div className="space-y-6 max-w-lg w-full mx-auto lg:mx-0">
                <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-2">
                  <p className="text-sm">How it works</p>
                  <ol className="space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Pay with card, bank transfer, or Apple Pay via a
                        supported provider
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        The provider delivers the purchased crypto to STRATO's
                        receiving address
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Wallet className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Once crypto arrives, we automatically credit the
                        equivalent wrapped tokens to your STRATO account
                      </span>
                    </li>
                  </ol>
                </div>

                <PurchaseHistory refreshKey={purchaseRefreshKey} />
              </div>
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default OnrampV2Page;
