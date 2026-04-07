import { useState, useEffect } from "react";
import { fetchUserRewards, UserRewardsData } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

export const useRewardsUserInfo = () => {
  const [userRewards, setUserRewards] = useState<UserRewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { userAddress, isLoggedIn } = useUser();

  useEffect(() => {
    if (!isLoggedIn || !userAddress) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await fetchUserRewards(userAddress);
        setUserRewards(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch user rewards"));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userAddress, isLoggedIn]);

  const refetch = async () => {
    if (!isLoggedIn || !userAddress) {
      return;
    }
    try {
      setLoading(true);
      const data = await fetchUserRewards(userAddress, true); // Force refresh to bypass cache
      setUserRewards(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch user rewards"));
    } finally {
      setLoading(false);
    }
  };

  return { userRewards, loading, error, refetch };
};

