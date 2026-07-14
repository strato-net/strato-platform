import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";

/** UserRegistry is deployed at 0x720 in genesis; createUser() lives here. */
export const USER_REGISTRY_ADDRESS = "0000000000000000000000000000000000000720";
export const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

export const strip0x = (s: string): string => (s || "").replace(/^0x/, "").toLowerCase();

export interface UserWallet {
  /** The User wallet contract address. */
  address: string;
  username: string;
  /**
   * True when the connected account controls this wallet as a multisig **signer**
   * (it's in the wallet's `adminMap`) rather than as a direct owner/authorized
   * account. Multisig wallets are self-owned, so signers aren't in `userAddressMap`.
   */
  multisig?: boolean;
}

function extractUsername(row: any): string {
  const s = row?.storage;
  const data = Array.isArray(s) ? s[0] : s;
  return data?.username ?? "";
}

/**
 * User wallets the connected account can act on. Two sources, merged and deduped:
 *  - `userAddressMap` (address => uint): wallets it owns / is an authorized account on.
 *  - `adminMap` (address => uint, value = index+1): wallets it's a multisig **signer**
 *    on. Once a wallet is converted to a self-owned multisig, `transferOwnership`
 *    clears its owner out of `userAddressMap`, so signers only appear here.
 * Both cirrus queries key on the connected account and join `storage` for the username;
 * the global AdminRegistry/Governance also have an `adminMap` but no username, so
 * requiring a username naturally excludes them. Removed accounts are zeroed out in the
 * mappings rather than deleted, so both queries require value > 0.
 */
export function useMyUserWallets(ownerAddress?: string | null) {
  return useQuery({
    queryKey: ["my-user-wallets", ownerAddress],
    enabled: !!ownerAddress,
    queryFn: async (): Promise<UserWallet[]> => {
      const key = strip0x(ownerAddress!);
      const select = "select=address,storage(data-%3E%3Eusername)";
      const [ownedRes, signerRes] = await Promise.all([
        api.get(`${env.CIRRUS_URL}/mapping?collection_name=eq.userAddressMap&key-%3E%3Ekey=eq.${key}&value=gt.0&${select}`),
        api.get(`${env.CIRRUS_URL}/mapping?collection_name=eq.adminMap&key-%3E%3Ekey=eq.${key}&value=gt.0&${select}`),
      ]);

      const byAddr = new Map<string, UserWallet>();
      for (const row of Array.isArray(ownedRes.data) ? ownedRes.data : []) {
        const address = row?.address ?? "";
        if (!address) continue;
        byAddr.set(address, { address, username: extractUsername(row), multisig: false });
      }
      for (const row of Array.isArray(signerRes.data) ? signerRes.data : []) {
        const address = row?.address ?? "";
        const username = extractUsername(row);
        if (!address || !username) continue; // no username => a global registry, skip
        const existing = byAddr.get(address);
        if (existing) existing.multisig = true;
        else byAddr.set(address, { address, username, multisig: true });
      }
      return [...byAddr.values()];
    },
    refetchInterval: 15000,
  });
}

// ---- Policy (logic contract) builder -------------------------------------------------

export type PolicyTemplate = "allowlist" | "reject";
export type DefaultAction = "reject" | "allow";

export interface PolicyParams {
  /** Generated logic contract name. */
  contractName: string;
  /** The function name external callers invoke on the wallet (delegated to the logic contract). */
  handler: string;
  /** Addresses for the allowlist/blocklist. */
  addresses: string[];
  /** What to do with callers NOT in the list: reject (allowlist) or allow (blocklist). */
  defaultAction: DefaultAction;
}

function sanitizeIdent(s: string, fallback: string): string {
  const cleaned = (s || "").replace(/[^A-Za-z0-9_]/g, "");
  if (!cleaned || !/^[A-Za-z_]/.test(cleaned)) return fallback;
  return cleaned;
}

/**
 * Generate a stateless logic-contract source for a User wallet policy. The User
 * contract's Proxy.fallback delegatecalls this contract (in the wallet's storage
 * context) whenever another account calls a function the wallet doesn't define —
 * so `handler` is the entry point that "reacts" to incoming calls. Kept stateless
 * (policy baked into code) to avoid colliding with the wallet's storage layout.
 */
export function generatePolicySource(template: PolicyTemplate, p: PolicyParams): string {
  const name = sanitizeIdent(p.contractName, "WalletPolicy");
  const handler = sanitizeIdent(p.handler, "onCall");

  if (template === "reject") {
    return `contract ${name} {
    // Reject every external call delegated to the wallet.
    function ${handler}(string data) public returns (string) {
        require(false, "${name}: external calls are rejected");
        return data;
    }
}
`;
  }

  // allowlist / blocklist (driven by defaultAction)
  const addrs = p.addresses.map(strip0x).filter((a) => a.length === 40);
  const isAllowlist = p.defaultAction === "reject";
  let guard: string;
  if (addrs.length === 0) {
    // No addresses: allowlist => reject everyone; blocklist => allow everyone.
    guard = isAllowlist
      ? `        require(false, "${name}: caller is not allowed");`
      : "";
  } else if (isAllowlist) {
    const checks = addrs.map((a) => `caller == 0x${a}`).join(" ||\n            ");
    guard = `        require(\n            ${checks},\n            "${name}: caller is not allowed"\n        );`;
  } else {
    const checks = addrs.map((a) => `caller != 0x${a}`).join(" &&\n            ");
    guard = `        require(\n            ${checks},\n            "${name}: caller is blocked"\n        );`;
  }

  return `contract ${name} {
    // ${isAllowlist ? "Allowlist" : "Blocklist"}: ${
    isAllowlist ? "only listed accounts may call in." : "every account except those listed may call in."
  }
    function ${handler}(string data) public returns (string) {
        address caller = msg.sender;
${guard}
        return data;
    }
}
`;
}
