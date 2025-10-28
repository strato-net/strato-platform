import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount } from "wagmi";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";
import { formatBalance, safeParseUnits } from "@/utils/numberUtils";
import { WITHDRAW_USDST_FEE } from "@/lib/constants";
import { handleAmountInputChange, computeMaxTransferable } from "@/utils/transferValidation";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import BridgeConfirmationModal from "@/components/bridge/BridgeConfirmationModal";

const WithdrawWidget: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();

  const {
    requestWithdrawal: redeemOut,
    availableNetworks,
    redeemableTokens,
    selectedNetwork,
    setSelectedNetwork,
    selectedMintToken,
    setSelectedMintToken,
    loadNetworksAndTokens,
    fetchRedeemableTokens,
  } = useBridgeContext();

  const { userAddress } = useUser();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useUserTokens();

  const [amount, setAmount] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [amountError, setAmountError] = useState<string>("");
  const [feeError, setFeeError] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // USDST balance (formatted already in wei string) reusing bridge context balance hook requires token address; we simply use provided usdstBalance for preview
  const currentUsdst = useMemo(() => usdstBalance, [usdstBalance]);


  useEffect(() => {
    if (!selectedMintToken && redeemableTokens.length > 0) {
      setSelectedMintToken(redeemableTokens[0]);
    }
  }, [selectedMintToken, redeemableTokens, setSelectedMintToken]);

  // Load networks and redeemable tokens on mount
  useEffect(() => {
    loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

  // Fetch USDST balance on mount
  useEffect(() => {
    if (isConnected && address) {
      fetchUsdstBalance(address);
    }
  }, [isConnected, address, fetchUsdstBalance]);

  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) setSelectedNetwork(availableNetworks[0].chainName);
  }, [selectedNetwork, availableNetworks, setSelectedNetwork]);

  // Load redeemable tokens when network changes
  useEffect(() => {
    if (!selectedNetwork) return;
    const networkConfig = availableNetworks.find(n => n.chainName === selectedNetwork);
    if (!networkConfig) return;

    fetchRedeemableTokens(networkConfig.chainId);
  }, [selectedNetwork, availableNetworks, fetchRedeemableTokens]);

  const maxAmount = useMemo(() => {
    const usdstBalanceWei = usdstBalance || "0";
    const maxTransferable = computeMaxTransferable(usdstBalanceWei, true, voucherBalance, usdstBalance, safeParseUnits(WITHDRAW_USDST_FEE).toString(), setFeeError);
    
    // Apply token max per transaction limit if it exists
    if (selectedMintToken && selectedMintToken.maxPerWithdrawal && selectedMintToken.maxPerWithdrawal !== "0") {
      const tokenMaxBigInt = safeParseUnits(selectedMintToken.maxPerWithdrawal, 18);
      const maxTransferableBigInt = BigInt(maxTransferable);
      const finalMax = maxTransferableBigInt < tokenMaxBigInt ? maxTransferableBigInt : tokenMaxBigInt;
      return finalMax.toString();
    }
    
    return maxTransferable;
  }, [selectedMintToken, usdstBalance, voucherBalance]);

  const showConfirmModal = () => {
    if (!selectedMintToken || !address) {
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
    if (!amount || amountError) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a valid amount.",
        variant: "destructive",
      });
      return;
    }
    setIsModalOpen(true);
  };

  const handleModalCancel = () => setIsModalOpen(false);

  const handleWithdraw = async () => {
    setIsModalOpen(false);
    if (!selectedMintToken || !selectedNetwork || !address) return;
    if (!amount || amountError) return;
    setIsLoading(true);
    try {
      const selectedNetworkConfig = availableNetworks.find((n) => n.chainName === selectedNetwork);
      const externalChainId = selectedNetworkConfig?.chainId || "";
      const stratoTokenAmount = safeParseUnits(amount).toString();
      const res = await redeemOut({
        externalChainId: externalChainId,
        externalRecipient: address,
        externalToken: selectedMintToken.externalToken,
        stratoToken: selectedMintToken.stratoToken,
        stratoTokenAmount
      });
      if (res?.success) {
        toast({
          title: "Withdrawal requested",
          description: `Your withdrawal request is pending approval. The approved amount of ${selectedMintToken.externalSymbol} will be transferred to ${address}.`,
        });
        setAmount("");
        // Refresh USDST balance to reflect burn
        if (userAddress) {
          await fetchUsdstBalance(userAddress);
        }
      } else {
        throw new Error("Failed to request withdrawal");
      }
    } catch (e: any) {
      toast({ title: "Withdraw failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // Simple balance impact preview: we do not auto-withdraw from lending pool
  const balanceImpact = useMemo(() => {
    try {
      const beforeWei = BigInt(currentUsdst || "0");
      const before = Number((beforeWei / 10n ** 18n).toString());
      const v = Number(amount || "0");
      const after = Math.max(0, before - v - Number(WITHDRAW_USDST_FEE));
      return { before, after };
    } catch {
      return { before: 0, after: 0 };
    }
  }, [currentUsdst, amount]);

  return (
    <div className="space-y-6">
      <BridgeWalletStatus />
      <div className="flex items-center gap-4">
        <div className="flex-1 space-y-1.5">
          <Label>From Network</Label>
          <Input value="STRATO" disabled className="bg-gray-50" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label>To Network</Label>
          <Select value={selectedNetwork || ""} onValueChange={setSelectedNetwork}>
            <SelectTrigger>
              <SelectValue placeholder="Select network" />
            </SelectTrigger>
            <SelectContent>
              {availableNetworks.map((n) => (
                <SelectItem key={n.chainId} value={n.chainName}>{n.chainName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Receive Stablecoin</Label>
        <Select
          value={selectedMintToken?.externalToken || ""}
          onValueChange={(v) => {
            const token = redeemableTokens.find(t => t.externalToken === v);
            if (token) {
              setSelectedMintToken(token);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Choose token" />
          </SelectTrigger>
          <SelectContent>
            {redeemableTokens.map(t => (
              <SelectItem key={t.id} value={t.externalToken}>{t.externalName} ({t.externalSymbol})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Amount (USDST to withdraw)</Label>
        <Input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => handleAmountInputChange(e.target.value, setAmount, setAmountError, maxAmount, 18)}
          className={amountError ? "border-red-500" : ""}
          disabled={!isConnected}
        />
        <span className="text-xs text-gray-500">
        {selectedMintToken && `Max: ${formatBalance(maxAmount, "USDST", 18, 2, 18)}`}
        </span>
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}
        {feeError && <p className="text-sm text-yellow-600">{feeError}</p>}
      </div>

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          <span>
            Amount will be rounded down to {selectedMintToken?.externalDecimals || "18"} decimal places
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Transaction Fee</span>
          <span className="font-medium">{WITHDRAW_USDST_FEE} USDST ({parseFloat(WITHDRAW_USDST_FEE) * 100} voucher)</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Max Per Withdrawal</span>
          <span className="font-medium">{selectedMintToken?.maxPerWithdrawal || "Unlimited"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>USDST Balance</span>
          <span className="font-medium">{balanceImpact.before.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}{amountError? "" : " → " + balanceImpact.after.toLocaleString(undefined,{ minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Outcome</span>
          <span className="font-medium">{amount || "0.00"} {selectedMintToken?.externalSymbol || "withdrawn"} to {selectedNetwork || "external network"}</span>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={showConfirmModal} disabled={isLoading || !isConnected || !selectedNetwork || !selectedMintToken || !amount || !!amountError || !!feeError} className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90">
          {isLoading ? "Processing..." : "Withdraw"}
        </Button>
      </div>

      <BridgeConfirmationModal
        open={isModalOpen}
        onOk={handleWithdraw}
        onCancel={handleModalCancel}
        title="Confirm Withdrawal Transaction"
        okText="Yes, Withdraw Assets"
        cancelText="Cancel"
        fromNetwork="STRATO"
        toNetwork={selectedNetwork || "Not selected"}
        amount={amount}
        selectedToken={selectedMintToken}
      />
    </div>
  );
};

export default WithdrawWidget;




