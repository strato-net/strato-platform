// First-time user popup: a brand-new account is told that bridging in is gas
// sponsored and walked to its first trade (FirstTimeUserDialog). "First time"
// is read from on-chain history: the account has never been party to a token
// transfer, asked of the existing /events/activities endpoint (my_activity,
// limit 1). The count in the response is all we need — no new backend surface.

import { activityFeedApi } from './activityFeed';

/** Vouchers the bridge service mints per bridge-in (services/bridge config `voucher.mintCount`). */
export const SPONSORED_TXNS_PER_BRIDGE_IN = 25;

/**
 * Has this account ever been party to a token transfer? A failed lookup
 * claims activity: it suppresses the popup rather than greeting a returning
 * user as new.
 */
export async function fetchHasAnyActivity(): Promise<boolean> {
  try {
    const res = await activityFeedApi.getActivities(
      [{ contract_name: 'Token', event_name: 'Transfer' }],
      { limit: 1, myActivity: true }
    );
    return res.total > 0;
  } catch {
    return true;
  }
}

const DONE_PREFIX = 'firstTimePopupDone_';

/** Has this account already closed or acted on the popup, or been found to have activity? */
export function isPopupDone(userAddress: string): boolean {
  try {
    return localStorage.getItem(`${DONE_PREFIX}${userAddress.toLowerCase()}`) === '1';
  } catch {
    return false;
  }
}

/** Never show the popup to this account again. */
export function markPopupDone(userAddress: string): void {
  try {
    localStorage.setItem(`${DONE_PREFIX}${userAddress.toLowerCase()}`, '1');
  } catch {
    // storage full/blocked: the popup may show again next visit
  }
}
