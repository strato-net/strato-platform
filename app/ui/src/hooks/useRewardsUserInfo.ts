import { useState, useEffect } from "react";
import { fetchUserRewards, UserRewardsData } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

export const useRewardsUserInfo = () => {
  const [userRewards, setUserRewards] = useState<UserRewardsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { userAddress, isLoggedIn, isAppAuthenticated } = useUser();

  useEffect(() => {
    if (!isLoggedIn || !userAddress) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setLoading(true);
        const data = await fetchUserRewards(false, { walletAuth: !isAppAuthenticated });
        setUserRewards(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch user rewards"));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userAddress, isLoggedIn, isAppAuthenticated]);

  const refetch = async () => {
    if (!isLoggedIn || !userAddress) {
      return;
    }
    try {
      setLoading(true);
      const data = await fetchUserRewards(true, { walletAuth: !isAppAuthenticated }); // Force refresh to bypass cache
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

