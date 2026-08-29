import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import {
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
} from "@/utils/numberUtils";
import RoutePreview from "./RoutePreview";
import { useTokenContext } from "@/context/TokenContext";
import { SWAP_FEE, usdstAddress } from "@/lib/constants";
import { handleAmountInputChange } from "@/utils/transferValidation";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import PairSwapHistory from "./PairSwapHistory";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { UserRewardsData } from "@/services/rewardsService";

const RouterWidget = ({
  guestMode = false,
  onTransactionSubmitted,
  userRewards,
}: {
  guestMode?: boolean;
  onTransactionSubmitted?: () => void;
  userRewards?: UserRewardsData | null;
}) => {
  const { toast } = useToast();
  const { isLoggedIn, isAppAuthenticated } = useUser();
  const { usdstBalance, voucherBalance, loadingUsdstBalance } =
    useTokenContext();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    loadNetworksAndTokens,
  } = useBridgeContext();
  const routeAssetsQuery = useRouteAssets();
  const routeAssets = useMemo(
    () => [
      ...new Map(
        [
          ...bridgeableTokens
            .filter(
              (route) => route.routeType === "standard" && route.enabled
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

  useEffect(() => {
    void loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

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
    (route) => route.routeType === "standard" && route.enabled
  );
  const externalRoute =
    externalRoutes.find((route) => route.id === externalRouteId) ??
    externalRoutes[0];
  const inputDecimals =
    sourceMode === "external"
      ? Number(externalRoute?.externalDecimals ?? 18)
      : tokenIn?.customDecimals ?? 18;
  const amountWei = useMemo(() => {
    if (!amount) return "0";
    try {
      return safeParseUnits(amount, inputDecimals).toString();
    } catch {
      return "0";
    }
  }, [amount, inputDecimals]);
  const routeFeeWei = safeParseUnits(SWAP_FEE);
  const availableFees = BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0");
  const feeError =
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
    if (!quote || !tokenOut || amountWei === "0") return;
    try {
      if (sourceMode === "external") {
        if (!isAppAuthenticated) {
          throw new Error("Sign in to STRATO before bridging assets");
        }
        if (!externalRoute || !network || !compositeQuote.data) return;
        await autoRouteDeposit.execute({
          route: externalRoute,
          network,
          amount,
          quote: compositeQuote.data,
          outputSymbol: tokenOut._symbol,
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-lg bg-muted p-1">
        <Button
          type="button"
          variant={sourceMode === "strato" ? "default" : "ghost"}
          onClick={() => {
            setSourceMode("strato");
            setAmount("");
            setAmountError("");
          }}
        >
          STRATO
        </Button>
        <Button
          type="button"
          variant={sourceMode === "external" ? "default" : "ghost"}
          onClick={() => {
            setSourceMode("external");
            setAmount("");
            setAmountError("");
          }}
        >
          External network
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
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            value={network?.chainName ?? ""}
            onChange={(event) => {
              setExternalRouteId("");
              void setSelectedNetwork(event.target.value);
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

      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <label className="mb-2 block text-sm font-semibold">From</label>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 bg-transparent text-2xl outline-none"
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
            className="rounded-md border border-input bg-background px-2"
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
                formatUnits(maxSpendableWei, tokenIn.customDecimals),
                6
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
      </div>

      <div className="flex justify-center">
        <ArrowDownUp className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <label className="mb-2 block text-sm font-semibold">To</label>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 text-2xl">
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
            className="rounded-md border border-input bg-background px-2"
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

      <label className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Slippage</span>
        <select
          className="rounded-md border border-input bg-background px-2 py-1"
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
              formatUnits(compositeQuote.data.bridge.bridgedAmount, 18),
              6
            )}{" "}
            {externalRoute.stratoTokenSymbol} instead.
          </p>
        )}
      {quoteError && amountWei !== "0" && (
        <p className="text-sm text-destructive">
          {(quoteError as Error).message}
        </p>
      )}
      {(amountError || feeError) && (
        <p className="text-sm text-destructive">{amountError || feeError}</p>
      )}

      <Button
        className="w-full"
        disabled={
          guestMode ||
          pending ||
          quoteLoading ||
          !quote ||
          !!amountError ||
          !!feeError ||
          (sourceMode === "external" && !isAppAuthenticated) ||
          amountWei === "0"
        }
        onClick={handleTrade}
      >
        {guestMode
          ? "Sign in to trade"
          : pending
            ? "Submitting..."
            : sourceMode === "external" && !isAppAuthenticated
              ? "Sign in to STRATO"
            : sourceMode === "external"
              ? "Deposit & Trade"
              : "Trade"}
      </Button>
      {sourceMode === "strato" && (
        <PairSwapHistory
          tokenIn={tokenIn?.address}
          tokenOut={tokenOut?.address}
        />
      )}
    </div>
  );
};

export default RouterWidget;
