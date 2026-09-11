import { JsonRpcProvider, Network } from "ethers";
import { receiptFingerprint, traceFingerprint } from "../utils/rpcEvidence";

const canonical = (value: any): string => JSON.stringify(value, (_key, item) => {
  if (typeof item === "string" && item.startsWith("0x")) return item.toLowerCase();
  if (item && typeof item === "object" && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
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
    const results = await Promise.all(this.peers.map((peer) => peer.send(method, params)));
    // Use the slowest head for confirmation counts; receipts and block hashes still require agreement.
    if (method === "eth_blockNumber") {
      return `0x${results.map(BigInt).reduce((a, b) => a < b ? a : b).toString(16)}`;
    }
    const fingerprint = (result: any) => result == null ? "null" :
      method === "eth_getTransactionReceipt" ? receiptFingerprint(result) :
      method === "trace_transaction" ? traceFingerprint(result) : canonical(result);
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
