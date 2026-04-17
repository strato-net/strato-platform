import { useCallback, useMemo, useState } from "react";
import { formatUnits } from "@/utils/numberUtils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import DashboardSidebar from "@/components/dashboard/DashboardSidebar";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MobileBottomNav from "@/components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { useUser } from "@/context/UserContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useTokenContext } from "@/context/TokenContext";
import { loopService } from "@/services/loopService";
import type { LoopBootstrapResponse, LoopPositionResponse } from "@mercata/shared-types";
import { formatUsdFromWei } from "@/components/loop/loopFormat";
import { ltvFromCR, maxLeverageFromMinCR, healthFactorAtLeverage, netCarryAPR } from "@/components/loop/loopMath";
import MarketList, { type LoopMarketOption } from "@/components/loop/MarketList";
import LoopHeader, { type LoopDetailTab } from "@/components/loop/LoopHeader";
import LoopOverview from "@/components/loop/LoopOverview";
import LoopPosition from "@/components/loop/LoopPosition";
import LoopWidget from "@/components/loop/LoopWidget";

const ROUTE_TYPE = "cdp_loop" as const;
const BORROW_SYMBOL = "USDST";
const EMBEDDED_LOOP_STATE_KEY = "borrow_loop_widget_state_v1";

interface EmbeddedLoopState {
  selectedMarketKey: string;
  collateralAmount: string;
  leverage: number;
}

const DEFAULT_EMBEDDED_LOOP_STATE: EmbeddedLoopState = {
  selectedMarketKey: "",
  collateralAmount: "",
  leverage: 2.0,
};

const readEmbeddedLoopState = (): EmbeddedLoopState => {
  if (typeof window === "undefined") return DEFAULT_EMBEDDED_LOOP_STATE;
  const rawState = window.sessionStorage.getItem(EMBEDDED_LOOP_STATE_KEY);
  if (!rawState) return DEFAULT_EMBEDDED_LOOP_STATE;
  try {
    const parsed = JSON.parse(rawState) as Partial<EmbeddedLoopState>;
    return {
      selectedMarketKey: typeof parsed.selectedMarketKey === "string" ? parsed.selectedMarketKey : "",
      collateralAmount: typeof parsed.collateralAmount === "string" ? parsed.collateralAmount : "",
      leverage: typeof parsed.leverage === "number" && Number.isFinite(parsed.leverage) ? parsed.leverage : 2.0,
    };
  } catch {
    return DEFAULT_EMBEDDED_LOOP_STATE;
  }
};

// Unifies standalone (URL-driven selection, local state for amount/leverage)
// and embedded (sessionStorage-backed for everything) so consumers never
// branch on `embedded`.
function useLoopSelection(embedded: boolean, detailMarketKeyFromUrl: string) {
  const [standaloneAmount, setStandaloneAmount] = useState("");
  const [standaloneLeverage, setStandaloneLeverage] = useState(2.0);
  const [embeddedState, setEmbeddedState] = useState<EmbeddedLoopState>(readEmbeddedLoopState);

  const updateEmbeddedState = useCallback((updater: (s: EmbeddedLoopState) => EmbeddedLoopState) => {
    setEmbeddedState((prev) => {
      const next = updater(prev);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(EMBEDDED_LOOP_STATE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const selectedMarketKey = embedded ? embeddedState.selectedMarketKey : detailMarketKeyFromUrl;
  const collateralAmount = embedded ? embeddedState.collateralAmount : standaloneAmount;
  const leverage = embedded ? embeddedState.leverage : standaloneLeverage;

  const setSelectedMarketKey = useCallback((key: string) => {
    if (embedded) updateEmbeddedState((s) => ({ ...s, selectedMarketKey: key }));
  }, [embedded, updateEmbeddedState]);

  const setCollateralAmount = useCallback((value: string) => {
    if (embedded) updateEmbeddedState((s) => ({ ...s, collateralAmount: value }));
    else setStandaloneAmount(value);
  }, [embedded, updateEmbeddedState]);

  const setLeverage = useCallback((value: number) => {
    if (embedded) updateEmbeddedState((s) => ({ ...s, leverage: value }));
    else setStandaloneLeverage(value);
  }, [embedded, updateEmbeddedState]);

  return { selectedMarketKey, setSelectedMarketKey, collateralAmount, setCollateralAmount, leverage, setLeverage };
}

interface LoopProps {
  embedded?: boolean;
}

const Loop = ({ embedded = false }: LoopProps) => {
  const { isLoggedIn } = useUser();
  const { activeTokens, fetchTokens } = useUserTokens();
  const { usdstBalance, fetchUsdstBalance } = useTokenContext();
  const navigate = useNavigate();
  const { asset: assetParam } = useParams();

  const [detailTab, setDetailTab] = useState<LoopDetailTab>("overview");

  const normalizedAssetParam = assetParam?.toLowerCase();
  const detailMarketKeyFromUrl = normalizedAssetParam ? `cdp_loop:${normalizedAssetParam}` : "";

  const {
    selectedMarketKey,
    setSelectedMarketKey,
    collateralAmount,
    setCollateralAmount,
    leverage,
    setLeverage,
  } = useLoopSelection(embedded, detailMarketKeyFromUrl);

  const {
    data: preview,
    isLoading: previewLoading,
    isError: previewError,
    refetch: refetchPreview,
  } = useQuery<LoopBootstrapResponse>({
    queryKey: ["loop-bootstrap"],
    queryFn: loopService.bootstrap,
    enabled: isLoggedIn,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const marketOptions = useMemo<LoopMarketOption[]>(() => {
    if (!preview?.opportunities) return [];
    const assetConfigs = new Map(
      preview.routes.cdp.assets.map((a) => [a.address.toLowerCase(), a])
    );
    const { stabilityAPR: defaultBorrowRate, minCR: defaultMinCR, liquidationRatio: defaultLiqRatio } = preview.routes.cdp;
    const rows: LoopMarketOption[] = [];
    preview.opportunities.forEach((item) => {
      if (BigInt(item.swapPoolUSDSTLiquidity || "0") <= 0n) return;
      const cfg = assetConfigs.get(item.asset.toLowerCase());
      const maxLev = maxLeverageFromMinCR(cfg?.minCR || defaultMinCR);
      const borrowRate = cfg?.stabilityFeeRate || defaultBorrowRate;
      const apy = netCarryAPR(maxLev, item.baseYieldAPR, borrowRate);
      if (apy <= 0) return;
      rows.push({
        key: `cdp_loop:${item.asset.toLowerCase()}`,
        symbol: item.symbol,
        asset: item.asset,
        netCarryAPR: apy,
        maxLeverage: maxLev,
        healthFactor: healthFactorAtLeverage(maxLev, ltvFromCR(cfg?.liquidationRatio || defaultLiqRatio)),
      });
    });
    return rows.sort((a, b) => b.netCarryAPR - a.netCarryAPR);
  }, [preview]);

  const selectedMarket = useMemo(
    () => marketOptions.find((option) => option.key === selectedMarketKey) || null,
    [marketOptions, selectedMarketKey]
  );
  const selectedAssetAddress = selectedMarket?.asset;
  const assetSymbol = selectedMarket?.symbol || "";
  const showDetail = Boolean(selectedMarket);

  const {
    data: positionData,
    isLoading: positionLoading,
    refetch: refetchPosition,
  } = useQuery<LoopPositionResponse>({
    queryKey: ["loop-position"],
    queryFn: loopService.position,
    enabled: isLoggedIn && showDetail,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const filteredPosition = useMemo(() => {
    if (!positionData || !selectedAssetAddress) return null;
    const addr = selectedAssetAddress.toLowerCase();
    const match = positionData.cdp.find((p) => p.asset.toLowerCase() === addr);
    if (!match || match.leverage <= 1.01) return null;
    return match;
  }, [positionData, selectedAssetAddress]);

  const selectedOpportunity = useMemo(() => {
    if (!preview?.opportunities || !selectedAssetAddress) return null;
    const addr = selectedAssetAddress.toLowerCase();
    return preview.opportunities.find((item) => item.asset.toLowerCase() === addr) || null;
  }, [preview?.opportunities, selectedAssetAddress]);

  const selectedCdpAsset = useMemo(() => {
    if (!preview || !selectedAssetAddress) return null;
    const addr = selectedAssetAddress.toLowerCase();
    return preview.routes.cdp.assets.find((a) => a.address.toLowerCase() === addr) || null;
  }, [preview, selectedAssetAddress]);

  const selectedAssetDecimals = selectedCdpAsset?.decimals || 18;

  const selectedAssetPrice = useMemo(() => {
    if (!selectedCdpAsset?.price) return 0;
    try { return Number(formatUnits(selectedCdpAsset.price, 18)); } catch { return 0; }
  }, [selectedCdpAsset]);

  const selectedTokenBalanceWei = useMemo(() => {
    if (!selectedAssetAddress) return "0";
    const token = activeTokens.find((item) => item.address.toLowerCase() === selectedAssetAddress.toLowerCase());
    if (!token) return "0";
    if (token.balance) return token.balance;
    return token.balances?.[0]?.balance || "0";
  }, [activeTokens, selectedAssetAddress]);

  const assetMinCR = selectedCdpAsset?.minCR || preview?.routes.cdp.minCR || 0;
  const assetLiqRatio = selectedCdpAsset?.liquidationRatio || preview?.routes.cdp.liquidationRatio || 0;
  const assetStabilityAPR = selectedCdpAsset?.stabilityFeeRate || preview?.routes.cdp.stabilityAPR || 0;
  const poolSwapFeeBps = selectedOpportunity?.swapFeeBps ?? 0;

  const leverageSliderMax = maxLeverageFromMinCR(assetMinCR);
  const maxLeverageDisplay = `${leverageSliderMax.toFixed(1)}x`;
  const liquidityText = formatUsdFromWei(selectedOpportunity?.swapPoolUSDSTLiquidity);
  const maxLtvRatio = ltvFromCR(assetMinCR);
  const liquidationLtvRatio = ltvFromCR(assetLiqRatio);

  const maxLeverageAPY = selectedOpportunity
    ? netCarryAPR(leverageSliderMax, selectedOpportunity.baseYieldAPR, assetStabilityAPR)
    : 0;

  const selectMarket = useCallback((option: LoopMarketOption) => {
    setCollateralAmount("");
    setLeverage(2.0);
    if (embedded) {
      setSelectedMarketKey(option.key);
      return;
    }
    navigate(`/dashboard/loop/cdp_loop/${option.asset}`);
  }, [embedded, navigate, setSelectedMarketKey, setCollateralAmount, setLeverage]);

  const clearSelection = useCallback(() => {
    if (embedded) {
      setSelectedMarketKey("");
      return;
    }
    navigate("/dashboard/loop");
  }, [embedded, navigate, setSelectedMarketKey]);

  const executeLoop = useCallback(async ({ amount, targetLeverage, maxSlippageBps }: {
    amount: string;
    targetLeverage: number;
    maxSlippageBps: number;
  }) => {
    if (!selectedAssetAddress) throw new Error("No asset selected");
    await loopService.execute({
      routeType: ROUTE_TYPE,
      asset: selectedAssetAddress,
      amount,
      targetLeverage,
      maxSlippageBps,
    });
  }, [selectedAssetAddress]);

  const refreshAfterExecute = useCallback(async () => {
    await Promise.all([refetchPreview(), refetchPosition(), fetchTokens(), fetchUsdstBalance()]);
  }, [fetchTokens, fetchUsdstBalance, refetchPosition, refetchPreview]);

  const loopContent = (
    <>
      {!isLoggedIn && (
        <GuestSignInBanner message="Sign in to leverage your CDP position." />
      )}

      {showDetail && (
        <LoopHeader
          assetSymbol={assetSymbol}
          activeTab={detailTab}
          onTabChange={setDetailTab}
          onBack={clearSelection}
        />
      )}

      {!showDetail && (
        <MarketList
          embedded={embedded}
          options={marketOptions}
          selectedKey={selectedMarketKey}
          loading={previewLoading}
          error={previewError}
          onSelect={selectMarket}
        />
      )}

      {showDetail && preview && (
        <div className="grid grid-cols-1 xl:grid-cols-[0.7fr_1.3fr] gap-6">
          <LoopWidget
            key={selectedAssetAddress}
            isLoggedIn={isLoggedIn}
            selectedOpportunity={selectedOpportunity}
            assetSymbol={assetSymbol}
            borrowSymbol={BORROW_SYMBOL}
            selectedAssetDecimals={selectedAssetDecimals}
            selectedAssetPrice={selectedAssetPrice}
            selectedTokenBalanceWei={selectedTokenBalanceWei}
            usdstBalanceWei={usdstBalance}
            leverageSliderMax={leverageSliderMax}
            liquidationLtvRatio={liquidationLtvRatio}
            assetStabilityAPR={assetStabilityAPR}
            poolSwapFeeBps={poolSwapFeeBps}
            collateralAmount={collateralAmount}
            onCollateralAmountChange={setCollateralAmount}
            leverage={leverage}
            onLeverageChange={setLeverage}
            currentPosition={filteredPosition}
            canExecute={Boolean(selectedAssetAddress)}
            onExecute={executeLoop}
            onExecuted={refreshAfterExecute}
          />

          <div className="xl:order-2">
            {detailTab === "overview" && (
              <LoopOverview
                assetSymbol={assetSymbol}
                borrowSymbol={BORROW_SYMBOL}
                liquidityText={liquidityText}
                maxLeverageDisplay={maxLeverageDisplay}
                maxLeverageAPY={maxLeverageAPY}
                maxLtvRatio={maxLtvRatio}
                liquidationLtvRatio={liquidationLtvRatio}
                oraclePrice={selectedAssetPrice}
                baseYieldAPR={selectedOpportunity?.baseYieldAPR ?? 0}
                stabilityAPR={assetStabilityAPR}
                swapFeeBps={poolSwapFeeBps}
                debtFloor={selectedCdpAsset?.debtFloor ?? "0"}
                debtCeiling={selectedCdpAsset?.debtCeiling ?? "0"}
              />
            )}

            {detailTab === "position" && (
              <LoopPosition
                isLoggedIn={isLoggedIn}
                loading={positionLoading}
                position={filteredPosition}
                assetSymbol={assetSymbol}
                borrowSymbol={BORROW_SYMBOL}
                selectedAssetDecimals={selectedAssetDecimals}
                liquidationLtvRatio={liquidationLtvRatio}
              />
            )}
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-6">{loopContent}</div>;
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />
      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Multiply" subtitle="Leverage your exposure in a single click" />
        <main className="p-4 md:p-6 space-y-6">{loopContent}</main>
      </div>
      <MobileBottomNav />
    </div>
  );
};

export default Loop;
