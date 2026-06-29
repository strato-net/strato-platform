import { createConfig, http, type Transport } from "wagmi";
import { mainnet, polygon, sepolia, base } from "wagmi/chains";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { stratoWallet } from "@/lib/stratoWallet";
import { initStratoChain, getStratoChain } from "@/lib/stratoChain";
import { runtime } from "@/lib/env";

const baseChains = [mainnet, polygon, sepolia, base] as const;

// Build the wagmi config at startup. window.ENV (from /smd/config.js) is loaded
// synchronously before main.tsx, so the STRATO chain can be resolved here.
export function buildWagmiConfig() {
  initStratoChain();
  const stratoChain = getStratoChain();
  const chains = (stratoChain ? [...baseChains, stratoChain] : baseChains) as any;

  const transports: Record<number, Transport> = Object.fromEntries(
    chains.map((chain: any) => [
      chain.id,
      chain === stratoChain ? http(runtime.rpcUrl()) : http(),
    ])
  );

  const projectId = runtime.wagmiProjectId() || "smd-dashboard";

  const connectors = connectorsForWallets(
    [
      ...(stratoChain ? [{ groupName: "STRATO", wallets: [stratoWallet] }] : []),
      {
        groupName: "External",
        wallets: [metaMaskWallet, coinbaseWallet, walletConnectWallet],
      },
    ],
    { projectId, appName: "STRATO Management Dashboard" }
  );

  return createConfig({ connectors, chains, transports });
}
