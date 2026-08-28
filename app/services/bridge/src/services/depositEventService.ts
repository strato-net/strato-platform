import { Interface } from "ethers";
import {
  ActionDepositArgs,
  DepositArgs,
  NonEmptyArray,
} from "../types";
import { normalizeAddress } from "../utils/utils";

const DEPOSIT_EVENTS_ABI = [
  "event DepositRouted(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId)",
  "event DepositRoutedWithAction(address indexed token, uint256 amount, address indexed sender, address indexed stratoAddress, address targetStratoToken, uint96 depositId, uint8 action, address actionToken, uint256 minFinalOut)",
];

const depositEvents = new Interface(DEPOSIT_EVENTS_ABI);

export interface RawDepositLog {
  address: string;
  blockHash?: string;
  blockNumber: string;
  data: string;
  logIndex: string;
  topics: string[];
  transactionHash: string;
}

export interface ClassifiedDepositLogs {
  standardDeposits: DepositArgs[];
  actionDeposits: ActionDepositArgs[];
  quarantinedLogs: Array<{
    log: RawDepositLog;
    error: string;
  }>;
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
  if (!log.address || !log.transactionHash || !log.blockHash) {
    throw new Error("Deposit log is missing router, transaction hash, or block hash");
  }
  const parsed = depositEvents.parseLog({
    topics: log.topics,
    data: log.data,
  });
  if (!parsed) {
    throw new Error("Log does not match a supported deposit event");
  }

  const base: DepositArgs = {
    externalChainId,
    depositRouter: normalizeAddress(log.address),
    depositId: parsed.args.depositId.toString(),
    externalSender: normalizeAddress(parsed.args.sender),
    externalToken: normalizeAddress(parsed.args.token),
    externalTokenAmount: parsed.args.amount.toString(),
    observedExternalTokenAmount: parsed.args.amount.toString(),
    externalTxHash: log.transactionHash,
    externalBlockHash: log.blockHash,
    externalBlockNumber: Number(BigInt(log.blockNumber)),
    externalBlockTimestamp: 0,
    externalLogIndex: Number(BigInt(log.logIndex)),
    detectedAt: Date.now(),
    stratoRecipient: normalizeAddress(parsed.args.stratoAddress),
    targetStratoToken: normalizeAddress(parsed.args.targetStratoToken),
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
    quarantinedLogs: [],
  };

  for (const groupedLogs of groups.values()) {
    for (const log of groupedLogs) {
      try {
        const parsed = parseDepositLog(log, externalChainId);
        if (parsed.kind === "standard") {
          result.standardDeposits.push(parsed.deposit);
        } else {
          result.actionDeposits.push(parsed.deposit);
        }
      } catch (error) {
        result.quarantinedLogs.push({
          log,
          error: (error as Error).message,
        });
      }
    }
  }

  return result;
};

export const buildActionDepositBatchArgs = (
  depositArgs: NonEmptyArray<ActionDepositArgs>,
) => ({
  externalChainIds: depositArgs.map((deposit) => deposit.externalChainId),
  depositRouters: depositArgs.map((deposit) => deposit.depositRouter),
  depositIds: depositArgs.map((deposit) => deposit.depositId),
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
