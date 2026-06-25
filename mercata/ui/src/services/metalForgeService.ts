import { api } from "@/lib/axios";
import type { WalletTxProgressHandler } from "@/lib/axios";

export interface MetalConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
  isEnabled: boolean;
  mintCap: string;
  feeBps: string;
  totalMinted: string;
  price: string;
}

export interface PayTokenConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
  price: string;
}

export interface Config {
  metals: MetalConfig[];
  payTokens: PayTokenConfig[];
}

export interface BuyResult {
  status: string;
  hash: string;
}

interface BuyOptions {
  walletTxProgress?: WalletTxProgressHandler;
}

const walletTxConfig = (options?: BuyOptions) =>
  options?.walletTxProgress
    ? ({ walletTxProgress: options.walletTxProgress } as any)
    : undefined;

export const metalForgeService = {
  async getConfigs(): Promise<Config> {
    const response = await api.get("/metal-forge/configs");
    return response.data;
  },

  async buy(
    metalToken: string,
    payToken: string,
    payAmount: string,
    minMetalOut: string,
    options?: BuyOptions
  ): Promise<BuyResult> {
    const response = await api.post("/metal-forge/buy", {
      metalToken,
      payToken,
      payAmount,
      minMetalOut,
    }, walletTxConfig(options));
    return response.data;
  },
};
