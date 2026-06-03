import { NodeClients } from "../api/client";
import { ScenarioResult, TxMetric } from "../types";
import { AppScenario } from "./appScenario";

/**
 * Scenario 3 — Page Load (warmup-only).
 *
 * Runs a configurable list of authenticated GETs once per virtual user, in
 * parallel across users. There is no POST phase, no balance snapshotting,
 * and no chain activity. The pool is built exactly like the forgeBuy /
 * tokenSale scenarios so the Keycloak grant and page-GET behaviour matches
 * what those scenarios do during their warmup leg — but in isolation, so
 * the metrics + reports reflect the page-load path without interference
 * from any subsequent transaction phase.
 *
 * The default `steps` list mirrors the forgeBuy page-load (configs + tokens
 * balance); override `scenarios.pageLoad.steps` in YAML to drive any other
 * page's GETs.
 */
export class PageLoadScenario extends AppScenario {
  private static readonly LABEL = "pageLoad";

  name(): string {
    return PageLoadScenario.LABEL;
  }

  async run(clients: NodeClients): Promise<ScenarioResult> {
    const cfg = this.config.scenarios.pageLoad;
    const node = this.config.nodes[0];

    const steps = cfg.steps && cfg.steps.length > 0 ? cfg.steps : [];
    if (steps.length === 0) {
      throw new Error(
        "pageLoad: at least one step must be configured (scenarios.pageLoad.steps).",
      );
    }

    await this.initClientPool(
      cfg,
      { backendUrl: node.url, auth: node.auth },
      PageLoadScenario.LABEL,
    );

    const nodeName = clients.nodeName;
    const scenario = this.name();
    const txMetrics: TxMetric[] = [];

    console.log(
      `[pageLoad] ${cfg.concurrentUsers} users × ${steps.length} GET(s) -> ${node.url} ` +
        `(network=${cfg.networkLabel ?? "?"}); steps=${steps.map((s) => s.path).join(", ")}`,
    );

    const runStart = Date.now();
    await this.runPageWarmup({
      steps: steps.map((s) => ({ ...s })),
      scenarioLabel: PageLoadScenario.LABEL,
      txMetrics,
      nodeName,
    });
    const runEnd = Date.now();

    const elapsedSec = (runEnd - runStart) / 1000;
    const confirmed = txMetrics.filter((m) => m.status === "confirmed").length;
    const failed = txMetrics.filter((m) => m.status === "failed").length;
    const rps = txMetrics.length / Math.max(elapsedSec, 0.001);

    console.log(
      `[pageLoad] Done. ${confirmed} ok, ${failed} failed in ` +
        `${elapsedSec.toFixed(2)}s — ${rps.toFixed(2)} req/s`,
    );

    return {
      scenario,
      nodeName,
      transactions: txMetrics,
      batches: [],
    };
  }
}
