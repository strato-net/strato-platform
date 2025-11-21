import { ReactNode } from "react";
import { UserProvider } from "@/context/UserContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { TokenProvider } from "@/context/TokenContext";
import { LendingProvider } from "@/context/LendingContext";
import { CDPProvider } from "@/context/CDPContext";
import { UserTokensProvider } from "@/context/UserTokensContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";

export const DepositsProviders = ({ children }: { children: ReactNode }) => {
  return (
    <UserProvider>
      <UserTokensProvider>
        <TokenProvider>
          <LendingProvider>
            <CDPProvider>
              <BridgeProvider>
                <TooltipProvider>
                  {children}
                  <Toaster />
                </TooltipProvider>
              </BridgeProvider>
            </CDPProvider>
          </LendingProvider>
        </TokenProvider>
      </UserTokensProvider>
    </UserProvider>
  );
};

