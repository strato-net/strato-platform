import { useEffect, useState, useRef, useCallback } from "react";
import { loadStripeOnramp } from "@stripe/crypto";
import { useTheme } from "next-themes";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import { useUser } from "@/context/UserContext";
import { useNetwork } from "@/context/NetworkContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { api } from "@/lib/axios";
import { getConfig } from "@/lib/config";
import { Loader2, AlertCircle, Info, CreditCard, ArrowDown, Wallet, ExternalLink, CheckCircle2, ArrowUpRight } from "lucide-react";

const ONRAMP_NODES: Record<string, string[]> = {
  testnet: ["https://buildtest.testnet.strato.nexus", "localhost:3000"],
  mainnet: ["https://app.strato.nexus, https://workspace-hasan-j37a91h.blockapps.net"],
};

type SessionStatus =
  | "idle"
  | "loading"
  | "ready"
  | "requires_payment"
  | "fulfillment_processing"
  | "fulfillment_complete"
  | "rejected"
  | "error";


const OnrampPage = () => {
  const { isLoggedIn } = useUser();
  const { isTestnet } = useNetwork();
  const { resolvedTheme } = useTheme();
  const onrampNodeUrls = isTestnet ? ONRAMP_NODES.testnet : ONRAMP_NODES.mainnet;
  const isOnrampNode = typeof window !== "undefined" && onrampNodeUrls.some((url) => url.includes(window.location.hostname));
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [onrampCurrency, setOnrampCurrency] = useState<string | null>(null);
  const [onrampAmount, setOnrampAmount] = useState<string | null>(null);
  const onrampContainerRef = useRef<HTMLDivElement>(null);

  const initOnramp = useCallback(async () => {
    if (!isLoggedIn || !onrampContainerRef.current) return;

    setSessionStatus("loading");
    setErrorMessage("");

    try {
      const config = await getConfig();
      if (!config.stripePublishableKey) {
        setSessionStatus("error");
        setErrorMessage("Onramp is not configured. Contact support.");
        return;
      }

      const { data: sessionData } = await api.post("/onramp/session");
      const clientSecret = sessionData.data.clientSecret;

      const stripeOnramp = await loadStripeOnramp(config.stripePublishableKey);
      if (!stripeOnramp || !onrampContainerRef.current) return;

      onrampContainerRef.current.innerHTML = "";

      const session = stripeOnramp.createSession({
        clientSecret,
        appearance: { theme: resolvedTheme === "dark" ? "dark" : "light" },
      });

      session.addEventListener("onramp_ui_loaded", () => {
        setSessionStatus("ready");
      });

      session.addEventListener("onramp_session_updated", (e: any) => {
        const status = e.payload.session.status;
        setSessionStatus(status as SessionStatus);
        if (status === "fulfillment_complete") {
          const session = e.payload.session;
          const amount = session.quote?.destination_crypto_amount || session.transaction_details?.destination_amount || null;
          const currency = session.quote?.destination_currency?.asset_code || session.transaction_details?.destination_currency || null;
          setOnrampCurrency(currency);
          setOnrampAmount(amount);
        }
      });

      session.mount(onrampContainerRef.current);
    } catch (err: any) {
      const code = err?.response?.data?.error?.code;
      if (code === "crypto_onramp_unsupportable_customer") {
        setErrorMessage("Crypto onramp is not available in your region.");
      } else if (code === "crypto_onramp_disabled") {
        setErrorMessage("Crypto onramp is temporarily unavailable. Please try again later.");
      } else {
        setErrorMessage(err?.response?.data?.error?.message || "Failed to load onramp. Please try again.");
      }
      setSessionStatus("error");
    }
  }, [isLoggedIn, resolvedTheme]);

  useEffect(() => {
    initOnramp();
  }, [initOnramp]);

  const renderStatusBadge = () => {
    switch (sessionStatus) {
      case "fulfillment_processing":
        return null;
      case "fulfillment_complete": {
        const cryptoName = onrampCurrency === "usdc" ? "USDC" : onrampCurrency === "eth" ? "ETH" : (onrampCurrency || "crypto").toUpperCase();
        const displayAmount = onrampAmount ? `${Number(onrampAmount).toFixed(6)} ` : "";
        return (
          <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                Purchase Complete — {displayAmount}{cryptoName} sent to your wallet
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              To use your funds on STRATO, bridge the tokens using the STRATO Bridge.
            </p>
            <div className="flex gap-2">
              <a
                href="/dashboard/deposits"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Go to Bridge
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={initOnramp}
                className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
              >
                Buy More
              </button>
            </div>
          </div>
        );
      }
      case "rejected":
        return (
          <div className="flex items-start gap-2 text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              This session was rejected by Stripe. No payment was processed and
              your account has not been charged.
            </span>
          </div>
        );
      default:
        return null;
    }
  };

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
            <GuestSignInBanner message="Sign in to purchase crypto with card, ACH, or Apple Pay" />
          )}

          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left Column — Stripe Widget or Redirect */}
            <div className="space-y-4 max-w-lg w-full mx-auto lg:mx-0">
              {!isOnrampNode ? (
                <div className="rounded-xl border bg-card p-6 text-center space-y-4">
                  <CreditCard className="h-10 w-10 text-muted-foreground mx-auto" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Crypto onramp is available on the main STRATO node</p>
                    <p className="text-xs text-muted-foreground">
                      To purchase crypto with card, bank transfer, or Apple Pay, please use the designated onramp node.
                    </p>
                  </div>
                  <a
                    href={`${onrampNodeUrls[0]}/dashboard/onramp`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Go to {isTestnet ? "Testnet" : ""} Onramp
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              ) : (
                <>
                  {renderStatusBadge()}

                  {sessionStatus === "loading" && (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  )}

                  {sessionStatus === "error" && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                      <AlertCircle className="h-10 w-10 text-red-400" />
                      <p className="text-sm text-muted-foreground max-w-sm">{errorMessage}</p>
                      <button
                        onClick={initOnramp}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        Try again
                      </button>
                    </div>
                  )}

                  <div
                    ref={onrampContainerRef}
                    className={`rounded-xl overflow-hidden ${sessionStatus === "loading" || sessionStatus === "error" ? "hidden" : ""
                      }`}
                  />
                  <div className="flex items-start gap-2 text-xs text-muted-foreground px-1">
                    <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Powered by Stripe. Available in the US (excl. Hawaii) and EU.
                      Identity verification and payment processing are handled
                      securely by Stripe — STRATO never sees your card or bank
                      details. Enter your own wallet address to receive the crypto
                      directly, then bridge it to STRATO when ready.
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
                      <span>Pay with card, bank transfer, or Apple Pay via Stripe</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Wallet className="h-3.5 w-3.5 shrink-0" />
                      <span>Enter your Ethereum wallet address — crypto is sent directly to you</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                      <span>Bridge the tokens to STRATO when you're ready</span>
                    </li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default OnrampPage;
