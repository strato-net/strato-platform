import React from 'react';
import { mainnet, polygon, sepolia } from "wagmi/chains";
import {
  connectorsForWallets,
} from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";
import { metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";

interface WagmiConfigProps {
  children: (config: any) => React.ReactNode;
}

const WagmiConfig: React.FC<WagmiConfigProps> = ({ children }) => {
  const projectId = "YOUR_PROJECT_ID"; //project_id required for v2wallet connect
  const appName = "Mercata";

  const chains = [mainnet, polygon, sepolia] as const;
  const transports = {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [sepolia.id]: http(),
  };

  const connectors = connectorsForWallets(
    [
      {
        groupName: "Recommended",
        wallets: [metaMaskWallet],
      },
    ],
    { projectId, appName }
  );

  const config = createConfig({
    connectors,
    chains,
    transports,
    ssr: true,
  });

  return <>{children(config)}</>;
};

export default WagmiConfig; 