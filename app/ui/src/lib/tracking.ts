// Fire-and-forget beacons for the tracking-links feature. The tracking session
// cookie is HttpOnly and set by the /t/<slug> resolver, so the SPA cannot see
// it — both beacons are sent unconditionally. Nothing here may ever call gtag
// or include prospect labels. Wallet addresses stay first-party; PostHog gets
// only a wallet-connected event and its own anonymous session context.

import posthog from 'posthog-js';
import { getCsrfToken } from './csrf';

let engageFired = false;
const reportedAddresses = new Set<string>();

function csrfHeader(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

// Marks the session as engaged (a real JS-executing visitor, not an email
// scanner or link-preview bot). Called once per page load from main.tsx.
export function trackEngage(): void {
  if (engageFired) return;
  engageFired = true;
  try {
    fetch('/tracking-api/engage', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: csrfHeader(),
    }).catch(() => {});
  } catch {
    // never let tracking break the app
  }
}

export interface WalletConnectedArgs {
  externalWalletAddress?: string | null;
  stratoAddress?: string | null;
  connector?: string | null;
}

function posthogContext(args: WalletConnectedArgs): {
  posthogSessionId?: string;
  posthogDistinctId?: string;
} {
  try {
    const posthogSessionId = posthog.get_session_id();
    const posthogDistinctId = posthog.get_distinct_id();
    if (!posthogSessionId) return {};
    posthog.capture('wallet_connected', {
      connector: args.connector ?? undefined,
      has_external_wallet: !!args.externalWalletAddress,
      has_strato_account: !!args.stratoAddress,
    });
    return {
      posthogSessionId,
      posthogDistinctId: posthogDistinctId || undefined,
    };
  } catch {
    return {};
  }
}

// Reports a wallet/STRATO account becoming available. Deduped per lowercase
// address for the app session: the STRATO connector publishes the same address
// through wagmi and OAuth, and this guard collapses the two paths into one
// report. The server dedups again across reloads.
export function trackWalletConnected(args: WalletConnectedArgs): void {
  const addresses = [args.externalWalletAddress, args.stratoAddress]
    .filter((a): a is string => !!a)
    .map((a) => a.toLowerCase());
  const newAddresses = addresses.filter((a) => !reportedAddresses.has(a));
  if (newAddresses.length === 0) return;
  newAddresses.forEach((a) => reportedAddresses.add(a));
  const context = posthogContext(args);
  try {
    fetch('/tracking-api/wallet-connected', {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...csrfHeader() },
      body: JSON.stringify({
        externalWalletAddress: args.externalWalletAddress ?? undefined,
        stratoAddress: args.stratoAddress ?? undefined,
        connector: args.connector ?? undefined,
        ...context,
      }),
    }).catch(() => {});
  } catch {
    // never let tracking break the app
  }
}
