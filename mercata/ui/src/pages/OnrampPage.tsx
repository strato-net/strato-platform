import { useEffect, useState, useRef, useCallback } from "react";
import { loadStripeOnramp } from "@stripe/crypto";
import { useTheme } from "next-themes";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import OnrampProgressModal from "../components/bridge/OnrampProgressModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "@/context/UserContext";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { api } from "@/lib/axios";
import { getConfig } from "@/lib/config";
import { Loader2, AlertCircle, CheckCircle2, Clock, Info, CreditCard, ArrowDown, Wallet } from "lucide-react";

type SessionStatus =
  | "idle"
  | "loading"
  | "ready"
  | "requires_payment"
  | "fulfillment_processing"
  | "fulfillment_complete"
  | "rejected"
  | "error";

interface OnrampTransaction {
  stripeSessionId: string;
  status: string;
  destinationCurrency?: string;
  destinationNetwork?: string;
  destinationAmount?: string;
  createdAt: string;
  completedAt?: string;
}

const STRATO_TOKEN: Record<string, string> = {
  eth: "ETHST",
  usdc: "USDST",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  initialized: { label: "Started", color: "text-gray-500" },
  requires_payment: { label: "Awaiting Payment", color: "text-yellow-600" },
  fulfillment_processing: { label: "Processing", color: "text-blue-600" },
  fulfillment_complete: { label: "Complete", color: "text-green-600" },
  rejected: { label: "Rejected", color: "text-red-600" },
  failed: { label: "Failed", color: "text-red-600" },
};

const ITEMS_PER_PAGE = 7;

const PurchaseHistory = ({ transactions }: { transactions: OnrampTransaction[] }) => {
  const [page, setPage] = useState(1);
  const purchases = transactions.filter((tx) => tx.status === "fulfillment_complete" || tx.status === "rejected");
  const totalPages = Math.ceil(purchases.length / ITEMS_PER_PAGE);
  const pageItems = purchases.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">Purchase History</CardTitle>
      </CardHeader>
      <CardContent>
        {purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No purchases yet. Complete a purchase to see it here.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Token</th>
                    <th className="pb-2 font-medium">Amount</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((tx) => {
                    const statusInfo = STATUS_LABELS[tx.status] || {
                      label: tx.status,
                      color: "text-gray-500",
                    };
                    return (
                      <tr key={tx.stripeSessionId} className="border-b last:border-0">
                        <td className="py-3">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            {new Date(tx.createdAt).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="py-3">
                          <span className="uppercase">{tx.destinationCurrency || "—"}</span>
                          {tx.destinationCurrency && STRATO_TOKEN[tx.destinationCurrency] && (
                            <span className="text-muted-foreground"> → {STRATO_TOKEN[tx.destinationCurrency]}</span>
                          )}
                        </td>
                        <td className="py-3" title={tx.destinationAmount || ""}>
                          {tx.destinationAmount
                            ? Number(tx.destinationAmount).toFixed(6)
                            : "—"}
                        </td>
                        <td className={`py-3 font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-3 border-t mt-2">
                <span className="text-xs text-muted-foreground">
                  {purchases.length} purchase{purchases.length !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Prev
                  </button>
                  <span className="text-xs text-muted-foreground px-2">
                    {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-2 py-1 text-xs rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

const OnrampPage = () => {
  const { isLoggedIn } = useUser();
  const { resolvedTheme } = useTheme();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [transactions, setTransactions] = useState<OnrampTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [onrampTxHash, setOnrampTxHash] = useState<string | null>(null);
  const onrampContainerRef = useRef<HTMLDivElement>(null);

  const fetchTransactions = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      setLoadingHistory(true);
      const { data } = await api.get("/onramp/transactions");
      setTransactions(data.data.transactions || []);
    } catch {
      // Silently fail — transaction history is not critical
    } finally {
      setLoadingHistory(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

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
          const txHash = session.quote?.blockchain_tx_id || session.transaction_details?.transaction_id;
          console.log(`[OnrampPage] fulfillment_complete — txHash=${txHash}`);
          setOnrampTxHash(txHash || null);
          fetchTransactions();
          setShowProgressModal(true);
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
  }, [isLoggedIn, fetchTransactions, resolvedTheme]);

  useEffect(() => {
    initOnramp();
  }, [initOnramp]);

  const renderStatusBadge = () => {
    switch (sessionStatus) {
      case "fulfillment_processing":
        return null;
      case "fulfillment_complete":
        return (
          <div className="flex items-start gap-2 text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg text-sm">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Purchase complete! Processing deposit...</span>
          </div>
        );
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
            {/* Left Column — Stripe Widget */}
            <div className="space-y-4 max-w-lg w-full mx-auto lg:mx-0">
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
                  details. The wallet address shown in the Stripe widget is
                  STRATO's receiving address; once crypto arrives, we
                  automatically credit the tokens to your account.
                </span>
              </div>
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
                      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                      <span>Stripe delivers the purchased crypto to STRATO's receiving address</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Wallet className="h-3.5 w-3.5 shrink-0" />
                      <span>Once crypto arrives, we automatically credit the equivalent wrapped tokens to your STRATO account</span>
                    </li>
                  </ol>
                </div>

                <PurchaseHistory transactions={transactions} />
              </div>
            )}
          </div>
        </main>
      </div>

      <MobileBottomNav />
      <OnrampProgressModal
        open={showProgressModal}
        externalTxHash={onrampTxHash}
        onClose={() => setShowProgressModal(false)}
      />
    </div>
  );
};

export default OnrampPage;
