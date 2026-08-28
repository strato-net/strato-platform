import React, { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";
import { formatTxHash, getExplorerUrl } from "@/lib/bridge/utils";

export type DepositStep = 
  | "approve"
  | "sign_permit"
  | "confirm_tx"
  | "waiting_tx"
  | "complete"
  | "error";

interface DepositProgressModalProps {
  open: boolean;
  currentStep: DepositStep;
  txHash?: string;
  chainId?: number;
  isNative?: boolean;
  isRedemption?: boolean;
  error?: string;
  onClose?: () => void;
}

const DepositProgressModal: React.FC<DepositProgressModalProps> = ({
  open,
  currentStep,
  txHash,
  chainId,
  isNative = true,
  isRedemption = false,
  error,
  onClose,
}) => {
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const lastActiveStepRef = useRef<number>(-1);

  const getSteps = () => {
    // For Bridge In, include approve and sign_permit steps only if it's not native (ERC20 token)
    const steps = [];
    if (!isNative) {
      steps.push(
        { key: "approve", label: "Approve token", description: "Approve token spending" },
        { key: "sign_permit", label: "Sign permit", description: "Sign permit message in your wallet" }
      );
    }
    steps.push(
      { key: "confirm_tx", label: "Confirm transaction", description: "Confirm transaction in your wallet" },
      { key: "waiting_tx", label: "Waiting for transaction", description: "Transaction is being processed on-chain" },
      {
        key: "complete",
        label: isRedemption ? "Processing redemption" : "Processing deposit",
        description: isRedemption
          ? "All set! STRATO is processing your redemption (1-2 min). You can close this modal anytime."
          : "All set! STRATO is processing your deposit (1-2 min). You can close this modal anytime."
      }
    );
    return steps;
  };

  const steps = getSteps();
  const rawStepIndex = steps.findIndex((s) => s.key === currentStep);
  const isError = currentStep === "error";

  // Track the last known active step so we can show it as failed on error
  if (rawStepIndex >= 0) {
    lastActiveStepRef.current = rawStepIndex;
  }

  const effectiveStepIndex = isError ? lastActiveStepRef.current : rawStepIndex;
  
  // Auto-collapse all steps except the current one on step change
  useEffect(() => {
    if (effectiveStepIndex >= 0) {
      const newCollapsed = new Set<number>();
      for (let i = 0; i < steps.length; i++) {
        if (i !== effectiveStepIndex) {
          newCollapsed.add(i);
        }
      }
      setCollapsedSteps(newCollapsed);
    }
  }, [effectiveStepIndex, steps.length]);

  const getStepIcon = (stepIndex: number) => {
    const step = steps[stepIndex];
    const isCompleteStep = step?.key === "complete";
    
    if (effectiveStepIndex === -1) {
      return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
    if (stepIndex < effectiveStepIndex) {
      return <CheckCircle2 className="w-5 h-5 text-success" />;
    }
    if (stepIndex === effectiveStepIndex) {
      if (isError) {
        return <AlertCircle className="w-5 h-5 text-destructive" />;
      }
      if (isCompleteStep) {
        return <Clock className="w-5 h-5 text-warning" />;
      }
      return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const getStepStatus = (stepIndex: number) => {
    if (effectiveStepIndex === -1) {
      return "pending";
    }
    if (stepIndex < effectiveStepIndex) {
      return "completed";
    }
    if (stepIndex === effectiveStepIndex) {
      if (isError) {
        return "error";
      }
      if (currentStep === "complete") {
        return "completed";
      }
      return "active";
    }
    return "pending";
  };

  const canClose = currentStep === "complete" || currentStep === "error";

  return (
    <Modal
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            {currentStep === "error" ? (
              <AlertCircle className="w-5 h-5 text-destructive" />
            ) : currentStep === "complete" ? (
              <CheckCircle2 className="w-5 h-5 text-success animate-in zoom-in-95 fade-in-0 duration-200 ease-out motion-reduce:animate-none" />
            ) : (
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            )}
          </div>
          <span className="text-lg font-semibold text-foreground">
            {currentStep === "error"
              ? (isRedemption ? "Redemption failed" : "Deposit failed")
              : currentStep === "complete"
              ? (isRedemption ? "Redemption complete" : "Deposit complete")
              : (isRedemption ? "Processing redemption" : "Processing deposit")}
          </span>
        </div>
      }
      open={open}
      onCancel={canClose ? onClose : undefined}
      footer={canClose ? (
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          Close
        </button>
      ) : null}
      closable={canClose}
      maskClosable={canClose}
      width={550}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-footer]:bg-card [&_.ant-modal-footer]:border-border [&_.ant-modal-close]:text-muted-foreground"
    >
      <div className="space-y-6">
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            const isActive = status === "active";
            const isCompleted = status === "completed";
            const isError = status === "error";
            const isCurrentStep = index === effectiveStepIndex;
            const isCollapsed = collapsedSteps.has(index);

            const isCompleteStep = step.key === "complete" && isCurrentStep;
            return (
              <div
                key={step.key}
                className={`rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary/10 border-2 border-primary/30"
                    : isCompleted && isCompleteStep
                    ? "bg-warning/10 border border-warning/30"
                    : isCompleted
                    ? "bg-success/10 border border-success/30"
                    : isError
                    ? "bg-destructive/10 border border-destructive/30"
                    : "bg-muted/30 border border-border"
                }`}
              >
                {isCollapsed ? (
                  <div 
                    className={`flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer ${
                      isCompleteStep ? "hover:bg-warning/20" : isCompleted ? "hover:bg-success/20" : "hover:bg-muted/50"
                    }`}
                    onClick={() => setCollapsedSteps(prev => {
                      const next = new Set(prev);
                      next.delete(index);
                      return next;
                    })}
                  >
                    <div className="flex-shrink-0">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-medium text-sm ${
                        isCompleteStep ? "text-warning" : isCompleted ? "text-success" : "text-muted-foreground"
                      }`}>{step.label}</h4>
                    </div>
                    <span className={`text-xs ${
                      isCompleteStep ? "text-warning" : isCompleted ? "text-success" : "text-muted-foreground"
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
                              ? "text-primary"
                              : isCompleted && isCompleteStep
                              ? "text-warning"
                              : isCompleted
                              ? "text-success"
                              : isError
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        >
                          {step.label}
                        </h4>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <span className="text-xs text-primary font-medium">In progress</span>
                          )}
                          <button
                            onClick={() => setCollapsedSteps(prev => new Set(prev).add(index))}
                            className={`text-xs underline ${
                              isCompleteStep
                                ? "text-warning hover:text-warning/80"
                                : isCompleted
                                ? "text-success hover:text-success/80"
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
                            ? "text-primary/80"
                            : isCompleted && isCompleteStep
                            ? "text-warning/80"
                            : isCompleted
                            ? "text-success/80"
                            : isError
                            ? "text-destructive/80"
                            : "text-muted-foreground"
                        }`}
                      >
                        {step.description}
                      </p>
                      {txHash && chainId && step.key === "waiting_tx" && (
                        <div className="mt-2">
                          <a
                            href={getExplorerUrl(chainId.toString(), txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:text-primary/80 underline"
                          >
                            View transaction: <span className="font-mono">{formatTxHash(txHash)}</span> →
                          </a>
                        </div>
                      )}
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

export default DepositProgressModal;

