import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import V3PoolsTab from "@/components/poolv3/V3PoolsTab";
import V3MyPositions from "@/components/poolv3/V3MyPositions";
import { useSwapContext } from "@/context/SwapContext";
import { useUser } from "@/context/UserContext";
import { PoolV3, PoolV3Position } from "@/interface";

const PoolV3Liquidity = () => {
  const { isLoggedIn } = useUser();
  const { fetchV3Pools, fetchV3Positions } = useSwapContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tab, setTab] = useState<string>(searchParams.get("tab") === "positions" ? "positions" : "pools");
  const [pools, setPools] = useState<PoolV3[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [positions, setPositions] = useState<PoolV3Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  const poolsByAddress = useMemo(() => new Map(pools.map((p) => [p.address, p])), [pools]);

  const loadPools = useCallback(async () => {
    setPoolsLoading(true);
    try {
      setPools(await fetchV3Pools());
    } finally {
      setPoolsLoading(false);
    }
  }, [fetchV3Pools]);

  // All of the user's positions across every pool
  const loadPositions = useCallback(async () => {
    if (!isLoggedIn) {
      setPositions([]);
      return;
    }
    setPositionsLoading(true);
    try {
      setPositions(await fetchV3Positions());
    } finally {
      setPositionsLoading(false);
    }
  }, [fetchV3Positions, isLoggedIn]);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  useEffect(() => {
    loadPositions();
  }, [loadPositions]);

  const selectTab = useCallback(
    (value: string) => {
      setTab(value);
      setSearchParams(value === "positions" ? { tab: "positions" } : {}, { replace: true });
    },
    [setSearchParams]
  );

  // After any mint/burn/collect: pool state (price/liquidity) and positions both move
  const handleChanged = useCallback(async () => {
    await Promise.all([loadPools(), loadPositions()]);
  }, [loadPools, loadPositions]);

  const positionCount = positions.length;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="Liquidity" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && <GuestSignInBanner message="Sign in to provide concentrated liquidity" />}
          <div className="max-w-6xl mx-auto">
            <Tabs value={tab} onValueChange={selectTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="pools">Pools</TabsTrigger>
                <TabsTrigger value="positions">
                  My Positions{positionCount > 0 ? ` (${positionCount})` : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="pools">
                <p className="text-sm text-muted-foreground mb-4">
                  Pick a pair and fee tier, choose a price range, and deposit. Concentrated positions earn fees only
                  while the pool price is inside the range.
                </p>
                <V3PoolsTab pools={pools} loading={poolsLoading} onMinted={handleChanged} />
              </TabsContent>

              <TabsContent value="positions">
                <p className="text-sm text-muted-foreground mb-4">
                  Your liquidity positions across all pools.
                </p>
                <V3MyPositions
                  positions={positions}
                  poolsByAddress={poolsByAddress}
                  loading={positionsLoading}
                  isLoggedIn={isLoggedIn}
                  onChanged={handleChanged}
                  onBrowsePools={() => selectTab("pools")}
                />
              </TabsContent>
            </Tabs>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default PoolV3Liquidity;
