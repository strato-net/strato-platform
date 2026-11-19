import { formatUnits } from "viem";
import { formatWaitingPeriod, shortenHex } from "@/lib/utils";
import { isUnlimitedTokenApproval } from "@/services/dedicatedMultisig";
import type {
  CDPMetadata,
  PoolMetadata,
  StakingMetadata,
  V3AllowanceMetadata,
} from "@/services/protocolMetadata";
import type { TokenMetadata } from "@/services/tokens";
import { strip0x } from "@/services/userWallets";

export interface ProposalPayload {
  target: string;
  functionName: string;
  arguments: string[];
}

export interface ProposalMetadata {
  walletAddress: string;
  signers?: string[];
  requiredApprovals?: number;
  currentVersion?: string;
  approvedVersions?: { version: string; logic: string }[];
  approvedUpgradePaths?: { fromVersion: string; toVersion: string }[];
  historical?: boolean;
  staking?: StakingMetadata;
  cdp?: CDPMetadata;
  pools: PoolMetadata[];
  v3?: V3AllowanceMetadata;
}

export interface ProposalDescription {
  headline: string;
  /** True when the call is not one this app recognises. */
  custom?: boolean;
  detail?: string;
  addresses: { label: string; value: string }[];
}

export interface ProposalWarning {
  title: string;
  detail: string;
}

export const canonicalSolidityType = (type: string): string =>
  type.replace(/\s+/g, "").replace(/\buint(?=(?:\[|$))/g, "uint256").replace(/\bint(?=(?:\[|$))/g, "int256");

export const proposalArgumentTypesMatch = (expected: string[], committed: string[]): boolean =>
  JSON.stringify(expected.map(canonicalSolidityType)) ===
    JSON.stringify(committed.map(canonicalSolidityType));

export function describeProposalWarning(proposal: ProposalPayload): ProposalWarning | null {
  if (proposal.functionName === "increaseAllowance") {
    return {
      title: "Token permission increase",
      detail: "This increases how many tokens another address can spend. Review the spender and amount carefully.",
    };
  }
  if (proposal.functionName === "transferFrom") {
    return {
      title: "Delegated token transfer",
      detail: "This transfers tokens from an address using an existing permission. Review the sender, recipient and amount carefully.",
    };
  }
  if (proposal.functionName === "transferOwnership") {
    return {
      title: "Contract ownership transfer",
      detail: "This gives another address control of the target contract. Review the new owner carefully.",
    };
  }
  if (proposal.functionName === "renounceOwnership") {
    return {
      title: "Contract ownership removal",
      detail: "This permanently removes the current owner from the target contract.",
    };
  }
  if (proposal.functionName === "setLogicContract") {
    return {
      title: "Contract code replacement",
      detail: "This changes the code used by the target contract. Review the new logic address carefully.",
    };
  }
  if (proposal.functionName === "setApprovalForAll") {
    return {
      title: "Token operator permission",
      detail: "This can give another address permission to manage every token in a collection. Review the operator and setting carefully.",
    };
  }
  return null;
}

/** Signer, waiting-period and version changes cancel whatever is still open on the multisig wallet. */
export function describeProposalSideEffect(proposal: ProposalPayload, walletAddress: string): string | null {
  if (strip0x(proposal.target) !== strip0x(walletAddress)) return null;
  if (
    proposal.functionName === "removeSigner" ||
    proposal.functionName === "setRequiredApprovals" ||
    proposal.functionName === "setTransactionTimelock"
  ) {
    return "When this runs, every other open proposal, any pending signer invitation and any pending upgrade are cancelled.";
  }
  if (proposal.functionName === "nominateSigner") {
    return "When the invited signer accepts, every open proposal and any pending upgrade are cancelled.";
  }
  if (proposal.functionName === "scheduleUpgrade") {
    return "When the upgrade is applied, every open proposal and any pending signer invitation are cancelled.";
  }
  return null;
}

/** The name this app knows a contract by: a registered token or a protocol contract. */
export function knownAddressName(
  value: string,
  tokens: TokenMetadata[],
  metadata: ProposalMetadata
): string | undefined {
  const address = strip0x(value);
  if (!address) return undefined;
  const token = tokens.find((item) => strip0x(item.address) === address);
  if (token) return token.symbol;
  if (address === strip0x(metadata.walletAddress)) return "this multisig wallet";
  const protocol = ([
    [metadata.staking?.stakingAddress, "Staking"],
    [metadata.cdp?.engineAddress, "CDP engine"],
    [metadata.cdp?.vaultAddress, "CDP vault"],
    [metadata.v3?.positionManagerAddress, "V3 position manager"],
  ] as [string | undefined, string][]).find(([candidate]) => candidate && strip0x(candidate) === address);
  if (protocol) return protocol[1];
  return metadata.pools.find((pool) => strip0x(pool.address) === address)?.poolName || undefined;
}

const formatAmount = (value: string, token?: TokenMetadata, defaultDecimals?: number) => {
  try {
    const decimals = token?.decimals ?? defaultDecimals;
    return decimals == null ? value : formatUnits(BigInt(value), decimals);
  } catch {
    return value;
  }
};

export function describeProposal(
  proposal: ProposalPayload,
  tokens: TokenMetadata[],
  metadata: ProposalMetadata
): ProposalDescription {
  const targetToken = tokens.find((token) => strip0x(token.address) === strip0x(proposal.target));
  const tokenFor = (value: string) =>
    tokens.find((token) => strip0x(token.address) === strip0x(value));
  const short = (value: string) => shortenHex(strip0x(value), 6, 4);
  const address = (label: string, value: string) => ({ label, value: strip0x(value) });
  const targetIsWallet = strip0x(proposal.target) === strip0x(metadata.walletAddress);
  const stakingTarget = strip0x(proposal.target) === strip0x(metadata.staking?.stakingAddress ?? "");
  const cdpTarget = strip0x(proposal.target) === strip0x(metadata.cdp?.engineAddress ?? "");
  const pool = metadata.pools.find((item) => strip0x(item.address) === strip0x(proposal.target));
  const v3Target = strip0x(proposal.target) === strip0x(metadata.v3?.positionManagerAddress ?? "");

  if (targetToken && proposal.functionName === "transfer" && proposal.arguments.length >= 2) {
    const recipient = proposal.arguments[0];
    return {
      headline: `Send ${formatAmount(proposal.arguments[1], targetToken)} ${targetToken.symbol} to ${short(recipient)}`,
      addresses: [address("Recipient", recipient)],
    };
  }
  if (targetToken && proposal.functionName === "approve" && proposal.arguments.length >= 2) {
    const spender = proposal.arguments[0];
    const amount = isUnlimitedTokenApproval(proposal.functionName, proposal.arguments)
      ? `unlimited ${targetToken.symbol}`
      : `${formatAmount(proposal.arguments[1], targetToken)} ${targetToken.symbol}`;
    const spenderName = knownAddressName(spender, tokens, metadata);
    return {
      headline: `Allow ${spenderName ?? short(spender)} to spend ${amount}`,
      detail: spenderName
        ? `Token permission for ${spenderName}. The action that uses it is a separate proposal.`
        : undefined,
      addresses: [address("Spender", spender)],
    };
  }
  if (stakingTarget && (proposal.functionName === "stake" || proposal.functionName === "unstake") &&
      proposal.arguments.length >= 2) {
    const validator = proposal.arguments[0];
    const validatorName = metadata.staking?.validators.find((item) =>
      strip0x(item.address) === strip0x(validator)
    )?.name;
    return {
      headline: `${proposal.functionName === "stake" ? "Stake" : "Unstake"} ${formatAmount(proposal.arguments[1], undefined, metadata.staking?.tokenDecimals ?? 18)} ${metadata.staking?.tokenSymbol ?? "STRATO"} ${proposal.functionName === "stake" ? "with" : "from"} ${validatorName || short(validator)}`,
      addresses: [address("Validator", validator)],
    };
  }
  if (cdpTarget && proposal.functionName === "deposit" && proposal.arguments.length >= 2) {
    const asset = proposal.arguments[0];
    const assetMetadata = metadata.cdp?.assets.find((item) =>
      strip0x(item.asset) === strip0x(asset)
    );
    return {
      headline: `Deposit ${formatAmount(proposal.arguments[1], tokenFor(asset), assetMetadata?.decimals)} ${assetMetadata?.symbol ?? tokenFor(asset)?.symbol ?? "tokens"} as collateral`,
      addresses: [address("Collateral asset", asset)],
    };
  }
  if (cdpTarget && proposal.functionName === "mint" && proposal.arguments.length >= 2) {
    const asset = proposal.arguments[0];
    const assetMetadata = metadata.cdp?.assets.find((item) =>
      strip0x(item.asset) === strip0x(asset)
    );
    return {
      headline: `Borrow ${formatAmount(proposal.arguments[1], undefined, 18)} USDST against ${assetMetadata?.symbol ?? short(asset)}`,
      addresses: [address("Collateral asset", asset)],
    };
  }
  if (v3Target && proposal.functionName === "mint" && proposal.arguments.length >= 9) {
    const v3Pool = metadata.v3?.pools.find((item) =>
      strip0x(item.address) === strip0x(proposal.arguments[0])
    );
    return {
      headline: `Create a ${v3Pool ? `${v3Pool.token0._symbol}/${v3Pool.token1._symbol}` : short(proposal.arguments[0])} liquidity position`,
      addresses: [
        address("Pool", proposal.arguments[0]),
        ...(proposal.arguments[7] ? [address("Receiver", proposal.arguments[7])] : []),
      ],
    };
  }
  if (pool && (proposal.functionName === "addLiquidity" || proposal.functionName === "addLiquidityGeneral")) {
    return {
      headline: `Add liquidity to ${pool.poolName || short(proposal.target)}`,
      addresses: proposal.functionName === "addLiquidityGeneral" && proposal.arguments[2]
        ? [address("Receiver", proposal.arguments[2])]
        : [],
    };
  }
  if (pool && proposal.functionName === "removeliquidityOneCoin") {
    return {
      headline: `Remove liquidity from ${pool.poolName || short(proposal.target)} as one coin`,
      addresses: proposal.arguments[3] ? [address("Receiver", proposal.arguments[3])] : [],
    };
  }
  if (pool && (proposal.functionName === "removeLiquidity" || proposal.functionName === "removeLiquidityGeneral")) {
    const receiver = proposal.functionName === "removeLiquidityGeneral" ? proposal.arguments[2] : "";
    return {
      headline: `Remove liquidity from ${pool.poolName || short(proposal.target)}`,
      addresses: receiver ? [address("Receiver", receiver)] : [],
    };
  }
  if (v3Target && proposal.functionName === "increaseLiquidity") {
    return { headline: `Increase liquidity for position ${proposal.arguments[0] ?? ""}`, addresses: [] };
  }
  if (v3Target && proposal.functionName === "decreaseLiquidity") {
    return { headline: `Decrease liquidity for position ${proposal.arguments[0] ?? ""}`, addresses: [] };
  }
  if (v3Target && proposal.functionName === "collect") {
    return {
      headline: `Collect fees from position ${proposal.arguments[0] ?? ""}`,
      addresses: proposal.arguments[1] ? [address("Receiver", proposal.arguments[1])] : [],
    };
  }
  const signerCount = metadata.historical || metadata.requiredApprovals == null
    ? undefined
    : metadata.signers?.length;
  if (targetIsWallet && proposal.functionName === "nominateSigner" && proposal.arguments[0]) {
    return {
      headline: `Add signer ${short(proposal.arguments[0])}`,
      detail: signerCount == null
        ? undefined
        : `${signerCount} signers become ${signerCount + 1}, approvals needed stays ${metadata.requiredApprovals}`,
      addresses: [address("Invited signer", proposal.arguments[0])],
    };
  }
  if (targetIsWallet && proposal.functionName === "removeSigner" && proposal.arguments[0]) {
    const required = proposal.arguments[1] ?? "";
    return {
      headline: `Remove signer ${short(proposal.arguments[0])}`,
      detail: signerCount == null
        ? `Approvals needed: ${required}`
        : `${signerCount} signers become ${signerCount - 1}, approvals needed ${
            Number(required) === metadata.requiredApprovals
              ? `stays ${required}`
              : `changes from ${metadata.requiredApprovals} to ${required}`
          }`,
      addresses: [address("Signer to remove", proposal.arguments[0])],
    };
  }
  if (targetIsWallet && proposal.functionName === "setRequiredApprovals") {
    return { headline: `Change approvals needed to ${proposal.arguments[0] ?? ""}`, addresses: [] };
  }
  if (targetIsWallet && proposal.functionName === "revokeNomination" && proposal.arguments[0]) {
    return {
      headline: `Revoke signer invitation for ${short(proposal.arguments[0])}`,
      addresses: [address("Invited signer", proposal.arguments[0])],
    };
  }
  if (targetIsWallet && proposal.functionName === "setTransactionTimelock") {
    const seconds = Number(proposal.arguments[0] ?? 0);
    return {
      headline: `Change waiting period to ${formatWaitingPeriod(seconds)}`,
      addresses: [],
    };
  }
  if (targetIsWallet && proposal.functionName === "scheduleUpgrade") {
    const migrationFunction = proposal.arguments[2] || "No migration";
    return {
      headline: `Upgrade multisig wallet to version ${proposal.arguments[1] ?? ""}`,
      detail: `Migration: ${migrationFunction}`,
      addresses: proposal.arguments[0] ? [address("New version address", proposal.arguments[0])] : [],
    };
  }
  if (targetIsWallet && proposal.functionName === "cancelUpgrade") {
    return { headline: "Cancel the pending multisig wallet upgrade", addresses: [] };
  }
  if (targetIsWallet && proposal.functionName === "freezeUpgrades") {
    return { headline: "Permanently disable multisig wallet upgrades", addresses: [] };
  }
  if (targetIsWallet && proposal.functionName === "cancelIssue") {
    return {
      headline: `Cancel proposal ${proposal.arguments[0] ?? ""}`,
      addresses: [],
    };
  }
  return { headline: `Call ${proposal.functionName} on ${short(proposal.target)}`, custom: true, addresses: [] };
}
