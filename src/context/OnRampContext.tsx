// src/context/OnRampContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import {api} from "@/lib/axios";
import { 
  OnRampContextType 
} from "@/interface";

const OnRampContext = createContext<OnRampContextType | undefined>(undefined);

export const OnRampProvider = ({ children }: { children: React.ReactNode }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);


  const get = async (): Promise<any> => {
    try {
      const res = await api.get("/onramp");
      return res.data;
    } catch (err) {
      console.error("Get onramp data failed:", err);
      throw err;
    }
  };

  const sell = async (body: any): Promise<any> => {
    try {
      const res = await api.post("/onramp/sell", body);
      return res.data;
    } catch (err) {
      console.error("OnRamp sell failed:", err);
      throw err;
    }
  };

  const lock = async (body: any): Promise<{ url: string }> => {
    try {
      const res = await api.post("/onramp/lock", body);
      return res.data;
    } catch (err) {
      console.error("OnRamp lock failed:", err);
      throw err;
    }
  };

  const unlockTokens = async (listingId: string): Promise<any> => {
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