import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBridgeContext } from "@/context/BridgeContext";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import {
  useRouteAssets,
  useTradeTokens,
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

const RouterWidget = ({ guestMode = false }: { guestMode?: boolean }) => {
  const { toast } = useToast();
  const { isLoggedIn } = useUser();
  const {
    availableNetworks,
    bridgeableTokens,
    selectedNetwork,
    setSelectedNetwork,
    loadNetworksAndTokens,
  } = useBridgeContext();
  const tokensQuery = useTradeTokens();
  const routeAssetsQuery = useRouteAssets();
  const tradeTokens = useMemo(
    () => tokensQuery.data ?? [],
    [tokensQuery.data]
  );
  const routeAssets = useMemo(
    () => [
      ...new Map(
        [
          ...(routeAssetsQuery.data ?? []),
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
        ].map((token) => [token.address, token])
      ).values(),
    ],
    [routeAssetsQuery.data, bridgeableTokens]
  );
  const tokens = useMemo(
    () => [
      ...new Map(
        [...tradeTokens, ...routeAssets].map((token) => [
          token.address,
          token,
        ])
      ).values(),
    ],
    [tradeTokens, routeAssets]
  );
  const [sourceMode, setSourceMode] = useState<"strato" | "external">(
    "strato"
  );
  const [tokenInAddress, setTokenInAddress] = useState("");
  const [tokenOutAddress, setTokenOutAddress] = useState("");
  const [externalRouteId, setExternalRouteId] = useState("");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);

  useEffect(() => {
    void loadNetworksAndTokens();
  }, [loadNetworksAndTokens]);

  const tokenIn =
    tradeTokens.find((token) => token.address === tokenInAddress) ??
    tradeTokens[0];
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

  const handleTrade = async () => {
    if (!quote || !tokenOut || amountWei === "0") return;
    try {
      if (sourceMode === "external") {
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
          onClick={() => setSourceMode("strato")}
        >
          STRATO
        </Button>
        <Button
          type="button"
          variant={sourceMode === "external" ? "default" : "ghost"}
          onClick={() => setSourceMode("external")}
        >
          External network
        </Button>
      </div>

      {sourceMode === "external" && (
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
      )}

      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <label className="mb-2 block text-sm font-semibold">From</label>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 bg-transparent text-2xl outline-none"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
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
            {(sourceMode === "external" ? externalRoutes : tradeTokens).map(
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

      <Button
        className="w-full"
        disabled={
          guestMode ||
          pending ||
          quoteLoading ||
          !quote ||
          amountWei === "0"
        }
        onClick={handleTrade}
      >
        {guestMode
          ? "Sign in to trade"
          : pending
            ? "Submitting..."
            : sourceMode === "external"
              ? "Deposit & Trade"
              : "Trade"}
      </Button>
    </div>
  );
};

export default RouterWidget;
