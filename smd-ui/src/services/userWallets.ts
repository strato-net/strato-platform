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
}

function extractUsername(row: any): string {
  const s = row?.storage;
  const data = Array.isArray(s) ? s[0] : s;
  return data?.username ?? "";
}

/**
 * User wallets that `ownerAddress` controls. A User contract stores its authorized
 * accounts in the `userAddresses` record-collection, exposed by cirrus via the
 * `mapping` table (columns: address = the User contract, value = an authorized
 * account). We join back to `storage` for the wallet's username:
 *   /cirrus/search/mapping?collection_name=eq.userAddresses&value=eq."<addr>"&select=address,storage(data->>username)
 */
export function useMyUserWallets(ownerAddress?: string | null) {
  return useQuery({
    queryKey: ["my-user-wallets", ownerAddress],
    enabled: !!ownerAddress,
    queryFn: async (): Promise<UserWallet[]> => {
      const value = encodeURIComponent(`"${strip0x(ownerAddress!)}"`);
      const { data } = await api.get(
        `${env.CIRRUS_URL}/mapping?collection_name=eq.userAddresses&value=eq.${value}&select=address,storage(data->>username)`
      );
      if (!Array.isArray(data)) return [];
      return data
        .map((row: any) => ({ address: row?.address ?? "", username: extractUsername(row) }))
        .filter((w) => w.address);
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
