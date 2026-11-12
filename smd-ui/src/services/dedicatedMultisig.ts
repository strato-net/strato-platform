import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { api } from "@/lib/api";
import { formatVariadicArg, parseJsonExact, typedVariadicArg, variadicArgValue } from "@/lib/args";
import { env, runtime } from "@/lib/env";
import { ADMIN_REGISTRY_ADDRESS, ZERO_ADDRESS, strip0x } from "@/services/userWallets";

export const buildDedicatedCallPayload = (
  contractName: string,
  contractAddress: string,
  method: string,
  args: Record<string, unknown>
) => ({
  contractName,
  contractAddress: strip0x(contractAddress),
  value: 0,
  method,
  args,
  metadata: {},
});

export const dedicatedWalletContractName = (method: string): "MultisigWallet" | "MultisigLogic" =>
  method === "executeUpgrade" ? "MultisigWallet" : "MultisigLogic";

const rows = async (table: string, query: string): Promise<any[]> => {
  const { data } = await api.get(`${env.CIRRUS_URL}/${table}?${query}`);
  return Array.isArray(data) ? data : [];
};

const pagedRows = async (table: string, query: string, pageSize = 200): Promise<any[]> => {
  const result: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await rows(table, `${query}&limit=${pageSize}&offset=${offset}`);
    result.push(...page);
    if (page.length < pageSize) return result;
  }
};

const inBatches = async (
  values: string[],
  load: (values: string[]) => Promise<any[]>,
  batchSize = 50
): Promise<any[]> => {
  const batches: Promise<any[]>[] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    batches.push(load(values.slice(offset, offset + batchSize)));
  }
  return (await Promise.all(batches)).flat();
};

const normalizeArgumentTypes = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string" || !raw.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

export const normalizeDedicatedArguments = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((value) => formatVariadicArg(variadicArgValue(value)));
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = parseJsonExact(raw);
    return Array.isArray(parsed)
      ? parsed.map((value) => formatVariadicArg(variadicArgValue(value)))
      : [formatVariadicArg(variadicArgValue(parsed))];
  } catch {
    return [raw];
  }
};

export const parseDedicatedTypedArguments = (text: string): { types: string[]; args: unknown[] } => {
  const parsed = parseJsonExact(text || "[]");
  if (!Array.isArray(parsed)) throw new Error("Arguments must be a JSON array");
  const types: string[] = [];
  const args = parsed.map((argument) => {
    if (!argument || typeof argument !== "object" || !("type" in argument) || !("value" in argument)) {
      throw new Error('Each argument must contain "type" and "value"');
    }
    const type = String(argument.type).trim();
    if (!type) throw new Error("Load or enter the original Solidity type for every argument");
    types.push(type);
    const value = typeof argument.value === "string" ? argument.value : JSON.stringify(argument.value);
    return typedVariadicArg(type, value);
  });
  return { types, args };
};

export interface DedicatedWalletState {
  address: string;
  factory: string;
  logic: string;
  version: string;
  epoch: number;
  active: boolean;
  upgradesFrozen: boolean;
  requiredApprovals: number;
  transactionTimelock: number;
  signers: string[];
  pendingUpgrade?: {
    targetLogic: string;
    fromVersion: string;
    targetVersion: string;
    migrationFunction: string;
    executableAt: number;
    expiresAt: number;
  };
  verified: boolean;
  verificationErrors: string[];
}

export interface DedicatedIssue {
  issueId: string;
  creator: string;
  target: string;
  functionName: string;
  argumentTypes: string[];
  arguments: string[];
  nonce: number;
  epoch: number;
  approvals: number;
  approvedSigners: string[];
  executableAt: number;
  expiresAt: number;
}

export interface DedicatedSetupState {
  setupHash: string;
  creator: string;
  expectedWallet: string;
  signers: string[];
  confirmedSigners: string[];
  requiredApprovals: number;
  transactionTimelock: number;
  initialVersion: string;
  expiresAt: number;
}

export interface DedicatedFactoryState {
  address: string;
  logic: string;
  owner: string;
  registryGovernance: string;
  approvedVersions: { version: string; logic: string }[];
  verified: boolean;
  verificationErrors: string[];
}

const fetchDedicatedFactoryState = async (): Promise<DedicatedFactoryState> => {
  const address = runtime.multisigFactoryAddress();
  if (!address) {
    return {
      address: "",
      logic: "",
      owner: "",
      registryGovernance: "",
      approvedVersions: [],
      verified: false,
      verificationErrors: ["No factory is pinned for this network"],
    };
  }
  const [storageRows, versionRows] = await Promise.all([
    rows("storage", `address=eq.${address}&select=data`),
    rows("mapping", `address=eq.${address}&collection_name=eq.logicVersions&select=key,value`),
  ]);
  const data = storageRows[0]?.data ?? {};
  const logic = strip0x(String(data.logicContract ?? ""));
  const owner = strip0x(String(data._owner ?? data.owner ?? ""));
  const registryGovernance = strip0x(String(data.registryGovernance ?? ""));
  const approvedVersions = versionRows
    .map((row) => ({
      version: String(row?.key?.key ?? row?.key ?? ""),
      logic: strip0x(String(row?.value?.logic ?? "")),
      approved: row?.value?.approved === true || row?.value?.approved === "true",
      revoked: row?.value?.revoked === true || row?.value?.revoked === "true",
    }))
    .filter((version) => version.version && version.logic && version.approved && !version.revoked)
    .map(({ version, logic: versionLogic }) => ({ version, logic: versionLogic }))
    .sort((left, right) => left.version.localeCompare(right.version));
  const verificationErrors = [
    ...(!logic ? ["Factory proxy has no implementation"] : []),
    ...(![ADMIN_REGISTRY_ADDRESS, ZERO_ADDRESS].includes(owner)
      ? ["Factory proxy is not owned by AdminRegistry or frozen"]
      : []),
    ...(registryGovernance !== ADMIN_REGISTRY_ADDRESS
      ? ["Factory registry is not governed by AdminRegistry"]
      : []),
  ];
  return {
    address,
    logic,
    owner,
    registryGovernance,
    approvedVersions,
    verified: verificationErrors.length === 0,
    verificationErrors,
  };
};

export function useDedicatedFactoryState() {
  return useQuery({
    queryKey: ["dedicated-multisig-factory", runtime.multisigFactoryAddress()],
    refetchInterval: 15_000,
    queryFn: fetchDedicatedFactoryState,
  });
}

export function useDedicatedSetup(setupHash?: string | null) {
  return useQuery({
    queryKey: ["dedicated-multisig-setup", setupHash],
    enabled: !!setupHash && !!runtime.multisigFactoryAddress(),
    refetchInterval: 3_000,
    queryFn: async (): Promise<DedicatedSetupState | null> => {
      const factory = runtime.multisigFactoryAddress();
      const hash = String(setupHash);
      const [setupRows, signerRows, confirmationRows] = await Promise.all([
        rows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.pendingSetups&key-%3E%3Ekey=eq.${hash}&select=value`
        ),
        rows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.setupSigners&key-%3E%3Ekey=eq.${hash}&select=key,value`
        ),
        rows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.setupConfirmations&key-%3E%3Ekey=eq.${hash}&select=key,value`
        ),
      ]);
      const value = setupRows[0]?.value;
      if (value?.exists !== true && value?.exists !== "true") return null;
      const signers = signerRows
        .map((row) => strip0x(String(row?.value ?? "")))
        .filter((signer) => signer.length === 40);
      const confirmedSigners = confirmationRows
        .filter((row) => row?.value === true || row?.value === "true")
        .map((row) => strip0x(String(row?.key?.key2 ?? "")))
        .filter((signer) => signer.length === 40);
      return {
        setupHash: hash,
        creator: strip0x(String(value.creator ?? "")),
        expectedWallet: strip0x(String(value.expectedWallet ?? "")),
        signers,
        confirmedSigners,
        requiredApprovals: Number(value.requiredApprovals ?? 0),
        transactionTimelock: Number(value.transactionTimelock ?? 0),
        initialVersion: String(value.initialVersion ?? ""),
        expiresAt: Number(value.expiresAt ?? 0),
      };
    },
  });
}

export function useDedicatedSetupLifecycle(setupHash?: string | null) {
  return useQuery({
    queryKey: ["dedicated-multisig-setup-lifecycle", setupHash],
    enabled: !!setupHash && !!runtime.multisigFactoryAddress(),
    refetchInterval: 3_000,
    queryFn: async (): Promise<"pending" | "cancelled" | "deployed" | "unknown"> => {
      const events = await rows(
        "event",
        `address=eq.${runtime.multisigFactoryAddress()}` +
          `&event_name=in.(MultisigSetupRegistered,MultisigSetupCancelled,MultisigCreated)` +
          `&attributes-%3E%3EsetupHash=eq.${String(setupHash)}` +
          `&order=block_number.desc,event_index.desc&limit=1&select=event_name`
      );
      if (events[0]?.event_name === "MultisigCreated") return "deployed";
      if (events[0]?.event_name === "MultisigSetupCancelled") return "cancelled";
      if (events[0]?.event_name === "MultisigSetupRegistered") return "pending";
      return "unknown";
    },
  });
}

export function extractDedicatedSetupResult(result: any): { setupHash: string; expectedWallet: string } | null {
  const response = result?.txResult?.response ?? result?.response;
  const typed = response?.t === "tup" ? response.v?.map((value: any) => value?.v) : null;
  const contents = result?.data?.tag === "Call" ? result.data.contents : result?.data?.contents;
  const values = Array.isArray(contents) ? contents : typed;
  if (!Array.isArray(values) || typeof values[0] !== "string" || typeof values[1] !== "string") return null;
  return { setupHash: values[0], expectedWallet: strip0x(values[1]) };
}

export function useDedicatedWalletState(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["dedicated-multisig-state", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 5_000,
    queryFn: async (): Promise<DedicatedWalletState> => {
      const address = strip0x(walletAddress!);
      const pinnedFactory = runtime.multisigFactoryAddress();
      const [storageRows, signerRows, factoryRows, versionRows, factoryState] = await Promise.all([
        rows("storage", `address=eq.${address}&select=data`),
        rows(
          "mapping",
          `address=eq.${address}&collection_name=eq.signerMap&value=gt.0&select=key,value`
        ),
        pinnedFactory
          ? rows(
              "mapping",
              `address=eq.${pinnedFactory}&collection_name=eq.factoryWallets` +
                `&key-%3E%3Ekey=eq.${address}&select=value`
            )
          : Promise.resolve([]),
        pinnedFactory
          ? rows(
              "mapping",
              `address=eq.${pinnedFactory}&collection_name=eq.logicVersions&select=key,value`
            )
          : Promise.resolve([]),
        fetchDedicatedFactoryState(),
      ]);
      const data = storageRows[0]?.data ?? {};
      const factory = strip0x(String(data.multisigFactory ?? ""));
      const logic = strip0x(String(data.multisigCurrentLogic ?? ""));
      const version = String(data.multisigCurrentVersion ?? "");
      const registered = factoryRows.some((row) => row?.value === true || row?.value === "true");
      const registeredVersion = versionRows.find((row) => {
        const key = String(row?.key?.key ?? row?.key ?? "");
        const value = row?.value ?? {};
        return key === version && strip0x(String(value.logic ?? "")) === logic &&
          (value.approved === true || value.approved === "true") &&
          value.revoked !== true && value.revoked !== "true";
      });
      const approvedVersion = !!registeredVersion;
      const verificationErrors = [
        ...factoryState.verificationErrors,
        ...(factory !== pinnedFactory ? ["Stored factory does not match the pinned factory"] : []),
        ...(!registered ? ["Wallet is not registered by the pinned factory"] : []),
        ...(!approvedVersion ? ["Current logic/version is not registry-approved"] : []),
        ...(!(data.multisigActive === true || data.multisigActive === "true") ? ["Wallet is not active"] : []),
      ];
      return {
        address,
        factory,
        logic,
        version,
        epoch: Number(data.multisigEpoch ?? 0),
        active: data.multisigActive === true || data.multisigActive === "true",
        upgradesFrozen: data.multisigUpgradesFrozen === true || data.multisigUpgradesFrozen === "true",
        requiredApprovals: Number(data.requiredApprovals ?? 0),
        transactionTimelock: Number(data.transactionTimelock ?? 0),
        signers: signerRows
          .map((row) => strip0x(String(row?.key?.key ?? "")))
          .filter((signer) => signer.length === 40),
        ...(data.multisigPendingUpgrade?.exists === true || data.multisigPendingUpgrade?.exists === "true"
          ? {
              pendingUpgrade: {
                targetLogic: strip0x(String(data.multisigPendingUpgrade.targetLogic ?? "")),
                fromVersion: String(data.multisigPendingUpgrade.fromVersion ?? ""),
                targetVersion: String(data.multisigPendingUpgrade.targetVersion ?? ""),
                migrationFunction: String(data.multisigPendingUpgrade.migrationFunction ?? ""),
                executableAt: Number(data.multisigPendingUpgrade.executableAt ?? 0),
                expiresAt: Number(data.multisigPendingUpgrade.expiresAt ?? 0),
              },
            }
          : {}),
        verified: verificationErrors.length === 0,
        verificationErrors,
      };
    },
  });
}

export function useDedicatedIssues(walletAddress?: string | null, epoch?: number) {
  return useQuery({
    queryKey: ["dedicated-multisig-issues", walletAddress, epoch],
    enabled: !!walletAddress && epoch != null,
    refetchInterval: 3_000,
    queryFn: async (): Promise<DedicatedIssue[]> => {
      const address = strip0x(walletAddress!);
      const now = Math.floor(Date.now() / 1000);
      const issueRows = await pagedRows(
        "mapping",
        `address=eq.${address}&collection_name=eq.issues&value-%3E%3Eactive=eq.true` +
          `&value-%3E%3Eepoch=eq.${epoch}&value-%3E%3EexpiresAt=gte.${now}` +
          `&select=key,value&order=key-%3E%3Ekey.asc`
      );
      const issueIds = issueRows.map((row) => String(row?.key?.key ?? "")).filter(Boolean);
      const [approvalRows, events] = await Promise.all([
        inBatches(issueIds, (ids) => pagedRows(
          "mapping",
          `address=eq.${address}&collection_name=eq.issueApprovals&key-%3E%3Ekey=in.(${ids.join(",")})` +
            `&value=eq.true&select=key&order=key-%3E%3Ekey.asc,key-%3E%3Ekey2.asc`
        )),
        inBatches(issueIds, (ids) => pagedRows(
          "event",
          `address=eq.${address}&event_name=in.(IssueCreated,IssueCreatedNoArgs)` +
            `&attributes-%3E%3EissueId=in.(${ids.join(",")})&select=attributes` +
            `&order=block_number.asc,transaction_hash.asc,event_index.asc`
        )),
      ]);
      const eventById = new Map(events.map((event) => [String(event?.attributes?.issueId ?? ""), event.attributes]));
      const approvalsById = new Map<string, string[]>();
      for (const row of approvalRows) {
        const issueId = String(row?.key?.key ?? "");
        const signer = strip0x(String(row?.key?.key2 ?? ""));
        if (!issueId || !signer) continue;
        approvalsById.set(issueId, [...(approvalsById.get(issueId) ?? []), signer]);
      }
      return issueRows
        .filter((row) => row?.value?.active === true || row?.value?.active === "true")
        .map((row) => {
          const issueId = String(row?.key?.key ?? "");
          const value = row?.value ?? {};
          const event = eventById.get(issueId) ?? {};
          const argumentTypes = normalizeArgumentTypes(event.argumentTypes);
          return {
            issueId,
            creator: strip0x(String(value.creator ?? event.creator ?? "")),
            target: strip0x(String(value.target ?? event.target ?? "")),
            functionName: String(value.functionName ?? event.functionName ?? ""),
            argumentTypes,
            arguments: normalizeDedicatedArguments(event.arguments),
            nonce: Number(value.nonce ?? event.nonce ?? 0),
            epoch: Number(value.epoch ?? event.epoch ?? 0),
            approvals: Number(value.approvals ?? 0),
            approvedSigners: approvalsById.get(issueId) ?? [],
            executableAt: Number(value.executableAt ?? 0),
            expiresAt: Number(value.expiresAt ?? 0),
          };
        });
    },
  });
}

export interface DedicatedExecutedIssue {
  issueId: string;
  target: string;
  functionName: string;
  arguments: string[];
  executor: string;
  timestamp?: string;
  transactionHash?: string;
}

export function useDedicatedHistory(walletAddress?: string | null, limit = 10) {
  return useQuery({
    queryKey: ["dedicated-multisig-history", walletAddress, limit],
    enabled: !!walletAddress,
    refetchInterval: 15_000,
    queryFn: async (): Promise<DedicatedExecutedIssue[]> => {
      const address = strip0x(walletAddress!);
      const events = await rows(
        "event",
        `address=eq.${address}&event_name=in.(IssueExecuted,IssueExecutedNoArgs)` +
          `&order=block_timestamp.desc&limit=${limit}` +
          `&select=attributes,block_timestamp,transaction_hash`
      );
      return events.map((event) => {
        const attributes = event?.attributes ?? {};
        return {
          issueId: String(attributes.issueId ?? ""),
          target: strip0x(String(attributes.target ?? "")),
          functionName: String(attributes.functionName ?? ""),
          arguments: normalizeDedicatedArguments(attributes.arguments),
          executor: strip0x(String(attributes.executor ?? "")),
          timestamp: event?.block_timestamp,
          transactionHash: event?.transaction_hash,
        };
      });
    },
  });
}

export interface RegisterDedicatedSetup {
  signers: string[];
  requiredApprovals: number;
  transactionTimelock: number;
  initialVersion: string;
  salt: string;
}

export const canonicalizeSetupSigners = (signers: string[]): string[] =>
  [...new Set(signers.map(strip0x).filter((signer) => signer.length === 40))].sort();

export const isUnlimitedTokenApproval = (functionName: string, args: string[]): boolean => {
  if (functionName !== "approve" || args.length < 2) return false;
  try {
    return BigInt(args[1] || "0") > (1n << 255n);
  } catch {
    return false;
  }
};

export type DedicatedProtocolAction =
  | "stake" | "unstake" | "cdpDeposit" | "cdpBorrow"
  | "addLiquidity" | "addLiquidityStable"
  | "removeLiquidity" | "removeLiquidityStable" | "removeLiquidityOneCoin"
  | "v3Mint" | "v3Increase" | "v3Decrease" | "v3Collect";

export interface DedicatedProtocolInput {
  target: string;
  validator?: string;
  asset?: string;
  amount: string;
  amount2?: string;
  amount3?: string;
  amounts?: string[];
  receiver?: string;
  coinIndex?: string;
  pool?: string;
  tokenId?: string;
  tickLower?: string;
  tickUpper?: string;
  liquidity?: string;
}

export interface DedicatedCall {
  target: string;
  functionName: string;
  argumentTypes: string[];
  arguments: unknown[];
}

const dedicatedCall = (
  target: string,
  functionName: string,
  entries: [string, string][]
): DedicatedCall => ({
  target: strip0x(target),
  functionName,
  argumentTypes: entries.map(([type]) => type),
  arguments: entries.map(([type, value]) => typedVariadicArg(type, value)),
});

/** Exact typed call represented by a guided treasury protocol action. */
export function buildDedicatedProtocolCall(
  action: DedicatedProtocolAction,
  input: DedicatedProtocolInput,
  nowSeconds = Math.floor(Date.now() / 1000)
): DedicatedCall {
  // Covers the maximum 30-day approval period, 30-day wallet timelock, and
  // 7-day execution window without expiring the protocol call first.
  const deadline = String(nowSeconds + 70 * 24 * 60 * 60);
  switch (action) {
    case "stake":
    case "unstake":
      return dedicatedCall(input.target, action, [
        ["address", input.validator || ""],
        ["uint256", input.amount],
      ]);
    case "cdpDeposit":
      return dedicatedCall(input.target, "deposit", [
        ["address", input.asset || ""],
        ["uint256", input.amount],
      ]);
    case "cdpBorrow":
      return dedicatedCall(input.target, "mint", [
        ["address", input.asset || ""],
        ["uint256", input.amount],
      ]);
    case "addLiquidity":
      return dedicatedCall(input.target, "addLiquidity", [
        ["uint256", input.amount],
        ["uint256", input.amount2 || ""],
        ["uint256", deadline],
      ]);
    case "addLiquidityStable":
      return dedicatedCall(input.target, "addLiquidityGeneral", [
        ["uint256[]", JSON.stringify(input.amounts || [])],
        ["uint256", input.amount2 || ""],
        ["address", input.receiver || ""],
      ]);
    case "removeLiquidity":
      return dedicatedCall(input.target, "removeLiquidity", [
        ["uint256", input.amount],
        ["uint256", input.amount2 || ""],
        ["uint256", input.amount3 || ""],
        ["uint256", deadline],
      ]);
    case "removeLiquidityStable":
      return dedicatedCall(input.target, "removeLiquidityGeneral", [
        ["uint256", input.amount],
        ["uint256[]", JSON.stringify(input.amounts || [])],
        ["address", input.receiver || ""],
        ["bool", "true"],
      ]);
    case "removeLiquidityOneCoin":
      return dedicatedCall(input.target, "removeliquidityOneCoin", [
        ["uint256", input.amount],
        ["uint256", input.coinIndex || ""],
        ["uint256", input.amount2 || ""],
        ["address", input.receiver || ""],
      ]);
    case "v3Mint":
      return dedicatedCall(input.target, "mint", [
        ["address", input.pool || ""],
        ["int256", input.tickLower || ""],
        ["int256", input.tickUpper || ""],
        ["uint256", input.amount],
        ["uint256", input.amount2 || ""],
        ["uint256", input.amount3 || ""],
        ["uint256", input.amounts?.[0] || ""],
        ["address", input.receiver || ""],
        ["uint256", deadline],
      ]);
    case "v3Increase":
      return dedicatedCall(input.target, "increaseLiquidity", [
        ["uint256", input.tokenId || ""],
        ["uint256", input.amount],
        ["uint256", input.amount2 || ""],
        ["uint256", input.amount3 || ""],
        ["uint256", input.amounts?.[0] || ""],
        ["uint256", deadline],
      ]);
    case "v3Decrease":
      return dedicatedCall(input.target, "decreaseLiquidity", [
        ["uint256", input.tokenId || ""],
        ["uint256", input.liquidity || ""],
        ["uint256", input.amount || ""],
        ["uint256", input.amount2 || ""],
        ["uint256", deadline],
      ]);
    case "v3Collect":
      return dedicatedCall(input.target, "collect", [
        ["uint256", input.tokenId || ""],
        ["address", input.receiver || ""],
        ["uint256", input.amount || ""],
        ["uint256", input.amount2 || ""],
      ]);
  }
}

export function buildDedicatedProtocolWorkflow(
  action: DedicatedProtocolAction,
  input: DedicatedProtocolInput,
  approvals: { token: string; spender: string; amount: string }[],
  nowSeconds = Math.floor(Date.now() / 1000)
): DedicatedCall[] {
  return [
    ...approvals.map(({ token, spender, amount }) =>
      dedicatedCall(token, "approve", [["address", spender], ["uint256", amount]])
    ),
    buildDedicatedProtocolCall(action, input, nowSeconds),
  ];
}

export function useDedicatedMultisigActions(walletAddress?: string) {
  const { submit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const factory = runtime.multisigFactoryAddress();

  const factoryCall = useCallback(
    (method: string, args: Record<string, unknown>, username?: string) => {
      if (!factory) throw new Error("No canonical multisig factory is configured for this network");
      return submit(
        "FUNCTION",
        buildDedicatedCallPayload("MultisigFactory", factory, method, args),
        username ? { username } : undefined
      );
    },
    [factory, submit]
  );

  const walletCall = useCallback(
    (method: string, args: Record<string, unknown>, username?: string) => {
      if (!walletAddress) throw new Error("Wallet address is required");
      return submit(
        "FUNCTION",
        buildDedicatedCallPayload(
          dedicatedWalletContractName(method),
          walletAddress,
          method,
          args
        ),
        username ? { username } : undefined
      );
    },
    [submit, walletAddress]
  );

  return {
    registerSetup: (input: RegisterDedicatedSetup, username?: string) =>
      factoryCall("registerSetup", {
        _signers: canonicalizeSetupSigners(input.signers),
        _requiredApprovals: input.requiredApprovals,
        _transactionTimelock: input.transactionTimelock,
        _initialVersion: input.initialVersion,
        _salt: input.salt,
      }, username),
    confirmSetup: (setupHash: string, username?: string) =>
      factoryCall("confirmSetup", { _setupHash: setupHash }, username),
    cancelSetup: (setupHash: string, username?: string) =>
      factoryCall("cancelSetup", { _setupHash: setupHash }, username),
    proposeIssue: (target: string, functionName: string, argumentTypes: string[], args: unknown[], username?: string) =>
      walletCall(argumentTypes.length ? "proposeIssue" : "proposeIssueNoArgs", argumentTypes.length ? {
        _target: strip0x(target),
        _functionName: functionName,
        _argumentTypes: argumentTypes,
        _arguments: args,
      } : {
        _target: strip0x(target),
        _functionName: functionName,
      }, username).finally(() => queryClient.invalidateQueries({ queryKey: ["dedicated-multisig-issues", walletAddress] })),
    proposeCall: (call: DedicatedCall, username?: string) =>
      walletCall(call.argumentTypes.length ? "proposeIssue" : "proposeIssueNoArgs", call.argumentTypes.length ? {
        _target: call.target,
        _functionName: call.functionName,
        _argumentTypes: call.argumentTypes,
        _arguments: call.arguments,
      } : {
        _target: call.target,
        _functionName: call.functionName,
      }, username).finally(() => queryClient.invalidateQueries({ queryKey: ["dedicated-multisig-issues", walletAddress] })),
    approveIssue: (issue: DedicatedIssue, args: unknown[], username?: string) =>
      walletCall(issue.argumentTypes.length ? "approveIssue" : "approveIssueNoArgs", issue.argumentTypes.length ? {
        _issueId: issue.issueId,
        _target: issue.target,
        _functionName: issue.functionName,
        _argumentTypes: issue.argumentTypes,
        _arguments: args,
      } : {
        _issueId: issue.issueId,
        _target: issue.target,
        _functionName: issue.functionName,
      }, username),
    executeIssue: (issue: DedicatedIssue, args: unknown[], username?: string) =>
      walletCall(issue.argumentTypes.length ? "executeIssue" : "executeIssueNoArgs", issue.argumentTypes.length ? {
        _issueId: issue.issueId,
        _target: issue.target,
        _functionName: issue.functionName,
        _argumentTypes: issue.argumentTypes,
        _arguments: args,
      } : {
        _issueId: issue.issueId,
        _target: issue.target,
        _functionName: issue.functionName,
      }, username),
    revokeIssueApproval: (issueId: string, username?: string) =>
      walletCall("revokeIssueApproval", { _issueId: issueId }, username),
    dismissIssue: (issueId: string, username?: string) =>
      walletCall("dismissIssue", { _issueId: issueId }, username),
    acceptNomination: (username?: string) => walletCall("acceptNomination", {}, username),
    executeUpgrade: () => walletCall("executeUpgrade", {}),
  };
}
