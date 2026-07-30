import React from "react";
import { Modal } from "antd";
import { AlertCircle, CheckCircle2, Circle, Loader2 } from "lucide-react";

export type VaultActionProgressStatus = "pending" | "processing" | "completed" | "error";

export interface VaultActionProgressStep {
  id: string;
  label: string;
  description?: string;
  status: VaultActionProgressStatus;
  hash?: string;
  error?: string;
}

interface VaultActionProgressModalProps {
  open: boolean;
  actionLabel: string;
  steps: VaultActionProgressStep[];
  error?: string;
  onClose?: () => void;
}

const VaultActionProgressModal: React.FC<VaultActionProgressModalProps> = ({
  open,
  actionLabel,
  steps,
  error,
  onClose,
}) => {
  const allCompleted = steps.length > 0 && steps.every((step) => step.status === "completed");
  const hasError = steps.some((step) => step.status === "error") || !!error;
  const canClose = allCompleted || hasError;

  const getStepIcon = (status: VaultActionProgressStatus) => {
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

  const getStepClassName = (status: VaultActionProgressStatus) => {
    switch (status) {
      case "completed":
        return "bg-green-500/10 border border-green-500/30";
      case "processing":
        return "bg-blue-500/10 border-2 border-blue-500/30";
      case "error":
        return "bg-red-500/10 border border-red-500/30";
      default:
        return "bg-muted/30 border border-border";
    }
  };

  const getStatusLabel = (status: VaultActionProgressStatus) => {
    switch (status) {
      case "completed":
        return "Completed";
      case "processing":
        return "In Progress";
      case "error":
        return "Failed";
      default:
        return "Pending";
    }
  };

  const getStatusClassName = (status: VaultActionProgressStatus) => {
    switch (status) {
      case "completed":
        return "bg-green-500/20 text-green-500";
      case "processing":
        return "bg-blue-500/20 text-blue-500";
      case "error":
        return "bg-red-500/20 text-red-500";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const modalTitle = hasError
    ? `${actionLabel} Failed`
    : allCompleted
      ? `${actionLabel} Complete`
      : `Processing ${actionLabel}`;

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
          <span className="text-lg font-semibold text-foreground">{modalTitle}</span>
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
            <div key={step.id} className={`rounded-lg transition-all ${getStepClassName(step.status)}`}>
              <div className="flex items-start gap-4 p-4">
                <div className="flex-shrink-0 mt-0.5">{getStepIcon(step.status)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h4 className={`font-medium ${
                      step.status === "processing"
                        ? "text-blue-500"
                        : step.status === "completed"
                          ? "text-green-500"
                          : step.status === "error"
                            ? "text-red-500"
                            : "text-muted-foreground"
                    }`}>
                      {step.label}
                    </h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getStatusClassName(step.status)}`}>
                      {getStatusLabel(step.status)}
                    </span>
                  </div>

                  {step.description && (
                    <p className={`text-sm mt-1 ${
                      step.status === "processing"
                        ? "text-blue-500/80"
                        : step.status === "completed"
                          ? "text-green-500/80"
                          : step.status === "error"
                            ? "text-red-500/80"
                            : "text-muted-foreground"
                    }`}>
                      {step.description}
                    </p>
                  )}

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

export default VaultActionProgressModal;
