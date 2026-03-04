import React, { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock } from "lucide-react";
import { api } from "@/lib/axios";
import { useNavigate } from "react-router-dom";

interface OnrampProgressModalProps {
  open: boolean;
  externalTxHash?: string | null;
  currency?: string | null;
  amount?: string | null;
  onClose?: () => void;
}

const OnrampProgressModal: React.FC<OnrampProgressModalProps> = ({ open, externalTxHash, currency, amount, onClose }) => {
  const navigate = useNavigate();
  const [isDone, setIsDone] = useState(false);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cryptoName = currency === "usdc" ? "USDC" : currency === "eth" ? "ETH" : (currency || "crypto").toUpperCase();
  const stratoToken = currency === "usdc" ? "USDST" : currency === "eth" ? "ETHST" : cryptoName;
  const formattedAmount = amount ? Number(amount).toFixed(6) : "";

  const STEPS = [
    { key: "delivered", label: `${cryptoName} Delivered to STRATO Receiving Address`, description: `Stripe has delivered ${cryptoName} to the STRATO bridge.` },
    { key: "crediting", label: `Crediting ${formattedAmount ? formattedAmount + " " : ""}${stratoToken} to Your Account`, description: "STRATO is verifying the deposit and minting your tokens. This may take 1–3 minutes." },
    { key: "credited", label: `${formattedAmount ? formattedAmount + " " : ""}${stratoToken} Credited`, description: `All set! ${formattedAmount ? formattedAmount + " " : ""}${stratoToken} has been credited to your STRATO account.` },
  ];

  useEffect(() => {
    if (!open || !externalTxHash) return;

    setIsDone(false);

    const poll = async () => {
      try {
        console.log(`[OnrampModal] Polling deposit-status for ${externalTxHash}`);
        const response = await api.get("/onramp/deposit-status", {
          params: { txHash: externalTxHash },
        });
        console.log(`[OnrampModal] Response:`, response.data);
        if (response.data?.data?.status === "completed") {
          console.log(`[OnrampModal] Deposit completed!`);
          setIsDone(true);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch (err) {
        console.warn(`[OnrampModal] Poll error:`, err);
      }
    };

    poll();
    pollRef.current = setInterval(poll, 10000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, externalTxHash]);

  const activeStepIndex = isDone ? 2 : 1;

  useEffect(() => {
    const newCollapsed = new Set<number>();
    for (let i = 0; i < STEPS.length; i++) {
      if (i !== activeStepIndex) newCollapsed.add(i);
    }
    setCollapsedSteps(newCollapsed);
  }, [activeStepIndex]);

  const getStepIcon = (idx: number) => {
    if (idx < activeStepIndex) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (idx === activeStepIndex) {
      if (isDone) return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const getStepStatus = (idx: number): "completed" | "active" | "pending" => {
    if (idx < activeStepIndex) return "completed";
    if (idx === activeStepIndex) return isDone ? "completed" : "active";
    return "pending";
  };

  const handleClose = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    onClose?.();
  };

  return (
    <Modal
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            {isDone ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            )}
          </div>
          <span className="text-lg font-semibold text-foreground">
            {isDone ? "Deposit Complete" : "Processing Deposit"}
          </span>
        </div>
      }
      open={open}
      onCancel={handleClose}
      footer={
        isDone ? (
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => { handleClose(); navigate("/dashboard"); }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Go to Portfolio
            </button>
          </div>
        ) : null
      }
      closable={true}
      maskClosable={isDone}
      width={550}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-footer]:bg-card [&_.ant-modal-footer]:border-border [&_.ant-modal-close]:text-muted-foreground"
    >
      <div className="space-y-6">
        <div className="space-y-2">
          {STEPS.map((step, index) => {
            const status = getStepStatus(index);
            const isActive = status === "active";
            const isCompleted = status === "completed";
            const isCurrentStep = index === activeStepIndex;
            const isCollapsed = collapsedSteps.has(index);
            return (
              <div
                key={step.key}
                className={`rounded-lg transition-all ${
                  isActive
                    ? "bg-blue-500/10 border-2 border-blue-500/30"
                    : isCompleted
                    ? "bg-green-500/10 border border-green-500/30"
                    : "bg-muted/30 border border-border"
                }`}
              >
                {isCollapsed ? (
                  <div
                    className={`flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer ${
                      isCompleted ? "hover:bg-green-500/20" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setCollapsedSteps((prev) => {
                      const next = new Set(prev);
                      next.delete(index);
                      return next;
                    })}
                  >
                    <div className="flex-shrink-0">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-medium text-sm ${
                        isCompleted ? "text-green-500" : "text-muted-foreground"
                      }`}>{step.label}</h4>
                    </div>
                    <span className={`text-xs ${
                      isCompleted ? "text-green-500" : "text-muted-foreground"
                    }`}>Click to expand</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 p-4">
                    <div className="flex-shrink-0 mt-0.5">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4
                          className={`font-medium ${
                            isActive
                              ? "text-blue-500"
                              : isCompleted
                              ? "text-green-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {step.label}
                        </h4>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <span className="text-xs text-blue-500 font-medium">In Progress</span>
                          )}
                          <button
                            onClick={() => setCollapsedSteps((prev) => new Set(prev).add(index))}
                            className={`text-xs underline ${
                              isCompleted
                                ? "text-green-500 hover:text-green-600"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Collapse
                          </button>
                        </div>
                      </div>
                      <p
                        className={`text-sm mt-1 ${
                          isActive
                            ? "text-blue-500/80"
                            : isCompleted
                            ? "text-green-500/80"
                            : "text-muted-foreground"
                        }`}
                      >
                        {step.description}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};

export default OnrampProgressModal;
