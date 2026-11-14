import { formatUnits } from "viem";
import { shortenHex } from "@/lib/utils";
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
  historical?: boolean;
  staking?: StakingMetadata;
  cdp?: CDPMetadata;
  pools: PoolMetadata[];
  v3?: V3AllowanceMetadata;
}

export interface ProposalDescription {
  headline: string;
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
    return {
      headline: `Allow ${short(spender)} to spend ${amount}`,
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
  if (targetIsWallet && proposal.functionName === "applyConfiguration") {
    let nextSigners: string[] | null = null;
    try {
      const parsed = JSON.parse(proposal.arguments[0] ?? "[]");
      if (Array.isArray(parsed)) nextSigners = parsed.map((signer) => strip0x(String(signer)));
    } catch {
      nextSigners = null;
    }
    const neutralHeadline = `Set ${nextSigners ? `${nextSigners.length} signers` : "signers"} and approvals needed to ${proposal.arguments[1] ?? ""}`;
    if (!nextSigners || metadata.historical) {
      return { headline: neutralHeadline, addresses: [] };
    }
    const removed = (metadata.signers ?? []).filter((signer) =>
      !nextSigners.some((nextSigner) => strip0x(nextSigner) === strip0x(signer))
    );
    const added = nextSigners.filter((signer) =>
      !(metadata.signers ?? []).some((currentSigner) => strip0x(currentSigner) === strip0x(signer))
    );
    const required = Number(proposal.arguments[1]);
    const changes = [
      removed.length
        ? `Remove signer${removed.length === 1 ? "" : "s"} ${removed.map(short).join(", ")}`
        : "",
      added.length
        ? `add signer${added.length === 1 ? "" : "s"} ${added.map(short).join(", ")}`
        : "",
      Number.isFinite(required) && required !== metadata.requiredApprovals
        ? `change approvals needed to ${required}`
        : "",
    ].filter(Boolean);
    const changeHeadline = changes.map(
      (change, index) => index === 0 ? change : `and ${change}`
    ).join(" ");
    return {
      headline: changes.length
        ? `${changeHeadline.charAt(0).toUpperCase()}${changeHeadline.slice(1)}`
        : neutralHeadline,
      addresses: [
        ...removed.map((signer) => address("Signer to remove", signer)),
        ...added.map((signer) => address("Signer to add", signer)),
      ],
    };
  }
  if (targetIsWallet && proposal.functionName === "nominateConfiguration" && proposal.arguments[0]) {
    let nextSigners: string[] | null = null;
    try {
      const parsed = JSON.parse(proposal.arguments[1] ?? "[]");
      if (Array.isArray(parsed)) nextSigners = parsed.map((signer) => strip0x(String(signer)));
    } catch {
      nextSigners = null;
    }
    if (!nextSigners || metadata.historical) {
      return {
        headline: nextSigners
          ? `Invite signer ${short(proposal.arguments[0])} for a ${nextSigners.length}-signer configuration`
          : `Invite signer ${short(proposal.arguments[0])}`,
        detail: nextSigners
          ? `Approvals needed: ${proposal.arguments[2] ?? "unknown"}`
          : undefined,
        addresses: [address("Invited signer", proposal.arguments[0])],
      };
    }
    const currentSigners = metadata.signers ?? [];
    const removed = currentSigners.filter((signer) =>
      !nextSigners.some((nextSigner) => strip0x(nextSigner) === strip0x(signer))
    );
    const added = nextSigners.filter((signer) =>
      !currentSigners.some((currentSigner) => strip0x(currentSigner) === strip0x(signer))
    );
    const required = Number(proposal.arguments[2]);
    const sameRequired = Number.isFinite(required) && required === metadata.requiredApprovals;
    const pureAdd = removed.length === 0 && added.length === 1 &&
      strip0x(added[0]) === strip0x(proposal.arguments[0]) &&
      nextSigners.length === currentSigners.length + 1 && sameRequired;
    if (pureAdd) {
      return {
        headline: `Add signer ${short(proposal.arguments[0])}`,
        detail: `${currentSigners.length} signers become ${nextSigners.length}, approvals needed stays ${required}`,
        addresses: [address("Invited signer", proposal.arguments[0])],
      };
    }
    const changes = [
      removed.length
        ? `Remove signer${removed.length === 1 ? "" : "s"} ${removed.map(short).join(", ")}`
        : "",
      added.length
        ? `add signer${added.length === 1 ? "" : "s"} ${added.map(short).join(", ")}`
        : "",
      Number.isFinite(required) && required !== metadata.requiredApprovals
        ? `change approvals needed to ${required}`
        : "",
    ].filter(Boolean);
    const headline = changes.map(
      (change, index) => index === 0 ? change : `and ${change}`
    ).join(" ");
    return {
      headline: headline
        ? `${headline.charAt(0).toUpperCase()}${headline.slice(1)}`
        : `Add signer ${short(proposal.arguments[0])}`,
      detail: Number.isFinite(required)
        ? `${currentSigners.length} signers become ${nextSigners.length}, approvals needed ${
            sameRequired ? `stays ${required}` : `changes from ${metadata.requiredApprovals ?? "unknown"} to ${required}`
          }`
        : undefined,
      addresses: [
        ...removed.map((signer) => address("Signer to remove", signer)),
        ...added.map((signer) => address("Signer to add", signer)),
      ],
    };
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
      headline: `Change waiting period to ${
        seconds === 0 ? "none" : `${seconds / 3600} ${seconds === 3600 ? "hour" : "hours"}`
      }`,
      addresses: [],
    };
  }
  if (targetIsWallet && proposal.functionName === "scheduleUpgrade") {
    return {
      headline: `Upgrade multisig wallet to version ${proposal.arguments[1] ?? ""}`,
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
  return { headline: "Custom contract call", addresses: [] };
}
