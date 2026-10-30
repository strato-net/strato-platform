import { JsonRpcProvider, Network, toQuantity } from "ethers";
import {
  normalizeCallTracerResult,
  normalizeParityTraces,
  receiptFingerprint,
  traceFingerprint,
} from "../utils/rpcEvidence";

const canonical = (value: any): string => JSON.stringify(value, (_key, item) => {
  if (typeof item === "string" && item.startsWith("0x")) return item.toLowerCase();
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
});

const blockFingerprint = (block: any): string => canonical({
  hash: block.hash,
  number: block.number,
  parentHash: block.parentHash,
  timestamp: block.timestamp,
});

export const validateVerifierRpcUrls = (urls: string[]): void => {
  const parsed = urls.map((url) => new URL(url));
  if (parsed.some((url) => url.protocol !== "https:" || url.username || url.password)) {
    throw new Error("Verifier RPC endpoints must use HTTPS without embedded credentials");
  }
  if (new Set(parsed.map((url) => url.hostname)).size < 2) {
    throw new Error("Verifier requires at least two distinct RPC hosts");
  }
};

// Every external read must agree; an outage or disagreement prevents signing.
export class ConsensusProvider extends JsonRpcProvider {
  private readonly peers: JsonRpcProvider[];

  constructor(urls: string[]) {
    validateVerifierRpcUrls(urls);
    super(urls[0], undefined, { cacheTimeout: -1 });
    this.peers = urls.map((url) => new JsonRpcProvider(url, undefined, { cacheTimeout: -1 }));
  }

  async _detectNetwork(): Promise<Network> {
    return Network.from(BigInt(await this.send("eth_chainId", [])));
  }

  async getFinalizedBlockNumber(): Promise<number> {
    const finalized = await Promise.all(this.peers.map(async (peer) => {
      const [block, latest] = await Promise.all([
        peer.send("eth_getBlockByNumber", ["finalized", false]),
        peer.send("eth_blockNumber", []),
      ]);
      if (!block || !/^0x[0-9a-f]+$/i.test(block.number || "") ||
          !/^0x[0-9a-f]{64}$/i.test(block.hash || "") ||
          !/^0x[0-9a-f]+$/i.test(latest || "")) {
        throw new Error("Verifier RPC finalized block is unavailable");
      }
      const number = Number(BigInt(block.number));
      if (!Number.isSafeInteger(number) || BigInt(block.number) > BigInt(latest)) {
        throw new Error("Verifier RPC finalized block is invalid");
      }
      const canonical = await peer.send("eth_getBlockByNumber", [
        toQuantity(number),
        false,
      ]);
      if (!canonical || !/^0x[0-9a-f]+$/i.test(canonical.number || "") ||
          BigInt(canonical.number) !== BigInt(number) ||
          String(canonical.hash || "").toLowerCase() !== block.hash.toLowerCase()) {
        throw new Error("Verifier RPC finalized block is not canonical");
      }
      return number;
    }));
    const commonNumber = Math.min(...finalized);
    const commonBlocks = await Promise.all(this.peers.map((peer) =>
      peer.send("eth_getBlockByNumber", [toQuantity(commonNumber), false])
    ));
    if (commonBlocks.some((block) => !block ||
        BigInt(block.number || "-1") !== BigInt(commonNumber) ||
        !/^0x[0-9a-f]{64}$/i.test(block.hash || ""))) {
      throw new Error("Verifier RPC finalized checkpoint is unavailable");
    }
    const fingerprint = blockFingerprint(commonBlocks[0]);
    if (commonBlocks.some((block) => blockFingerprint(block) !== fingerprint)) {
      throw new Error("Verifier RPC disagreement: finalized checkpoint");
    }
    return commonNumber;
  }

  async assertCanonicalBlock(blockNumber: number, expectedHash: string): Promise<void> {
    const block = await this.send("eth_getBlockByNumber", [toQuantity(blockNumber), false]);
    if (!block || BigInt(block.number || "-1") !== BigInt(blockNumber) ||
        String(block.hash || "").toLowerCase() !== expectedHash.toLowerCase()) {
      throw new Error("Receipt block is not canonical");
    }
  }

  async send(method: string, params: Array<any> | Record<string, any>): Promise<any> {
    if (!method.startsWith("eth_get") && !["eth_chainId", "eth_blockNumber", "eth_call", "trace_transaction"].includes(method)) {
      throw new Error(`Unsupported verifier RPC method: ${method}`);
    }
    if (Array.isArray(params) && ((method === "eth_getBlockByNumber" && params[0] === "latest") ||
        (method === "eth_call" && params[1] === "latest"))) {
      const head = await this.send("eth_blockNumber", []);
      params = [...params];
      params[method === "eth_call" ? 1 : 0] = head;
    }
    const results = await Promise.all(this.peers.map(async (peer) => {
      if (method !== "trace_transaction" || !Array.isArray(params)) {
        return peer.send(method, params);
      }
      try {
        return normalizeParityTraces(await peer.send(method, params));
      } catch (traceError) {
        try {
          return normalizeCallTracerResult(await peer.send(
            "debug_traceTransaction",
            [params[0], { tracer: "callTracer" }],
          ));
        } catch {
          throw traceError;
        }
      }
    }));
    // Use the slowest head for confirmation counts; receipts and block hashes still require agreement.
    if (method === "eth_blockNumber") {
      return `0x${results.map(BigInt).reduce((a, b) => a < b ? a : b).toString(16)}`;
    }
    const fingerprint = (result: any) => result == null ? "null" :
      method === "eth_getTransactionReceipt" ? receiptFingerprint(result) :
      method === "trace_transaction" ? traceFingerprint(result) :
      method === "eth_getBlockByNumber" ? blockFingerprint(result) : canonical(result);
    if (results.some((result) => fingerprint(result) !== fingerprint(results[0]))) {
      throw new Error(`Verifier RPC disagreement: ${method}`);
    }
    return results[0];
  }

  destroy(): void {
    for (const peer of this.peers) peer.destroy();
    super.destroy();
  }
}
