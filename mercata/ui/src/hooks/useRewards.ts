import { useState, useEffect } from "react";
import { fetchRewardsState, RewardsState } from "@/services/rewardsService";

export const useRewards = () => {
  const [state, setState] = useState<RewardsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
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
  }, []);

  const refetch = async () => {
    try {
      setLoading(true);
      const data = await fetchRewardsState(true); // Force refresh to bypass cache
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch rewards state"));
    } finally {
      setLoading(false);
    }
  };

  return { state, loading, error, refetch };
};

