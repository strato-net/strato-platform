import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { useBalance, useReadContract } from "wagmi";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import EarnApyTooltip from "@/components/earn/EarnApyTooltip";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import RoutePreview from "@/components/router/RoutePreview";
import { SlippageControl } from "@/components/swap/SlippageControl";
import { SwapConfirmDialog } from "@/components/swap/SwapConfirmDialog";
import { SwapDetails } from "@/components/swap/SwapDetails";
import { TokenInputPanel } from "@/components/swap/TokenInputPanel";
import { useLendingContext } from "@/context/LendingContext";
import { useTokenContext } from "@/context/TokenContext";
import { useTradeForm } from "@/context/TradeFormContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useBridgeContext } from "@/context/BridgeContext";
import { useEarnContext } from "@/context/EarnContext";
import { useToast } from "@/hooks/use-toast";
import { useRouteExecute } from "@/hooks/trade/useRouteExecute";
import { useRouteQuote } from "@/hooks/trade/useRouteQuote";
import { useCompositeRouteQuote } from "@/hooks/trade/useCompositeRouteQuote";
import { useAutoRouteDeposit } from "@/hooks/trade/useAutoRouteDeposit";
import { SwapToken, Token } from "@/interface";
import { BridgeToken, RouteAction } from "@strato/shared-types";
import { UserRewardsData } from "@/services/rewardsService";
import { ERC20_ABI } from "@/lib/bridge/constants";
import { SWAP_FEE, usdstAddress } from "@/lib/constants";
import { ensureHexPrefix, formatAmount, formatUnits, safeParseUnits } from "@/utils/numberUtils";
import { computeMaxTransferable } from "@/utils/transferValidation";
import { buildEarnApyMap, pathForApyInfo } from "@/utils/earnUtils";

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

const bridgeTokenToSwapToken = (token: BridgeToken, balance: string): SwapToken => ({
  address: token.externalToken,
  _name: token.externalName,
  _symbol: token.externalSymbol,
  customDecimals: Number(token.externalDecimals || 18),
  _totalSupply: "0",
  balance,
  price: "0",
  poolBalance: "0",
  images: [],
});

const displayRate = (numerator: string, denominator: string) => {
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) && result > 0
    ? formatAmount(String(result))
    : undefined;
};

interface RouterWidgetProps {
  userRewards?: UserRewardsData | null;
  guestMode?: boolean;
}

const RouterWidget = ({ userRewards, guestMode = false }: RouterWidgetProps) => {
  const navigate = useNavigate();
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
  const {
    availableNetworks,
    bridgeableTokens,
    loading: bridgeLoading,
    selectedNetwork,
    setSelectedNetwork,
    loadNetworksAndTokens,
  } = useBridgeContext();
  const { tokenApys, tokenApysLoaded } = useEarnContext();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<"strato" | "external">("strato");
  const [externalRouteId, setExternalRouteId] = useState<string>();
  const autoRouteDeposit = useAutoRouteDeposit();

  useEffect(() => {
    const abortController = new AbortController();
    fetchAllActiveTokens(abortController.signal);
    return () => abortController.abort();
  }, [fetchAllActiveTokens]);

  useEffect(() => {
    if (sourceMode === "external") loadNetworksAndTokens();
  }, [loadNetworksAndTokens, sourceMode]);

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

  const currentNetwork = availableNetworks.find(
    (network) => network.chainName === selectedNetwork
  );
  const externalRoutes = useMemo(() => {
    const seen = new Set<string>();
    return bridgeableTokens.filter((token) => {
      const address = normalizeAddress(token.externalToken || "");
      if (
        token.routeType !== "standard" ||
        !token.enabled ||
        !address ||
        seen.has(address)
      ) {
        return false;
      }
      seen.add(address);
      return true;
    });
  }, [bridgeableTokens]);
  const selectedExternalRoute =
    externalRoutes.find((token) => token.id === externalRouteId) ??
    externalRoutes[0];
  const isNativeExternalToken =
    !!selectedExternalRoute && BigInt(selectedExternalRoute.externalToken || "0") === 0n;
  const { data: erc20Balance = 0n, isLoading: erc20BalanceLoading } =
    useReadContract({
      address: selectedExternalRoute
        ? ensureHexPrefix(selectedExternalRoute.externalToken)
        : undefined,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: autoRouteDeposit.connectedAddress
        ? [ensureHexPrefix(autoRouteDeposit.connectedAddress)]
        : undefined,
      chainId: currentNetwork ? Number(currentNetwork.chainId) : undefined,
      query: {
        enabled:
          sourceMode === "external" &&
          !!selectedExternalRoute &&
          !isNativeExternalToken &&
          !!autoRouteDeposit.connectedAddress &&
          !!currentNetwork,
      },
    });
  const { data: nativeBalance, isLoading: nativeBalanceLoading } = useBalance({
    address: autoRouteDeposit.connectedAddress
      ? ensureHexPrefix(autoRouteDeposit.connectedAddress)
      : undefined,
    chainId: currentNetwork ? Number(currentNetwork.chainId) : undefined,
    query: {
      enabled:
        sourceMode === "external" &&
        isNativeExternalToken &&
        !!autoRouteDeposit.connectedAddress &&
        !!currentNetwork,
    },
  });
  const externalBalance = isNativeExternalToken
    ? nativeBalance?.value ?? 0n
    : erc20Balance;
  const externalBalanceLoading = isNativeExternalToken
    ? nativeBalanceLoading
    : erc20BalanceLoading;
  const externalTokens = useMemo(
    () =>
      externalRoutes.map((token) =>
        bridgeTokenToSwapToken(
          token,
          token.id === selectedExternalRoute?.id ? externalBalance.toString() : "0"
        )
      ),
    [externalBalance, externalRoutes, selectedExternalRoute?.id]
  );
  const liveExternalToken = selectedExternalRoute
    ? bridgeTokenToSwapToken(selectedExternalRoute, externalBalance.toString())
    : undefined;

  const fromOptions = useMemo(
    () => tokens.filter((token) => token.address !== tokenOut?.address),
    [tokens, tokenOut?.address]
  );
  const toOptions = useMemo(
    () =>
      sourceMode === "external"
        ? tokens
        : tokens.filter((token) => token.address !== tokenIn?.address),
    [sourceMode, tokens, tokenIn?.address]
  );
  const liveTokenIn = tokenIn
    ? tokens.find((token) => token.address === tokenIn.address) ?? tokenIn
    : undefined;
  const liveTokenOut = tokenOut
    ? tokens.find((token) => token.address === tokenOut.address) ?? tokenOut
    : undefined;
  const outputApy = useMemo(
    () => liveTokenOut
      ? buildEarnApyMap(tokenApys).get(normalizeAddress(liveTokenOut.address))
      : undefined,
    [liveTokenOut, tokenApys]
  );

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

  useEffect(() => {
    if (!selectedExternalRoute) {
      setExternalRouteId(undefined);
      return;
    }
    if (!externalRouteId || !externalRoutes.some((route) => route.id === externalRouteId)) {
      setExternalRouteId(selectedExternalRoute.id);
    }
  }, [externalRouteId, externalRoutes, selectedExternalRoute]);

  const inputAmountWei = useMemo(
    () =>
      safeParseUnits(
        typedValue,
        sourceMode === "external"
          ? Number(selectedExternalRoute?.externalDecimals || 18)
          : liveTokenIn?.customDecimals ?? 18
      ),
    [
      liveTokenIn?.customDecimals,
      selectedExternalRoute?.externalDecimals,
      sourceMode,
      typedValue,
    ]
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
    tokenIn: sourceMode === "strato" ? liveTokenIn?.address : undefined,
    tokenOut: liveTokenOut?.address,
    amountWei: inputAmountWei > 0n ? inputAmountWei.toString() : undefined,
    slippageBps,
  });
  const compositeQuoteQuery = useCompositeRouteQuote({
    externalChainId:
      sourceMode === "external" ? currentNetwork?.chainId : undefined,
    externalToken:
      sourceMode === "external" ? selectedExternalRoute?.externalToken : undefined,
    targetStratoToken:
      sourceMode === "external" ? selectedExternalRoute?.stratoToken : undefined,
    tokenOut: sourceMode === "external" ? liveTokenOut?.address : undefined,
    amountWei: inputAmountWei > 0n ? inputAmountWei.toString() : undefined,
    slippageBps,
  });
  const quote =
    sourceMode === "external" ? compositeQuoteQuery.data : quoteQuery.data;
  const quoteMatches =
    !!quote &&
    !!(sourceMode === "external" ? selectedExternalRoute : liveTokenIn) &&
    !!liveTokenOut &&
    normalizeAddress(quote.tokenIn) ===
      normalizeAddress(
        sourceMode === "external"
          ? selectedExternalRoute!.stratoToken
          : liveTokenIn!.address
      ) &&
    normalizeAddress(quote.tokenOut) === normalizeAddress(liveTokenOut.address) &&
    (sourceMode === "external" && "bridge" in quote
      ? quote.bridge.externalAmount === inputAmountWei.toString()
      : quote.amountIn === inputAmountWei.toString()) &&
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
  const rewardedSteps = useMemo(() => {
    if (sourceMode !== "strato" || !activeQuote || !userRewards) return [];
    return activeQuote.steps.flatMap((step) => {
      if (
        step.action !== RouteAction.SWAP_V2 &&
        step.action !== RouteAction.SWAP_STABLE
      ) {
        return [];
      }
      const reward = userRewards.activities.find(
        ({ activity }) =>
          normalizeAddress(activity.sourceContract || "") ===
          normalizeAddress(step.target)
      );
      if (!reward) return [];
      const inputToken = tokens.find(
        (token) =>
          normalizeAddress(token.address) === normalizeAddress(step.tokenIn)
      );
      return [{
        activity: reward.activity,
        inputAmount: formatUnits(
          step.amountIn,
          inputToken?.customDecimals ?? 18
        ),
        tokenIn: step.tokenIn,
      }];
    });
  }, [activeQuote, sourceMode, tokens, userRewards]);

  const effectiveMaxSpendableWei =
    sourceMode === "external" ? externalBalance : maxSpendableWei;
  const effectiveMaxTransferableError =
    sourceMode === "external" ? "" : maxTransferableError;
  const insufficientBalance =
    !guestMode && inputAmountWei > effectiveMaxSpendableWei;
  const hasAmount = inputAmountWei > 0n;
  const activeQuoteQuery =
    sourceMode === "external" ? compositeQuoteQuery : quoteQuery;
  const quoteLoading = activeQuoteQuery.isFetching && !activeQuote;
  const routeExecute = useRouteExecute();
  const isTradeDisabled =
    !(sourceMode === "external" ? selectedExternalRoute : liveTokenIn) ||
    !liveTokenOut ||
    !hasAmount ||
    insufficientBalance ||
    !!effectiveMaxTransferableError ||
    quoteLoading ||
    !activeQuote ||
    (sourceMode === "external" &&
      (externalBalanceLoading ||
        !currentNetwork ||
        autoRouteDeposit.connectedChainId !== Number(currentNetwork.chainId)));

  const warnings: string[] = [];
  if (effectiveMaxTransferableError) warnings.push(effectiveMaxTransferableError);
  if (hasAmount && activeQuoteQuery.isError && !activeQuote) {
    warnings.push("No executable route is available for this trade.");
  }
  if (
    sourceMode === "external" &&
    currentNetwork &&
    autoRouteDeposit.connectedChainId !== Number(currentNetwork.chainId)
  ) {
    warnings.push(`Switch your wallet to ${currentNetwork.chainName}.`);
  }

  const handleSwitch = () => {
    if (sourceMode === "external") return;
    dispatch({ type: "SWITCH_TOKENS" });
    dispatch({ type: "RESET_AMOUNTS" });
  };

  const handleMaxClick = () => {
    if (effectiveMaxSpendableWei <= 0n) return;
    dispatch({
      type: "TYPE_AMOUNT",
      field: "input",
      value: formatUnits(
        effectiveMaxSpendableWei.toString(),
        sourceMode === "external"
          ? Number(selectedExternalRoute?.externalDecimals || 18)
          : liveTokenIn?.customDecimals ?? 18
      ),
    });
  };

  const handleTrade = async () => {
    if (!liveTokenOut || !activeQuote) return;
    try {
      if (sourceMode === "external") {
        if (
          !selectedExternalRoute ||
          !currentNetwork ||
          !("bridge" in activeQuote)
        ) {
          return;
        }
        await autoRouteDeposit.execute({
          route: selectedExternalRoute,
          network: currentNetwork,
          amount: typedValue,
          quote: activeQuote,
          outputSymbol: liveTokenOut._symbol,
        });
      } else {
        if (!liveTokenIn) return;
        await routeExecute.mutateAsync({
          tokenIn: liveTokenIn.address,
          tokenOut: liveTokenOut.address,
          amountIn: inputAmountWei.toString(),
          minFinalOut: activeQuote.minFinalOut,
          slippageBps,
        });
      }
      toast({
        title: "Success",
        description: `${
          sourceMode === "external" ? "Bridge route submitted" : "Traded"
        } ${formatAmount(typedValue)} ${
          sourceMode === "external"
            ? selectedExternalRoute?.externalSymbol
            : liveTokenIn?._symbol
        } for ${formatAmount(outputAmount)} ${liveTokenOut._symbol}`,
        variant: "success",
      });
      dispatch({ type: "RESET_AMOUNTS" });
    } finally {
      setIsDialogOpen(false);
      if (sourceMode === "strato") {
        await Promise.all([
          fetchUsdstBalance(),
          fetchTokens(),
          getEarningAssets(false),
          refreshLoans(),
          refreshCollateral(),
        ]);
      }
    }
  };

  const inputError = insufficientBalance ? "Insufficient balance" : undefined;
  const buttonLabel = guestMode
    ? "Sign in to trade"
    : activeQuoteQuery.isError && hasAmount
      ? "No route available"
      : sourceMode === "external"
        ? "Bridge & Trade"
        : "Trade Assets";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
        <Button
          type="button"
          size="sm"
          variant={sourceMode === "strato" ? "default" : "ghost"}
          onClick={() => {
            setSourceMode("strato");
            dispatch({ type: "RESET_AMOUNTS" });
          }}
        >
          STRATO
        </Button>
        <Button
          type="button"
          size="sm"
          variant={sourceMode === "external" ? "default" : "ghost"}
          onClick={() => {
            setSourceMode("external");
            dispatch({ type: "RESET_AMOUNTS" });
          }}
        >
          External Network
        </Button>
      </div>

      {sourceMode === "external" && (
        <label className="block space-y-2 text-sm">
          <span className="text-muted-foreground">Source network</span>
          <select
            className="h-10 w-full rounded-md border border-border bg-background px-3"
            value={selectedNetwork || ""}
            onChange={(event) => {
              setSelectedNetwork(event.target.value);
              setExternalRouteId(undefined);
              dispatch({ type: "RESET_AMOUNTS" });
            }}
          >
            {availableNetworks.map((network) => (
              <option key={network.chainId} value={network.chainName}>
                {network.chainName}
              </option>
            ))}
          </select>
        </label>
      )}

      <TokenInputPanel
        label="From"
        amount={typedValue}
        onChange={(value) =>
          dispatch({ type: "TYPE_AMOUNT", field: "input", value })
        }
        asset={sourceMode === "external" ? liveExternalToken : liveTokenIn}
        onSelect={(token) => {
          if (sourceMode === "external") {
            const route = externalRoutes.find(
              (candidate) =>
                normalizeAddress(candidate.externalToken) ===
                normalizeAddress(token.address)
            );
            setExternalRouteId(route?.id);
          } else {
            dispatch({ type: "SELECT_TOKEN_IN", token });
          }
        }}
        tokens={sourceMode === "external" ? externalTokens : fromOptions}
        userBalanceWei={
          sourceMode === "external"
            ? externalBalance.toString()
            : liveTokenIn?.balance || "0"
        }
        poolBalanceWei="0"
        maxAmountWei={effectiveMaxSpendableWei.toString()}
        isFromInput
        onMaxClick={handleMaxClick}
        amountError={inputError}
        loading={
          sourceMode === "external"
            ? bridgeLoading || externalBalanceLoading
            : allActiveLoading
        }
        showUserBalance={!guestMode}
        showPoolBalance={false}
      />

      <div className="flex justify-center">
        <Button
          onClick={handleSwitch}
          disabled={sourceMode === "external"}
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
      <div className="flex min-h-[18px] items-center">
        {!tokenApysLoaded ? (
          <span className="text-[10px] font-medium text-green-500/40 animate-pulse blur-[2px]">…</span>
        ) : outputApy ? (
          <EarnApyTooltip info={outputApy} side="top" align="start">
            <button
              type="button"
              className="inline-flex items-center gap-0.5 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-500 hover:bg-green-500/20 transition-colors"
              onClick={() => navigate(pathForApyInfo(outputApy))}
            >
              Earn up to {outputApy.total.toFixed(2)}% →
            </button>
          </EarnApyTooltip>
        ) : null}
      </div>
      {rewardedSteps.map(({ activity, inputAmount, tokenIn }) => (
        <RewardsWidget
          key={activity.activityId}
          userRewards={userRewards ?? null}
          activityName={activity.name}
          activityId={activity.activityId}
          inputAmount={inputAmount}
          swapTokenInAddress={tokenIn}
          actionLabel="Trade"
          hideWhenZero
        />
      ))}

      <SwapDetails
        tokenInSymbol={
          sourceMode === "external"
            ? selectedExternalRoute?.externalSymbol || ""
            : liveTokenIn?._symbol || ""
        }
        tokenOutSymbol={liveTokenOut?._symbol || ""}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        priceImpact={priceImpact}
        warnings={warnings}
      >
        {activeQuote && (
          <>
            {sourceMode === "external" && "bridge" in activeQuote && (
              <div className="mb-3 rounded-lg border border-border p-3 text-sm">
                Bridge {selectedExternalRoute?.externalSymbol} from{" "}
                {currentNetwork?.chainName} to{" "}
                {activeQuote.bridge.targetStratoSymbol}
              </div>
            )}
            <RoutePreview
              steps={activeQuote.steps}
              tokens={tokens}
              minFinalOut={activeQuote.minFinalOut}
              outputToken={liveTokenOut}
            />
          </>
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
        fromAsset={
          sourceMode === "external" ? liveExternalToken : liveTokenIn
        }
        toAsset={liveTokenOut}
        exchangeRate={exchangeRate}
        invertedExchangeRate={invertedExchangeRate}
        isHighPriceImpact={(priceImpact ?? 0) >= 5}
        toAmountMin={formatAmount(minFinalOut)}
        onConfirm={handleTrade}
        isLoading={routeExecute.isPending || autoRouteDeposit.isPending}
      />
    </div>
  );
};

export default RouterWidget;
