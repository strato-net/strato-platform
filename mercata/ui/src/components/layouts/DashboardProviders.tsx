import { ReactNode } from "react";
import { LendingProvider } from "@/context/LendingContext";
import { CDPProvider } from "@/context/CDPContext";

export const DashboardProviders = ({ children }: { children: ReactNode }) => {
  return (
    <LendingProvider>
      <CDPProvider>
        {children}
      </CDPProvider>
    </LendingProvider>
  );
};

