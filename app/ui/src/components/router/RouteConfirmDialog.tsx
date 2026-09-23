import type { AutoRouteDepositStage } from "@/lib/bridge/types";
import type { RouteConfirmation } from "@/interface/swap";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SWAP_FEE, WAD } from "@/lib/constants";
import { formatUnits } from "@/utils/numberUtils";
import { normalizeRouteAddress } from "@/lib/route";
import RoutePreview from "./RoutePreview";

export default function RouteConfirmDialog({ confirmation, pending, stage, onClose, onConfirm }: {
  confirmation: RouteConfirmation | null;
  pending: boolean;
  stage?: AutoRouteDepositStage | null;
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

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg" aria-busy={pending}>
        <DialogHeader>
          <DialogTitle>{bridge ? "Confirm deposit" : "Confirm trade"}</DialogTitle>
          <DialogDescription>
            Review the amounts and receiving account.{quote.steps.length > 0 ? " The execution route may change while preserving the trade minimum below." : ""}
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">You pay · {networkName}</dt>
            <dd className="max-w-[60%] shrink-0 text-right font-semibold break-words">{formatUnits(inputAmount, inputDecimals)} {inputSymbol}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Estimated received · STRATO</dt>
            <dd className="max-w-[60%] shrink-0 text-right font-semibold break-words">{formatUnits(quote.amountOut, outputDecimals)} {outputToken._symbol}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Receiving account</dt>
            <dd className="max-w-[65%] break-all text-right font-mono text-xs">{recipient}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Rate</dt>
            <dd className="text-right break-all">1 {inputSymbol} ≈ {formatUnits(rate.toString())} {outputToken._symbol}</dd></div>
          {!(bridge?.rebaseFactor && !hasFallback) && (
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{hasFallback ? "Minimum if traded" : "Minimum received"}</dt>
              <dd className="max-w-[60%] shrink-0 text-right font-semibold break-words">{formatUnits(quote.minFinalOut, outputDecimals)} {outputToken._symbol}</dd></div>
          )}
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Slippage tolerance</dt><dd>{quote.slippageBps / 100}%</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{bridge ? "Network gas" : "Transaction fee"}</dt>
            <dd className="text-right">{bridge ? "Shown in your wallet; approval may cost extra" : `${SWAP_FEE} USDST (vouchers applied when available)`}</dd></div>
        </dl>
        {bridge?.rebaseFactor && !hasFallback && <p className="text-xs text-muted-foreground">The received amount depends on the rebase factor at settlement.</p>}
        {hasFallback && bridge && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">Fallback: {bridge.rebaseFactor ? "approximately " : ""}{formatUnits(bridge.bridgedAmount, fallbackToken?.customDecimals ?? 18)} {bridge.targetStratoSymbol}</p>
            <p className="mt-1 text-xs text-muted-foreground">If the trade cannot meet your minimum, you receive this deposited asset instead. The {outputToken._symbol} minimum does not apply to this fallback.{bridge.rebaseFactor ? " The amount depends on the rebase factor at settlement." : ""}</p>
          </div>
        )}
        {bridge && <p className="text-xs text-muted-foreground">Deposit from {networkName} → {bridge.targetStratoSymbol} on STRATO.</p>}
        {quote.steps.length > 0 && <RoutePreview steps={quote.steps} tokens={tokens} minFinalOut={quote.minFinalOut} outputToken={outputToken} showMinimum={false} />}
        {quote.steps.some(step => BigInt(step.feeAmount) > 0n) && (
          <div className="space-y-1 text-xs">
            <p className="font-medium">Protocol fees · already included in the quote</p>
            {quote.steps.filter(step => BigInt(step.feeAmount) > 0n).map((step, index) => (
              <p key={`${step.target}-${index}`} className="flex justify-between gap-4 text-muted-foreground"><span>{step.label}</span><span>{step.feeBps / 100}%</span></p>
            ))}
          </div>
        )}
        {pending && stage && <p role="status" className="rounded-lg bg-muted p-3 text-sm">{stage.step && `Step ${stage.step} of ${stage.total}: `}{stage.label}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={onConfirm} disabled={pending}>{pending ? "Submitting…" : bridge ? "Confirm deposit" : "Confirm trade"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
