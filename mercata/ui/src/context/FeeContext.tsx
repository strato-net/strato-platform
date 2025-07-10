import React, { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { baseUrl } from "@/config/config";
import axios from "axios";

interface FeeContextType {
  supplyFee: string;
  withdrawFee: string;
  isLoading: boolean;
  refetchFees: () => Promise<void>;
}

const FeeContext = createContext<FeeContextType | undefined>(undefined);

export const useFees = () => {
  const context = useContext(FeeContext);
  if (!context) {
    throw new Error("useFees must be used within a FeeProvider");
  }
  return context;
};

interface FeeProviderProps {
  children: React.ReactNode;
}

export const FeeProvider: React.FC<FeeProviderProps> = ({ children }) => {
  const { accessToken } = useAuth();
  const [supplyFee, setSupplyFee] = useState<string>("20000000000000000"); // Default 0.02 USDST
  const [withdrawFee, setWithdrawFee] = useState<string>("10000000000000000"); // Default 0.01 USDST
  const [isLoading, setIsLoading] = useState(false);

  const fetchFees = async () => {
    if (!accessToken) return;

    setIsLoading(true);
    try {
      const response = await axios.get(`${baseUrl}/api/lending/collateral-fees`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.data) {
        setSupplyFee(response.data.supplyFee || "20000000000000000");
        setWithdrawFee(response.data.withdrawFee || "10000000000000000");
      }
    } catch (error) {
      console.error("Error fetching collateral fees:", error);
      // Keep default values on error
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, [accessToken]);

  const refetchFees = async () => {
    await fetchFees();
  };

  return (
    <FeeContext.Provider
      value={{
        supplyFee,
        withdrawFee,
        isLoading,
        refetchFees,
      }}
    >
      {children}
    </FeeContext.Provider>
  );
}; 