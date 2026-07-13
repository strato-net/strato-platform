import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardSidebar from "../components/dashboard/DashboardSidebar";
import DashboardHeader from "../components/dashboard/DashboardHeader";
import MobileBottomNav from "../components/dashboard/MobileBottomNav";
import GuestSignInBanner from "@/components/ui/GuestSignInBanner";
import V3PoolSelector from "@/components/poolv3/V3PoolSelector";
import V3NewPositionCard from "@/components/poolv3/V3NewPositionCard";
import V3PositionsList from "@/components/poolv3/V3PositionsList";
import { useSwapContext } from "@/context/SwapContext";
import { useUser } from "@/context/UserContext";
import { PoolV3, PoolV3Position } from "@/interface";

const PoolV3Liquidity = () => {
  const { isLoggedIn } = useUser();
  const { fetchV3Pools, fetchV3Positions, getV3PoolByAddress } = useSwapContext();
  const [searchParams, setSearchParams] = useSearchParams();

  const [pools, setPools] = useState<PoolV3[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(true);
  const [selected, setSelected] = useState<PoolV3 | null>(null);
  const [positions, setPositions] = useState<PoolV3Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  const loadPools = useCallback(async () => {
    setPoolsLoading(true);
    try {
      const list = await fetchV3Pools();
      setPools(list);
      return list;
    } finally {
      setPoolsLoading(false);
    }
  }, [fetchV3Pools]);

  const loadPositions = useCallback(async (poolAddress: string) => {
    if (!isLoggedIn) return;
    setPositionsLoading(true);
    try {
      setPositions(await fetchV3Positions(poolAddress));
    } finally {
      setPositionsLoading(false);
    }
  }, [fetchV3Positions, isLoggedIn]);

  // Initial load; honor ?pool= deep link
  useEffect(() => {
    loadPools().then((list) => {
      const deepLink = searchParams.get("pool");
      const initial = (deepLink && list.find((p) => p.address === deepLink)) || list[0] || null;
      setSelected(initial);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selected) {
      loadPositions(selected.address);
      setSearchParams({ pool: selected.address }, { replace: true });
    }
  }, [selected?.address, loadPositions, setSearchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a mint/burn/collect: refresh pool state (price/liquidity moved) and positions
  const handleChanged = useCallback(async () => {
    if (!selected) return;
    const [updated] = await Promise.all([
      getV3PoolByAddress(selected.address),
      loadPositions(selected.address),
    ]);
    if (updated) {
      setSelected(updated);
      setPools((prev) => prev.map((p) => (p.address === updated.address ? updated : p)));
    }
  }, [selected, getV3PoolByAddress, loadPositions]);

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <DashboardSidebar />

      <div className="transition-all duration-300" style={{ paddingLeft: "var(--sidebar-width, 0px)" }}>
        <DashboardHeader title="V3 Liquidity" />
        <main className="p-4 md:p-6">
          {!isLoggedIn && (
            <GuestSignInBanner message="Sign in to provide concentrated liquidity" />
          )}
          <div className="max-w-6xl mx-auto">
            <p className="text-sm text-muted-foreground mb-4">
              Provide liquidity within a chosen price range. Concentrated positions earn fees only while the pool
              price is inside the range.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-start">
              <V3PoolSelector pools={pools} selected={selected} onSelect={setSelected} loading={poolsLoading} />
              {selected ? (
                <>
                  <V3NewPositionCard pool={selected} onMinted={handleChanged} />
                  <V3PositionsList
                    pool={selected}
                    positions={positions}
                    loading={positionsLoading}
                    onChanged={handleChanged}
                  />
                </>
              ) : (
                <div className="lg:col-span-2 bg-card shadow-sm rounded-xl p-6 border border-border text-sm text-muted-foreground">
                  {poolsLoading ? "Loading pools…" : "No V3 pools available yet."}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      <MobileBottomNav />
    </div>
  );
};

export default PoolV3Liquidity;
