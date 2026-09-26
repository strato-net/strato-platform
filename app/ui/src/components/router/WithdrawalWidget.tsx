import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useBridgeContext } from "@/context/BridgeContext";
import { useToast } from "@/hooks/use-toast";
import { useWithdrawalExecute } from "@/hooks/trade/useRouteExecute";
import { api } from "@/lib/axios";
import { BRIDGE_OUT_FEE, WAD, usdstAddress } from "@/lib/constants";
import { BRIDGE_MODE_LABELS } from "@/lib/bridge/constants";
import { normalizeRouteAddress } from "@/lib/route";
import { getWithdrawalPreview, isWithdrawalRouteAvailable } from "@/lib/bridge/utils";
import type { WithdrawalConfirmation, WithdrawalPreview, WithdrawalWidgetProps } from "@/lib/bridge/types";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { formatBalance, formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PercentageButtons from "@/components/ui/PercentageButtons";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import NetworkSelector from "@/components/bridge/NetworkSelector";
import TokenSelector from "@/components/bridge/TokenSelector";
import TransactionSummary from "@/components/bridge/TransactionSummary";
import BridgeConfirmationModal from "@/components/bridge/BridgeConfirmationModal";
import RouteProgressDialog from "./RouteProgressDialog";

export default function WithdrawalWidget({ catalog, active, feeBalancesReady, onPendingChange, onSubmitted }: WithdrawalWidgetProps) {
  const { isLoggedIn, userAddress, isAppAuthenticated, externalEvmWalletAddress } = useUser();
  const { usdstBalance, voucherBalance, usdstBalanceError, fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { triggerWithdrawalRefresh } = useBridgeContext();
  const { toast } = useToast();
  const execute = useWithdrawalExecute();
  const submitting = useRef(false);
  const [routeId, setRouteId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [confirmation, setConfirmation] = useState<WithdrawalConfirmation | null>(null);
  const modeLabels = BRIDGE_MODE_LABELS.bridge;
  const guestMode = !isLoggedIn;
  const network = catalog.availableNetworks.find(n => n.chainName === catalog.selectedNetwork) ?? catalog.availableNetworks[0];
  const routes = catalog.bridgeableTokens.filter(route =>
    String(route.externalChainId) === network?.chainId && isWithdrawalRouteAvailable(route));
  const route = routes.find(item => item.id === routeId) ?? routes[0];
  const decimals = route?.stratoTokenDecimals ?? 18;
  const recipient = (externalEvmWalletAddress ?? "").trim();
  const validRecipient = /^0x[0-9a-f]{40}$/i.test(recipient) && BigInt(recipient) > 0n;
  const balance = useQuery({
    queryKey: ["trade", "withdrawal-balance", userAddress, route?.stratoToken],
    queryFn: async ({ signal }) => {
      const { data } = await api.get(`/tokens/balance?address=eq.${normalizeRouteAddress(route!.stratoToken)}`, { signal });
      return String(data?.[0]?.balance ?? "0");
    },
    enabled: active && isLoggedIn && !!userAddress && !!route,
    refetchInterval: active ? 15_000 : false,
  });
  const fee = safeParseUnits(BRIDGE_OUT_FEE);
  let feeError = usdstBalanceError || "";
  let maximum = BigInt(computeMaxTransferable(balance.data ?? "0", normalizeRouteAddress(route?.stratoToken ?? "") === normalizeRouteAddress(usdstAddress),
    voucherBalance, usdstBalance, fee.toString(), () => {}));
  if (!feeError && BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0") < fee) {
    feeError = `You need ${BRIDGE_OUT_FEE} USDST for fees; you have ${formatUnits(BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0"))} including vouchers.`;
  }
  const available = maximum;
  const factor = BigInt(route?.rebaseFactor || "0");
  const cap = BigInt(route?.maxPerWithdrawal || "0");
  if (route && cap > 0n) {
    const inputCap = route.routeType === "native" ? cap
      : /^\d+$/.test(route.externalDecimals) && Number(route.externalDecimals) <= 18
        ? cap * 10n ** BigInt(18 - Number(route.externalDecimals)) * WAD / (route.rebaseRequired && factor > 0n ? factor : WAD)
        : 0n;
    if (inputCap < maximum) maximum = inputCap;
  }
  const capacityExhausted = route?.routeType === "native" && BigInt(route.maxOutstandingWithdrawal || "0") > 0n
    && BigInt(route.remainingOutstandingWithdrawal || "0") === 0n;
  if (route?.routeType === "native" && BigInt(route.maxOutstandingWithdrawal || "0") > 0n) {
    const remaining = BigInt(route.remainingOutstandingWithdrawal || "0");
    if (remaining < maximum) maximum = remaining;
  }
  const amountWei = safeParseUnits(amount || "0", decimals);
  let preview: WithdrawalPreview | null = null;
  let validationError = amountError;
  if (route && amountWei > 0n) {
    try { preview = getWithdrawalPreview(route, amountWei); }
    catch (error) { validationError ||= (error as Error).message; }
    if (balance.data !== undefined && amountWei > BigInt(balance.data)) validationError ||= "Insufficient token balance.";
    if (amountWei > maximum) validationError ||= "Amount exceeds the available balance after fees or bridge limits.";
  }
  const balanceImpact = {
    before: available.toString(),
    after: (available > amountWei ? available - amountWei : 0n).toString(),
  };
  const selectionKey = JSON.stringify([userAddress, isAppAuthenticated, externalEvmWalletAddress, network?.chainId, route, amountWei.toString(), recipient]);
  const ready = active && isLoggedIn && !!userAddress && !!route && !!network && !!preview && validRecipient &&
    feeBalancesReady && !feeError && !validationError && balance.data !== undefined && !balance.isError && !catalog.loading;
  const formatBalanceDisplay = (valueWei: string) =>
    Number(formatUnits(valueWei, decimals)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const setAmountChecked = (value: string) => handleAmountInputChange(value, setAmount, setAmountError, maximum.toString(), decimals);
  const clearAmount = () => { setAmount(""); setAmountError(""); };
  const confirm = async () => {
    if (submitting.current || execute.isPending || !confirmation) return;
    if (!ready || confirmation.selectionKey !== selectionKey) {
      setConfirmation(null);
      toast({ title: "Review withdrawal again", description: validationError || feeError || "Your account, recipient, balance, or withdrawal details changed.", variant: "destructive" });
      return;
    }
    submitting.current = true;
    onPendingChange(true);
    setConfirmation(null);
    try {
      await execute.mutateAsync({
        routeType: route.routeType, externalChainId: network.chainId,
        externalRecipient: recipient, stratoToken: route.stratoToken, stratoTokenAmount: amountWei.toString(),
        ...(route.routeType === "native" ? {} : { externalToken: route.externalToken }),
      });
      clearAmount();
    } catch {
      // The progress dialog owns submission errors and uncertain outcomes.
    } finally {
      submitting.current = false;
      onPendingChange(false);
      triggerWithdrawalRefresh();
      onSubmitted?.();
      void Promise.allSettled([fetchUsdstBalance(), fetchTokens(), balance.refetch()]);
    }
  };

  return <div className="space-y-6">
    <RouteProgressDialog progress={execute.progress} onClose={execute.closeProgress} operation="Withdrawal" />
    <div className="space-y-2 text-center">
      <h3 className="text-lg font-semibold text-foreground">{modeLabels.title}</h3>
      <p className="text-sm text-muted-foreground">{modeLabels.description}</p>
    </div>
    <div className="w-full">
      <BridgeWalletStatus
        guestMode={guestMode}
        externalOnly
        connectedLabel="External Wallet Connected"
        connectLabel="Connect External Wallet"
        copiedDescription="External wallet address copied to clipboard"
      />
    </div>
    <NetworkSelector
      selectedNetwork={network?.chainName ?? null}
      availableNetworks={catalog.availableNetworks}
      onNetworkChange={name => { catalog.setSelectedNetwork(name); setRouteId(""); clearAmount(); }}
      direction="out"
      disabled={guestMode || execute.isPending}
    />
    <TokenSelector
      selectedToken={route ?? null}
      tokens={routes}
      onTokenChange={token => { setRouteId(token?.id ?? ""); clearAmount(); }}
      direction="out"
      disabled={guestMode || execute.isPending || catalog.loading}
    />
    <div className="space-y-1.5">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-1">
        <Label htmlFor="withdrawal-amount" className="text-sm">{modeLabels.amountLabel}</Label>
        {isLoggedIn && !!route && balance.data === undefined && !balance.isError ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <p className="text-xs md:text-sm text-muted-foreground">Fetching balance...</p>
          </div>
        ) : capacityExhausted ? (
          <p className="text-xs md:text-sm text-yellow-600">
            Withdrawals temporarily unavailable — bridge capacity reached.
          </p>
        ) : isLoggedIn && balance.data !== undefined ? (
          <div>
            <div className="flex items-center gap-3">
              <p className="text-xs md:text-sm text-muted-foreground">
                Max: {formatBalance(maximum.toString(), undefined, decimals, 2, 6)}
              </p>
              <p className="text-xs md:text-sm text-muted-foreground">Min: 0</p>
            </div>
            {route?.rebaseRequired && factor > 0n && maximum > 0n && (
              <p className="text-xs text-muted-foreground mt-0.5 text-right">
                ≈ {formatBalance((maximum * factor / WAD).toString(), undefined, decimals, 2, 6)} {route.externalSymbol}
              </p>
            )}
          </div>
        ) : null}
      </div>
      <Input
        id="withdrawal-amount"
        type="text"
        inputMode="decimal"
        pattern="[0-9]*\.?[0-9]*"
        placeholder={
          capacityExhausted ? "Bridge capacity reached"
            : validRecipient ? "0.00" : "Connect external wallet to enter amount"
        }
        className={`w-full ${validationError ? "border-red-500 focus:ring-red-400" : ""}`}
        value={amount}
        onChange={event => { if (!guestMode) setAmountChecked(event.target.value); }}
        disabled={guestMode || !validRecipient || execute.isPending || capacityExhausted}
      />
      {validationError && <p className="text-sm text-red-500">{validationError}</p>}
      {feeError && <p className="text-sm text-yellow-600">{feeError}</p>}
      {validRecipient && !guestMode && (
        <PercentageButtons
          value={amount}
          maxValue={maximum.toString()}
          onChange={setAmountChecked}
          className="mt-2"
          decimals={decimals}
          disabled={execute.isPending || capacityExhausted || balance.data === undefined}
        />
      )}
    </div>
    <TransactionSummary
      selectedToken={route ?? null}
      amount={amount}
      preview={preview}
      selectedNetwork={network?.chainName ?? null}
      amountError={validationError}
      balanceImpact={balanceImpact}
      formatBalanceDisplay={formatBalanceDisplay}
    />
    {preview?.manualReview && (
      <p className="text-xs md:text-sm text-yellow-600">
        This amount requires manual approval. Processing time depends on that approval.
      </p>
    )}
    <Button
      onClick={() => { if (ready) setConfirmation({ selectionKey, route, networkName: network.chainName, recipient, preview: preview! }); }}
      disabled={guestMode || execute.isPending || !ready}
      className="w-full bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90"
    >
      {execute.isPending ? "Processing..." : "Bridge Out"}
    </Button>
    <BridgeConfirmationModal
      open={!!confirmation}
      onOk={() => void confirm()}
      onCancel={() => setConfirmation(null)}
      title="Confirm Bridge Transaction"
      okText="Yes, Bridge Assets"
      cancelText="Cancel"
      fromNetwork="STRATO"
      toNetwork={confirmation?.networkName || "Not selected"}
      selectedToken={confirmation?.route ?? null}
      preview={confirmation?.preview}
      recipient={confirmation?.recipient}
    />
  </div>;
}
