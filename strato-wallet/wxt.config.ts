import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // `wxt zip` produces the Chrome Web Store upload. The store assigns the item's
    // ID itself and does not accept a `key` for a different ID, so strip the dev
    // key from the built manifest right before it is zipped. WXT builds before
    // any zip hook runs, so this has to edit the manifest file on disk.
    // `wxt build` (unpacked dev installs) keeps the key and its pinned ID.
    "zip:extension:start"(wxt) {
      const path = resolve(wxt.config.outDir, "manifest.json");
      const manifest = JSON.parse(readFileSync(path, "utf8"));
      delete manifest.key;
      writeFileSync(path, JSON.stringify(manifest));
    },
  },
  manifest: {
    name: "STRATO Wallet",
    description:
      "Self-custody wallet for STRATO — discoverable and interoperable with web3 dApps.",
    // Pins the extension id for UNPACKED builds only (-> stable chrome.identity
    // redirect URL, registered on the Keycloak OAuth client). Public key only; the
    // matching private key lives in .secrets/ (gitignored). This does NOT set the
    // Web Store ID: the store item is mcpoppjibmdndbnpdlbmediikmffohgi, and
    // `wxt zip` strips this key. Keycloak must allow both redirect URLs:
    //   https://ipngnmfnpphimalaoedplkcjlhhmcdii.chromiumapp.org/  (this key)
    //   https://mcpoppjibmdndbnpdlbmediikmffohgi.chromiumapp.org/  (Web Store)
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoXgq85nDLn+rO/Y+PvlhEQVz6QBs9yuWhZVTDaI+FYt2E3AVE3AFOAO91+9b7z5ZxGocNXVPBCH+Ow2vWdzAR/p06E9O1JOjdRVQIDhHHRyHSLoKqvmCbecgjFxNA28Axh8aFxkBVswXKxqq1Uh/x88mVKfW3ErCGK9vPisqujE5UReBGrW08sMHpmcnTCFH6bUWW0bpAzm0yGxGzKrF5ptjfHhu7kBqzMKP2wPIpy3GGcl3Lj+a5Oic8LrH4xDyQHNd0Fr1JV3UqXwkhZ8sNAsDMJf2HmXtW8UqKoPNcB2b96dPzKj+qS3JZJLPx0rqEswXK7RgzNq0URK0tB8uqQIDAQAB",
    permissions: [
      "storage",
      "tabs",
      "identity",
      "declarativeNetRequest",
      "sidePanel",
      "alarms",
      "notifications",
    ],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "STRATO Wallet",
    },
  },
});
