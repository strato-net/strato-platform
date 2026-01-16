import { useState, useEffect, useRef, useCallback } from "react";
import { PollingConfig, PollingReturn, PoolPollingConfig } from "@/interface";

export const useSmartPolling = (config: PollingConfig): PollingReturn => {
  const { fetchFn, shouldPoll = () => true, onDataUpdate, interval = 10000, autoStart = false, transformData, onError, enabled = true } = config;
  const [isPolling, setIsPolling] = useState(false);
  const [lastData, setLastData] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const intervalRef = useRef<NodeJS.Timeout>();
  const abortRef = useRef<AbortController>();
  const isMountedRef = useRef(true);
  const configRef = useRef({ fetchFn, transformData, onDataUpdate, onError, enabled });

  useEffect(() => { configRef.current = { fetchFn, transformData, onDataUpdate, onError, enabled }; });

  const fetchData = useCallback(async () => {
    const { fetchFn, transformData, onDataUpdate, onError, enabled } = configRef.current;
    if (!enabled || !isMountedRef.current) return null;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const rawData = await fetchFn();
      if (!isMountedRef.current) return null;
      const processedData = transformData ? transformData(rawData) : rawData;
      setLastData(processedData);
      setError(null);
      if (onDataUpdate && processedData !== undefined) onDataUpdate(processedData);
      return processedData;
    } catch (err: any) {
      if (!isMountedRef.current) return null;
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') return null;
      setError(err);
      onError ? onError(err) : console.error("Polling error:", err);
      return null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (!configRef.current.enabled || isPolling) return;
    setIsPolling(true);
    fetchData();
    intervalRef.current = setInterval(fetchData, interval);
  }, [isPolling, fetchData, interval]);

  const stopPolling = useCallback(() => {
    if (!isPolling) return;
    setIsPolling(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = undefined; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = undefined; }
  }, [isPolling]);

  useEffect(() => { if (autoStart && enabled && !isPolling) startPolling(); }, [autoStart, enabled]);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; stopPolling(); }; }, []);

  return { startPolling, stopPolling, isPolling, fetchData, lastData, error };
};

// Specialized hooks
export const useBalancePolling = (userAddress: string, fetchBalance: (address: string) => Promise<any>, shouldPoll: (amount: string) => boolean = () => true) =>
  useSmartPolling({ fetchFn: () => fetchBalance(userAddress), shouldPoll, interval: 10000, onError: (error) => console.error("Balance polling error:", error) });

// Optimized focused hooks

// Hook for managing pool data fetching and state
export const usePoolPolling = ({ fromAsset, toAsset, getPoolByTokenPair, fetchUsdstBalance, interval = 10000 }: PoolPollingConfig) =>
  useSmartPolling({
    fetchFn: async () => {
      if (!fromAsset?.address || !toAsset?.address) return null;
      // Use silentError=true to suppress toast notifications for polling errors
      const poolData = await getPoolByTokenPair(fromAsset.address, toAsset.address, undefined, true);
      // Also fetch USDST balance to keep it updated
      if (fetchUsdstBalance) {
        await fetchUsdstBalance();
      }
      return poolData;
    },
    shouldPoll: () => !!(fromAsset?.address && toAsset?.address),
    interval,
    onError: (error) => console.error("Pool polling error:", error)
  });