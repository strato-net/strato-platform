import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/axios";
import { useUser } from "@/context/UserContext";
import {
  VAULT_KEYS,
  YieldVaultContext,
  type YieldVaultInfo,
  type YieldVaultUserInfo,
} from "./YieldVaultContext.shared";

export type {
  YieldVaultContextType,
  YieldVaultHistoryPoint,
  YieldVaultInfo,
  YieldVaultPendingWithdrawal,
  YieldVaultUserInfo,
} from "./YieldVaultContext.shared";

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
        // `/user` already includes the same vault-level metrics as `/info`, so use it directly
        // for signed-in users instead of doing a second round trip per vault.
        setVaults(userMap);
      } else {
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
        setUserVaults({});
      }
    } catch (error: unknown) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && (
          error.name === "AbortError" ||
          "code" in error && error.code === "ERR_CANCELED"
        ))
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
