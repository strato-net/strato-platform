import { useState, useEffect } from "react";
import { fetchLeaderboard } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

export const useUserLeaderboardRank = () => {
  const { userAddress, isLoggedIn } = useUser();
  const [rank, setRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userAddress || !isLoggedIn) {
      setRank(null);
      return;
    }

    const fetchUserRank = async () => {
      try {
        setLoading(true);
        // Fetch all leaderboard entries to find user's rank
        // Backend max limit is 100, so we paginate
        let offset = 0;
        const limit = 100;
        let found = false;
        let userRank: number | null = null;

        while (!found) {
          const response = await fetchLeaderboard(false, limit, offset);
          
          if (response.entries.length === 0) {
            break; // No more entries
          }

          const userEntry = response.entries.find(
            (entry) => entry.address.toLowerCase() === userAddress.toLowerCase()
          );

          if (userEntry) {
            userRank = userEntry.rank;
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
      } catch (error) {
        console.error("Failed to fetch user rank:", error);
        setRank(null);
      } finally {
        setLoading(false);
      }
    };

    fetchUserRank();
  }, [userAddress, isLoggedIn]);

  return { rank, loading };
};

