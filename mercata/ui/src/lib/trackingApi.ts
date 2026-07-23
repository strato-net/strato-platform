// Client for the tracking-links feature. Two data sources, joined client-side
// by lib/trackingEngine.ts:
//   - the tracking service (/tracking-api/*): offchain data only — links,
//     sessions, wallet connections, geo. It has no node/Cirrus access.
//   - the mercata backend (/api/tracking/*): categorized chain activity for a
//     set of wallet addresses, from the node's own Cirrus.
// Deliberately independent of lib/axios.ts: that instance redirects to login
// on 401 and toasts on errors, both wrong for these calls.

import { getCsrfToken } from './csrf';

// ---------- Offchain shapes (tracking service) ----------

export interface TrackingSnapshotLink {
  id: string;
  slug: string;
  url: string;
  label: string;
  source: string | null;
  createdBy: string;
  destination: string;
  active: boolean;
  createdAt: string;
}

export interface TrackingSnapshotConnection {
  id: string;
  sessionId: string;
  linkId: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  isBotOrPreview: boolean;
}

export interface TrackingSnapshotSessionStats {
  linkId: string;
  opens: number;
  engagedOpens: number;
  botOpens: number;
  lastOpenedAt: string | null;
}

export interface TrackingSnapshotGeoPoint {
  linkId: string;
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
}

export interface TrackingSnapshot {
  links: TrackingSnapshotLink[];
  connections: TrackingSnapshotConnection[];
  sessionStats: TrackingSnapshotSessionStats[];
  geoPoints: TrackingSnapshotGeoPoint[];
}

// ---------- Chain shapes (mercata backend) ----------

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

export interface TrackingChainEvent {
  eventKey: string;
  category: TrackingActivityCategory;
  contractName: string;
  eventName: string;
  address: string;
  at: string;
}

export interface TrackingChainBridgeIn {
  eventKey: string;
  externalSender: string;
  stratoRecipient: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  at: string;
}

export interface TrackingActivityResponse {
  events: TrackingChainEvent[];
  bridgeIns: TrackingChainBridgeIn[];
}

// ---------- Computed shapes (produced by lib/trackingEngine.ts) ----------

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
  bridgeValueUsd: number | null;
  activatedWallets: number;
  lastActivityAt: string | null;
}

export interface TrackingBridgeIn {
  address: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  at: string;
}

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

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (method !== 'GET') {
    const token = getCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
    if (init?.body) headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...init, headers, credentials: 'include' });
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

// ---------- Tracking service (offchain) ----------

export const getTrackingMe = () => jsonFetch<{ authorized: boolean }>('/tracking-api/me');

export const getTrackingSnapshot = () => jsonFetch<TrackingSnapshot>('/tracking-api/snapshot');

export const createTrackingLink = (input: CreateLinkInput) =>
  jsonFetch<{ id: string; slug: string; url: string }>('/tracking-api/links', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const setTrackingLinkActive = (id: string, active: boolean) =>
  jsonFetch<void>(`/tracking-api/links/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ active }),
  });

// ---------- Mercata backend (chain activity) ----------

export const getTrackingActivity = (addresses: string[]) =>
  jsonFetch<TrackingActivityResponse>('/api/tracking/activity', {
    method: 'POST',
    body: JSON.stringify({ addresses }),
  });

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const formatUsd = (value: number | null | undefined) =>
  value == null ? '—' : usdFormatter.format(value);
