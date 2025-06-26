import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
} from "react";
import isEqual from "lodash.isequal";
import { parseUnits } from "ethers";
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
  refreshLoans: (signal?: AbortSignal) => Promise<Loan[] | undefined>;
  withdrawableTokens: WithdrawableToken[];
  refreshWithdrawableTokens: (signal?: AbortSignal) => void;
  loadingWithdrawableTokens: boolean;
  setPrice: (payload: { token: string; price: string }) => Promise<void>;
  setInterestRate: (payload: { asset: string; rate: number }) => Promise<void>;
  setCollateralRatio: (payload: { asset: string; ratio: number }) => Promise<void>;
  setLiquidationBonus: (payload: { asset: string; bonus: number }) => Promise<void>;
  refreshLendingData: () => Promise<void>;
  borrowAsset: (args: {
    asset: string;
    amount: string;
    collateralAsset: string;
    collateralAmount: string;
  }) => Promise<any>;
  repayLoan: (args: {
    loanId: string;
    amount: string;
    asset: string;
  }) => Promise<any>;
  getLend: () => Promise<any>;
  depositLiquidity: (args: { asset: string; amount: string }) => Promise<any>;
  withdrawLiquidity: (args: { asset: string; amount: string }) => Promise<any>;
};

const LendingContext = createContext<LendingContextType | undefined>(undefined);

export const LendingProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [depositableTokens, setDepositableTokens] = useState<DepositableToken[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loadingDepositTokens, setLoadingDepositTokens] = useState(true);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [errorDepositTokens, setErrorDepositTokens] = useState<string | null>(null);

  const [withdrawableTokens, setWithdrawableTokens] = useState<WithdrawableToken[]>([]);
  const [loadingWithdrawableTokens, setLoadingWithdrawableTokens] = useState(true);

  const fetchDepositTokens = async (signal?: AbortSignal) => {
    setLoadingDepositTokens(true);
    try {
      const res = await api.get<DepositableToken[]>("/lend/depositableTokens", {
        signal,
      });
      if (res.data) {
        setDepositableTokens((prev) => (isEqual(prev, res.data) ? prev : res.data));
      }
      setErrorDepositTokens(null);
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Error fetching depositable tokens:", err);
      setErrorDepositTokens(err.message || "Failed to load depositable tokens.");
    } finally {
      setLoadingDepositTokens(false);
    }
  };

  const fetchWithdrawableTokens = async (signal?: AbortSignal) => {
    setLoadingWithdrawableTokens(true);
    try {
      const res = await api.get<WithdrawableToken[]>("/lend/withdrawableTokens", {
        signal,
      });
      if (res.data) {
        const changed = JSON.stringify(withdrawableTokens.map(t => ({ ...t, value: BigInt(t.value).toString() })))
          !== JSON.stringify(res.data.map(t => ({ ...t, value: BigInt(t.value).toString() })));

        if (changed) {
          setWithdrawableTokens(res.data);
        }
      }
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch withdrawable tokens:", err);
    } finally {
      setLoadingWithdrawableTokens(false);
    }
  };

  const fetchLoans = async (signal?: AbortSignal) => {
    setLoadingLoans(true);
    try {
      const res = await api.get("/lend/loans", { signal });

      const loanEntries: Loan[] = Array.isArray(res.data)
        ? res.data
        : Object.values((res.data as LoanData)?.loans || {});
      setLoans(loanEntries);
      return loanEntries;
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch loans:", err);
      setLoans([]);
      return [];
    } finally {
      setLoadingLoans(false);
    }
  };

  const setPrice = async (payload: { token: string; price: string }): Promise<void> => {
    const weiPrice = parseUnits(payload.price, 18).toString();
    try {
      await api.post("/oracle/price", { ...payload, price: weiPrice.toString() });
    } catch (err: any) {
      console.error("Failed to set price:", err);
      throw err;
    }
  };

  const setInterestRate = async (payload: { asset: string; rate: number }): Promise<void> => {
    try {
      await api.post("/lend/setInterestRate", payload);
    } catch (err: any) {
      console.error("Failed to set interest rate:", err);
      throw err;
    }
  };

  const setCollateralRatio = async (payload: { asset: string; ratio: number }): Promise<void> => {
    try {
      await api.post("/lend/setCollateralRatio", payload);
    } catch (err: any) {
      console.error("Failed to set collateral ratio:", err);
      throw err;
    }
  };

  const setLiquidationBonus = async (payload: { asset: string; bonus: number }): Promise<void> => {
    try {
      await api.post("/lend/setLiquidationBonus", payload);
    } catch (err: any) {
      console.error("Failed to set liquidation bonus:", err);
      throw err;
    }
  };

  const borrowAsset = async ({
    asset,
    amount,
    collateralAsset,
    collateralAmount,
  }: {
    asset: string;
    amount: string;
    collateralAsset: string;
    collateralAmount: string;
  }) => {
    try {
      const res = await api.post("/lend/borrow", {
        asset,
        amount,
        collateralAsset,
        collateralAmount,
      });
      return res;
    } catch (err: any) {
      console.error("Borrow failed:", err);
      throw err;
    }
  };

  const repayLoan = async ({
    loanId,
    amount,
    asset,
  }: {
    loanId: string;
    amount: string;
    asset: string;
  }) => {
    try {
      const res = await api.post("/lend/repay", {
        loanId,
        amount,
        asset,
      });
      return res;
    } catch (err: any) {
      console.error("Repay failed:", err);
      throw err;
    }
  };

  const getLend = async () => {
    try {
      const res = await api.get("/lend/");
      return res.data;
    } catch (err: any) {
      console.error("Get lend failed:", err);
      throw err;
    }
  };

  const depositLiquidity = async (args: { asset: string; amount: string }) => {
    try {
      const res = await api.post("/lend/depositLiquidity", args);
      return res;
    } catch (err: any) {
      console.error("Deposit liquidity failed:", err);
      throw err;
    }
  };

  const withdrawLiquidity = async (args: { asset: string; amount: string }) => {
    try {
      const res = await api.post("/lend/withdrawLiquidity", args);
      return res;
    } catch (err: any) {
      console.error("Withdraw liquidity failed:", err);
      throw err;
    }
  };

  const refreshLendingData = async (): Promise<void> => {
    try {
      // Refresh all lending-related data
      await fetchDepositTokens();
      await fetchLoans();
      await fetchWithdrawableTokens();
    } catch (err: any) {
      console.error("Failed to refresh lending data:", err);
      throw err;
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
      setPrice,
      setInterestRate,
      setCollateralRatio,
      setLiquidationBonus,
      refreshLendingData,
      borrowAsset,
      repayLoan,
      getLend,
      depositLiquidity,
      withdrawLiquidity,
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
