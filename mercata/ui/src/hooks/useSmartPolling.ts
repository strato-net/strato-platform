import { useState, useEffect, useRef, useCallback } from "react";
import { PollingConfig, PollingReturn, SwapPollingConfig } from "@/interface";

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

export const useOnRampPolling = (getOnRampData: () => Promise<any>, shouldPoll: (amount: string) => boolean = () => true) =>
  useSmartPolling({
    fetchFn: getOnRampData,
    shouldPoll,
    transformData: (data) => {
      const usdstListing = data?.listings?.find((l: any) => l.ListingInfo._name === "USDST");
      if (usdstListing) {
        const listingInfo = usdstListing.ListingInfo;
        const providers = (listingInfo.providers || []).filter((p: any) => p?.providerAddress && p?.name).map((p: any) => ({ name: p.name, providerAddress: p.providerAddress }));
        return { listingInfo, providers };
      }
      return null;
    },
    interval: 10000,
    onError: (error) => console.error("On-ramp polling error:", error)
  });

export const useFormPolling = (fetchFn: () => Promise<any>, shouldPoll: (amount: string) => boolean = () => true, onDataUpdate?: (data: any) => void) =>
  useSmartPolling({ fetchFn, shouldPoll, onDataUpdate, interval: 10000, onError: (error) => console.error("Form polling error:", error) });

// Optimized SwapWidget hook
export const useSwapPolling = ({ fromAsset, toAsset, fromAmount, editingField, getPoolByTokenPair, calculateSwap, setPool, setToAsset, setToAmount, setExchangeRate, lastCalculatedFromRef, interval = 10000 }: SwapPollingConfig) =>
  useSmartPolling({
    fetchFn: async () => {
      if (!fromAsset?.address || !toAsset?.address) return null;
      const poolData = await getPoolByTokenPair(fromAsset.address, toAsset.address);
      if (poolData) {
        setPool(poolData);
        const rate = poolData.tokenA?.address === fromAsset.address ? poolData.aToBRatio : poolData.bToARatio;
        setExchangeRate(rate || "0");
        if (fromAmount && fromAmount === lastCalculatedFromRef.current && editingField === null) {
          const parsedValue = require('ethers').safeParseUnits(fromAmount, 18);
          const isAToB = poolData.tokenA?.address === fromAsset.address;
          const swapAmount = await calculateSwap({ poolAddress: poolData.address, isAToB, amountIn: parsedValue.toString() });
          setToAmount(require('ethers').formatUnits(BigInt(swapAmount || "0"), 18));
        }
      } else {
        setPool(null); setToAsset(undefined); setToAmount(""); setExchangeRate("0");
      }
      return poolData;
    },
    shouldPoll: () => !!(fromAsset?.address && toAsset?.address && fromAmount && parseFloat(fromAmount) > 0 && editingField === null),
    interval,
    onError: (error) => console.error("Swap polling error:", error)
  }); 