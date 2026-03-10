import { api } from "@/lib/axios";

export interface MetalConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
  isEnabled: boolean;
  mintCap: string;
  totalMinted: string;
}

export interface PayTokenConfig {
  address: string;
  symbol: string;
  name: string;
  imageUrl: string;
  isEnabled: boolean;
  feeBps: string;
}

export interface Config {
  metals: MetalConfig[];
  payTokens: PayTokenConfig[];
}

export interface BuyResult {
  status: string;
  hash: string;
}

export const metalForgeService = {
  async getConfigs(): Promise<Config> {
    const response = await api.get("/metal-forge/configs");
    return response.data;
  },

  async buy(
    metalToken: string,
    payToken: string,
    payAmount: string,
    minMetalOut: string
  ): Promise<BuyResult> {
    const response = await api.post("/metal-forge/buy", {
      metalToken,
      payToken,
      payAmount,
      minMetalOut,
    });
    return response.data;
  },
};
