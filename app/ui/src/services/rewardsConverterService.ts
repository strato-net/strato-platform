import { api } from "@/lib/axios";
import { REWARDS_POINTS } from "@/lib/constants";
import type {
  GovernedCallResult,
  RewardsConverterAccount,
  RewardsConverterAdminStats,
  RewardsConverterHistory,
  RewardsConverterState,
  RewardsConverterVolumeBucket,
  TransactionResponse,
} from "@strato/shared-types";

// Amounts and rates are raw integers: token units, and STRATO per rewards point scaled by 1e18.
export const rewardsConverterService = {
  async getState(signal?: AbortSignal): Promise<RewardsConverterState> {
    const { data } = await api.get<RewardsConverterState>("/rewards-converter/state", { signal });
    return data.configured ? { ...data, rewardsToken: { ...data.rewardsToken, symbol: REWARDS_POINTS } } : data;
  },

  async getAccount(signal?: AbortSignal): Promise<RewardsConverterAccount> {
    const { data } = await api.get("/rewards-converter/account", { signal });
    return data;
  },

  async getHistory(page: number, limit: number, signal?: AbortSignal): Promise<RewardsConverterHistory> {
    const { data } = await api.get("/rewards-converter/history", { params: { page, limit }, signal });
    return data;
  },

  async convert(amount: bigint): Promise<TransactionResponse> {
    const { data } = await api.post("/rewards-converter/convert", { amount: amount.toString() });
    return data;
  },

  async getAdminStats(signal?: AbortSignal): Promise<RewardsConverterAdminStats> {
    const { data } = await api.get("/rewards-converter/admin/stats", { signal });
    return data;
  },

  /** One bucket per UTC day of `month` ("YYYY-MM"), up to today. */
  async getDailyVolume(month: string, signal?: AbortSignal): Promise<RewardsConverterVolumeBucket[]> {
    const { data } = await api.get("/rewards-converter/admin/volume/daily", { params: { month }, signal });
    return data;
  },

  /** One bucket per UTC month since the first conversion. */
  async getMonthlyVolume(signal?: AbortSignal): Promise<RewardsConverterVolumeBucket[]> {
    const { data } = await api.get("/rewards-converter/admin/volume/monthly", { signal });
    return data;
  },

  /** Hash of the transaction that executed the issue `voteHash` voted on; null while it has not executed. */
  async getIssueExecutionHash(voteHash: string, signal?: AbortSignal): Promise<string | null> {
    const { data } = await api.get("/rewards-converter/admin/issue-execution", { params: { voteHash }, signal });
    return data.hash;
  },

  async setRate(rate: bigint): Promise<GovernedCallResult> {
    const { data } = await api.post("/rewards-converter/admin/set-rate", { rate: rate.toString() });
    return data;
  },

  async pause(): Promise<GovernedCallResult> {
    const { data } = await api.post("/rewards-converter/admin/pause");
    return data;
  },

  async unpause(): Promise<GovernedCallResult> {
    const { data } = await api.post("/rewards-converter/admin/unpause");
    return data;
  },

  async withdrawReserve(to: string, amount: bigint): Promise<GovernedCallResult> {
    const { data } = await api.post("/rewards-converter/admin/withdraw-reserve", { to, amount: amount.toString() });
    return data;
  },

  async fundReserve(amount: bigint): Promise<GovernedCallResult> {
    const { data } = await api.post("/rewards-converter/admin/fund-reserve", { amount: amount.toString() });
    return data;
  },
};
