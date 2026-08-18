import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import RoutePreview from "@/components/router/RoutePreview";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { SwapConfirmDialog } from "@/components/swap/SwapConfirmDialog";
import { SwapDetails } from "@/components/swap/SwapDetails";
import { TokenInputPanel } from "@/components/swap/TokenInputPanel";
import { useLendingContext } from "@/context/LendingContext";
import { useTokenContext } from "@/context/TokenContext";
import { useTradeForm } from "@/context/TradeFormContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useToast } from "@/hooks/use-toast";
import { useRouteExecute } from "@/hooks/trade/useRouteExecute";
import { useRouteQuote } from "@/hooks/trade/useRouteQuote";
import { SwapToken, Token } from "@/interface";
import { SWAP_FEE, usdstAddress } from "@/lib/constants";
import { formatAmount, formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/transferValidation";

const normalizeAddress = (address: string) =>
  address.toLowerCase().replace(/^0x/, "");

const toSwapToken = (token: Token, balance: string): SwapToken => ({
  address: token.address,
  _name: token._name,
  _symbol: token._symbol,
  customDecimals: token.customDecimals ?? 18,
  _totalSupply: token._totalSupply ?? "0",
  balance,
  price: token.price ?? "0",
  poolBalance: "0",
  images: token.images ?? [],
});

const displayRate = (numerator: string, denominator: string) => {
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) && result > 0
    ? formatAmount(String(result))
    : undefined;
};

interface RouterWidgetProps {
  guestMode?: boolean;
}

const RouterWidget = ({ guestMode = false }: RouterWidgetProps) => {
  const { state, dispatch } = useTradeForm();
  const { tokenIn, tokenOut, typedValue, slippage } = state;
  const {
    usdstBalance,
    voucherBalance,
    earningAssets,
    fetchUsdstBalance,
    getEarningAssets,
  } = useTokenContext();
  const {
    activeTokens,
    allActiveTokens,
    allActiveLoading,
    fetchTokens,
    fetchAllActiveTokens,
  } = useUserTokens();
  const { refreshLoans, refreshCollateral } = useLendingContext();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    fetchAllActiveTokens(abortController.signal);
    return () => abortController.abort();
  }, [fetchAllActiveTokens]);

  const tokens = useMemo(() => {
    const balances = new Map(
      activeTokens.map((token) => [
        normalizeAddress(token.address),
        token.balance || "0",
      ])
    );
    const unique = new Map<string, SwapToken>();

    [...allActiveTokens, ...earningAssets].forEach((token) => {
      const address = normalizeAddress(token.address);
      const balance = balances.get(address) ?? token.balance ?? "0";
      unique.set(address, toSwapToken(token, balance));
    });

    return [...unique.values()].sort((a, b) =>
      a._symbol.localeCompare(b._symbol)
    );
  }, [activeTokens, allActiveTokens, earningAssets]);

  const fromOptions = useMemo(
    () => tokens.filter((token) => token.address !== tokenOut?.address),
    [tokens, tokenOut?.address]
  );
  const toOptions = useMemo(
    () => tokens.filter((token) => token.address !== tokenIn?.address),
    [tokens, tokenIn?.address]
  );
  const liveTokenIn = tokenIn
    ? tokens.find((token) => token.address === tokenIn.address) ?? tokenIn
    : undefined;
  const liveTokenOut = tokenOut
    ? tokens.find((token) => token.address === tokenOut.address) ?? tokenOut
    : undefined;

  useEffect(() => {
    if (tokenIn || tokens.length === 0) return;
    const withBalance = tokens.find((token) => BigInt(token.balance || "0") > 0n);
    const usdst = tokens.find(
      (token) => normalizeAddress(token.address) === normalizeAddress(usdstAddress)
    );
    dispatch({ type: "SELECT_TOKEN_IN", token: withBalance ?? usdst ?? tokens[0] });
  }, [dispatch, tokenIn, tokens]);

  useEffect(() => {
    if (!tokenIn || tokenOut || toOptions.length === 0) return;
    dispatch({ type: "SELECT_TOKEN_OUT", token: toOptions[0] });
  }, [dispatch, tokenIn, tokenOut, toOptions]);

  const inputAmountWei = useMemo(
    () => safeParseUnits(typedValue, liveTokenIn?.customDecimals ?? 18),
    [liveTokenIn?.customDecimals, typedValue]
  );
  const feeWei = safeParseUnits(SWAP_FEE);
  const { maxSpendableWei, maxTransferableError } = useMemo(() => {
    if (!liveTokenIn) {
      return { maxSpendableWei: 0n, maxTransferableError: "" };
    }
    let error = "";
    const maximum = computeMaxTransferable(
      liveTokenIn.balance || "0",
      normalizeAddress(liveTokenIn.address) === normalizeAddress(usdstAddress),
      voucherBalance,
      usdstBalance,
      feeWei.toString(),
      (nextError) => {
        error = typeof nextError === "function" ? nextError(error) : nextError;
      }
    );
    return {
      maxSpendableWei: BigInt(maximum),
      maxTransferableError: error,
    };
  }, [feeWei, liveTokenIn, usdstBalance, voucherBalance]);

  const slippagePercent =
    slippage.mode === "manual" ? slippage.value : 0.5;
  const slippageBps = Math.round(slippagePercent * 100);
  const quoteQuery = useRouteQuote({
    tokenIn: liveTokenIn?.address,
    tokenOut: liveTokenOut?.address,
    amountWei: inputAmountWei > 0n ? inputAmountWei.toString() : undefined,
    slippageBps,
  });
  const quote = quoteQuery.data;
  const quoteMatches =
    !!quote &&
    !!liveTokenIn &&
    !!liveTokenOut &&
    normalizeAddress(quote.tokenIn) === normalizeAddress(liveTokenIn.address) &&
    normalizeAddress(quote.tokenOut) === normalizeAddress(liveTokenOut.address) &&
    quote.amountIn === inputAmountWei.toString() &&
    quote.slippageBps === slippageBps;
  const activeQuote = quoteMatches ? quote : undefined;
  const outputAmount = activeQuote
    ? formatUnits(activeQuote.amountOut, liveTokenOut?.customDecimals ?? 18)
    : "";
  const minFinalOut = activeQuote
    ? formatUnits(activeQuote.minFinalOut, liveTokenOut?.customDecimals ?? 18)
    : "";
  const priceImpact = activeQuote
    ? Math.max(0, ...activeQuote.steps.map((step) => step.priceImpact))
    : null;
  const exchangeRate = activeQuote
    ? displayRate(outputAmount, typedValue)
    : undefined;
  const invertedExchangeRate = activeQuote
    ? displayRate(typedValue, outputAmount)
    : undefined;

  const insufficientBalance =
    !guestMode && inputAmountWei > maxSpendableWei;
  const hasAmount = inputAmountWei > 0n;
  const quoteLoading = quoteQuery.isFetching && !activeQuote;
  const routeExecute = useRouteExecute();
  const isTradeDisabled =
    !liveTokenIn ||
    !liveTokenOut ||
    !hasAmount ||
    insufficientBalance ||
    !!maxTransferableError ||
    quoteLoading ||
    !activeQuote;

  const warnings: string[] = [];
  if (maxTransferableError) warnings.push(maxTransferableError);
  if (hasAmount && quoteQuery.isError && !activeQuote) {
    warnings.push("No executable route is available for this trade.");
  }

  const handleSwitch = () => {
    dispatch({ type: "SWITCH_TOKENS" });
    dispatch({ type: "RESET_AMOUNTS" });
  };

  const handleMaxClick = () => {
    if (maxSpendableWei <= 0n) return;
    dispatch({
      type: "TYPE_AMOUNT",
      field: "input",
      value: formatUnits(
        maxSpendableWei.toString(),
        liveTokenIn?.customDecimals ?? 18
      ),
    });
  };

  const handleTrade = async () => {
    if (!liveTokenIn || !liveTokenOut || !activeQuote) return;
    try {
      await routeExecute.mutateAsync({
        tokenIn: liveTokenIn.address,
        tokenOut: liveTokenOut.address,
        amountIn: inputAmountWei.toString(),
        minFinalOut: activeQuote.minFinalOut,
        slippageBps,
      });
      toast({
        title: "Success",
        description: `Traded ${formatAmount(typedValue)} ${liveTokenIn._symbol} for ${formatAmount(outputAmount)} ${liveTokenOut._symbol}`,
        variant: "success",
      });
      dispatch({ type: "RESET_AMOUNTS" });
    } finally {
      setIsDialogOpen(false);
      await Promise.all([
        fetchUsdstBalance(),
        fetchTokens(),
        getEarningAssets(false),
        refreshLoans(),
        refreshCollateral(),
      ]);
    }
  };

  const inputError = insufficientBalance ? "Insufficient balance" : undefined;
  const buttonLabel = guestMode
    ? "Sign in to trade"
    : quoteQuery.isError && hasAmount
      ? "No route available"
      : "Trade Assets";

  return (
    <div className="space-y-6">
      <TokenInputPanel
        label="From"
        amount={typedValue}
        onChange={(value) =>
          dispatch({ type: "TYPE_AMOUNT", field: "input", value })
        }
        asset={liveTokenIn}
        onSelect={(token) => dispatch({ type: "SELECT_TOKEN_IN", token })}
        tokens={fromOptions}
        userBalanceWei={liveTokenIn?.balance || "0"}
        poolBalanceWei="0"
        maxAmountWei={maxSpendableWei.toString()}
        isFromInput
        onMaxClick={handleMaxClick}
        amountError={inputError}
        loading={allActiveLoading}
        showUserBalance={!guestMode}
        showPoolBalance={false}
      />

      <div className="flex justify-center">
        <Button
          onClick={handleSwitch}
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
        onChange={() => undefined}
        asset={liveTokenOut}
        onSelect={(token) => dispatch({ type: "SELECT_TOKEN_OUT", token })}
        tokens={toOptions}
        userBalanceWei={liveTokenOut?.balance || "0"}
        poolBalanceWei="0"
        maxAmountWei="0"
        isFromInput={false}
        loading={allActiveLoading}
        amountReadOnly
        showUserBalance={!guestMode}
        showPoolBalance={false}
      />

      <SwapDetails
        tokenInSymbol={liveTokenIn?._symbol || ""}
        tokenOutSymbol={liveTokenOut?._symbol || ""}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        priceImpact={priceImpact}
        warnings={warnings}
      >
        {activeQuote && (
          <RoutePreview
            steps={activeQuote.steps}
            tokens={tokens}
            minFinalOut={activeQuote.minFinalOut}
            outputToken={liveTokenOut}
          />
        )}
        <SlippageControl
          slippage={slippage}
          effectivePercent={slippagePercent}
          onChange={(value) =>
            dispatch({ type: "SET_SLIPPAGE", slippage: value })
          }
        />
      </SwapDetails>

      <Button
        className="w-full bg-strato-blue hover:bg-strato-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => setIsDialogOpen(true)}
        disabled={guestMode || isTradeDisabled}
      >
        {buttonLabel}
      </Button>

      <SwapConfirmDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        fromAmount={formatAmount(typedValue)}
        toAmount={formatAmount(outputAmount)}
        fromAsset={liveTokenIn}
        toAsset={liveTokenOut}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        isHighPriceImpact={(priceImpact ?? 0) >= 5}
        toAmountMin={formatAmount(minFinalOut)}
        onConfirm={handleTrade}
        isLoading={routeExecute.isPending}
      />
    </div>
  );
};

export default RouterWidget;
