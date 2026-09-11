const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  initializeManifest, loadManifest, generate, writeJson, readJson, digest,
  governanceProgress, currentCursorSettings, loadConfig,
} = require("../scripts/lib/externalBridgeOrchestration");
const { parseArgs, redact, vote, activate, inspect } = require("../scripts/externalBridgeRollout");

const addr = (digit) => `0x${digit.repeat(40)}`;
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eab-orchestration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const deployment = { chainId: "11155111", network: "sepolia", safeAddress: addr("1"),
    depositRouterDeploymentBlock: "1234", externalBridgeVault: { proxy: addr("2"), implementation: addr("a") },
    depositRouter: { proxy: addr("3"), implementation: addr("b") } };
  const settings = { bridgeTemplate: "dependencies.json", sourceChainId: "114784819836269", externalDeployment: "deployment.json", depositPlan: "discovery.json",
    tokenRouter: addr("4"), externalAssetBridge: addr("5"), bridgeOperator: addr("6"), guardian: addr("7"),
    settlementVerifiers: [addr("8"), addr("9"), addr("a")] };
  const discovery = { operations: [{ chainId: 11155111, transactions: [{ meta: { items: [{
    token: addr("b"), target: addr("c"), isPermitted: true, externalDecimals: "6", externalName: "Test", externalSymbol: "TEST", stratoTokenStatus: 2,
  }] } }] }] };
  writeJson(path.join(directory, "deployment.json"), deployment);
  writeJson(path.join(directory, "discovery.json"), discovery);
  writeJson(path.join(directory, "dependencies.json"), readJson(path.resolve(__dirname, "../../contracts/deploy/external-bridge.helium.example.json")));
  const settingsPath = path.join(directory, "settings.json");
  const manifestPath = path.join(directory, "manifest.json");
  writeJson(settingsPath, settings);
  const manifest = initializeManifest(settingsPath, undefined, manifestPath);
  manifest.services.nodeUrl = "https://test-node.example";
  for (const entry of Object.values(manifest.policy.mintPolicies)) { entry.capacity = "1000000000000000000000"; entry.refillRate = "1"; }
  manifest.policy.tokens[addr("b")] = { minDepositAmount: "1", maxPerWithdrawal: "100", manualReviewThreshold: "50",
    bucketCapacity: "1000", refillRate: "1", maxAutoWithdrawalAmount: "50", migrateAmount: "0", enabled: true };
  for (const route of Object.values(manifest.policy.routes)) { route.rebaseRequired = false; route.maxAutoDepositAmount = "100"; }
  writeJson(manifestPath, manifest);
  const context = loadManifest(manifestPath);
  const artifacts = generate(context, path.join(directory, "output"));
  const config = loadConfig(artifacts.bridgeConfigPath);
  const initialization = {
    tokenRouter: { initialized: false }, bridge: { initialized: false },
    settlementVerifiers: new Set(), approvedYieldVaults: new Set(),
  };
  const state = { initialization, routes: { mintPolicies: new Map(), chains: new Map(), routes: new Map(), rebaseRequired: new Set() },
    actions: { actionConfigs: new Map() }, permissionErrors: [`Missing bridge mint permission for STRATO token ${"c".repeat(40)}`] };
  return { directory, manifestPath, manifest, context, artifacts, config, state };
}

function initialized(f) {
  f.state.initialization.tokenRouter = { ...f.config.tokenRouter, initialized: true };
  f.state.initialization.bridge = { ...f.config.bridge, initialized: true, USDST_ADDRESS: f.config.bridge.usdst,
    priceOracle: f.config.bridge.priceOracle, tokenRouter: f.config.tokenRouter.address,
    settlementVerifierThreshold: "2", settlementVerifierCount: 3 };
  f.state.initialization.settlementVerifiers = new Set(f.config.bridge.settlementVerifiers);
  f.state.initialization.approvedYieldVaults = new Set(f.config.tokenRouter.yieldVaults);
}

test("init imports existing settings without overwriting and plan never emits activation", (t) => {
  const f = fixture(t);
  assert.throws(() => initializeManifest(path.join(f.directory, "settings.json"), undefined, f.manifestPath), /already exists/);
  assert.equal(readJson(f.artifacts.bridgeConfigPath).chains[0].routes[0].withdrawalsEnabled, false);
  assert.equal(fs.existsSync(path.join(f.artifacts.directory, "router-unpause.json")), false);
  assert.equal(f.artifacts.vaultConfigurePath, undefined);
  const repeat = generate(f.context, path.join(f.directory, "output"));
  assert.deepEqual(repeat.hashes, f.artifacts.hashes);
});

test("KMS addresses are generated from the manifest and survive repeated generation", (t) => {
  const f = fixture(t);
  f.manifest.authorizationSigners = [addr("d"), addr("e"), addr("f")];
  writeJson(f.manifestPath, f.manifest);
  const next = loadManifest(f.manifestPath);
  assert.notEqual(next.revision, f.context.revision);
  const output = generate(next, path.join(f.directory, "output"));
  assert.deepEqual(readJson(output.vaultConfigPath).chains[0].attestationSigners, f.manifest.authorizationSigners);
  assert(readJson(output.vaultConfigurePath).transactions.length > 4);
  assert.deepEqual(generate(next, path.join(f.directory, "output")).hashes, output.hashes);
});

test("changed policy, deployment or discovery invalidates approval revisions", (t) => {
  const f = fixture(t);
  f.manifest.policy.tokens[addr("b")].bucketCapacity = "2000";
  writeJson(f.manifestPath, f.manifest);
  const policyRevision = loadManifest(f.manifestPath).revision;
  assert.notEqual(policyRevision, f.context.revision);
  const deploymentPath = path.join(f.directory, "deployment.json");
  writeJson(deploymentPath, { ...readJson(deploymentPath), deployedAt: "2026-09-10" });
  assert.notEqual(loadManifest(f.manifestPath).revision, policyRevision);
});

test("editing generated files or their hash index cannot bypass integrity checking", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.artifacts.bridgeConfigPath, '{}\n');
  const indexFile = path.join(f.artifacts.directory, "artifacts.json");
  const index = readJson(indexFile);
  index.hashes["bridge.json"] = digest('{}\n');
  writeJson(indexFile, index);
  assert.throws(() => generate(f.context, path.join(f.directory, "output")), /Generated artifact changed/);
});

test("withdrawals, actions and liquidity migration fail closed in initial rollout", (t) => {
  const f = fixture(t);
  for (const field of ["withdrawalsEnabled", "autoRouteEnabled"]) {
    const candidate = structuredClone(f.manifest);
    Object.values(candidate.policy.routes)[0][field] = true;
    writeJson(f.manifestPath, candidate);
    assert.throws(() => loadManifest(f.manifestPath), /Initial rollout/);
  }
  f.manifest.policy.tokens[addr("b")].migrateAmount = "1";
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /migrateAmount/);
});

test("reconciliation skips initialized contracts and blocks reinitialization on mismatch", (t) => {
  const f = fixture(t);
  initialized(f);
  let calls = governanceProgress(f.config, f.state).filter(({ call }) => call.args._func === "initialize");
  assert(calls.every(({ status }) => status === "COMPLETE"));
  f.state.initialization.tokenRouter.poolFactory = addr("f");
  calls = governanceProgress(f.config, f.state).filter(({ call }) => call.args._func === "initialize");
  assert.equal(calls[0].status, "BLOCKED");
  assert.match(calls[0].reason, /never reinitialization/);
});

test("permissions must reach quorum before route calls become ready", (t) => {
  const f = fixture(t);
  initialized(f);
  const calls = governanceProgress(f.config, f.state);
  assert.equal(calls.find(({ call }) => call.args._func === "addWhitelist").status, "READY");
  assert.equal(calls.find(({ call }) => call.args._func === "setChain").status, "BLOCKED");
  f.state.permissionErrors = [];
  assert.equal(governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setChain").status, "READY");
});

test("advanced cursors are preserved and changed existing chains are never replayed", (t) => {
  const f = fixture(t);
  initialized(f); f.state.permissionErrors = [];
  f.state.routes.chains.set("11155111", { ...f.config.chains[0], lastProcessedBlock: "9999" });
  const find = () => governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setChain");
  assert.equal(find().status, "COMPLETE");
  assert.equal(currentCursorSettings(f.config, f.state.routes).chains[0].lastProcessedBlock, "9999");
  assert.equal(f.config.chains[0].lastProcessedBlock, "1234");
  f.state.routes.chains.get("11155111").vault = addr("f");
  assert.equal(find().status, "BLOCKED");
});

test("unknown initialization state never authorizes initialize", (t) => {
  const f = fixture(t);
  f.state.initialization.bridge = {};
  const call = governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "initialize" && call.args._target === f.config.bridge.address);
  assert.equal(call.status, "BLOCKED");
});

test("commands reject implicit mutations, invalid options and missing approval", () => {
  assert.equal(parseArgs(["--manifest", "file"]).command, "plan");
  assert.throws(() => parseArgs(["vote", "--manifest", "file"]), /Explicit/);
  assert.throws(() => parseArgs(["plan", "--manifest", "file", "--execute", "yes"]), /Invalid/);
  assert.throws(() => parseArgs(["liquidity", "--manifest", "file"]), /Use/);
});

test("process CLI offline plan works and refuses a concurrent run", (t) => {
  const f = fixture(t);
  const script = path.resolve(__dirname, "../scripts/externalBridgeRollout.js");
  const run = () => spawnSync(process.execPath, [script, "--manifest", f.manifestPath, "--output-dir", path.join(f.directory, "output")], { encoding: "utf8" });
  assert.equal(run().status, 0);
  fs.writeFileSync(path.join(f.directory, "output/.lock"), "other process");
  const busy = run();
  assert.notEqual(busy.status, 0);
  assert.match(busy.stderr, /EEXIST/);
});

test("votes require a fresh approval and safe pause gates", async (t) => {
  const f = fixture(t);
  await assert.rejects(vote(f.context, f.artifacts, { report: { approvalHash: "new" } }, "old"), /stale/);
  await assert.rejects(vote(f.context, f.artifacts, { report: { approvalHash: "new" } }, "new"), /Voting requires/);
});

test("receipt-backed retry waits for quorum after a crash rather than submitting twice", async (t) => {
  const f = fixture(t);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY").slice(0, 1);
  const inspection = { report: { approvalHash: "reviewed", calls }, source: {}, externalReady: true, router: { paused: true } };
  const options = {
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: addr("8") }) }),
    sourceState: async () => ({ calls }),
    submit: async (_token, _call, onSubmitted) => { await onSubmitted(["0xreceipt"]); throw new Error("response lost"); },
  };
  await assert.rejects(vote(f.context, f.artifacts, inspection, "reviewed", options), /response lost/);
  let sent = false;
  const recovered = await vote(f.context, f.artifacts, inspection, "reviewed", {
    ...options, submit: async () => { sent = true; }, receipts: async () => [{ status: "Success", hash: "0xreceipt" }],
  });
  assert.equal(sent, false);
  assert.equal(recovered[0].status, "WAITING_FOR_QUORUM");
});

test("hashless uncertain submissions are never automatically retried", async (t) => {
  const f = fixture(t);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY").slice(0, 1);
  const inspection = { report: { approvalHash: "reviewed", calls }, source: {}, externalReady: true, router: { paused: true } };
  const options = { fetchImpl: async () => ({ ok: true, json: async () => ({ address: addr("8") }) }), sourceState: async () => ({ calls }),
    submit: async () => { throw new Error("unknown network result"); } };
  await assert.rejects(vote(f.context, f.artifacts, inspection, "reviewed", options), /unknown network/);
  await assert.rejects(vote(f.context, f.artifacts, inspection, "reviewed", options), /Uncertain prior submission/);
});

test("reports redact secret environment values and credential-bearing RPC URLs", () => {
  assert.equal(redact("token abcdefghijk", { ACCESS_TOKEN: "abcdefghijk" }), "token [REDACTED]");
  assert(!redact("https://user:password@rpc.invalid/api-secret?q=secret", {}).includes("password"));
});

test("activation exports only unpause after fresh readiness and approval", (t) => {
  const f = fixture(t);
  const report = { status: "PENDING", approvalHash: "approved" };
  assert.throws(() => activate(f.context, f.artifacts, { report }, "approved"), /gates/);
  report.status = "READY_FOR_ACTIVATION_REVIEW";
  assert.throws(() => activate(f.context, f.artifacts, { report }, "stale"), /stale/);
  const file = activate(f.context, f.artifacts, { report }, "approved");
  const batch = readJson(file);
  assert.equal(batch.transactions.length, 1);
  assert.equal(batch.transactions[0].to.toLowerCase(), addr("3"));
  assert.equal(batch.transactions[0].data, "0x3f4ba83a");
  assert.equal(batch.transactions[0].value, "0");
  report.status = "DEPOSITS_ACTIVE_CANARY_REQUIRED";
  assert.throws(() => activate(f.context, f.artifacts, { report }, "approved"), /already active/);
});

test("missing external access and verifier setup produce a pending consolidated report", async (t) => {
  const f = fixture(t);
  f.context.manifest.services.rpcUrlEnv = "EAB_ORCHESTRATION_TEST_MISSING_RPC";
  const inspection = await inspect(f.context, f.artifacts, { sourceState: async () => ({
    settings: f.config, state: f.state, errors: ["TokenRouter is not initialized"], calls: governanceProgress(f.config, f.state),
  }) });
  assert.equal(inspection.report.status, "PENDING");
  assert(inspection.report.checks.find(({ name }) => name === "strato").data.errors.length);
  assert.equal(inspection.report.checks.find(({ name }) => name === "external").status, "FAILED");
  assert.equal(inspection.report.checks.find(({ name }) => name === "verifiers").status, "FAILED");
  assert.equal(inspection.report.checks.find(({ name }) => name === "bridge-health").status, "FAILED");
});

test("action reconciliation uses the stored autoRoute flag", (t) => {
  const f = fixture(t); initialized(f);
  f.state.actions.actionConfigs.set(`${"b".repeat(40)}:11155111:${"c".repeat(40)}`, { autoRoute: true });
  const action = governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setDepositAction");
  assert.equal(action.status, "READY");
  assert.equal(action.call.args._args[4].value, false);
});

test("activation regenerates artifacts and reconciles the enable transition", (t) => {
  const f = fixture(t); initialized(f);
  Object.values(f.manifest.policy.routes)[0].autoRouteEnabled = true;
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /AUTO_ROUTE/);
  const context = loadManifest(f.manifestPath, "activation");
  assert.notEqual(context.revision, f.context.revision);
  const artifacts = generate(context, path.join(f.directory, "output"));
  assert.equal(readJson(artifacts.manifestPath).stage, "activation");
  const settings = loadConfig(artifacts.bridgeConfigPath);
  assert.equal(settings.chains[0].routes[0].autoRouteEnabled, true);
  const find = (options) => governanceProgress(settings, f.state, options).find(({ call }) => call.args._func === "setDepositAction");
  const options = { stage: "activation", activationErrors: [] };
  assert.equal(find().status, "BLOCKED");
  assert.equal(find({ stage: "activation" }).status, "BLOCKED");
  assert.equal(find({ ...options, activationErrors: ["Unexpected AUTO_SAVE"] }).status, "BLOCKED");
  const routeKey = `${"b".repeat(40)}:11155111:${"c".repeat(40)}`;
  f.state.actions.actionConfigs.set(routeKey, { autoRoute: false });
  assert.equal(find(options).status, "READY");
  assert.equal(find(options).call.args._args[4].value, true);
  f.state.actions.actionConfigs.set(routeKey, { autoRoute: true });
  assert.equal(find(options).status, "COMPLETE");
  assert.throws(() => loadManifest(f.manifestPath, "activaton"), /stage/);
});

test("activation enablement remains blocked when service and external gates fail", async (t) => {
  const f = fixture(t); initialized(f);
  f.config.chains[0].routes[0].autoRouteEnabled = true;
  const calls = governanceProgress(f.config, f.state, { stage: "activation", activationErrors: [] });
  assert.equal(calls.find(({ call }) => call.args._func === "setDepositAction").status, "READY");
  f.context.manifest.services.rpcUrlEnv = "EAB_ORCHESTRATION_TEST_MISSING_RPC";
  const inspection = await inspect(f.context, f.artifacts, { sourceState: async () => ({
    settings: f.config, state: f.state, errors: ["AUTO_ROUTE mismatch"], calls,
  }) });
  const action = inspection.report.calls.find(({ call }) => call.args._func === "setDepositAction");
  assert.equal(action.status, "BLOCKED");
  assert.match(action.reason, /verifier policies/);
  assert.throws(() => activate(f.context, f.artifacts, inspection, inspection.report.approvalHash), /gates/);
});

test("activation cannot vote after fresh gates fail", async (t) => {
  const f = fixture(t); initialized(f);
  f.config.chains[0].routes[0].autoRouteEnabled = true;
  const item = governanceProgress(f.config, f.state, { stage: "activation", activationErrors: [] })
    .find(({ call }) => call.args._func === "setDepositAction");
  const inspection = { source: { inactiveTokens: [] }, externalReady: true, router: { paused: true },
    report: { approvalHash: "approved", calls: [item] } };
  let submitted = false;
  await assert.rejects(vote(f.context, f.artifacts, inspection, "approved", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: addr("8") }) }),
    inspect: async () => ({ externalReady: true, router: { paused: true },
      report: { calls: [{ ...item, status: "BLOCKED" }] } }),
    submit: async () => { submitted = true; },
  }), /Activation gates changed/);
  assert.equal(submitted, false);
  const result = await vote(f.context, f.artifacts, inspection, "approved", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: addr("8") }) }),
    inspect: async () => ({ ...inspection, source: { inactiveTokens: [], calls: [item] } }),
    submit: async (_user, call, recordHashes) => {
      assert.equal(call.args._args[4].value, true);
      await recordHashes(["enable-vote"]);
      submitted = true;
      return { hashes: ["enable-vote"] };
    },
  });
  assert.equal(submitted, true);
  assert.equal(result.length, 1);
});

test("service templates derive shared addresses without storing secret values", (t) => {
  const f = fixture(t);
  const bridge = fs.readFileSync(path.join(f.artifacts.directory, "bridge.env.template"), "utf8");
  assert(bridge.includes(`TOKEN_ROUTER=${addr("4")}`));
  assert(bridge.includes("BA_PASSWORD=${BA_PASSWORD}"));
  const verifier = fs.readFileSync(path.join(f.artifacts.directory, "verifier-2.env.template"), "utf8");
  assert(verifier.includes("VERIFIER_INDEPENDENT_RPC_URLS=${VERIFIER_2_INDEPENDENT_RPC_URLS}"));
  assert(verifier.includes("SETTLEMENT_ATTESTOR_BA_PASSWORD=${VERIFIER_2_BA_PASSWORD}"));
  assert(verifier.includes(`DESTINATION_VAULT_ADDRESS=${addr("2")}`));
  assert(!verifier.includes("NODE_ENV"));
});

test("service URL line injection and secret literals in tokenEnv are rejected", (t) => {
  const f = fixture(t);
  f.manifest.services.verifiers = [{ url: "https://verifier.invalid", tokenEnv: "secret-token-value" }];
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /tokenEnv/);
  f.manifest.services.verifiers[0] = { url: "https://verifier.invalid\nINJECTED=value", tokenEnv: "TOKEN_1" };
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /control characters/);
});

test("router scanner supports active-state reconciliation without changing its paused default", async (t) => {
  const f = fixture(t);
  const { ethers } = require("ethers");
  const { verifyFromManifest } = require("../scripts/scanTokenConfig");
  const abi = new ethers.Interface([
    "function paused() view returns (bool)", "function owner() view returns (address)",
    "function externalBridgeVault() view returns (address)", "function tokenConfig(address) view returns (uint96,bool)",
    "function routePermitted(address,address) view returns (bool)",
  ]);
  const provider = {
    getNetwork: async () => ({ chainId: 11155111n }), getCode: async () => "0x01", getLogs: async () => [],
    call: async (transaction) => {
      const parsed = abi.parseTransaction(transaction);
      const values = { paused: [false], owner: [addr("1")], externalBridgeVault: [addr("2")], tokenConfig: [1n, true], routePermitted: [true] };
      return abi.encodeFunctionResult(parsed.name, values[parsed.name]);
    },
  };
  provider.provider = provider;
  const active = await verifyFromManifest(f.artifacts.manifestPath, { provider, quiet: true, expectedPaused: false });
  assert.equal(active.status, "PASSED");
  const defaultCheck = await verifyFromManifest(f.artifacts.manifestPath, { provider, quiet: true });
  assert.equal(defaultCheck.status, "FAILED");
  assert(defaultCheck.errors.includes("DepositRouter is not paused"));
});

test("source chain mismatch fails before querying contract state", async (t) => {
  const f = fixture(t);
  const { sourceState } = require("../scripts/externalBridgeRollout");
  f.context.manifest.services.sourceTokenEnv = "EAB_TEST_SOURCE_AUTH";
  process.env.EAB_TEST_SOURCE_AUTH = "test-token";
  t.after(() => delete process.env.EAB_TEST_SOURCE_AUTH);
  let queries = 0;
  await assert.rejects(sourceState(f.context, f.artifacts, async () => {
    queries++;
    return { ok: true, json: async () => ({ networkID: "1" }) };
  }), /chain ID/);
  assert.equal(queries, 1);
});

test("implementation gate compares the actual build and rejects stale source or changed implementations", async (t) => {
  const f = fixture(t);
  const { ethers } = require("ethers");
  const { checkImplementations } = require("../scripts/externalBridgeRollout");
  const bytecode = new Map();
  for (const [name, implementation] of [["ExternalBridgeVault", addr("a")], ["DepositRouter", addr("b")]]) {
    const artifactPath = path.resolve(__dirname, `../artifacts/contracts/bridge/${name}.sol/${name}.json`);
    const artifact = readJson(artifactPath);
    bytecode.set(implementation.toLowerCase(), artifact.deployedBytecode);
  }
  const provider = {
    getBlockNumber: async () => 1234,
    getStorage: async (proxy) => ethers.zeroPadValue(proxy === addr("2") ? addr("a") : addr("b"), 32),
    getCode: async (implementation) => bytecode.get(implementation.toLowerCase()),
  };
  assert.equal((await checkImplementations(f.context, provider)).length, 2);
  await assert.rejects(checkImplementations(f.context, { ...provider, getStorage: async () => ethers.zeroPadValue(addr("f"), 32) }), /differs/);
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (file, ...args) => {
    const result = read(file, ...args);
    return String(file).endsWith("contracts/bridge/ExternalBridgeVault.sol") ? `${result}\n` : result;
  });
  await assert.rejects(checkImplementations(f.context, provider), /build is stale/);
});
