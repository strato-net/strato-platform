import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { capture } from '@/lib/analytics';
import { fetchHasBridgedIn, isPopupDone, markPopupDone } from '@/lib/firstTimeUser';

// For design review, `localStorage.setItem('first-time-popup-preview', '1')`
// forces the popup for any logged-in account instead of the real check.
function previewForced(): boolean {
  try {
    return localStorage.getItem('first-time-popup-preview') === '1';
  } catch {
    return false;
  }
}

/**
 * Drives the first-time user dialog on the dashboard. Shows it to a logged-in
 * account that has not bridged in yet (lib/firstTimeUser -> Cirrus) until the
 * user closes it or acts on it; an account found to have bridged in is never
 * asked about again.
 */
export function useFirstTimeUserPopup(): {
  open: boolean;
  dismiss: () => void;
  acknowledgeCta: () => void;
} {
  const { userAddress, isLoggedIn } = useUser();
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
      if (!previewForced()) {
        if (isPopupDone(userAddress)) return;
        if (await fetchHasBridgedIn()) {
          markPopupDone(userAddress);
          return;
        }
        if (cancelled) return;
      }
      // Small delay so the dashboard paints first; the mock is a takeover,
      // not a loading screen.
      setTimeout(() => {
        if (cancelled) return;
        setOpen(true);
        capture('benefit_popup_viewed', { popup: 'first-time' });
      }, 1200);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, userAddress]);

  const close = useCallback(
    (event: 'benefit_popup_dismissed' | 'benefit_popup_cta_clicked') => {
      setOpen(false);
      if (userAddress) markPopupDone(userAddress);
      capture(event, { popup: 'first-time' });
    },
    [userAddress]
  );
  const dismiss = useCallback(() => close('benefit_popup_dismissed'), [close]);
  const acknowledgeCta = useCallback(() => close('benefit_popup_cta_clicked'), [close]);

  return { open, dismiss, acknowledgeCta };
}
