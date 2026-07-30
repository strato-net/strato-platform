import { useEffect, useRef } from "react";
import pageHtml from "../strato-memecoin-partnership-onepager.html?raw";

/**
 * Renders the standalone one-pager HTML inline inside a Shadow DOM so its
 * global `body` and `*` CSS cannot leak into the app. No separate asset
 * request (would be blocked by WAF) and no iframe (would be blocked by CSP
 * `frame-src`).
 */
const CommunityRewardsOnePager = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || host.shadowRoot) return;
    const root = host.attachShadow({ mode: "open" });
    // `:root` does not match inside a shadow tree (shadow root is a DocumentFragment),
    // so rewrite to `:host` so the HTML's CSS custom properties cascade to descendants.
    root.innerHTML = pageHtml.replace(/:root\b/g, ":host");
  }, []);

  return <div ref={hostRef} className="fixed inset-0 z-[100] overflow-auto bg-[#F4F5FB]" />;
};

export default CommunityRewardsOnePager;
