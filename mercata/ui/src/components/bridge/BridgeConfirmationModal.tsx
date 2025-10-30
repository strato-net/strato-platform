import React from "react";
import { Modal } from "antd";
import { BridgeToken } from "@mercata/shared-types";
import { ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";

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
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-blue-600" />
          </div>
          <span className="text-lg font-semibold">{title}</span>
        </div>
      }
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      okText={okText}
      cancelText={cancelText}
      width={550}
      className="[&_.ant-modal-content]:rounded-xl [&_.ant-modal-header]:border-b [&_.ant-modal-header]:border-gray-100 [&_.ant-modal-body]:p-6"
    >
      <div className="space-y-6">
        {/* Transaction Flow */}
        <div className="flex items-center justify-between">
          <div className="flex-1 text-center">
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-100">
              <div className="text-sm font-medium text-gray-600 mb-1">From</div>
              <div className="text-lg font-semibold text-gray-900">{fromNetwork}</div>
            </div>
          </div>
          
          <div className="flex flex-col items-center mx-4">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <ArrowRight className="w-4 h-4 text-gray-600" />
            </div>
          </div>
          
          <div className="flex-1 text-center">
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-100">
              <div className="text-sm font-medium text-gray-600 mb-1">To</div>
              <div className="text-lg font-semibold text-gray-900">{toNetwork}</div>
            </div>
          </div>
        </div>

        {/* Transaction Summary */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="font-medium text-gray-900">Transaction Summary</span>
          </div>
          
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Source Token:</span>
              <span className="font-medium">{selectedToken?.stratoTokenName} ({selectedToken?.stratoTokenSymbol})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Destination Token:</span>
              <span className="font-medium">{selectedToken?.externalName} ({selectedToken?.externalSymbol})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Amount:</span>
              <span className="font-medium">{amount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Networks:</span>
              <span className="font-medium">{fromNetwork} → {toNetwork}</span>
            </div>
          </div>
        </div>

        {/* Warning Notice */}
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <div className="font-medium mb-1">Important Notice</div>
            <div>Withdrawals are subject to liquidity availability and are not instant.</div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default BridgeConfirmationModal;
