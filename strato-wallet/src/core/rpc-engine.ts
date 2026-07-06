// RpcEngine: the method router. Decides, per dApp request, whether to answer from
// controller state, proxy read-through to the node /rpc, or open an approval.
//
// `origin` is supplied by the content script (trusted boundary) and is used to
// gate account/signature access per dApp.

import { type Address, type Hex, hashMessage, hashTypedData } from "viem";
import { RpcError, RpcErrors, type RpcRequest } from "@/src/messaging/protocol";
import { keyring } from "./keyring";
import { rpcCall } from "./rpc";
import {
  getNetworks,
  getSelectedNetwork,
  upsertNetwork,
  setSelectedNetwork,
  chainIdToHex,
  deriveStratoUrls,
} from "./networks";
import { approvals } from "./approvals";
import { getPermission, grantPermission } from "./permissions";
import { sendEvmTransaction, type EvmTxRequest } from "./tx-evm";
import { sendBlocTransaction, type BlocTxParams } from "./tx-strato";

// Methods answered locally / proxied without approval.
const READ_THROUGH = new Set([
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "net_version",
  "net_listening",
  "web3_clientVersion",
]);

// A connected site sees the wallet's currently-active account (like MetaMask's
// global selected account). Switching the active account in the popup emits
// accountsChanged, so connected dApps follow the selection.
async function connectedAccounts(origin: string): Promise<Address[]> {
  const perm = await getPermission(origin);
  if (!perm) return [];
  const selected = await keyring.getSelectedAddress();
  if (!selected) return [];
  const known = (await keyring.getAccounts()).some(
    (a) => a.address.toLowerCase() === selected.toLowerCase()
  );
  return known ? [selected] : [];
}

async function requireConnected(origin: string): Promise<Address> {
  const accounts = await connectedAccounts(origin);
  if (accounts.length === 0) {
    throw RpcError.from(RpcErrors.unauthorized, "dApp is not connected");
  }
  return accounts[0];
}

export async function handleRpc(origin: string, req: RpcRequest): Promise<unknown> {
  const { method, params = [] } = req;
  const network = await getSelectedNetwork();
  const chainIdHex = chainIdToHex(network.chainId);

  switch (method) {
    case "eth_chainId":
      return chainIdHex;

    case "net_version":
      return network.chainId;

    case "eth_accounts":
      return connectedAccounts(origin);

    case "eth_requestAccounts": {
      const existing = await connectedAccounts(origin);
      if (existing.length) return existing;
      // The connect approval also forces unlock + account selection in the UI.
      const accounts = (await approvals.request<Address[]>("connect", origin, {
        origin,
      })) as Address[];
      await grantPermission(origin, accounts);
      return accounts;
    }

    case "wallet_requestPermissions": {
      const accounts = await connectedAccounts(origin);
      if (!accounts.length) {
        const granted = await approvals.request<Address[]>("connect", origin, { origin });
        await grantPermission(origin, granted);
      }
      return [{ parentCapability: "eth_accounts" }];
    }

    case "eth_sendTransaction": {
      const from = await requireConnected(origin);
      const tx = (params[0] ?? {}) as EvmTxRequest;
      await approvals.request("signTransaction", origin, { tx, from, network: network.name });
      return sendEvmTransaction(network, { ...tx, from });
    }

    case "personal_sign": {
      const from = await requireConnected(origin);
      const message = params[0] as Hex; // per spec, data is params[0]
      await approvals.request("personalSign", origin, { message, from });
      const sig = await keyring.signHash(from, hashMessage({ raw: message }));
      return assembleSig(sig);
    }

    case "eth_signTypedData_v4": {
      const from = (params[0] as Address) ?? (await requireConnected(origin));
      const typed = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      await approvals.request("signTypedData", origin, { typed, from });
      const sig = await keyring.signHash(from, hashTypedData(typed));
      return assembleSig(sig);
    }

    case "strato_sendBlocTransaction": {
      const from = await requireConnected(origin);
      const blocParams = (params[0] ?? {}) as BlocTxParams;
      await approvals.request("stratoBlocTx", origin, { params: blocParams, from });
      return sendBlocTransaction(network, from, blocParams);
    }

    case "wallet_switchEthereumChain": {
      const target = (params[0] as { chainId: string })?.chainId?.toLowerCase();
      if (!target) throw RpcError.from(RpcErrors.invalidParams, "Missing chainId");
      if (target === chainIdHex.toLowerCase()) return null;
      // If we already know a network with that chain id, switch to it.
      const known = (await getNetworks()).find(
        (n) => chainIdToHex(n.chainId).toLowerCase() === target
      );
      if (known) {
        await setSelectedNetwork(known.id);
        return null;
      }
      // Otherwise tell the dApp to add it first (it follows up with addChain).
      throw RpcError.from({ code: 4902, message: "Unrecognized chain; add it first" });
    }

    case "wallet_addEthereumChain": {
      const p = params[0] as {
        chainId: string;
        chainName?: string;
        rpcUrls?: string[];
      };
      const chainIdDec = BigInt(p.chainId).toString();
      const rpcUrl = p.rpcUrls?.[0] ?? network.rpcUrl;
      // Auto-derive the STRATO BLOC/strato-api/vault bases from the rpc origin so
      // the native transaction flow works without manual setup.
      await upsertNetwork({
        id: `chain-${chainIdDec}`,
        name: p.chainName ?? `STRATO ${chainIdDec}`,
        rpcUrl,
        chainId: chainIdDec,
        ...deriveStratoUrls(rpcUrl),
      });
      await setSelectedNetwork(`chain-${chainIdDec}`);
      return null;
    }

    default:
      if (READ_THROUGH.has(method)) {
        return rpcCall(network.rpcUrl, method, params);
      }
      throw RpcError.from(RpcErrors.unsupportedMethod, `Unsupported method: ${method}`);
  }
}

/** Pack r/s/recovery into a 65-byte 0x signature (v = recovery + 27). */
function assembleSig(sig: { r: Hex; s: Hex; recovery: number }): Hex {
  const r = sig.r.replace(/^0x/, "").padStart(64, "0");
  const s = sig.s.replace(/^0x/, "").padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${v}` as Hex;
}
