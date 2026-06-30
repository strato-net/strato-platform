import React from "react";
import { Modal } from "antd";
import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";

export type MetalBuyStepStatus = "pending" | "processing" | "completed" | "error";

export interface MetalBuyStep {
  id: string;
  label: string;
  description: string;
  status: MetalBuyStepStatus;
  hash?: string;
  error?: string;
}

interface MetalBuyProgressModalProps {
  open: boolean;
  steps: MetalBuyStep[];
  error?: string;
  onClose?: () => void;
}

const MetalBuyProgressModal: React.FC<MetalBuyProgressModalProps> = ({
  open,
  steps,
  error,
  onClose,
}) => {
  const allCompleted = steps.length > 0 && steps.every((step) => step.status === "completed");
  const hasError = steps.some((step) => step.status === "error") || !!error;
  const canClose = allCompleted || hasError;

  const iconFor = (status: MetalBuyStepStatus) => {
    if (status === "completed") return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    if (status === "processing") return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    if (status === "error") return <AlertCircle className="w-5 h-5 text-red-500" />;
    return <Circle className="w-5 h-5 text-muted-foreground" />;
  };

  const containerFor = (status: MetalBuyStepStatus) => {
    if (status === "completed") return "bg-green-500/10 border border-green-500/30";
    if (status === "processing") return "bg-blue-500/10 border-2 border-blue-500/30";
    if (status === "error") return "bg-red-500/10 border border-red-500/30";
    return "bg-muted/30 border border-border";
  };

  const textFor = (status: MetalBuyStepStatus) => {
    if (status === "completed") return "text-green-500";
    if (status === "processing") return "text-blue-500";
    if (status === "error") return "text-red-500";
    return "text-muted-foreground";
  };

  const badgeFor = (status: MetalBuyStepStatus) => {
    if (status === "completed") return "bg-green-500/20 text-green-500";
    if (status === "processing") return "bg-blue-500/20 text-blue-500";
    if (status === "error") return "bg-red-500/20 text-red-500";
    return "bg-muted text-muted-foreground";
  };

  const labelFor = (status: MetalBuyStepStatus) => {
    if (status === "completed") return "Completed";
    if (status === "processing") return "In Progress";
    if (status === "error") return "Failed";
    return "Pending";
  };

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
            {hasError ? "Metal Purchase Failed" : allCompleted ? "Metal Purchase Complete" : "Processing Metal Purchase"}
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
          {steps.map((step) => (
            <div key={step.id} className={`rounded-lg transition-all ${containerFor(step.status)}`}>
              <div className="flex items-start gap-4 p-4">
                <div className="flex-shrink-0 mt-0.5">{iconFor(step.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className={`font-medium ${textFor(step.status)}`}>{step.label}</h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeFor(step.status)}`}>
                      {labelFor(step.status)}
                    </span>
                  </div>
                  <p className={`text-sm mt-1 ${textFor(step.status)}`}>{step.description}</p>
                  {step.hash && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Tx: <span className="font-mono">{step.hash.slice(0, 10)}...{step.hash.slice(-8)}</span>
                    </p>
                  )}
                  {step.error && (
                    <p className="text-xs text-red-500 mt-2">{step.error}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default MetalBuyProgressModal;
