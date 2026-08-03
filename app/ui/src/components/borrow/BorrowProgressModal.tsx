import React from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Circle, AlertCircle } from "lucide-react";
import { CollateralData } from "@/interface";

export type StepStatus = "pending" | "processing" | "completed" | "error";

export interface BorrowStep {
  id: string;
  label: string;
  status: StepStatus;
  asset?: CollateralData;
  amount?: string;
  error?: string;
}

interface BorrowProgressModalProps {
  open: boolean;
  steps: BorrowStep[];
  onClose?: () => void;
}

const BorrowProgressModal: React.FC<BorrowProgressModalProps> = ({
  open,
  steps,
  onClose,
}) => {
  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case "processing":
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case "error":
        return <AlertCircle className="w-5 h-5 text-red-500" />;
      default:
        return <Circle className="w-5 h-5 text-muted-foreground" />;
    }
  };

  const getStepColor = (status: StepStatus) => {
    switch (status) {
      case "completed":
        return "border-green-500 bg-green-500/10";
      case "processing":
        return "border-blue-500 bg-blue-500/10";
      case "error":
        return "border-red-500 bg-red-500/10";
      default:
        return "border-muted bg-muted/50";
    }
  };

  const allCompleted = steps.every((step) => step.status === "completed");
  const hasError = steps.some((step) => step.status === "error");
  const isProcessing = steps.some((step) => step.status === "processing");

  return (
    <Modal
      title={
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            hasError ? "bg-red-500/20" : allCompleted ? "bg-green-500/20" : "bg-blue-500/20"
          }`}>
            {hasError ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : allCompleted ? (
              <CheckCircle2 className="w-5 h-5 text-green-500" />
            ) : (
              <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
            )}
          </div>
          <span className="text-lg font-semibold text-foreground">
            {hasError ? "Borrow Failed" : allCompleted ? "Borrow Complete" : "Processing Borrow"}
          </span>
        </div>
      }
      open={open}
      onCancel={allCompleted || hasError ? onClose : undefined}
      footer={null}
      closable={allCompleted || hasError}
      width={600}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-content]:border-2 [&_.ant-modal-content]:border-blue-200 [&_.ant-modal-content]:dark:border-blue-400 [&_.ant-modal-content]:shadow-[0_0_24px_rgba(59,130,246,0.25)] [&_.ant-modal-content]:dark:shadow-[0_0_24px_rgba(96,165,250,0.35)] [&_.ant-modal-content]:backdrop-blur-sm [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-close]:text-muted-foreground"
    >
      <div className="space-y-4">
        {/* Steps List */}
        <div className="space-y-0">
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const showConnector = !isLast;
            const nextStepCompleted = !isLast && steps[index + 1]?.status === "completed";
            
            return (
              <div key={step.id} className="relative">
                <div className="flex items-start gap-4 pb-4">
                  {/* Step Icon */}
                  <div className="relative flex-shrink-0">
                    <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center ${getStepColor(step.status)}`}>
                      {getStepIcon(step.status)}
                    </div>
                    {/* Connector Line */}
                    {showConnector && (
                      <div className={`absolute left-1/2 top-10 w-0.5 h-4 -translate-x-1/2 ${
                        step.status === "completed" ? "bg-green-500" : "bg-muted"
                      }`} />
                    )}
                  </div>
                  
                  {/* Step Content */}
                  <div className="flex-1 min-w-0 pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-medium ${
                        step.status === "completed" ? "text-green-600 dark:text-green-400" :
                        step.status === "processing" ? "text-blue-600 dark:text-blue-400" :
                        step.status === "error" ? "text-red-600 dark:text-red-400" :
                        "text-muted-foreground"
                      }`}>
                        {step.label}
                      </span>
                      {step.status === "processing" && (
                        <span className="text-xs text-muted-foreground">Processing...</span>
                      )}
                    </div>
                    
                    {step.asset && step.amount && (
                      <div className="text-sm text-muted-foreground">
                        {step.amount} {step.asset._symbol}
                      </div>
                    )}
                    
                    {step.error && (
                      <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                        {step.error}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Message */}
        {allCompleted && (
          <div className="mt-4 p-4 bg-green-500/10 dark:bg-green-500/20 border border-green-500/30 rounded-lg">
            <div className="text-sm text-green-800 dark:text-green-200">
              <div className="font-medium mb-1">Borrow Successful!</div>
              <div>All steps completed successfully. Your borrow transaction has been processed.</div>
            </div>
          </div>
        )}

        {hasError && (
          <div className="mt-4 p-4 bg-red-500/10 dark:bg-red-500/20 border border-red-500/30 rounded-lg">
            <div className="text-sm text-red-800 dark:text-red-200">
              <div className="font-medium mb-1">Transaction Failed</div>
              <div>One or more steps failed. Please try again or contact support if the issue persists.</div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default BorrowProgressModal;
