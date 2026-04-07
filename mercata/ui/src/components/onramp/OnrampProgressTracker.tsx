import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Clock, AlertCircle, X } from "lucide-react";
import { api } from "@/lib/axios";
import { useNavigate } from "react-router-dom";

type PurchaseStep = "purchasing" | "routing" | "bridging" | "completed" | "failed";

interface PurchaseStatus {
  step: PurchaseStep;
  meldStatus: string | null;
  bridgeStatus: number | null;
  destinationAmount: string | null;
  destinationCurrency: string | null;
  serviceProvider: string | null;
}

interface OnrampProgressTrackerProps {
  sessionId: string;
  onComplete?: () => void;
  onDismiss?: () => void;
}

const STRATO_TOKEN: Record<string, string> = {
  ETH: "ETH",
  USDC: "USDST",
};

const STEP_DEFS = (token: string, amount: string) => [
  {
    key: "purchasing",
    label: "Purchasing Crypto",
    description: "Your payment is being processed by the provider.",
  },
  {
    key: "crediting",
    label: `Crediting ${amount ? amount + " " : ""}${token} to Your Account`,
    description: "STRATO is verifying the deposit and minting your tokens. This may take 1-3 minutes.",
  },
  {
    key: "completed",
    label: `${amount ? amount + " " : ""}${token} Credited`,
    description: `All set! ${amount ? amount + " " : ""}${token} has been credited to your STRATO account.`,
  },
];

function mapStepToIndex(step: PurchaseStep): number {
  if (step === "purchasing") return 0;
  if (step === "routing" || step === "bridging") return 1;
  if (step === "completed") return 2;
  return -1;
}

const OnrampProgressTracker: React.FC<OnrampProgressTrackerProps> = ({
  sessionId,
  onComplete,
  onDismiss,
}) => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PurchaseStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const { data } = await api.get("/onramp/v2/purchase-status", {
          params: { sessionId },
        });
        const s: PurchaseStatus = data.data;
        setStatus(s);

        if (s.step === "completed" || s.step === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          if (s.step === "completed") onComplete?.();
        }
      } catch {
        // keep polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 10000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [sessionId]);

  const isFailed = status?.step === "failed";
  const isDone = status?.step === "completed";
  const stratoToken = status?.destinationCurrency
    ? STRATO_TOKEN[status.destinationCurrency] || status.destinationCurrency
    : "";
  const formattedAmount = status?.destinationAmount
    ? Number(status.destinationAmount).toFixed(6)
    : "";
  const amountLabel = formattedAmount && stratoToken ? `${formattedAmount} ${stratoToken}` : "";

  const STEPS = STEP_DEFS(stratoToken || "crypto", formattedAmount);
  const activeIndex = status ? mapStepToIndex(status.step) : 0;

  const getIcon = (idx: number) => {
    if (isFailed) {
      return idx <= activeIndex
        ? <AlertCircle className="w-5 h-5 text-red-500" />
        : <Clock className="w-5 h-5 text-muted-foreground" />;
    }
    if (idx < activeIndex) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (idx === activeIndex) {
      if (isDone) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const getStepStyle = (idx: number) => {
    if (isFailed && idx <= activeIndex)
      return "bg-red-500/10 border border-red-500/30";
    if (idx < activeIndex)
      return "bg-green-500/10 border border-green-500/30";
    if (idx === activeIndex && !isFailed)
      return isDone
        ? "bg-green-500/10 border border-green-500/30"
        : "bg-blue-500/10 border-2 border-blue-500/30";
    return "bg-muted/30 border border-border";
  };

  const getLabelColor = (idx: number) => {
    if (isFailed && idx <= activeIndex) return "text-red-500";
    if (idx < activeIndex) return "text-green-500";
    if (idx === activeIndex && !isFailed)
      return isDone ? "text-green-500" : "text-blue-500";
    return "text-muted-foreground";
  };

  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <AlertCircle className="w-5 h-5 text-red-500" />
          ) : isDone ? (
            <CheckCircle2 className="w-5 h-5 text-green-500" />
          ) : (
            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {isFailed
              ? "Purchase Failed"
              : isDone
              ? `${amountLabel} Credited`
              : "Purchase in Progress"}
          </span>
        </div>
        {(isDone || isFailed) && (
          <button
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        {STEPS.map((step, idx) => {
          const isActive = idx === activeIndex && !isFailed && !isDone;
          return (
            <div
              key={step.key}
              className={`flex items-start gap-3 px-3 py-2 rounded-lg transition-all ${getStepStyle(idx)}`}
            >
              <div className="flex-shrink-0 mt-0.5">{getIcon(idx)}</div>
              <div className="flex-1 min-w-0">
                <h4 className={`text-sm font-medium ${getLabelColor(idx)}`}>
                  {step.label}
                </h4>
                {(isActive || (isDone && idx === activeIndex)) && (
                  <p className={`text-xs mt-0.5 ${getLabelColor(idx)}/80`}>
                    {isDone && amountLabel
                      ? `${amountLabel} has been credited to your account.`
                      : step.description}
                  </p>
                )}
              </div>
              {isActive && (
                <span className="text-xs text-blue-500 font-medium shrink-0 mt-0.5">
                  In Progress
                </span>
              )}
            </div>
          );
        })}
      </div>

      {isFailed && (
        <p className="text-xs text-red-500 px-1">
          {status?.meldStatus === "CANCELLED"
            ? "The transaction was cancelled."
            : "The transaction failed. Please try again."}
        </p>
      )}

      {isDone && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onDismiss}
            className="px-3 py-1.5 text-sm border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={() => {
              onDismiss?.();
              navigate("/dashboard");
            }}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Portfolio
          </button>
        </div>
      )}
    </div>
  );
};

export default OnrampProgressTracker;
