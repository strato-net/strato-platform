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
  txHash: string;
  at: string;
}

export interface TrackingActivityItem {
  kind: 'first_action' | 'metal_purchase' | 'swap' | 'other';
  description: string;
  address: string;
  txHash: string | null;
  at: string;
}

export interface TrackingLinkDetail extends TrackingLinkSummary {
  connections: TrackingConnection[];
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
