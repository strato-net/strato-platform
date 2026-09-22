import { useEffect, useMemo, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { ERC20_ABI } from "@/lib/bridge/constants";
import { ArrowDownUp, Globe2, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import {
  TradeBridgeCatalog,
  useRouteAssets,
} from "@/hooks/trade/useTradeTokens";
import { useRouteQuote } from "@/hooks/trade/useRouteQuote";
import { useCompositeRouteQuote } from "@/hooks/trade/useCompositeRouteQuote";
import { useRouteExecute } from "@/hooks/trade/useRouteExecute";
import { useAutoRouteDeposit } from "@/hooks/trade/useAutoRouteDeposit";
import {
  formatAmount,
  formatUnits,
  safeParseUnits,
  ensureHexPrefix,
} from "@/utils/numberUtils";
import RoutePreview from "./RoutePreview";
import { useTokenContext } from "@/context/TokenContext";
import { SWAP_FEE, usdstAddress } from "@/lib/constants";
import { handleAmountInputChange } from "@/utils/transferValidation";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { UserRewardsData } from "@/services/rewardsService";

const RouterWidget = ({
  guestMode = false,
  onTransactionSubmitted,
  onPairChange,
  userRewards,
  bridgeCatalog,
}: {
  guestMode?: boolean;
  onTransactionSubmitted?: () => void;
  onPairChange?: (tokenIn?: string, tokenOut?: string) => void;
  userRewards?: UserRewardsData | null;
  bridgeCatalog: TradeBridgeCatalog;
}) => {
  const { toast } = useToast();
  const { isLoggedIn, externalEvmWalletAddress, isExternalEvmWalletConnected } = useUser();
  const { usdstBalance, voucherBalance, loadingUsdstBalance } =
    useTokenContext();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
  } = bridgeCatalog;
  const routeAssetsQuery = useRouteAssets();
  const routeAssets = useMemo(
    () => [
      ...new Map(
        [
          ...bridgeableTokens
            .filter(
              (route) => route.routeType === "standard" && route.depositsEnabled
            )
            .map((route) => ({
              address: route.stratoToken,
              _name: route.stratoTokenName,
              _symbol: route.stratoTokenSymbol,
              customDecimals: 18,
              _totalSupply: "0",
              balance: "0",
              price: "0",
              poolBalance: "0",
              routableSource: false,
              images: route.stratoTokenImage
                ? [{ value: route.stratoTokenImage }]
                : [],
            })),
          ...(routeAssetsQuery.data ?? []),
        ].map((token) => [token.address, token])
      ).values(),
    ],
    [routeAssetsQuery.data, bridgeableTokens]
  );
  const tokens = routeAssets;
  const routeSources = useMemo(
    () => routeAssets.filter((token) => token.routableSource),
    [routeAssets]
  );
  const [sourceMode, setSourceMode] = useState<"strato" | "external">(
    "strato"
  );
  const [tokenInAddress, setTokenInAddress] = useState("");
  const [tokenOutAddress, setTokenOutAddress] = useState("");
  const [externalRouteId, setExternalRouteId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  const tokenIn =
    routeSources.find((token) => token.address === tokenInAddress) ??
    routeSources[0];
  const tokenOut =
    routeAssets.find((token) => token.address === tokenOutAddress) ??
    routeAssets.find((token) => token.address !== tokenIn?.address);
  const network =
    availableNetworks.find(({ chainName }) => chainName === selectedNetwork) ??
    availableNetworks[0];
  const externalRoutes = bridgeableTokens.filter(
    (route) => route.routeType === "standard" && route.depositsEnabled
  );
  const externalRoute =
    externalRoutes.find((route) => route.id === externalRouteId) ??
    externalRoutes[0];

  useEffect(() => {
    onPairChange?.(
      sourceMode === "strato" ? tokenIn?.address : undefined,
      sourceMode === "strato" ? tokenOut?.address : undefined
    );
  }, [onPairChange, sourceMode, tokenIn?.address, tokenOut?.address]);

  const inputDecimals =
    sourceMode === "external"
      ? Number(externalRoute?.externalDecimals ?? 18)
      : tokenIn?.customDecimals ?? 18;
  const externalChainId = Number(network?.chainId);
  const balanceChainId = Number.isSafeInteger(externalChainId) && externalChainId > 0
    ? externalChainId
    : undefined;
  const externalAddress = ensureHexPrefix(externalEvmWalletAddress);
  const isNativeInput = !!externalRoute && BigInt(externalRoute.externalToken) === 0n;
  const balanceEnabled = sourceMode === "external" && isExternalEvmWalletConnected &&
    !!externalAddress && !!balanceChainId && !!externalRoute;
  const nativeBalance = useBalance({
    address: externalAddress,
    chainId: balanceChainId,
    query: { enabled: balanceEnabled && isNativeInput, refetchInterval: 15000 },
  });
  const tokenBalance = useReadContract({
    address: ensureHexPrefix(externalRoute?.externalToken),
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: externalAddress ? [externalAddress] : undefined,
    chainId: balanceChainId,
    query: { enabled: balanceEnabled && !isNativeInput, refetchInterval: 15000 },
  });
  const externalBalance = balanceEnabled
    ? isNativeInput ? nativeBalance.data?.value : tokenBalance.data as bigint | undefined
    : undefined;
  const externalBalanceQuery = isNativeInput ? nativeBalance : tokenBalance;
  const amountWei = useMemo(() => {
    if (!amount) return "0";
    try {
      return safeParseUnits(amount, inputDecimals).toString();
    } catch {
      return "0";
    }
  }, [amount, inputDecimals]);
  const routeFeeWei = safeParseUnits(SWAP_FEE);
  const externalBalanceError = sourceMode === "external" && externalBalance !== undefined &&
    BigInt(amountWei) > externalBalance ? "Insufficient external token balance" : "";
  const availableFees = BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0");
  const feeError =
    !guestMode &&
    sourceMode === "strato" &&
    !loadingUsdstBalance &&
    availableFees < routeFeeWei
      ? "Insufficient USDST + voucher balance for two transaction fees"
      : "";
  const inputBalance = BigInt(tokenIn?.balance || "0");
  const usdFeePortion =
    routeFeeWei > BigInt(voucherBalance || "0")
      ? routeFeeWei - BigInt(voucherBalance || "0")
      : 0n;
  const maxSpendableWei =
    tokenIn?.address.toLowerCase() === usdstAddress.toLowerCase()
      ? inputBalance > usdFeePortion
        ? (inputBalance - usdFeePortion).toString()
        : "0"
      : inputBalance.toString();

  const routeQuote = useRouteQuote({
    tokenIn: sourceMode === "strato" ? tokenIn?.address : undefined,
    tokenOut: sourceMode === "strato" ? tokenOut?.address : undefined,
    amountWei: sourceMode === "strato" ? amountWei : undefined,
    slippageBps,
  });
  const compositeQuote = useCompositeRouteQuote({
    externalChainId:
      sourceMode === "external" ? network?.chainId : undefined,
    externalToken:
      sourceMode === "external" ? externalRoute?.externalToken : undefined,
    targetStratoToken:
      sourceMode === "external" ? externalRoute?.stratoToken : undefined,
    tokenOut: sourceMode === "external" ? tokenOut?.address : undefined,
    amountWei: sourceMode === "external" ? amountWei : undefined,
    slippageBps,
  });
  const quote =
    sourceMode === "external" ? compositeQuote.data : routeQuote.data;
  const quoteLoading =
    sourceMode === "external"
      ? compositeQuote.isFetching
      : routeQuote.isFetching;
  const quoteError =
    sourceMode === "external"
      ? compositeQuote.error
      : routeQuote.error;
  const routeExecute = useRouteExecute();
  const autoRouteDeposit = useAutoRouteDeposit();
  const pending = routeExecute.isPending || autoRouteDeposit.isPending;
  const rewardedRouteSteps = useMemo(() => {
    if (sourceMode !== "strato" || !quote || !userRewards) return [];
    const seen = new Set<string>();
    return quote.steps.flatMap((step) => {
      if (step.action < 1 || step.action > 3) return [];
      const target = step.target.toLowerCase().replace(/^0x/, "");
      if (seen.has(target)) return [];
      const activity = userRewards.activities.find(
        (item) =>
          item.activity.sourceContract?.toLowerCase().replace(/^0x/, "") ===
          target
      );
      if (!activity) return [];
      seen.add(target);
      const stepInputToken = tokens.find(
        (token) =>
          token.address.toLowerCase().replace(/^0x/, "") ===
          step.tokenIn.toLowerCase().replace(/^0x/, "")
      );
      return [{
        activity,
        inputAmount: formatUnits(
          step.amountIn,
          stepInputToken?.customDecimals ?? 18
        ),
        tokenIn: step.tokenIn,
      }];
    });
  }, [sourceMode, quote, userRewards, tokens]);

  const handleTrade = async () => {
    if (!quote || quoteLoading || pending || !tokenOut || amountWei === "0" || externalBalanceError) return;
    try {
      if (sourceMode === "external") {
        if (!externalRoute || !network || !compositeQuote.data) return;
        await autoRouteDeposit.execute({
          route: externalRoute,
          network,
          amount,
          quote: compositeQuote.data,
          outputSymbol: tokenOut._symbol,
          outputAddress: tokenOut.address,
          slippageBps,
        });
        toast({
          title: "Deposit submitted",
          description:
            compositeQuote.data.depositAction.action ===
            4
              ? `Your deposit will settle into ${tokenOut._symbol}, or fall back to ${externalRoute.stratoTokenSymbol} if the minimum cannot be met.`
              : `Your deposit will settle as ${externalRoute.stratoTokenSymbol}.`,
          variant: "success",
        });
      } else {
        if (!tokenIn || !isLoggedIn) return;
        await routeExecute.mutateAsync({
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: amountWei,
          minFinalOut: quote.minFinalOut,
          slippageBps,
        });
        toast({
          title: "Trade submitted",
          description: `Trading ${amount} ${tokenIn._symbol} for ${tokenOut._symbol}.`,
          variant: "success",
        });
      }
      onTransactionSubmitted?.();
      if (balanceEnabled) void externalBalanceQuery.refetch();
      setAmount("");
    } catch (error) {
      toast({
        title: "Transaction failed",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 rounded-xl border border-border/60 bg-muted/60 p-1.5">
        <Button
          type="button"
          variant={sourceMode === "strato" ? "default" : "ghost"}
          className="h-11 gap-2 rounded-lg"
          onClick={() => {
            setSourceMode("strato");
            setAmount("");
            setAmountError("");
          }}
        >
          <Layers3 className="h-4 w-4" />
          Trade on STRATO
        </Button>
        <Button
          type="button"
          variant={sourceMode === "external" ? "default" : "ghost"}
          className="h-11 gap-2 rounded-lg"
          onClick={() => {
            setSourceMode("external");
            setAmount("");
            setAmountError("");
          }}
        >
          <Globe2 className="h-4 w-4" />
          Deposit from external
        </Button>
      </div>

      {sourceMode === "external" && (
        <div className="space-y-3">
          <BridgeWalletStatus
            guestMode={guestMode}
            externalOnly
            connectedLabel="External Wallet"
            connectLabel="Connect External Wallet"
            copiedDescription="External wallet address copied to clipboard"
          />
          <select
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium"
            value={network?.chainName ?? ""}
            onChange={(event) => {
              setExternalRouteId("");
              setAmount("");
              setAmountError("");
              setSelectedNetwork(event.target.value);
            }}
          >
            {availableNetworks.map((item) => (
              <option key={item.chainId} value={item.chainName}>
                {item.chainName}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 transition-colors focus-within:border-primary/40 focus-within:bg-muted/50">
        <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You pay
        </label>
        <div className="flex items-center gap-3">
          <input
            className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(event) =>
              sourceMode === "strato"
                ? handleAmountInputChange(
                    event.target.value,
                    setAmount,
                    setAmountError,
                    maxSpendableWei,
                    inputDecimals
                  )
                : setAmount(event.target.value)
            }
          />
          <select
            className="h-11 max-w-[45%] rounded-full border border-input bg-background px-3 text-sm font-semibold"
            value={
              sourceMode === "external"
                ? externalRoute?.id ?? ""
                : tokenIn?.address ?? ""
            }
            onChange={(event) =>
              sourceMode === "external"
                ? setExternalRouteId(event.target.value)
                : setTokenInAddress(event.target.value)
            }
          >
            {(sourceMode === "external" ? externalRoutes : routeSources).map(
              (item) => (
                <option
                  key={item.id ?? item.address}
                  value={item.id ?? item.address}
                >
                  {"externalSymbol" in item
                    ? item.externalSymbol
                    : item._symbol}
                </option>
              )
            )}
          </select>
        </div>
        {sourceMode === "strato" && tokenIn && (
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Available:{" "}
              {formatAmount(
                formatUnits(maxSpendableWei, tokenIn.customDecimals)
              )}{" "}
              {tokenIn._symbol}
            </span>
            <button
              type="button"
              className="font-semibold text-primary"
              onClick={() => {
                setAmount(
                  formatUnits(maxSpendableWei, tokenIn.customDecimals)
                );
                setAmountError("");
              }}
            >
              Max
            </button>
          </div>
        )}
        {sourceMode === "external" && externalRoute && (
          <div className="mt-2 text-xs text-muted-foreground">
            {!isExternalEvmWalletConnected
              ? "Connect an external wallet to see your balance"
              : externalBalanceQuery.isError
                ? "Balance unavailable"
                : externalBalance === undefined
                  ? "Loading balance..."
                  : `Available: ${formatAmount(formatUnits(externalBalance.toString(), inputDecimals))} ${externalRoute.externalSymbol}`}
          </div>
        )}
      </div>

      <div className="relative z-10 -my-7 flex justify-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-card bg-primary text-primary-foreground shadow-md">
          <ArrowDownUp className="h-4 w-4" />
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
        <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You receive
        </label>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1 text-3xl font-semibold tracking-tight">
            {quote
              ? formatAmount(
                  formatUnits(
                    quote.amountOut,
                    tokenOut?.customDecimals ?? 18
                  )
                )
              : "0"}
          </div>
          <select
            className="h-11 max-w-[45%] rounded-full border border-input bg-background px-3 text-sm font-semibold"
            value={tokenOut?.address ?? ""}
            onChange={(event) => setTokenOutAddress(event.target.value)}
          >
            {routeAssets
              .filter(
                (token) =>
                  sourceMode === "external" ||
                  token.address !== tokenIn?.address
              )
              .map((token) => (
                <option key={token.address} value={token.address}>
                  {token._symbol}
                </option>
              ))}
          </select>
        </div>
      </div>

      <label className="flex items-center justify-between rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm">
        <span className="text-muted-foreground">Slippage tolerance</span>
        <select
          className="rounded-md border-0 bg-muted px-2 py-1 font-medium outline-none"
          value={slippageBps}
          onChange={(event) => setSlippageBps(Number(event.target.value))}
        >
          <option value={25}>0.25%</option>
          <option value={50}>0.5%</option>
          <option value={100}>1%</option>
        </select>
      </label>

      {quote?.steps.length ? (
        <RoutePreview
          steps={quote.steps}
          tokens={tokens}
          minFinalOut={quote.minFinalOut}
          outputToken={tokenOut}
        />
      ) : null}
      {rewardedRouteSteps.map(({ activity, inputAmount, tokenIn }) => (
        <RewardsWidget
          key={activity.activityId}
          userRewards={{ ...userRewards!, activities: [activity] }}
          activityName={activity.activity.name}
          inputAmount={inputAmount}
          swapTokenInAddress={tokenIn}
          actionLabel="Trade"
          hideWhenZero
        />
      ))}
      {sourceMode === "external" &&
        compositeQuote.data?.depositAction.action === 4 &&
        externalRoute && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
            If the STRATO route is unavailable or cannot meet your minimum,
            you will receive{" "}
            {formatAmount(
              formatUnits(compositeQuote.data.bridge.bridgedAmount, 18)
            )}{" "}
            {externalRoute.stratoTokenSymbol} instead.
          </p>
        )}
      {quoteError && amountWei !== "0" && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {(quoteError as Error).message}
        </p>
      )}
      {(amountError || feeError || externalBalanceError) && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          {amountError || feeError || externalBalanceError}
        </p>
      )}
      {!amount && !guestMode && (
        <p className="text-center text-xs text-muted-foreground">
          Enter an amount to preview the route and minimum received.
        </p>
      )}

      <Button
        className="h-12 w-full rounded-xl text-sm font-semibold shadow-sm"
        disabled={
          guestMode ||
          pending ||
          quoteLoading ||
          !quote ||
          !!amountError ||
          !!feeError ||
          !!externalBalanceError ||
          (sourceMode === "external" && !isExternalEvmWalletConnected) ||
          amountWei === "0"
        }
        onClick={handleTrade}
      >
        {guestMode
          ? "Sign in to trade"
          : pending
            ? "Submitting..."
            : sourceMode === "external" && !isExternalEvmWalletConnected
              ? "Connect external wallet"
            : sourceMode === "external"
              ? "Deposit & Trade"
              : "Trade"}
      </Button>
    </div>
  );
};

export default RouterWidget;
