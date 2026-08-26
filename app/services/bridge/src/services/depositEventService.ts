import { Interface } from "ethers";
import {
  ActionDepositArgs,
  DepositArgs,
  NonEmptyArray,
} from "../types";
import { normalizeAddress } from "../utils/utils";

// Both router generations are listed on purpose. V2 appends `maxFee` -- the
// most a depositor will leave a fast-fill LP -- which changes topic0, so a V2
// router's logs are invisible to a V1-only ABI. Chains migrate one at a time,
// so the relayer has to understand both at once or it silently stops seeing
// deposits on whichever side it was not updated for.
//
// ethers keys fragments by topic hash, so parseLog resolves the right one; the
// two shapes share a name but never a signature.
const DEPOSIT_EVENTS_ABI = [
  // V1
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint8 action, address actionToken, uint256 minFinalOut)",
  // V2 (adds maxFee)
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint256 maxFee)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint256 maxFee, uint8 action, address actionToken, uint256 minFinalOut)",
];

const depositEvents = new Interface(DEPOSIT_EVENTS_ABI);

export interface RawDepositLog {
  address: string;
  blockNumber: string;
  data: string;
  logIndex: string;
  topics: string[];
  transactionHash: string;
}

export interface ClassifiedDepositLogs {
  standardDeposits: DepositArgs[];
  actionDeposits: ActionDepositArgs[];
}

export type ParsedDepositEvent =
  | {
      kind: "standard";
      deposit: DepositArgs;
    }
  | {
      kind: "action";
      deposit: ActionDepositArgs;
    };

export const parseDepositLog = (
  log: RawDepositLog,
  externalChainId: number,
): ParsedDepositEvent => {
  const parsed = depositEvents.parseLog({
    topics: log.topics,
    data: log.data,
  });
  if (!parsed) {
    throw new Error("Log does not match a supported deposit event");
  }

  const base: DepositArgs = {
    externalChainId,
    externalSender: normalizeAddress(parsed.args.sender),
    externalToken: normalizeAddress(parsed.args.token),
    externalTokenAmount: parsed.args.amount.toString(),
    externalTxHash: log.transactionHash,
    stratoRecipient: normalizeAddress(parsed.args.stratoAddress),
    targetStratoToken: normalizeAddress(parsed.args.targetStratoToken),
    // Absent on V1 logs; a V1 deposit simply cannot be fast-filled.
    maxFee: parsed.args.maxFee === undefined ? "0" : parsed.args.maxFee.toString(),
  };
  if (parsed.name === "DepositRouted") {
    return { kind: "standard", deposit: base };
  }
  if (parsed.name !== "DepositRoutedWithAction") {
    throw new Error(`Unsupported deposit event ${parsed.name}`);
  }

  const deposit: ActionDepositArgs = {
    ...base,
    action: parsed.args.action.toString(),
    actionToken: normalizeAddress(parsed.args.actionToken),
    minFinalOut: parsed.args.minFinalOut.toString(),
  };

  return {
    kind: "action",
    deposit,
  };
};

export const classifyDepositLogs = (
  logs: RawDepositLog[],
  externalChainId: number,
): ClassifiedDepositLogs => {
  const uniqueLogs = Array.from(
    new Map(
      logs.map((log) => [
        JSON.stringify([
          log.address?.toLowerCase(),
          log.blockNumber?.toLowerCase(),
          log.transactionHash?.toLowerCase(),
          log.logIndex?.toLowerCase(),
          log.topics.map((topic) => topic.toLowerCase()),
          log.data?.toLowerCase(),
        ]),
        log,
      ]),
    ).values(),
  );
  const groups = new Map<string, RawDepositLog[]>();
  uniqueLogs.forEach((log, index) => {
    const transactionHash =
      log.transactionHash ||
      `missing-${log.blockNumber || "block"}-${log.logIndex || index}`;
    const key = transactionHash.toLowerCase();
    groups.set(key, [...(groups.get(key) || []), log]);
  });

  const result: ClassifiedDepositLogs = {
    standardDeposits: [],
    actionDeposits: [],
  };

  for (const [groupKey, groupedLogs] of groups.entries()) {
    const transactionHash = groupedLogs[0].transactionHash || groupKey;
    if (groupedLogs.length > 1) {
      throw new Error(
        `Multiple deposit events found for transaction ${transactionHash}`,
      );
    }

    const parsed = parseDepositLog(groupedLogs[0], externalChainId);
    if (parsed.kind === "standard") {
      result.standardDeposits.push(parsed.deposit);
    } else {
      result.actionDeposits.push(parsed.deposit);
    }
  }

  return result;
};

export const buildActionDepositBatchArgs = (
  depositArgs: NonEmptyArray<ActionDepositArgs>,
) => ({
  externalChainIds: depositArgs.map((deposit) => deposit.externalChainId),
  externalSenders: depositArgs.map((deposit) => deposit.externalSender),
  externalTokens: depositArgs.map((deposit) => deposit.externalToken),
  externalTokenAmounts: depositArgs.map((deposit) => deposit.externalTokenAmount),
  externalTxHashes: depositArgs.map((deposit) => deposit.externalTxHash),
  stratoRecipients: depositArgs.map((deposit) => deposit.stratoRecipient),
  targetStratoTokens: depositArgs.map((deposit) => deposit.targetStratoToken),
  actions: depositArgs.map((deposit) => deposit.action),
  actionTokens: depositArgs.map((deposit) => deposit.actionToken),
  minFinalOuts: depositArgs.map((deposit) => deposit.minFinalOut),
});
