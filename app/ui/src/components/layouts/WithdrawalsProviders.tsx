import { ReactNode } from "react";
import { UserProvider } from "@/context/UserContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

export const WithdrawalsProviders = ({ children }: { children: ReactNode }) => {
  return (
    <UserProvider>
      <BridgeProvider>
        <TooltipProvider>
          <Toaster />
          {children}
        </TooltipProvider>
      </BridgeProvider>
    </UserProvider>
  );
};

