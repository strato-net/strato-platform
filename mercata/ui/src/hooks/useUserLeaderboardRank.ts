import { useState, useEffect, useCallback } from "react";
import { fetchLeaderboard } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

export const useUserLeaderboardRank = (season: boolean = false) => {
  const { userAddress, isLoggedIn } = useUser();
  const [rank, setRank] = useState<number | null>(null);
  const [totalEarned, setTotalEarned] = useState<string | null>(null);
  const [seasonName, setSeasonName] = useState<string>("Season");
  const [loading, setLoading] = useState(false);

  const fetchUserRank = useCallback(async (forceRefresh: boolean = false) => {
    if (!userAddress || !isLoggedIn) {
      setRank(null);
      setTotalEarned(null);
      return;
    }

      try {
        setLoading(true);
        // Fetch all leaderboard entries to find user's rank
        // Backend max limit is 100, so we paginate
        let offset = 0;
        const limit = 100;
        let found = false;
        let userRank: number | null = null;
      let userTotalEarned: string | null = null;

        while (!found) {
        const response = await fetchLeaderboard(forceRefresh, limit, offset, season);
        
        // Update season name from response
        if (response.seasonName) {
          setSeasonName(response.seasonName);
        }
          
          if (response.entries.length === 0) {
            break; // No more entries
          }

          const userEntry = response.entries.find(
            (entry) => entry.address.toLowerCase() === userAddress.toLowerCase()
          );

          if (userEntry) {
            userRank = userEntry.rank;
          userTotalEarned = userEntry.totalRewardsEarned;
            found = true;
            break;
          }

          // If we got less than limit entries or reached total, we've reached the end
          if (response.entries.length < limit || offset + limit >= response.total) {
            break;
          }

          offset += limit;
          
          // Safety check: don't fetch more than total entries
          if (offset >= response.total) {
            break;
          }
        }

        setRank(userRank);
      setTotalEarned(userTotalEarned);
      } catch (error) {
        console.error("Failed to fetch user rank:", error);
        setRank(null);
      setTotalEarned(null);
      } finally {
        setLoading(false);
      }
  }, [userAddress, isLoggedIn, season]);

  useEffect(() => {
    fetchUserRank(false);
  }, [fetchUserRank]);

  const refetch = useCallback(() => fetchUserRank(true), [fetchUserRank]);

  return { rank, totalEarned, seasonName, loading, refetch };
};

