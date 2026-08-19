import { getAccessToken } from './auth';

export type ActivityCategory =
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

export type ActivitySummary = Partial<Record<ActivityCategory, number>>;

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
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

export const ACTIVITY_CATEGORY_ORDER = Object.keys(
  ACTIVITY_CATEGORY_LABELS
) as ActivityCategory[];

export interface LinkSummary {
  id: string;
  slug: string;
  url: string;
  label: string;
  source: string;
  fullSource: string;
  destination: string;
  creator: string;
  active: boolean;
  createdAt: string;
  opens: number;
  engagedOpens: number;
  botOpens: number;
  wallets: number;
  bridgedWallets: number;
  bridgeValueUsd: number | null;
  activatedWallets: number;
  lastActivityAt: string | null;
}

export interface BridgeInItem {
  address: string;
  asset: string;
  amount: string;
  amountUsd: number | null;
  txHash: string | null;
  externalChainId: number | null;
  externalTxHash: string | null;
  at: string;
}

// Explorer tx-page prefixes for the external chains the bridge supports
// (mirrors SUPPORTED_CHAINS in the main app). Unknown chain ids render the
// hash without a link.
const EXTERNAL_EXPLORERS: Record<number, { name: string; txPrefix: string }> = {
  1: { name: 'Etherscan', txPrefix: 'https://etherscan.io/tx/' },
  11155111: { name: 'Sepolia Etherscan', txPrefix: 'https://sepolia.etherscan.io/tx/' },
  137: { name: 'Polygonscan', txPrefix: 'https://polygonscan.com/tx/' },
  80002: { name: 'Amoy Polygonscan', txPrefix: 'https://amoy.polygonscan.com/tx/' },
  10: { name: 'Optimistic Etherscan', txPrefix: 'https://optimistic.etherscan.io/tx/' },
  8453: { name: 'Basescan', txPrefix: 'https://basescan.org/tx/' },
  84532: { name: 'Sepolia Basescan', txPrefix: 'https://sepolia.basescan.org/tx/' },
  59144: { name: 'Lineascan', txPrefix: 'https://lineascan.build/tx/' },
  59141: { name: 'Sepolia Lineascan', txPrefix: 'https://sepolia.lineascan.build/tx/' },
  42161: { name: 'Arbiscan', txPrefix: 'https://arbiscan.io/tx/' },
  42170: { name: 'Nova Arbiscan', txPrefix: 'https://nova.arbiscan.io/tx/' },
  56: { name: 'BscScan', txPrefix: 'https://bscscan.com/tx/' },
  43114: { name: 'Snowtrace', txPrefix: 'https://snowtrace.io/tx/' },
};

export const externalTxLink = (
  bridge: Pick<BridgeInItem, 'externalChainId' | 'externalTxHash'>
): { hash: string; url: string | null; explorerName: string | null } | null => {
  if (!bridge.externalTxHash) return null;
  const explorer =
    bridge.externalChainId != null ? EXTERNAL_EXPLORERS[bridge.externalChainId] : undefined;
  return {
    hash: bridge.externalTxHash,
    url: explorer ? `${explorer.txPrefix}${bridge.externalTxHash}` : null,
    explorerName: explorer?.name ?? null,
  };
};

export interface ActivityItem {
  category: ActivityCategory;
  description: string;
  address: string;
  txHash: string | null;
  at: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  count: number;
}

export interface WalletSummary {
  address: string;
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  activitySummary: ActivitySummary;
  lastActivityAt: string | null;
}

// One UTC day of link history; the server fills quiet days with zero points.
export interface HistoryPoint {
  date: string; // YYYY-MM-DD
  opens: number;
  engagedOpens: number;
  wallets: number;
  bridgeIns: number;
  bridgeValueUsd: number;
  trades: number;
  tradeValueUsd: number;
  activity: number;
}

export interface LinkDetail extends LinkSummary {
  bridgeIns: BridgeInItem[];
  activity: ActivityItem[];
  activitySummary: ActivitySummary;
  walletSummaries: WalletSummary[];
  geoPoints: GeoPoint[];
  history: HistoryPoint[];
}

export interface WalletDetail {
  address: string;
  addresses: string[];
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  connectedAt: string;
  activitySummary: ActivitySummary;
  bridgeIns: BridgeInItem[];
  activity: ActivityItem[];
}

// Per-user activity timeline (GET /users/:address/timeline): off-chain events
// (opens, engagement, wallet connections) merged with on-chain ones and, when
// the service has an Etherscan-compatible key, origin-chain transactions.
export type TimelineKind =
  | 'link_opened'
  | 'engaged'
  | 'wallet_connected'
  | 'bridge_in'
  | 'onchain'
  | 'remote_chain';

export interface TimelineItem {
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  category: ActivityCategory | null;
  address: string | null;
  linkId: string | null;
  linkLabel: string | null;
  linkSource: string | null;
  txHash: string | null;
  chainId: number | null;
  chainName: string | null;
  externalTxHash: string | null;
  externalTxUrl: string | null;
  amount: string | null;
  amountUsd: number | null;
  attributedLinkId: string | null;
}

export interface TimelineLink {
  id: string;
  slug: string;
  label: string;
  source: string;
  fullSource: string;
}

export interface UserTimeline {
  address: string;
  addresses: string[];
  externalWalletAddress: string | null;
  stratoAddress: string | null;
  connector: string | null;
  firstSeenAt: string;
  lastActivityAt: string | null;
  links: TimelineLink[];
  activitySummary: ActivitySummary;
  remoteChainEnabled: boolean;
  items: TimelineItem[];
}

// Today's cross-link snapshot (GET /metrics/daily). Windows are UTC days;
// deltas compare against the same elapsed window yesterday.
export interface MetricDelta {
  value: number;
  previous: number;
  changePct: number | null; // null when yesterday's window was empty
}

export interface DailySnapshotLink {
  id: string;
  slug: string;
  label: string;
  source: string;
  opens: number;
}

export interface DailySnapshot {
  date: string; // YYYY-MM-DD (UTC)
  generatedAt: string;
  hour: number; // current UTC hour: the last (partial) opensByHour bucket
  linksTotal: number;
  linksWithOpens: number;
  opens: MetricDelta;
  engagedOpens: number;
  wallets: MetricDelta;
  bridgedWallets: number;
  bridgeValueUsd: MetricDelta;
  bridgeValuePartial: boolean;
  bridgeIns: number;
  actions: MetricDelta;
  actionLinks: number;
  opensByHour: number[];
  topLinks: DailySnapshotLink[];
}

export interface CreateLinkInput {
  label: string;
  source: string;
  fullSource: string;
  destination: string;
}

export interface UpdateLinkInput {
  label?: string;
  source?: string;
  fullSource?: string;
  destination?: string;
  active?: boolean;
}

// Common presets for the destination picker; any relative path or absolute
// http(s) URL is accepted via the "Custom URL" option.
export const TRACKING_DESTINATIONS = [
  { value: '/dashboard/deposits', label: 'Bridge In (Fund)' },
  { value: '/dashboard', label: 'Portfolio' },
  { value: '/dashboard/swap', label: 'Trade' },
  { value: '/dashboard/earn', label: 'Earn' },
  { value: '/dashboard/rewards', label: 'Rewards' },
] as const;

export const isValidDestination = (destination: string): boolean => {
  if (!destination || /\s/.test(destination)) return false;
  if (destination.startsWith('/')) return !destination.startsWith('//');
  try {
    const url = new URL(destination);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (init?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/tracking-api${path}`, { ...init, headers });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.error ?? body?.message ?? message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const getMe = () => apiFetch<{ authorized: boolean }>('/me');
export const getDailySnapshot = () => apiFetch<DailySnapshot>('/metrics/daily');
export const listLinks = () => apiFetch<LinkSummary[]>('/links');
export const getLink = (id: string) => apiFetch<LinkDetail>(`/links/${id}`);
export const getWallet = (linkId: string, address: string) =>
  apiFetch<WalletDetail>(`/links/${linkId}/wallets/${address}`);
export const getUserTimeline = (address: string) =>
  apiFetch<UserTimeline>(`/users/${address}/timeline`);
export const createLink = (input: CreateLinkInput) =>
  apiFetch<{ id: string; slug: string; url: string }>('/links', {
    method: 'POST',
    body: JSON.stringify(input),
  });
export const updateLink = (id: string, fields: UpdateLinkInput) =>
  apiFetch<void>(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
export const setLinkActive = (id: string, active: boolean) => updateLink(id, { active });

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const formatUsd = (value: number | null | undefined) =>
  value == null ? '—' : usdFormatter.format(value);

const usdCompactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

// Headline-sized USD ($128.4K) for the daily snapshot tiles
export const formatUsdCompact = (value: number | null | undefined) =>
  value == null ? '—' : usdCompactFormatter.format(value);

export const formatCount = (value: number) => value.toLocaleString('en-US');

// The service returns link urls as relative paths ("/t/<slug>") because a
// slug resolves on every host that proxies /t/. For display and copy, render
// them against the configured app origin — the host sales actually shares —
// falling back to this dashboard's own origin.
const appOrigin =
  ((window as unknown as { ENV?: Record<string, string> }).ENV?.APP_ORIGIN ??
    'https://app.strato.nexus') || window.location.origin;

export const absoluteLinkUrl = (url: string) => new URL(url, appOrigin).toString();

// Dashboard route for a wallet's activity timeline (every rendered address
// links here)
export const userTimelinePath = (address: string) => `/users/${address}`;

export const shortAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
