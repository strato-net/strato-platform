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
import { roundToDecimals, safeParseUnits, formatBalance } from "@/utils/numberUtils";
import BridgeWalletStatus from "./BridgeWalletStatus";

interface Token {
  stratoTokenAddress: string;
  stratoTokenName: string;
  stratoTokenSymbol: string;
  chainId: string;
  enabled: boolean;
  extName: string;
  extToken: string;
  extSymbol: string;
  extDecimals: string;
}

interface BridgeOutProps {
  networkChainId: string | null;
}

const BridgeOut: React.FC<BridgeOutProps> = ({ networkChainId }) => {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();

  const {
    bridgeOut: bridgeOutAPI,
    getBalance,
    bridgeableTokens,
    availableNetworks,
  } = useBridgeContext();

  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [amount, setAmount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isBalanceLoading, setIsBalanceLoading] = useState(false);
  const [amountError, setAmountError] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedToNetwork, setSelectedToNetwork] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedToNetwork && availableNetworks.length) {
      setSelectedToNetwork(availableNetworks[0].chainName);
    }
    if (bridgeableTokens.length && !selectedToken) {
      setSelectedToken(bridgeableTokens[0]);
    }
  }, [availableNetworks, bridgeableTokens, selectedToNetwork, selectedToken]);

  useEffect(() => {
    let mounted = true;
    const fetch = async () => {
      if (!selectedToken?.stratoTokenAddress) return;
      setIsBalanceLoading(true);
      try {
        const { balance } = await getBalance(selectedToken.stratoTokenAddress);
        const formatted = formatBalance(balance, undefined, parseInt(selectedToken.extDecimals));
        if (mounted) setTokenBalance(formatted);
      } catch {
        if (mounted) setTokenBalance("0");
      } finally {
        if (mounted) setIsBalanceLoading(false);
      }
    };
    fetch();
    return () => {
      mounted = false;
    };
  }, [selectedToken, getBalance]);

  const decimals = useMemo(() => (selectedToken ? parseInt(selectedToken.extDecimals) : 18), [selectedToken]);

  const validateAmount = (value: string): boolean => {
    if (!value) {
      setAmountError("");
      return true;
    }
    const n = Number(value);
    const bal = Number(tokenBalance);
    if (Number.isNaN(n)) {
      setAmountError("Please enter a valid number");
      return false;
    }
    if (n <= 0) {
      setAmountError("Amount must be greater than 0");
      return false;
    }
    if (n > bal) {
      setAmountError(`Insufficient balance. Maximum: ${tokenBalance} ${selectedToken?.stratoTokenSymbol ?? ""}`);
      return false;
    }
    setAmountError("");
    return true;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (/^\d*\.?\d*$/.test(value)) {
      setAmount(value);
      validateAmount(value);
    }
  };

  const handlePercentageClick = (p: string) => {
    setAmount(p);
    validateAmount(p);
  };

  const showConfirmModal = () => {
    if (!selectedToken?.stratoTokenAddress || !address) {
      toast({ title: "Error", description: "Invalid configuration", variant: "destructive" });
      return;
    }
    if (!selectedToNetwork) {
      toast({ title: "Select Network", description: "Please choose a destination network.", variant: "destructive" });
      return;
    }
    if (!validateAmount(amount)) return;
    setIsModalOpen(true);
  };

  const handleModalCancel = () => setIsModalOpen(false);

  const handleBridgeOut = async () => {
    if (!selectedToken || !address || !selectedToNetwork) return;
    setIsModalOpen(false);
    setIsLoading(true);
    toast({ title: "Preparing transaction...", description: "Please wait while we prepare your transaction" });

    try {
      const amountInSmallestUnit = safeParseUnits(amount || "0", decimals).toString();
      const response = await bridgeOutAPI({
        amount: amountInSmallestUnit,
        destAddress: address,
        token: selectedToken.stratoTokenAddress,
        destChainId: String(networkChainId ?? ""),
      });

      if (response?.success) {
        toast({
          title: "Transaction Proposed Successfully",
          description: `Your tokens have been burned and ${amount} ${selectedToken.stratoTokenSymbol} will be transferred to ${address}. Withdrawal is pending approval.`,
        });
        const { balance } = await getBalance(selectedToken.stratoTokenAddress);
        const formatted = formatBalance(balance, undefined, decimals);
        setTokenBalance(formatted);
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
          <Input id="from-chain" value="STRATO" disabled className="bg-gray-50" />
        </div>

        <div className="flex-1 space-y-1.5">
          <Label htmlFor="to">To Network</Label>
          <Select value={selectedToNetwork || ""} onValueChange={setSelectedToNetwork}>
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
          value={selectedToken?.stratoTokenSymbol || ""}
          onValueChange={(val) => {
            const t = bridgeableTokens.find((x) => x.stratoTokenSymbol === val);
            if (t) setSelectedToken(t);
          }}
        >
          <SelectTrigger id="from-token">
            <SelectValue>
              {selectedToken ? `${selectedToken.stratoTokenName} (${selectedToken.stratoTokenSymbol})` : "Select asset"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {bridgeableTokens.map((t) => (
              <SelectItem key={t.stratoTokenSymbol} value={t.stratoTokenSymbol}>
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
          onChange={handleAmountChange}
          disabled={!isConnected}
        />
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}
        {isConnected && (
          <PercentageButtons
            value={amount}
            maxValue={safeParseUnits(tokenBalance, decimals).toString()}
            onChange={handlePercentageClick}
            className="mt-2"
          />
        )}
        {amount && selectedToken && (
          <p className="text-sm text-gray-500">Amount will be rounded down to {selectedToken.extDecimals} decimal places</p>
        )}
        {isConnected && (
          <div className="flex items-center gap-2 mt-1">
            {isBalanceLoading ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <p className="text-sm text-gray-500">Fetching balance...</p>
              </div>
            ) : (
              tokenBalance && (
                <div className="space-y-2">
                  <div className="text-sm text-gray-500">
                    Balance: {tokenBalance} {selectedToken?.stratoTokenSymbol}
                  </div>
                  {selectedToken?.extSymbol && (
                    <div className="text-sm">
                      <p className="bg-blue-50 p-2 rounded-md border border-blue-100">
                        You will receive {amount ? `${selectedToken ? roundToDecimals(amount, decimals) : amount} ` : ""}
                        {selectedToken?.extName} ({selectedToken?.extSymbol}) on {selectedToNetwork || "selected"} network
                      </p>
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      <div className="bg-gray-50 p-4 rounded-md space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Bridge Fee:</span>
          <span>0.1%</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Estimated Time:</span>
          <span>2-5 minutes</span>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        <p>• Bridge assets between STRATO and external networks</p>
        <p>• Small bridge fee applies</p>
        <p>• Transaction time varies by network congestion</p>
      </div>

      <div className="flex justify-end gap-4">
        <Button
          onClick={showConfirmModal}
          disabled={Boolean(isLoading || !amount || !selectedToken || !isConnected || amountError || !selectedToNetwork)}
          className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
        >
          {isLoading ? "Processing..." : "Bridge Assets"}
        </Button>
      </div>
      {!isConnected && (
        <div className="text-center">
          <p className="text-sm text-red-500">
            Connect your wallet to bridge assets. Use the wallet where you'd like to receive funds.
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
              <p>To: {selectedToNetwork || "Not selected"}</p>
              <p>
                Amount: {selectedToken ? roundToDecimals(amount, decimals) : amount} {selectedToken?.stratoTokenSymbol}
              </p>
              {selectedToken?.extSymbol && (
                <p className="text-blue-600">
                  You will receive {selectedToken ? roundToDecimals(amount, decimals) : amount} {selectedToken?.extName} ({selectedToken?.extSymbol}) on {selectedToNetwork || "selected"} network
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
