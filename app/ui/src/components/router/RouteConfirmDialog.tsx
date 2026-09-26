import CopyButton from "@/components/ui/copy";
import type { RouteConfirmation } from "@/interface/swap";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SWAP_FEE, WAD } from "@/lib/constants";
import { formatAmount, formatUnits, truncateAddress } from "@/utils/numberUtils";
import { getRouteActionLabel, normalizeRouteAddress } from "@/lib/route";
import RoutePreview from "./RoutePreview";

export default function RouteConfirmDialog({ confirmation, pending, onClose, onConfirm }: {
  confirmation: RouteConfirmation | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!confirmation) return null;
  const { quote, inputSymbol, inputDecimals, inputAmount, outputToken, tokens, recipient, networkName } = confirmation;
  const bridge = "bridge" in quote ? quote.bridge : undefined;
  const outputDecimals = outputToken.customDecimals ?? 18;
  const rate = BigInt(quote.amountOut) * 10n ** BigInt(inputDecimals) * WAD /
    (BigInt(inputAmount) * 10n ** BigInt(outputDecimals));
  const fallbackToken = bridge && tokens.find(token => normalizeRouteAddress(token.address) === normalizeRouteAddress(bridge.targetStratoToken));
  const hasFallback = "depositAction" in quote && quote.depositAction.action === 4;
  const deposit = outputToken.routeDestination === "vault" || outputToken.routeDestination === "savings";
  const confirmLabel = `Confirm ${getRouteActionLabel(outputToken.routeDestination, !!bridge, !!bridge && !hasFallback)}`;

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg" aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>{confirmLabel}</DialogTitle>
          <DialogDescription className="text-xs">
            Review the amounts and receiving account.{quote.steps.length > 0 ? " The execution route may change while preserving the minimum below." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-muted-foreground">You send · {networkName}</span>
            <span className="text-right text-sm font-semibold break-words">{formatAmount(formatUnits(inputAmount, inputDecimals))} {inputSymbol}</span>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-muted-foreground">You receive · STRATO (estimated)</span>
            <span className="text-right text-sm font-semibold break-words">{formatAmount(formatUnits(quote.amountOut, outputDecimals))} {outputToken._symbol}</span>
          </div>
        </div>
        <dl className="space-y-2 text-xs">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Receiving account</dt>
            <dd className="flex items-center gap-1 font-mono font-medium"><span>{truncateAddress(recipient)}</span><CopyButton address={recipient} /></dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Rate</dt>
            <dd className="text-right font-medium">1 {inputSymbol} ≈ {formatAmount(formatUnits(rate.toString()))} {outputToken._symbol}</dd></div>
          {!(bridge?.rebaseFactor && !hasFallback) && (
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{deposit ? hasFallback ? "Minimum shares if deposited" : "Minimum shares received" : hasFallback ? "Minimum if swapped" : "Minimum received"}</dt>
              <dd className="text-right font-medium break-words">{formatAmount(formatUnits(quote.minFinalOut, outputDecimals))} {outputToken._symbol}</dd></div>
          )}
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Slippage tolerance</dt><dd className="font-medium">{quote.slippageBps / 100}%</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{bridge ? "Network gas" : "Transaction fee"}</dt>
            <dd className="text-right font-medium">{bridge ? "Shown in your wallet; approval may cost extra" : `${SWAP_FEE} USDST (vouchers applied when available)`}</dd></div>
          {quote.steps.filter(step => BigInt(step.feeAmount) > 0n).map((step, index) => (
            <div key={`${step.target}-${index}`} className="flex justify-between gap-4"><dt className="text-muted-foreground">{step.label} fee · included in quote</dt>
              <dd className="text-right font-medium">{step.feeBps / 100}%</dd></div>
          ))}
        </dl>
        {bridge?.rebaseFactor && !hasFallback && <p className="text-xs text-muted-foreground">The received amount depends on the rebase factor at settlement.</p>}
        {hasFallback && bridge && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <p className="font-semibold">Fallback: {bridge.rebaseFactor ? "approximately " : ""}{formatAmount(formatUnits(bridge.bridgedAmount, fallbackToken?.customDecimals ?? 18))} {bridge.targetStratoSymbol}</p>
            <p className="mt-1 text-muted-foreground">If the {deposit ? "vault or savings deposit" : "swap"} cannot meet your minimum, you receive this deposited asset instead. The {outputToken._symbol} minimum does not apply to this fallback.{deposit ? " Savings or vault APY does not apply to the fallback asset." : ""}{bridge.rebaseFactor ? " The amount depends on the rebase factor at settlement." : ""}</p>
          </div>
        )}
        {bridge && <p className="text-xs text-muted-foreground">Deposit from {networkName} → {bridge.targetStratoSymbol} on STRATO.</p>}
        {quote.steps.length > 0 && <RoutePreview steps={quote.steps} tokens={tokens} minFinalOut={quote.minFinalOut} outputToken={outputToken} showMinimum={false} />}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={pending}>{pending ? "Submitting…" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
