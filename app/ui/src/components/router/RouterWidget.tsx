import CopyButton from "@/components/ui/copy";
import { useMemo, useRef, useState } from "react";
import { useBalance, useReadContracts } from "wagmi";
import { maxUint256 } from "viem";
import { ERC20_ABI } from "@/lib/bridge/constants";
import { ArrowDownUp, Globe2, Layers3, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import {
  TradeBridgeCatalog,
  useFeeBalancesReady,
  useRouteAssets,
  useRoutePoolTokens,
  useRouteDepositConfig,
  useRouteMetals,
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
  truncateAddress,
  formatTokenUsd,
} from "@/utils/numberUtils";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/axios";
import { useOracleContext } from "@/context/OracleContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { requestWalletConnection } from "@/lib/auth";
import RouteTokenPicker from "./RouteTokenPicker";
import RouteReceivePanel from "./RouteReceivePanel";
import RouteTradeSummary, { RouteFallback } from "./RouteTradeSummary";
import RoutePreview from "./RoutePreview";
import RouteConfirmDialog from "./RouteConfirmDialog";
import RouteProgressDialog from "./RouteProgressDialog";
import { Link } from "react-router-dom";
import type { RouteConfirmation, RoutePickerToken } from "@/interface/swap";
import { assertRouteConfirmation, getRouteActionLabel, normalizeRouteAddress, resolveRouteSelection } from "@/lib/route";
import { useTokenContext } from "@/context/TokenContext";
import { LOW_USDST_THRESHOLD, SWAP_FEE, usdstAddress } from "@/lib/constants";
import { handleAmountInputChange } from "@/utils/transferValidation";
import BridgeWalletStatus from "@/components/bridge/BridgeWalletStatus";
import { RewardsWidget } from "@/components/rewards/RewardsWidget";
import { UserRewardsData } from "@/services/rewardsService";
import { getFriendlyMessage, getQuoteErrorMessage, normalizeError } from "@/lib/bridge/utils";

const RouterWidget = ({
  guestMode = false,
  onTransactionSubmitted,
  userRewards,
  bridgeCatalog,
  initialTokenIn = "",
  initialTokenOut = "",
  initialPool = "",
}: {
  guestMode?: boolean;
  onTransactionSubmitted?: () => void;
  userRewards?: UserRewardsData | null;
  bridgeCatalog: TradeBridgeCatalog;
  initialTokenIn?: string;
  initialTokenOut?: string;
  initialPool?: string;
}) => {
  const { toast } = useToast();
  const { isLoggedIn, isAppAuthenticated, stratoAddress, userAddress, externalEvmWalletAddress, isExternalEvmWalletConnected } = useUser();
  const { usdstBalance, voucherBalance, usdstBalanceError, fetchUsdstBalance, getEarningAssets } =
    useTokenContext();
  const { fetchTokens } = useUserTokens();
  const { prices } = useOracleContext();
  const metalsQuery = useRouteMetals();
  const publicPrices = useQuery({
    queryKey: ["trade", "oracle-prices"],
    queryFn: async ({ signal }) => (await api.get<Array<{ asset: string; price: string }>>("/oracle/price", { signal })).data,
    enabled: !isLoggedIn,
    staleTime: 30_000,
    retry: 1,
  });
  const priceMap = useMemo(() => new Map(
    (isLoggedIn ? Object.entries(prices) : (publicPrices.data ?? []).map(item => [item.asset, item.price]))
      .map(([address, price]) => [normalizeRouteAddress(address), price])
  ), [isLoggedIn, prices, publicPrices.data]);
  const feeBalancesReady = useFeeBalancesReady();
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
              (route) => route.enabled && (route.routeType === "native"
                ? !route.depositsPaused && !route.depositsDisabled && !!route.externalBridge
                : route.depositsEnabled)
            )
            .map((route) => ({
              address: route.stratoToken,
              _name: route.stratoTokenName,
              _symbol: route.stratoTokenSymbol,
              customDecimals: route.stratoTokenDecimals ?? 18,
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
        ].map((token) => {
          const address = token.address.toLowerCase().replace(/^0x/, "");
          return [address, { ...token, address }];
        })
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
    initialTokenIn || initialTokenOut || initialPool ? "strato" : "external"
  );
  const [tokenInAddress, setTokenInAddress] = useState("");
  const [tokenOutAddress, setTokenOutAddress] = useState("");
  const [externalRouteId, setExternalRouteId] = useState("");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [confirmation, setConfirmation] = useState<RouteConfirmation | null>(null);
  const confirming = useRef(false);

  const poolAddress = normalizeRouteAddress(initialPool);
  const needsPool = !!initialPool && !(initialTokenIn && initialTokenOut);
  const poolTokensQuery = useRoutePoolTokens(needsPool && /^[0-9a-f]{40}$/.test(poolAddress) ? poolAddress : undefined);
  const selection = resolveRouteSelection(routeSources, routeAssets,
    tokenInAddress || initialTokenIn, tokenOutAddress || initialTokenOut, poolTokensQuery.data);
  const resolvingPool = needsPool && poolTokensQuery.isFetching && !poolTokensQuery.data;
  const tokenIn = resolvingPool ? undefined : selection.tokenIn;
  const selectionError = sourceMode === "strato" && !routeAssetsQuery.isLoading ? selection.error : undefined;
  const poolLinkError = needsPool && !resolvingPool && !poolTokensQuery.data?.length
    ? "The linked pool is unavailable. Choose the tokens you want to trade." : undefined;
  const network =
    availableNetworks.find(({ chainName }) => chainName === selectedNetwork) ??
    availableNetworks[0];
  const externalRoutes = bridgeableTokens.filter(
    (route) => route.enabled && (route.routeType === "native"
      ? !route.depositsPaused && !route.depositsDisabled && !!route.externalBridge
      : route.depositsEnabled)
  );
  const externalRoute =
    externalRoutes.find((route) => route.id === externalRouteId) ??
    externalRoutes[0];
  const nativeRedemption = sourceMode === "external" && externalRoute?.routeType === "native";
  const tokenOut = resolvingPool ? undefined : selection.tokenOut;
  const bridgedToken = routeAssetsQuery.data?.find((token) =>
    ensureHexPrefix(token.address)?.toLowerCase() === ensureHexPrefix(externalRoute?.stratoToken)?.toLowerCase()
  );

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
    query: { enabled: balanceEnabled, refetchInterval: 15000 },
  });
  const tokenBalance = useReadContracts({
    contracts: externalRoutes.filter(route => BigInt(route.externalToken) !== 0n).map(route => ({
      address: ensureHexPrefix(route.externalToken), abi: ERC20_ABI,
      functionName: "balanceOf", args: externalAddress ? [externalAddress] : undefined,
      chainId: balanceChainId,
    })),
    query: { enabled: balanceEnabled, refetchInterval: 15000 },
  });
  const externalTokenBalances = new Map(externalRoutes.filter(route => BigInt(route.externalToken) !== 0n).map((route, index) => [route.id, tokenBalance.data?.[index]?.result as bigint | undefined]));
  const externalBalance = balanceEnabled
    ? isNativeInput ? nativeBalance.data?.value : externalTokenBalances.get(externalRoute!.id)
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
  const depositConfig = useRouteDepositConfig(network, externalRoute, sourceMode === "external" && !nativeRedemption);
  const depositConfigReady = nativeRedemption ? !!externalRoute?.externalBridge : !!depositConfig.data && !depositConfig.isError;
  const minDepositError = sourceMode !== "external" ? "" : network && (!balanceChainId || !(nativeRedemption ? externalRoute?.externalBridge : network.depositRouter))
    ? "Deposits are unavailable on this network." : nativeRedemption ? "" : depositConfig.isError
    ? "Deposit limits unavailable. Retry before depositing."
    : depositConfig.data && !depositConfig.data.isPermitted ? "This token is not permitted for deposits."
    : depositConfig.data && BigInt(amountWei) > 0n && BigInt(amountWei) < BigInt(depositConfig.data.minAmount)
      ? `Minimum deposit is ${formatUnits(depositConfig.data.minAmount, inputDecimals)} ${externalRoute?.externalSymbol}` : "";
  const pickerTokens: RoutePickerToken[] = tokens.map(token => {
    const metal = metalsQuery.data?.metals.find(item => normalizeRouteAddress(item.address) === token.address);
    return { id: token.address, address: token.address, symbol: token._symbol, name: token._name,
      image: token.images?.[0]?.value ?? metal?.imageUrl, decimals: token.customDecimals ?? 18,
      balance: isLoggedIn ? token.balance : undefined, price: metal?.price ?? priceMap.get(token.address) ?? token.price,
      metalFeeBps: metal?.feeBps, routeDestination: token.routeDestination };
  });
  const externalPickerTokens: RoutePickerToken[] = externalRoutes.map(route => ({
    id: route.id, address: route.externalToken, symbol: route.externalSymbol, name: route.externalName,
    image: route.stratoTokenImage, decimals: Number(route.externalDecimals),
    balance: balanceEnabled ? (BigInt(route.externalToken) === 0n ? nativeBalance.data?.value : externalTokenBalances.get(route.id))?.toString() : undefined,
    price: !route.rebaseFactor ? priceMap.get(normalizeRouteAddress(route.stratoToken)) : undefined,
    detail: `Deposits as ${route.stratoTokenSymbol}`,
  }));
  const routeFeeWei = safeParseUnits(SWAP_FEE);
  const externalBalanceError = sourceMode === "external" && externalBalance !== undefined &&
    (BigInt(amountWei) > externalBalance || (isNativeInput && BigInt(amountWei) > 0n && BigInt(amountWei) === externalBalance))
      ? isNativeInput ? "Leave enough native currency to cover gas fees" : "Insufficient external token balance" : "";
  const availableFees = BigInt(usdstBalance || "0") + BigInt(voucherBalance || "0");
  const feeError =
    !guestMode &&
    sourceMode === "strato"
      ? usdstBalanceError || (feeBalancesReady && availableFees < routeFeeWei
        ? `You need ${SWAP_FEE} USDST for fees; you have ${formatUnits(availableFees)} including vouchers.`
        : "")
      : "";
  const lowFeeBalance = !guestMode && sourceMode === "strato" && feeBalancesReady && availableFees <= safeParseUnits(LOW_USDST_THRESHOLD);
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
  const quoteFetching = sourceMode === "external" ? compositeQuote.isFetching : routeQuote.isFetching;
  const quoteError = sourceMode === "external" ? compositeQuote.error : routeQuote.error;
  const quoteLoading = !quote && amountWei !== "0" && !quoteError;
  const routeExecute = useRouteExecute();
  const autoRouteDeposit = useAutoRouteDeposit();
  const pending = routeExecute.isPending || autoRouteDeposit.isPending;
  const recipient = sourceMode === "external"
    ? isAppAuthenticated ? stratoAddress : externalEvmWalletAddress
    : userAddress;
  const selectionKey = JSON.stringify([
    sourceMode, sourceMode === "external" ? externalRoute?.externalToken : tokenIn?.address, tokenOut?.address, amountWei, slippageBps,
    sourceMode === "external" ? [network?.chainId, externalRoute?.id, externalRoute?.externalToken, externalRoute?.stratoToken, externalRoute?.externalBridge] : null,
    recipient, userAddress, externalEvmWalletAddress, isAppAuthenticated,
  ]);
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

  const inputSymbol = sourceMode === "external" ? externalRoute?.externalSymbol : tokenIn?._symbol;
  const inputPrice = sourceMode === "external" ? externalPickerTokens.find(token => token.id === externalRoute?.id)?.price : pickerTokens.find(token => token.id === tokenIn?.address)?.price;
  const outputPrice = pickerTokens.find(token => token.id === tokenOut?.address)?.price;
  const inputUsd = formatTokenUsd(amountWei, inputDecimals, inputPrice);
  const outputUsd = quote ? formatTokenUsd(quote.amountOut, tokenOut?.customDecimals ?? 18, outputPrice) : null;
  const flipTokens = () => {
    if (sourceMode !== "strato" || !tokenIn || !tokenOut || !routeSources.some(token => token.address === tokenOut.address)) return;
    setTokenInAddress(tokenOut.address);
    setTokenOutAddress(tokenIn.address);
    setAmount("");
    setAmountError("");
  };

  const reviewTrade = () => {
    if (!quote || quoteLoading || pending || guestMode || !recipient || !tokenOut || amountWei === "0" || amountError || feeError || externalBalanceError || minDepositError || selectionError) return;
    if (sourceMode === "strato" ? !tokenIn || !feeBalancesReady : !externalRoute || !network || !isExternalEvmWalletConnected || !depositConfigReady) return;
    const reviewed = structuredClone({
      selectionKey, quote, inputSymbol: sourceMode === "external" ? externalRoute!.externalSymbol : tokenIn!._symbol,
      inputDecimals, inputAmount: amountWei, outputToken: tokenOut, tokens, recipient,
      networkName: sourceMode === "external" ? network!.chainName : "STRATO",
    });
    try {
      assertRouteConfirmation(reviewed, selectionKey);
      setConfirmation(reviewed);
    } catch (error) {
      toast({ title: "Quote unavailable", description: getFriendlyMessage((error as Error).message), variant: "destructive" });
    }
  };

  const handleTrade = async () => {
    if (!confirmation || confirming.current || pending) return;
    confirming.current = true;
    let tradeExecutionStarted = false;
    try {
      assertRouteConfirmation(confirmation, selectionKey);
      if (!tokenOut || amountWei === "0" || amountError || feeError || externalBalanceError || minDepositError || selectionError) {
        toast({ title: "Quote unavailable", description: feeError || amountError || externalBalanceError || minDepositError || selectionError || "Review your trade and request a new quote.", variant: "destructive" });
        return;
      }
      const quote = confirmation.quote;
      if (sourceMode === "external") {
        if (!externalRoute || !network || !depositConfigReady || !("bridge" in quote)) return;
        const result = await autoRouteDeposit.execute({
          route: externalRoute,
          network,
          amount,
          quote,
          outputSymbol: tokenOut._symbol,
          outputAddress: tokenOut.address,
          slippageBps,
        });
        if (result.status === "pending") {
          toast({
            title: result.type === "approval" ? "Approval still pending" : "Deposit still pending",
            description: `Confirmation is unavailable — do not resubmit. ${result.type === "approval" ? "No deposit has been sent. " : ""}Transaction: ${result.txHash}`,
            duration: Infinity,
            className: "[overflow-wrap:anywhere]",
          });
          if (result.type === "approval") return;
        } else {
          toast({
            title: "Deposit submitted",
            description:
              quote.depositAction.action ===
              4
                ? `Your deposit will settle into ${tokenOut._symbol}, or fall back to ${externalRoute.stratoTokenSymbol} if the minimum cannot be met.`
                : `Your deposit will settle as ${externalRoute.stratoTokenSymbol}.`,
            variant: "success",
          });
        }
      } else {
        if (!tokenIn || !isLoggedIn || !feeBalancesReady) return;
        tradeExecutionStarted = true;
        try {
          await routeExecute.mutateAsync({
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountIn: amountWei,
            minFinalOut: quote.minFinalOut,
            slippageBps,
            recipient: confirmation.recipient,
          });
        } finally {
          void fetchUsdstBalance();
          void fetchTokens();
          void getEarningAssets(false);
        }
      }
      onTransactionSubmitted?.();
      if (balanceEnabled) void externalBalanceQuery.refetch();
      setAmount("");
    } catch (error) {
      if (tradeExecutionStarted) return;
      if ((error as { toastShown?: boolean })?.toastShown) return;
      const normalized = normalizeError(error);
      toast({
        title: "Transaction failed",
        description: normalized.code === "UNKNOWN_ERROR" ? getFriendlyMessage(normalized.message) : normalized.userMessage,
        variant: "destructive",
      });
    } finally {
      confirming.current = false;
      setConfirmation(null);
    }
  };

  return (
    <div className="space-y-7">
      <RouteConfirmDialog confirmation={routeExecute.progress ? null : confirmation} pending={pending} stage={autoRouteDeposit.stage} onClose={() => setConfirmation(null)} onConfirm={handleTrade} />
      <RouteProgressDialog progress={routeExecute.progress} onClose={routeExecute.closeProgress} />
      {/* STEP 1 */}
      <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">1</span>
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">How Are You Trading?</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={pending || bridgeCatalog.loading}
          onClick={() => {
            setSourceMode("external");
            setAmount("");
            setAmountError("");
          }}
          className={`relative rounded-md border-2 p-3 text-left transition-colors ${
            sourceMode === "external"
              ? "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10"
              : "border-border hover:bg-muted/30"
          }`}
        >
          {sourceMode === "external" && <div className="absolute top-2 right-2"><CheckCircle2 className="w-5 h-5 text-blue-500" /></div>}
          <Globe2 className={`w-5 h-5 mb-2 ${sourceMode === "external" ? "text-blue-500" : "text-muted-foreground"}`} />
          <p className="text-sm font-semibold">Bridge In</p>
          <p className="text-xs text-muted-foreground mt-0.5">From another network</p>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setSourceMode("strato");
            setAmount("");
            setAmountError("");
          }}
          className={`relative rounded-md border-2 p-3 text-left transition-colors ${
            sourceMode === "strato"
              ? "border-blue-500 bg-blue-500/5 dark:bg-blue-500/10"
              : "border-border hover:bg-muted/30"
          }`}
        >
          {sourceMode === "strato" && <div className="absolute top-2 right-2"><CheckCircle2 className="w-5 h-5 text-blue-500" /></div>}
          <Layers3 className={`w-5 h-5 mb-2 ${sourceMode === "strato" ? "text-blue-500" : "text-muted-foreground"}`} />
          <p className="text-sm font-semibold">Swap</p>
          <p className="text-xs text-muted-foreground mt-0.5">Between STRATO assets</p>
        </button>
      </div>

      <div aria-hidden={sourceMode !== "external"} {...(sourceMode !== "external" ? { inert: "" } : {})} className={`overflow-hidden transition-all duration-300 ease-in-out ${sourceMode === "external" ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0"}`}>
        <p className="text-xs font-medium text-muted-foreground mb-2">Choose Network</p>
        <div className="grid gap-2" role="group" aria-label="Source network" style={{ gridTemplateColumns: `repeat(${availableNetworks.length || 1}, 1fr)` }}>
          {availableNetworks.map((item) => {
            const active = network?.chainName === item.chainName;
            return (
              <button
                key={item.chainId}
                type="button"
                tabIndex={sourceMode === "external" ? 0 : -1}
                disabled={pending}
                onClick={() => {
                  setExternalRouteId("");
                  setAmount("");
                  setAmountError("");
                  setSelectedNetwork(item.chainName);
                }}
                className={`relative h-10 rounded-md text-sm font-medium border-2 transition-colors flex items-center justify-center ${
                  active
                    ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-300"
                    : "border-border text-foreground hover:bg-muted/50"
                }`}
              >
                {active && (
                  <div className="absolute top-1 right-1">
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                  </div>
                )}
                {item.chainName}
              </button>
            );
          })}
        </div>
      </div>
      </section>

      {/* STEP 2 */}
      <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">2</span>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You Send{sourceMode === "strato" ? " From STRATO" : ""}</h3>
        </div>
        {sourceMode === "strato"
          ? <button type="button" aria-label="Swap send and receive tokens"
              disabled={pending || !tokenIn || !tokenOut || !routeSources.some(token => token.address === tokenOut.address)}
              title={tokenOut && !routeSources.some(token => token.address === tokenOut.address) ? "This token cannot be used as a route input" : "Swap send and receive tokens"}
              onClick={flipTokens}
              className="flex h-7 w-7 items-center justify-center rounded-md border-2 border-border text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50">
              <ArrowDownUp className="h-3.5 w-3.5" />
            </button>
          : <div className="flex items-center gap-2">
              <div className="fund-wallet-compact [&_>div]:!mb-0 [&_.group>div]:!h-7 [&_.group>div]:!text-[11px] [&_.group>div]:!px-2.5 [&_.group>div]:!rounded-md [&_.group>div.absolute]:!rounded-md [&_.group>div.absolute>span]:!text-[11px] [&_button]:!h-7 [&_button]:!text-[11px] [&_button]:!px-2.5 [&_button]:!py-0 [&_button]:!rounded-md [&_button]:!font-medium">
                <style>{`.fund-wallet-compact > div > div.flex { gap: 0 !important; } .fund-wallet-compact > div > div.flex > :not(.group) { display: none !important; } .fund-wallet-compact > div { width: auto !important; }`}</style>
                <BridgeWalletStatus guestMode={guestMode} externalOnly connectedLabel="External Wallet" connectLabel="Connect External" copiedDescription="External wallet address copied to clipboard" />
              </div>
              {externalEvmWalletAddress && <span className="flex items-center text-[11px] font-mono text-muted-foreground" title={externalEvmWalletAddress}>{truncateAddress(externalEvmWalletAddress)}<CopyButton address={externalEvmWalletAddress} /></span>}
            </div>}
      </div>
      <div className="rounded-md border-2 border-border p-3 space-y-2 transition-colors focus-within:border-blue-500">
        <div className="flex items-center gap-2">
          <RouteTokenPicker label="Choose send token" external={sourceMode === "external"}
            tokens={sourceMode === "external" ? externalPickerTokens : pickerTokens.filter(token => routeSources.some(source => source.address === token.id))}
            value={sourceMode === "external" ? externalRoute?.id : tokenIn?.address}
            loading={sourceMode === "external" ? bridgeCatalog.loading : routeAssetsQuery.isLoading}
            onSelect={id => { sourceMode === "external" ? setExternalRouteId(id) : setTokenInAddress(id); setAmount(""); setAmountError(""); }} />
          <input
            className="h-10 min-w-0 flex-1 bg-transparent text-right text-xl font-bold outline-none placeholder:text-muted-foreground/50"
            aria-label="Amount to pay"
            aria-describedby="pay-amount-help"
            aria-invalid={!!(amountError || externalBalanceError || minDepositError)}
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(event) =>
              sourceMode === "strato"
                ? handleAmountInputChange(
                    event.target.value,
                    setAmount,
                    setAmountError,
                    guestMode ? maxUint256.toString() : maxSpendableWei,
                    inputDecimals
                  )
                : handleAmountInputChange(
                    event.target.value,
                    setAmount,
                    setAmountError,
                    externalBalance?.toString() ?? maxUint256.toString(),
                    inputDecimals,
                    "Insufficient external token balance"
                  )
            }
          />
        </div>
        {inputUsd && <p className="text-right text-xs text-muted-foreground pt-0.5">≈ {inputUsd}</p>}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {sourceMode === "strato"
              ? tokenIn && <>Balance: <span className="text-foreground font-medium">{formatAmount(formatUnits(maxSpendableWei, tokenIn.customDecimals))} {tokenIn._symbol}</span></>
              : externalRoute && (!isExternalEvmWalletConnected
                ? "Connect an external wallet to see your balance"
                : (externalBalanceQuery.isError || (!isNativeInput && externalBalance === undefined && tokenBalance.isSuccess))
                  ? "Balance unavailable"
                  : externalBalance === undefined
                    ? "Loading balance..."
                    : <>Balance: <span className="text-foreground font-medium">{formatAmount(formatUnits(externalBalance.toString(), inputDecimals))} {externalRoute.externalSymbol}</span></>)}
          </span>
          {sourceMode === "strato" && tokenIn && (
            <button
              type="button"
              className="text-xs font-semibold text-primary"
              disabled={!feeBalancesReady}
              onClick={() => {
                setAmount(
                  formatUnits(maxSpendableWei, tokenIn.customDecimals)
                );
                setAmountError("");
              }}
            >
              Max
            </button>
          )}
        </div>
        <div id="pay-amount-help" className="text-xs text-muted-foreground">
          {sourceMode === "external" && externalRoute && !nativeRedemption && <>
            {minDepositError && !depositConfig.data ? "" : depositConfig.data ? `Minimum deposit: ${formatUnits(depositConfig.data.minAmount, inputDecimals)} ${externalRoute.externalSymbol}` : "Loading deposit limits…"}
            {depositConfig.isError && <button type="button" className="ml-2 font-semibold text-primary" onClick={() => void depositConfig.refetch()}>Retry</button>}
          </>}
          {(amountError || externalBalanceError || minDepositError) && <p className="mt-1 text-destructive" role="alert">{amountError || externalBalanceError || minDepositError}</p>}
        </div>
      </div>
      </section>

      {/* STEP 3 */}
      <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0">3</span>
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">You Receive On STRATO</h3>
        </div>
        {recipient && <span className="flex items-center text-[11px] font-mono text-muted-foreground" title={recipient}>{truncateAddress(recipient)}<CopyButton address={recipient} /></span>}
      </div>
      <RouteReceivePanel tokens={pickerTokens.filter(token => sourceMode === "external" || token.id !== tokenIn?.address)}
        token={tokenOut} quote={quote} usd={outputUsd} loading={routeAssetsQuery.isLoading} pending={pending}
        error={selectionError} onSelect={setTokenOutAddress} />
      </section>

      <div className="space-y-4">
      <label className="flex items-center justify-between px-1 text-xs text-muted-foreground">
        <span>Slippage tolerance</span>
        <select
          className="rounded-md border-0 bg-muted px-2 py-1 font-medium text-foreground outline-none"
          value={slippageBps}
          onChange={(event) => setSlippageBps(Number(event.target.value))}
        >
          <option value={25}>0.25%</option>
          <option value={50}>0.5%</option>
          <option value={100}>1%</option>
        </select>
      </label>

      {amountWei !== "0" && <RouteTradeSummary quote={quote} inputAmount={amountWei} inputDecimals={inputDecimals} inputSymbol={inputSymbol} outputToken={tokenOut}
        external={sourceMode === "external"} fetching={quoteFetching || quoteLoading}
        error={quoteError ? getQuoteErrorMessage(quoteError) : undefined} />}
      <div className="text-xs" aria-live="polite">
        {feeError ? <p className="text-destructive">{feeError}</p> : lowFeeBalance ? <p className="text-amber-700 dark:text-amber-400">Your fee balance is running low ({formatUnits(availableFees)} USDST including vouchers). Add funds for future trades.</p> : poolLinkError ? <p className="text-muted-foreground">{poolLinkError}</p> : null}
      </div>

      {rewardedRouteSteps.map(({ activity, inputAmount, tokenIn }) => (
        <RewardsWidget
          key={activity.activityId}
          userRewards={{ ...userRewards!, activities: [activity] }}
          activityName={activity.activity.name}
          inputAmount={inputAmount}
          swapTokenInAddress={tokenIn}
          actionLabel="Trade"
          hideWhenZero
          compact
        />
      ))}

      <Button
        className="w-full h-11 bg-gradient-to-r from-[#1f1f5f] via-[#293b7d] to-[#16737d] text-white hover:opacity-90 text-base font-semibold"
        disabled={
          pending || (!guestMode && (
            quoteLoading ||
            !quote ||
            !!selectionError ||
            !!amountError ||
            !!feeError ||
            (sourceMode === "strato" && !feeBalancesReady) ||
            !!externalBalanceError ||
            (sourceMode === "external" && (!isExternalEvmWalletConnected || !depositConfigReady || !!minDepositError)) ||
            amountWei === "0"
          ))
        }
        onClick={guestMode ? requestWalletConnection : reviewTrade}
      >
        {guestMode
          ? "Connect wallet"
          : pending
            ? "Submitting..."
            : sourceMode === "external" && !isExternalEvmWalletConnected
              ? "Connect External Wallet"
              : `Review ${getRouteActionLabel(tokenOut?.routeDestination, sourceMode === "external", normalizeRouteAddress(externalRoute?.stratoToken ?? "") === tokenOut?.address)}`}
      </Button>
      {sourceMode === "external" && compositeQuote.data && <RouteFallback quote={compositeQuote.data} fallbackDecimals={bridgedToken?.customDecimals ?? 18} outputSymbol={tokenOut?._symbol} destination={tokenOut?.routeDestination} />}
      {quote?.steps.length ? <RoutePreview steps={quote.steps} tokens={tokens} minFinalOut={quote.minFinalOut} outputToken={tokenOut} showMinimum={false} /> : null}
      <p className="text-right">
        <Link to="/dashboard/withdrawals" className="text-xs text-blue-500 hover:text-blue-400">
          Need to withdraw? <span className="font-semibold">Withdraw {"\u2192"}</span>
        </Link>
      </p>
      </div>
    </div>
  );
};

export default RouterWidget;
