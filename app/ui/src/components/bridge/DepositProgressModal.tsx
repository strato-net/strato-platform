import React, { useEffect, useRef, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";
import { formatTxHash, getExplorerUrl } from "@/lib/bridge/utils";

export type DepositStep = 
  | "approve"
  | "sign_permit"
  | "confirm_tx"
  | "waiting_tx"
  | "waiting_autosave"
  | "complete"
  | "error";

interface DepositProgressModalProps {
  open: boolean;
  currentStep: DepositStep;
  txHash?: string;
  chainId?: number;
  isEasySavings?: boolean;
  isNative?: boolean;
  error?: string;
  onClose?: () => void;
}

const DepositProgressModal: React.FC<DepositProgressModalProps> = ({
  open,
  currentStep,
  txHash,
  chainId,
  isEasySavings = false,
  isNative = true,
  error,
  onClose,
}) => {
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  const lastActiveStepRef = useRef<number>(-1);

  const getSteps = () => {
    if (isEasySavings) {
      return [
        { key: "approve", label: "Approve Token", description: "Approve token spending" },
        { key: "sign_permit", label: "Sign Permit", description: "Sign permit message in your wallet" },
        { key: "confirm_tx", label: "Confirm Transaction", description: "Confirm transaction in your wallet" },
        { key: "waiting_tx", label: "Waiting for Transaction", description: "Transaction is being processed on-chain" },
        { key: "waiting_autosave", label: "Waiting for Autosave", description: "Depositing to Easy Savings..." },
        { key: "complete", label: "Processing Deposit", description: "All set! STRATO is processing your deposit (1-2 min). You can close this modal anytime." },
      ];
    } else {
      // For Bridge In, include approve and sign_permit steps only if it's not native (ERC20 token)
      const steps = [];
      if (!isNative) {
        steps.push(
          { key: "approve", label: "Approve Token", description: "Approve token spending" },
          { key: "sign_permit", label: "Sign Permit", description: "Sign permit message in your wallet" }
        );
      }
      steps.push(
        { key: "confirm_tx", label: "Confirm Transaction", description: "Confirm transaction in your wallet" },
        { key: "waiting_tx", label: "Waiting for Transaction", description: "Transaction is being processed on-chain" },
        { key: "complete", label: "Processing Deposit", description: "All set! STRATO is processing your deposit (1-2 min). You can close this modal anytime." }
      );
      return steps;
    }
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
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    }
    if (stepIndex === effectiveStepIndex) {
      if (isError) {
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      }
      if (isCompleteStep) {
        return <Clock className="w-5 h-5 text-yellow-500" />;
      }
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
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
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            {currentStep === "error" ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : currentStep === "complete" ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            )}
          </div>
          <span className="text-lg font-semibold text-foreground">
            {currentStep === "error" 
              ? "Deposit Failed" 
              : currentStep === "complete" 
              ? "Deposit Complete" 
              : "Processing Deposit"}
          </span>
        </div>
      }
      open={open}
      onCancel={canClose ? onClose : undefined}
      footer={canClose ? (
        <button
          onClick={onClose}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-500">{error}</p>
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
                className={`rounded-lg transition-all ${
                  isActive
                    ? "bg-blue-500/10 border-2 border-blue-500/30"
                    : isCompleted && isCompleteStep
                    ? "bg-yellow-500/10 border border-yellow-500/30"
                    : isCompleted
                    ? "bg-green-500/10 border border-green-500/30"
                    : isError
                    ? "bg-red-500/10 border border-red-500/30"
                    : "bg-muted/30 border border-border"
                }`}
              >
                {isCollapsed ? (
                  <div 
                    className={`flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer ${
                      isCompleteStep ? "hover:bg-yellow-500/20" : isCompleted ? "hover:bg-green-500/20" : "hover:bg-muted/50"
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
                        isCompleteStep ? "text-yellow-500" : isCompleted ? "text-green-500" : "text-muted-foreground"
                      }`}>{step.label}</h4>
                    </div>
                    <span className={`text-xs ${
                      isCompleteStep ? "text-yellow-500" : isCompleted ? "text-green-500" : "text-muted-foreground"
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
                              : isCompleted && isCompleteStep
                              ? "text-yellow-500"
                              : isCompleted
                              ? "text-green-500"
                              : isError
                              ? "text-red-500"
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
                            onClick={() => setCollapsedSteps(prev => new Set(prev).add(index))}
                            className={`text-xs underline ${
                              isCompleteStep 
                                ? "text-yellow-500 hover:text-yellow-600" 
                                : isCompleted
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
                            : isCompleted && isCompleteStep
                            ? "text-yellow-500/80"
                            : isCompleted
                            ? "text-green-500/80"
                            : isError
                            ? "text-red-500/80"
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
                            className="text-xs text-blue-600 hover:text-blue-800 underline"
                          >
                            View Transaction: {formatTxHash(txHash)} →
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

