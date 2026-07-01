import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";

interface UserRankResponse {
  rank: number | null;
  totalRewardsEarned: string | null;
  total: number;
}

export const useUserLeaderboardRank = () => {
  const { userAddress, isLoggedIn } = useUser();
  const [rank, setRank] = useState<number | null>(null);
  const [totalEarned, setTotalEarned] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchUserRank = useCallback(async (forceRefresh: boolean = false) => {
    if (!userAddress || !isLoggedIn) {
      setRank(null);
      setTotalEarned(null);
      return;
    }

    try {
      setLoading(true);
      const params = forceRefresh ? { refresh: "true" } : {};
      const response = await api.get<UserRankResponse>("/rewards/leaderboard/me", { params });
      setRank(response.data.rank);
      setTotalEarned(response.data.totalRewardsEarned);
    } catch (error) {
      console.error("Failed to fetch user rank:", error);
      setRank(null);
      setTotalEarned(null);
    } finally {
      setLoading(false);
    }
  }, [userAddress, isLoggedIn]);

  useEffect(() => {
    fetchUserRank(false);
  }, [fetchUserRank]);

  const refetch = useCallback(() => fetchUserRank(true), [fetchUserRank]);

  return { rank, totalEarned, loading, refetch };
};
