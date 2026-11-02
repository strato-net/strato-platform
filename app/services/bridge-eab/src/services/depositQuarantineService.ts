import { mkdirSync, promises as fs } from "fs";
import path from "path";
import { RawDepositLog } from "./depositEventService";
import { logError } from "../utils/logger";
import { ActionDepositArgs, DepositArgs } from "../types";

const DATA_DIR = path.join(process.cwd(), "data");
const QUARANTINE_PATH = path.join(DATA_DIR, "depositQuarantine.jsonl");

mkdirSync(DATA_DIR, { recursive: true });

export const quarantineDepositLog = async (
  externalChainId: number,
  log: RawDepositLog,
  reason: string,
): Promise<void> => {
  const record = {
    quarantinedAt: new Date().toISOString(),
    externalChainId,
    reason,
    log,
  };
  await fs.appendFile(QUARANTINE_PATH, `${JSON.stringify(record)}\n`);
  logError(
    "DepositQuarantine",
    new Error(`External deposit log quarantined: ${reason}`),
    {
      externalChainId,
      depositRouter: log.address,
      externalTxHash: log.transactionHash,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
    },
  );
};

export const quarantineDeposit = async (
  deposit: DepositArgs | ActionDepositArgs,
  reason: string,
): Promise<void> => {
  await fs.appendFile(
    QUARANTINE_PATH,
    `${JSON.stringify({
      quarantinedAt: new Date().toISOString(),
      externalChainId: deposit.externalChainId,
      depositRouter: deposit.depositRouter,
      depositId: deposit.depositId,
      reason,
      deposit,
    })}\n`,
  );
};
