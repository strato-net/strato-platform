import { Command } from "commander";
import { loadConfig, applyCliOverrides } from "./config";
import { createNodeClients, NodeClients } from "./api/client";
import { MetricsCollector } from "./metrics/collector";
import { computeScenarioStats, computeTimeline } from "./metrics/stats";
import { writeJsonReport } from "./report/jsonReport";
import { writeHtmlReport } from "./report/htmlReport";
import { ContractDeployScenario } from "./scenarios/contractDeploy";
import { FunctionCallScenario } from "./scenarios/functionCall";
import { MixedWorkloadScenario } from "./scenarios/mixedWorkload";
import { TokenSaleScenario } from "./scenarios/tokenSale";
import { ForgeBuyScenario } from "./scenarios/forgeBuy";
import { BaseScenario } from "./scenarios/base";
import { LoadTestConfig, LoadTestReport, ScenarioResult } from "./types";

const program = new Command();

program
  .name("strato-load-test")
  .description("STRATO blockchain load testing framework")
  .option("-c, --config <path>", "Path to config YAML file", "config.yaml")
  .option(
    "-s, --scenario <name>",
    "Run a specific scenario: contractDeploy | functionCall | mixedWorkload | tokenSale | forgeBuy",
  )
  .option("--batch-size <n>", "Override batch size (low-level scenarios)", parseInt)
  .option("--batch-count <n>", "Override batch count (low-level scenarios)", parseInt)
  .option("--concurrent-users <n>", "Override concurrent users (tokenSale, forgeBuy)", parseInt)
  .option("--total-tx <n>", "Override totalTxCount (tokenSale, forgeBuy)", parseInt)
  .option("--time-window <ms>", "Override timeWindowMs (tokenSale, forgeBuy)", parseInt)
  .option("--backend-url <url>", "Override backend URL (tokenSale, forgeBuy)")
  .option("--nodes <names>", "Comma-separated node names to target", (v) => v.split(","))
  .option("--report-dir <path>", "Output directory for reports")
  .option("--submit-mode <mode>", "Submit mode: sequential (default) or pipeline")
  .option("-v, --verbose", "Enable verbose logging", false);

async function runScenarioOnNodes(
  scenario: BaseScenario,
  nodeClientsList: NodeClients[],
  multiNode: boolean,
): Promise<ScenarioResult[]> {
  if (multiNode && nodeClientsList.length > 1) {
    // Run against all nodes in parallel
    return Promise.all(nodeClientsList.map((clients) => scenario.run(clients)));
  } else {
    // Run against first node only
    return [await scenario.run(nodeClientsList[0])];
  }
}

async function main(): Promise<void> {
  program.parse();
  const opts = program.opts();

  // Load and apply config
  let config: LoadTestConfig;
  try {
    config = loadConfig(opts.config);
    config = applyCliOverrides(config, {
      batchSize: opts.batchSize,
      batchCount: opts.batchCount,
      scenario: opts.scenario,
      nodes: opts.nodes,
      reportDir: opts.reportDir,
      submitMode: opts.submitMode,
      concurrentUsers: opts.concurrentUsers,
      totalTx: opts.totalTx,
      timeWindow: opts.timeWindow,
      backendUrl: opts.backendUrl,
    });
  } catch (err: any) {
    console.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }

  console.log("=== STRATO Load Test ===");
  console.log(`Nodes: ${config.nodes.map((n) => n.name).join(", ")}`);
  console.log(`Gas: limit=${config.gas.limit}, price=${config.gas.price}`);
  console.log(`Polling: interval=${config.polling.interval}ms, timeout=${config.polling.timeout}ms`);
  console.log();

  // Initialize node clients
  console.log("Authenticating with nodes...");
  let nodeClientsList: NodeClients[];
  try {
    nodeClientsList = await Promise.all(config.nodes.map(createNodeClients));
    console.log(`Authenticated with ${nodeClientsList.length} node(s)`);
  } catch (err: any) {
    console.error(`Authentication failed: ${err.message}`);
    process.exit(1);
  }
  console.log();

  const collector = new MetricsCollector();
  const allResults: ScenarioResult[] = [];
  const multiNode = config.scenarios.multiNode.enabled;

  // Build scenario list
  const scenarios: BaseScenario[] = [];
  if (config.scenarios.contractDeploy.enabled) {
    scenarios.push(new ContractDeployScenario(config, collector, opts.verbose));
  }
  if (config.scenarios.functionCall.enabled) {
    scenarios.push(new FunctionCallScenario(config, collector, opts.verbose));
  }
  if (config.scenarios.mixedWorkload.enabled) {
    scenarios.push(new MixedWorkloadScenario(config, collector, opts.verbose));
  }
  if (config.scenarios.tokenSale.enabled) {
    scenarios.push(new TokenSaleScenario(config, collector, opts.verbose));
  }
  if (config.scenarios.forgeBuy.enabled) {
    scenarios.push(new ForgeBuyScenario(config, collector, opts.verbose));
  }

  if (scenarios.length === 0) {
    console.log("No scenarios enabled. Enable at least one scenario in config or use --scenario.");
    process.exit(0);
  }

  // Run scenarios sequentially (each may run across nodes in parallel)
  for (const scenario of scenarios) {
    console.log(`--- Running scenario: ${scenario.name()} ---`);
    try {
      const results = await runScenarioOnNodes(scenario, nodeClientsList, multiNode);
      allResults.push(...results);
    } catch (err: any) {
      console.error(`Scenario ${scenario.name()} failed: ${err.message}`);
      if (opts.verbose) console.error(err.stack);
    }
    console.log();
  }

  // Compute stats. Enumerate (scenario, node) pairs from the recorded TxMetrics
  // themselves — scenarios may emit per-leg sub-scopes (e.g.
  // "tokenSale:bridgeRequest", "tokenSale:sepoliaDeposit") which are NOT the
  // same string as the parent ScenarioResult.scenario. Filtering by the
  // parent name alone would yield 0 hits and a blank summary table.
  const allTxMetrics = collector.getAllTxMetrics();
  const scenarioNodePairs = new Set<string>();
  for (const m of allTxMetrics) {
    scenarioNodePairs.add(`${m.scenario}::${m.nodeName}`);
  }
  // Keep parent-scope names too, even if they had no direct metrics, so they
  // appear (with zeros) in the summary for empty scenarios.
  for (const r of allResults) {
    scenarioNodePairs.add(`${r.scenario}::${r.nodeName}`);
  }

  const scenarioStats = Array.from(scenarioNodePairs)
    .map((key) => {
      const [scenario, nodeName] = key.split("::");
      return computeScenarioStats(
        collector.getAllTxMetrics(),
        collector.getAllBatchMetrics(),
        scenario,
        nodeName,
      );
    })
    // Drop empty rows — when a scenario only emits per-leg sub-scopes (e.g.
    // tokenSale -> tokenSale:bridgeRequest), the parent name itself has 0
    // metrics and would otherwise show as a misleading "0/0 succeeded" row.
    .filter((s) => s.totalTxCount > 0);

  const timeline = computeTimeline(collector.getAllTxMetrics());

  // Build report
  const report: LoadTestReport = {
    timestamp: new Date().toISOString(),
    config: {
      nodes: config.nodes.map((n) => n.name),
      gas: config.gas,
      polling: config.polling,
    },
    scenarioStats,
    timeline,
    transactions: collector.getAllTxMetrics(),
    batches: collector.getAllBatchMetrics(),
    errors: collector.getErrors(),
  };

  // Write reports
  console.log("=== Generating Reports ===");
  if (config.report.formats.includes("json")) {
    writeJsonReport(report, config.report.outputDir);
  }
  if (config.report.formats.includes("html")) {
    writeHtmlReport(report, config.report.outputDir);
  }

  // Print summary
  console.log();
  console.log("=== Summary ===");
  for (const s of scenarioStats) {
    console.log(`${s.scenario} [${s.nodeName}]:`);
    console.log(`  Transactions: ${s.successCount}/${s.totalTxCount} succeeded (${s.failureCount} failed, ${s.timeoutCount} timeout)`);
    console.log(`  Submit latency:  p50=${s.submitLatency.p50}ms  p95=${s.submitLatency.p95}ms  p99=${s.submitLatency.p99}ms`);
    console.log(`  Confirm latency: p50=${s.confirmLatency.p50}ms  p95=${s.confirmLatency.p95}ms  p99=${s.confirmLatency.p99}ms`);
    console.log(`  Total latency:   p50=${s.totalLatency.p50}ms  p95=${s.totalLatency.p95}ms  p99=${s.totalLatency.p99}ms`);
    console.log(`  TPS: submit=${s.submitTps}  confirmed=${s.confirmedTps}`);
    console.log(`  Wall clock: ${(s.wallClockDuration / 1000).toFixed(2)}s`);
  }

  if (report.errors.length > 0) {
    console.log(`\nTotal errors: ${report.errors.length}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
