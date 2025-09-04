import { useState, useEffect, useRef, useCallback } from "react";
import { parseUnits, formatUnits } from "ethers";
import { PollingConfig, PollingReturn, PoolPollingConfig, ExchangeRateConfig, SwapCalculationConfig, SwapStateCleanupConfig } from "@/interface";

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

export const useFormPolling = (fetchFn: () => Promise<any>, shouldPoll: (amount: string) => boolean = () => true, onDataUpdate?: (data: any) => void) =>
  useSmartPolling({ fetchFn, shouldPoll, onDataUpdate, interval: 10000, onError: (error) => console.error("Form polling error:", error) });

// Optimized focused hooks

// Hook for managing pool data fetching and state
export const usePoolPolling = ({ fromAsset, toAsset, getPoolByTokenPair, setPool, interval = 10000 }: PoolPollingConfig) =>
  useSmartPolling({
    fetchFn: async () => {
      if (!fromAsset?.address || !toAsset?.address) return null;
      const poolData = await getPoolByTokenPair(fromAsset.address, toAsset.address);
      if (poolData) {
        setPool(poolData); // Only set pool if we got valid data
      }
      return poolData;
    },
    shouldPoll: () => !!(fromAsset?.address && toAsset?.address),
    interval,
    onError: (error) => console.error("Pool polling error:", error)
  });

// Hook for managing exchange rate calculations
export const useExchangeRate = ({ poolData, fromAsset, setExchangeRate }: ExchangeRateConfig) =>
  useEffect(() => {
    const rate = poolData ? (poolData.tokenA?.address === fromAsset?.address ? poolData.aToBRatio : poolData.bToARatio) || "0" : "0";
    setExchangeRate(rate);
  }, [poolData, fromAsset?.address, setExchangeRate]);

// Hook for managing swap calculations
export const useSwapCalculation = ({ poolData, fromAsset, fromAmount, editingField, calculateSwap, setToAmount, lastCalculatedFromRef }: SwapCalculationConfig) =>
  useEffect(() => {
    if (!poolData || !fromAmount || fromAmount !== lastCalculatedFromRef.current || editingField !== null) return;

    const calculateSwapAmount = async () => {
      try {
        const parsedValue = parseUnits(fromAmount, 18);
        const isAToB = poolData.tokenA?.address === fromAsset?.address;
        const swapAmount = await calculateSwap({ poolAddress: poolData.address, isAToB, amountIn: parsedValue.toString() });
        setToAmount(formatUnits(BigInt(swapAmount || "0"), 18));
      } catch (error) {
        console.error("Swap calculation error:", error);
      }
    };

    calculateSwapAmount();
  }, [poolData, fromAsset?.address, fromAmount, editingField, calculateSwap, setToAmount, lastCalculatedFromRef]);

// Hook for managing swap state cleanup
export const useSwapStateCleanup = ({ poolData, setToAsset, setExchangeRate }: SwapStateCleanupConfig) =>
  useEffect(() => {
    if (poolData === null) {
      setToAsset(undefined);
      setExchangeRate("0");
    }
  }, [poolData, setToAsset, setExchangeRate]);