import React, { useEffect, useState } from "react";
import { Modal } from "antd";
import { CheckCircle2, Loader2, Clock, AlertCircle } from "lucide-react";

export type MintStep = 
  | "depositing"
  | "minting"
  | "complete"
  | "error";

interface MintTransaction {
  symbol: string;
  type: "deposit" | "mint";
  amount: string;
  status: "pending" | "processing" | "completed" | "error";
  hash?: string;
  error?: string;
}

interface MintProgressModalProps {
  open: boolean;
  currentStep: MintStep;
  transactions: MintTransaction[];
  error?: string;
  onClose?: () => void;
}

const MintProgressModal: React.FC<MintProgressModalProps> = ({
  open,
  currentStep,
  transactions,
  error,
  onClose,
}) => {
  const [collapsedTxs, setCollapsedTxs] = useState<Set<number>>(new Set());

  // Auto-collapse completed transactions
  useEffect(() => {
    const newCollapsed = new Set<number>();
    transactions.forEach((tx, index) => {
      if (tx.status === "completed" && index !== transactions.length - 1) {
        newCollapsed.add(index);
      }
    });
    setCollapsedTxs(newCollapsed);
  }, [transactions]);

  const getTransactionIcon = (tx: MintTransaction) => {
    if (tx.status === "completed") {
      return <CheckCircle2 className="w-5 h-5 text-green-500" />;
    }
    if (tx.status === "processing") {
      return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    if (tx.status === "error") {
      return <AlertCircle className="w-5 h-5 text-red-500" />;
    }
    return <Clock className="w-5 h-5 text-muted-foreground" />;
  };

  const canClose = currentStep === "complete" || currentStep === "error";

  const getStepLabel = () => {
    if (currentStep === "error") return "Mint Failed";
    if (currentStep === "complete") return "Mint Complete";
    if (currentStep === "depositing") return "Processing Deposits";
    if (currentStep === "minting") return "Processing Mints";
    return "Processing Transactions";
  };

  const getStepDescription = () => {
    if (currentStep === "complete") {
      return "All transactions completed successfully. Your vaults have been updated.";
    }
    if (currentStep === "depositing") {
      return "Depositing collateral to vaults...";
    }
    if (currentStep === "minting") {
      return "Minting USDST from vaults...";
    }
    return "Processing your mint request...";
  };

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
            {getStepLabel()}
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

        {currentStep !== "error" && currentStep !== "complete" && (
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <p className="text-sm text-blue-500">{getStepDescription()}</p>
          </div>
        )}

        {currentStep === "complete" && (
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-sm text-green-500">{getStepDescription()}</p>
          </div>
        )}

        <div className="space-y-2">
          {transactions.map((tx, index) => {
            const isCollapsed = collapsedTxs.has(index);
            const isCompleted = tx.status === "completed";
            const isProcessing = tx.status === "processing";
            const isError = tx.status === "error";

            return (
              <div
                key={`${tx.type}-${tx.symbol}-${index}`}
                className={`rounded-lg transition-all ${
                  isProcessing
                    ? "bg-blue-500/10 border-2 border-blue-500/30"
                    : isCompleted
                    ? "bg-green-500/10 border border-green-500/30"
                    : isError
                    ? "bg-red-500/10 border border-red-500/30"
                    : "bg-muted/30 border border-border"
                }`}
              >
                {isCollapsed ? (
                  <div 
                    className="flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer hover:bg-green-500/20"
                    onClick={() => setCollapsedTxs(prev => {
                      const next = new Set(prev);
                      next.delete(index);
                      return next;
                    })}
                  >
                    <div className="flex-shrink-0">{getTransactionIcon(tx)}</div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-sm text-green-500">
                        {tx.type === "deposit" ? "Deposit" : "Mint"} {tx.symbol}
                      </h4>
                    </div>
                    <span className="text-xs text-green-500">Click to expand</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 p-4">
                    <div className="flex-shrink-0 mt-0.5">{getTransactionIcon(tx)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4
                          className={`font-medium ${
                            isProcessing
                              ? "text-blue-500"
                              : isCompleted
                              ? "text-green-500"
                              : isError
                              ? "text-red-500"
                              : "text-muted-foreground"
                          }`}
                        >
                          {tx.type === "deposit" ? "Deposit" : "Mint"} {tx.symbol}
                        </h4>
                        <div className="flex items-center gap-2">
                          {isProcessing && (
                            <span className="text-xs text-blue-500 font-medium">In Progress</span>
                          )}
                          {isCompleted && (
                            <button
                              onClick={() => setCollapsedTxs(prev => new Set(prev).add(index))}
                              className="text-xs underline text-green-500 hover:text-green-600"
                            >
                              Collapse
                            </button>
                          )}
                        </div>
                      </div>
                      <p
                        className={`text-sm mt-1 ${
                          isProcessing
                            ? "text-blue-500/80"
                            : isCompleted
                            ? "text-green-500/80"
                            : isError
                            ? "text-red-500/80"
                            : "text-muted-foreground"
                        }`}
                      >
                        {tx.type === "deposit" 
                          ? `Depositing ${tx.amount} ${tx.symbol}`
                          : `Minting ${tx.amount} USDST from ${tx.symbol}`}
                      </p>
                      {tx.hash && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground">
                            Tx: <span className="font-mono">{tx.hash.slice(0, 10)}...{tx.hash.slice(-8)}</span>
                          </p>
                        </div>
                      )}
                      {tx.error && (
                        <div className="mt-2">
                          <p className="text-xs text-red-500">{tx.error}</p>
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

export default MintProgressModal;
