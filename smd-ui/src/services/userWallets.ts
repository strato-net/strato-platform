import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env, runtime } from "@/lib/env";

/** UserRegistry is deployed at 0x720 in genesis; createUser() lives here. */
export const USER_REGISTRY_ADDRESS = "0000000000000000000000000000000000000720";
export const ADMIN_REGISTRY_ADDRESS = "000000000000000000000000000000000000100c";
export const ZERO_ADDRESS = "0000000000000000000000000000000000000000";

export const strip0x = (s: string): string => (s || "").replace(/^0x/, "").toLowerCase();

export interface UserWallet {
  /** User-wallet or dedicated-multisig contract address. */
  address: string;
  username: string;
  /** The connected account is a signer of this dedicated multisig. */
  multisig?: boolean;
  /** Address whose signer membership is used for dedicated-wallet calls. */
  signerAddress?: string;
  /** User-wallet routing name when signerAddress is a User wallet. */
  signerUsername?: string;
  /** The connected account is nominated but has not yet accepted signer status. */
  pendingSigner?: boolean;
  /** Address that must call acceptNomination for this pending membership. */
  nomineeAddress?: string;
  /** User-wallet routing name when the nominee is a User wallet. */
  nomineeUsername?: string;
  /** Fresh dedicated wallet created by the pinned canonical factory. */
  factoryMultisig?: boolean;
  /** Dedicated wallet has completed atomic initialization. */
  active?: boolean;
}

function extractStorageData(row: any): any {
  const storage = row?.storage;
  const entry = Array.isArray(storage) ? storage[0] : storage;
  return entry?.data ?? entry ?? {};
}

function extractUsername(row: any): string {
  return extractStorageData(row)?.username ?? "";
}

/** User wallets controlled by the account plus canonical dedicated multisig memberships. */
export function useMyUserWallets(ownerAddress?: string | null) {
  return useQuery({
    queryKey: ["my-user-wallets", ownerAddress],
    enabled: !!ownerAddress,
    queryFn: async (): Promise<UserWallet[]> => {
      const key = strip0x(ownerAddress!);
      const select = "select=address,storage(data-%3E%3Eusername)";
      const factory = runtime.multisigFactoryAddress();
      const dedicatedSelect =
        "select=address,key,value,storage(data-%3E%3EmultisigFactory,data-%3E%3EmultisigActive,data-%3E%3EmultisigEpoch)";
      const ownedRes = await api.get(
        `${env.CIRRUS_URL}/mapping?collection_name=eq.userAddressMap&key-%3E%3Ekey=eq.${key}&value=gt.0&${select}`
      );
      const ownedRows = Array.isArray(ownedRes.data) ? ownedRes.data : [];
      const ownedByAddress = new Map(
        ownedRows.map((row: any) => [strip0x(String(row?.address ?? "")), extractUsername(row)])
      );
      const controlledNominees = [key, ...ownedByAddress.keys()];
      const [dedicatedRes, dedicatedPendingRes] = factory
        ? await Promise.all([
          api.get(
            `${env.CIRRUS_URL}/mapping?collection_name=eq.signerMap` +
            `&key-%3E%3Ekey=in.(${controlledNominees.join(",")})` +
            `&value=gt.0&limit=200&${dedicatedSelect}`
          ),
          api.get(
            `${env.CIRRUS_URL}/mapping?collection_name=eq.nominations` +
            `&key-%3E%3Ekey=in.(${controlledNominees.join(",")})&limit=200&${dedicatedSelect}`
          ),
        ])
        : [{ data: [] }, { data: [] }];
      const dedicatedRows = [
        ...(Array.isArray(dedicatedRes.data) ? dedicatedRes.data : []),
        ...(Array.isArray(dedicatedPendingRes.data) ? dedicatedPendingRes.data : []),
      ];
      const candidateAddresses = [...new Set(
        dedicatedRows.map((row) => strip0x(String(row?.address ?? ""))).filter(Boolean)
      )];
      const registeredRes = factory && candidateAddresses.length
        ? await api.get(
            `${env.CIRRUS_URL}/mapping?address=eq.${factory}&collection_name=eq.factoryWallets` +
            `&key-%3E%3Ekey=in.(${candidateAddresses.join(",")})&value=eq.true&select=key`
          )
        : { data: [] };
      const registeredWallets = new Set(
        (Array.isArray(registeredRes.data) ? registeredRes.data : [])
          .map((row: any) => strip0x(String(row?.key?.key ?? "")))
      );

      const byAddr = new Map<string, UserWallet>();
      for (const row of ownedRows) {
        const address = row?.address ?? "";
        if (!address) continue;
        byAddr.set(address, {
          address,
          username: extractUsername(row),
          multisig: false,
        });
      }
      for (const row of Array.isArray(dedicatedRes.data) ? dedicatedRes.data : []) {
        const address = strip0x(String(row?.address ?? ""));
        const signerAddress = strip0x(String(row?.key?.key ?? ""));
        const data = extractStorageData(row);
        if (!address || !registeredWallets.has(address) ||
            strip0x(String(data?.multisigFactory ?? "")) !== factory) continue;
        const current = byAddr.get(address);
        if (current?.factoryMultisig && current.signerAddress === key) continue;
        byAddr.set(address, {
          address,
          username: "",
          multisig: true,
          signerAddress,
          signerUsername: ownedByAddress.get(signerAddress) ?? "",
          factoryMultisig: true,
          active: data?.multisigActive === true || data?.multisigActive === "true",
        });
      }
      for (const row of Array.isArray(dedicatedPendingRes.data) ? dedicatedPendingRes.data : []) {
        const address = strip0x(String(row?.address ?? ""));
        const data = extractStorageData(row);
        const value = row?.value;
        const exists = value?.exists === true || value?.exists === "true";
        const nominationEpoch = Number(value?.epoch ?? 0);
        const walletEpoch = Number(data?.multisigEpoch ?? 0);
        const expiresAt = Number(value?.expiresAt ?? 0);
        const nomineeAddress = strip0x(String(row?.key?.key ?? ""));
        if (!address || !exists || nominationEpoch !== walletEpoch || expiresAt < Date.now() / 1000 ||
            !registeredWallets.has(address) ||
            strip0x(String(data?.multisigFactory ?? "")) !== factory) continue;
        const current = byAddr.get(address);
        if (current) {
          current.pendingSigner = true;
          current.nomineeAddress = nomineeAddress;
          current.nomineeUsername = ownedByAddress.get(nomineeAddress) ?? "";
        }
        else byAddr.set(address, {
          address,
          username: "",
          multisig: true,
          factoryMultisig: true,
          pendingSigner: true,
          nomineeAddress,
          nomineeUsername: ownedByAddress.get(nomineeAddress) ?? "",
          active: data?.multisigActive === true || data?.multisigActive === "true",
        });
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
