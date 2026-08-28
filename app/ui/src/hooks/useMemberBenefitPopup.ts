import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { capture } from '@/lib/analytics';
import {
  fetchActionCompletion,
  fetchHasAnyActivity,
  selectPopup,
  snoozePopup,
  type MemberBenefitPopup,
} from '@/lib/memberBenefits';

// Live for all logged-in users: eligibility is read from the user's on-chain
// history via Cirrus (lib/memberBenefits). For design review,
// `localStorage.setItem('member-benefit-preview', 'milestone')` forces the
// popup with sample 3-of-4 data instead of the real fetch.
function forcedPopup(): MemberBenefitPopup | null {
  try {
    if (localStorage.getItem('member-benefit-preview') !== 'milestone') return null;
  } catch {
    return null;
  }
  return {
    kind: 'milestone',
    completion: { deposit: true, liquidity: true, borrow: true, stake: false },
    completedCount: 3,
  };
}

/**
 * Drives the returning-user member-benefit dialog on the dashboard. Fetches
 * the user's on-chain action history (via lib/memberBenefits -> Cirrus),
 * picks at most one popup per session, and records snoozes on close/CTA.
 */
export function useMemberBenefitPopup(): {
  popup: MemberBenefitPopup | null;
  open: boolean;
  dismiss: () => void;
  acknowledgeCta: () => void;
} {
  const { userAddress, isLoggedIn } = useUser();
  const [popup, setPopup] = useState<MemberBenefitPopup | null>(null);
  const [open, setOpen] = useState(false);
  // One evaluation per address per mount: the dialog must not pop back up
  // as contexts refresh around it.
  const evaluatedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn || !userAddress) return;
    if (evaluatedFor.current === userAddress) return;
    evaluatedFor.current = userAddress;

    let cancelled = false;
    (async () => {
      let selected = forcedPopup();
      if (!selected) {
        const completion = await fetchActionCompletion(userAddress);
        if (cancelled) return;
        // The "returning user at all?" probe is only needed to tell a fresh
        // account (no popup) from an active one at 0 of 4 milestone actions.
        const noneDone = Object.values(completion).every((done) => !done);
        const hasAnyActivity = noneDone ? await fetchHasAnyActivity() : true;
        if (cancelled) return;
        selected = selectPopup(completion, userAddress, hasAnyActivity);
      }
      if (!selected) return;
      setPopup(selected);
      // Small delay so the dashboard paints first; the mock is a takeover,
      // not a loading screen.
      setTimeout(() => {
        if (cancelled) return;
        setOpen(true);
        capture('benefit_popup_viewed', {
          popup: selected.kind,
          ...(selected.kind === 'milestone'
            ? { completed_actions: selected.completedCount }
            : {}),
        });
      }, 1200);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, userAddress]);

  const dismiss = useCallback(() => {
    setOpen(false);
    if (popup && userAddress) {
      snoozePopup(popup, userAddress, 'dismiss');
      capture('benefit_popup_dismissed', { popup: popup.kind });
    }
  }, [popup, userAddress]);

  const acknowledgeCta = useCallback(() => {
    setOpen(false);
    if (popup && userAddress) {
      snoozePopup(popup, userAddress, 'cta');
      capture('benefit_popup_cta_clicked', { popup: popup.kind });
    }
  }, [popup, userAddress]);

  return { popup, open, dismiss, acknowledgeCta };
}
