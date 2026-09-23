import { ArrowRight } from "lucide-react";
import { RouteStepQuote } from "@strato/shared-types";
import { SwapToken } from "@/interface";
import {
  formatAmount,
  formatUnits,
  truncateAddress,
} from "@/utils/numberUtils";

const normalizeAddress = (address: string) =>
  address.toLowerCase().replace(/^0x/, "");

const RoutePreview = ({
  steps,
  tokens,
  minFinalOut,
  outputToken,
}: {
  steps: RouteStepQuote[];
  tokens: SwapToken[];
  minFinalOut: string;
  outputToken?: SwapToken;
}) => {
  const tokenByAddress = new Map(
    tokens.map((token) => [normalizeAddress(token.address), token])
  );
  const getToken = (address: string) =>
    tokenByAddress.get(normalizeAddress(address));
  const formatStepAmount = (amount: string, address: string) => {
    const token = getToken(address);
    return formatAmount(formatUnits(amount, token?.customDecimals ?? 18));
  };

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Route</span>
        <span className="font-medium">
          {steps.length} step{steps.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-2">
        {steps.map((step, index) => {
          const tokenIn = getToken(step.tokenIn);
          const tokenOut = getToken(step.tokenOut);
          return (
            <div
              key={`${step.target}-${index}`}
              className="rounded-md border border-border bg-background/60 p-2.5 text-xs"
            >
              <div className="mb-1 font-medium">
                {index + 1}. {step.label}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <span>
                  {formatStepAmount(step.amountIn, step.tokenIn)}{" "}
                  {tokenIn?._symbol ?? truncateAddress(step.tokenIn)}
                </span>
                <ArrowRight className="h-3 w-3" />
                <span>
                  {formatStepAmount(step.amountOut, step.tokenOut)}{" "}
                  {tokenOut?._symbol ?? truncateAddress(step.tokenOut)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-start justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Minimum received</span>
        <span className="text-right font-medium">
          {formatAmount(
            formatUnits(minFinalOut, outputToken?.customDecimals ?? 18)
          )}{" "}
          {outputToken?._symbol ?? ""}
        </span>
      </div>
    </div>
  );
};

export default RoutePreview;
