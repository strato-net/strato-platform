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

export type SaveUsdstInfo = {
  configured: boolean;
  deployed: boolean;
  vaultAddress: string;
  assetAddress: string;
  assetSymbol: string;
  shareSymbol: string;
  totalManagedAssets: string;
  totalAssets: string;
  pricingAssets: string;
  projectedPricingAssets: string;
  tvlUsd: string;
  projectedTvlUsd: string;
  totalShares: string;
  exchangeRate: string;
  projectedExchangeRate: string;
  pendingAccrual: string;
  pendingAccrualTarget: string;
  apy: string;
  paused: boolean;
};

export type SaveUsdstUserInfo = SaveUsdstInfo & {
  walletAssets: string;
  userShares: string;
  redeemableAssets: string;
  projectedRedeemableAssets: string;
  maxDeposit: string;
  maxRedeem: string;
  maxWithdraw: string;
  userTotalDepositedAssets: string;
  userTotalWithdrawnAssets: string;
  userNetDepositedAssets: string;
  userAllTimeEarningsAssets: string;
};

export type SaveUsdstHistoryPoint = {
  timestamp: number;
  exchangeRate: string;
  pricingAssets: string;
  totalShares: string;
};

type SaveUsdstContextType = {
  saveUsdstInfo: SaveUsdstInfo | null;
  saveUsdstUserInfo: SaveUsdstUserInfo | null;
  saveUsdstHistory: SaveUsdstHistoryPoint[];
  loadingSaveUsdst: boolean;
  refreshSaveUsdst: () => Promise<void>;
};

const SaveUsdstContext = createContext<SaveUsdstContextType | undefined>(undefined);

export const SaveUsdstProvider = ({ children }: { children: ReactNode }) => {
  const { isLoggedIn } = useUser();
  const [saveUsdstInfo, setSaveUsdstInfo] = useState<SaveUsdstInfo | null>(null);
  const [saveUsdstUserInfo, setSaveUsdstUserInfo] = useState<SaveUsdstUserInfo | null>(null);
  const [saveUsdstHistory, setSaveUsdstHistory] = useState<SaveUsdstHistoryPoint[]>([]);
  const [loadingSaveUsdst, setLoadingSaveUsdst] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshSaveUsdst = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setLoadingSaveUsdst(true);

    try {
      const [infoResult, userResult, historyResult] = await Promise.allSettled([
        api.get<SaveUsdstInfo>("/earn/save-usdst/info", { signal: controller.signal }),
        isLoggedIn
          ? api.get<SaveUsdstUserInfo>("/earn/save-usdst/user", { signal: controller.signal })
          : Promise.resolve({ data: null } as { data: null }),
        api.get<SaveUsdstHistoryPoint[]>("/earn/save-usdst/history", { signal: controller.signal }),
      ]);

      if (controller.signal.aborted) return;

      setSaveUsdstInfo(infoResult.status === "fulfilled" ? infoResult.value.data : null);
      setSaveUsdstUserInfo(
        userResult.status === "fulfilled" ? userResult.value.data : null
      );
      setSaveUsdstHistory(
        historyResult.status === "fulfilled" ? historyResult.value.data : []
      );
    } catch (error: any) {
      if (controller.signal.aborted || error?.name === "AbortError" || error?.code === "ERR_CANCELED") {
        return;
      }

      setSaveUsdstInfo(null);
      setSaveUsdstUserInfo(null);
      setSaveUsdstHistory([]);
    } finally {
      if (!controller.signal.aborted) {
        setLoadingSaveUsdst(false);
      }
    }
  }, [isLoggedIn]);

  useEffect(() => {
    refreshSaveUsdst();

    return () => {
      abortControllerRef.current?.abort();
    };
  }, [refreshSaveUsdst]);

  return (
    <SaveUsdstContext.Provider
      value={{
        saveUsdstInfo,
        saveUsdstUserInfo,
        saveUsdstHistory,
        loadingSaveUsdst,
        refreshSaveUsdst,
      }}
    >
      {children}
    </SaveUsdstContext.Provider>
  );
};

export const useSaveUsdstContext = (): SaveUsdstContextType => {
  const context = useContext(SaveUsdstContext);
  if (!context) {
    throw new Error("useSaveUsdstContext must be used within a SaveUsdstProvider");
  }
  return context;
};
