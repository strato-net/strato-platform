import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { fetchRewardsState, fetchUserRewards, RewardsState, UserRewardsData } from "@/services/rewardsService";
import { useUser } from "@/context/UserContext";

interface RewardsContextType {
  state: RewardsState | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  userRewards: UserRewardsData | null;
  userRewardsLoading: boolean;
  refetchUserRewards: () => Promise<void>;
}

const RewardsContext = createContext<RewardsContextType | null>(null);

export const RewardsProvider = ({ children }: { children: ReactNode }) => {
  const { userAddress, isLoggedIn, isAppAuthenticated } = useUser();

  const [state, setState] = useState<RewardsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [userRewards, setUserRewards] = useState<UserRewardsData | null>(null);
  const [userRewardsLoading, setUserRewardsLoading] = useState(true);

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

  useEffect(() => {
    if (!isLoggedIn || !userAddress) {
      setUserRewardsLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        setUserRewardsLoading(true);
        const data = await fetchUserRewards(false, { walletAuth: !isAppAuthenticated });
        setUserRewards(data);
      } catch {
        // silently fail — consumers check for null
      } finally {
        setUserRewardsLoading(false);
      }
    };

    fetchData();
  }, [userAddress, isLoggedIn, isAppAuthenticated]);

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchRewardsState(true);
      setState(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch rewards state"));
    } finally {
      setLoading(false);
    }
  }, []);

  const refetchUserRewards = useCallback(async () => {
    if (!isLoggedIn || !userAddress) return;
    try {
      setUserRewardsLoading(true);
      const data = await fetchUserRewards(true, { walletAuth: !isAppAuthenticated });
      setUserRewards(data);
    } catch {
      // silently fail
    } finally {
      setUserRewardsLoading(false);
    }
  }, [isLoggedIn, userAddress, isAppAuthenticated]);

  return (
    <RewardsContext.Provider value={{ state, loading, error, refetch, userRewards, userRewardsLoading, refetchUserRewards }}>
      {children}
    </RewardsContext.Provider>
  );
};

export const useRewardsContext = (): RewardsContextType => {
  const ctx = useContext(RewardsContext);
  if (!ctx) throw new Error("useRewardsContext must be used within RewardsProvider");
  return ctx;
};
