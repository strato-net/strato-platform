// PostHog product analytics. Mirrors the fire-and-forget contract of
// `lib/tracking.ts`: nothing in here may ever throw into a caller, and every
// entry point no-ops when PostHog was never initialized (main.tsx skips
// `posthog.init` when no POSTHOG_KEY is configured, which is the case for every
// local and CI build).
//
// Call sites must go through `capture()` rather than importing posthog
// directly — the `AnalyticsEvent` union is what keeps event names from drifting.

import posthog from 'posthog-js';

// ---------------------------------------------------------------------------
// Event taxonomy
// ---------------------------------------------------------------------------

/** Base names for actions auto-instrumented from the axios layer. */
export type ApiAction =
  // trading
  | 'swap'
  | 'liquidity_add'
  | 'liquidity_remove'
  | 'v3_pool_create'
  | 'v3_position_create'
  | 'v3_position_increase'
  | 'v3_position_collect'
  | 'v3_position_burn'
  // lending
  | 'borrow'
  | 'borrow_max'
  | 'repay'
  | 'repay_all'
  | 'collateral_supply'
  | 'collateral_withdraw'
  | 'collateral_withdraw_max'
  | 'lend_liquidity_deposit'
  | 'lend_liquidity_withdraw'
  | 'lend_liquidity_withdraw_all'
  | 'liquidate'
  // cdp
  | 'cdp_deposit'
  | 'cdp_withdraw'
  | 'cdp_withdraw_max'
  | 'cdp_mint'
  | 'cdp_mint_max'
  | 'cdp_repay'
  | 'cdp_repay_all'
  | 'cdp_liquidate'
  | 'junior_note_open'
  | 'junior_note_topup'
  | 'junior_note_claim'
  // staking + safety module
  | 'stake'
  | 'unstake'
  | 'stake_move'
  | 'stake_claim'
  | 'stake_withdraw_unbonded'
  | 'stake_self_bond'
  | 'stake_self_unbond'
  | 'stake_operator_claim'
  | 'stake_commission'
  | 'safety_stake'
  | 'safety_cooldown'
  | 'safety_redeem'
  | 'safety_redeem_all'
  // earn
  | 'save_deposit'
  | 'save_redeem'
  | 'save_redeem_all'
  | 'yield_vault_deposit'
  | 'yield_vault_redeem'
  | 'yield_vault_redeem_all'
  | 'yield_vault_claim'
  | 'basket_vault_deposit'
  | 'basket_vault_withdraw'
  // stablecoin / bridge / metals
  | 'psm_mint'
  | 'psm_redeem'
  | 'bridge_out'
  | 'bridge_in'
  | 'metal_buy'
  // assets
  | 'token_transfer'
  | 'token_approve'
  | 'token_transfer_from'
  | 'nft_transfer'
  | 'nft_burn'
  // money in / rewards / referral
  | 'onramp_session'
  | 'credit_card_top_up'
  | 'rewards_claim'
  | 'rewards_claim_all'
  | 'refer_deposit'
  | 'refer_redeem'
  | 'refer_cancel';

type ApiActionEvent = `${ApiAction}_${'started' | 'succeeded' | 'failed'}`;

export type AnalyticsEvent =
  | ApiActionEvent
  // acquisition
  | 'landing_page_viewed'
  | 'landing_cta_clicked'
  | 'landing_step_clicked'
  // retention (returning-user member-benefit popups)
  | 'benefit_popup_viewed'
  | 'benefit_popup_cta_clicked'
  | 'benefit_popup_dismissed'
  // activation
  | 'wallet_connect_requested'
  | 'wallet_connected'
  | 'signup_completed'
  | 'login_wall_hit'
  | 'session_expired'
  // on-chain lifecycle
  | 'tx_signing'
  | 'tx_submitting'
  | 'tx_submitted'
  | 'tx_confirming'
  | 'tx_completed'
  | 'tx_failed';

// ---------------------------------------------------------------------------
// Endpoint -> action mapping
// ---------------------------------------------------------------------------

// Keyed by "<METHOD> <path pattern>". Method is part of the key because the
// same path means opposite things by verb: POST /lending/collateral supplies,
// DELETE withdraws; POST /poolv3/positions mints, DELETE burns.
//
// A `*` matches exactly one path segment, for endpoints that interpolate a pool
// address or vault key. Patterns are matched whole, not as substrings — a
// substring match would let "POST /swap" claim "/swap-pools/<addr>/liquidity".
const API_EVENT_MAP: Record<string, ApiAction> = {
  // trading
  'POST /trade/swap': 'swap',
  'POST /swap': 'swap',
  'POST /swap-pools/*/liquidity': 'liquidity_add',
  'POST /swap-pools/*/liquidity/single': 'liquidity_add',
  'POST /swap-pools/*/liquidity/multi-token': 'liquidity_add',
  'DELETE /swap-pools/*/liquidity': 'liquidity_remove',
  'DELETE /swap-pools/*/liquidity/multi-token': 'liquidity_remove',
  'DELETE /swap-pools/*/liquidity/multi-token/one-coin': 'liquidity_remove',
  'POST /poolv3/pools': 'v3_pool_create',
  'POST /poolv3/positions': 'v3_position_create',
  'POST /poolv3/positions/increase': 'v3_position_increase',
  'POST /poolv3/positions/collect': 'v3_position_collect',
  'DELETE /poolv3/positions': 'v3_position_burn',

  // lending
  'POST /lending/loans': 'borrow',
  'POST /lending/loans/borrow-max': 'borrow_max',
  'PATCH /lending/loans': 'repay',
  'POST /lending/loans/repay-all': 'repay_all',
  'POST /lending/collateral': 'collateral_supply',
  'DELETE /lending/collateral': 'collateral_withdraw',
  'POST /lending/collateral/withdraw-max': 'collateral_withdraw_max',
  'POST /lending/pools/liquidity': 'lend_liquidity_deposit',
  'DELETE /lending/pools/liquidity': 'lend_liquidity_withdraw',
  'POST /lending/pools/withdraw-all': 'lend_liquidity_withdraw_all',
  'POST /lend/liquidate/*': 'liquidate',

  // safety module
  'POST /lending/safety/stake': 'safety_stake',
  'POST /lending/safety/cooldown': 'safety_cooldown',
  'POST /lending/safety/redeem': 'safety_redeem',
  'POST /lending/safety/redeem-all': 'safety_redeem_all',

  // cdp
  'POST /cdp/deposit': 'cdp_deposit',
  'POST /cdp/withdraw': 'cdp_withdraw',
  'POST /cdp/withdraw-max': 'cdp_withdraw_max',
  'POST /cdp/mint': 'cdp_mint',
  'POST /cdp/mint-max': 'cdp_mint_max',
  'POST /cdp/repay': 'cdp_repay',
  'POST /cdp/repay-all': 'cdp_repay_all',
  'POST /cdp/liquidate': 'cdp_liquidate',
  'POST /cdp/bad-debt/open-junior-note': 'junior_note_open',
  'POST /cdp/bad-debt/top-up-junior-note': 'junior_note_topup',
  'POST /cdp/bad-debt/claim-junior-note': 'junior_note_claim',

  // staking
  'POST /staking/stake': 'stake',
  'POST /staking/unstake': 'unstake',
  'POST /staking/move': 'stake_move',
  'POST /staking/claim': 'stake_claim',
  'POST /staking/withdraw-unbonded': 'stake_withdraw_unbonded',
  'POST /staking/self-bond': 'stake_self_bond',
  'POST /staking/self-unbond': 'stake_self_unbond',
  'POST /staking/operator/claim': 'stake_operator_claim',
  'POST /staking/commission': 'stake_commission',

  // earn
  'POST /earn/save-usdst/deposit': 'save_deposit',
  'POST /earn/save-usdst/redeem': 'save_redeem',
  'POST /earn/save-usdst/redeem-all': 'save_redeem_all',
  'POST /earn/yield-vault/*/deposit': 'yield_vault_deposit',
  'POST /earn/yield-vault/*/redeem': 'yield_vault_redeem',
  'POST /earn/yield-vault/*/redeem-all': 'yield_vault_redeem_all',
  'POST /earn/yield-vault/*/claim': 'yield_vault_claim',
  'POST /vault/deposit': 'basket_vault_deposit',
  'POST /vault/withdraw': 'basket_vault_withdraw',

  // stablecoin / bridge / metals
  'POST /psm/mint': 'psm_mint',
  'POST /psm/redeem': 'psm_redeem',
  'POST /bridge/requestWithdrawal': 'bridge_out',
  'POST /metal-forge/buy': 'metal_buy',

  // assets
  'POST /tokens/transfer': 'token_transfer',
  'POST /tokens/transferFrom': 'token_transfer_from',
  'POST /tokens/approve': 'token_approve',
  'POST /nfts/*/transfer': 'nft_transfer',
  'POST /nfts/*/burn': 'nft_burn',

  // money in / rewards / referral
  'POST /onramp/session': 'onramp_session',
  'POST /credit-card/manual-top-up': 'credit_card_top_up',
  'POST /rewards/claim-all': 'rewards_claim_all',
  'POST /rewards/claim/*': 'rewards_claim',
  'POST /refer/deposit': 'refer_deposit',
  'POST /refer/redeem': 'refer_redeem',
  'POST /refer/cancel': 'refer_cancel',
};

// Patterns are compiled once into anchored regexes. Note what is deliberately
// absent: /rpc/submit and /rpc/results (internal signing plumbing, fired many
// times per user action), the POST-as-read endpoints (/cdp/get-max-*,
// /cdp/asset-debt-info, /oracle/price), and every /admin/ route.
const API_EVENT_MATCHERS: Array<{ verb: string; re: RegExp; action: ApiAction }> =
  Object.entries(API_EVENT_MAP).map(([key, action]) => {
    const spaceAt = key.indexOf(' ');
    const verb = key.slice(0, spaceAt);
    const pattern = key.slice(spaceAt + 1);
    const source = pattern
      .split('/')
      .map((seg) => (seg === '*' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/');
    return { verb, re: new RegExp(`^${source}/?$`), action };
  });

/**
 * Collapses runtime identifiers out of a request path so `path` stays a
 * low-cardinality property. `/nfts/0xabc.../transfer` -> `/nfts/:addr/transfer`.
 */
export function normalizePath(url: string): string {
  return url
    .split('?')[0]
    .replace(/0x[a-fA-F0-9]{6,}/g, ':addr')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:id');
}

/** Resolves an axios method+url to an action name, or null if untracked. */
export function resolveApiAction(method: string, url: string): ApiAction | null {
  const verb = (method || 'get').toUpperCase();
  if (verb !== 'POST' && verb !== 'PUT' && verb !== 'PATCH' && verb !== 'DELETE') return null;
  const path = (url || '').split('?')[0];
  for (const m of API_EVENT_MATCHERS) {
    if (m.verb === verb && m.re.test(path)) return m.action;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function ready(): boolean {
  try {
    return typeof posthog !== 'undefined' && !!(posthog as { __loaded?: boolean }).__loaded;
  } catch {
    return false;
  }
}

/**
 * Records a product event. Never throws — analytics must not be able to break
 * a transaction flow.
 */
export function capture(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!ready()) return;
  try {
    posthog.capture(event, props);
  } catch {
    // swallow: analytics is never load-bearing
  }
}

/** Convenience for the auto-instrumented API actions. */
export function captureApi(
  action: ApiAction,
  phase: 'started' | 'succeeded' | 'failed',
  props?: Record<string, unknown>
): void {
  capture(`${action}_${phase}` as ApiActionEvent, { action, ...props });
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The single place that decides what a person's distinct ID is. Today this is
 * the lowercased STRATO address, matching the GA4 `user_id` already set in
 * UserContext. If the privacy call changes, hash here and nowhere else.
 */
export function analyticsUserId(address: string): string {
  return address.toLowerCase();
}

export interface IdentifyArgs {
  address: string;
  userName?: string | null;
  isAdmin?: boolean;
  isNewUser?: boolean;
}

export function identifyUser({ address, userName, isAdmin }: IdentifyArgs): void {
  if (!ready() || !address) return;
  try {
    posthog.identify(analyticsUserId(address), {
      strato_address: address,
      user_name: userName ?? undefined,
      is_admin: !!isAdmin,
    });
  } catch {
    // swallow
  }
}

export function resetUser(): void {
  if (!ready()) return;
  try {
    posthog.reset();
  } catch {
    // swallow
  }
}

/**
 * Registers properties sent with every subsequent event. Called once from
 * main.tsx so all analysis can be split by mainnet vs testnet.
 */
export function registerEnvironment(): void {
  if (!ready()) return;
  try {
    const env = (window as { ENV?: { NETWORK_NAME?: string; CHAIN_ID?: unknown } }).ENV;
    posthog.register({
      network: env?.NETWORK_NAME || 'unknown',
      chain_id: env?.CHAIN_ID ?? null,
    });
  } catch {
    // swallow
  }
}
