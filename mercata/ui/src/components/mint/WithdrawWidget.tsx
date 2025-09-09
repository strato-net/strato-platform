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
import { usdstAddress, WITHDRAW_USDST_FEE } from "@/lib/constants";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";

const DECIMAL_PATTERN = /^\d*\.?\d*$/;

const WithdrawWidget: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();

  const {
    redeemOut,
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
  const { usdstBalance, fetchUsdstBalance } = useUserTokens();

  const [amount, setAmount] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [amountError, setAmountError] = useState<string>("");

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
    // Calculate max available USDST (balance minus fee)
    const usdstBalanceBigInt = BigInt(usdstBalance || "0");
    const feeBigInt = safeParseUnits(WITHDRAW_USDST_FEE, 18);
    const availableUsdst = usdstBalanceBigInt > feeBigInt ? usdstBalanceBigInt - feeBigInt : 0n;
    var maxAllowed = availableUsdst;
    
    // Zero maxPerTx means no limit
    if (selectedMintToken && selectedMintToken.maxPerTx && selectedMintToken.maxPerTx != "0") {
      // Compare with token's max per transaction limit
      const tokenMaxBigInt = safeParseUnits(selectedMintToken.maxPerTx, 18);
      maxAllowed = availableUsdst < tokenMaxBigInt ? availableUsdst : tokenMaxBigInt;
    }

    return formatBalance(maxAllowed, undefined, 18, 2, 2);
  }, [selectedMintToken, usdstBalance]);

  const validateAmount = (value: string) => {
    if (!value) { setAmountError(""); return true; }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > Number(maxAmount)) {
      setAmountError("Please enter a valid amount");
      return false;
    }
    setAmountError("");
    return true;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (DECIMAL_PATTERN.test(v)) {
      setAmount(v);
      validateAmount(v);
    }
  };

  const handleWithdraw = async () => {
    if (!selectedMintToken || !selectedNetwork || !address) return;
    if (!validateAmount(amount)) return;
    setIsLoading(true);
    try {
      const selectedNetworkConfig = availableNetworks.find((n) => n.chainName === selectedNetwork);
      const externalChainId = selectedNetworkConfig?.chainId || "";
      const stratoTokenAmount = safeParseUnits(amount, 18).toString();
      const res = await redeemOut({
        stratoTokenAmount,
        externalRecipient: address,
        stratoToken: selectedMintToken.stratoToken,
        externalChainId: String(externalChainId)
      });
      if (res?.success) {
        toast({
          title: "Withdrawal requested",
          description: `Burned ${amount} USDST; ${selectedMintToken.externalSymbol} will be sent to your ${selectedNetwork} address after review.`,
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
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Withdraw USDST</h2>
      </div>
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
          value={selectedMintToken?.stratoToken || ""}
          onValueChange={(v) => {
            const token = redeemableTokens.find(t => t.stratoToken === v);
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
              <SelectItem key={t.stratoToken} value={t.stratoToken}>{t.externalName} ({t.externalSymbol})</SelectItem>
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
          onChange={handleAmountChange}
          className={amountError ? "border-red-500" : ""}
          disabled={!isConnected}
        />
        <span className="text-xs text-gray-500">
        {selectedMintToken && `Max: ${maxAmount} USDST`}
        </span>
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}
      </div>

      <div className="rounded-xl border bg-gray-50 p-4 space-y-3 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          <span>Transaction Fee</span>
          <span className="font-medium">{WITHDRAW_USDST_FEE} USDST</span>
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
        <Button onClick={handleWithdraw} disabled={isLoading || !isConnected || !selectedNetwork || !selectedMintToken || !amount || !!amountError} className="bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90">
          {isLoading ? "Processing..." : "Withdraw"}
        </Button>
      </div>
    </div>
  );
};

export default WithdrawWidget;




