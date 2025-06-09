// src/context/LendingContext.tsx

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
} from "react";
import isEqual from "lodash.isequal";

import { api } from "@/lib/axios";
import { DepositableToken, Loan, WithdrawableToken } from "@/interface";

interface LoanData {
  loans: Loan;
}

type LendingContextType = {
  depositableTokens: DepositableToken[];
  loans: Loan[];
  loadingDepositTokens: boolean;
  loadingLoans: boolean;
  errorDepositTokens: string | null;
  refreshDepositTokens: (signal?: AbortSignal) => Promise<void>;
  refreshLoans: (signal?: AbortSignal) => Promise<void>;
  withdrawableTokens: WithdrawableToken[];
  refreshWithdrawableTokens: (signal?: AbortSignal) => void;
  loadingWithdrawableTokens: boolean;
};

const LendingContext = createContext<LendingContextType | undefined>(undefined);

export const LendingProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [depositableTokens, setDepositableTokens] = useState<
    DepositableToken[]
  >([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loadingDepositTokens, setLoadingDepositTokens] = useState(true);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [errorDepositTokens, setErrorDepositTokens] = useState<string | null>(
    null
  );

  const [withdrawableTokens, setWithdrawableTokens] = useState<
    WithdrawableToken[]
  >([]);
  const [loadingWithdrawableTokens, setLoadingWithdrawableTokens] =
    useState(true);

  const fetchDepositTokens = async (signal?: AbortSignal) => {
    setLoadingDepositTokens(true);
    try {
      const res = await api.get<DepositableToken[]>("/depositableTokens", {
        signal,
      });
      if (res.data) {
        setDepositableTokens((prev) =>
          isEqual(prev, res.data) ? prev : res.data
        );
      }
      setErrorDepositTokens(null);
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") {
        // Request was aborted, do not update state
        return;
      }
      console.error("Error fetching depositable tokens:", err);
      setErrorDepositTokens(
        err.message || "Failed to load depositable tokens."
      );
    } finally {
      setLoadingDepositTokens(false);
    }
  };

  const fetchWithdrawableTokens = async (signal?: AbortSignal) => {
    setLoadingWithdrawableTokens(true);
    try {
      const res = await api.get<WithdrawableToken[]>("/withdrawableTokens", {
        signal,
      });
      if (res.data) {
        setWithdrawableTokens((prev) =>
          isEqual(prev, res.data) ? prev : res.data
        );
      }
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") {
        // Request was aborted, do not update state
        return;
      }
      console.error("Failed to fetch withdrawable tokens:", err);
    } finally {
      setLoadingWithdrawableTokens(false);
    }
  };

  const fetchLoans = async (signal?: AbortSignal) => {
    setLoadingLoans(true);
    try {
      const res = await api.get("/loans", { signal });

      const loanEntries: Loan[] = Array.isArray(res.data)
        ? res.data
        : Object.values((res.data as LoanData)?.loans || {});

      setLoans(loanEntries);
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch loans:", err);
      setLoans([]);
    } finally {
      setLoadingLoans(false);
    }
  };

  const initialize = () => {
    fetchDepositTokens();
    fetchLoans();
    fetchWithdrawableTokens();
  };

  useEffect(() => {
    initialize();
  }, []);

  const contextValue = useMemo(
    () => ({
      depositableTokens,
      loans,
      loadingDepositTokens,
      loadingLoans,
      errorDepositTokens,
      refreshDepositTokens: fetchDepositTokens,
      refreshLoans: fetchLoans,
      withdrawableTokens,
      refreshWithdrawableTokens: fetchWithdrawableTokens,
      loadingWithdrawableTokens,
    }),
    [
      depositableTokens,
      loans,
      loadingDepositTokens,
      loadingLoans,
      errorDepositTokens,
      withdrawableTokens,
      loadingWithdrawableTokens,
    ]
  );

  return (
    <LendingContext.Provider value={contextValue}>
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
