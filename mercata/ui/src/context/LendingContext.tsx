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
  }) => Promise<void>;
  setInterestRate: (payload: { asset: string; rate: number }) => Promise<void>;
  setCollateralRatio: (payload: { asset: string; ratio: number }) => Promise<void>;
  setLiquidationBonus: (payload: { asset: string; bonus: number }) => Promise<void>;
  refreshLendingData: () => Promise<void>;
  borrowAsset: (args: {
    amount: string;
  }) => Promise<void>;
  repayLoan: (args: {
    amount: string;
  }) => Promise<void>;
  getLend: () => Promise<LendData>;
  depositLiquidity: (args: { amount: string }) => Promise<void>;
  withdrawLiquidity: (args: { amount: string }) => Promise<void>;

  collateralInfo: CollateralData[];
  refreshCollateral: (signal?: AbortSignal) => void;
  loadingCollateral: boolean;
  supplyCollateral: (args: { asset: string; amount: string }) => Promise<void>;
  withdrawCollateral: (args: { asset: string; amount: string }) => Promise<void>;
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
      console.error("Failed to fetch withdrawable tokens:", err);
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
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError") return;
      console.error("Failed to fetch loans:", err);
      return [];
    } finally {
      setLoadingLoans(false);
    }
  }, []);

  const setPrice = async (payload: { token: string; price: string }): Promise<void> => {
    const weiPrice = parseUnits(payload.price, 18).toString();
    try {
      await api.post("/oracle/price", { ...payload, price: weiPrice.toString() });
    } catch (err) {
      console.error("Failed to set price:", err);
      throw err;
    }
  };

  const configureAsset = async (payload: { 
    asset: string; 
    ltv: number; 
    liquidationThreshold: number; 
    liquidationBonus: number; 
    interestRate: number; 
    reserveFactor: number; 
  }): Promise<void> => {
    try {
      await api.post("/lend/admin/configure-asset", payload);
    } catch (err: any) {
      console.error("Failed to configure asset:", err);
      throw err;
    }
  };

  const borrowAsset = async ({
    amount,
  }: {
    amount: string;
  }) => {
    try {
      await api.post("/lending/loans", {
        amount
      });
    } catch (err) {
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
      await api.patch("/lending/loans", {
        amount
      });
    } catch (err) {
      console.error("Repay failed:", err);
      throw err;
    }
  };

  const getLend = async () => {
    try {
      const res = await api.get("/lend/pools");
      return res.data;
    } catch (err) {
      console.error("Get lend failed:", err);
      throw err;
    }
  };

  const depositLiquidity = async (args: { amount: string }) => {
    try {
      await api.post("/lending/pools/liquidity", args);
    } catch (err) {
      console.error("Deposit liquidity failed:", err);
      throw err;
    }
  };

  const withdrawLiquidity = async (args: { amount: string }) => {
    try {
      await api.delete("/lending/pools/liquidity", {data: args});
    } catch (err) {
      console.error("Withdraw liquidity failed:", err);
      throw err;
    }
  };

  const supplyCollateral = async (args: { asset: string, amount: string }) => {
    try {
       await api.post("/lending/collateral", args);
    } catch (err) {
      throw err.response.data.error.message;
    }
  };

  const withdrawCollateral = async (args: { asset: string, amount: string }) => {
    try {
      await api.delete("/lending/collateral", {data: args});
    } catch (err) {
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
    } catch (err) {
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
      setInterestRate: () => Promise.resolve(), // Placeholder implementation
      setCollateralRatio: () => Promise.resolve(), // Placeholder implementation
      setLiquidationBonus: () => Promise.resolve(), // Placeholder implementation
      configureAsset,
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
