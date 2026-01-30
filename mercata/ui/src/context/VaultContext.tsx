import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";

export interface VaultAsset {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  minReserve: string;
  withdrawable: string;
  priceUsd: string;
  valueUsd: string;
  images?: { value: string }[];
}

export interface VaultTransaction {
  id: string;
  type: "swap";
  timestamp: string;
  tokenIn?: {
    address: string;
    symbol: string;
    amount: string;
  };
  tokenOut?: {
    address: string;
    symbol: string;
    amount: string;
  };
}

export interface UserTokenBalance {
  address: string;
  symbol: string;
  name: string;
  balance: string;
  priceUsd: string;
  images?: { value: string }[];
}

export interface VaultState {
  // Global metrics
  totalEquity: string;
  withdrawableEquity: string;
  totalShares: string;
  navPerShare: string;
  apy: string;
  paused: boolean;

  // Per-asset data
  assets: VaultAsset[];

  // User position
  userShares: string;
  userValueUsd: string;
  allTimeEarnings: string;

  // Bot transactions
  transactions: VaultTransaction[];

  // Loading states
  loading: boolean;
  loadingUser: boolean;
  loadingTransactions: boolean;
  loadingBalances: boolean;

  // User's token balances for deposit
  userTokenBalances: UserTokenBalance[];

  // Deposit eligibility
  deficitAssets: string[];

  // Share token info
  shareTokenSymbol: string;
  shareTokenAddress: string;

  // Bot executor (admin)
  botExecutor: string;
}

type VaultContextType = {
  vaultState: VaultState;
  refreshVault: (showLoading?: boolean) => Promise<void>;
  refreshUserPosition: () => Promise<void>;
  refreshUserBalances: () => Promise<void>;
  refreshTransactions: (showLoading?: boolean) => Promise<void>;
  deposit: (args: { token: string; amount: string }) => Promise<void>;
  withdraw: (args: { amountUsd: string }) => Promise<{ basket: Array<{ token: string; amount: string }> }>;

  // Admin functions
  adminPause: () => Promise<void>;
  adminUnpause: () => Promise<void>;
  adminSetMinReserve: (args: { token: string; minReserve: string }) => Promise<void>;
  adminSetBotExecutor: (args: { executor: string }) => Promise<void>;
  adminAddAsset: (args: { token: string }) => Promise<void>;
  adminRemoveAsset: (args: { token: string }) => Promise<void>;
};

const defaultVaultState: VaultState = {
  totalEquity: "0",
  withdrawableEquity: "0",
  totalShares: "0",
  navPerShare: "0",
  apy: "0",
  paused: false,
  assets: [],
  userShares: "0",
  userValueUsd: "0",
  allTimeEarnings: "0",
  transactions: [],
  loading: true,
  loadingUser: true,
  loadingTransactions: true,
  loadingBalances: true,
  userTokenBalances: [],
  deficitAssets: [],
  shareTokenSymbol: "sVAULT",
  shareTokenAddress: "",
  botExecutor: "",
};

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider = ({ children }: { children: React.ReactNode }) => {
  const [vaultState, setVaultState] = useState<VaultState>(defaultVaultState);
  const { isLoggedIn } = useUser();

  const vaultAbortControllerRef = useRef<AbortController | null>(null);

  const fetchVaultInfo = useCallback(async (showLoading: boolean = false) => {
    if (vaultAbortControllerRef.current) {
      vaultAbortControllerRef.current.abort();
    }

    vaultAbortControllerRef.current = new AbortController();

    if (showLoading) {
      setVaultState(prev => ({ ...prev, loading: true }));
    }

    try {
      const res = await api.get("/vault/info", {
        signal: vaultAbortControllerRef.current.signal,
      });

      if (!vaultAbortControllerRef.current.signal.aborted && res.data) {
        setVaultState(prev => ({
          ...prev,
          totalEquity: res.data.totalEquity || "0",
          withdrawableEquity: res.data.withdrawableEquity || "0",
          totalShares: res.data.totalShares || "0",
          navPerShare: res.data.navPerShare || "0",
          apy: res.data.apy || "0",
          paused: res.data.paused || false,
          assets: res.data.assets || [],
          deficitAssets: res.data.deficitAssets || [],
          shareTokenSymbol: res.data.shareTokenSymbol || "sVAULT",
          shareTokenAddress: res.data.shareTokenAddress || "",
          botExecutor: res.data.botExecutor || "",
          loading: false,
        }));
      }
    } catch (err: any) {
      if (err.name === "AbortError" || err.code === "ERR_CANCELED" || err.name === "CanceledError") {
        return;
      }
      console.error("Error fetching vault info:", err);
    } finally {
      if (showLoading && !vaultAbortControllerRef.current?.signal.aborted) {
        setVaultState(prev => ({ ...prev, loading: false }));
      }
    }
  }, []);

  const fetchUserPosition = useCallback(async () => {
    if (!isLoggedIn) return;

    setVaultState(prev => ({ ...prev, loadingUser: true }));

    try {
      const res = await api.get("/vault/user");

      if (res.data) {
        setVaultState(prev => ({
          ...prev,
          userShares: res.data.userShares || "0",
          userValueUsd: res.data.userValueUsd || "0",
          allTimeEarnings: res.data.allTimeEarnings || "0",
          loadingUser: false,
        }));
      }
    } catch (err: any) {
      if (err.name === "AbortError" || err.code === "ERR_CANCELED" || err.name === "CanceledError") {
        return;
      }
      console.error("Error fetching user position:", err);
    } finally {
      setVaultState(prev => ({ ...prev, loadingUser: false }));
    }
  }, [isLoggedIn]);

  const fetchTransactions = useCallback(async (showLoading: boolean = false) => {
    if (showLoading) {
      setVaultState(prev => ({ ...prev, loadingTransactions: true }));
    }

    try {
      const res = await api.get("/vault/transactions", {
        params: { limit: 20 },
      });

      if (res.data?.transactions) {
        setVaultState(prev => ({
          ...prev,
          transactions: res.data.transactions,
          loadingTransactions: false,
        }));
      }
    } catch (err: any) {
      if (err.name === "AbortError" || err.code === "ERR_CANCELED" || err.name === "CanceledError") {
        return;
      }
      console.error("Error fetching vault transactions:", err);
    } finally {
      setVaultState(prev => ({ ...prev, loadingTransactions: false }));
    }
  }, []);

  const fetchUserBalances = useCallback(async () => {
    if (!isLoggedIn) return;

    setVaultState(prev => ({ ...prev, loadingBalances: true }));

    try {
      const res = await api.get("/vault/balances");

      if (res.data?.balances) {
        setVaultState(prev => ({
          ...prev,
          userTokenBalances: res.data.balances,
          loadingBalances: false,
        }));
      }
    } catch (err: any) {
      if (err.name === "AbortError" || err.code === "ERR_CANCELED" || err.name === "CanceledError") {
        return;
      }
      console.error("Error fetching user balances:", err);
    } finally {
      setVaultState(prev => ({ ...prev, loadingBalances: false }));
    }
  }, [isLoggedIn]);

  const deposit = async (args: { token: string; amount: string }) => {
    await api.post("/vault/deposit", args);
  };

  const withdraw = async (args: { amountUsd: string }) => {
    const res = await api.post("/vault/withdraw", args);
    return res.data;
  };

  // Admin functions
  const adminPause = async () => {
    await api.post("/vault/admin/pause");
  };

  const adminUnpause = async () => {
    await api.post("/vault/admin/unpause");
  };

  const adminSetMinReserve = async (args: { token: string; minReserve: string }) => {
    await api.post("/vault/admin/reserves", args);
  };

  const adminSetBotExecutor = async (args: { executor: string }) => {
    await api.post("/vault/admin/executor", args);
  };

  const adminAddAsset = async (args: { token: string }) => {
    await api.post("/vault/admin/assets", args);
  };

  const adminRemoveAsset = async (args: { token: string }) => {
    await api.delete("/vault/admin/assets", { data: args });
  };

  const refreshVault = useCallback(async (showLoading: boolean = false) => {
    await fetchVaultInfo(showLoading);
    await fetchUserPosition();
    await fetchUserBalances();
    await fetchTransactions(showLoading);
  }, [fetchVaultInfo, fetchUserPosition, fetchUserBalances, fetchTransactions]);

  // Initialize on mount and when logged in
  useEffect(() => {
    if (isLoggedIn) {
      fetchVaultInfo(true);
      fetchUserPosition();
      fetchUserBalances();
      fetchTransactions(true);
    }
  }, [isLoggedIn, fetchVaultInfo, fetchUserPosition, fetchUserBalances, fetchTransactions]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (vaultAbortControllerRef.current) {
        vaultAbortControllerRef.current.abort();
      }
    };
  }, []);

  const contextValue = useMemo(
    () => ({
      vaultState,
      refreshVault,
      refreshUserPosition: fetchUserPosition,
      refreshUserBalances: fetchUserBalances,
      refreshTransactions: fetchTransactions,
      deposit,
      withdraw,
      adminPause,
      adminUnpause,
      adminSetMinReserve,
      adminSetBotExecutor,
      adminAddAsset,
      adminRemoveAsset,
    }),
    [vaultState, refreshVault, fetchUserPosition, fetchUserBalances, fetchTransactions]
  );

  return (
    <VaultContext.Provider value={contextValue}>
      {children}
    </VaultContext.Provider>
  );
};

export const useVaultContext = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVaultContext must be used within a VaultProvider");
  }
  return context;
};
