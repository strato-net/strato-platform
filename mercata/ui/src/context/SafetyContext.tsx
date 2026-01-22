import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import { SafetyModuleData } from "@/interface";

type SafetyContextType = {
  safetyInfo: SafetyModuleData | null;
  loading: boolean;
  refreshSafetyInfo: (signal?: AbortSignal) => void;
  stakeSafety: (args: { amount: string; stakeSToken: boolean }) => Promise<void>;
  startCooldown: () => Promise<void>;
  redeemSafety: (args: { sharesAmount: string; includeStakedSToken: boolean }) => Promise<void>;
  redeemAllSafety: () => Promise<void>;
};

const SafetyContext = createContext<SafetyContextType | undefined>(undefined);

export const SafetyProvider = ({ children }: { children: React.ReactNode }) => {
  const [safetyInfo, setSafetyInfo] = useState<SafetyModuleData | null>(null);
  const [loading, setLoading] = useState(false);
  const { isLoggedIn } = useUser();

  const refreshSafetyInfo = useCallback(
    async (signal?: AbortSignal) => {
      // Always fetch - backend handles optional userAddress for public data
      try {
        setLoading(true);
        const response = await api.get("/lending/safety/info", { signal });
        setSafetyInfo(response.data);
      } catch (error) {
        if (signal?.aborted) return;
        console.error("Failed to fetch safety module info:", error);
        setSafetyInfo(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const stakeSafety = useCallback(
    async ({ amount, stakeSToken }: { amount: string; stakeSToken: boolean }) => {
      if (!isLoggedIn) throw new Error("User not connected");

      const response = await api.post("/lending/safety/stake", { amount, stakeSToken });
      refreshSafetyInfo();
      return response.data;
    },
    [isLoggedIn, refreshSafetyInfo]
  );

  const startCooldown = useCallback(async () => {
    if (!isLoggedIn) throw new Error("User not connected");

    const response = await api.post("/lending/safety/cooldown");
    refreshSafetyInfo();
    return response.data;
  }, [isLoggedIn, refreshSafetyInfo]);

  const redeemSafety = useCallback(
    async ({ sharesAmount, includeStakedSToken }: { sharesAmount: string; includeStakedSToken: boolean }) => {
      if (!isLoggedIn) throw new Error("User not connected");

      const response = await api.post("/lending/safety/redeem", { sharesAmount, includeStakedSToken });
      refreshSafetyInfo();
      return response.data;
    },
    [isLoggedIn, refreshSafetyInfo]
  );

  const redeemAllSafety = useCallback(async () => {
    if (!isLoggedIn) throw new Error("User not connected");

    const response = await api.post("/lending/safety/redeem-all");
    refreshSafetyInfo();
    return response.data;
  }, [isLoggedIn, refreshSafetyInfo]);

  // Auto-refresh on mount
  useEffect(() => {
    const abortController = new AbortController();
    refreshSafetyInfo(abortController.signal);
    return () => {
      abortController.abort();
    };
  }, [refreshSafetyInfo]);

  // Auto-refresh timer for cooldown/window status
  useEffect(() => {
    if (!safetyInfo?.cooldownActive || (!safetyInfo.cooldownTimeRemaining && !safetyInfo.unstakeWindowTimeRemaining)) {
      return;
    }

    const interval = setInterval(() => {
      refreshSafetyInfo();
    }, 10000); // Refresh every 10 seconds when cooldown is active

    return () => clearInterval(interval);
  }, [safetyInfo?.cooldownActive, safetyInfo?.cooldownTimeRemaining, safetyInfo?.unstakeWindowTimeRemaining, refreshSafetyInfo]);

  const contextValue = useMemo(
    () => ({
      safetyInfo,
      loading,
      refreshSafetyInfo,
      stakeSafety,
      startCooldown,
      redeemSafety,
      redeemAllSafety,
    }),
    [
      safetyInfo,
      loading,
      refreshSafetyInfo,
      stakeSafety,
      startCooldown,
      redeemSafety,
      redeemAllSafety,
    ]
  );

  return (
    <SafetyContext.Provider value={contextValue}>
      {children}
    </SafetyContext.Provider>
  );
};

export const useSafetyContext = () => {
  const context = useContext(SafetyContext);
  if (context === undefined) {
    throw new Error("useSafetyContext must be used within a SafetyProvider");
  }
  return context;
};
