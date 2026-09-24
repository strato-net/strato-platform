import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { maxUint256 } from "viem";
import { ArrowDown } from "lucide-react";
import { useUser } from "@/context/UserContext";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useBridgeContext } from "@/context/BridgeContext";
import { useToast } from "@/hooks/use-toast";
import { useWithdrawalExecute } from "@/hooks/trade/useRouteExecute";
import { api } from "@/lib/axios";
import { requestWalletConnection, redirectToLogin } from "@/lib/auth";
import { BRIDGE_OUT_FEE, WAD, usdstAddress } from "@/lib/constants";
import { normalizeRouteAddress } from "@/lib/route";
import { getWithdrawalPreview, isWithdrawalRouteAvailable } from "@/lib/bridge/utils";
import type { WithdrawalConfirmation, WithdrawalPreview, WithdrawalWidgetProps } from "@/lib/bridge/types";
import { computeMaxTransferable, handleAmountInputChange } from "@/utils/transferValidation";
import { formatUnits, safeParseUnits, truncateAddress } from "@/utils/numberUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import RouteTokenPicker from "./RouteTokenPicker";
import RouteProgressDialog from "./RouteProgressDialog";

export default function WithdrawalWidget({ catalog, active, feeBalancesReady, onPendingChange, onSubmitted }: WithdrawalWidgetProps) {
  const { isLoggedIn, userAddress, isAppAuthenticated, externalEvmWalletAddress } = useUser();
  const { usdstBalance, voucherBalance, usdstBalanceError, fetchUsdstBalance } = useTokenContext();
  const { activeTokens, fetchTokens } = useUserTokens();
  const { triggerWithdrawalRefresh } = useBridgeContext();
  const { toast } = useToast();
  const execute = useWithdrawalExecute();
  const submitting = useRef(false);
  const [routeId, setRouteId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [recipientInput, setRecipientInput] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<WithdrawalConfirmation | null>(null);
  const network = catalog.availableNetworks.find(n => n.chainName === catalog.selectedNetwork) ?? catalog.availableNetworks[0];
  const routes = catalog.bridgeableTokens.filter(route =>
    String(route.externalChainId) === network?.chainId && isWithdrawalRouteAvailable(route));
  const route = routes.find(item => item.id === routeId) ?? routes[0];
  const decimals = route?.stratoTokenDecimals ?? 18;
  const recipient = (recipientInput ?? externalEvmWalletAddress ?? "").trim();
  const validRecipient = /^0x[0-9a-f]{40}$/i.test(recipient) && BigInt(recipient) > 0n;
  const balance = useQuery({
    queryKey: ["trade", "withdrawal-balance", userAddress, route?.stratoToken],
    queryFn: async ({ signal }) => {
      const { data } = await api.get(`/tokens/balance?address=eq.${normalizeRouteAddress(route!.stratoToken)}`, { signal });
      return String(data?.[0]?.balance ?? "0");
    },
    enabled: active && isLoggedIn && !!userAddress && !!route,
    refetchInterval: active ? 10_000 : false,
  });
  const fee = safeParseUnits(BRIDGE_OUT_FEE);
  let feeError = usdstBalanceError || "";
  let maximum = BigInt(computeMaxTransferable(balance.data ?? "0", normalizeRouteAddress(route?.stratoToken ?? "") === normalizeRouteAddress(usdstAddress),
    voucherBalance, usdstBalance, fee.toString(), () => {}));
  if (!feeError && BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0") < fee) {
    feeError = `You need ${BRIDGE_OUT_FEE} USDST for fees; you have ${formatUnits(BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0"))} including vouchers.`;
  }
  const factor = BigInt(route?.rebaseFactor || "0");
  const cap = BigInt(route?.maxPerWithdrawal || "0");
  if (route && cap > 0n) {
    const inputCap = route.routeType === "native" ? cap
      : /^\d+$/.test(route.externalDecimals) && Number(route.externalDecimals) <= 18
        ? cap * 10n ** BigInt(18 - Number(route.externalDecimals)) * WAD / (route.rebaseRequired && factor > 0n ? factor : WAD)
        : 0n;
    if (inputCap < maximum) maximum = inputCap;
  }
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
  const selectionKey = JSON.stringify([userAddress, isAppAuthenticated, externalEvmWalletAddress, network?.chainId, route, amountWei.toString(), recipient]);
  const ready = active && isLoggedIn && !!userAddress && !!route && !!network && !!preview && validRecipient &&
    feeBalancesReady && !feeError && !validationError && balance.data !== undefined && !balance.isError && !catalog.loading;
  const display = (value: string, places: number) => formatUnits(value, places);
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

  return <div className="space-y-5">
    <RouteProgressDialog progress={execute.progress} onClose={execute.closeProgress} operation="Withdrawal" />
    <div className="rounded-xl border border-border/60 px-3 py-2 text-xs">
      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Sending account · STRATO</span><span className="font-mono" title={userAddress ?? ""}>{truncateAddress(userAddress) || "Connect wallet or sign in"}</span></div>
    </div>
    <label className="block space-y-2 text-sm"><span>Destination network</span>
      <select aria-label="Destination network" className="h-11 w-full rounded-xl border border-input bg-background px-3" value={network?.chainName ?? ""}
        disabled={execute.isPending} onChange={event => { catalog.setSelectedNetwork(event.target.value); setRouteId(""); clearAmount(); }}>
        {catalog.availableNetworks.map(item => <option key={item.chainId} value={item.chainName}>{item.chainName}</option>)}
      </select>
    </label>
    <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 lg:py-3">
      <label htmlFor="withdrawal-amount" className="mb-3 lg:mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">You send · STRATO</label>
      <div className="flex items-center gap-3">
        <input id="withdrawal-amount" inputMode="decimal" placeholder="0" value={amount} disabled={execute.isPending}
          aria-invalid={!!validationError} aria-describedby="withdrawal-amount-error"
          className="min-w-0 flex-1 bg-transparent text-3xl font-semibold outline-none"
          onChange={event => handleAmountInputChange(event.target.value, setAmount, setAmountError, isLoggedIn ? maximum.toString() : maxUint256.toString(), decimals)} />
        <RouteTokenPicker label="Choose withdrawal token" loading={catalog.loading} value={route?.id}
          tokens={routes.map(item => ({ id: item.id, address: item.stratoToken, name: item.stratoTokenName, symbol: item.stratoTokenSymbol,
            image: item.stratoTokenImage, decimals: item.stratoTokenDecimals ?? 18,
            balance: activeTokens.find(token => normalizeRouteAddress(token.address) === normalizeRouteAddress(item.stratoToken))?.balance?.toString(),
            detail: `Receive ${item.externalSymbol} on ${network?.chainName}` }))}
          onSelect={id => { setRouteId(id); clearAmount(); }} />
      </div>
      <div className="mt-3 lg:mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{!isLoggedIn ? "Connect wallet to see your balance" : balance.isError ? "Balance unavailable" : balance.data === undefined ? "Loading balance…" : `Available: ${display(maximum.toString(), decimals)} ${route?.stratoTokenSymbol ?? ""}`}</span>
        <button type="button" className="font-semibold text-primary" disabled={!feeBalancesReady || balance.data === undefined || execute.isPending}
          onClick={() => { setAmount(formatUnits(maximum, decimals)); setAmountError(""); }}>Max</button>
      </div>
      <p id="withdrawal-amount-error" role={validationError ? "alert" : undefined} className="mt-2 lg:mt-1 min-h-4 text-xs text-destructive">{validationError}</p>
      {!catalog.loading && !routes.length && <p className="text-sm text-muted-foreground">No withdrawals are available on this network.</p>}
    </div>
    <div className="flex justify-center"><ArrowDown className="h-5 w-5 text-muted-foreground" /></div>
    <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 lg:py-3">
      <p className="mb-3 lg:mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">You receive · {network?.chainName ?? "Choose network"}</p>
      <p className="break-words text-2xl font-semibold">{preview && route ? display(preview.externalAmount, Number(route.externalDecimals)) : "—"} {route?.externalSymbol}</p>
      <p className="mt-2 lg:mt-1 text-xs text-muted-foreground">Receive the selected asset’s external counterpart.</p>
    </div>
    <label className="block space-y-2 text-sm"><span>Receiving address on {network?.chainName ?? "the destination network"}</span>
      <Input aria-label="External receiving address" value={recipient} placeholder="0x…" disabled={execute.isPending} aria-invalid={!!recipient && !validRecipient}
        onChange={event => setRecipientInput(event.target.value)} />
      {recipient && !validRecipient && <span className="text-xs text-destructive">Enter a valid, nonzero EVM address.</span>}
      {externalEvmWalletAddress && recipient !== externalEvmWalletAddress && <button type="button" className="block text-xs text-primary" onClick={() => setRecipientInput(null)}>Use connected wallet</button>}
    </label>
    <div className="space-y-2 rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
      <p>Transaction fee: {BRIDGE_OUT_FEE} USDST (vouchers applied when available).</p>
      {route && cap > 0n && <p>Per-withdrawal limit: {display(cap.toString(), route.routeType === "native" ? decimals : Number(route.externalDecimals))} {route.routeType === "native" ? route.stratoTokenSymbol : route.externalSymbol}</p>}
      {route?.routeType === "native" && BigInt(route.maxOutstandingWithdrawal || "0") > 0n && <p>Remaining bridge capacity: {display(route.remainingOutstandingWithdrawal || "0", decimals)} {route.stratoTokenSymbol}</p>}
      <p>{preview?.manualReview ? "This amount requires manual approval. Processing time depends on that approval." : "Processed after bridge verification and network confirmation; vault capacity can delay the transfer."}</p>
      {route?.rebaseRequired && <p>Estimated external amount uses the current conversion rate; the on-chain rate at submission determines the amount.</p>}
    </div>
    <div className="min-h-5 text-xs text-destructive">{isLoggedIn && (feeBalancesReady || usdstBalanceError) ? feeError : ""}</div>
    <Button className="h-12 w-full rounded-xl" disabled={execute.isPending || (isLoggedIn && !ready)} onClick={() => {
      if (!isLoggedIn) { requestWalletConnection(); return; }
      if (ready) setConfirmation({ selectionKey, route, networkName: network.chainName, recipient, preview });
    }}>{!isLoggedIn ? "Connect wallet" : execute.isPending ? "Submitting…" : "Review withdrawal"}</Button>
    {!isLoggedIn && <button type="button" className="w-full text-center text-sm text-primary" onClick={() => redirectToLogin()}>Sign in with STRATO</button>}
    <Dialog open={!!confirmation} onOpenChange={open => { if (!open) setConfirmation(null); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader><DialogTitle>Confirm withdrawal</DialogTitle><DialogDescription>Review the asset, destination network and receiving address.</DialogDescription></DialogHeader>
        {confirmation && <dl className="space-y-3 text-sm">
          <div><dt className="text-muted-foreground">You send · STRATO</dt><dd className="font-semibold">{display(confirmation.preview.escrowAmount, confirmation.route.stratoTokenDecimals ?? 18)} {confirmation.route.stratoTokenSymbol}</dd></div>
          <div><dt className="text-muted-foreground">You receive · {confirmation.networkName} (estimated)</dt><dd className="font-semibold">{display(confirmation.preview.externalAmount, Number(confirmation.route.externalDecimals))} {confirmation.route.externalSymbol}</dd></div>
          <div><dt className="text-muted-foreground">Receiving address</dt><dd className="break-all font-mono">{confirmation.recipient}</dd></div>
          <div><dt className="text-muted-foreground">Transaction fee</dt><dd>{BRIDGE_OUT_FEE} USDST (vouchers applied when available)</dd></div>
          <div><dt className="text-muted-foreground">Processing</dt><dd>{confirmation.preview.manualReview ? "Manual approval required" : "Bridge verification and external transfer"}</dd></div>
        </dl>}
        <DialogFooter><Button variant="outline" onClick={() => setConfirmation(null)}>Cancel</Button><Button onClick={() => void confirm()}>Confirm withdrawal</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
