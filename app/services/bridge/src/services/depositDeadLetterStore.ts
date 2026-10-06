import { WindowDeposit } from "../types";
import { JsonFileStore, dataFilePath } from "../utils/jsonFileStore";

const DEAD_LETTER_FILE = "depositDeadLetters.json";

// A source deposit the relayer could not record on STRATO. It stays here until an operator
// resolves it (refund, reroute, or replay once the cause is fixed) and removes the entry.
export interface DepositDeadLetter {
  externalChainId: number;
  depositKey: string;
  depositId: string;
  reason: string;
  deposit: WindowDeposit;
  firstSeenAt: string;
  lastSeenAt: string;
  attempts: number;
}

type DeadLetters = Record<string, DepositDeadLetter>;

export const createDepositDeadLetterStore = (
  filePath = dataFilePath(DEAD_LETTER_FILE),
) => {
  const store = new JsonFileStore<DeadLetters>(filePath, () => ({}));

  return {
    async add(externalChainId: number, deposit: WindowDeposit, reason: string): Promise<void> {
      const id = `${externalChainId}:${deposit.depositKey}`;
      const now = new Date().toISOString();
      await store.update((data) => {
        const existing = data[id];
        data[id] = {
          externalChainId,
          depositKey: deposit.depositKey,
          depositId: deposit.depositId,
          reason,
          deposit,
          firstSeenAt: existing?.firstSeenAt ?? now,
          lastSeenAt: now,
          attempts: (existing?.attempts ?? 0) + 1,
        };
      });
    },

    async list(): Promise<DepositDeadLetter[]> {
      return Object.values(await store.read());
    },
  };
};

export type DepositDeadLetterStore = ReturnType<typeof createDepositDeadLetterStore>;
