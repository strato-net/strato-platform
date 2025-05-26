// src/context/LendingContext.tsx

import React, { createContext, useContext, useEffect, useState } from "react";

import api from "@/lib/axios";
import { DepositableToken, Loan } from "@/interface";

interface LoanData {
  loans: Loan[];
}

type LendingContextType = {
  depositableTokens: DepositableToken[];
  loans: Loan[];
  loadingDepositTokens: boolean;
  loadingLoans: boolean;
  errorDepositTokens: string | null;
  refreshDepositTokens: () => void;
  refreshLoans: () => void;
};

const LendingContext = createContext<LendingContextType | undefined>(undefined);

export const LendingProvider = ({ children }: { children: React.ReactNode }) => {
  const [depositableTokens, setDepositableTokens] = useState<DepositableToken[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loadingDepositTokens, setLoadingDepositTokens] = useState(true);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [errorDepositTokens, setErrorDepositTokens] = useState<string | null>(null);

  const fetchDepositTokens = async () => {
    setLoadingDepositTokens(true);
    try {
      const res = await api.get<DepositableToken[]>("/depositableTokens");
      if (res.data) {
        setDepositableTokens(res.data);
      }
      setErrorDepositTokens(null);
    } catch (err: any) {
      console.error("Error fetching depositable tokens:", err);
      setErrorDepositTokens(err.message || "Failed to load depositable tokens.");
    } finally {
      setLoadingDepositTokens(false);
    }
  };

  const fetchLoans = async () => {
    setLoadingLoans(true);
    try {
      const res = await api.get<LoanData>("/loans");
      if (res.data && res.data.loans) {
        setLoans(Object.values(res.data.loans));
      } else {
        setLoans([]);
      }
    } catch (err) {
      console.error("Failed to fetch loans:", err);
    } finally {
      setLoadingLoans(false);
    }
  };

  const initialize = () => {
    fetchDepositTokens();
    fetchLoans();
  };

  useEffect(() => {
    initialize();
  }, []);

  return (
    <LendingContext.Provider
      value={{
        depositableTokens,
        loans,
        loadingDepositTokens,
        loadingLoans,
        errorDepositTokens,
        refreshDepositTokens: fetchDepositTokens,
        refreshLoans: fetchLoans,
      }}
    >
      {children}
    </LendingContext.Provider>
  );
};

export const useLendingContext = () => {
  const context = useContext(LendingContext);
  if (!context) {
    throw new Error("useLendingContext must be used within a LendingProvider");
  }
  return context;
};