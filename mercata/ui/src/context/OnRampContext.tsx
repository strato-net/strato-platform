// src/context/OnRampContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import {api} from "@/lib/axios";
import { 
  BuyPayload,
  OnrampApiResponse,
  OnRampContextType 
} from "@/interface";
import { safeParseUnits } from "@/utils/numberUtils";

const OnRampContext = createContext<OnRampContextType | undefined>(undefined);

export const OnRampProvider = ({ children }: { children: React.ReactNode }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);


  const get = async (): Promise<OnrampApiResponse> => {
    const res = await api.get("/onramp");
    return res.data;
  };

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

  const sell = async (payload) => {
    const weiAmount = safeParseUnits(payload.amount, 18).toString() ;
    const res = await api.post("/onramp/sell", {...payload, amount: weiAmount});
    return res.data;
  };

  const lock = async (body): Promise<{ url: string }> => {
    const res = await api.post("/onramp/lock", body);
    return res.data;
  };

  const unlockTokens = async (listingId: string) => {
    const res = await api.post("/onramp/unlock", { listingId });
    return res.data;
  };

  const addPaymentProvider = async (providerData: {
    providerAddress: string;
    name: string;
    endpoint: string;
  }) => {
    const res = await api.post("/onramp/addPaymentProvider", providerData);
    // Ensure we return a consistent format
    if (typeof res.data === 'string') {
      return { message: res.data };
    }
    return res.data;
  };

  const removePaymentProvider = async (providerAddress: string) => {
    const res = await api.post("/onramp/removePaymentProvider", { providerAddress });
    // Ensure we return a consistent format
    if (typeof res.data === 'string') {
      return { message: res.data };
    }
    return res.data;
  };

  const cancelListing = async (token: string) => {
    const res = await api.post("/onramp/cancelListing", { token });
    // Ensure we return a consistent format
    if (typeof res.data === 'string') {
      return { message: res.data };
    }
    return res.data;
  };

  return (
    <OnRampContext.Provider
      value={{
        token: null,
        loading,
        error,
        
        get,
        buy,
        sell,
        lock,
        unlockTokens,
        addPaymentProvider,
        removePaymentProvider,
        cancelListing,
        
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