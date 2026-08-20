import { api } from "@/lib/axios";
import { safeParseUnits } from "@/utils/numberUtils";

const DECIMALS = 18;

export interface EligibleToken {
  address: string;
  symbol: string;
  name: string;
  userBalance: string;
  psmBalance: string;
  mintEnabled: boolean;
  burnEnabled: boolean;
  maxBalance: string;
  minReserve: string;
  mintFeeBps: string;
  burnFeeBps: string;
  availableLiquidity: string;
}

export interface PsmInfo {
  address: string;
  mintableToken: string;
  mintableTokenSymbol: string;
  mintPaused: boolean;
  burnPaused: boolean;
  savingsVault: string;
  savingsEnabled: boolean;
  eligibleTokens: EligibleToken[];
  userMintableBalance: string;
}

export const psmService = {
  async getInfo(): Promise<PsmInfo> {
    const response = await api.get("/psm/info");
    return response.data;
  },

  async mint(amount: string, againstToken: string, toSavings = false) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    const response = await api.post("/psm/mint", {
      amount: amountWei,
      againstToken,
      toSavings,
    });
    return response.data;
  },

  async redeem(amount: string, redeemToken: string) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    const response = await api.post("/psm/redeem", { amount: amountWei, redeemToken });
    return response.data;
  },
};
