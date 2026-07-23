// Typed client for the tracking-links service (/tracking-api). Deliberately
// independent of lib/axios.ts: that instance redirects to login on 401 and
// toasts on errors, both of which are wrong for tracking calls (a 403 here
// just means "not a sales/marketing user" and renders as an in-page state).

import { getCsrfToken } from './csrf';

export interface TrackingLinkSummary {
  id: string;
  slug: string;
  url: string;
  label: string;
  source: string;
  destination: string;
  creator: string;
  active: boolean;
  opens: number;
  wallets: number;
  bridgedWallets: number;
  bridgeValueUsd: number;
  activatedWallets: number;
  lastActivityAt: string | null;
}

export interface TrackingConnection {
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
}

export interface TrackingBridgeIn {
  address: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  at: string;
}

export type TrackingActivityCategory =
  | 'bridge_in'
  | 'bridge_out'
  | 'swap'
  | 'liquidity_add'
  | 'liquidity_remove'
  | 'cdp_borrow'
  | 'cdp_repay'
  | 'savings_deposit'
  | 'savings_withdraw'
  | 'transfer_sent'
  | 'transfer_received'
  | 'metal_purchase'
  | 'vault_deposit'
  | 'vault_withdraw'
  | 'lending_deposit'
  | 'lending_borrow'
  | 'staking'
  | 'rewards';

export type TrackingActivitySummary = Partial<Record<TrackingActivityCategory, number>>;

export const ACTIVITY_CATEGORY_LABELS: Record<TrackingActivityCategory, string> = {
  bridge_in: 'Bridge in',
  bridge_out: 'Bridge out',
  swap: 'Swaps',
  liquidity_add: 'Liquidity added',
  liquidity_remove: 'Liquidity removed',
  cdp_borrow: 'CDP borrows',
  cdp_repay: 'CDP repays',
  savings_deposit: 'Savings deposits',
  savings_withdraw: 'Savings withdrawals',
  transfer_sent: 'Transfers sent',
  transfer_received: 'Transfers received',
  metal_purchase: 'Metal purchases',
  vault_deposit: 'Vault deposits',
  vault_withdraw: 'Vault withdrawals',
  lending_deposit: 'Lending deposits',
  lending_borrow: 'Lending borrows',
  staking: 'Staking',
  rewards: 'Rewards claimed',
};

// Stable display order for summary tiles and per-wallet chips
export const ACTIVITY_CATEGORY_ORDER = Object.keys(
  ACTIVITY_CATEGORY_LABELS
) as TrackingActivityCategory[];

export interface TrackingActivityItem {
  category: TrackingActivityCategory;
  description: string;
  address: string;
  txHash: string | null;
  at: string;
}

export interface TrackingGeoPoint {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
}

export interface TrackingWalletSummary {
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  activitySummary: TrackingActivitySummary;
  lastActivityAt: string | null;
}

export interface TrackingLinkDetail extends TrackingLinkSummary {
  connections: TrackingConnection[];
  bridgeIns: TrackingBridgeIn[];
  activity: TrackingActivityItem[];
  activitySummary: TrackingActivitySummary;
  walletSummaries: TrackingWalletSummary[];
  geoPoints: TrackingGeoPoint[];
}

export interface TrackingWalletDetail {
  address: string;
  addresses: string[];
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  activitySummary: TrackingActivitySummary;
  bridgeIns: TrackingBridgeIn[];
  activity: TrackingActivityItem[];
}

export interface CreateLinkInput {
  label: string;
  source: string;
  destination: string;
}

export const TRACKING_DESTINATIONS = [
  { value: '/dashboard/deposits', label: 'Bridge In (Fund)' },
  { value: '/dashboard', label: 'Portfolio' },
  { value: '/dashboard/swap', label: 'Trade' },
  { value: '/dashboard/earn', label: 'Earn' },
  { value: '/dashboard/rewards', label: 'Rewards' },
] as const;

export const DEFAULT_TRACKING_DESTINATION = TRACKING_DESTINATIONS[0].value;

export class TrackingApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'TrackingApiError';
  }
}

async function trackingFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (method !== 'GET') {
    const token = getCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
    if (init?.body) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/tracking-api${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.error ?? body?.message ?? message;
    } catch {
      // non-JSON error body
    }
    throw new TrackingApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const getTrackingMe = () => trackingFetch<{ authorized: boolean }>('/me');

export const listTrackingLinks = () => trackingFetch<TrackingLinkSummary[]>('/links');

export const getTrackingLink = (id: string) => trackingFetch<TrackingLinkDetail>(`/links/${id}`);

export const getTrackingWallet = (linkId: string, address: string) =>
  trackingFetch<TrackingWalletDetail>(`/links/${linkId}/wallets/${address}`);

export const createTrackingLink = (input: CreateLinkInput) =>
  trackingFetch<{ id: string; slug: string; url: string }>('/links', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const setTrackingLinkActive = (id: string, active: boolean) =>
  trackingFetch<void>(`/links/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const formatUsd = (value: number | null | undefined) =>
  value == null ? '—' : usdFormatter.format(value);
