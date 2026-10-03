import React from "react";
import { Modal } from "antd";
import { BridgeToken } from "@strato/shared-types";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { WAD, BRIDGE_OUT_FEE } from "@/lib/constants";
import type { WithdrawalPreview } from "@/lib/bridge/types";

interface BridgeConfirmationModalProps {
  open: boolean;
  onOk: () => void;
  onCancel: () => void;
  title: string;
  okText: string;
  cancelText: string;
  fromNetwork: string;
  toNetwork: string;
  amount?: string;
  selectedToken: BridgeToken | null;
  preview?: WithdrawalPreview;
  recipient?: string;
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
  amount = "",
  selectedToken,
  preview,
  recipient,
}) => {
  return (
    <Modal
      title={
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-blue-500" />
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
        {/* Transaction Summary */}
        <div className="bg-muted rounded-lg p-4 space-y-3">
          <div className="space-y-2 text-sm text-foreground">
            <div className="flex justify-between">
              <span className="text-muted-foreground">You send:</span>
              <span className="font-medium text-foreground">{preview ? formatUnits(preview.escrowAmount, selectedToken?.stratoTokenDecimals ?? 18) : amount} {(preview || selectedToken?.rebaseFactor) && selectedToken?.stratoTokenSymbol}</span>
            </div>
            {preview && selectedToken && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">You receive:</span>
                <span className="font-medium text-foreground">{formatUnits(preview.externalAmount, Number(selectedToken.externalDecimals))} {selectedToken.externalSymbol}</span>
              </div>
            )}
            {recipient && (
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Receiving wallet:</span>
                <span className="font-medium text-foreground break-all text-right">{recipient}</span>
              </div>
            )}
            {!preview && selectedToken?.rebaseFactor && amount && (() => {
              try {
                const factor = BigInt(selectedToken.rebaseFactor!);
                if (factor <= 0n) return null;
                const rebased = formatUnits((safeParseUnits(amount, 18) * factor) / WAD, 18);
                return (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">You receive:</span>
                    <span className="font-medium text-foreground">≈ {rebased} {selectedToken.externalSymbol}</span>
                  </div>
                );
              } catch { return null; }
            })()}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Destination network:</span>
              <span className="font-medium text-foreground">{toNetwork}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Fee:</span>
              <span>{BRIDGE_OUT_FEE} USDST · vouchers used first</span>
            </div>
          </div>
        </div>

        {/* Warning Notice */}
        <div className="flex items-start gap-3 p-3 bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <div>Check the receiving wallet. Completed transfers cannot be reversed.</div>
            {preview?.manualReview && <div>This withdrawal requires review and may take longer.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default BridgeConfirmationModal;
