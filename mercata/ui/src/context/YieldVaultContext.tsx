import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";

export type YieldVaultInfo = {
  key: string;
  configured: boolean;
  deployed: boolean;
  vaultAddress: string;
  assetAddress: string;
  assetSymbol: string;
  shareSymbol: string;
  name: string;
  decimals: number;
  totalAssets: string;
  idleAssets: string;
  activeAssets: string;
  totalShares: string;
  exchangeRate: string;
  assetPriceWad: string;
  tvlUsd: string;
  apy: string;
  paused: boolean;
  totalQueuedShares: string;
  totalClaimableAssets: string;
};

export type YieldVaultUserInfo = YieldVaultInfo & {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  positionUsd: string;
  maxDeposit: string;
  maxRedeem: string;
  claimableAssets: string;
  claimableAssetsUsd: string;
  activeRequestId: string;
  queuedShares: string;
  queuedSharesUsd: string;
};

type YieldVaultContextType = {
  vaults: Record<string, YieldVaultInfo | null>;
  userVaults: Record<string, YieldVaultUserInfo | null>;
  loading: boolean;
  refreshVaults: () => Promise<void>;
  getVaultInfo: (key: string) => YieldVaultInfo | null;
  getUserVaultInfo: (key: string) => YieldVaultUserInfo | null;
};

const VAULT_KEYS = ["eth-carry", "wbtc-carry"] as const;

const YieldVaultContext = createContext<YieldVaultContextType | undefined>(undefined);

export const YieldVaultProvider = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn } = useUser();
  const [vaults, setVaults] = useState<Record<string, YieldVaultInfo | null>>({});
  const [userVaults, setUserVaults] = useState<Record<string, YieldVaultUserInfo | null>>({});
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshVaults = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoading(true);

    try {
      const infoResults = await Promise.allSettled(
        VAULT_KEYS.map((key) =>
          api.get<YieldVaultInfo>(`/earn/yield-vault/${key}/info`, {
            signal: controller.signal,
          })
        )
      );

      if (controller.signal.aborted) return;

      const infoMap: Record<string, YieldVaultInfo | null> = {};
      VAULT_KEYS.forEach((key, i) => {
        infoMap[key] =
          infoResults[i].status === "fulfilled" ? infoResults[i].value.data : null;
      });
      setVaults(infoMap);

      if (isLoggedIn) {
        const userResults = await Promise.allSettled(
          VAULT_KEYS.map((key) =>
            api.get<YieldVaultUserInfo>(`/earn/yield-vault/${key}/user`, {
              signal: controller.signal,
            })
          )
        );

        if (controller.signal.aborted) return;

        const userMap: Record<string, YieldVaultUserInfo | null> = {};
        VAULT_KEYS.forEach((key, i) => {
          userMap[key] =
            userResults[i].status === "fulfilled" ? userResults[i].value.data : null;
        });
        setUserVaults(userMap);
        // `/user` includes the same vault metrics as `/info` from a fresh getYieldVaultInfo(). The Earn
        // table reads `vaults` only; the vault detail prefers `userInfo`. Merge so TVL/totals match.
        const merged: Record<string, YieldVaultInfo | null> = {};
        VAULT_KEYS.forEach((key) => {
          merged[key] = userMap[key] ?? infoMap[key];
        });
        setVaults(merged);
      } else {
        setUserVaults({});
      }
    } catch (error: any) {
      if (
        controller.signal.aborted ||
        error?.name === "AbortError" ||
        error?.code === "ERR_CANCELED"
      ) {
        return;
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [isLoggedIn]);

  useEffect(() => {
    refreshVaults();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [refreshVaults]);

  const getVaultInfo = useCallback(
    (key: string) => vaults[key] ?? null,
    [vaults]
  );

  const getUserVaultInfo = useCallback(
    (key: string) => userVaults[key] ?? null,
    [userVaults]
  );

  return (
    <YieldVaultContext.Provider
      value={{ vaults, userVaults, loading, refreshVaults, getVaultInfo, getUserVaultInfo }}
    >
      {children}
    </YieldVaultContext.Provider>
  );
};

export const useYieldVaultContext = (): YieldVaultContextType => {
  const context = useContext(YieldVaultContext);
  if (!context) {
    throw new Error("useYieldVaultContext must be used within a YieldVaultProvider");
  }
  return context;
};
