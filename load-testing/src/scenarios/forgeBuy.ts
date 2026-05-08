import { NodeClients } from "../api/client";
import { runRateLimited } from "../concurrency";
import {
  ScenarioResult,
  TxMetric,
  ForgeBuyScenarioConfig,
  BalanceLoggingMode,
} from "../types";
import {
  takeUserBalanceSnapshot,
  takeForgeBalanceSnapshot,
  sumUserSnapshots,
  formatSnapshot,
  formatDiff,
  SnapshotTargets,
  BalanceSnapshot,
} from "../api/balanceSnapshot";
import { AppScenario } from "./appScenario";

/**
 * Scenario 2 — Forge Buy.
 *
 * Replays the simpler "user already holds USDST on STRATO; clicks Buy Gold"
 * flow. Per iteration:
 *
 *   POST /api/metal-forge/buy
 *     { metalToken, payToken, payAmount, minMetalOut }
 *
 * The backend submits MetalForge.mintMetal(metalToken, payToken, payAmount,
 * minMetalOut) on STRATO, which transfers `payAmount` of `payToken` (USDST)
 * from the calling user and mints `metalToken` (GOLDST) to them in a single
 * tx. No Sepolia, no bridge service, no asynchronous wait — the on-STRATO
 * tx hash is in the response body the moment the POST returns.
 *
 * Page-load warmup (when `includePageLoad: true`):
 *   - GET /api/metal-forge/configs  (forge rate + metal addresses)
 *   - GET /api/tokens/balance       (calling user's USDST balance)
 *
 * Each test user must hold sufficient USDST + voucher gas headroom to cover
 * the on-STRATO tx fee for every iteration they're scheduled to drive.
 */
export class ForgeBuyScenario extends AppScenario {
  private static readonly LABEL = "forgeBuy";
  private static readonly PAGE_LOAD_STEPS: ReadonlyArray<{
    name: string;
    path: string;
  }> = [
    { name: "metalForgeConfigs", path: "/api/metal-forge/configs" },
    { name: "tokensBalance", path: "/api/tokens/balance" },
  ];

  name(): string {
    return ForgeBuyScenario.LABEL;
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.forgeBuy;
    const node = this.config.nodes[0];

    // ---- Required-field validation ----
    if (!cfg.metalTokenAddress) {
      throw new Error(
        "forgeBuy: metalTokenAddress is required (the GOLDST address on STRATO).",
      );
    }
    if (!cfg.payTokenAddress) {
      throw new Error(
        "forgeBuy: payTokenAddress is required (the USDST address on STRATO).",
      );
    }
    if (!cfg.payAmount) {
      throw new Error(
        "forgeBuy: payAmount is required (per-iteration USDST spend in 18-decimal wei).",
      );
    }

    await this.initClientPool(
      cfg,
      { backendUrl: node.url, auth: node.auth },
      ForgeBuyScenario.LABEL,
    );

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];

    // ---- Optional page-load warmup per user ----
    if (cfg.includePageLoad) {
      await this.runPageWarmup({
        steps: ForgeBuyScenario.PAGE_LOAD_STEPS.map((s) => ({ ...s })),
        scenarioLabel: ForgeBuyScenario.LABEL,
        txMetrics,
        nodeName,
      });
    }

    // ---- Balance-snapshot configuration ----
    const logBalances: BalanceLoggingMode = cfg.logBalances ?? "none";
    const snapshotTargets: SnapshotTargets = {
      payTokenAddress: cfg.payTokenAddress,
      metalTokenAddress: cfg.metalTokenAddress,
      metalForgeAddress:
        cfg.metalForgeAddress ?? "c5ed981b816a626981a5747d125e0e7296b2c7c6",
    };
    const snapshotsEnabled = logBalances !== "none";

    const progressStep = Math.max(1, Math.ceil(cfg.totalTxCount / 20));
    const shouldLogProgress = (i: number) =>
      this.verbose || i % progressStep === 0 || i === cfg.totalTxCount - 1;

    // ---- Pre-run snapshots (one per unique Keycloak user + one shared
    // forge snapshot). Auth-filtered routes return only the calling user's
    // balances, so per-user accuracy requires N user snapshots; the forge
    // state (MetalForge holdings, totalMinted) is global so we read it once.
    const uniqueUsers = this.getUniqueUsers();
    const preUserSnaps: Map<string, BalanceSnapshot> = new Map();
    let preForgeSnap: BalanceSnapshot | null = null;
    if (snapshotsEnabled && uniqueUsers.length > 0) {
      try {
        const [forgeSnap, ...userSnaps] = await Promise.all([
          takeForgeBalanceSnapshot(uniqueUsers[0].client, snapshotTargets),
          ...uniqueUsers.map(({ client }) =>
            takeUserBalanceSnapshot(client, snapshotTargets),
          ),
        ]);
        preForgeSnap = forgeSnap;
        for (let i = 0; i < uniqueUsers.length; i++) {
          preUserSnaps.set(uniqueUsers[i].username, userSnaps[i]);
          console.log(
            `[forgeBuy] ${formatSnapshot(`pre-run [${uniqueUsers[i].username}]`, userSnaps[i])}`,
          );
        }
        console.log(`[forgeBuy] ${formatSnapshot("pre-run [forge/global]", preForgeSnap)}`);
      } catch (err: any) {
        console.warn(`[forgeBuy] pre-run snapshot failed: ${err.message}`);
      }
    }

    const buyBody = {
      metalToken: cfg.metalTokenAddress,
      payToken: cfg.payTokenAddress,
      payAmount: cfg.payAmount,
      minMetalOut: cfg.minMetalOut ?? "0",
    };

    console.log(
      `[forgeBuy] ${cfg.totalTxCount} buys across ${cfg.concurrentUsers} users ` +
        `over ${cfg.timeWindowMs}ms -> ${node.url} (network=${cfg.networkLabel ?? "?"}); ` +
        `payToken=${buyBody.payToken} metalToken=${buyBody.metalToken} ` +
        `payAmount=${buyBody.payAmount} minMetalOut=${buyBody.minMetalOut}`,
    );

    // ---- Per-iteration loop: each worker POSTs /api/metal-forge/buy. ----
    const runStart = Date.now();
    await runRateLimited(
      cfg.totalTxCount,
      cfg.timeWindowMs,
      cfg.concurrentUsers,
      async (i: number) => {
        const client = this.backendClients[i % this.backendClients.length];

        const submitTime = Date.now();
        const res = await this.postWithRetry({
          client,
          path: "/api/metal-forge/buy",
          body: buyBody,
          legName: "buyMetal",
          iterationIdx: i,
          maxRetries: cfg.requestRetries ?? 3,
          scenarioLabel: ForgeBuyScenario.LABEL,
        });
        const data = res.data ?? {};
        const reported = data?.data?.status ?? data?.status;
        const hash = data?.data?.hash ?? data?.hash ?? `buyMetal:${i}`;
        const buyOk =
          res.status >= 200 &&
          res.status < 300 &&
          (reported === undefined || reported === "success" || reported === "Success");
        if (!buyOk) {
          console.warn(
            `[forgeBuy] buyMetal #${i} FAILED: httpStatus=${res.status} ` +
              `respErr=${res.error ?? "?"} ` +
              `body=${typeof res.data === "string" ? res.data.slice(0, 400) : JSON.stringify(res.data).slice(0, 400)}`,
          );
        } else if (shouldLogProgress(i)) {
          console.log(
            `[forgeBuy] buyMetal #${i} ok ${res.durationMs}ms hash=${String(hash).substring(0, 18)}`,
          );
        }
        this.recordRequestMetric({
          txMetrics,
          nodeName,
          scenario: `${scenario}:buyMetal`,
          userId: i,
          submitTime,
          res,
          success: buyOk,
          hashOverride: hash,
        });
      },
    );
    const runEnd = Date.now();

    // ---- Post-run snapshots (per-user + shared forge), per-user deltas,
    // and a pool-wide aggregate of buyer.* fields. ----
    if (snapshotsEnabled && uniqueUsers.length > 0) {
      try {
        const [postForgeSnap, ...postUserSnapsArr] = await Promise.all([
          takeForgeBalanceSnapshot(uniqueUsers[0].client, snapshotTargets),
          ...uniqueUsers.map(({ client }) =>
            takeUserBalanceSnapshot(client, snapshotTargets),
          ),
        ]);
        // Per-user deltas
        const preUserList: BalanceSnapshot[] = [];
        const postUserList: BalanceSnapshot[] = [];
        for (let i = 0; i < uniqueUsers.length; i++) {
          const username = uniqueUsers[i].username;
          const post = postUserSnapsArr[i];
          const pre = preUserSnaps.get(username);
          console.log(
            `[forgeBuy] ${formatSnapshot(`post-run [${username}]`, post)}`,
          );
          if (pre) {
            console.log(`[forgeBuy] ${username} ${formatDiff(pre, post)}`);
            preUserList.push(pre);
            postUserList.push(post);
          }
        }
        // Forge / global delta
        console.log(`[forgeBuy] ${formatSnapshot("post-run [forge/global]", postForgeSnap)}`);
        if (preForgeSnap) {
          console.log(`[forgeBuy] forge ${formatDiff(preForgeSnap, postForgeSnap)}`);
        }
        // Pool-wide aggregate of buyer.* fields (only meaningful if we have
        // N>1 users; for N=1 it's identical to that user's delta line).
        if (uniqueUsers.length > 1 && preUserList.length === postUserList.length) {
          const preAgg: BalanceSnapshot = {
            ts: 0,
            ...sumUserSnapshots(preUserList),
            errors: [],
          };
          const postAgg: BalanceSnapshot = {
            ts: 0,
            ...sumUserSnapshots(postUserList),
            errors: [],
          };
          console.log(
            `[forgeBuy] pool-aggregate (${uniqueUsers.length} users) ${formatDiff(preAgg, postAgg)}`,
          );
        }
      } catch (err: any) {
        console.warn(`[forgeBuy] post-run snapshot failed: ${err.message}`);
      }
    }

    // ---- Aggregate sale-level stats (callsPerSale = 1) ----
    const elapsedSec = (runEnd - runStart) / 1000;
    const coreMetrics = txMetrics.filter(
      (m) => m.scenario === `${scenario}:buyMetal`,
    );
    const confirmed = coreMetrics.filter((m) => m.status === "confirmed").length;
    const failed = coreMetrics.filter((m) => m.status === "failed").length;
    const tps = coreMetrics.length / Math.max(elapsedSec, 0.001);

    console.log(
      `[forgeBuy] Done. ${confirmed} confirmed, ${failed} failed in ` +
        `${elapsedSec.toFixed(2)}s — ${tps.toFixed(2)} buys/s`,
    );

    return {
      scenario,
      nodeName,
      transactions: txMetrics,
      batches: [],
    };
  }
}
