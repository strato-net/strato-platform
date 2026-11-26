// First-time user popup: an account that has not bridged in yet is told that
// bridging in is gas sponsored and walked to its first trade
// (FirstTimeUserDialog). "Not bridged in" is read from on-chain history: no
// completed bridge deposit names the account as recipient, asked of the
// existing /events/activities endpoint (my_activity, limit 1). The count in
// the response is all we need — no new backend surface.

import { activityFeedApi } from './activityFeed';

/** Vouchers the bridge service mints per bridge-in (services/bridge config `voucher.mintCount`). */
export const SPONSORED_TXNS_PER_BRIDGE_IN = 25;

/**
 * Has this account ever received a bridge deposit (the two events the bridge
 * service mints vouchers on)? A failed lookup claims it has: that suppresses
 * the popup rather than pitching a first bridge-in to a user who has done one.
 */
export async function fetchHasBridgedIn(): Promise<boolean> {
  try {
    const res = await activityFeedApi.getActivities(
      [
        { contract_name: 'MercataBridge', event_name: 'DepositCompleted' },
        { contract_name: 'StratoNativeBridge', event_name: 'NativeDepositCompleted' },
      ],
      { limit: 1, myActivity: true }
    );
    return res.total > 0;
  } catch {
    return true;
  }
}

const DONE_PREFIX = 'firstTimePopupDone_';

/** Has this account already closed or acted on the popup, or been found to have bridged in? */
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
