import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { parseUnits } from "ethers";
import { api } from "@/lib/axios";
import { Loan, WithdrawableToken } from "@/interface";
import { useUser } from "@/context/UserContext";


type LendingContextType = {
  loans: Loan[];
  loadingLoans: boolean;
  refreshLoans: (signal?: AbortSignal) => Promise<Loan[] | undefined>;
  liquidityInfo: any;
  refreshLiquidity: (signal?: AbortSignal) => void;
  loadingLiquidity: boolean;
  setPrice: (payload: { token: string; price: string }) => Promise<void>;
  setInterestRate: (payload: { asset: string; rate: number }) => Promise<void>;
  setCollateralRatio: (payload: { asset: string; ratio: number }) => Promise<void>;
  setLiquidationBonus: (payload: { asset: string; bonus: number }) => Promise<void>;
  refreshLendingData: () => Promise<void>;
  borrowAsset: (args: {
    amount: string;
  }) => Promise<any>;
  repayLoan: (args: {
    amount: string;
  }) => Promise<any>;
  getLend: () => Promise<any>;
  depositLiquidity: (args: { amount: string }) => Promise<any>;
  withdrawLiquidity: (args: { amount: string }) => Promise<any>;

  collateralInfo: any;
  refreshCollateral: (signal?: AbortSignal) => void;
  loadingCollateral: boolean;
  supplyCollateral: (args: { asset: string; amount: string }) => Promise<any>;
  withdrawCollateral: (args: { asset: string; amount: string }) => Promise<any>;
};

const LendingContext = createContext<LendingContextType | undefined>(undefined);

export const LendingProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loadingLoans, setLoadingLoans] = useState(true);

  const [liquidityInfo, setLiquidityInfo] = useState<any>()
  const [loadingLiquidity, setLoadingLiquidity] = useState(true);
  const [collateralInfo, setCollateralInfo] = useState<any>()
  const [loadingCollateral, setLoadingCollateral] = useState(true)

  // Access authentication status
  const { isLoggedIn } = useUser();

  const fetchLiquidityInfo = useCallback(async (signal?: AbortSignal) => {
    setLoadingLiquidity(true);
    try {
      const res = await api.get<WithdrawableToken[]>("/lending/liquidity", {
        signal,
      });
      if (res.data) {
          setLiquidityInfo(res.data);
      }
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch withdrawable tokens:", err);
    } finally {
      setLoadingLiquidity(false);
    }
  }, []);

  const fetchCollateralInfo = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoadingCollateral(true);
      const res = await api.get<WithdrawableToken[]>("/lending/collateral", {
        signal,
      });
      if (res.data) {
          setCollateralInfo(res.data);
      }
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch withdrawable tokens:", err);
    } finally {
      setLoadingCollateral(false);
    }
  }, []); 

  const fetchLoans = useCallback(async (signal?: AbortSignal) => {
    setLoadingLoans(true);
    try {
      const res = await api.get("/lending/loans", { signal });
      setLoans(res.data);
      return res.data;
    } catch (err: any) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch loans:", err);
      setLoans([]);
      return [];
    } finally {
      setLoadingLoans(false);
    }
  }, []);

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
    amount,
  }: {
    amount: string;
  }) => {
    try {
      const res = await api.post("/lending/loans", {
        amount,
      });
      return res;
    } catch (err: any) {
      console.error("Borrow failed:", err);
      throw err;
    }
  };

  const repayLoan = async ({
    amount,
  }: {
    loanId: string;
    amount: string;
    asset: string;
  }) => {
    try {
      const res = await api.patch("/lending/loans", {
        amount,
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

  const depositLiquidity = async (args: { amount: string }) => {
    try {
      const res = await api.post("/lending/pools/liquidity", args);
      return res;
    } catch (err: any) {
      console.error("Deposit liquidity failed:", err);
      throw err;
    }
  };

  const withdrawLiquidity = async (args: { amount: string }) => {
    try {
      const res = await api.delete("/lending/pools/liquidity", {data: args});
      return res;
    } catch (err: any) {
      console.error("Withdraw liquidity failed:", err);
      throw err;
    }
  };

  const supplyCollateral = async (args: { asset: string, amount: string }) => {
    try {
      const res = await api.post("/lending/collateral", args);
      return res;
    } catch (err: any) {
      console.error("Withdraw liquidity failed:", err);
      throw err;
    }
  };

  const withdrawCollateral = async (args: { asset: string, amount: string }) => {
    try {
      const res = await api.delete("/lending/collateral", {data: args});
      return res;
    } catch (err: any) {
      console.error("Withdraw liquidity failed:", err);
      throw err;
    }
  };

  const refreshLendingData = async (): Promise<void> => {
    try {
      // Refresh all lending-related data
      await fetchLoans();
      await fetchLiquidityInfo()
      await fetchCollateralInfo()
    } catch (err: any) {
      console.error("Failed to refresh lending data:", err);
      throw err;
    }
  };


  const initialize = () => {
    fetchLoans();
    fetchLiquidityInfo();
    fetchCollateralInfo();
  };

  // Run initialization only when the user is logged in
  useEffect(() => {
    if (isLoggedIn) {
      initialize();
    }
  }, [isLoggedIn]);

  const contextValue = useMemo(
    () => ({
      loans,
      loadingLoans,
      refreshLoans: fetchLoans,
      liquidityInfo,
      loadingLiquidity,
      refreshLiquidity : fetchLiquidityInfo,
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
      collateralInfo,
      loadingCollateral,
      refreshCollateral: fetchCollateralInfo,
      supplyCollateral,
      withdrawCollateral,
    }),
    [
      loans,
      loadingLoans,
      liquidityInfo,
      loadingLiquidity,
      loadingCollateral
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
