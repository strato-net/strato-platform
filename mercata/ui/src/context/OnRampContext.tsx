// src/context/OnRampContext.tsx
import React, { createContext, useContext, useState, useCallback } from "react";
import {api} from "@/lib/axios";
import { 
  BuyPayload,
  SellPayload,
  OnrampApiResponse,
  OnRampContextType,
  PaymentProvider,
  Listing,
  AddPaymentProviderData 
} from "@/interface";
import { safeParseUnits } from "@/utils/numberUtils";

const OnRampContext = createContext<OnRampContextType | undefined>(undefined);

export const OnRampProvider = ({ children }: { children: React.ReactNode }) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [onRampData, setOnRampData] = useState<OnrampApiResponse | null>(null);
  const [providers, setProviders] = useState<PaymentProvider[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);

  const get = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/onramp");
      const data = res.data;
      setOnRampData(data);
      
      // Set providers
      const providersList = data?.paymentProviders || [];
      setProviders(providersList);
      
      // Set listings
      const listingsList = data?.listings || [];
      setListings(listingsList);
      
      return data;
    } catch (err: any) {
      setError(err?.message || "Failed to fetch OnRamp data");
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const buy = async (payload: BuyPayload, userAddress: string): Promise<{ url: string }> => {
    const weiAmount = safeParseUnits(payload.amount, 18).toString();
    const buyPayload = {
      token: payload.token,
      amount: weiAmount,
      paymentProviderAddress: payload.paymentProviderAddress,
    };

    const headers = {
      address: userAddress,
    };

    const res = await api.post("/onramp/buy", buyPayload, { headers });
    return res.data;
  };

  const sell = async (payload: SellPayload) => {
    const weiAmount = safeParseUnits(payload.amount, 18).toString();
    const res = await api.post("/onramp/sell", {...payload, amount: weiAmount});
    return res.data;
  };

  const lock = async (body: any): Promise<{ url: string }> => {
    const res = await api.post("/onramp/lock", body);
    return res.data;
  };

  const unlockTokens = async (listingId: string) => {
    const res = await api.post("/onramp/unlock", { listingId });
    return res.data;
  };

  const addPaymentProvider = useCallback(async (providerData: AddPaymentProviderData) => {
    const res = await api.post("/onramp/addPaymentProvider", providerData);
    await get();
    return res.data;
  }, [get]);

  const removePaymentProvider = useCallback(async (providerAddress: string) => {
    const res = await api.post("/onramp/removePaymentProvider", { providerAddress });
    await get();
    return res.data;
  }, [get]);

  const cancelListing = useCallback(async (token: string) => {
    const res = await api.post("/onramp/cancelListing", { token });
    await get();
    return res.data;
  }, [get]);

  const updateListing = useCallback(async (payload: {
    token: string;
    amount: string;
    marginBps: string;
    providerAddresses: string[];
  }) => {
    const res = await api.post("/onramp/updateListing", payload);
    await get();
    return res.data;
  }, [get]);

  return (
    <OnRampContext.Provider
      value={{
        token: null,
        loading,
        error,
        onRampData,
        providers,
        listings,
        get,
        buy,
        sell,
        lock,
        unlockTokens,
        addPaymentProvider,
        removePaymentProvider,
        cancelListing,
        updateListing,
        
      }}
    >
      {children}
    </OnRampContext.Provider>
  );
};

export const useOnRampContext = () => {
  const context = useContext(OnRampContext);
  if (!context) {
    throw new Error("useOnRampContext must be used within an OnRampProvider");
  }
  return context;
};