import { api } from "@/lib/axios";
import type { WalletTxProgressHandler } from "@/lib/axios";

export interface BuyOptions {
  /** When true, forces the X-Wallet-Address header so the backend returns unsigned txs
   *  for MetaMask/external-wallet signing. Mirrors the bridge flow. */
  walletAuth?: boolean;
  walletTxProgress?: WalletTxProgressHandler;
}

export interface SaleToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  images?: { value: string }[];
}

export interface SalePaymentToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: string;
  images?: { value: string }[];
}

export interface SaleInfo {
  address: string;
  saleToken: SaleToken | null;
  pricePerTokenUSD: string;
  hardCap: string;
  totalSold: string;
  remainingForSale: string;
  perWalletCap: string;
  inventory: string;
  startTime: string;
  endTime: string;
  paused: boolean;
  active: boolean;
  priceOracle: string;
  paymentTokens: SalePaymentToken[];
}

export interface UserSalePosition {
  purchased: string;
  remainingForWallet: string;
}

export interface SaleQuote {
  paymentAmount: string;
  usdValue: string;
  paymentPrice: string;
}

export interface SalePurchaseRecord {
  buyer: string;
  paymentToken: string;
  paymentTokenSymbol: string;
  saleAmount: string;
  paymentAmount: string;
  usdValue: string;
  timestamp: string;
  hash?: string;
}

export interface TxResult {
  status: string;
  hash: string;
}

export const fixedPriceSaleService = {
  async getInfo(): Promise<SaleInfo | null> {
    try {
      const res = await api.get<SaleInfo>("/fixed-price-sale/info");
      return res.data;
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  },

  async getUserPosition(): Promise<UserSalePosition> {
    const res = await api.get<UserSalePosition>("/fixed-price-sale/user");
    return res.data;
  },

  async quote(paymentToken: string, saleAmount: string): Promise<SaleQuote> {
    const res = await api.get<SaleQuote>("/fixed-price-sale/quote", {
      params: { paymentToken, saleAmount },
    });
    return res.data;
  },

  async buy(
    paymentToken: string,
    saleAmount: string,
    paymentAmount: string,
    options?: BuyOptions,
  ): Promise<TxResult> {
    const config: any = {};
    if (options?.walletAuth) config.walletAuth = true;
    if (options?.walletTxProgress) config.walletTxProgress = options.walletTxProgress;
    const res = await api.post<TxResult>(
      "/fixed-price-sale/buy",
      { paymentToken, saleAmount, paymentAmount },
      Object.keys(config).length ? config : undefined,
    );
    return res.data;
  },

  async getRecentPurchases(limit: number = 20): Promise<{ purchases: SalePurchaseRecord[] }> {
    const res = await api.get<{ purchases: SalePurchaseRecord[] }>("/fixed-price-sale/purchases", {
      params: { limit },
    });
    return res.data;
  },
};
