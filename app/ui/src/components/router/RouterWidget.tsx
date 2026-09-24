import { useEffect, useMemo, useRef, useState } from "react";
import { useBalance, useReadContracts } from "wagmi";
import { useAccountModal } from "@rainbow-me/rainbowkit";
import { maxUint256 } from "viem";
import { ERC20_ABI } from "@/lib/bridge/constants";
import { ArrowDownUp, ArrowDown, Globe2, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";
import {
  TradeBridgeCatalog,
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
import { requestWalletConnection, redirectToLogin } from "@/lib/auth";
import RouteTokenPicker from "./RouteTokenPicker";
import RouteReceivePanel from "./RouteReceivePanel";
import RouteTradeSummary, { RouteFallback } from "./RouteTradeSummary";
import RoutePreview from "./RoutePreview";
import RouteConfirmDialog from "./RouteConfirmDialog";
import RouteProgressDialog from "./RouteProgressDialog";
import WithdrawalWidget from "./WithdrawalWidget";
import type { RouteConfirmation, RoutePickerToken } from "@/interface/swap";
import { assertRouteConfirmation, getRouteActionLabel, normalizeRouteAddress, resolveRouteSelection } from "@/lib/route";
import { useTokenContext } from "@/context/TokenContext";
import { LOW_USDST_THRESHOLD, SWAP_FEE, USDST_BALANCE_REFRESH_MS, usdstAddress } from "@/lib/constants";
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
  const { openAccountModal } = useAccountModal();
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
  const [feeBalanceOwner, setFeeBalanceOwner] = useState<string | null>(null);
  useEffect(() => {
    if (!isLoggedIn || !userAddress) return;
    const controller = new AbortController();
    const refresh = async () => {
      await fetchUsdstBalance(controller.signal);
      if (!controller.signal.aborted) setFeeBalanceOwner(userAddress);
    };
    void refresh();
    const timer = setInterval(refresh, USDST_BALANCE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [isLoggedIn, userAddress, fetchUsdstBalance]);
  const feeBalancesReady = !!userAddress && feeBalanceOwner === userAddress && !usdstBalanceError;
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
  const [sourceMode, setSourceMode] = useState<"strato" | "external" | "withdrawal">(
    "strato"
  );
  const [withdrawalPending, setWithdrawalPending] = useState(false);
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
  const pending = routeExecute.isPending || autoRouteDeposit.isPending || withdrawalPending;
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
    if (sourceMode === "withdrawal") return;
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
    <div className="space-y-5">
      <RouteConfirmDialog confirmation={routeExecute.progress ? null : confirmation} pending={pending} stage={autoRouteDeposit.stage} onClose={() => setConfirmation(null)} onConfirm={handleTrade} />
      <RouteProgressDialog progress={routeExecute.progress} onClose={routeExecute.closeProgress} />
      <div className="grid grid-cols-3 rounded-xl border border-border/60 bg-muted/60 p-1.5">
        <Button
          type="button"
          variant={sourceMode === "external" ? "default" : "ghost"}
          className="h-auto min-h-11 gap-1 whitespace-normal rounded-lg px-2 py-2 text-xs sm:gap-2 sm:text-sm"
          disabled={pending || bridgeCatalog.loading}
          onClick={() => {
            setSourceMode("external");
            setAmount("");
            setAmountError("");
          }}
        >
          <Globe2 className="h-4 w-4" />
          Bridge & Trade
        </Button>
        <Button
          type="button"
          variant={sourceMode === "strato" ? "default" : "ghost"}
          disabled={pending}
          className="h-auto min-h-11 gap-1 whitespace-normal rounded-lg px-2 py-2 text-xs sm:gap-2 sm:text-sm"
          onClick={() => {
            setSourceMode("strato");
            setAmount("");
            setAmountError("");
          }}
        >
          <Layers3 className="h-4 w-4" />
          Trade on STRATO
        </Button>
        <Button type="button" variant={sourceMode === "withdrawal" ? "default" : "ghost"}
          className="h-auto min-h-11 gap-1 whitespace-normal rounded-lg px-2 py-2 text-xs sm:gap-2 sm:text-sm"
          disabled={pending || bridgeCatalog.loading} onClick={() => { setSourceMode("withdrawal"); setConfirmation(null); }}>
          <Globe2 className="h-4 w-4 shrink-0" />Bridge Out
        </Button>
      </div>

      <p className="min-h-10 text-sm text-muted-foreground">
        {sourceMode === "strato" ? "Swap tokens or deposit directly into savings and yield vaults." : sourceMode === "external"
          ? "Bridge into tokens, savings, or yield vaults on STRATO."
          : "Move assets from STRATO to another network."}
      </p>

      {sourceMode !== "strato" && <BridgeWalletStatus externalOnly connectLabel="Connect external wallet" connectedLabel="External wallet connected" />}

      <div className="grid">
      <div aria-hidden={sourceMode === "withdrawal"} {...(sourceMode === "withdrawal" ? { inert: "" } : {})}
        className={`col-start-1 row-start-1 space-y-5 transition-opacity duration-200 motion-reduce:transition-none ${sourceMode === "withdrawal" ? "pointer-events-none opacity-0" : "opacity-100"}`}>
      <div className="rounded-xl border border-border/60 px-3 py-2 text-xs">
        <div className="flex justify-between gap-3"><span className="text-muted-foreground">{sourceMode === "external" ? "External wallet" : "Trading account"}</span><span className="font-mono" title={(sourceMode === "external" ? externalEvmWalletAddress : userAddress) ?? ""}>{truncateAddress(sourceMode === "external" ? externalEvmWalletAddress : userAddress) || "Not connected"}{openAccountModal && isExternalEvmWalletConnected && (sourceMode === "external" || !isAppAuthenticated) && <button type="button" className="ml-2 font-sans text-primary" onClick={openAccountModal}>Manage</button>}</span></div>
        <div className="mt-1 flex justify-between gap-3"><span className="text-muted-foreground">Receiving on STRATO</span><span className="font-mono" title={recipient ?? ""}>{truncateAddress(recipient) || "Connect wallet or sign in"}</span></div>
      </div>
      <div className="grid">
        <div aria-hidden={sourceMode !== "strato"} className={`col-start-1 row-start-1 flex h-11 items-center rounded-xl bg-muted/30 px-3 text-sm text-muted-foreground transition-opacity duration-200 motion-reduce:transition-none ${sourceMode === "strato" ? "opacity-100" : "pointer-events-none opacity-0"}`}>Network · STRATO</div>
        <div aria-hidden={sourceMode !== "external"} {...(sourceMode !== "external" ? { inert: "" } : {})} className={`col-start-1 row-start-1 transition-opacity duration-200 motion-reduce:transition-none ${sourceMode === "external" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
          <select aria-label="Source network" tabIndex={sourceMode === "external" ? 0 : -1}
            className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium"
            value={network?.chainName ?? ""}
            onChange={(event) => {
              setExternalRouteId("");
              setAmount("");
              setAmountError("");
              setSelectedNetwork(event.target.value);
            }}
          >
            {availableNetworks.map((item) => <option key={item.chainId} value={item.chainName}>{item.chainName}</option>)}
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 lg:py-3 transition-colors focus-within:border-primary/40 focus-within:bg-muted/50">
        <label className="mb-3 lg:mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          You send · {sourceMode === "external" ? network?.chainName ?? "Choose network" : "STRATO"}
        </label>
        <div className="flex items-center gap-3">
          <input
            className="min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50"
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
          <RouteTokenPicker label="Choose send token" external={sourceMode === "external"}
            tokens={sourceMode === "external" ? externalPickerTokens : pickerTokens.filter(token => routeSources.some(source => source.address === token.id))}
            value={sourceMode === "external" ? externalRoute?.id : tokenIn?.address}
            loading={sourceMode === "external" ? bridgeCatalog.loading : routeAssetsQuery.isLoading}
            onSelect={id => { sourceMode === "external" ? setExternalRouteId(id) : setTokenInAddress(id); setAmount(""); setAmountError(""); }} />
        </div>
        <div className="lg:mt-1 lg:flex lg:flex-wrap lg:items-center lg:justify-between lg:gap-x-3 lg:gap-y-1">
        <p className="mt-1 lg:mt-0 min-h-4 text-xs text-muted-foreground">{inputUsd ? `≈ ${inputUsd}` : "— USD"}</p>
        {sourceMode === "strato" && tokenIn && (
          <div className="mt-2 lg:mt-0 flex items-center justify-between lg:gap-3 text-xs text-muted-foreground">
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
          </div>
        )}
        {sourceMode === "external" && externalRoute && (
          <div className="mt-2 lg:mt-0 text-xs text-muted-foreground">
            {!isExternalEvmWalletConnected
              ? "Connect an external wallet to see your balance"
              : (externalBalanceQuery.isError || (!isNativeInput && externalBalance === undefined && tokenBalance.isSuccess))
                ? "Balance unavailable"
                : externalBalance === undefined
                  ? "Loading balance..."
                  : `Available: ${formatAmount(formatUnits(externalBalance.toString(), inputDecimals))} ${externalRoute.externalSymbol}`}
          </div>
        )}
        </div>
        <div id="pay-amount-help" className="mt-2 min-h-10 lg:mt-1 lg:min-h-5 text-xs text-muted-foreground">
          {sourceMode === "external" && externalRoute && !nativeRedemption && <>
            {minDepositError && !depositConfig.data ? "" : depositConfig.data ? `Minimum deposit: ${formatUnits(depositConfig.data.minAmount, inputDecimals)} ${externalRoute.externalSymbol}` : "Loading deposit limits…"}
            {depositConfig.isError && <button type="button" className="ml-2 font-semibold text-primary" onClick={() => void depositConfig.refetch()}>Retry</button>}
          </>}
          {(amountError || externalBalanceError || minDepositError) && <p className="mt-1 text-destructive" role="alert">{amountError || externalBalanceError || minDepositError}</p>}
        </div>
      </div>

      <div className="relative z-10 !-my-7 flex justify-center">
        {sourceMode === "strato" ? <button type="button" aria-label="Swap send and receive tokens"
          disabled={pending || !tokenIn || !tokenOut || !routeSources.some(token => token.address === tokenOut.address)}
          title={tokenOut && !routeSources.some(token => token.address === tokenOut.address) ? "This token cannot be used as a route input" : "Swap tokens"}
          onClick={flipTokens} className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-card bg-primary text-primary-foreground shadow-md disabled:opacity-50">
          <ArrowDownUp className="h-4 w-4" />
        </button> : <div className="flex h-11 w-11 items-center justify-center rounded-full border-4 border-card bg-muted text-muted-foreground"><ArrowDown className="h-4 w-4" /></div>}
      </div>

      <RouteReceivePanel tokens={pickerTokens.filter(token => sourceMode === "external" || token.id !== tokenIn?.address)}
        token={tokenOut} quote={quote} usd={outputUsd} loading={routeAssetsQuery.isLoading} pending={pending}
        error={selectionError} onSelect={setTokenOutAddress} />

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

      <RouteTradeSummary quote={quote} inputAmount={amountWei} inputDecimals={inputDecimals} inputSymbol={inputSymbol} outputToken={tokenOut}
        external={sourceMode === "external"} fetching={quoteFetching || quoteLoading}
        error={quoteError && amountWei !== "0" ? getQuoteErrorMessage(quoteError) : undefined} />
      <div className="min-h-10 text-xs" aria-live="polite">
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

      {(sourceMode !== "external" || isExternalEvmWalletConnected) && <Button
        className="h-12 w-full rounded-xl text-sm font-semibold shadow-sm"
        disabled={
          pending || (!guestMode && (
            quoteLoading ||
            !quote ||
            !!selectionError ||
            !!amountError ||
            !!feeError ||
            (sourceMode === "strato" && !feeBalancesReady) ||
            !!externalBalanceError ||
            (sourceMode === "external" && (!depositConfigReady || !!minDepositError)) ||
            amountWei === "0"
          ))
        }
        onClick={guestMode ? requestWalletConnection : reviewTrade}
      >
        {guestMode
          ? "Connect wallet"
          : pending
            ? "Submitting..."
            : `Review ${getRouteActionLabel(tokenOut?.routeDestination, sourceMode === "external", normalizeRouteAddress(externalRoute?.stratoToken ?? "") === tokenOut?.address)}`}
      </Button>}
      {sourceMode === "external" && <RouteFallback quote={compositeQuote.data} fallbackDecimals={bridgedToken?.customDecimals ?? 18} outputSymbol={tokenOut?._symbol} destination={tokenOut?.routeDestination} />}
      {quote?.steps.length ? <RoutePreview steps={quote.steps} tokens={tokens} minFinalOut={quote.minFinalOut} outputToken={tokenOut} showMinimum={false} /> : null}
      {guestMode && <button type="button" className="w-full text-center text-sm text-primary" onClick={() => redirectToLogin()}>Sign in with STRATO</button>}
      </div>
      <div aria-hidden={sourceMode !== "withdrawal"} {...(sourceMode !== "withdrawal" ? { inert: "" } : {})}
        className={`col-start-1 row-start-1 transition-opacity duration-200 motion-reduce:transition-none ${sourceMode === "withdrawal" ? "opacity-100" : "pointer-events-none opacity-0"}`}>
        <WithdrawalWidget catalog={bridgeCatalog} active={sourceMode === "withdrawal"} feeBalancesReady={feeBalancesReady}
          onPendingChange={setWithdrawalPending} onSubmitted={onTransactionSubmitted} />
      </div>
      </div>
    </div>
  );
};

export default RouterWidget;
