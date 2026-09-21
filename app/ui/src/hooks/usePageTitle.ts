import { useEffect } from "react";

/** Brand prefix every title carries, and the title the tab falls back to. */
export const SITE_NAME = "STRATO";
export const DEFAULT_TITLE = "STRATO | Where Stability Meets Opportunity";

/**
 * `"Rewards"` -> `"STRATO | Rewards"`. A title that already leads with the brand
 * — the home page's tagline, the landing pages' fully-formed titles — is left
 * alone rather than picking up a second prefix.
 */
export const formatPageTitle = (title?: string | null): string => {
  const trimmed = title?.trim();
  if (!trimmed) return DEFAULT_TITLE;
  if (trimmed === SITE_NAME || trimmed.startsWith(`${SITE_NAME} | `)) return trimmed;
  return `${SITE_NAME} | ${trimmed}`;
};

/**
 * Sets the browser tab title for the mounted page and restores the default on
 * unmount, so a route that has nothing to say never inherits the previous
 * page's title. Pass `undefined`/`null` (e.g. while a record is still loading)
 * to show the default until the real title is known.
 */
export const usePageTitle = (title?: string | null): void => {
  useEffect(() => {
    document.title = formatPageTitle(title);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
};

export default usePageTitle;
