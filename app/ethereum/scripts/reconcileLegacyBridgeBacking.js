const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config();
const { reconcileBacking } = require("./lib/legacyBridgeBacking");
const { collectBackingEvidence } = require("./lib/legacyBridgeBackingEvidence");

function parseArgs(argv) {
  if (argv.includes("--execute")) throw new Error("--execute is not supported; reconciliation is read-only");
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!["--input", "--output"].includes(key)) throw new Error(`Unknown argument ${key}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${key} requires a value`);
    values[key] = value;
  }
  if (!values["--input"]) throw new Error("--input is required");
  if (!values["--output"]) throw new Error("--output is required");
  return { input: path.resolve(values["--input"]), output: path.resolve(values["--output"]) };
}

const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  }
  return value;
};
const sha256 = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const exitCodeFor = status => status === "PASSED" ? 0 : status === "REVIEW_REQUIRED" ? 2 : 1;

async function requireNewOutput(filePath) {
  try {
    await fs.access(filePath);
    throw new Error(`Output already exists: ${filePath}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writeNewJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(stable(value), null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function runReconciliation(args, env = process.env, deps = {}) {
  const raw = await fs.readFile(args.input, "utf8");
  const input = JSON.parse(raw);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Reconciliation input must be a JSON object");
  }
  await requireNewOutput(args.output);
  const evidence = await (deps.collectEvidence || collectBackingEvidence)(input, env, deps);
  const reconciliation = reconcileBacking({
    deposits: evidence.deposits,
    withdrawals: evidence.withdrawals,
    balances: evidence.balances,
    violations: evidence.violations,
  });
  const report = {
    schemaVersion: 1,
    generatedAt: (deps.now?.() || new Date()).toISOString(),
    inputSha256: sha256(raw),
    status: reconciliation.status,
    strato: {
      networkId: evidence.stratoNetworkId,
      reviewedCutoffBlock: input.stratoCutoffBlock,
      observedBlock: evidence.stratoObservedBlock,
      mercataBridge: input.mercataBridge.toLowerCase(),
    },
    summary: {
      chainsChecked: evidence.chains.length,
      routesChecked: reconciliation.routes.length,
      completedDeposits: evidence.deposits.length,
      completedWithdrawals: evidence.withdrawals.length,
      openDeposits: evidence.openDeposits.length,
      openWithdrawals: evidence.openWithdrawals.length,
      violations: reconciliation.violations.length,
    },
    chains: evidence.chains.map(chain => ({
      ...chain,
      reviewedCutoffBlock: input.chains[chain.chainId].cutoffBlock,
      confirmations: input.chains[chain.chainId].confirmations,
      safeTransactionServiceUrl: input.chains[chain.chainId].safeTransactionServiceUrl,
    })),
    routes: reconciliation.routes,
    custodyBalanceEvidence: evidence.balances,
    completedDepositEvidence: evidence.deposits,
    completedWithdrawalEvidence: evidence.withdrawals,
    openDeposits: evidence.openDeposits,
    openWithdrawals: evidence.openWithdrawals,
    persistentState: evidence.sources,
    violations: reconciliation.violations,
  };
  await writeNewJson(args.output, report);
  return report;
}

async function main(argv) {
  const args = parseArgs(argv);
  const report = await runReconciliation(args);
  console.log(JSON.stringify({
    status: report.status,
    output: args.output,
    chains: report.summary.chainsChecked,
    routes: report.summary.routesChecked,
    violations: report.summary.violations,
  }));
  process.exitCode = exitCodeFor(report.status);
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

module.exports = { exitCodeFor, parseArgs, runReconciliation };
