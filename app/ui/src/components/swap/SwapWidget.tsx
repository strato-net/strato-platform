import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowDownUp, ChevronDown } from "lucide-react";
import { useTokenContext } from "@/context/TokenContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useLendingContext } from "@/context/LendingContext";
import { useToast } from "@/hooks/use-toast";
import { useTradeForm } from "@/context/TradeFormContext";
import { useTradeTokens, useTradePairableTokens } from "@/hooks/trade/useTradeTokens";
import { useDerivedTradeInfo } from "@/hooks/trade/useDerivedTradeInfo";
import { useTradeSwap } from "@/hooks/trade/useTradeSwap";
import { usdstAddress, SWAP_FEE } from "@/lib/constants";
import { safeParseUnits, formatAmount, formatUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/transferValidation";
import { TokenInputPanel } from "@/components/swap/TokenInputPanel";
import { PoolSelector } from "@/components/swap/PoolSelector";
import { SwapDetails } from "@/components/swap/SwapDetails";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { SwapConfirmDialog } from "@/components/swap/SwapConfirmDialog";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { UserRewardsData } from "@/services/rewardsService";

const USDST_BALANCE_REFRESH_MS = 10_000;
const LOW_USDST_THRESHOLD = "0.10";

interface SwapWidgetProps {
  userRewards?: UserRewardsData | null;
  rewardsLoading?: boolean;
  guestMode?: boolean;
}

/**
 * The Trade page widget. All quoting happens server-side through the unified
 * /trade endpoints — every pool type (V2, stable, V3) is simulated with its
 * contract's exact math, so the displayed amounts match execution. The form
 * follows the independent-field pattern: the user types one side and the other
 * side is always derived from the active pool's quote.
 */
const SwapWidget = ({ userRewards, guestMode = false }: SwapWidgetProps) => {
  const { state, dispatch } = useTradeForm();
  const { tokenIn, tokenOut, typedValue, independentField, selectedPoolAddress, slippage } = state;

  const { usdstBalance, voucherBalance, fetchUsdstBalance } = useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { refreshLoans, refreshCollateral } = useLendingContext();
  const { toast } = useToast();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  // pool routing is automatic (best rate); the selector is advanced, opt-in UI
  const [showPoolSelector, setShowPoolSelector] = useState(false);

  // ========================================================================
  // TOKEN LISTS + DEFAULT SELECTION
  // ========================================================================
  const tokensQuery = useTradeTokens();
  const pairablesQuery = useTradePairableTokens(tokenIn?.address);
  const tokens = useMemo(() => tokensQuery.data ?? [], [tokensQuery.data]);
  const pairables = useMemo(() => pairablesQuery.data ?? [], [pairablesQuery.data]);

  const fromOptions = useMemo(
    () => tokens.filter((t) => t.address !== tokenOut?.address),
    [tokens, tokenOut?.address]
  );
  const toOptions = useMemo(
    () => pairables.filter((t) => t.address !== tokenIn?.address),
    [pairables, tokenIn?.address]
  );

  // The form state pins the SELECTION; balances must not be read from that
  // snapshot — they come from the freshest token list, which react-query
  // refetches after every swap (useTradeSwap invalidates ['trade'])
  const liveTokenIn = useMemo(
    () => (tokenIn ? tokens.find((t) => t.address === tokenIn.address) ?? tokenIn : undefined),
    [tokens, tokenIn]
  );
  const liveTokenOut = useMemo(
    () =>
      tokenOut
        ? pairables.find((t) => t.address === tokenOut.address) ??
          tokens.find((t) => t.address === tokenOut.address) ??
          tokenOut
        : undefined,
    [tokens, pairables, tokenOut]
  );

  // default From: first token the user holds, else USDST, else the first listed
  useEffect(() => {
    if (tokenIn || tokens.length === 0) return;
    const withBalance = tokens.find((t) => BigInt(t.balance || "0") > 0n);
    const usdst = tokens.find((t) => t.address === usdstAddress);
    dispatch({ type: "SELECT_TOKEN_IN", token: withBalance ?? usdst ?? tokens[0] });
  }, [tokens, tokenIn, dispatch]);

  // default To: keep the current selection while it stays pairable, else the first pairable
  useEffect(() => {
    if (!tokenIn || pairablesQuery.isLoading) return;
    if (tokenOut && toOptions.some((t) => t.address === tokenOut.address)) return;
    if (toOptions.length > 0) dispatch({ type: "SELECT_TOKEN_OUT", token: toOptions[0] });
  }, [tokenIn, tokenOut, toOptions, pairablesQuery.isLoading, dispatch]);

  // ========================================================================
  // BALANCES & FEES
  // ========================================================================
  useEffect(() => {
    fetchUsdstBalance();
    const timer = setInterval(fetchUsdstBalance, USDST_BALANCE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchUsdstBalance]);

  const feeWei = safeParseUnits(SWAP_FEE);
  const { maxSpendableWei, maxTransferableError } = useMemo(() => {
    if (!liveTokenIn) return { maxSpendableWei: 0n, maxTransferableError: "" };
    let error = "";
    const max = computeMaxTransferable(
      liveTokenIn.balance || "0",
      liveTokenIn.address === usdstAddress,
      voucherBalance,
      usdstBalance,
      feeWei.toString(),
      (e) => { error = typeof e === "function" ? e(error) : e; }
    );
    return { maxSpendableWei: BigInt(max), maxTransferableError: error };
  }, [liveTokenIn, voucherBalance, usdstBalance, feeWei]);

  // ========================================================================
  // DERIVED TRADE INFO (quotes across all pools; dependent field amounts)
  // ========================================================================
  const derived = useDerivedTradeInfo(state, maxSpendableWei);
  const {
    pools, poolsLoading, poolsTransitioning, quoteResponse, quoteLoading, hasQuoteResponse,
    activePoolAddress, activePool, activeQuote, bestPoolAddress,
    typedValueWei, exactOut, inputAmount, outputAmount, inputAmountWei, outputAmountWei,
    exchangeRate, invertedExchangeRate, oracleExchangeRate, invertedOracleExchangeRate,
    priceImpact, slippagePercent, minAmountOutWei,
    insufficientBalance, exceedsPoolLiquidity,
  } = derived;

  const hasAmount = typedValueWei > 0n;

  const isLowBalanceWarning = useMemo(() => {
    if (tokenIn?.address !== usdstAddress || inputAmountWei === 0n) return false;
    const usdstWei = BigInt(usdstBalance || "0");
    if (usdstWei < inputAmountWei + feeWei) return false;
    return usdstWei - inputAmountWei - feeWei <= safeParseUnits(LOW_USDST_THRESHOLD);
  }, [tokenIn?.address, inputAmountWei, usdstBalance, feeWei]);

  // ========================================================================
  // EXECUTION
  // ========================================================================
  const tradeSwap = useTradeSwap();

  const isSwapDisabled =
    !tokenIn || !tokenOut || !hasAmount ||
    insufficientBalance || exceedsPoolLiquidity || !!maxTransferableError ||
    quoteLoading || !activeQuote || (exactOut && !!activeQuote.partialFill) ||
    !!activePool?.isPaused || !!activePool?.isDisabled;

  const handleSwap = async () => {
    if (!tokenIn || !tokenOut || !activePoolAddress || !activeQuote) return;
    try {
      await tradeSwap.mutateAsync({
        poolAddress: activePoolAddress,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amountIn: inputAmountWei.toString(),
        minAmountOut: minAmountOutWei.toString(),
      });
      toast({
        title: "Success",
        description: `Traded ${formatAmount(inputAmount)} ${tokenIn._symbol} for ${formatAmount(outputAmount)} ${tokenOut._symbol}`,
        variant: "success",
      });
      dispatch({ type: "RESET_AMOUNTS" });
    } finally {
      setIsDialogOpen(false);
      // trade queries (tokens, pools, quotes, history) refresh via react-query
      // invalidation in useTradeSwap; the rest of the app refreshes here
      await Promise.all([
        fetchUsdstBalance(),
        fetchTokens(),
        refreshLoans(),
        refreshCollateral(),
      ]);
    }
  };

  const handleMaxClick = () => {
    if (maxSpendableWei <= 0n) return;
    dispatch({ type: "TYPE_AMOUNT", field: "input", value: formatUnits(maxSpendableWei.toString()) });
  };

  // ========================================================================
  // WARNINGS & FIELD ERRORS
  // ========================================================================
  // balance validation is meaningless for signed-out guests (balance is always 0)
  const inputError = !guestMode && (independentField === "input" || inputAmountWei > 0n)
    ? (insufficientBalance ? "Insufficient balance" : undefined)
    : undefined;
  const outputError = exceedsPoolLiquidity ? "Amount exceeds pool liquidity" : undefined;

  const warnings: string[] = [];
  if (maxTransferableError) warnings.push(maxTransferableError);
  if (isLowBalanceWarning) {
    warnings.push("Warning: Your USDST balance is running low. Add more funds now to avoid issues with future transactions.");
  }
  // with the pool cards tucked away, a trade nothing can fill needs an
  // explicit explanation instead of a silently disabled button
  if (hasAmount && hasQuoteResponse && !quoteLoading && !activeQuote && pools.length > 0) {
    warnings.push("No pool can fill this trade right now — try a smaller amount.");
  }

  const rewardsActivity = useMemo(() => {
    if (!activePool || activePool.poolType === "v3") return null;
    return userRewards?.activities?.find(
      (a) => a.activity.sourceContract?.toLowerCase() === activePool.address.toLowerCase()
    ) ?? null;
  }, [userRewards, activePool]);

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <div className="space-y-6">
      <TokenInputPanel
        label="From"
        amount={inputAmount}
        onChange={(value) => dispatch({ type: "TYPE_AMOUNT", field: "input", value })}
        asset={liveTokenIn}
        onSelect={(token) => dispatch({ type: "SELECT_TOKEN_IN", token })}
        tokens={fromOptions}
        userBalanceWei={liveTokenIn?.balance || "0"}
        poolBalanceWei={activePool?.tokenIn.poolBalance || liveTokenIn?.poolBalance || "0"}
        maxAmountWei={maxSpendableWei.toString()}
        isFromInput={true}
        onMaxClick={handleMaxClick}
        amountError={inputError}
        loading={poolsLoading}
        showUserBalance={!guestMode}
      />

      <div className="flex justify-center">
        <Button
          onClick={() => dispatch({ type: "SWITCH_TOKENS" })}
          variant="outline"
          size="icon"
          className="rounded-full bg-muted hover:bg-muted/80 border-border"
        >
          <ArrowDownUp className="h-4 w-4" />
        </Button>
      </div>

      <TokenInputPanel
        label="To"
        amount={outputAmount}
        onChange={(value) => dispatch({ type: "TYPE_AMOUNT", field: "output", value })}
        asset={liveTokenOut}
        onSelect={(token) => dispatch({ type: "SELECT_TOKEN_OUT", token })}
        tokens={toOptions}
        userBalanceWei={liveTokenOut?.balance || "0"}
        poolBalanceWei={activePool?.tokenOut.poolBalance || liveTokenOut?.poolBalance || "0"}
        maxAmountWei={activePool?.tokenOut.poolBalance || "0"}
        isFromInput={false}
        amountError={outputError}
        loading={poolsLoading}
        showUserBalance={!guestMode}
      />

      {rewardsActivity && (
        // Swap rewards are registered per pool contract (V2/stable addresses only)
        <RewardsWidget
          userRewards={userRewards}
          activityName={rewardsActivity.activity.name}
          inputAmount={inputAmount}
          swapTokenInAddress={tokenIn?.address}
          actionLabel="Trade"
        />
      )}

      <SwapDetails
        tokenInSymbol={tokenIn?._symbol || ""}
        tokenOutSymbol={tokenOut?._symbol || ""}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        oracleExchangeRate={oracleExchangeRate}
        invertedOracleExchangeRate={invertedOracleExchangeRate}
        priceImpact={priceImpact}
        warnings={warnings}
      >
        {/* Pool routing — automatic by default (best rate); the selector is
            advanced, opt-in UI so casual users never have to think about pools */}
        {pools.length > 0 && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-1">
              <span className="text-muted-foreground">Pool</span>
              <button
                type="button"
                onClick={() => setShowPoolSelector((open) => !open)}
                className="flex items-center gap-1.5 text-xs md:text-sm text-foreground hover:text-strato-blue transition-colors"
              >
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-semibold">
                  {activePool?.poolLabel ?? "—"}
                </Badge>
                <span className="text-muted-foreground">
                  {selectedPoolAddress ? "Manual" : "Auto · best rate"}
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${showPoolSelector ? "rotate-180" : ""}`}
                />
              </button>
            </div>
            {showPoolSelector && (
              <PoolSelector
                pools={pools}
                quotes={quoteResponse?.quotes ?? []}
                bestPoolAddress={bestPoolAddress}
                selectedPoolAddress={activePoolAddress}
                hasAmount={hasAmount}
                hasQuoteResponse={hasQuoteResponse}
                transitioning={poolsTransitioning}
                exactOut={exactOut}
                tokenInSymbol={tokenIn?._symbol || ""}
                tokenOutSymbol={tokenOut?._symbol || ""}
                onSelect={(address) =>
                  dispatch({ type: "SELECT_POOL", poolAddress: address === bestPoolAddress ? null : address })
                }
              />
            )}
          </div>
        )}

        <SlippageControl
          slippage={slippage}
          effectivePercent={slippagePercent}
          onChange={(value) => dispatch({ type: "SET_SLIPPAGE", slippage: value })}
        />
      </SwapDetails>

      <Button
        className="w-full bg-strato-blue hover:bg-strato-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => setIsDialogOpen(true)}
        disabled={guestMode || isSwapDisabled}
      >
        {guestMode
          ? "Sign in to trade"
          : activePool?.isDisabled
            ? "This pool is disabled"
            : activePool?.isPaused
              ? "Pool is paused by admin at this time"
              : "Trade Assets"}
      </Button>

      <SwapConfirmDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        fromAmount={formatAmount(inputAmount)}
        toAmount={formatAmount(outputAmount)}
        fromAsset={tokenIn}
        toAsset={tokenOut}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        isHighPriceImpact={(priceImpact ?? 0) >= 5}
        toAmountMin={formatAmount(formatUnits(minAmountOutWei.toString()))}
        onConfirm={handleSwap}
        isLoading={tradeSwap.isPending}
      />
    </div>
  );
};

export default SwapWidget;
