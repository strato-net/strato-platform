// The node's nginx enforces CSRF on mutating (POST) requests to its API routes
// *before* checking auth, rejecting browser-User-Agent requests that lack a
// session cookie (403). Its intended escape hatch is the API-client User-Agent
// allowlist (curl/axios/node-fetch/…). An extension fetch can't set User-Agent
// directly, so we use declarativeNetRequest to set an API-client UA on the node
// API paths the wallet POSTs to: BLOC, strato-api, and the vault signature.

const API_USER_AGENT = "STRATO-Wallet-Extension axios/1.0";

// One rule per path substring (DNR urlFilter is a single substring per rule).
const PATHS = ["/bloc/", "/strato-api/", "/strato/v2.3/"];

export async function installCsrfBypassRule(): Promise<void> {
  try {
    const ids = PATHS.map((_, i) => i + 1);
    await browser.declarativeNetRequest.updateDynamicRules({
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
        condition: { urlFilter, requestMethods: ["post"] },
      })),
    });
  } catch (e) {
    console.error("Failed to install CSRF-bypass rules", e);
  }
}
