import { api, axios } from "@/lib/axios";
import { safeParseUnits } from "@/utils/numberUtils";

const DECIMALS = 18;

type TraceableAxiosConfig = {
  url?: string;
  method?: string;
  headers?: unknown;
  data?: unknown;
  walletAuth?: unknown;
};

const redactAddress = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
};

const getHeaderValue = (headers: unknown, name: string): string | undefined => {
  const lowerName = name.toLowerCase();
  if (!headers || typeof headers !== "object") return undefined;

  const maybeGetter = headers as { get?: (key: string) => unknown };
  if (typeof maybeGetter.get === "function") {
    const value = maybeGetter.get(name) ?? maybeGetter.get(lowerName);
    return typeof value === "string" ? value : undefined;
  }

  const record = headers as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === lowerName) {
      return typeof value === "string" ? value : undefined;
    }
  }
  return undefined;
};

const parseRequestData = (data: unknown): unknown => {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

const logPsmStart = (operation: string, request: Record<string, unknown>) => {
  console.info(`[PSM trace] ${operation}: request start`, request);
};

const logPsmSuccess = (operation: string, status: number) => {
  console.info(`[PSM trace] ${operation}: request success`, { status });
};

const logPsmError = (operation: string, error: unknown) => {
  if (!axios.isAxiosError(error)) {
    console.warn(`[PSM trace] ${operation}: non-axios error`, error);
    return;
  }

  const config = error.config as TraceableAxiosConfig | undefined;
  const walletAddress = getHeaderValue(config?.headers, "X-Wallet-Address");
  const csrfToken = getHeaderValue(config?.headers, "X-CSRF-Token");

  console.groupCollapsed(`[PSM trace] ${operation}: request failed`);
  console.warn({
    status: error.response?.status,
    responseData: error.response?.data,
    message: error.message,
    code: error.code,
    request: {
      method: config?.method,
      url: config?.url,
      walletAuth: config?.walletAuth,
      hasWalletAddressHeader: Boolean(walletAddress),
      walletAddress: redactAddress(walletAddress),
      hasCsrfHeader: Boolean(csrfToken),
      data: parseRequestData(config?.data),
    },
  });
  console.groupEnd();
};

const traced = async <T>(
  operation: string,
  request: Record<string, unknown>,
  action: () => Promise<{ status: number; data: T }>
): Promise<T> => {
  logPsmStart(operation, request);
  try {
    const response = await action();
    logPsmSuccess(operation, response.status);
    return response.data;
  } catch (error) {
    logPsmError(operation, error);
    throw error;
  }
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
  async getInfo(): Promise<PsmInfo> {
    return traced("getInfo", { method: "GET", url: "/psm/info" }, () =>
      api.get("/psm/info")
    );
  },

  async mint(amount: string, againstToken: string) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    return traced(
      "mint",
      { method: "POST", url: "/psm/mint", amountWei, againstToken },
      () => api.post("/psm/mint", { amount: amountWei, againstToken })
    );
  },

  async requestBurn(amount: string, redeemToken: string) {
    const amountWei = safeParseUnits(amount, DECIMALS).toString();
    return traced(
      "requestBurn",
      { method: "POST", url: "/psm/request-burn", amountWei, redeemToken },
      () => api.post("/psm/request-burn", { amount: amountWei, redeemToken })
    );
  },

  async completeBurn(id: string) {
    return traced(
      "completeBurn",
      { method: "POST", url: "/psm/complete-burn", id },
      () => api.post("/psm/complete-burn", { id })
    );
  },

  async cancelBurn(id: string) {
    return traced(
      "cancelBurn",
      { method: "POST", url: "/psm/cancel-burn", id },
      () => api.post("/psm/cancel-burn", { id })
    );
  },
};
