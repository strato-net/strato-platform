// Returning-user "member benefit" popups (see docs/mockups: STRATO Returning
// User Popups). Which popup a user sees is decided from their on-chain history:
// each milestone action maps to Cirrus events already indexed for the My
// Activity feed, and we ask the existing /events/activities endpoint (with
// my_activity=true, limit 1) whether the user has ever emitted one. The count
// in the response is all we need — no new backend surface.

import { activityFeedApi } from './activityFeed';

export type MilestoneActionKey = 'deposit' | 'liquidity' | 'borrow' | 'stake';

export interface MilestoneAction {
  key: MilestoneActionKey;
  /** Label as shown under the progress bar in the mockup. */
  label: string;
  /** Where "Choose Your Next Move" sends the user when this is the next gap. */
  route: string;
  /** Cirrus (contract, event) pairs; any hit marks the action complete. */
  pairs: Array<{ contract_name: string; event_name: string }>;
}

// Keys must stay stable: they are persisted in the cached completion storage.
export const MILESTONE_ACTIONS: MilestoneAction[] = [
  {
    key: 'deposit',
    label: 'Deposit',
    route: '/dashboard/earn',
    pairs: [
      { contract_name: 'SaveUSDSTVault', event_name: 'Deposit' },
      { contract_name: 'YieldVault', event_name: 'Deposit' },
      { contract_name: 'Vault', event_name: 'Deposited' },
      { contract_name: 'LendingPool', event_name: 'Deposited' },
    ],
  },
  {
    key: 'liquidity',
    label: 'Provide Liquidity',
    // V3 Liquidity page; /dashboard/earn-pools is a per-pool detail page
    // that renders empty without a ?pool= address.
    route: '/dashboard/v3-liquidity',
    pairs: [
      { contract_name: 'Pool', event_name: 'AddLiquidity' },
      { contract_name: 'PoolV3', event_name: 'Mint' },
      { contract_name: 'PositionManagerV3', event_name: 'IncreaseLiquidity' },
    ],
  },
  {
    key: 'borrow',
    label: 'Borrow',
    route: '/dashboard/borrow',
    pairs: [
      { contract_name: 'LendingPool', event_name: 'Borrowed' },
      { contract_name: 'CDPEngine', event_name: 'USDSTMinted' },
    ],
  },
  {
    key: 'stake',
    label: 'Stake',
    route: '/dashboard/earn-staking',
    pairs: [{ contract_name: 'StratoStaking', event_name: 'Staked' }],
  },
];

export type ActionCompletion = Record<MilestoneActionKey, boolean>;

// Only the milestone popup (mock slide 3) ships for now; the deposit-boost
// popup (slide 2) was removed pending product sign-off — see git history.
export type MemberBenefitPopup = {
  kind: 'milestone';
  completion: ActionCompletion;
  completedCount: number;
};

// ---------------------------------------------------------------------------
// Eligibility from Cirrus
// ---------------------------------------------------------------------------

const ACTIONS_CACHE_PREFIX = 'memberBenefitActions_';
const ACTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // history only ever grows

/**
 * Has the user ever performed each milestone action? One /events/activities
 * call per action (limit 1, my_activity) — the returned total is an existence
 * check. Cached per address for a few hours since history is append-only.
 */
export async function fetchActionCompletion(userAddress: string): Promise<ActionCompletion> {
  const cacheKey = `${ACTIONS_CACHE_PREFIX}${userAddress.toLowerCase()}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    // A fully-completed cache never needs refreshing; a partial one does,
    // since the user may have completed another action since we looked.
    if (cached && Date.now() - cached.ts < ACTIONS_CACHE_TTL_MS) {
      return cached.completion as ActionCompletion;
    }
  } catch {
    // fall through to a live fetch
  }

  let anyFailed = false;
  const results = await Promise.all(
    MILESTONE_ACTIONS.map(async (action) => {
      try {
        const res = await activityFeedApi.getActivities(action.pairs, {
          limit: 1,
          myActivity: true,
        });
        return [action.key, res.total > 0] as const;
      } catch {
        // On failure, claim completion: it suppresses popups rather than
        // showing a wrong "you haven't done this yet" to a user who has.
        anyFailed = true;
        return [action.key, true] as const;
      }
    })
  );

  const completion = Object.fromEntries(results) as ActionCompletion;
  // Never cache a degraded result — a transient failure here would otherwise
  // suppress the popup for the whole cache window.
  if (!anyFailed) {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), completion }));
    } catch {
      // storage full/blocked: just skip caching
    }
  }
  return completion;
}

/**
 * Is this a returning user at all? Zero milestone actions could mean a brand
 * new account or an active one that simply hasn't touched earn/borrow yet
 * (e.g. marketplace-only users). Any token transfer involving the address
 * settles it.
 */
export async function fetchHasAnyActivity(): Promise<boolean> {
  try {
    const res = await activityFeedApi.getActivities(
      [{ contract_name: 'Token', event_name: 'Transfer' }],
      { limit: 1, myActivity: true }
    );
    return res.total > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Popup selection
// ---------------------------------------------------------------------------

/**
 * Decide whether the returning user should see the milestone popup. There is
 * no snooze: eligible users see it once per dashboard visit.
 *
 * - 4 of 4: nothing to nudge — the milestone is complete.
 * - 0–3 of 4: the milestone popup ("One More Move Unlocks 500 Points"). At
 *   0 of 4 the caller must confirm the user is returning at all
 *   (hasAnyActivity) — brand-new accounts get nothing; these are
 *   returning-user campaigns (the mockups' slide 1, the STRATO Odds credit,
 *   is out of scope here).
 */
export function selectPopup(
  completion: ActionCompletion,
  hasAnyActivity: boolean
): MemberBenefitPopup | null {
  const completedCount = MILESTONE_ACTIONS.filter((a) => completion[a.key]).length;

  if (completedCount >= MILESTONE_ACTIONS.length) return null;
  if (completedCount === 0 && !hasAnyActivity) return null;

  return { kind: 'milestone', completion, completedCount };
}

/** First incomplete milestone action — the "Choose Your Next Move" target. */
export function nextMoveRoute(completion: ActionCompletion): string {
  const next = MILESTONE_ACTIONS.find((a) => !completion[a.key]);
  return next?.route ?? '/dashboard/earn';
}
