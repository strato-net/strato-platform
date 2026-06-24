import { defineConfig } from "wxt";

// WXT config. The React module wires up the JSX/Vite setup for the popup. The
// EIP-1193 provider (inpage.content.ts) is a MAIN-world content script, so the
// browser injects it directly — no web-accessible resource / script-tag needed.
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  srcDir: ".",
  // The toolbar icon opens the side panel (set via sidePanel.setPanelBehavior in
  // the background). That only takes effect when the action has NO default_popup,
  // so strip the one WXT auto-adds for the popup entrypoint. popup.html is still
  // built and used for the standalone approval window.
  hooks: {
    "build:manifestGenerated"(_wxt, manifest) {
      if (manifest.action) delete manifest.action.default_popup;
    },
  },
  manifest: {
    name: "STRATO Wallet",
    description:
      "Self-custody wallet for STRATO — discoverable and interoperable with web3 dApps.",
    // Pins the extension id (-> stable chrome.identity redirect URL) so it can be
    // registered as a Keycloak OAuth client. Public key only; the matching private
    // key lives in .secrets/ (gitignored) for Web Store packaging.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoXgq85nDLn+rO/Y+PvlhEQVz6QBs9yuWhZVTDaI+FYt2E3AVE3AFOAO91+9b7z5ZxGocNXVPBCH+Ow2vWdzAR/p06E9O1JOjdRVQIDhHHRyHSLoKqvmCbecgjFxNA28Axh8aFxkBVswXKxqq1Uh/x88mVKfW3ErCGK9vPisqujE5UReBGrW08sMHpmcnTCFH6bUWW0bpAzm0yGxGzKrF5ptjfHhu7kBqzMKP2wPIpy3GGcl3Lj+a5Oic8LrH4xDyQHNd0Fr1JV3UqXwkhZ8sNAsDMJf2HmXtW8UqKoPNcB2b96dPzKj+qS3JZJLPx0rqEswXK7RgzNq0URK0tB8uqQIDAQAB",
    permissions: ["storage", "tabs", "identity", "declarativeNetRequest", "sidePanel"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "STRATO Wallet",
    },
  },
});
