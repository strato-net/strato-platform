import React from "react";
import { Modal } from "antd";
import { BridgeToken } from "@strato/shared-types";
import { ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { WAD } from "@/lib/constants";

interface BridgeConfirmationModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  title: string;
  okText: string;
  cancelText: string;
  fromNetwork: string;
  toNetwork: string;
  amount: string;
  selectedToken: BridgeToken | null;
}

const BridgeConfirmationModal: React.FC<BridgeConfirmationModalProps> = ({
  open,
  onOk,
  onCancel,
  title,
  okText,
  cancelText,
  fromNetwork,
  toNetwork,
  amount,
  selectedToken,
}) => {
  return (
    <Modal
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-primary" />
          </div>
          <span className="text-lg font-semibold text-foreground">{title}</span>
        </div>
      }
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText={okText}
      cancelText={cancelText}
      width={550}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-content]:bg-card [&_.ant-modal-content]:text-foreground [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-border [&_.ant-modal-header]:bg-card [&_.ant-modal-body]:p-6 [&_.ant-modal-body]:text-foreground [&_.ant-modal-title]:text-foreground [&_.ant-modal-footer]:bg-card [&_.ant-modal-footer]:border-border [&_.ant-modal-close]:text-muted-foreground [&_.ant-btn-default]:bg-muted [&_.ant-btn-default]:text-foreground [&_.ant-btn-default]:border-border"
    >
      <div className="space-y-6">
        {/* Transaction Flow */}
        <div className="flex items-center justify-between">
          <div className="flex-1 text-center">
            <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
              <div className="text-sm font-medium text-muted-foreground mb-1">From</div>
              <div className="text-lg font-semibold text-foreground">{fromNetwork}</div>
            </div>
          </div>
          
          <div className="flex flex-col items-center mx-4">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
          
          <div className="flex-1 text-center">
            <div className="bg-success/10 rounded-lg p-4 border border-success/20">
              <div className="text-sm font-medium text-muted-foreground mb-1">To</div>
              <div className="text-lg font-semibold text-foreground">{toNetwork}</div>
            </div>
          </div>
        </div>

        {/* Transaction Summary */}
        <div className="bg-muted rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-primary rounded-full"></div>
            <span className="font-medium text-foreground">Transaction summary</span>
          </div>
          
          <div className="space-y-2 text-sm text-foreground">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source token:</span>
              <span className="font-medium text-foreground">{selectedToken?.stratoTokenName} ({selectedToken?.stratoTokenSymbol})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Destination token:</span>
              <span className="font-medium text-foreground">{selectedToken?.externalName} ({selectedToken?.externalSymbol})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Amount:</span>
              <span className="font-medium text-foreground tabular-nums">{amount} {selectedToken?.rebaseFactor && selectedToken?.stratoTokenSymbol}</span>
            </div>
            {selectedToken?.rebaseFactor && amount && (() => {
              try {
                const factor = BigInt(selectedToken.rebaseFactor!);
                if (factor <= 0n) return null;
                const rebased = formatUnits((safeParseUnits(amount, 18) * factor) / WAD, 18);
                return (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Receive:</span>
                    <span className="font-medium text-foreground tabular-nums">≈ {rebased} {selectedToken.externalSymbol}</span>
                  </div>
                );
              } catch { return null; }
            })()}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Networks:</span>
              <span className="font-medium text-foreground">{fromNetwork} → {toNetwork}</span>
            </div>
          </div>
        </div>

        {/* Warning Notice */}
        <div className="flex items-start gap-3 p-3 bg-warning/10 border border-warning/40 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
          <div className="text-sm text-warning">
            <div className="font-medium mb-1">Important notice</div>
            <div>Withdrawals are subject to liquidity availability and are not instant.</div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default BridgeConfirmationModal;
