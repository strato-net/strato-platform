import { useState, useEffect, useRef, useCallback } from "react";
import { PollingConfig, PollingReturn, PoolPollingConfig } from "@/interface";

export const useSmartPolling = (config: PollingConfig): PollingReturn => {
  const { fetchFn, shouldPoll = () => true, onDataUpdate, interval = 10000, autoStart = false, transformData, onError, enabled = true, onVisibilityChange } = config;
  const [isPolling, setIsPolling] = useState(false);
  const [lastData, setLastData] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const intervalRef = useRef<NodeJS.Timeout>();
  const abortRef = useRef<AbortController>();
  const isMountedRef = useRef(true);
  const visibilityTimeoutRef = useRef<NodeJS.Timeout>();
  const isPollingRef = useRef(false);
  const configRef = useRef({ fetchFn, transformData, onDataUpdate, onError, enabled, shouldPoll, onVisibilityChange });

  useEffect(() => {
    configRef.current = { fetchFn, transformData, onDataUpdate, onError, enabled, shouldPoll, onVisibilityChange };
  });
  useEffect(() => {
    isPollingRef.current = isPolling;
  }, [isPolling]);

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
    if (!configRef.current.enabled || isPollingRef.current) return;
    setIsPolling(true);
    fetchData();
    intervalRef.current = setInterval(fetchData, interval);
  }, [fetchData, interval]);

  const stopPolling = useCallback(() => {
    if (!isPollingRef.current) return;
    setIsPolling(false);
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = undefined; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = undefined; }
  }, []);

  const resumePolling = useCallback(() => {
    const { enabled, shouldPoll } = configRef.current;
    if (enabled && (!shouldPoll || shouldPoll("")) && !isPollingRef.current) {
      fetchData();
      setIsPolling(true);
      intervalRef.current = setInterval(fetchData, interval);
    }
  }, [fetchData, interval]);

  // Visibility-aware polling: pause when hidden, resume and refresh when visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden;
      configRef.current.onVisibilityChange?.(!isHidden);
      
      if (isHidden) {
        if (isPollingRef.current && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
          setIsPolling(false);
        }
      } else {
        if (visibilityTimeoutRef.current) clearTimeout(visibilityTimeoutRef.current);
        visibilityTimeoutRef.current = setTimeout(resumePolling, 200);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityTimeoutRef.current) clearTimeout(visibilityTimeoutRef.current);
    };
  }, [resumePolling]);

  useEffect(() => {
    if (autoStart && enabled && !isPolling) startPolling();
  }, [autoStart, enabled, isPolling, startPolling]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  return { startPolling, stopPolling, isPolling, fetchData, lastData, error };
};

// Specialized hooks
export const useBalancePolling = (userAddress: string, fetchBalance: (address: string) => Promise<any>, shouldPoll: (amount: string) => boolean = () => true) =>
  useSmartPolling({ fetchFn: () => fetchBalance(userAddress), shouldPoll, interval: 10000, onError: (error) => console.error("Balance polling error:", error) });

// Optimized focused hooks

// Hook for managing pool data fetching and state
export const usePoolPolling = ({ fromAsset, toAsset, getPoolByTokenPair, fetchUsdstBalance, userAddress, interval = 10000, onVisibilityChange }: PoolPollingConfig) =>
  useSmartPolling({
    fetchFn: async () => {
      if (!fromAsset?.address || !toAsset?.address) return null;
      const poolData = await getPoolByTokenPair(fromAsset.address, toAsset.address);
      // Also fetch USDST balance to keep it updated
      if (userAddress && fetchUsdstBalance) {
        await fetchUsdstBalance(userAddress);
      }
      return poolData;
    },
    shouldPoll: () => !!(fromAsset?.address && toAsset?.address),
    interval,
    onError: (error) => console.error("Pool polling error:", error),
    onVisibilityChange
  });