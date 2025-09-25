import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Modal } from "antd";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount } from "wagmi";
import { useBridgeContext } from "@/context/BridgeContext";
import PercentageButtons from "@/components/ui/PercentageButtons";
import {
  roundToDecimals,
  safeParseUnits,
} from "@/utils/numberUtils";
import BridgeWalletStatus from "./BridgeWalletStatus";
import { BRIDGE_OUT_FEE, usdstAddress } from "@/lib/constants";
import { handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";
import { useUserTokens } from "@/context/UserTokensContext";

const BridgeOut: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useUserTokens();

  const {
    bridgeOut: bridgeOutAPI,
    useBalance,
    bridgeableTokens,
    availableNetworks,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
  } = useBridgeContext();

  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [amountError, setAmountError] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feeError, setFeeError] = useState<string>("");

  // Use the useBalance hook from context
  const {
    data: balanceData,
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useBalance(selectedToken?.stratoToken || null);

  const tokenBalance = balanceData?.formatted || "0";

  const maxAmount = useMemo(() => {
    const tokenBalanceWei = balanceData?.balance?.toString() || "0";
    return computeMaxTransferable(tokenBalanceWei, selectedToken?.stratoToken === usdstAddress, voucherBalance, usdstBalance, safeParseUnits(BRIDGE_OUT_FEE).toString(), setFeeError);
  }, [balanceData?.balance, selectedToken?.stratoToken, voucherBalance, usdstBalance]);

  // Set initial network selection
  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) {
      setSelectedNetwork(availableNetworks[0].chainName);
    }
  }, [availableNetworks, selectedNetwork]);

  // Fetch USDST balance on mount
  useEffect(() => {
    if (isConnected && address) {
      fetchUsdstBalance(address);
    }
  }, [isConnected, address, fetchUsdstBalance]);

  const showConfirmModal = () => {
    if (!selectedToken?.stratoToken || !address) {
      toast({
        title: "Error",
        description: "Invalid configuration",
        variant: "destructive",
      });
      return;
    }
    if (!selectedNetwork) {
      toast({
        title: "Select Network",
        description: "Please choose a destination network.",
        variant: "destructive",
      });
      return;
    }
    setIsModalOpen(true);
  };

  const handleModalCancel = () => setIsModalOpen(false);

  const handleBridgeOut = async () => {
    if (!selectedToken || !address || !selectedNetwork) return;
    setIsModalOpen(false);
    setIsLoading(true);
    toast({
      title: "Preparing transaction...",
      description: "Please wait while we prepare your transaction",
    });

    try {
      const amountInSmallestUnit = safeParseUnits(amount || "0", 18).toString();
      const selectedNetworkConfig = availableNetworks.find(
        (n) => n.chainName === selectedNetwork,
      );
      const externalChainId = selectedNetworkConfig?.chainId || "";

      const response = await bridgeOutAPI({
        stratoTokenAmount: amountInSmallestUnit,
        externalRecipient: address,
        stratoToken: selectedToken.stratoToken,
        externalChainId: String(externalChainId),
      });

      if (response?.success) {
        toast({
          title: "Transaction Proposed Successfully",
          description: `Your tokens have been burned and ${amount} ${selectedToken.stratoTokenSymbol} will be transferred to ${address}. Withdrawal is pending approval.`,
        });
        await refetchBalance();
        await fetchUsdstBalance(address);
        setAmount("");
      } else {
        throw new Error("Failed to initiate transfer");
      }
    } catch (error) {
      console.error("Bridge transaction failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <BridgeWalletStatus />

      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="from">From Network</Label>
          <Input
            id="from-chain"
            value="STRATO"
            disabled
            className="bg-gray-50"
          />
        </div>

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="to">To Network</Label>
          <Select
            value={selectedNetwork || ""}
            onValueChange={setSelectedNetwork}
          >
            <SelectTrigger id="to-network">
              <SelectValue placeholder="Select network" />
            </SelectTrigger>
            <SelectContent>
              {availableNetworks.map((n) => (
                <SelectItem key={n.chainId} value={n.chainName}>
                  {n.chainName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="asset">Select Asset</Label>
        <Select
          value={selectedToken?.externalSymbol || ""}
          onValueChange={(v) => {
            const newToken = bridgeableTokens.find((t) => t.externalSymbol === v) || null;
            setSelectedToken(newToken);
          }}
          disabled={bridgeableTokens.length === 0}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {selectedToken
                ? `${selectedToken.stratoTokenName} (${selectedToken.stratoTokenSymbol})`
                : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {bridgeableTokens.map((t) => (
              <SelectItem key={t.externalSymbol} value={t.externalSymbol}>
                {t.stratoTokenName} ({t.stratoTokenSymbol})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder={isConnected ? "0.00" : "Connect wallet to enter amount"}
          className={`w-full ${amountError ? "border-red-500 focus:ring-red-400" : ""}`}
          value={amount}
          onChange={(e) => {
            handleAmountInputChange(e.target.value, setAmount, setAmountError, maxAmount, 18);
          }}
          disabled={!isConnected}
        />
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}
        {feeError && <p className="text-sm text-yellow-600">{feeError}</p>}
        {isConnected && (
          <PercentageButtons
            value={amount}
            maxValue={maxAmount}
            onChange={(value) => handleAmountInputChange(value, setAmount, setAmountError, maxAmount, 18)}
            className="mt-2"
          />
        )}
        {amount && selectedToken && (
          <p className="text-sm text-gray-500">
            Amount will be rounded down to {selectedToken.externalDecimals} decimal places
          </p>
        )}
        
          <div className="flex items-center gap-2 mt-1">
            {isBalanceLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <p className="text-sm text-gray-500">Fetching balance...</p>
              </div>
            ) : (
              tokenBalance && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-500">
                      Balance: {tokenBalance} {selectedToken?.stratoTokenSymbol}
                    </p>
                    {selectedToken && (
                      <div className="flex items-center gap-1">
                        {isBalanceLoading ? (
                          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                        ) : (
                          <span className="text-xs text-gray-500">
                            { `Max: ${selectedToken.maxPerTx} ${selectedToken.stratoTokenSymbol}`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedToken?.externalSymbol && (
                    <div className="text-sm">
                      <p className="bg-blue-50 p-2 rounded-md border border-blue-100">
                        You will receive{" "}
                        {amount
                          ? `${selectedToken ? roundToDecimals(amount, parseInt(selectedToken.externalDecimals)) : amount} `
                          : ""}
                        {selectedToken?.externalName} ({selectedToken?.externalSymbol}) on{" "}
                        {selectedNetwork || "selected"} network
                      </p>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        
      </div>

      <div className="text-sm text-gray-500 space-y-1">
        {[
          "Transaction time varies by network congestion",
        ].map((text, i) => (
          <p key={i}>• {text}</p>
        ))}
      </div>
      <div className="bg-gray-50 p-4 rounded-lg space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Transaction Fee</span>
          <span className="font-medium">{BRIDGE_OUT_FEE} USDST ({parseFloat(BRIDGE_OUT_FEE) * 100} voucher)</span>
        </div>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          onClick={showConfirmModal}
          disabled={Boolean(
            isLoading ||
              !amount ||
              !selectedToken ||
              !isConnected ||
              amountError ||
              !selectedNetwork ||
              isBalanceLoading,
          )}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Bridge Assets"}
        </Button>
      </div>
      {!isConnected && (
        <div className="text-center">
          <p className="text-sm text-red-500">
            Connect your wallet to bridge assets. Use the wallet where you'd
            like to receive funds.
          </p>
        </div>
      )}

      <Modal
        title="Confirm Bridge Transaction"
        open={isModalOpen}
        onOk={handleBridgeOut}
        onCancel={handleModalCancel}
        okText="Yes, Bridge Assets"
        cancelText="Cancel"
      >
        <div className="space-y-4">
          <p>Are you sure you want to bridge your assets?</p>
          <div className="bg-gray-50 p-4 rounded-md">
            <p className="font-medium">Transaction Details:</p>
            <div className="mt-2 space-y-2">
              <p>From: STRATO</p>
              <p>To: {selectedNetwork || "Not selected"}</p>
              <p>
                Amount: {selectedToken ? roundToDecimals(amount, parseInt(selectedToken.externalDecimals)) : amount}{" "}
                {selectedToken?.stratoTokenSymbol}
              </p>
              {selectedToken?.externalSymbol && (
                <p className="text-blue-600">
                  You will receive{" "}
                  {selectedToken
                    ? roundToDecimals(
                        amount,
                        parseInt(selectedToken.externalDecimals),
                      )
                    : amount}{" "}
                  {selectedToken?.externalName} ({selectedToken?.externalSymbol}) on{" "}
                  {selectedNetwork || "selected"} network
                </p>
              )}
              {!selectedToken?.maxPerTx &&  (
                <p className="text-orange-600 text-sm">
                  Transfer limit: {selectedToken?.maxPerTx} {selectedToken?.externalSymbol}
                </p>
              )}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BridgeOut;
