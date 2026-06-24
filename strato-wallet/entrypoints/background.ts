// Background service worker = the wallet core. It (1) routes dApp JSON-RPC over
// the long-lived port from content scripts, and (2) serves the popup UI's control
// calls (keyring/networks/approvals) over runtime.sendMessage.

import { defineBackground } from "wxt/sandbox";
import { type Address } from "viem";
import {
  KEEPALIVE_PORT,
  INPAGE_TARGET,
  RpcError,
  RpcErrors,
  isRpcEnvelope,
} from "@/src/messaging/protocol";
import { isControlMessage, type ControlResponse } from "@/src/messaging/control";
import { handleRpc } from "@/src/core/rpc-engine";
import { keyring } from "@/src/core/keyring";
import { approvals } from "@/src/core/approvals";
import {
  getNetworks,
  getSelectedNetwork,
  setSelectedNetwork,
  upsertNetwork,
  signatureUrl,
  userInfoUrl,
  nativeSymbol,
  isStratoNetwork,
  type StratoNetwork,
} from "@/src/core/networks";
import { fetchEvmTokens, fetchEvmActivity } from "@/src/core/evm-portfolio";
import { loginWithStrato, fetchAddress } from "@/src/core/oauth";
import { installCsrfBypassRule } from "@/src/core/csrf-bypass";
import { getTxs } from "@/src/core/history";
import { fetchActivity } from "@/src/core/activity";
import { fetchTokens, fetchDefi } from "@/src/core/portfolio";
import { fetchPools, executeSwap, type SwapRequest } from "@/src/core/swap";
import {
  fetchBridgeConfig,
  fetchBridgeHistory,
  executeWithdrawal,
  executeDeposit,
  type BridgeRoute,
  type BridgeConfig,
} from "@/src/core/bridge";
import { rpcCall } from "@/src/core/rpc";
import { sendEvmTransaction, encodeErc20Transfer } from "@/src/core/tx-evm";
import { sendBlocTransaction, sendBlocCalls, type BlocTxParams } from "@/src/core/tx-strato";
import { listPermissions, revokePermission } from "@/src/core/permissions";

export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel (needs no action popup).
  chrome.sidePanel
    ?.setPanelBehavior?.({ openPanelOnActionClick: true })
    .catch((e) => console.error("setPanelBehavior failed", e));

  // Allow the Bearer-token vault signature POST past nginx's CSRF guard.
  installCsrfBypassRule();

  // Keep-alive: the popup/approval UI holds this port open so the service worker
  // (and its in-memory keyring + pending approvals) survives while a wallet
  // window is open. Accepting the connection is all that's needed.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== KEEPALIVE_PORT) return;
    port.onDisconnect.addListener(() => {
      /* no-op; the port's lifetime is what matters */
    });
  });

  // Single message router: dApp JSON-RPC (from content scripts) + popup control.
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (isRpcEnvelope(msg)) {
      const s = sender as { origin?: string; url?: string };
      const origin = s.origin ?? s.url ?? "unknown";
      const req = msg.payload;
      handleRpc(origin, req)
        .then((result) => sendResponse({ id: req.id, result }))
        .catch((e) => {
          const err =
            e instanceof RpcError
              ? { code: e.code, message: e.message, data: e.data }
              : { code: RpcErrors.internal.code, message: (e as Error).message };
          sendResponse({ id: req.id, error: err });
        });
      return true;
    }
    if (isControlMessage(msg)) {
      dispatchControl(msg.method, msg.args)
        .then((result) => sendResponse({ ok: true, result } satisfies ControlResponse))
        .catch((e) =>
          sendResponse({ ok: false, error: (e as Error).message } satisfies ControlResponse)
        );
      return true;
    }
    return true; // keep the channel open for the async response
  });
});

// Push an EIP-1193 provider event to the content scripts of the given origins.
async function sendEventToOrigins(
  origins: Set<string>,
  event: string,
  data: unknown
): Promise<void> {
  if (origins.size === 0) return;
  const tabs = await browser.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue;
    let origin: string;
    try {
      origin = new URL(tab.url).origin;
    } catch {
      continue;
    }
    if (!origins.has(origin)) continue;
    browser.tabs
      .sendMessage(tab.id, { target: INPAGE_TARGET, payload: { event, data } })
      .catch(() => {
        /* no content script in that tab; ignore */
      });
  }
}

// Broadcast to all connected origins (so we never leak to unapproved sites).
async function broadcastEvent(event: string, data: unknown): Promise<void> {
  const origins = new Set((await listPermissions()).map((p) => p.origin));
  await sendEventToOrigins(origins, event, data);
}

// Control handler registry used by the popup UI.
async function dispatchControl(method: string, args: unknown[]): Promise<unknown> {
  switch (method) {
    // wallet lifecycle
    case "wallet.isInitialized":
      return keyring.isInitialized();
    case "wallet.isUnlocked":
      return keyring.isUnlocked();
    case "wallet.create":
      return keyring.createVault(args[0] as string, args[1] as string | undefined);
    case "wallet.unlock":
      return keyring.unlock(args[0] as string);
    case "wallet.lock":
      await keyring.lock();
      return true;
    case "wallet.revealMnemonic":
      return keyring.revealMnemonic(args[0] as string, args[1] as string | undefined);
    case "wallet.exportPrivateKey":
      return keyring.exportPrivateKey(args[0] as Address, args[1] as string);

    // accounts
    case "accounts.list":
      return keyring.getAccounts();
    case "wallets.list":
      return keyring.listHdWallets();
    case "accounts.selected":
      return keyring.getSelectedAddress();
    case "accounts.rename":
      return keyring.renameAccount(args[0] as Address, args[1] as string);
    case "accounts.select": {
      await keyring.setSelectedAddress(args[0] as Address);
      // Connected dApps follow the active account.
      await broadcastEvent("accountsChanged", [args[0] as Address]);
      return true;
    }
    case "accounts.addHd":
      return keyring.addHdAccount(args[0] as string | undefined, args[1] as string | undefined);
    case "accounts.importPrivateKey":
      return keyring.importPrivateKey(args[0] as string, args[1] as string | undefined);
    case "accounts.importSeed":
      return keyring.importHdWallet(args[0] as string, args[1] as string | undefined);
    case "accounts.createWallet":
      return keyring.createHdWallet(args[0] as string | undefined);
    case "oauth.login": {
      // Interactive "Login with STRATO": OAuth (PKCE) -> address -> remote account.
      const network = args[0]
        ? (await getNetworks()).find((n) => n.id === args[0]) ?? (await getSelectedNetwork())
        : await getSelectedNetwork();
      if (!network.oauthIssuer || !network.oauthClientId) {
        throw new Error(
          "This network has no OAuth issuer/client configured. Set them in Settings."
        );
      }
      const tokens = await loginWithStrato(network.oauthIssuer, network.oauthClientId);
      const { address, username } = await fetchAddress(
        userInfoUrl(network),
        tokens.accessToken
      );
      return keyring.addOAuthAccount(
        address as Address,
        tokens,
        signatureUrl(network),
        username
      );
    }

    // networks
    case "networks.list":
      return getNetworks();
    case "networks.selected":
      return getSelectedNetwork();
    case "networks.select":
      return setSelectedNetwork(args[0] as string);
    case "networks.upsert":
      return upsertNetwork(args[0] as StratoNetwork);

    // balances / sending from the popup
    case "balance": {
      const network = await getSelectedNetwork();
      return rpcCall<string>(network.rpcUrl, "eth_getBalance", [
        args[0] as Address,
        "latest",
      ]);
    }
    case "tx.sendEvm": {
      const network = await getSelectedNetwork();
      return sendEvmTransaction(network, {
        from: args[0] as Address,
        to: args[1] as string,
        value: args[2] as string,
      });
    }
    case "tx.sendBloc": {
      const network = await getSelectedNetwork();
      return sendBlocTransaction(network, args[0] as Address, args[1] as BlocTxParams);
    }
    case "tx.sendToken": {
      const network = await getSelectedNetwork();
      const [from, tokenAddress, to, value] = args as [Address, string, string, string];
      if (isStratoNetwork(network)) {
        // STRATO: any BlockApps-Token (incl. native USDST) via Token.transfer.
        return sendBlocCalls(
          network,
          from,
          [
            {
              contractName: "Token",
              contractAddress: String(tokenAddress).replace(/^0x/, ""),
              method: "transfer",
              args: { to: String(to).replace(/^0x/, ""), value },
            },
          ],
          { gasLimit: 32_100_000_000, gasPrice: 1 }
        );
      }
      // EVM: native coin → value transfer; ERC-20 → encoded transfer() calldata.
      const isNative = /^0x0+$/i.test(String(tokenAddress));
      if (isNative) {
        return sendEvmTransaction(network, { from, to, value: String(value) });
      }
      return sendEvmTransaction(network, {
        from,
        to: tokenAddress,
        data: encodeErc20Transfer(to, value),
        value: "0",
      });
    }

    // approvals
    case "approvals.queue":
      return approvals.getQueue();
    case "approvals.resolve":
      return approvals.resolve(args[0] as string, args[1]);
    case "approvals.reject":
      return approvals.reject(args[0] as string, RpcErrors.userRejected);

    // activity
    case "history.list":
      return getTxs(args[0] as Address, args[1] as string);
    case "activity.list": {
      const n = await getSelectedNetwork();
      return isStratoNetwork(n)
        ? fetchActivity(n, args[0] as string, (args[1] as number) ?? 25)
        : fetchEvmActivity(n.chainId, args[0] as string, nativeSymbol(n));
    }
    case "tokens.list": {
      const n = await getSelectedNetwork();
      return isStratoNetwork(n)
        ? fetchTokens(n, args[0] as string)
        : fetchEvmTokens(n.chainId, args[0] as string);
    }
    case "defi.list": {
      const n = await getSelectedNetwork();
      return isStratoNetwork(n) ? fetchDefi(n, args[0] as string) : [];
    }
    case "swap.pools": {
      const n = await getSelectedNetwork();
      return isStratoNetwork(n) ? fetchPools(n) : [];
    }
    case "swap.execute":
      return executeSwap(await getSelectedNetwork(), args[0] as Address, args[1] as SwapRequest);

    // bridge (registry lives on STRATO regardless of the selected network)
    case "bridge.config": {
      const strato = (await getNetworks()).find(isStratoNetwork);
      return strato
        ? fetchBridgeConfig(strato)
        : { bridgeAddr: "", nativeBridgeAddr: "", custodyVault: "", routes: [], chains: [] };
    }
    case "bridge.history": {
      const strato = (await getNetworks()).find(isStratoNetwork);
      return strato ? fetchBridgeHistory(strato, args[0] as string) : [];
    }
    case "bridge.withdraw": {
      const strato = (await getNetworks()).find(isStratoNetwork);
      if (!strato) throw new Error("No STRATO network configured");
      return executeWithdrawal(
        strato,
        args[1] as BridgeConfig,
        args[0] as Address,
        args[2] as BridgeRoute,
        args[3] as string,
        args[4] as string
      );
    }
    case "bridge.deposit": {
      // Source is the currently-selected EVM network.
      return executeDeposit(
        await getSelectedNetwork(),
        args[0] as Address,
        args[1] as BridgeRoute,
        args[2] as string,
        args[3] as string,
        args[4] as string
      );
    }

    // permissions
    case "permissions.list":
      return listPermissions();
    case "permissions.revoke": {
      const origin = args[0] as string;
      await revokePermission(origin);
      // Tell the site it's disconnected (no accounts).
      await sendEventToOrigins(new Set([origin]), "accountsChanged", []);
      return true;
    }

    default:
      throw new Error(`Unknown control method: ${method}`);
  }
}
