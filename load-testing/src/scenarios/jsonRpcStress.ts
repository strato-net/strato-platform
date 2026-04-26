import axios, { AxiosInstance } from "axios";
import { BaseScenario } from "./base";
import { NodeClients } from "../api/client";
import { runForDuration } from "../concurrency";
import { OAuthClient } from "../auth/oauth";
import { ScenarioResult, TxMetric, JsonRpcMethodSpec } from "../types";

/**
 * Default method rotation. STRATO's JSON-RPC layer only implements a subset of
 * the Ethereum spec — we purposely avoid eth_getLogs / eth_getTransactionReceipt
 * which are documented as not yet implemented in
 *   strato/api/ethereum-jsonrpc/src/Commands.hs
 */
const DEFAULT_METHODS: JsonRpcMethodSpec[] = [
  { method: "eth_blockNumber", weight: 4 },
  { method: "eth_chainId", weight: 2 },
  { method: "eth_gasPrice", weight: 1 },
  { method: "net_version", weight: 1 },
  { method: "eth_getBalance", weight: 3 },
  { method: "eth_getTransactionCount", weight: 2 },
  { method: "eth_getCode", weight: 2 },
  { method: "web3_sha3", weight: 1 },
];

const FALLBACK_ADDRESS = "0x0000000000000000000000000000000000000000";
const FALLBACK_HEX_PAYLOAD = "0x68656c6c6f"; // "hello"

function buildDefaultParams(method: string, iteration: number): any[] {
  switch (method) {
    case "eth_getBalance":
    case "eth_getTransactionCount":
    case "eth_getCode":
      return [FALLBACK_ADDRESS, "latest"];
    case "eth_getStorageAt":
      return [FALLBACK_ADDRESS, "0x0", "latest"];
    case "eth_call":
      return [{ to: FALLBACK_ADDRESS, data: "0x" }, "latest"];
    case "web3_sha3":
      return [FALLBACK_HEX_PAYLOAD];
    case "eth_getBlockByNumber":
      return ["latest", false];
    default:
      return [];
  }
}

function pickWeighted(methods: JsonRpcMethodSpec[]): JsonRpcMethodSpec {
  const total = methods.reduce((s, m) => s + (m.weight ?? 1), 0);
  let roll = Math.random() * total;
  for (const m of methods) {
    roll -= m.weight ?? 1;
    if (roll <= 0) return m;
  }
  return methods[methods.length - 1];
}

export class JsonRpcStressScenario extends BaseScenario {
  name(): string {
    return "jsonRpcStress";
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.jsonRpcStress;
    const methods: JsonRpcMethodSpec[] =
      cfg.methods && cfg.methods.length > 0 ? cfg.methods : DEFAULT_METHODS;

    // Optional bearer token (default RPC route in mercata requires auth)
    let oauth: OAuthClient | null = null;
    if (cfg.authenticated !== false) {
      const node = this.config.nodes[0];
      oauth = new OAuthClient(node.auth);
      await oauth.init();
      // Prime token cache
      await oauth.getToken();
    }

    const http: AxiosInstance = axios.create({
      baseURL: cfg.rpcUrl,
      timeout: 60000,
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/json",
      },
    });

    console.log(
      `[jsonRpcStress] ${cfg.concurrentUsers} users x ${cfg.durationMs}ms -> ${cfg.rpcUrl}`,
    );

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];
    let sequence = 0;

    const runStart = Date.now();
    await runForDuration(
      cfg.concurrentUsers,
      cfg.durationMs,
      async (userId, iteration) => {
        const spec = pickWeighted(methods);
        const params = spec.params ?? buildDefaultParams(spec.method, iteration);
        const body = {
          jsonrpc: "2.0",
          id: sequence++,
          method: spec.method,
          params,
        };

        const headers: Record<string, string> = {};
        if (oauth) {
          try {
            headers["Authorization"] = `Bearer ${await oauth.getToken()}`;
          } catch (err: any) {
            this.log(`user ${userId} token fetch failed: ${err.message}`);
          }
        }

        const submitTime = Date.now();
        let status = 0;
        let durationMs = 0;
        let error: string | undefined;
        let success = false;

        try {
          const res = await http.post("", body, { headers });
          durationMs = Date.now() - submitTime;
          status = res.status;
          const rpcBody = res.data;
          if (res.status >= 200 && res.status < 300 && rpcBody?.result !== undefined) {
            success = true;
          } else {
            error =
              rpcBody?.error?.message ||
              rpcBody?.error ||
              (typeof rpcBody === "string" ? rpcBody.substring(0, 200) : `HTTP ${res.status}`);
          }
        } catch (err: any) {
          durationMs = Date.now() - submitTime;
          error = err.message || String(err);
        }

        const metric: TxMetric = {
          txHash: `rpc:${spec.method}:${userId}:${iteration}`,
          nodeName,
          scenario: `${scenario}:${spec.method}`,
          batchIndex: userId,
          submitTime,
          submitDuration: durationMs,
          confirmTime: submitTime + durationMs,
          confirmDuration: 0,
          totalDuration: durationMs,
          status: success ? "confirmed" : "failed",
          error,
        };
        this.collector.recordTx(metric);
        txMetrics.push(metric);

        if (cfg.thinkTimeMs && cfg.thinkTimeMs > 0) {
          await new Promise((r) => setTimeout(r, cfg.thinkTimeMs));
        }
      },
    );
    const runEnd = Date.now();

    const success = txMetrics.filter((m) => m.status === "confirmed").length;
    const failed = txMetrics.filter((m) => m.status === "failed").length;
    const elapsedSec = (runEnd - runStart) / 1000;
    const actualRps = txMetrics.length / Math.max(elapsedSec, 0.001);

    console.log(
      `[jsonRpcStress] Done. ${success} ok, ${failed} failed over ${elapsedSec.toFixed(2)}s ` +
        `— ${actualRps.toFixed(2)} RPS`,
    );

    return {
      scenario,
      nodeName,
      transactions: txMetrics,
      batches: [],
    };
  }
}