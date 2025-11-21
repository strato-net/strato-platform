import { ReactNode } from "react";
import { BridgeProvider } from "@/context/BridgeContext";
import { LendingProvider } from "@/context/LendingContext";
import { CDPProvider } from "@/context/CDPContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

export const DepositsProviders = ({ children }: { children: ReactNode }) => {
  return (
    <LendingProvider>
      <CDPProvider>
        <BridgeProvider>
          <TooltipProvider>
            <Toaster />
            {children}
          </TooltipProvider>
        </BridgeProvider>
      </CDPProvider>
    </LendingProvider>
  );
};

