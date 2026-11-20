import { useCallback } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSubmitTransaction } from "@/hooks/useSubmitTransaction";
import { api } from "@/lib/api";
import { formatVariadicArg, parseJsonExact, typedVariadicArg, variadicArgValue } from "@/lib/args";
import { env, runtime } from "@/lib/env";
import { fetchFunctionByAddress } from "@/services/contracts";
import { simulateStratoTx } from "@/services/simulation";
import {
  ADMIN_REGISTRY_ADDRESS,
  ZERO_ADDRESS,
  strip0x,
  useMyUserWallets,
} from "@/services/userWallets";

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
  pendingNominees: string[];
  pendingUpgrade?: {
    targetLogic: string;
    fromVersion: string;
    targetVersion: string;
    migrationFunction: string;
    executableAt: number;
    expiresAt: number;
  };
  provenanceVerified: boolean;
  verified: boolean;
  verificationErrors: string[];
}

/** Cirrus returns the stored struct as a JSON string and an empty string as a zero address. */
export const parseDedicatedPendingUpgrade = (raw: unknown): DedicatedWalletState["pendingUpgrade"] => {
  let value: any = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (value?.exists !== true && value?.exists !== "true") return undefined;
  const migrationFunction = String(value.migrationFunction ?? "");
  return {
    targetLogic: strip0x(String(value.targetLogic ?? "")),
    fromVersion: String(value.fromVersion ?? ""),
    targetVersion: String(value.targetVersion ?? ""),
    migrationFunction: migrationFunction === ZERO_ADDRESS ? "" : migrationFunction,
    executableAt: Number(value.executableAt ?? 0),
    expiresAt: Number(value.expiresAt ?? 0),
  };
};

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
  /** Block time the proposal was created, in seconds; 0 if unknown. */
  createdAt: number;
}

const VERSION_NOT_APPROVED = "This multisig wallet's version is no longer approved";
export const WALLET_NOT_ACTIVE = "This multisig wallet is not active";

export interface DedicatedSetupState {
  setupHash: string;
  label: string;
  creator: string;
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
  approvedUpgradePaths: { fromVersion: string; toVersion: string }[];
  verified: boolean;
  verificationErrors: string[];
}

export const parseDedicatedUpgradePaths = (
  pathRows: any[]
): DedicatedFactoryState["approvedUpgradePaths"] =>
  pathRows
    .filter((row) => row?.value === true || row?.value === "true")
    .map((row) => ({
      fromVersion: String(row?.key?.key ?? ""),
      toVersion: String(row?.key?.key2 ?? ""),
    }))
    .filter((path) => path.fromVersion && path.toVersion);

const fetchDedicatedFactoryState = async (): Promise<DedicatedFactoryState> => {
  const address = runtime.multisigFactoryAddress();
  if (!address) {
    return {
      address: "",
      logic: "",
      owner: "",
      registryGovernance: "",
      approvedVersions: [],
      approvedUpgradePaths: [],
      verified: false,
      verificationErrors: ["Multisig wallets are not configured for this network"],
    };
  }
  const [storageRows, versionRows, pathRows] = await Promise.all([
    rows("storage", `address=eq.${address}&select=data`),
    rows("mapping", `address=eq.${address}&collection_name=eq.logicVersions&select=key,value`),
    rows("mapping", `address=eq.${address}&collection_name=eq.upgradePaths&value=eq.true&select=key,value`),
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
    .sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
  const verificationErrors = [
    ...(!logic ? ["The multisig service on this network is not set up correctly"] : []),
    ...(![ADMIN_REGISTRY_ADDRESS, ZERO_ADDRESS].includes(owner)
      ? ["The multisig service is not under the expected network governance"]
      : []),
    ...(registryGovernance !== ADMIN_REGISTRY_ADDRESS
      ? ["Multisig wallet versions are not under the expected network governance"]
      : []),
  ];
  return {
    address,
    logic,
    owner,
    registryGovernance,
    approvedVersions,
    approvedUpgradePaths: parseDedicatedUpgradePaths(pathRows),
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

export interface MultisigWalletSummary {
  address: string;
  setupHash: string;
  label: string;
  requiredApprovals: number;
  signerCount: number;
  signerAddress: string;
  signerUsername: string;
  pendingSigner: boolean;
  nomineeAddress?: string;
  nomineeUsername?: string;
  active: boolean;
  /** When the registry created it, as Cirrus reports the block time. */
  createdAt?: string;
}

export interface PendingMultisigSetupSummary {
  setupHash: string;
  label: string;
  creator: string;
  creatorUsername: string;
  signerAddress: string;
  signerUsername: string;
  confirmedCount: number;
  signerConfirmed: boolean;
  canConfirm: boolean;
  requiredApprovals: number;
  signerCount: number;
  expiresAt: number;
}

const storageData = (row: any): any => {
  const storage = row?.storage;
  const entry = Array.isArray(storage) ? storage[0] : storage;
  return entry?.data ?? entry ?? {};
};

export function useMyMultisigWallets(ownerAddress?: string | null) {
  const { data: userWallets = [], isLoading: userWalletsLoading } = useMyUserWallets(ownerAddress);
  const controlled = [
    strip0x(ownerAddress ?? ""),
    ...userWallets.map((wallet) => strip0x(wallet.address)),
  ].filter(Boolean);
  const usernames = new Map(userWallets.map((wallet) => [strip0x(wallet.address), wallet.username]));
  const factory = runtime.multisigFactoryAddress();
  const query = useQuery({
    queryKey: ["my-multisig-wallets", ownerAddress, controlled],
    enabled: !!ownerAddress && !userWalletsLoading && !!factory,
    refetchInterval: 15_000,
    queryFn: async (): Promise<MultisigWalletSummary[]> => {
      const dedicatedSelect =
        "select=address,key,value,storage(data-%3E%3EmultisigFactory,data-%3E%3EmultisigSetupHash,data-%3E%3EmultisigActive,data-%3E%3EmultisigEpoch,data-%3E%3ErequiredApprovals)";
      const [signerRows, nominationRows] = await Promise.all([
        pagedRows(
          "mapping",
          `collection_name=eq.signerMap&key-%3E%3Ekey=in.(${controlled.join(",")})` +
            `&value=gt.0&${dedicatedSelect}`
        ),
        pagedRows(
          "mapping",
          `collection_name=eq.nominations&key-%3E%3Ekey=in.(${controlled.join(",")})&${dedicatedSelect}`
        ),
      ]);
      const verifyWalletRows = async (candidateRows: any[]): Promise<any[]> => {
        const addresses = [...new Set(
          candidateRows.map((row) => strip0x(String(row?.address ?? ""))).filter(Boolean)
        )];
        if (!addresses.length) return [];
        const registeredRows = await inBatches(addresses, (batch) => pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.factoryWallets` +
            `&key-%3E%3Ekey=in.(${batch.join(",")})&value=eq.true&select=key`
        ));
        const registered = new Set(
          registeredRows.map((row) => strip0x(String(row?.key?.key ?? "")))
        );
        return candidateRows.filter((row) => {
          const address = strip0x(String(row?.address ?? ""));
          return registered.has(address) &&
            strip0x(String(storageData(row)?.multisigFactory ?? "")) === factory;
        });
      };
      const directRows = await verifyWalletRows([...signerRows, ...nominationRows]);
      const verifiedSignerRows = signerRows.filter((row) => directRows.includes(row));
      const verifiedNominationRows = nominationRows.filter((row) => directRows.includes(row));
      const verifiedRows = [...verifiedSignerRows, ...verifiedNominationRows];
      if (!verifiedRows.length) return [];
      const verifiedAddresses = [...new Set(
        verifiedRows.map((row) => strip0x(String(row?.address ?? "")))
      )];
      const setupHashes = [...new Set(
        verifiedRows.map((row) => String(storageData(row)?.multisigSetupHash ?? "")).filter(Boolean)
      )];
      const [setupRows, allSignerRows, createdRows] = await Promise.all([
        inBatches(setupHashes, (batch) => pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.pendingSetups` +
            `&key-%3E%3Ekey=in.(${batch.join(",")})&select=key,value`
        )),
        inBatches(verifiedAddresses, (batch) => pagedRows(
          "mapping",
          `address=in.(${batch.join(",")})&collection_name=eq.signerMap&value=gt.0&select=address`
        )),
        inBatches(verifiedAddresses, (batch) => pagedRows(
          "event",
          `address=eq.${factory}&event_name=eq.MultisigCreated` +
            `&attributes-%3E%3Ewallet=in.(${batch.join(",")})&select=block_timestamp,attributes-%3E%3Ewallet`
        )),
      ]);
      const createdAt = new Map(
        createdRows.map((row) => [strip0x(String(row?.wallet ?? "")), String(row?.block_timestamp ?? "")])
      );
      const labels = new Map(
        setupRows.map((row) => [String(row?.key?.key ?? ""), String(row?.value?.label ?? "")])
      );
      const signerCounts = new Map<string, number>();
      for (const row of allSignerRows) {
        const address = strip0x(String(row?.address ?? ""));
        signerCounts.set(address, (signerCounts.get(address) ?? 0) + 1);
      }

      const summaries = new Map<string, MultisigWalletSummary>();
      for (const row of verifiedSignerRows) {
        const address = strip0x(String(row?.address ?? ""));
        const signerAddress = strip0x(String(row?.key?.key ?? ""));
        const data = storageData(row);
        const existing = summaries.get(address);
        if (existing && existing.signerAddress === controlled[0]) continue;
        if (existing && signerAddress !== controlled[0]) continue;
        summaries.set(address, {
          address,
          setupHash: String(data.multisigSetupHash ?? ""),
          label: labels.get(String(data.multisigSetupHash ?? "")) ?? "",
          requiredApprovals: Number(data.requiredApprovals ?? 0),
          signerCount: signerCounts.get(address) ?? 0,
          signerAddress,
          signerUsername: usernames.get(signerAddress) ?? "",
          pendingSigner: false,
          active: data.multisigActive === true || data.multisigActive === "true",
          createdAt: createdAt.get(address),
        });
      }
      for (const row of verifiedNominationRows) {
        const address = strip0x(String(row?.address ?? ""));
        const nomineeAddress = strip0x(String(row?.key?.key ?? ""));
        const data = storageData(row);
        const value = row?.value ?? {};
        const live = (value.exists === true || value.exists === "true") &&
          Number(value.epoch ?? 0) === Number(data.multisigEpoch ?? 0) &&
          Number(value.expiresAt ?? 0) >= Date.now() / 1000;
        if (!live) continue;
        const current = summaries.get(address);
        if (current) {
          current.pendingSigner = true;
          current.nomineeAddress = nomineeAddress;
          current.nomineeUsername = usernames.get(nomineeAddress) ?? "";
        } else {
          summaries.set(address, {
            address,
            setupHash: String(data.multisigSetupHash ?? ""),
            label: labels.get(String(data.multisigSetupHash ?? "")) ?? "",
            requiredApprovals: Number(data.requiredApprovals ?? 0),
            signerCount: signerCounts.get(address) ?? 0,
            signerAddress: "",
            signerUsername: "",
            pendingSigner: true,
            nomineeAddress,
            nomineeUsername: usernames.get(nomineeAddress) ?? "",
            active: data.multisigActive === true || data.multisigActive === "true",
          });
        }
      }
      return [...summaries.values()];
    },
  });
  return { ...query, isLoading: userWalletsLoading || query.isLoading };
}

export function useMyPendingMultisigSetups(ownerAddress?: string | null) {
  const { data: userWallets = [], isLoading: userWalletsLoading } = useMyUserWallets(ownerAddress);
  const controlled = [
    strip0x(ownerAddress ?? ""),
    ...userWallets.map((wallet) => strip0x(wallet.address)),
  ].filter(Boolean);
  const usernames = new Map(userWallets.map((wallet) => [strip0x(wallet.address), wallet.username]));
  const factory = runtime.multisigFactoryAddress();
  const query = useQuery({
    queryKey: ["my-pending-multisig-setups", ownerAddress, controlled],
    enabled: !!ownerAddress && !userWalletsLoading && !!factory,
    refetchInterval: 15_000,
    queryFn: async (): Promise<PendingMultisigSetupSummary[]> => {
      const [signerRowGroups, creatorRows] = await Promise.all([
        Promise.all(controlled.map((signer) => pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.setupSigners` +
            `&value=eq.%22${signer}%22&select=key,value`
        ))),
        pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.pendingSetups` +
            `&value-%3E%3Ecreator=in.(${controlled.join(",")})&select=key,value`
        ),
      ]);
      const signerRows = signerRowGroups.flat();
      const setupHashes = [...new Set(
        [...signerRows, ...creatorRows].map((row) => String(row?.key?.key ?? "")).filter(Boolean)
      )];
      if (!setupHashes.length) return [];
      const [setupRows, confirmationRows, allSetupSignerRows] = await Promise.all([
        inBatches(setupHashes, (batch) => pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.pendingSetups` +
            `&key-%3E%3Ekey=in.(${batch.join(",")})&select=key,value`
        )),
        inBatches(setupHashes, (batch) => pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.setupConfirmations` +
            `&key-%3E%3Ekey=in.(${batch.join(",")})&value=eq.true&select=key`
        )),
        inBatches(setupHashes, (batch) => pagedRows(
          "mapping",
          `address=eq.${factory}&collection_name=eq.setupSigners` +
            `&key-%3E%3Ekey=in.(${batch.join(",")})&select=key,value`
        )),
      ]);
      const confirmed = new Set(confirmationRows.map((row) =>
        `${String(row?.key?.key ?? "")}:${strip0x(String(row?.key?.key2 ?? ""))}`
      ));
      const signerCounts = new Map<string, number>();
      const confirmedCounts = new Map<string, number>();
      for (const row of allSetupSignerRows) {
        const hash = String(row?.key?.key ?? "");
        if (strip0x(String(row?.value ?? "")).length !== 40) continue;
        signerCounts.set(hash, (signerCounts.get(hash) ?? 0) + 1);
      }
      for (const row of confirmationRows) {
        const hash = String(row?.key?.key ?? "");
        confirmedCounts.set(hash, (confirmedCounts.get(hash) ?? 0) + 1);
      }
      return setupRows.flatMap((row) => {
        const setupHash = String(row?.key?.key ?? "");
        const value = row?.value ?? {};
        const pending = (value.exists === true || value.exists === "true") &&
          value.deployed !== true && value.deployed !== "true" &&
          value.cancelled !== true && value.cancelled !== "true" &&
          Number(value.expiresAt ?? 0) >= Date.now() / 1000;
        if (!pending) return [];
        const signerAddress = controlled.find((candidate) =>
          signerRows.some((signerRow) =>
            String(signerRow?.key?.key ?? "") === setupHash &&
            strip0x(String(signerRow?.value ?? "")) === candidate
          )
        ) ?? "";
        const creator = strip0x(String(value.creator ?? ""));
        if (!signerAddress && !controlled.includes(creator)) return [];
        const signerConfirmed = !!signerAddress && confirmed.has(`${setupHash}:${signerAddress}`);
        return [{
          setupHash,
          label: String(value.label ?? ""),
          creator,
          creatorUsername: usernames.get(creator) ?? "",
          signerAddress,
          signerUsername: usernames.get(signerAddress) ?? "",
          confirmedCount: confirmedCounts.get(setupHash) ?? 0,
          signerConfirmed,
          canConfirm: !!signerAddress && !signerConfirmed,
          requiredApprovals: Number(value.requiredApprovals ?? 0),
          signerCount: signerCounts.get(setupHash) ?? 0,
          expiresAt: Number(value.expiresAt ?? 0),
        }];
      });
    },
  });
  return { ...query, isLoading: userWalletsLoading || query.isLoading };
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
        label: String(value.label ?? ""),
        creator: strip0x(String(value.creator ?? "")),
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

export function useDedicatedWalletState(walletAddress?: string | null) {
  return useQuery({
    queryKey: ["dedicated-multisig-state", walletAddress],
    enabled: !!walletAddress,
    refetchInterval: 5_000,
    queryFn: async (): Promise<DedicatedWalletState> => {
      const address = strip0x(walletAddress!);
      const pinnedFactory = runtime.multisigFactoryAddress();
      const [storageRows, signerRows, nominationRows, factoryRows, versionRows, factoryState] = await Promise.all([
        rows("storage", `address=eq.${address}&select=data`),
        rows(
          "mapping",
          `address=eq.${address}&collection_name=eq.signerMap&value=gt.0&select=key,value`
        ),
        rows(
          "mapping",
          `address=eq.${address}&collection_name=eq.nominations&select=key,value`
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
      const logic = strip0x(String(data.logicContract ?? ""));
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
      const provenanceErrors = [
        ...factoryState.verificationErrors,
        ...(factory !== pinnedFactory ? ["This multisig wallet was created by a different service than this network uses"] : []),
        ...(!registered ? ["This multisig wallet is not registered on this network"] : []),
        ...(!(data.multisigActive === true || data.multisigActive === "true") ? [WALLET_NOT_ACTIVE] : []),
      ];
      const verificationErrors = [
        ...provenanceErrors,
        ...(!approvedVersion ? [VERSION_NOT_APPROVED] : []),
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
        pendingNominees: nominationRows
          .filter((row) => {
            const value = row?.value ?? {};
            return (value.exists === true || value.exists === "true") &&
              Number(value.epoch ?? 0) === Number(data.multisigEpoch ?? 0) &&
              Number(value.expiresAt ?? 0) >= Date.now() / 1000;
          })
          .map((row) => strip0x(String(row?.key?.key ?? "")))
          .filter((nominee) => nominee.length === 40),
        pendingUpgrade: parseDedicatedPendingUpgrade(data.multisigPendingUpgrade),
        provenanceVerified: provenanceErrors.length === 0,
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
            createdAt: Number(value.createdAt ?? 0),
          };
        });
    },
  });
}

export interface DedicatedHistoryItem {
  key: string;
  timestamp?: string;
  /** How a proposal ended. Absent for wallet events that are not proposals. */
  outcome?: "executed" | "dismissed" | "cancelled" | "superseded" | "withdrawn" | "unqueued";
  issueId: string;
  target: string;
  functionName: string;
  arguments: string[];
  /** Wallet events that are not proposals: setup, creation, a signer joining, an upgrade. */
  headline?: string;
  account?: { label: string; value: string };
}

const HISTORY_EVENTS = [
  "IssueExecuted", "IssueExecutedNoArgs", "IssueCreated", "IssueCreatedNoArgs", "IssueDismissed",
  "IssueCancelled", "IssueApprovalRevoked", "IssueUnqueued", "SignerAdded", "UpgradeExecuted",
  "ConfigurationAdvanced",
];

/** Turns a wallet's events, newest first, into the entries shown under History. */
export const buildDedicatedHistory = (events: any[], limit: number): DedicatedHistoryItem[] => {
  const created = new Map<string, any>();
  const ended = new Set<string>();
  const advances: { epoch: number; timestamp?: string }[] = [];
  for (const event of events) {
    const attributes = event?.attributes ?? {};
    const name = String(event?.event_name ?? "");
    if (name.startsWith("IssueCreated")) created.set(String(attributes.issueId ?? ""), event);
    else if (name.startsWith("IssueExecuted") || name === "IssueDismissed" || name === "IssueCancelled") {
      ended.add(String(attributes.issueId ?? ""));
    }
    if (name === "ConfigurationAdvanced" || name === "UpgradeExecuted") {
      advances.push({ epoch: Number(attributes.epoch ?? 0), timestamp: event?.block_timestamp });
    }
  }
  const issue = (attributes: any) => ({
    issueId: String(attributes.issueId ?? ""),
    target: strip0x(String(attributes.target ?? "")),
    functionName: String(attributes.functionName ?? ""),
    arguments: normalizeDedicatedArguments(attributes.arguments),
  });
  const walletEvent = (headline: string, label: string, value: unknown) => ({
    ...issue({}),
    headline,
    account: { label, value: strip0x(String(value ?? "")) },
  });
  const items: DedicatedHistoryItem[] = [];
  for (const event of events) {
    const attributes = event?.attributes ?? {};
    const name = String(event?.event_name ?? "");
    const base = { key: `${event?.transaction_hash}:${name}:${attributes.issueId ?? ""}`, timestamp: event?.block_timestamp };
    if (name.startsWith("IssueExecuted")) {
      items.push({ ...base, outcome: "executed", ...issue(attributes) });
    } else if (name === "IssueDismissed" || name === "IssueCancelled") {
      const origin = created.get(String(attributes.issueId ?? ""));
      if (origin) {
        items.push({
          ...base,
          outcome: name === "IssueDismissed" ? "dismissed" : "cancelled",
          ...issue(origin.attributes),
        });
      }
    } else if (name === "IssueApprovalRevoked" || name === "IssueUnqueued") {
      const origin = created.get(String(attributes.issueId ?? ""));
      if (origin) {
        items.push({
          ...base,
          outcome: name === "IssueUnqueued" ? "unqueued" : "withdrawn",
          ...issue(origin.attributes),
          ...(attributes.signer
            ? { account: { label: "Withdrawn by", value: strip0x(String(attributes.signer)) } }
            : {}),
        });
      }
    } else if (name === "SignerAdded") {
      items.push({ ...base, ...walletEvent("Signer joined", "Signer", attributes.signer) });
    } else if (name === "UpgradeExecuted") {
      items.push({
        ...base,
        ...walletEvent(
          `Upgraded from version ${attributes.fromVersion} to ${attributes.targetVersion}`,
          "Applied by",
          attributes.executor
        ),
      });
    } else if (name === "MultisigCreated") {
      items.push({ ...base, ...walletEvent("Multisig wallet created", "Created by", attributes.creator) });
    } else if (name === "MultisigSetupRegistered") {
      items.push({ ...base, ...walletEvent("Multisig wallet setup started", "Started by", attributes.creator) });
    } else if (name === "InitialSignerConfirmed") {
      items.push({
        ...base,
        key: `${base.key}${attributes.signer}`,
        ...walletEvent(
          `Signer confirmed the setup (${attributes.confirmations} of ${attributes.totalSigners})`,
          "Signer",
          attributes.signer
        ),
      });
    }
  }
  for (const [issueId, origin] of created) {
    if (ended.has(issueId)) continue;
    // Advances are newest first, so the last match is the change that ended the proposal's epoch.
    const advance = advances.filter((entry) => entry.epoch > Number(origin.attributes.epoch ?? 0)).pop();
    if (advance) {
      items.push({
        key: `superseded:${issueId}`,
        timestamp: advance.timestamp,
        outcome: "superseded",
        ...issue(origin.attributes),
      });
    }
  }
  return items
    .sort((left, right) => String(right.timestamp ?? "").localeCompare(String(left.timestamp ?? "")))
    .slice(0, limit);
};

export function useDedicatedHistory(walletAddress?: string | null, setupHash = "", limit = 10) {
  return useQuery({
    queryKey: ["dedicated-multisig-history", walletAddress, setupHash, limit],
    enabled: !!walletAddress,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<DedicatedHistoryItem[]> => {
      const address = strip0x(walletAddress!);
      const factory = runtime.multisigFactoryAddress();
      const events = await rows(
        "event",
        `or=(and(address.eq.${address},event_name.in.(${HISTORY_EVENTS.join(",")}))` +
          (factory && setupHash
            ? `,and(address.eq.${factory},attributes-%3E%3EsetupHash.eq.${setupHash},` +
              `event_name.in.(MultisigSetupRegistered,InitialSignerConfirmed,MultisigCreated))`
            : "") +
          `)&order=block_timestamp.desc&limit=${limit * 10}` +
          `&select=event_name,attributes,block_timestamp,transaction_hash`
      );
      return buildDedicatedHistory(events, limit);
    },
  });
}

export interface RegisterDedicatedSetup {
  label: string;
  signers: string[];
  requiredApprovals: number;
  transactionTimelock: number;
  initialVersion: string;
}

export const canonicalizeSetupSigners = (signers: string[]): string[] =>
  [...new Set(signers.map(strip0x).filter((signer) => signer.length === 40))].sort();

/** An allowance with no practical limit. Operator permissions have their own warning. */
export const isUnlimitedTokenApproval = (functionName: string, args: string[]): boolean => {
  if ((functionName !== "approve" && functionName !== "increaseAllowance") || args.length < 2) return false;
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

/**
 * Dry-run a call as if the multisig wallet made it, so the target contract itself says
 * whether it would succeed. Resolves to the contract's refusal, or "" when it would run.
 */
export function useDedicatedCallCheck(walletAddress: string, call: DedicatedCall | null) {
  return useQuery({
    queryKey: ["dedicated-multisig-call-check", walletAddress, call?.target, call?.functionName, JSON.stringify(call?.arguments)],
    enabled: !!call,
    staleTime: 15_000,
    // Another proposal running can change the answer, such as the permission a paired action needs.
    refetchInterval: 15_000,
    retry: false,
    queryFn: async (): Promise<string> => {
      const declared = await fetchFunctionByAddress(call!.target, call!.functionName);
      if (!declared.found || declared.args.length !== call!.arguments.length) {
        throw new Error("The target function could not be resolved");
      }
      const result = await simulateStratoTx("FUNCTION", {
        contractAddress: strip0x(call!.target),
        method: call!.functionName,
        args: Object.fromEntries(declared.args.map((argument, index) => [argument.name, call!.arguments[index]])),
        value: 0,
        metadata: {},
      }, { address: walletAddress, trace: false });
      return result.status === "Success"
        ? ""
        : String(result.error || "The contract refused it").replace(/^solidity require failed:\s*/i, "");
    },
  });
}

export function useDedicatedMultisigActions(walletAddress?: string) {
  const { submit } = useSubmitTransaction();
  const queryClient = useQueryClient();
  const factory = runtime.multisigFactoryAddress();

  const factoryCall = useCallback(
    (method: string, args: Record<string, unknown>, username?: string) => {
      if (!factory) throw new Error("Multisig wallets are not set up on this network");
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
      if (!walletAddress) throw new Error("Multisig wallet address is required");
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
        _label: input.label,
      }, username).finally(() =>
        queryClient.invalidateQueries({ queryKey: ["my-pending-multisig-setups"] })
      ),
    confirmSetup: (setupHash: string, username?: string) =>
      factoryCall("confirmSetup", { _setupHash: setupHash }, username).catch((error) => {
        // The multisig wallet's address was taken before it could be created; only a new invitation gets a new address.
        throw /already exists/i.test(String(error?.message))
          ? new Error("This invitation can no longer be completed. Create a new invitation.")
          : error;
      }).finally(() => {
        queryClient.invalidateQueries({ queryKey: ["my-pending-multisig-setups"] });
        queryClient.invalidateQueries({ queryKey: ["my-multisig-wallets"] });
      }),
    cancelSetup: (setupHash: string, username?: string) =>
      factoryCall("cancelSetup", { _setupHash: setupHash }, username).finally(() =>
        queryClient.invalidateQueries({ queryKey: ["my-pending-multisig-setups"] })
      ),
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
    acceptNomination: (username?: string) =>
      walletCall("acceptNomination", {}, username).finally(() =>
        queryClient.invalidateQueries({ queryKey: ["my-multisig-wallets"] })
      ),
    executeUpgrade: () => walletCall("executeUpgrade", {}),
  };
}
