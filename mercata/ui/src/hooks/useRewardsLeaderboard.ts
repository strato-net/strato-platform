import { useState, useEffect, useCallback } from "react";
import { fetchLeaderboard, LeaderboardEntry } from "@/services/rewardsService";

export const useRewardsLeaderboard = (
  limit: number = 10,
  offset: number = 0,
  season: boolean = false
) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (forceRefresh: boolean = false) => {
    try {
      setLoading(true);
      const data = await fetchLeaderboard(forceRefresh, limit, offset, season);
      setEntries(data.entries);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch leaderboard"));
    } finally {
      setLoading(false);
    }
  }, [limit, offset, season]);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);

  return { entries, total, loading, error, refetch };
};

