import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type { ProposeTransactionProps } from "@safe-global/api-kit";
import { initializeSafeForChain } from "../utils/safeHelper";
import { config } from "../config";

const queues = new Map<string, Promise<unknown>>();

// Hold this queue until the signed proposal is durable and publication has finished.
export const withSafeProposalQueue = <T>(chainId: number, operation: string,
  work: (kits: Awaited<ReturnType<typeof initializeSafeForChain>>, saved?: ProposeTransactionProps) => Promise<T>): Promise<T> => {
  const safe = config.safe.address || "";
  const directory = path.join(process.cwd(), "data", "safe-proposals", `${chainId}-${safe.toLowerCase()}`);
  const previous = queues.get(directory) || Promise.resolve();
  const pending = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(directory, { recursive: true });
      // The runtime is a singleton; multi-runtime deployments require an external writer lock.
      const kits = await initializeSafeForChain(chainId, safe);
      const proposals: ProposeTransactionProps[] = [];
      let saved: ProposeTransactionProps | undefined;
      const validate = (proposal: ProposeTransactionProps) => {
        if (proposal?.safeAddress?.replace(/^0x/i, "").toLowerCase() !== safe.replace(/^0x/i, "").toLowerCase() ||
            !Number.isSafeInteger(proposal.safeTransactionData?.nonce) || proposal.safeTransactionData.nonce < 0 ||
            !/^0x[0-9a-f]{64}$/i.test(proposal.safeTxHash)) throw new Error("Invalid persisted Safe proposal; restore the journal before proposing");
        proposals.push(proposal);
      };
      for (const name of await fs.readdir(directory)) {
        if (!name.endsWith(".json")) continue;
        const entry = JSON.parse(await fs.readFile(path.join(directory, name), "utf8"));
        validate(entry.proposal);
        if (entry.operation === operation) saved = entry.proposal;
      }
      // Reserve pre-upgrade proposals even if Safe API indexing is behind.
      for (const folder of ["safe-reviews", "native-refunds"]) {
        const legacy = path.join(process.cwd(), "data", folder);
        let names: string[];
        try { names = await fs.readdir(legacy); } catch (error: any) { if (error.code === "ENOENT") continue; throw error; }
        for (const name of names) {
          if (!name.startsWith(`${chainId}-`) || !name.endsWith(".json")) continue;
          if (folder === "safe-reviews" && !name.startsWith(`${chainId}-${safe.toLowerCase()}-`)) continue;
          const entry = JSON.parse(await fs.readFile(path.join(legacy, name), "utf8"));
          validate(folder === "safe-reviews" ? entry.proposal : {
            safeAddress: safe, safeTransactionData: entry.data, safeTxHash: entry.hash,
            senderAddress: config.safe.safeProposerAddress!, senderSignature: entry.signature,
          });
        }
      }
      const getNextNonce = kits.apiKit.getNextNonce.bind(kits.apiKit);
      kits.apiKit.getNextNonce = async (address: string) => {
        const remote = Number(await getNextNonce(address));
        const current = Number(await kits.protocolKit.getNonce());
        if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(remote) || remote < 0) throw new Error("Invalid Safe nonce");
        const nonce = proposals.reduce((next, p) => Math.max(next, p.safeTransactionData.nonce + 1), Math.max(remote, current));
        if (!Number.isSafeInteger(nonce)) throw new Error("Invalid Safe nonce");
        return String(nonce);
      };
      const publish = kits.apiKit.proposeTransaction.bind(kits.apiKit);
      kits.apiKit.proposeTransaction = async proposal => {
        validate(proposal);
        const filename = path.join(directory, `${createHash("sha256").update(operation).digest("hex")}.json`);
        const temporary = `${filename}.${randomUUID()}.tmp`;
        const file = await fs.open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify({ operation, proposal })); await file.sync(); } finally { await file.close(); }
        await fs.rename(temporary, filename);
        const dir = await fs.open(directory, "r");
        try { await dir.sync(); } finally { await dir.close(); }
        return publish(proposal);
      };
      return await work(kits, saved);
  }).finally(() => { if (queues.get(directory) === pending) queues.delete(directory); });
  queues.set(directory, pending);
  return pending;
};
