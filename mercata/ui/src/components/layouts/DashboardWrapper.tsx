import { SwapProvider } from "@/context/SwapContext";
import { ReactNode } from "react";

interface DashboardWrapperProps {
  children: ReactNode;
}

const DashboardWrapper = ({ children }: DashboardWrapperProps) => {
  return (
    <SwapProvider>
      {children}
    </SwapProvider>
  );
};

export default DashboardWrapper;
