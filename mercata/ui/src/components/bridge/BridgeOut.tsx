import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import BridgeConfirmationModal from "./BridgeConfirmationModal";
import { useAccount } from "wagmi";
import { useBridgeContext } from "@/context/BridgeContext";
import PercentageButtons from "@/components/ui/PercentageButtons";
import { formatBalance, formatUnits, safeParseUnits } from "@/utils/numberUtils";
import BridgeWalletStatus from "./BridgeWalletStatus";
import NetworkSelector from "./NetworkSelector";
import TokenSelector from "./TokenSelector";
import TransactionSummary from "./TransactionSummary";
import { BRIDGE_OUT_FEE, usdstAddress, DECIMAL } from "@/lib/constants";
import {
  handleAmountInputChange,
  computeMaxTransferable,
} from "@/utils/transferValidation";
import { useUserTokens } from "@/context/UserTokensContext";
import {
  NATIVE_TOKEN_ADDRESS,
  BRIDGE_MODE_LABELS,
} from "@/lib/bridge/constants";
import { useUser } from "@/context/UserContext";

// Constants
const FEE_WEI = safeParseUnits(BRIDGE_OUT_FEE).toString();

interface BridgeOutProps {
  isConvert?: boolean; // true for convert mode, false (default) for bridge mode
}

const BridgeOut: React.FC<BridgeOutProps> = ({ isConvert = false }) => {
  // Hooks & Context
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useUserTokens();
  const { userAddress } = useUser();

  const {
    requestWithdrawal: bridgeOutAPI,
    useBalance,
    bridgeableTokens,
    availableNetworks,
    selectedNetwork,
    setSelectedNetwork,
    selectedToken,
    setSelectedToken,
    fetchWithdrawalSummary,
  } = useBridgeContext();

  // State
  const [amount, setAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [amountError, setAmountError] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [feeError, setFeeError] = useState("");

  // Computed values
  const modeLabels = BRIDGE_MODE_LABELS[isConvert ? "convert" : "bridge"];

  const currentTokens = useMemo(() => {
    return bridgeableTokens.filter((token) =>
      isConvert ? !token.bridgeable : token.bridgeable
    );
  }, [bridgeableTokens, isConvert]);

  const currentNetwork = useMemo(() => {
    return (
      availableNetworks.find((n) => n.chainName === selectedNetwork) || null
    );
  }, [availableNetworks, selectedNetwork]);

  const {
    data: balanceData,
    isLoading: isBalanceLoading,
    refetch: refetchBalance,
  } = useBalance(selectedToken?.stratoToken || null);

  const maxAmount = useMemo(() => {
    const tokenBalanceWei = balanceData?.balance?.toString() || "0";

    const maxTransferable = computeMaxTransferable(
      tokenBalanceWei,
      selectedToken?.stratoToken === usdstAddress,
      voucherBalance,
      usdstBalance,
      FEE_WEI,
      setFeeError
    );

    if (!selectedToken?.maxPerWithdrawal) return maxTransferable;

    const perWithdrawal = BigInt(selectedToken.maxPerWithdrawal);
    if (perWithdrawal <= 0n) return maxTransferable;

    const transferable = BigInt(maxTransferable);
    return (
      transferable < perWithdrawal ? transferable : perWithdrawal
    ).toString();
  }, [
    balanceData?.balance,
    selectedToken?.stratoToken,
    selectedToken?.maxPerWithdrawal,
    usdstBalance,
    voucherBalance,
  ]);

  const balanceImpact = useMemo(() => {
    try {
      const maxAmountWei = BigInt(maxAmount || "0");
      const amountWei = safeParseUnits(amount || "0", DECIMAL);
      const afterWei = maxAmountWei > amountWei ? maxAmountWei - amountWei : 0n;
      return { before: maxAmountWei.toString(), after: afterWei.toString() };
    } catch {
      return { before: "0", after: "0" };
    }
  }, [maxAmount, amount]);

  const hasValidAmount = !!amount && !amountError && !feeError;

  const formatBalanceDisplay = useCallback(
    (valueWei: string) => {
      const num = Number(formatUnits(valueWei, DECIMAL));
      return num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    },
    []
  );

  const isButtonDisabled = useMemo(
    () =>
      isLoading ||
      !hasValidAmount ||
      !selectedToken ||
      !isConnected ||
      !currentNetwork ||
      isBalanceLoading,
    [
      isLoading,
      hasValidAmount,
      selectedToken,
      isConnected,
      currentNetwork,
      isBalanceLoading,
    ]
  );

  // Effects
  useEffect(() => {
    if (!selectedNetwork && availableNetworks.length) {
      setSelectedNetwork(availableNetworks[0].chainName);
    }
    if (!selectedToken && currentTokens.length) {
      setSelectedToken(currentTokens[0]);
    } else if (
      selectedToken &&
      !currentTokens.some((t) => t.id === selectedToken.id)
    ) {
      setSelectedToken(currentTokens[0] || null);
    }
    setAmount("");
    setAmountError("");
    setFeeError("");
  }, [
    availableNetworks,
    currentTokens,
    selectedNetwork,
    selectedToken,
    setSelectedNetwork,
    setSelectedToken,
  ]);

  useEffect(() => {
    if (userAddress) {
      fetchUsdstBalance(userAddress);
    }
  }, [userAddress, fetchUsdstBalance]);

  // Handlers
  const handleAmountChange = useCallback(
    (value: string) => {
      handleAmountInputChange(
        value,
        setAmount,
        setAmountError,
        maxAmount,
        DECIMAL
      );
    },
    [maxAmount]
  );

  const showConfirmModal = () => {
    if (!selectedToken?.stratoToken || !address || !selectedNetwork) {
      toast({
        title: "Error",
        description: "Please select network and asset.",
        variant: "destructive",
      });
      return;
    }

    if (!hasValidAmount) {
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

  const handleBridgeOut = async () => {
    setIsModalOpen(false);

    if (!hasValidAmount || !selectedToken || !address || !currentNetwork) {
      return;
    }

    const stratoTokenAmount = safeParseUnits(amount || "0", DECIMAL).toString();

    setIsLoading(true);

    if (!isConvert) {
      toast({
        title: "Preparing transaction...",
        description: "Please wait while we prepare your transaction",
      });
    }

    try {
      const externalToken = !selectedToken.externalToken
        ? NATIVE_TOKEN_ADDRESS
        : selectedToken.externalToken;

      const res = await bridgeOutAPI({
        externalChainId: currentNetwork.chainId,
        externalRecipient: address,
        externalToken,
        stratoToken: selectedToken.stratoToken,
        stratoTokenAmount,
      });

      if (!res?.success) {
        throw new Error("Failed to request withdrawal");
      }

      toast({
        title: "Withdrawal requested",
        description: `Your withdrawal request is pending approval. The approved amount of ${selectedToken.externalSymbol} will be transferred to ${address}.`,
      });

      setAmount("");

      await Promise.all([
        userAddress ? fetchUsdstBalance(userAddress) : Promise.resolve(),
        refetchBalance(),
        fetchWithdrawalSummary(false),
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h3 className="text-lg font-semibold text-gray-900">
          {modeLabels.title}
        </h3>
        <p className="text-sm text-gray-600">{modeLabels.description}</p>
      </div>

      <div className="w-full">
        <BridgeWalletStatus />
      </div>

      <NetworkSelector
        selectedNetwork={selectedNetwork}
        availableNetworks={availableNetworks}
        onNetworkChange={setSelectedNetwork}
        disabled={isLoading}
      />

      <TokenSelector
        selectedToken={selectedToken}
        tokens={currentTokens}
        onTokenChange={setSelectedToken}
        disabled={isLoading}
      />

      <div className="space-y-1.5">
        <div className="flex justify-between items-center">
          <Label htmlFor="amount">{modeLabels.amountLabel}</Label>
          {!maxAmount && isBalanceLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <p className="text-sm text-gray-500">Fetching balance...</p>
            </div>
          ) : (
            maxAmount && (
              <p className="text-sm text-gray-500">
                Max: {formatBalance(
                  maxAmount,
                  undefined,
                  DECIMAL,
                  2,
                  DECIMAL
                )}
              </p>
            )
          )}
        </div>
        <Input
          id="amount"
          type="text"
          inputMode="decimal"
          pattern="[0-9]*\.?[0-9]*"
          placeholder={isConnected ? "0.00" : "Connect wallet to enter amount"}
          className={`w-full ${
            amountError ? "border-red-500 focus:ring-red-400" : ""
          }`}
          value={amount}
          onChange={(e) => handleAmountChange(e.target.value)}
          disabled={!isConnected || isLoading}
        />
        {amountError && <p className="text-sm text-red-500">{amountError}</p>}
        {feeError && <p className="text-sm text-yellow-600">{feeError}</p>}

        {isConnected && (
          <PercentageButtons
            value={amount}
            maxValue={maxAmount}
            onChange={handleAmountChange}
            className="mt-2"
            disabled={isLoading}
          />
        )}
      </div>

      <TransactionSummary
        selectedToken={selectedToken}
        amount={amount}
        selectedNetwork={selectedNetwork}
        amountError={amountError}
        balanceImpact={balanceImpact}
        formatBalanceDisplay={formatBalanceDisplay}
      />

      <Button
        onClick={showConfirmModal}
        disabled={isButtonDisabled}
        className="w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
      >
        {isLoading ? "Processing..." : "Withdraw"}
      </Button>

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
