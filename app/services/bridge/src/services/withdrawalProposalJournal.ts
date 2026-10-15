import { SafeTransactionData } from "../types";
import { JsonFileStore, dataFilePath } from "../utils/jsonFileStore";

const JOURNAL_FILE = "withdrawalProposals.json";
// A confirm whose outcome was unknown settles within minutes; older unproposed entries are dead
const UNPROPOSED_RETENTION_MS = 24 * 60 * 60 * 1000;

// A signed Safe payout, saved before its hash is sent to STRATO as the withdrawal's custody tx.
// If that confirmation lands but the proposal never reaches the Safe service, this is the only
// copy of the transaction STRATO now points at.
export interface WithdrawalProposalEntry {
  withdrawalId: string;
  proposal: SafeTransactionData;
  createdAt: string;
  proposedAt?: string;
}

type Journal = Record<string, WithdrawalProposalEntry>;

const hashKey = (safeTxHash: string) =>
  `0x${safeTxHash.replace(/^0x/i, "").toLowerCase()}`;

export const createWithdrawalProposalJournal = (
  filePath = dataFilePath(JOURNAL_FILE),
) => {
  const store = new JsonFileStore<Journal>(filePath, () => ({}));

  return {
    async record(entries: Array<{ withdrawalId: string; proposal: SafeTransactionData }>) {
      const now = new Date().toISOString();
      await store.update((journal) => {
        for (const { withdrawalId, proposal } of entries) {
          journal[hashKey(proposal.safeTxHash)] = { withdrawalId, proposal, createdAt: now };
        }
      });
    },

    async get(safeTxHash: string): Promise<WithdrawalProposalEntry | undefined> {
      return (await store.read())[hashKey(safeTxHash)];
    },

    async markProposed(safeTxHashes: string[]) {
      if (safeTxHashes.length === 0) return;
      const now = new Date().toISOString();
      await store.update((journal) => {
        for (const hash of safeTxHashes) {
          const entry = journal[hashKey(hash)];
          if (entry) entry.proposedAt = now;
        }
      });
    },

    // Drop everything for withdrawals that reached a final state, and stale unproposed entries
    async prune(finishedWithdrawalIds: string[], now = Date.now()) {
      const finished = new Set(finishedWithdrawalIds.map(String));
      const journal = await store.read();
      const isStale = (entry: WithdrawalProposalEntry) =>
        finished.has(entry.withdrawalId) ||
        (!entry.proposedAt && now - Date.parse(entry.createdAt) > UNPROPOSED_RETENTION_MS);
      if (!Object.values(journal).some(isStale)) return;
      await store.update((data) => {
        for (const [hash, entry] of Object.entries(data)) {
          if (isStale(entry)) delete data[hash];
        }
      });
    },
  };
};

export type WithdrawalProposalJournal = ReturnType<typeof createWithdrawalProposalJournal>;

export const withdrawalProposalJournal = createWithdrawalProposalJournal();
