import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
} from "react";
import { safeParseUnits } from "@/utils/numberUtils";
import { api } from "@/lib/axios";
import { CollateralData, LendData, LiquidityData, NewLoanData } from "@/interface";
import { useUser } from "@/context/UserContext";


type LendingContextType = {
  loans: NewLoanData;
  loadingLoans: boolean;
  refreshLoans: (signal?: AbortSignal) => Promise<NewLoanData[] | undefined>;
  liquidityInfo: LiquidityData;
  refreshLiquidity: (signal?: AbortSignal) => void;
  loadingLiquidity: boolean;
  setPrice: (payload: { token: string; price: string }) => Promise<void>;
  configureAsset: (payload: { 
    asset: string; 
    ltv: number; 
    liquidationThreshold: number; 
    liquidationBonus: number; 
    interestRate: number; 
    reserveFactor: number; 
    perSecondFactorRAY: string;
  }) => Promise<void>;
  loading: boolean;
  refreshLendingData: () => Promise<void>;
  borrowAsset: (args: {
    amount: string;
  }) => Promise<void>;
  borrowMax: () => Promise<void>;
  repayLoan: (args: {
    amount: string;
  }) => Promise<{ status: string; hash: string; amountSent?: string }>;
  repayAll: () => Promise<{ status: string; hash: string; amountRequested?: string; estimatedDebtAtRead?: string }>;
  getLend: () => Promise<LendData>;
  depositLiquidity: (args: { amount: string; stakeMToken: boolean }) => Promise<void>;
  withdrawLiquidity: (args: { amount: string }) => Promise<void>;
  withdrawLiquidityAll: () => Promise<void>;

  collateralInfo: CollateralData[];
  refreshCollateral: (signal?: AbortSignal) => void;
  loadingCollateral: boolean;
  supplyCollateral: (args: { asset: string; amount: string }) => Promise<void>;
  withdrawCollateral: (args: { asset: string; amount: string }) => Promise<void>;
  withdrawCollateralMax: (args: { asset: string }) => Promise<void>;
};

const LendingContext = createContext<LendingContextType | undefined>(undefined);

export const LendingProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [loans, setLoans] = useState<NewLoanData>();
  const [loadingLoans, setLoadingLoans] = useState(true);

  const [liquidityInfo, setLiquidityInfo] = useState<LiquidityData>()
  const [loadingLiquidity, setLoadingLiquidity] = useState(true);
  const [collateralInfo, setCollateralInfo] = useState<CollateralData[]>()
  const [loadingCollateral, setLoadingCollateral] = useState(true)
  const [loading, setLoading] = useState(false);

  // Access authentication status
  const { isLoggedIn } = useUser();

  const fetchLiquidityInfo = useCallback(async (signal?: AbortSignal) => {
    setLoadingLiquidity(true);
    try {
      const res = await api.get<LiquidityData>("/lending/liquidity", {
        signal,
      });
      if (res.data) {
          setLiquidityInfo(res.data);
      }
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
    } finally {
      setLoadingLiquidity(false);
    }
  }, []);

  const fetchCollateralInfo = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoadingCollateral(true);
      const res = await api.get<CollateralData[]>("/lending/collateral", {
        signal,
      });
      if (res.data) {
          setCollateralInfo(res.data);
      }
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
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
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      return [];
    } finally {
      setLoadingLoans(false);
    }
  }, []);

  const setPrice = async (payload: { token: string; price: string }): Promise<void> => {
    const weiPrice = safeParseUnits(payload.price, 18).toString();
    await api.post("/oracle/price", { ...payload, price: weiPrice.toString() });
  };

  const configureAsset = async (payload: { 
    asset: string; 
    ltv: number; 
    liquidationThreshold: number; 
    liquidationBonus: number; 
    interestRate: number; 
    reserveFactor: number; 
    perSecondFactorRAY: string;
  }): Promise<void> => {
    setLoading(true);
    try {
      await api.post("/lend/admin/configure-asset", payload);
    } catch (err: any) {
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const borrowAsset = async ({
    amount,
  }: {
    amount: string;
  }) => {
    await api.post("/lending/loans", {
      amount
    });
  };

  const borrowMax = async () => {
    await api.post("/lending/loans/borrow-max");
  };

  const repayLoan = async ({
    amount,
  }: {
    loanId: string;
    amount: string;
    asset: string;
  }): Promise<{ status: string; hash: string; amountSent?: string }> => {
    const res = await api.patch("/lending/loans", {
      amount
    });
    return res.data;
  };

  const repayAll = async (): Promise<{ status: string; hash: string; amountRequested?: string; estimatedDebtAtRead?: string }> => {
    const res = await api.post("/lending/loans/repay-all");
    return res.data;
  };

  const getLend = async () => {
    const res = await api.get("/lend/pools");
    return res.data;
  };

  const depositLiquidity = async (args: { amount: string; stakeMToken: boolean }) => {
    await api.post("/lending/pools/liquidity", args);
  };

  const withdrawLiquidity = async (args: { amount: string }) => {
    await api.delete("/lending/pools/liquidity", {data: args});
  };
  const withdrawLiquidityAll = async () => {
    await api.post("/lending/pools/withdraw-all");
  };

  const supplyCollateral = async (args: { asset: string, amount: string }) => {
    await api.post("/lending/collateral", args);
  };

  const withdrawCollateral = async (args: { asset: string, amount: string }) => {
    await api.delete("/lending/collateral", {data: args});
  };
  const withdrawCollateralMax = async (args: { asset: string }) => {
    await api.post("/lending/collateral/withdraw-max", args);
  };

  const refreshLendingData = async (): Promise<void> => {
    // Refresh all lending-related data
    await fetchLoans();
    await fetchLiquidityInfo()
    await fetchCollateralInfo()
  };


  // Run initialization only when the user is logged in
  useEffect(() => {
    if (isLoggedIn) {
      fetchLoans();
      fetchLiquidityInfo();
      fetchCollateralInfo();
    }
  }, [isLoggedIn, fetchLoans, fetchLiquidityInfo, fetchCollateralInfo]);

  const contextValue = useMemo(
    () => ({
      loans,
      loadingLoans,
      refreshLoans: fetchLoans,
      liquidityInfo,
      loadingLiquidity,
      refreshLiquidity : fetchLiquidityInfo,
      setPrice,
      configureAsset,
      loading,
      refreshLendingData,
      borrowAsset,
      borrowMax,
      repayLoan,
      repayAll,
      getLend,
      depositLiquidity,
      withdrawLiquidity,
      withdrawLiquidityAll,
      collateralInfo,
      loadingCollateral,
      refreshCollateral: fetchCollateralInfo,
      supplyCollateral,
      withdrawCollateral,
      withdrawCollateralMax,
    }),
    [
      loans,
      loadingLoans,
      liquidityInfo,
      loadingLiquidity,
      loadingCollateral,
      loading
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
