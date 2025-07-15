// src/context/OnRampContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import {api} from "@/lib/axios";
import { 
  BuyPayload,
  OnrampApiResponse,
  OnRampContextType 
} from "@/interface";
import { parseUnits } from "ethers";

const OnRampContext = createContext<OnRampContextType | undefined>(undefined);

export const OnRampProvider = ({ children }: { children: React.ReactNode }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);


  const get = async (): Promise<OnrampApiResponse> => {
    try {
      const res = await api.get("/onramp");
      return res.data;
    } catch (err) {
      console.error("Get onramp data failed:", err);
      throw err;
    }
  };

  const buy = async (payload: BuyPayload, userAddress: string): Promise<{ url: string }> => {
    try {
      const weiAmount = parseUnits(payload.amount, 18).toString();
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
    } catch (err) {
      console.error("OnRamp buy failed:", err);
      throw err;
    }
  };

  const sell = async (payload) => {
    try {
    const weiAmount = parseUnits(payload.amount, 18).toString() ;
      const res = await api.post("/onramp/sell", {...payload, amount: weiAmount});
      return res.data;
    } catch (err) {
      console.error("OnRamp sell failed:", err);
      throw err;
    }
  };

  const lock = async (body): Promise<{ url: string }> => {
    try {
      const res = await api.post("/onramp/lock", body);
      return res.data;
    } catch (err) {
      console.error("OnRamp lock failed:", err);
      throw err;
    }
  };

  const unlockTokens = async (listingId: string) => {
    try {
      const res = await api.post("/onramp/unlock", { listingId });
      return res.data;
    } catch (err) {
      console.error("Unlock tokens failed:", err);
      throw err;
    }
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