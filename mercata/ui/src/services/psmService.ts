import { api } from "@/lib/axios";
import { safeParseUnits } from "@/utils/numberUtils";
import type { AxiosRequestConfig } from "axios";

const DECIMALS = 18;

type PsmRequestOptions = AxiosRequestConfig & {
  walletAuth?: boolean;
};

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
  async getInfo(options?: PsmRequestOptions): Promise<PsmInfo> {
    const response = await api.get("/psm/info", options);
    return response.data;
  },

  async mint(amount: string, againstToken: string, options?: PsmRequestOptions) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    const response = await api.post("/psm/mint", { amount: amountWei, againstToken }, options);
    return response.data;
  },

  async requestBurn(amount: string, redeemToken: string, options?: PsmRequestOptions) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    const response = await api.post("/psm/request-burn", { amount: amountWei, redeemToken }, options);
    return response.data;
  },

  async completeBurn(id: string, options?: PsmRequestOptions) {
    const response = await api.post("/psm/complete-burn", { id }, options);
    return response.data;
  },

  async cancelBurn(id: string, options?: PsmRequestOptions) {
    const response = await api.post("/psm/cancel-burn", { id }, options);
    return response.data;
  },
};
