import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SwapToken } from "@/interface";
import { LoadingSpinner } from "@/components/swap/TokenInputPanel";

// ============================================================================
// CONFIRM TRADE DIALOG
// ============================================================================
interface SwapConfirmDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fromAmount: string;
  toAmount: string;
  fromAsset?: SwapToken;
  toAsset?: SwapToken;
  exchangeRate?: string;
  invertedExchangeRate?: string;
  isHighPriceImpact: boolean;
  toAmountMin: string;
  onConfirm: () => void;
  isLoading: boolean;
}

export const SwapConfirmDialog = ({
  isOpen,
  onOpenChange,
  fromAmount,
  toAmount,
  fromAsset,
  toAsset,
  exchangeRate,
  invertedExchangeRate,
  isHighPriceImpact,
  toAmountMin,
  onConfirm,
  isLoading
}: SwapConfirmDialogProps) => (
  <Dialog open={isOpen} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[95vw] sm:max-w-md">
      <DialogHeader>
        <DialogTitle className="text-lg md:text-xl">Confirm trade</DialogTitle>
        <DialogDescription className="text-xs md:text-sm">
          Please review the details below. Slippage tolerance and fees have already been applied.
        </DialogDescription>
      </DialogHeader>
      <div className="py-4 space-y-4">
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0">You pay:</span>
          <span className="font-semibold text-sm md:text-base text-right break-words tabular-nums">
            {fromAmount} {fromAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between items-center gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0">You receive:</span>
          <span className="font-semibold text-sm md:text-base text-right break-words tabular-nums">
            {toAmount} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between items-start gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0 min-w-[140px]">Minimum received (after slippage):</span>
          <span className="font-semibold text-sm md:text-base text-right break-words tabular-nums">
            {toAmountMin} {toAsset?._symbol || ""}
          </span>
        </div>
        <div className="flex justify-between items-start gap-2">
          <span className="text-sm md:text-base text-muted-foreground flex-shrink-0">Exchange rate:</span>
          <span className="flex flex-col items-end gap-0.5 text-right min-w-0 flex-1">
            <span className="font-semibold text-xs md:text-sm break-words tabular-nums">1 {fromAsset?._symbol || ""} ≈ {exchangeRate} {toAsset?._symbol || ""}</span>
            {invertedExchangeRate && (
              <span className="text-muted-foreground/70 text-xs md:text-sm break-words tabular-nums">1 {toAsset?._symbol || ""} ≈ {invertedExchangeRate} {fromAsset?._symbol || ""}</span>
            )}
          </span>
        </div>
        {isHighPriceImpact && (
          <div className="text-warning text-xs md:text-sm mt-2">
            ⚠️ High price impact — you may receive fewer tokens than expected.
          </div>
        )}
      </div>
      <DialogFooter className="flex-col sm:flex-row gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
          Cancel
        </Button>
        <Button disabled={isLoading} onClick={onConfirm} className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-primary-foreground">
          {isLoading && <LoadingSpinner />} Confirm trade
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
