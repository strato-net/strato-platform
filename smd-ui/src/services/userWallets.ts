import { useQuery } from "@tanstack/react-query";
import { keccak256, stringToHex, toRlp, type Hex } from "viem";
import { api } from "@/lib/api";
import { env } from "@/lib/env";

/** UserRegistry is deployed at 0x720 in genesis; createUser() lives here. */
export const USER_REGISTRY_ADDRESS = "0000000000000000000000000000000000000720";
export const ADMIN_REGISTRY_ADDRESS = "000000000000000000000000000000000000100c";
export const TOKEN_FACTORY_ADDRESS = "000000000000000000000000000000000000100b";
export const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

export const strip0x = (s: string): string => (s || "").replace(/^0x/, "").toLowerCase();

export const deriveCanonicalUserAddress = (username: string, registryCodeHash: string): string => {
  const codeHash = strip0x(registryCodeHash);
  if (!username || !/^[0-9a-f]{64}$/.test(codeHash)) return "";
  const encoded = toRlp([
    "0xff",
    `0x${USER_REGISTRY_ADDRESS}`,
    stringToHex(username),
    `0x${codeHash}`,
    stringToHex("User"),
    stringToHex(username),
  ] as Hex[]);
  return strip0x(keccak256(encoded).slice(-40));
};

let userRegistryCodeHash = "";

export async function fetchUserRegistryCodeHash(): Promise<string> {
  if (userRegistryCodeHash) return userRegistryCodeHash;
  const { data } = await api.get(
    `${env.CIRRUS_URL}/contract?address=eq.${USER_REGISTRY_ADDRESS}&select=code_hash&limit=1`
  );
  const codeHash = strip0x(String(Array.isArray(data) ? data[0]?.code_hash ?? "" : ""));
  if (!/^[0-9a-f]{64}$/.test(codeHash)) throw new Error("Could not verify UserRegistry");
  userRegistryCodeHash = codeHash;
  return codeHash;
}

export interface UserWallet {
  /** User-wallet contract address. */
  address: string;
  username: string;
}

function extractStorageData(row: any): any {
  const storage = row?.storage;
  const entry = Array.isArray(storage) ? storage[0] : storage;
  return entry?.data ?? entry ?? {};
}

function extractUsername(row: any): string {
  return extractStorageData(row)?.username ?? "";
}

/** User wallets controlled by the connected account. */
export function useMyUserWallets(ownerAddress?: string | null) {
  return useQuery({
    queryKey: ["my-user-wallets", ownerAddress],
    enabled: !!ownerAddress,
    queryFn: async (): Promise<UserWallet[]> => {
      const key = strip0x(ownerAddress!);
      const select = "select=address,storage(data-%3E%3Eusername)";
      const [ownedRes, registryCodeHash] = await Promise.all([
        api.get(
          `${env.CIRRUS_URL}/mapping?collection_name=eq.userAddressMap&key-%3E%3Ekey=eq.${key}&value=gt.0&${select}`
        ),
        fetchUserRegistryCodeHash(),
      ]);
      const ownedRows = Array.isArray(ownedRes.data) ? ownedRes.data : [];
      return ownedRows
        .map((row: any) => ({
          address: strip0x(String(row?.address ?? "")),
          username: String(extractUsername(row)),
        }))
        .filter((wallet: UserWallet) =>
          wallet.address === deriveCanonicalUserAddress(wallet.username, registryCodeHash)
        );
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
