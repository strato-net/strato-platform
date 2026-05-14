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
  burnDelay: string;
  mintFeeBps: string;
  burnFeeBps: string;
  pendingRedemptions: string;
  availableLiquidity: string;
}

export interface BurnRequest {
  id: string;
  amount: string;
  payoutAmount: string;
  redeemToken: string;
  redeemTokenSymbol: string;
  requester: string;
  requestTime: string;
  burnDelay: string;
  availableAt: string;
  isAvailable: boolean;
}

export interface PsmInfo {
  address: string;
  mintableToken: string;
  mintableTokenSymbol: string;
  mintPaused: boolean;
  burnPaused: boolean;
  eligibleTokens: EligibleToken[];
  burnRequests: BurnRequest[];
  userMintableBalance: string;
}

export const psmService = {
  async getInfo(): Promise<PsmInfo> {
    const response = await api.get("/psm/info");
    return response.data;
  },

  async mint(amount: string, againstToken: string) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    const response = await api.post("/psm/mint", { amount: amountWei, againstToken });
    return response.data;
  },

  async requestBurn(amount: string, redeemToken: string) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    const response = await api.post("/psm/request-burn", { amount: amountWei, redeemToken });
    return response.data;
  },

  async completeBurn(id: string) {
    const response = await api.post("/psm/complete-burn", { id });
    return response.data;
  },

  async cancelBurn(id: string) {
    const response = await api.post("/psm/cancel-burn", { id });
    return response.data;
  },
};
