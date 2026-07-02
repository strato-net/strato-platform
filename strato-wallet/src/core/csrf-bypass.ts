// The node's nginx enforces CSRF on mutating (POST) requests to its API routes
// *before* checking auth, rejecting browser-User-Agent requests that lack a
// session cookie (403). Its intended escape hatch is the API-client User-Agent
// allowlist (curl/axios/node-fetch/…). An extension fetch can't set User-Agent
// directly, so we use declarativeNetRequest to set an API-client UA on the node
// API paths the wallet POSTs to: BLOC, strato-api, and the vault signature.
//
// This rule MUST only touch the wallet's OWN requests. All wallet node requests
// run in the background service worker (dApp: inpage -> content -> background ->
// rpc-engine; UI: runtime.onMessage -> background), so they carry tabId === -1.
// We scope the rule to tabIds:[-1] so it never rewrites the User-Agent on a host
// page's own requests. Without this scoping the broad urlFilters also matched a
// page's requests — e.g. smd-ui's authenticated POST /strato/v2.3/transaction —
// stripping its real browser UA so nginx stopped treating it as a session-cookie
// request and returned 401. tabIds is only supported on session-scoped rules.

const API_USER_AGENT = "STRATO-Wallet-Extension axios/1.0";

// One rule per path substring (DNR urlFilter is a single substring per rule).
const PATHS = ["/bloc/", "/strato-api/", "/strato/v2.3/"];

export async function installCsrfBypassRule(): Promise<void> {
  const ids = PATHS.map((_, i) => i + 1);

  // Older builds installed these as *dynamic* rules (persistent, and unscoped by
  // tabId, so they leaked onto host-page requests). Clear them so an upgraded
  // install doesn't keep rewriting page requests via the stale rule.
  try {
    await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: ids });
  } catch (e) {
    console.error("Failed to clear legacy CSRF-bypass dynamic rules", e);
  }

  try {
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: ids,
      addRules: PATHS.map((urlFilter, i) => ({
        id: i + 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "user-agent", operation: "set", value: API_USER_AGENT },
          ],
        },
        // tabIds:[-1] restricts the rule to requests not tied to a browser tab —
        // i.e. the wallet's own background service-worker fetches — so host-page
        // (e.g. smd-ui) requests to the same paths keep their real User-Agent.
        condition: { urlFilter, requestMethods: ["post"], tabIds: [-1] },
      })),
    });
  } catch (e) {
    console.error("Failed to install CSRF-bypass rules", e);
  }
}
