import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { env } from "@/lib/env";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { strip0x, ZERO_ADDRESS } from "@/services/userWallets";

/**
 * The AdminRegistry proxy is deployed at 0x100c in genesis. It owns itself and
 * delegatecalls to its logic contract (0x110c in genesis, read dynamically here in
 * case it has been upgraded). Setting a User wallet's logic contract to this same
 * logic address turns the wallet into a self-governed multisig — the AdminRegistry
 * voting logic runs against the wallet's own storage.
 */
export const ADMIN_REGISTRY_ADDRESS = "000000000000000000000000000000000000100c";
/** Genesis address of the AdminRegistry logic code; last-resort fallback only. */
export const ADMIN_REGISTRY_IMPL_FALLBACK = "000000000000000000000000000000000000110c";

/** thresholds are stored in basis points: 6000 = 60%. */
export const bpsToPct = (bps: number) => Math.round((bps / 100) * 10) / 10;
export const pctToBps = (pct: number) => Math.round(pct * 100);

export function isZeroAddr(a?: string | null): boolean {
  return !a || /^0*$/.test(strip0x(a));
}

const cirrusGet = async (table: string, query: string): Promise<any[]> => {
  const { data } = await api.get(`${env.CIRRUS_URL}/${table}?${query}`);
  return Array.isArray(data) ? data : [];
};

/** Read the flat state (`data`) blob a contract's storage row holds in cirrus. */
async function fetchStorageData(address: string): Promise<Record<string, any>> {
  const rows = await cirrusGet("storage", `address=eq.${strip0x(address)}&select=data`);
  const data = rows[0]?.data;
  return data && typeof data === "object" ? data : {};
}

// ---- Reads --------------------------------------------------------------------------

/**
 * The AdminRegistry's current logic-contract address — what a wallet delegates to so
 * it behaves as a multisig. Reads 0x100c's `logicContract`; falls back to the known
 * genesis impl if cirrus hasn't indexed it.
 */
export function useAdminRegistryLogic() {
  const q = useQuery({
    queryKey: ["admin-registry-logic"],
    queryFn: async (): Promise<string> => {
      const data = await fetchStorageData(ADMIN_REGISTRY_ADDRESS);
      const raw = strip0x(String(data["logicContract"] ?? ""));
      return isZeroAddr(raw) ? ADMIN_REGISTRY_IMPL_FALLBACK : raw;
    },
    staleTime: 5 * 60_000,
  });
  return { logic: q.data ?? "", ...q };
}

export interface MultisigConfig {
  /** logic contract the wallet currently delegates to (empty/zero if none). */
  logicContract: string;
  /** true once the AdminRegistry logic has been initialized on this wallet. */
  initialized: boolean;
  /** current owner of the wallet (self-owned when multisig is fully enabled). */
  owner: string;
  /** default voting threshold in basis points (e.g. 6000 = 60%). */
  defaultThresholdBps: number;
}

/** A User wallet's multisig-relevant state, read from its cirrus storage blob. */
export function useMultisigConfig(walletAddress?: string | null) {
  const q = useQuery({
    queryKey: ["multisig-config", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 12_000,
    queryFn: async (): Promise<MultisigConfig> => {
      const data = await fetchStorageData(walletAddress!);
      return {
        logicContract: strip0x(String(data["logicContract"] ?? "")),
        initialized: data["initialized"] === true || data["initialized"] === "true",
        owner: strip0x(String(data["_owner"] ?? data["owner"] ?? "")),
        defaultThresholdBps: Number(data["defaultVotingThresholdBps"] ?? 0) || 0,
      };
    },
  });
  const config: MultisigConfig = q.data ?? {
    logicContract: "",
    initialized: false,
    owner: "",
    defaultThresholdBps: 0,
  };
  return { config, ...q };
}

/**
 * Whether a User wallet is running as a multisig (it delegates to the AdminRegistry
 * logic). `fullyEnabled` additionally requires the wallet to own itself and be
 * initialized — the state in which signer votes can actually execute.
 */
export function useIsMultisig(walletAddress?: string | null) {
  const { logic: adminLogic } = useAdminRegistryLogic();
  const { config, isLoading, refetch } = useMultisigConfig(walletAddress);
  const delegatesToAdmin =
    !isZeroAddr(config.logicContract) &&
    !!adminLogic &&
    strip0x(config.logicContract) === strip0x(adminLogic);
  const selfOwned = !!walletAddress && strip0x(config.owner) === strip0x(walletAddress);
  return {
    isMultisig: delegatesToAdmin,
    fullyEnabled: delegatesToAdmin && selfOwned && config.initialized,
    selfOwned,
    initialized: config.initialized,
    config,
    isLoading,
    refetch,
  };
}

/** Current signer (admin) addresses for a multisig wallet, from the `admins` array. */
export function useSigners(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-signers", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 12_000,
    queryFn: async (): Promise<string[]> => {
      const rows = await cirrusGet(
        "mapping",
        `collection_name=eq.admins&address=eq.${strip0x(walletAddress!)}&select=key,value`
      );
      // Removed admins are zeroed out and the array shrinks; keep only live entries.
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of rows) {
        const addr = strip0x(String(r?.value ?? ""));
        if (!addr || isZeroAddr(addr) || seen.has(addr)) continue;
        seen.add(addr);
        out.push(addr);
      }
      return out;
    },
  });
}

/** Per-(target,func) voting thresholds (bps), keyed `"<target>|<func>"`. */
export function useVotingThresholds(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-thresholds", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const rows = await cirrusGet(
        "mapping",
        `collection_name=eq.votingThresholds&address=eq.${strip0x(walletAddress!)}&select=key,value`
      );
      const out: Record<string, number> = {};
      for (const r of rows) {
        const target = strip0x(String(r?.key?.key ?? ""));
        const func = String(r?.key?.key2 ?? "");
        const bps = Number(r?.value ?? 0) || 0;
        if (target && func && bps > 0) out[`${target}|${func}`] = bps;
      }
      return out;
    },
  });
}

export interface OpenIssue {
  issueId: string;
  target: string;
  func: string;
  /** Decoded call arguments (best-effort; used to re-cast a vote on the issue). */
  args: string[];
  /** Addresses that have voted so far. */
  voters: string[];
  createdBlock?: number;
}

function normalizeArgs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x));
  if (raw == null || raw === "") return [];
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.map((x) => String(x));
      } catch {
        /* fall through */
      }
    }
    return [s];
  }
  return [String(raw)];
}

/**
 * Open (unexecuted) issues for a multisig wallet. Derived from the `votes` collection
 * — an issue is open while it still has non-zero voters (execution/dismissal clears
 * them) — joined to its `IssueCreated` event for target/func/args.
 */
export function useOpenIssues(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["multisig-open-issues", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 10_000,
    queryFn: async (): Promise<OpenIssue[]> => {
      const addr = strip0x(walletAddress!);
      const [voteRows, created] = await Promise.all([
        cirrusGet("mapping", `collection_name=eq.votes&address=eq.${addr}&select=key,value`),
        cirrusGet(
          "event",
          `address=eq.${addr}&event_name=eq.IssueCreated&order=block_timestamp.desc&select=attributes,block_number`
        ),
      ]);

      // Group live votes by issueId (drop zeroed-out / cleared entries).
      const votersByIssue = new Map<string, string[]>();
      for (const r of voteRows) {
        const issueId = String(r?.key?.key ?? "");
        const voter = strip0x(String(r?.value ?? ""));
        if (!issueId || isZeroAddr(voter)) continue;
        const list = votersByIssue.get(issueId) ?? [];
        if (!list.includes(voter)) list.push(voter);
        votersByIssue.set(issueId, list);
      }

      // Latest IssueCreated per issueId for the call details.
      const detailsByIssue = new Map<string, { target: string; func: string; args: string[]; block?: number }>();
      for (const ev of created) {
        const a = ev?.attributes ?? {};
        const issueId = String(a.issueId ?? "");
        if (!issueId || detailsByIssue.has(issueId)) continue;
        detailsByIssue.set(issueId, {
          target: strip0x(String(a.target ?? "")),
          func: String(a.func ?? ""),
          args: normalizeArgs(a.args),
          block: ev?.block_number ? Number(ev.block_number) : undefined,
        });
      }

      const issues: OpenIssue[] = [];
      for (const [issueId, voters] of votersByIssue) {
        const d = detailsByIssue.get(issueId);
        issues.push({
          issueId,
          target: d?.target ?? "",
          func: d?.func ?? "",
          args: d?.args ?? [],
          voters,
          createdBlock: d?.block,
        });
      }
      issues.sort((a, b) => (b.createdBlock ?? 0) - (a.createdBlock ?? 0));
      return issues;
    },
  });
}

export interface ExecutedIssue {
  issueId: string;
  target: string;
  func: string;
  args: string[];
  executor: string;
  block?: number;
  timestamp?: string;
  txHash?: string;
}

/** Executed-issue history for a multisig wallet, newest first (paginated). */
export function useExecutedIssues(walletAddress?: string | null, limit = 10, offset = 0) {
  return useQuery({
    queryKey: ["multisig-executed-issues", walletAddress, limit, offset],
    enabled: !!walletAddress,
    queryFn: async (): Promise<ExecutedIssue[]> => {
      const rows = await cirrusGet(
        "event",
        `address=eq.${strip0x(walletAddress!)}&event_name=eq.IssueExecuted` +
          `&order=block_timestamp.desc&limit=${limit}&offset=${offset}` +
          `&select=attributes,block_number,block_timestamp,transaction_hash`
      );
      return rows.map((ev) => {
        const a = ev?.attributes ?? {};
        return {
          issueId: String(a.issueId ?? ""),
          target: strip0x(String(a.target ?? "")),
          func: String(a.func ?? ""),
          args: normalizeArgs(a.args),
          executor: strip0x(String(a.executor ?? "")),
          block: ev?.block_number ? Number(ev.block_number) : undefined,
          timestamp: ev?.block_timestamp,
          txHash: ev?.transaction_hash,
        };
      });
    },
  });
}

/** Votes needed to execute, given the signer count and threshold (bps). */
export function votesNeeded(signerCount: number, thresholdBps: number): number {
  if (!signerCount || !thresholdBps) return signerCount || 1;
  // Matches the contract: 10000 * votes >= thresholdBps * admins.length.
  return Math.ceil((thresholdBps * signerCount) / 10000);
}

// ---- Writes -------------------------------------------------------------------------

export interface MultisigActionCtx {
  /** The multisig User wallet contract address. */
  walletAddress: string;
}

/**
 * Actions that mutate a multisig wallet. Every call targets the User wallet contract
 * directly (no `username` wrapping): governance functions (castVoteOnIssue, addAdmin,
 * …) are public and reach the AdminRegistry logic through the wallet's Proxy fallback;
 * owner-gated setup functions (setLogicContract, initialize, transferOwnership) are
 * signed by the connected owner while they still own the wallet.
 */
export function useMultisigActions({ walletAddress }: MultisigActionCtx) {
  const { submit } = useSubmitTransaction();

  const callWallet = useCallback(
    (method: string, args: Record<string, unknown>) =>
      submit("FUNCTION", {
        contractName: "User",
        contractAddress: walletAddress,
        value: 0,
        method,
        args,
        metadata: {},
      }),
    [submit, walletAddress]
  );

  /** Step 1: delegate the wallet's governance to the AdminRegistry logic. */
  const setLogic = useCallback(
    (adminLogic: string) => callWallet("setLogicContract", { _logicContract: strip0x(adminLogic) }),
    [callWallet]
  );

  /** Step 2: seed the signer (admin) set. Callable once. */
  const initializeSigners = useCallback(
    (signers: string[]) => {
      const clean = Array.from(
        new Set(signers.map(strip0x).filter((a) => a.length === 40 && !isZeroAddr(a)))
      );
      if (clean.length === 0) throw new Error("At least one signer is required");
      return callWallet("initialize", { _initialAdmins: clean });
    },
    [callWallet]
  );

  /**
   * Step 3: transfer ownership to the wallet itself. After this the wallet owns
   * itself — the previous owner keeps power only as a signer, and every owner-gated
   * action becomes a signer vote (reversible later by a vote).
   */
  const lockToSelf = useCallback(
    () => callWallet("transferOwnership", { newOwner: strip0x(walletAddress) }),
    [callWallet, walletAddress]
  );

  /**
   * Turn the wallet into a self-governed multisig, running only the steps still
   * needed given `have` (so a partially-enabled wallet can be resumed safely):
   *  1. setLogicContract(adminLogic)  2. initialize([signers])  3. transferOwnership(self)
   */
  const enableMultisig = useCallback(
    async (
      adminLogic: string,
      signers: string[],
      have?: { logicSet?: boolean; initialized?: boolean; selfOwned?: boolean }
    ) => {
      if (!have?.logicSet) await setLogic(adminLogic);
      if (!have?.initialized) await initializeSigners(signers);
      if (!have?.selfOwned) await lockToSelf();
    },
    [setLogic, initializeSigners, lockToSelf]
  );

  /** Propose/vote to add a signer (executes once the vote threshold is met). */
  const addSigner = useCallback(
    (address: string) => callWallet("addAdmin", { _admin: strip0x(address) }),
    [callWallet]
  );

  /** Propose/vote to remove a signer. */
  const removeSigner = useCallback(
    (address: string) => callWallet("removeAdmin", { _admin: strip0x(address) }),
    [callWallet]
  );

  /** Propose/vote to swap a signer for a new address in a single issue. */
  const swapSigner = useCallback(
    (oldAddress: string, newAddress: string) =>
      callWallet("swapAdmin", {
        _adminToReplace: strip0x(oldAddress),
        _newAdmin: strip0x(newAddress),
      }),
    [callWallet]
  );

  /**
   * Propose/vote to change the default voting threshold (basis points). Unlike
   * add/remove-signer, `setDefaultVotingThresholdBps` has no public vote wrapper and is
   * `onlyOwner`, so we vote on it explicitly via castVoteOnIssue (the wallet executes
   * it on itself once the threshold is met).
   */
  const setDefaultThreshold = useCallback(
    (bps: number) =>
      callWallet("castVoteOnIssue", {
        _target: strip0x(walletAddress),
        _func: "setDefaultVotingThresholdBps",
        _args: [String(bps)],
      }),
    [callWallet, walletAddress]
  );

  /**
   * Cast a vote on (or create) an arbitrary issue. When the threshold is reached the
   * wallet executes `target.func(args)`; `target` defaults to the wallet itself.
   */
  const castVote = useCallback(
    (func: string, args: string[], target?: string) =>
      callWallet("castVoteOnIssue", {
        _target: strip0x(target || walletAddress),
        _func: func,
        _args: args,
      }),
    [callWallet, walletAddress]
  );

  /**
   * Propose/vote to transfer `amountRaw` (smallest units) of the token at
   * `tokenAddress` out of the treasury to `to`. Executes as `token.transfer(to,
   * amount)` from the wallet once the vote threshold is met. Args are normalized so
   * every vote on the same transfer maps to the same issueId.
   */
  const proposeTransfer = useCallback(
    (tokenAddress: string, to: string, amountRaw: string) =>
      castVote("transfer", [strip0x(to), String(amountRaw)], tokenAddress),
    [castVote]
  );

  return {
    enableMultisig,
    setLogic,
    initializeSigners,
    lockToSelf,
    addSigner,
    removeSigner,
    swapSigner,
    setDefaultThreshold,
    castVote,
    proposeTransfer,
  };
}

export { strip0x, ZERO_ADDRESS };
