import React, { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import BridgeConfirmationModal from "./BridgeConfirmationModal";
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
  formatBalance,
  safeParseUnits,
} from "@/utils/numberUtils";
import BridgeWalletStatus from "./BridgeWalletStatus";
import { BRIDGE_OUT_FEE, usdstAddress } from "@/lib/constants";
import { handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";
import { useUserTokens } from "@/context/UserTokensContext";
import { NATIVE_TOKEN_ADDRESS } from "@/lib/bridge/constants";

const BridgeOut: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useUserTokens();

  const {
    requestWithdrawal: bridgeOutAPI,
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

  const maxAmount = useMemo(() => {
    const tokenBalanceWei = balanceData?.balance?.toString() || "0";
    return computeMaxTransferable(tokenBalanceWei, selectedToken?.stratoToken === usdstAddress, voucherBalance, usdstBalance, safeParseUnits(BRIDGE_OUT_FEE).toString(), setFeeError);
  }, [balanceData?.balance, selectedToken?.stratoToken, voucherBalance, usdstBalance]);

  // Balance impact preview
  const balanceImpact = useMemo(() => {
    try {
      const before = Number(maxAmount || "0")/10**18;
      const v = Number(amount || "0");
      const after = Math.max(0, before - v);
      return { before, after };
    } catch {
      return { before: 0, after: 0 };
    }
  }, [maxAmount, amount]);

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
        externalChainId: String(externalChainId),
        externalRecipient: address,
        externalToken: selectedToken.externalToken? selectedToken.externalToken : NATIVE_TOKEN_ADDRESS,
        stratoToken: selectedToken.stratoToken,
        stratoTokenAmount: amountInSmallestUnit,
      });

      if (response?.success) {
        toast({
          title: "Transaction Proposed Successfully",
          description: `Withdrawal is pending approval. ${amount} ${selectedToken.externalSymbol} will be transferred to ${address}.`,
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
              <SelectItem key={t.id} value={t.externalSymbol}>
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
          <div className="flex items-center gap-2 mt-1">
            {isBalanceLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <p className="text-sm text-gray-500">Fetching balance...</p>
              </div>
            ) : (
              maxAmount && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-sm text-gray-500">
                      Max: {formatBalance(maxAmount, selectedToken?.stratoTokenSymbol, 18, 2, 18)}
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        
      </div>
      <div className="rounded-xl border bg-gray-50 p-4 space-y-3 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          <span>
            Amount will be rounded down to {selectedToken?.externalDecimals || "18"} decimal places
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Transaction Fee</span>
          <span className="font-medium">{BRIDGE_OUT_FEE} USDST ({parseFloat(BRIDGE_OUT_FEE) * 100} voucher)</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Max Per Withdrawal</span>
          <span className="font-medium">{selectedToken?.maxPerWithdrawal || "Unlimited"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>{selectedToken?.stratoTokenSymbol} Balance</span>
          <span className="font-medium">{balanceImpact.before.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: parseInt(selectedToken?.externalDecimals || "18")})}{amountError? "" : " → " + balanceImpact.after.toLocaleString(undefined,{ minimumFractionDigits: 2, maximumFractionDigits: parseInt(selectedToken?.externalDecimals || "18") })}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Outcome</span>
          <span className="font-medium">{amount || "0.00"} {selectedToken?.externalSymbol || "bridged"} to {selectedNetwork || "external network"}</span>
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

      <BridgeConfirmationModal
        open={isModalOpen}
        onOk={handleBridgeOut}
        onCancel={handleModalCancel}
        title="Confirm Bridge Transaction"
        okText="Yes, Bridge Assets"
        cancelText="Cancel"
        fromNetwork="STRATO"
        toNetwork={selectedNetwork || "Not selected"}
        amount={amount}
        selectedToken={selectedToken}
      />
    </div>
  );
};

export default BridgeOut;
