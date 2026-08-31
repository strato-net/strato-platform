import { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SWAP_FEE } from "@/lib/constants";
import { LoadingSpinner } from "@/components/swap/TokenInputPanel";

// ============================================================================
// SWAP DETAILS
// Exchange rate (with oracle spot reference), transaction fee, price impact,
// and warnings — one rendering path for every pool type, fed by the quote.
// The routing pool itself is shown by the widget's collapsible Pool row.
// ============================================================================
interface SwapDetailsProps {
  tokenInSymbol: string;
  tokenOutSymbol: string;
  exchangeRate?: string;
  invertedExchangeRate?: string;
  oracleExchangeRate?: string;
  invertedOracleExchangeRate?: string;
  priceImpact: number | null;
  warnings: string[];
  /** slippage control slot */
  children?: ReactNode;
}

export const SwapDetails = ({
  tokenInSymbol,
  tokenOutSymbol,
  exchangeRate,
  invertedExchangeRate,
  oracleExchangeRate,
  invertedOracleExchangeRate,
  priceImpact,
  warnings,
  children,
}: SwapDetailsProps) => (
  <div className="flex flex-col gap-3 bg-muted/50 p-3 md:p-4 rounded-lg border border-border">
    {/* Exchange Rate */}
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex flex-col md:flex-row md:justify-between gap-1">
        <span className="text-muted-foreground">Exchange rate</span>
        {!exchangeRate ? (
          <LoadingSpinner />
        ) : (
          <span className="font-medium text-foreground text-xs md:text-sm tabular-nums">
            1 {tokenInSymbol} ≈ {exchangeRate}{oracleExchangeRate ? ` (${oracleExchangeRate}*)` : ""} {tokenOutSymbol}
          </span>
        )}
      </div>
      {exchangeRate && (
        <>
          <div className="md:text-right">
            <span className="text-muted-foreground/70 text-xs md:text-sm tabular-nums">
              1 {tokenOutSymbol} ≈ {invertedExchangeRate}{invertedOracleExchangeRate ? ` (${invertedOracleExchangeRate}*)` : ""} {tokenInSymbol}
            </span>
          </div>
          {oracleExchangeRate && (
            <div className="md:text-right">
              <span className="text-xs text-muted-foreground/70">* spot price</span>
            </div>
          )}
        </>
      )}
    </div>

    {/* Transaction Fee */}
    <div className="flex flex-col md:flex-row md:justify-between gap-1 text-sm">
      <span className="text-muted-foreground">Transaction fee</span>
      <span className="font-medium text-xs md:text-sm tabular-nums">{SWAP_FEE} USDST ({parseFloat(SWAP_FEE) * 100} voucher)</span>
    </div>

    {/* Price Impact */}
    <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-1 text-sm">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Price impact</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>Difference between the current pool price and your average trade price. Larger trades cause higher impact.</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <span className={`font-medium text-xs md:text-sm tabular-nums ${
        priceImpact === null ? 'text-muted-foreground' :
        priceImpact < 1 ? 'text-foreground' :
        priceImpact < 5 ? 'text-warning' :
        'text-destructive'
      }`}>
        {priceImpact === null ? '—' : `${priceImpact.toFixed(2)}% ${priceImpact < 1 ? '(Low)' : priceImpact < 5 ? '(Medium)' : '(High)'}`}
      </span>
    </div>
    {priceImpact !== null && priceImpact >= 5 && (
      <p className="text-warning text-sm mt-1">
        ⚠️ High price impact — you may receive fewer tokens than expected.
      </p>
    )}

    {warnings.map((warning) => (
      <p key={warning} className="text-warning text-sm mt-1">
        {warning}
      </p>
    ))}

    {children}
  </div>
);
