import { useState, useEffect } from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";

interface PendingRewardsData {
  pendingCata: string;
  pendingCataFormatted: string;
  userAddress: string;
}

/**
 * Hook to fetch total pending CATA rewards across all pools
 *
 * @param enabled - Whether to fetch (default: true)
 * @param refreshInterval - Auto-refresh interval in ms (default: 10000 = 10 seconds)
 * @returns Pending rewards data and loading state
 */
export const usePendingRewards = (enabled = true, refreshInterval = 10000) => {
  const { userAddress, isLoggedIn } = useUser();
  const [pendingRewards, setPendingRewards] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchPendingRewards = async () => {
    if (!isLoggedIn || !userAddress || !enabled) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await api.get<PendingRewardsData>("/rewards/pending");
      setPendingRewards(response.data.pendingCataFormatted);
    } catch (err) {
      console.error("Failed to fetch pending rewards:", err);
      setError(err instanceof Error ? err : new Error("Unknown error"));
      setPendingRewards("0");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Initial fetch
    fetchPendingRewards();

    // Set up auto-refresh
    const interval = setInterval(fetchPendingRewards, refreshInterval);

    return () => clearInterval(interval);
  }, [userAddress, isLoggedIn, enabled, refreshInterval]);

  return {
    pendingRewards,
    loading,
    error,
    refetch: fetchPendingRewards,
  };
};
