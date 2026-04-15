import { useContext } from "react";
import { YieldVaultContext, type YieldVaultContextType } from "@/context/YieldVaultContext.shared";

export const useYieldVaultContext = (): YieldVaultContextType => {
  const context = useContext(YieldVaultContext);
  if (!context) {
    throw new Error("useYieldVaultContext must be used within a YieldVaultProvider");
  }
  return context;
};
