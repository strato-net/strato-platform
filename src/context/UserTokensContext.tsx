// src/context/UserTokensContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import axios from "@/lib/axios"; // assuming your axios instance is set up here
import { Token } from "@/interface";

type UserTokensContextType = {
  tokens: Token[];
  loading: boolean;
  error: string | null;
  fetchTokens: (userAddress: string) => Promise<void>;
};

const UserTokensContext = createContext<UserTokensContextType | undefined>(undefined);

export const UserTokensProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTokens = async (userAddress: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`/tokens/table/balance?key=eq.${userAddress}`);
      setTokens(response.data);
    } catch (err: any) {
      console.error("Failed to fetch tokens:", err);
      setError("Failed to fetch token data");
    } finally {
      setLoading(false);
    }
  };

  return (
    <UserTokensContext.Provider value={{ tokens, loading, error, fetchTokens }}>
      {children}
    </UserTokensContext.Provider>
  );
};

export const useUserTokens = () => {
  const context = useContext(UserTokensContext);
  if (!context) {
    throw new Error("useUserTokens must be used within a UserTokensProvider");
  }
  return context;
};
