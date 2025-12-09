import React, { useEffect, useState } from "react";
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
  const getSteps = () => {
    if (isEasySavings) {
      return [
        { key: "approve", label: "Approve Token", description: "Approve token spending" },
        { key: "sign_permit", label: "Sign Permit", description: "Sign permit message in your wallet" },
        { key: "confirm_tx", label: "Confirm Transaction", description: "Confirm transaction in your wallet" },
        { key: "waiting_tx", label: "Waiting for Transaction", description: "Transaction is being processed on-chain" },
        { key: "waiting_autosave", label: "Waiting for Autosave", description: "Depositing to Easy Savings..." },
        { key: "complete", label: "Complete", description: "Deposit successful!" },
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
        { key: "complete", label: "Complete", description: "Deposit submitted successfully!" }
      );
      return steps;
    }
  };

  const steps = getSteps();
  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);
  
  // Auto-collapse completed steps when a new step becomes active
  useEffect(() => {
    if (currentStepIndex > 0) {
      // Collapse all steps before the current one
      const newCollapsed = new Set<number>();
      for (let i = 0; i < currentStepIndex; i++) {
        newCollapsed.add(i);
      }
      setCollapsedSteps(newCollapsed);
    }
  }, [currentStepIndex]);

  const getStepIcon = (stepIndex: number) => {
    // If current step not found in steps array, treat all as pending
    if (currentStepIndex === -1) {
      return <Clock className="w-5 h-5 text-gray-400" />;
    }
    if (stepIndex < currentStepIndex) {
      return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    }
    if (stepIndex === currentStepIndex) {
      if (currentStep === "error") {
        return <AlertCircle className="w-5 h-5 text-red-600" />;
      }
      if (currentStep === "complete") {
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      }
      return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />;
    }
    return <Clock className="w-5 h-5 text-gray-400" />;
  };

  const getStepStatus = (stepIndex: number) => {
    // If current step not found in steps array, treat all as pending
    if (currentStepIndex === -1) {
      return "pending";
    }
    if (stepIndex < currentStepIndex) {
      return "completed";
    }
    if (stepIndex === currentStepIndex) {
      if (currentStep === "error") {
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
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
            {currentStep === "error" ? (
              <AlertCircle className="w-5 h-5 text-red-600" />
            ) : currentStep === "complete" ? (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            ) : (
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
            )}
          </div>
          <span className="text-lg font-semibold">
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
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-gray-100 [&_.ant-modal-body]:p-6"
    >
      <div className="space-y-6">
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <div className="space-y-2">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            const isActive = status === "active";
            const isCompleted = status === "completed";
            const isError = status === "error";
            const isCollapsed = collapsedSteps.has(index) && isCompleted;

            return (
              <div
                key={step.key}
                className={`rounded-lg transition-all ${
                  isActive
                    ? "bg-blue-50 border-2 border-blue-200"
                    : isCompleted
                    ? "bg-green-50 border border-green-200"
                    : isError
                    ? "bg-red-50 border border-red-200"
                    : "bg-gray-50 border border-gray-200"
                }`}
              >
                {isCollapsed ? (
                  <div 
                    className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-green-100/50 transition-colors"
                    onClick={() => setCollapsedSteps(prev => {
                      const next = new Set(prev);
                      next.delete(index);
                      return next;
                    })}
                  >
                    <div className="flex-shrink-0">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-green-900 text-sm">{step.label}</h4>
                    </div>
                    <span className="text-xs text-green-600">Click to expand</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 p-4">
                    <div className="flex-shrink-0 mt-0.5">{getStepIcon(index)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4
                          className={`font-medium ${
                            isActive
                              ? "text-blue-900"
                              : isCompleted
                              ? "text-green-900"
                              : isError
                              ? "text-red-900"
                              : "text-gray-600"
                          }`}
                        >
                          {step.label}
                        </h4>
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <span className="text-xs text-blue-600 font-medium">In Progress</span>
                          )}
                          {isCompleted && !isActive && (
                            <button
                              onClick={() => setCollapsedSteps(prev => new Set(prev).add(index))}
                              className="text-xs text-green-600 hover:text-green-800 underline"
                            >
                              Collapse
                            </button>
                          )}
                        </div>
                      </div>
                      <p
                        className={`text-sm mt-1 ${
                          isActive
                            ? "text-blue-700"
                            : isCompleted
                            ? "text-green-700"
                            : isError
                            ? "text-red-700"
                            : "text-gray-500"
                        }`}
                      >
                        {step.description}
                      </p>
                      {isActive && txHash && chainId && step.key === "waiting_tx" && (
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

        {currentStep === "complete" && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800">
              {isEasySavings
                ? "Your deposit has been successfully processed and added to Easy Savings!"
                : "Your deposit has been submitted successfully. The relayer will process it shortly."}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default DepositProgressModal;

