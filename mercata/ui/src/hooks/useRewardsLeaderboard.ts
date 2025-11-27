import { useState, useEffect } from "react";
import { fetchLeaderboard, LeaderboardEntry } from "@/services/rewardsService";

export const useRewardsLeaderboard = (limit: number = 10) => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await fetchLeaderboard(limit);
        setEntries(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch leaderboard"));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [limit]);

  return { entries, loading, error, refetch: () => fetchLeaderboard(limit).then(setEntries) };
};

