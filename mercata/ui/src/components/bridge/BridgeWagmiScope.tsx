import React, { createContext, useContext } from "react";
import { type Config, WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";

const BridgeWagmiContext = createContext<Config | null>(null);

export const BridgeWagmiConfigProvider = ({
  config,
  children,
}: {
  config: Config | null;
  children: React.ReactNode;
}) => (
  <BridgeWagmiContext.Provider value={config}>
    {children}
  </BridgeWagmiContext.Provider>
);

export const BridgeWagmiScope = ({ children }: { children: React.ReactNode }) => {
  const config = useContext(BridgeWagmiContext);
  if (!config) return null;
  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </WagmiProvider>
  );
};
