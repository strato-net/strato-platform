import { useState, useEffect } from "react";
import { fetchRewardsState, RewardsState } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

export const useRewards = () => {
  const [state, setState] = useState<RewardsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isLoggedIn } = useUser();

  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false);
      return;
    }

    const fetchState = async () => {
      try {
        setLoading(true);
        const data = await fetchRewardsState();
        setState(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch rewards state"));
      } finally {
        setLoading(false);
      }
    };

    fetchState();
    // Refresh every 30 seconds
    const interval = setInterval(fetchState, 30000);
    return () => clearInterval(interval);
  }, [isLoggedIn]);

  return { state, loading, error, refetch: () => fetchRewardsState().then(setState) };
};

