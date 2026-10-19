const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  initializeManifest, createPortableBundle, loadManifest, generate, writeJson, readJson, digest,
  governanceProgress, currentCursorSettings, loadConfig, shellQuote,
} = require("../scripts/lib/externalBridgeOrchestration");
const {
  parseArgs, loadRolloutEnvironment, redact, validateSafeRuntimeIdentities, resolveSourceToken, stratoApiUrl,
  normalizeStratoRequestUrl, fetchAdminVotingPolicy, requiredAdminVotes, fetchLiveAdminVoteCounts,
  vote, activate, inspect, approvedCallsCompleted, resolveNextAction, terminalSummary, main,
} = require("../scripts/externalBridgeRollout");
const progressDetails = (...args) => resolveNextAction(...args).progress;
const formatAction = (report, file) => terminalSummary({ ...report, nextAction: resolveNextAction(report).nextAction }, file);
const { NETWORKS } = require("../scripts/lib/externalBridgeNetworks");
const { verifyUninitializedProxy } = require("../../contracts/deploy/external-bridge-verification");

const addr = (digit) => `0x${digit.repeat(40)}`;
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eab-orchestration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const accessToken = process.env.ACCESS_TOKEN;
  process.env.ACCESS_TOKEN = "test-access-token";
  t.after(() => accessToken === undefined ? delete process.env.ACCESS_TOKEN : process.env.ACCESS_TOKEN = accessToken);
  const deployment = { chainId: "11155111", network: "sepolia", safeAddress: addr("1"),
    depositRouterDeploymentBlock: "1234", externalBridgeVault: { proxy: addr("2"), implementation: addr("a") },
    depositRouter: { proxy: addr("3"), implementation: addr("b") } };
  const settings = { sourceChainId: "114784819836269", externalDeployment: "deployment.json", depositPlan: "discovery.json",
    tokenRouter: addr("4"), externalAssetBridge: addr("5"), bridgeOperator: addr("6"), guardian: addr("7"),
    settlementVerifiers: [addr("8"), addr("9"), addr("a")],
    dependencies: {
      adminRegistry: addr("1"), poolFactory: addr("2"), poolV3Factory: addr("3"),
      directMintPsm: addr("4"), metalForge: addr("5"), saveUsdstVault: addr("6"),
      yieldVaults: [addr("7")], tokenFactory: addr("8"), usdst: addr("9"),
      priceOracle: addr("a"),
    } };
  const discovery = { operations: [{ chainId: 11155111, transactions: [{ meta: { items: [{
    token: addr("b"), target: addr("c"), isPermitted: true, externalDecimals: "6", externalName: "Test", externalSymbol: "TEST", stratoTokenStatus: 2,
  }] } }] }] };
  writeJson(path.join(directory, "deployment.json"), deployment);
  writeJson(path.join(directory, "discovery.json"), discovery);
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

function configured(f) {
  initialized(f);
  f.state.permissionErrors = [];
  for (const policy of f.config.mintPolicies) {
    f.state.routes.mintPolicies.set(policy.token, {
      capacity: policy.capacity,
      refillRate: policy.refillRate,
    });
  }
  for (const chain of f.config.chains) {
    f.state.routes.chains.set(String(chain.externalChainId), { ...chain });
    for (const route of chain.routes) {
      const routeKey = `${route.externalToken}:${chain.externalChainId}:${route.stratoToken}`;
      f.state.routes.routes.set(routeKey, { ...route });
      if (route.rebaseRequired) f.state.routes.rebaseRequired.add(routeKey);
    }
  }
}

function completeHandoff(f, native = false) {
  f.manifest.authorizationSigners = [addr("d"), addr("e"), addr("f")];
  Object.assign(f.manifest.services, {
    confirmations: 12, safeProposerAddress: addr("b"), executorAddress: addr("c"),
    runtimeAccessAddress: addr("4"),
    verifiers: [1, 2, 3].map(index => ({ url: `https://verifier-${index}.example`, confirmations: 12 })),
  });
  if (native) {
    f.manifest.inputs.nativeRoutes = [{ "bridge-address": addr("9").slice(2), "external-chain-id": "11155111",
      "external-bridge": addr("7"), "strato-token": addr("c").slice(2), "representation-token": addr("a"),
      "max-per-withdrawal": "100", "instant-withdrawal-threshold": "50", enabled: true }];
    f.manifest.inputs.nativeConfig = { chainId: 11155111, bridgeAddress: addr("7"), safeAddress: addr("1"),
      executor: addr("2"), eabExecutor: addr("c"), attestationSigners: [addr("d"), addr("e"), addr("f")],
      disabledAttestationSigners: [], attestationThreshold: 2, maxAttestationValiditySeconds: "1800",
      tokens: [{ stratoToken: addr("c"), representationToken: addr("a"), freezeRoute: false, transfersEnabled: true }] };
  }
  writeJson(f.manifestPath, f.manifest);
}

test("portable bundles embed legacy dependency templates instead of referencing local files", (t) => {
  const f = fixture(t);
  completeHandoff(f);
  const template = path.join(f.directory, "legacy-template.json");
  const d = f.manifest.settings.dependencies;
  writeJson(template, { adminRegistry: d.adminRegistry,
    tokenRouter: { poolFactory: d.poolFactory, poolV3Factory: d.poolV3Factory, directMintPsm: d.directMintPsm,
      metalForge: d.metalForge, saveUsdstVault: d.saveUsdstVault, yieldVaults: d.yieldVaults },
    externalAssetBridge: { tokenFactory: d.tokenFactory, usdst: d.usdst, priceOracle: d.priceOracle } });
  delete f.manifest.settings.dependencies;
  f.manifest.settings.bridgeTemplate = template;
  writeJson(f.manifestPath, f.manifest);
  const bundle = path.join(f.directory, "bundle.json");
  createPortableBundle(f.manifestPath, bundle);
  fs.unlinkSync(template);
  assert.equal(readJson(bundle).settings.bridgeTemplate, undefined);
  assert.equal(loadManifest(bundle, "activation").settings.dependencies.tokenFactory, d.tokenFactory);
});

test("a relocated single bundle recreates native inputs, policies and runtime bindings", (t) => {
  const f = fixture(t);
  completeHandoff(f, true);
  const bundle = path.join(f.directory, "handoff", "deployment-bundle.json");
  createPortableBundle(f.manifestPath, bundle);
  fs.rmSync(path.join(f.directory, "deployment.json"));
  fs.rmSync(path.join(f.directory, "discovery.json"));
  const context = loadManifest(bundle, "activation");
  const artifacts = generate(context, path.join(f.directory, "handoff", ".deployment"));
  const routes = readJson(artifacts.nativeRoutesPath);
  assert.equal(routes[0]["settlement-verifier-threshold"], "2");
  assert.equal(routes[0]["settlement-verifiers"], f.manifest.settings.settlementVerifiers.join(","));
  assert.equal(readJson(artifacts.nativeConfigPath).executor, addr("2"));
  assert.equal(artifacts.nativeVerifierPolicyPaths.length, 3);
  for (const [index, file] of artifacts.nativeVerifierPolicyPaths.entries()) {
    const policy = readJson(file);
    const { baselinePolicyHash, verifierIndex, ...baseline } = policy;
    assert.equal(baselinePolicyHash, `sha256:${digest(baseline)}`);
    assert.equal(verifierIndex, index + 1);
    assert.equal(policy.sourceBridge, addr("9").slice(2));
    assert.equal(policy.routes[0].maxInstantAmount, "50");
  }
  const runtime = fs.readFileSync(artifacts.serviceTemplates[0], "utf8");
  assert.match(runtime, /STRATO_NATIVE_BRIDGE_ADDRESS=999/);
  assert.match(runtime, /NATIVE_MINT_EXECUTOR_ADDRESS=0x222/);
  assert.deepEqual(generate(context, path.join(f.directory, "handoff", ".deployment")).hashes, artifacts.hashes);
});

test("native bundle bindings fail closed and incomplete native source files are not silently skipped", (t) => {
  const f = fixture(t);
  completeHandoff(f, true);
  f.manifest.inputs.nativeConfig.chainId = 1;
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /external chain/);
  f.manifest.inputs.nativeConfig.chainId = 11155111;
  f.manifest.inputs.nativeConfig.tokens[0].representationToken = addr("b");
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /bindings/);
  delete f.manifest.inputs.nativeRoutes;
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /both inputs/);
  delete f.manifest.inputs.nativeConfig;
  writeJson(f.manifestPath, f.manifest);
  writeJson(path.join(f.directory, "native-routes.json"), []);
  assert.throws(() => loadManifest(f.manifestPath), /native-routes.json and native.json/);
});

test("initial configuration snapshots generate Infra files but cannot authorize activation", (t) => {
  const f = fixture(t);
  const { portableSnapshot } = require("../scripts/externalBridgeRollout");
  const directory = path.join(f.directory, "initial");
  const snapshot = portableSnapshot(f.manifestPath, directory, "initial");
  assert.equal(snapshot.bundlePurpose, "provisioning");
  const file = path.join(directory, "configuration.snapshot.json");
  assert.throws(() => loadManifest(file, "activation"), /Provisioning bundles/);
  const artifacts = generate(loadManifest(file, "initial"), path.join(f.directory, "infra"));
  assert.equal(artifacts.verifierPolicyPaths.length, 3);
  assert.equal(artifacts.nativeConfigPath, undefined);
  assert.equal(artifacts.serviceTemplates.length, 4);
});

test("init imports existing settings without overwriting and plan never emits activation", (t) => {
  const f = fixture(t);
  assert.throws(() => initializeManifest(path.join(f.directory, "settings.json"), undefined, f.manifestPath), /already exists/);
  assert.equal(readJson(f.artifacts.bridgeConfigPath).chains[0].routes[0].withdrawalsEnabled, false);
  assert.equal(fs.existsSync(path.join(f.artifacts.directory, "router-unpause.json")), false);
  assert.equal(f.artifacts.vaultConfigurePath, undefined);
  const repeat = generate(f.context, path.join(f.directory, "output"));
  assert.deepEqual(repeat.hashes, f.artifacts.hashes);
  const adminArtifacts = generate(f.context, path.join(f.directory, "admin-output"),
    { includeServiceTemplates: false });
  assert.deepEqual(adminArtifacts.serviceTemplates, []);
  assert.equal(fs.existsSync(path.join(adminArtifacts.directory, "bridge.env.template")), false);
  assert.equal(fs.existsSync(adminArtifacts.bridgeConfigPath), true);
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

test("embedded deployment inputs make the manifest portable and revision-bound", (t) => {
  const f = fixture(t);
  f.manifest.policy.tokens[addr("b")].bucketCapacity = "2000";
  writeJson(f.manifestPath, f.manifest);
  const policyRevision = loadManifest(f.manifestPath).revision;
  assert.notEqual(policyRevision, f.context.revision);
  const deploymentPath = path.join(f.directory, "deployment.json");
  writeJson(deploymentPath, { ...readJson(deploymentPath), deployedAt: "2026-09-10" });
  assert.equal(loadManifest(f.manifestPath).revision, policyRevision);
  f.manifest = readJson(f.manifestPath);
  f.manifest.inputs.externalDeployment.deployedAt = "2026-09-10";
  writeJson(f.manifestPath, f.manifest);
  assert.notEqual(loadManifest(f.manifestPath).revision, policyRevision);
});

test("coordinator bundle loads without the original deployment files", (t) => {
  const f = fixture(t);
  f.manifest.authorizationSigners = [addr("d"), addr("e"), addr("f")];
  f.manifest.services.confirmations = 12;
  f.manifest.services.safeProposerAddress = addr("b");
  f.manifest.services.executorAddress = addr("c");
  f.manifest.services.runtimeAccessAddress = addr("4");
  f.manifest.services.verifiers = [1, 2, 3].map((index) => ({
    url: `https://verifier-${index}.example`,
    confirmations: 12,
  }));
  writeJson(f.manifestPath, f.manifest);
  const bundlePath = path.join(f.directory, "handoff", "deployment-bundle.json");
  fs.mkdirSync(path.dirname(bundlePath));
  createPortableBundle(f.manifestPath, bundlePath);
  const copiedBundle = path.join(f.directory, "admin-2", "deployment-bundle.json");
  fs.mkdirSync(path.dirname(copiedBundle));
  fs.copyFileSync(bundlePath, copiedBundle);
  fs.rmSync(path.join(f.directory, "deployment.json"));
  fs.rmSync(path.join(f.directory, "discovery.json"));
  const coordinator = loadManifest(bundlePath);
  const admin2 = loadManifest(copiedBundle);
  assert.equal(coordinator.rollout.chainId, f.context.rollout.chainId);
  assert.equal(admin2.revision, coordinator.revision);
  const bundle = readJson(bundlePath);
  assert.match(bundle.toolingRevision, /^[a-f0-9]{64}$/);
  bundle.toolingRevision = "0".repeat(64);
  writeJson(bundlePath, bundle);
  assert.throws(() => loadManifest(bundlePath), /different reviewed rollout code revision/);
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

test("reviewed withdrawals are allowed while actions and liquidity migration fail closed", (t) => {
  const f = fixture(t);
  const withdrawals = structuredClone(f.manifest);
  Object.values(withdrawals.policy.routes)[0].withdrawalsEnabled = true;
  writeJson(f.manifestPath, withdrawals);
  assert.doesNotThrow(() => loadManifest(f.manifestPath));
  const actions = structuredClone(f.manifest);
  Object.values(actions.policy.routes)[0].autoRouteEnabled = true;
  writeJson(f.manifestPath, actions);
  assert.throws(() => loadManifest(f.manifestPath), /Initial rollout/);
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
  assert.equal(governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setMintPolicy").status, "READY");
  assert.equal(governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setChain").status, "BLOCKED");
  for (const policy of f.config.mintPolicies) {
    f.state.routes.mintPolicies.set(policy.token, { capacity: policy.capacity, refillRate: policy.refillRate });
  }
  assert.equal(governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setChain").status, "READY");
});

test("governance exposes only the earliest incomplete deployment stage", (t) => {
  const f = fixture(t);
  let calls = governanceProgress(f.config, f.state);
  assert.deepEqual(calls.filter(({ status }) => status === "READY").map(({ call }) => call.args._func),
    ["initialize"]);
  assert.equal(calls.find(({ status }) => status === "READY").deploymentStageName,
    "TokenRouter initialization");
  assert.equal(calls.find(({ call }) =>
    call.args._func === "initialize" && call.args._target === f.config.bridge.address).status, "BLOCKED");

  f.state.initialization.tokenRouter = { ...f.config.tokenRouter, initialized: true };
  calls = governanceProgress(f.config, f.state);
  assert(calls.filter(({ status }) => status === "READY").every(({ call }) =>
    call.args._func === "setYieldVault"));

  f.state.initialization.approvedYieldVaults = new Set(f.config.tokenRouter.yieldVaults);
  calls = governanceProgress(f.config, f.state);
  assert.deepEqual(calls.filter(({ status }) => status === "READY").map(({ call }) => call.args._func),
    ["initialize"]);
  assert.equal(calls.find(({ status }) => status === "READY").call.args._target, f.config.bridge.address);
});

test("Coordinator guidance uses live quorum and emits only the current continuation command", (t) => {
  const f = fixture(t);
  const args = { manifest: f.manifestPath, stage: "activation", "env-file": "/private/coordinator.env" };
  const report = { approvalHash: "a".repeat(64), calls: [{ id: "call", status: "READY", requiredAdminVotes: 2,
    recordedAdminVotes: 0, deploymentStage: 6, deploymentStageName: "settlement verifier threshold",
    call: { args: { _func: "setSettlementVerifierThreshold" } } }], safe: { executionOrder: [] } };
  let guidance = progressDetails(report, args, f.artifacts);
  assert.equal(guidance.voteState, "FIRST_ADMIN_VOTE_REQUIRED");
  assert.equal(guidance.approvalRequired, true);
  assert.match(guidance.resumeCommand, /external:rollout -- generate --manifest/);
  assert.match(guidance.resumeCommand, /--env-file '\/private\/coordinator.env'/);
  assert.equal(guidance.voteCommand, undefined);
  assert.equal(guidance.adminHandoffCommand, undefined);
  report.calls[0].recordedAdminVotes = 1;
  guidance = progressDetails(report, args, f.artifacts);
  assert.equal(guidance.voteState, "WAITING_ON_SECOND_ADMIN");
  report.calls[0].recordedAdminVotes = 2;
  guidance = progressDetails(report, args, f.artifacts);
  assert.equal(guidance.voteState, "WAITING_FOR_EXECUTION");
  assert.equal(guidance.approvalRequired, false);
  assert.equal(formatAction({ operator: guidance }, "report.json").status, "WAITING");
  guidance = progressDetails({ status: "READY_FOR_ACTIVATION_REVIEW", calls: [], safe: { executionOrder: [] } }, args, f.artifacts);
  assert.equal(guidance.activateCommand, undefined);
  assert.match(guidance.resumeCommand, /generate/);
});

test("rollout automatically loads deployment.env beside the manifest", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "eab-environment-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.after(() => delete process.env.EAB_AUTO_ENV_TEST);
  process.env.EAB_AUTO_ENV_TEST = "old";
  fs.writeFileSync(path.join(directory, "deployment.env"), "EAB_AUTO_ENV_TEST=loaded\n");
  assert.equal(loadRolloutEnvironment(path.join(directory, "deployment-manifest.json")),
    path.join(directory, "deployment.env"));
  assert.equal(process.env.EAB_AUTO_ENV_TEST, "loaded");
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

test("every supported network enforces its Safe and KMS identity gate", () => {
  for (const network of NETWORKS) {
    const context = {
      rollout: { chainId: network.chainId },
      deployment: { production: network.production },
      manifest: {
        authorizationSigners: Array.from({ length: network.verifierCount }, (_, index) => addr(String(index + 3))),
        services: { safeProposerAddress: addr("1"), executorAddress: addr("2") },
      },
    };
    const threshold = network.production ? 2n : 1n;
    assert.equal(validateSafeRuntimeIdentities(context, [addr("9")], threshold).threshold, String(threshold));
    assert.throws(() => validateSafeRuntimeIdentities(context, [addr("1")], threshold), /exclude the proposer/);
    context.manifest.authorizationSigners.pop();
    assert.throws(() => validateSafeRuntimeIdentities(context, [addr("9")], threshold), /distinct proposer, executor and verifier/);
    if (network.production) {
      assert.throws(() => validateSafeRuntimeIdentities({
        ...context,
        manifest: {
          ...context.manifest,
          authorizationSigners: Array.from({ length: network.verifierCount }, (_, index) => addr(String(index + 3))),
        },
      }, [addr("9")], 1n), /at least 2/);
    }
  }
});

test("STRATO OAuth credentials resolve a transient access token", async (t) => {
  const names = ["ACCESS_TOKEN", "GLOBAL_ADMIN_NAME", "GLOBAL_ADMIN_PASSWORD"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  t.after(() => names.forEach((name) => previous[name] === undefined
    ? delete process.env[name] : process.env[name] = previous[name]));
  delete process.env.ACCESS_TOKEN;
  process.env.GLOBAL_ADMIN_NAME = "admin";
  process.env.GLOBAL_ADMIN_PASSWORD = "password";
  const context = { manifest: { services: { sourceTokenEnv: "ACCESS_TOKEN" } } };
  const token = await resolveSourceToken(context, {
    getUserToken: async (username, password) => {
      assert.deepEqual([username, password], ["admin", "password"]);
      return "short-lived-token";
    },
  });
  assert.equal(token, "short-lived-token");
  assert.equal(process.env.ACCESS_TOKEN, "short-lived-token");
});

test("raw STRATO requests normalize the API prefix", () => {
  assert.equal(stratoApiUrl("https://node.example"), "https://node.example/strato-api");
  assert.equal(stratoApiUrl("https://node.example/"), "https://node.example/strato-api");
  assert.equal(stratoApiUrl("https://node.example/strato-api"), "https://node.example/strato-api");
  assert.equal(stratoApiUrl("https://node.example/strato-api/"), "https://node.example/strato-api");
  assert.equal(normalizeStratoRequestUrl("https://node.example", "https://node.example/eth/v1.2/metadata"),
    "https://node.example/strato-api/eth/v1.2/metadata");
  assert.equal(normalizeStratoRequestUrl("https://node.example", "https://node.example/strato/v2.3/key"),
    "https://node.example/strato/v2.3/key");
  assert.equal(normalizeStratoRequestUrl("https://node.example", "https://node.example/cirrus/search/Table"),
    "https://node.example/cirrus/search/Table");
});

test("live AdminRegistry policy determines required vote count", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [{ admins: [addr("a"), addr("b"), addr("c"), addr("d")]
      .map((address) => ({ address })),
    thresholds: [{ target: addr("2"), func: "setRoute", threshold: "7500" }],
    defaultVotingThresholdBps: "6000" }],
  });
  const policy = await fetchAdminVotingPolicy({ adminRegistry: addr("1") },
    "https://node.example", "token", fetchImpl);
  assert.equal(requiredAdminVotes(policy, { args: { _target: addr("3"), _func: "initialize" } }), 3);
  assert.equal(requiredAdminVotes(policy, { args: { _target: addr("2"), _func: "setRoute" } }), 3);
});

test("live governance uses the latest active lifecycle and current voters", async t => {
  const issueId = "a".repeat(64), target = addr("2"), token = addr("3");
  const calls = [{ id: "call-id", call: { args: { _target: target, _func: "setRoute", _args: [{ value: token }, { value: true }] } } }];
  const creation = block => ({ issueId, target, func: "setRoute", args: [token, true], block_number: String(block), event_index: 0 });
  let active = true, invalidVoter = false, staleLifecycle = false, missingCreation = false;
  const fetchImpl = async url => {
    const parsed = new URL(url), params = parsed.searchParams;
    const offset = Number(params.get("offset"));
    let rows;
    if (parsed.pathname.endsWith("-currentIssues")) rows = active ? [{ key: issueId, value: true }] : [];
    else if (parsed.pathname.endsWith("-admins")) rows = [1, 4].map(value => ({ value: addr(String(value)) }));
    else if (parsed.pathname.endsWith("-IssueCreated")) {
      assert.equal(params.get("order"), "block_number.desc,event_index.desc");
      rows = missingCreation ? [] : [creation(1), creation(3)];
    } else if (parsed.pathname.endsWith("-IssueExecuted")) rows = [{ issueId, block_number: staleLifecycle ? "4" : "2", event_index: 1 }];
    else if (parsed.pathname.endsWith("-votes")) rows = [{ key: issueId, key2: "0", value: addr(invalidVoter ? "9" : "4") }];
    else throw new Error(`Unexpected query: ${url}`);
    return { ok: true, json: async () => rows.slice(offset, offset + 1) };
  };
  const read = () => fetchLiveAdminVoteCounts({ adminRegistry: addr("9") }, "https://node.example", "token", calls, {}, fetchImpl);
  assert.equal((await read()).get("call-id"), 1);
  assert.deepEqual(calls[0].governanceVoters, [addr("4").slice(2)]);
  invalidVoter = true;
  await assert.rejects(read(), /stale voter/);
  invalidVoter = false; staleLifecycle = true;
  await assert.rejects(read(), /lifecycle is inconsistent/);
  staleLifecycle = false; missingCreation = true;
  await assert.rejects(read(), /lifecycle is inconsistent/);
  missingCreation = false; active = false;
  assert.equal((await read()).get("call-id"), 0);
  assert.deepEqual(calls[0].governanceVoters, []);
});

test("unavailable live vote counts do not produce first-admin vote guidance", () => {
  const args = { manifest: "/secure/manifest.json", "output-dir": "/secure/output", stage: "activation" };
  const report = {
    liveVoteCounts: { status: "UNAVAILABLE", error: "HTTP 500" },
    approvalHash: "a".repeat(64),
    calls: [{
      id: "call-id",
      status: "READY",
      requiredAdminVotes: 2,
      recordedAdminVotes: 0,
      deploymentStage: 6,
      deploymentStageName: "settlement verifier threshold",
      call: { args: { _func: "setSettlementVerifierThreshold" } },
    }],
  };
  const guidance = progressDetails(report, args, { directory: "/secure/missing" });
  assert.equal(guidance.voteState, "LIVE_ADMIN_VOTES_UNAVAILABLE");
  assert.equal(guidance.voteCommand, undefined);
  assert.equal(guidance.adminHandoffCommand, undefined);
  assert.match(guidance.action, /Do not infer zero votes/);
  assert.deepEqual(formatAction({ operator: guidance }, "/secure/report.json"), {
    status: "WAITING",
    step: "Configuration",
    action: "LIVE_ADMIN_VOTES_UNAVAILABLE",
    then: guidance.action,
    run: guidance.resumeCommand,
    details: "/secure/report.json",
  });
});

test("missing state is uninitialized only for a verified fresh proxy", () => {
  const settings = { adminRegistry: addr("1") };
  const proxyRows = [{ address: addr("2"), _owner: addr("1"), logicContract: addr("3") }];
  const logicRows = [{ address: addr("3"), initialized: false }];
  assert.deepEqual(verifyUninitializedProxy(settings, "TokenRouter", addr("2"), proxyRows, logicRows),
    { initialized: false });
  assert.throws(() => verifyUninitializedProxy(settings, "TokenRouter", addr("4"), proxyRows, logicRows),
    /proxy was not found/);
  assert.throws(() => verifyUninitializedProxy(settings, "TokenRouter", addr("2"),
    [{ ...proxyRows[0], _owner: addr("4") }], logicRows), /proxy was not found/);
  assert.throws(() => verifyUninitializedProxy(settings, "TokenRouter", addr("2"), proxyRows,
    [{ ...logicRows[0], initialized: true }]), /cannot prove/);
});

test("votes require a fresh approval and safe pause gates", async (t) => {
  const f = fixture(t);
  await assert.rejects(vote(f.context, f.artifacts, { report: { approvalHash: "new" } }, "old"), /stale/);
  await assert.rejects(vote(f.context, f.artifacts, { report: { approvalHash: "new" } }, "new"), /Voting requires/);
});

test("votes refuse unavailable live vote counts before and after the fresh state check", async (t) => {
  const f = fixture(t);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY").slice(0, 1);
  let submitted = false;
  const options = {
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: addr("8") }) }),
    submit: async () => { submitted = true; },
  };
  await assert.rejects(vote(f.context, f.artifacts, {
    report: { approvalHash: "reviewed", calls, liveVoteCounts: { status: "UNAVAILABLE" } },
    source: { liveVoteCountsError: "HTTP 500" }, externalReady: true, router: { paused: true },
  }, "reviewed", { ...options, sourceState: async () => ({ calls }) }), /vote counts are unavailable/);
  assert.equal(submitted, false);
  await assert.rejects(vote(f.context, f.artifacts, {
    report: { approvalHash: "reviewed", calls }, source: {}, externalReady: true, router: { paused: true },
  }, "reviewed", {
    ...options,
    sourceState: async () => ({ calls, liveVoteCountsError: "HTTP 503" }),
  }), /vote counts are unavailable/);
  assert.equal(submitted, false);
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
  calls[0].governanceVoters = [addr("8").slice(2)];
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

test("withdrawal activation unpauses the vault before the DepositRouter", (t) => {
  const f = fixture(t);
  f.context.rollout.summary.withdrawalsEnabledCount = 1;
  const report = { status: "READY_FOR_ACTIVATION_REVIEW", approvalHash: "approved" };
  const batch = readJson(activate(f.context, f.artifacts, { report }, "approved"));
  assert.equal(batch.transactions.length, 2);
  assert.equal(batch.transactions[0].to.toLowerCase(), addr("2"));
  assert.equal(batch.transactions[0].data, "0x3f4ba83a");
  assert.equal(batch.transactions[1].to.toLowerCase(), addr("3"));
  assert.equal(batch.transactions[1].data, "0x3f4ba83a");
});

test("missing external access and verifier setup produce a pending consolidated report", async (t) => {
  const f = fixture(t);
  f.context.manifest.services.rpcUrlEnv = "EAB_ORCHESTRATION_TEST_MISSING_RPC";
  const inspection = await inspect(f.context, f.artifacts, { sourceState: async () => ({
    settings: f.config, state: f.state, errors: ["TokenRouter is not initialized"], differences: [{ code: "ROUTER_UNINITIALIZED", governanceCallIds: governanceProgress(f.config, f.state).filter(i => i.call.args._func === "initialize" && i.call.args._target === f.config.tokenRouter.address).map(i => i.id) }], calls: governanceProgress(f.config, f.state),
  }) });
  assert.equal(inspection.report.status, "PENDING");
  const strato = inspection.report.checks.find(({ name }) => name === "strato");
  assert.equal(strato.status, "PENDING");
  assert(strato.data.errors.length);
  assert.equal(inspection.report.checks.find(({ name }) => name === "external").status, "FAILED");
  assert(inspection.report.safe.executionOrder.every(({ status }) => status === "UNVERIFIED"));
  assert.equal(inspection.report.checks.find(({ name }) => name === "verifiers").status, "DEFERRED");
  assert.equal(inspection.report.checks.find(({ name }) => name === "bridge-health").status, "DEFERRED");
});

test("action reconciliation uses the stored autoRoute flag", (t) => {
  const f = fixture(t); configured(f);
  f.state.actions.actionConfigs.set(`${"b".repeat(40)}:11155111:${"c".repeat(40)}`, { autoRoute: true });
  const action = governanceProgress(f.config, f.state).find(({ call }) => call.args._func === "setDepositAction");
  assert.equal(action.status, "READY");
  assert.equal(action.call.args._args[4].value, false);
});

test("activation regenerates artifacts and reconciles the enable transition", (t) => {
  const f = fixture(t); configured(f);
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
  const f = fixture(t); configured(f);
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
  assert.doesNotMatch(inspection.report.next, /steps 6\.2|steps 6\.3/);
  assert.throws(() => activate(f.context, f.artifacts, inspection, inspection.report.approvalHash), /gates/);
});

test("failed activation checks do not repeat unverified native deployment reminders", () => {
  const report = {
    status: "PENDING",
    next: "Resolve failed activation checks (verifiers, bridge-health); activation governance remains blocked until they pass",
    activationChecksRequired: true,
    checks: [
      { name: "verifiers", status: "FAILED" },
      { name: "bridge-health", status: "FAILED" },
    ],
    calls: [],
    safe: { executionOrder: [{ step: "configure-vault", status: "DONE" }] },
  };
  const guidance = progressDetails(report, { manifest: "/secure/manifest.json", stage: "activation" }, {});
  assert.deepEqual(guidance.failedChecks, ["verifiers", "bridge-health"]);
  assert.equal(guidance.nextSteps, undefined);
  assert.doesNotMatch(guidance.action, /steps 6\.2|steps 6\.3/);
});

test("activation cannot vote after fresh gates fail", async (t) => {
  const f = fixture(t); configured(f);
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
  assert.equal(bridge.includes("API_TOKEN"), false);
  for (const name of ["RUNTIME_ACCESS_ADDRESS", "RUNTIME_ACCESS_KMS_KEY_ID", "RUNTIME_ACCESS_KMS_REGION"]) {
    assert(bridge.includes(`${name}=\${${name}}`));
  }
  const verifier = fs.readFileSync(path.join(f.artifacts.directory, "verifier-2.env.template"), "utf8");
  assert(verifier.includes("RUNTIME_ACCESS_ADDRESS=${RUNTIME_ACCESS_ADDRESS}"));
  assert(verifier.includes("VERIFIER_PUBLIC_URL="));
  assert.equal(verifier.includes("API_TOKEN"), false);
  assert(verifier.includes("VERIFIER_INDEPENDENT_RPC_URLS=${VERIFIER_2_INDEPENDENT_RPC_URLS}"));
  assert(verifier.includes("SETTLEMENT_ATTESTOR_BA_PASSWORD=${VERIFIER_2_BA_PASSWORD}"));
  assert(verifier.includes(`DESTINATION_VAULT_ADDRESS=${addr("2")}`));
  assert(!verifier.includes("NODE_ENV"));
});

test("each verifier can use a distinct confirmation count at least as strict as Runtime", (t) => {
  const f = fixture(t);
  f.manifest.services.confirmations = "12";
  f.manifest.services.verifiers = [12, 18, 24].map((confirmations, index) => ({
    url: `https://verifier-${index + 1}.example`,
    confirmations: String(confirmations),
  }));
  writeJson(f.manifestPath, f.manifest);
  const context = loadManifest(f.manifestPath);
  const artifacts = generate(context, path.join(f.directory, "confirmed-output"));
  [12, 18, 24].forEach((confirmations, index) => {
    const template = fs.readFileSync(path.join(artifacts.directory, `verifier-${index + 1}.env.template`), "utf8");
    assert(template.includes(`VERIFIER_CONFIRMATIONS=${confirmations}`));
    assert(template.includes(`VERIFIER_PUBLIC_URL=https://verifier-${index + 1}.example\n`));
  });

  f.manifest.services.verifiers[1].confirmations = "11";
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /at least services.confirmations/);
});

test("service URL line injection and secret literals in environment names are rejected", (t) => {
  const f = fixture(t);
  f.manifest.services.confirmations = 12;
  f.manifest.services.verifiers = [{ url: "https://verifier.invalid\nINJECTED=value", confirmations: 12 }];
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /control characters/);
  f.manifest.services.verifiers[0].url = "https://verifier.invalid";
  f.manifest.services.bridgeHealthUrlEnv = "https://runtime.invalid/health";
  writeJson(f.manifestPath, f.manifest);
  assert.throws(() => loadManifest(f.manifestPath), /bridgeHealthUrlEnv/);
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
    getNetwork: async () => ({ chainId: 11155111n }), getBlockNumber: async () => 2234,
    getCode: async () => "0x01",
    getLogs: async ({ fromBlock, toBlock }) => {
      assert(Number(toBlock) - Number(fromBlock) < 1_000_000);
      return [];
    },
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
  assert(defaultCheck.errors.includes("ExternalAssetDepositRouter is not paused"));
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
  for (const [name, implementation] of [["ExternalBridgeVault", addr("a")], ["ExternalAssetDepositRouter", addr("b")]]) {
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


test("terminal fallback presents only the first pending action while retaining diagnostics", () => {
  const report = { status: "PENDING", operator: {
    action: "Configure native routes.", resumeCommand: "npm run external:rollout -- generate",
    nextSteps: [{ action: "Review native route", run: "native dry-run" },
      { action: "Vote", run: "native execute" }], failedChecks: [{ name: "native", status: "FAILED" }],
  } };
  const summary = formatAction(report, "/secure/report.json");
  assert.equal(summary.run, "native dry-run");
  assert.equal(summary.instruction, "Review native route");
  assert.equal(summary.nextSteps, undefined);
  assert.deepEqual(summary.failedChecks, report.operator.failedChecks);
  assert.equal(report.operator.nextSteps.length, 2);
});




test("stalled checks time out and abort their requests", async () => {
  const { withDeadline } = require("../scripts/externalBridgeRollout");
  let signal;
  await assert.rejects(withDeadline("STRATO", (value) => {
    signal = value;
    return new Promise(() => {});
  }, 15), /STRATO timed out/);
  assert.equal(signal.aborted, true);
  assert.equal(signal.reason.code, "ROLLOUT_TIMEOUT");
  assert.equal(await withDeadline("fast", async () => "ok", 100), "ok");
  const parent = new AbortController();
  parent.abort(new Error("inspection stopped"));
  let ran = false;
  await assert.rejects(withDeadline("cancelled", () => { ran = true; }, 100, parent.signal), /inspection stopped/);
  assert.equal(ran, false);
});

test("Ctrl+C releases only the owned rollout lock and removes signal handlers", (t) => {
  const { EventEmitter } = require("node:events");
  const { acquireRolloutLock } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  const file = path.join(f.directory, ".lock");
  const fake = new EventEmitter();
  fake.pid = 123;
  let code;
  fake.exit = (value) => { code = value; };
  const cleanup = acquireRolloutLock(file, fake);
  assert.throws(() => acquireRolloutLock(file, fake), /EEXIST/);
  fake.emit("SIGINT");
  assert.equal(code, 130);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fake.listenerCount("SIGINT"), 0);
  cleanup();
  const replacementCleanup = acquireRolloutLock(file, fake);
  fs.writeFileSync(file, "another owner");
  replacementCleanup();
  assert.equal(fs.readFileSync(file, "utf8"), "another owner");
});

test("stalled STRATO inspection reports progress and cannot authorize a vote", async (t) => {
  const f = fixture(t);
  f.context.manifest.services.rpcUrlEnv = "ROLLOUT_TEST_UNUSED_RPC";
  const previous = process.env.ROLLOUT_TEST_UNUSED_RPC;
  delete process.env.ROLLOUT_TEST_UNUSED_RPC;
  t.after(() => { if (previous !== undefined) process.env.ROLLOUT_TEST_UNUSED_RPC = previous; });
  const progress = [];
  const result = await inspect(f.context, f.artifacts, {
    sourceState: () => new Promise(() => {}), checkTimeoutMs: 15,
    onProgress: (message) => progress.push(message),
  });
  assert.equal(result.source, undefined);
  assert.equal(result.externalReady, false);
  assert.match(progress[0], /strato: checking/);
  assert.match(progress[1], /strato: FAILED.*timed out/);
  assert.equal(result.report.checks.find(({ name }) => name === "strato").status, "FAILED");
  await assert.rejects(vote(f.context, f.artifacts, result, result.report.approvalHash), /Voting requires/);
});

test("self-contained approvals reject tampering, expiry and changed calls but survive reporting revisions", (t) => {
  const { portableSnapshot, createApprovalRequest, decodeApprovalRequest, writeApprovalFile, readApprovalFile, validateApprovalCalls } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f);
  const snapshot = portableSnapshot(f.manifestPath, f.artifacts.directory);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY");
  const now = Date.now();
  const request = createApprovalRequest(snapshot, { calls }, now);
  const packet = decodeApprovalRequest(request.request, request.approval, now);
  assert.equal(packet.manifest.toolingRevision, undefined);
  const handoff = writeApprovalFile(f.directory, request);
  assert.equal(readApprovalFile(handoff.file, now).expiresAt, packet.expiresAt);
  const altered = readJson(handoff.file);
  altered.packet.calls[0].call.args._func = "tampered";
  writeJson(handoff.file, altered);
  assert.throws(() => readApprovalFile(handoff.file, now), /altered/);
  assert.throws(() => decodeApprovalRequest(request.request, "0".repeat(64), now), /mismatch/);
  assert.throws(() => decodeApprovalRequest(request.request, request.approval, now + 2 * 60 * 60 * 1000), /expired/);
  const inspection = { source: {}, report: { calls } };
  assert.equal(validateApprovalCalls(packet, inspection).length, calls.length);
  const changed = structuredClone(calls);
  changed[0].call.args._func = "somethingElse";
  assert.throws(() => validateApprovalCalls(packet, { ...inspection, report: { calls: changed } }), /changed/);
  assert.throws(() => validateApprovalCalls(packet, { ...inspection, source: { liveVoteCountsError: "unknown" } }), /unavailable/);
});

test("file approval prints one decoded review and requires confirmation before submission", async (t) => {
  const { portableSnapshot, createApprovalRequest, writeApprovalFile, runApproval } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY");
  const request = createApprovalRequest(portableSnapshot(f.manifestPath, f.artifacts.directory), { calls });
  const handoff = writeApprovalFile(f.directory, request);
  let review, submissions = 0;
  const inspectApproval = async () => ({ source: {}, externalReady: true, router: { paused: true }, report: { calls, approvalHash: "fresh" } });
  const result = await runApproval({ file: handoff.file }, {
    inspect: inspectApproval,
    confirmApproval: async value => { review = value; return true; },
    vote: async () => { submissions++; return [{ status: "VOTED" }]; },
  });
  assert.equal(result.status, "APPROVAL_SUBMITTED");
  assert.equal(submissions, 1);
  assert.equal(review.approvalId, handoff.approvalId);
  assert.deepEqual(review.calls.map(call => call.method), calls.map(call => call.call.args._func));
  const cancelled = await runApproval({ file: handoff.file }, {
    inspect: inspectApproval,
    confirmApproval: async () => false,
    vote: async () => { submissions++; return [{ status: "VOTED" }]; },
  });
  assert.equal(cancelled.status, "APPROVAL_CANCELLED");
  assert.equal(submissions, 1);
});

test("combined rollout gives each admin one reviewed EAB and native approval file per phase", async (t) => {
  const handoff = require("../scripts/lib/rolloutHandoff");
  const nativeInspection = require("../scripts/lib/rolloutNativeInspection");
  const f = fixture(t);
  completeHandoff(f, true);
  const context = loadManifest(f.manifestPath, "activation");
  const eabCall = { ...governanceProgress(f.config, f.state).find(({ status }) => status === "READY"),
    requiredAdminVotes: 2, recordedAdminVotes: 0 };
  const nativeCall = { id: digest({ native: true }), status: "READY", deploymentStage: 0,
    requiredAdminVotes: 2, recordedAdminVotes: 0,
    call: { args: { _target: context.nativeInputs.nativeRoutes[0]["bridge-address"], _func: "setPause",
      _args: [{ type: "bool", value: true }, { type: "bool", value: true }] } } };
  const request = handoff.createApprovalRequest(handoff.portableSnapshot(f.manifestPath, f.artifacts.directory),
    { calls: [eabCall, nativeCall], approvalKind: "all" });
  assert.equal(request.packet.kind, "all");
  const file = handoff.writeApprovalFile(f.directory, request).file;
  t.mock.method(nativeInspection, "nativeApprovalInspection", async () => ({
    source: { calls: [nativeCall] }, report: { calls: [nativeCall], nativeMode: "configure" },
  }));
  let reviewed, submitted;
  const result = await handoff.runApproval({ file }, {
    inspect: async () => ({ source: { calls: [eabCall] }, externalReady: true, router: { paused: true },
      report: { calls: [eabCall], approvalHash: "eab" } }),
    confirmApproval: async value => { reviewed = value; return true; },
    vote: async (_context, _artifacts, inspection) => {
      submitted = inspection.report.calls;
      return [{ status: "VOTED" }];
    },
  });
  assert.equal(result.status, "APPROVAL_SUBMITTED");
  assert.deepEqual(reviewed.calls.map(({ method }) => method), ["setPause", eabCall.call.args._func]);
  assert.equal(submitted.length, 2);
});

test("admin approval needs no profiles/history and removes its transient files", async (t) => {
  const { portableSnapshot, createApprovalRequest, runApproval } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY");
  const request = createApprovalRequest(portableSnapshot(f.manifestPath, f.artifacts.directory), { calls });
  // The command carries its current inputs; the admin cannot read any original deployment files.
  for (const file of fs.readdirSync(f.directory).filter(name => name.endsWith(".json"))) fs.unlinkSync(path.join(f.directory, file));
  let temporary;
  const result = await runApproval({ request: request.request, approve: request.approval }, {
    inspect: async (_context, artifacts) => {
      temporary = path.dirname(path.dirname(artifacts.directory));
      return { source: {}, externalReady: true, router: { paused: true }, report: { calls, approvalHash: "fresh" } };
    },
    vote: async (_context, _artifacts, inspection, approval, options) => {
      assert.equal(options.stateless, true);
      assert.equal(approval, "fresh");
      assert.equal(inspection.report.calls.length, calls.length);
      return [{ status: "VOTED" }];
    },
  });
  assert.equal(result.status, "APPROVAL_SUBMITTED");
  assert.equal(fs.existsSync(temporary), false);
  assert.equal(fs.existsSync(path.join(f.directory, ".deployment/admin-1.json")), false);
});

test("stateless approval skips a live vote even on a new machine without a journal", async (t) => {
  const f = fixture(t);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY").slice(0, 1);
  calls[0].governanceVoters = [addr("8").slice(2)];
  calls[0].governanceAdmins = [addr("8").slice(2)];
  const inspection = { source: {}, externalReady: true, router: { paused: true }, report: { calls, approvalHash: "fresh" } };
  let submitted = false;
  const result = await vote(f.context, f.artifacts, inspection, "fresh", {
    stateless: true,
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: addr("8") }) }),
    sourceState: async () => ({ calls }),
    submit: async () => { submitted = true; },
  });
  assert.equal(submitted, false);
  assert.equal(result[0].status, "ALREADY_VOTED");
});

test("Safe grouping preserves chain, owner, boundaries and earlier reviewed files", (t) => {
  const { groupSafeAction } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f);
  f.context = loadManifest(f.manifestPath, "activation");
  f.artifacts = generate(f.context, path.join(f.directory, "activation"));
  const checklist = [
    { step: "pause-router", path: f.artifacts.depositRouterPausePath, status: "PENDING" },
    { step: "pause-vault", path: f.artifacts.vaultPausePath, status: "PENDING" },
    { step: "configure-router-1", path: f.artifacts.depositRouterBatchPaths[0], status: "PENDING" },
    { step: "configure-vault", path: f.artifacts.vaultConfigurePath, status: "PENDING" },
  ];
  const pause = groupSafeAction(f.context, f.artifacts, checklist);
  assert.equal(path.basename(pause.path), "pause.safe.json");
  const pauseJson = readJson(pause.path);
  assert.equal(pauseJson.transactions.length, 2);
  checklist[0].status = checklist[1].status = "DONE";
  const configure = groupSafeAction(f.context, f.artifacts, checklist);
  assert.equal(path.basename(configure.path), "configure.safe.json");
  assert.equal(readJson(pause.path).transactions.length, 2);
  checklist[3].status = "UNVERIFIED";
  const partial = groupSafeAction(f.context, f.artifacts, checklist);
  assert.notEqual(partial.path, configure.path);
  assert.equal(readJson(partial.path).transactions.length, readJson(checklist[2].path).transactions.length);
});


test("native configuration creates current stateless handoffs with dependencies and conflict checks", (t) => {
  const { nativeGovernanceCalls, nativeGovernanceProgress, createApprovalRequest, decodeApprovalRequest, portableSnapshot } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  Object.assign(f.manifest.inputs.nativeRoutes[0], { "external-name": "Test", "external-symbol": "TEST" });
  writeJson(f.manifestPath, f.manifest);
  const context = loadManifest(f.manifestPath, "activation");
  context.nativeInputs.nativeRoutes[0]["settlement-verifiers"] = context.settings.settlementVerifiers.join(",");
  context.nativeInputs.nativeRoutes[0].sharedTokenSettings = {
    depositsDisabled: false,
    withdrawalsDisabled: true,
    maxOutstandingWithdrawal: "250",
  };
  const state = { bridge: { depositsPaused: false, withdrawalsPaused: false, tokenRouter: addr("0"), settlementVerifierThreshold: 0 },
    verifiers: new Map(), assets: new Map(), tokenConfigs: new Map(), autoRoutes: new Map() };
  const calls = nativeGovernanceCalls(context, "configure");
  assert.deepEqual(calls.find(({ args }) => args._func === "setTokenBridgeConfig").args._args.map(({ value }) => value),
    [addr("c").slice(2), false, true, "250"]);
  let progress = nativeGovernanceProgress(calls, state);
  assert.deepEqual(progress.filter(({ status }) => status === "READY").map(({ call }) => call.args._func), ["setPause"]);
  state.bridge.depositsPaused = state.bridge.withdrawalsPaused = true;
  state.bridge.bridgeOperator = context.settings.bridgeOperator;
  state.bridge.guardian = context.settings.guardian;
  progress = nativeGovernanceProgress(calls, state);
  assert.equal(progress.filter(({ status }) => status === "READY").length, 3);
  const snapshot = portableSnapshot(f.manifestPath, path.join(f.directory, "native-handoff"));
  const request = createApprovalRequest(snapshot, { calls: progress, nativeMode: "configure" });
  const packet = decodeApprovalRequest(request.request, request.approval);
  assert.equal(packet.kind, "native");
  assert.equal(packet.nativeMode, "configure");
  assert.equal(packet.calls.length, 7);
  const activation = nativeGovernanceProgress(nativeGovernanceCalls(context, "activate"), state);
  assert.notEqual(activation.find(({ call }) => call.args._func === "setPause").status, "READY");
  context.nativeInputs.nativeRoutes.push({ ...context.nativeInputs.nativeRoutes[0], "max-per-withdrawal": "999" });
  assert.throws(() => nativeGovernanceCalls(context, "configure"), /Conflicting/);
});

test("OAuth uses bounded HTTPS requests and never includes server error bodies", async (t) => {
  const { fetchRolloutOAuthToken } = require("../scripts/externalBridgeRollout");
  const previous = process.env.OAUTH_URL;
  process.env.OAUTH_URL = "https://oauth.example/discovery";
  t.after(() => previous === undefined ? delete process.env.OAUTH_URL : process.env.OAUTH_URL = previous);
  const requests = [];
  const token = await fetchRolloutOAuthToken("admin", "local-password", async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => url.endsWith("discovery") ? { token_endpoint: "https://oauth.example/token" } : { access_token: "transient" } };
  });
  assert.equal(token, "transient");
  assert.equal(requests[1].options.body.get("username"), "admin");
  assert.equal(requests[1].options.body.get("password"), "local-password");
  assert.ok(requests.every(({ options }) => options.signal));
  await assert.rejects(fetchRolloutOAuthToken("admin", "secret", async url => url.endsWith("discovery")
    ? { ok: true, json: async () => ({ token_endpoint: "https://oauth.example/token" }) }
    : { ok: false, status: 401, text: async () => "secret" }), error => error.message === "STRATO authentication failed (HTTP 401)");
});

test("native source handoff reconciles complete inventory, rejects migration and gates activation", async (t) => {
  const { nativeApprovalInspection, nativeHandoff, nativeGovernanceCalls } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  Object.assign(f.manifest.inputs.nativeRoutes[0], { "external-name": "Test", "external-symbol": "TEST" });
  writeJson(f.manifestPath, f.manifest);
  const context = loadManifest(f.manifestPath, "activation");
  const artifacts = generate(context, path.join(f.directory, "native"));
  const calls = nativeGovernanceCalls(context, "configure");
  const values = calls.find(call => call.args._func === "setAsset").args._args.map(({ value }) => value);
  const asset = Object.fromEntries(["enabled", "externalChainId", "externalBridge", "representationToken", "externalName", "externalSymbol", "maxPerWithdrawal", "instantWithdrawalThreshold", "stratoToken"].map((name, i) => [name, values[i]]));
  const base = { owner: context.settings.dependencies.adminRegistry, bridgeOperator: context.settings.bridgeOperator,
    guardian: context.settings.guardian, depositsPaused: true, withdrawalsPaused: true,
    settlementVerifierCount: 3, settlementVerifierThreshold: 2, tokenRouter: context.settings.tokenRouter,
    tokenFactory: context.settings.dependencies.tokenFactory, custodyVault: addr("8") };
  const eab = { source: {}, externalReady: true, router: { paused: true },
    report: { status: "READY_FOR_ACTIVATION_REVIEW", calls: [], approvalHash: "eab" } };
  const fetchImpl = async url => {
    const u = new URL(url), table = u.pathname.split("/").at(-1);
    let rows = [];
    if (Number(u.searchParams.get("offset")) === 0) {
      if (table === "BlockApps-StratoNativeBridge") rows = [base];
      if (table === "BlockApps-StratoNativeCustodyVault") rows = [{ owner: context.settings.dependencies.adminRegistry,
        bridge: context.nativeInputs.nativeRoutes[0]["bridge-address"], paused: true }];
      if (table === "BlockApps-StratoNativeBridge-settlementVerifiers") rows = context.settings.settlementVerifiers.map(key => ({ key, value: true }));
      if (table === "BlockApps-StratoNativeBridge-assets") rows = [{ key: asset.stratoToken, key2: asset.externalChainId, value: asset }];
      if (table === "BlockApps-AdminRegistry-whitelist") rows = ["transfer", "transferFrom"].map(method => ({ key: asset.stratoToken, key2: method, key3: base.custodyVault, value: true }));
      if (table === "BlockApps-AdminRegistry") rows = [{ defaultVotingThresholdBps: 6666,
        admins: [1, 2, 3].map(n => ({ address: addr(String(n)) })), thresholds: [] }];
      if (table === "BlockApps-AdminRegistry-admins") rows = [1, 2, 3].map(n => ({ key: n, value: addr(String(n)) }));
    }
    return { ok: true, json: async () => rows };
  };
  const options = { fetchImpl, inspectEab: async () => eab, validateNativeReadiness: async () => {} };
  const configured = await nativeApprovalInspection(context, artifacts, "configure", eab, options);
  assert.ok(configured.report.calls.every(({ status }) => status === "COMPLETE"));
  const activated = await nativeApprovalInspection(context, artifacts, "activate", eab, options);
  assert.equal(activated.report.calls.find(({ status }) => status === "READY").call.args._func, "setAsset");
  const activeEab = { ...eab, router: { paused: false }, report: { ...eab.report, status: "DEPOSITS_ACTIVE_CANARY_REQUIRED",
    checks: ["strato", "external-identity", "deposit-router", "withdrawal-pause", "safe-runtime-identities", "vault-configuration", "verifiers", "bridge-health"].map(name => ({ name, status: "PASSED" })) } };
  await assert.rejects(nativeApprovalInspection(context, artifacts, "activate", activeEab, options), /paused external intake/);
  const readOnly = await nativeApprovalInspection(context, artifacts, "activate", activeEab, { ...options, readOnlyActiveEab: true });
  await assert.rejects(vote(context, artifacts, readOnly, readOnly.report.approvalHash, { allowActiveEab: true }), /Voting requires/);
  await assert.rejects(nativeApprovalInspection(context, artifacts, "activate", { ...eab, report: { status: "PENDING" } }, options), /readiness/);
  asset.representationToken = addr("b");
  await assert.rejects(nativeApprovalInspection(context, artifacts, "configure", eab, options), /migration requires separate/);
  asset.representationToken = values[3];
  base.settlementVerifierCount = 4;
  await assert.rejects(nativeApprovalInspection(context, artifacts, "configure", eab, options), /inventory is incomplete/);
  base.settlementVerifierCount = 3;
  const rpcEnv = context.manifest.services.rpcUrlEnv;
  const previous = process.env[rpcEnv];
  process.env[rpcEnv] = "https://rpc.example";
  t.after(() => previous === undefined ? delete process.env[rpcEnv] : process.env[rpcEnv] = previous);
  const result = await nativeHandoff(context, artifacts, f.manifestPath, "configure", {
    ...options, provider: {}, nativePlan: async () => ({ transactions: [] }),
  });
  assert.equal(result.status, "NATIVE_CONFIGURED");
});

test("native progress belongs to the Coordinator and code-only changes do not reset it", (t) => {
  const { nativeCoordinatorAction, nativeConfigurationFingerprint } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  const context = loadManifest(f.manifestPath, "activation");
  const output = path.join(f.directory, ".deployment");
  const report = { status: "PENDING", calls: [], operator: {}, safe: { executionOrder: [] } };
  assert.equal(nativeCoordinatorAction(context, report, output, f.manifestPath).action, "CONFIGURE_NATIVE_BRIDGE");
  writeJson(path.join(output, "native-configured.json"), { fingerprint: nativeConfigurationFingerprint(context) });
  assert.equal(nativeCoordinatorAction(context, report, output, f.manifestPath), undefined);
  report.status = "READY_FOR_ACTIVATION_REVIEW";
  assert.equal(nativeCoordinatorAction(context, report, output, f.manifestPath).action, "ACTIVATE_NATIVE_BRIDGE");
  assert.match(nativeCoordinatorAction(context, report, output, f.manifestPath).run, /external:rollout -- generate --manifest/);
  writeJson(path.join(output, "native-active.json"), { fingerprint: nativeConfigurationFingerprint(context) });
  assert.equal(nativeCoordinatorAction(context, { ...report, revision: "new-reporting-code" }, output, f.manifestPath), undefined);
  context.settings.bridgeOperator = addr("d");
  assert.equal(nativeCoordinatorAction(context, report, output, f.manifestPath).action, "CONFIGURE_NATIVE_BRIDGE");
});

test("service handoff remains stable for reporting changes and rejects altered package files", (t) => {
  const { createServiceHandoff } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f);
  const context = loadManifest(f.manifestPath, "activation");
  const artifacts = generate(context, path.join(f.directory, ".deployment"));
  const first = createServiceHandoff(artifacts);
  assert.equal(readJson(path.join(path.dirname(first.file), "services.json")).application.kind, "chain-install");
  const second = createServiceHandoff(generate({ ...context, revision: "new-reporting-code" }, path.join(f.directory, ".deployment")));
  assert.equal(second.file, first.file);
  const extension = createServiceHandoff(artifacts, { nativeExtension: true });
  assert.notEqual(extension.file, first.file);
  assert.equal(readJson(path.join(path.dirname(extension.file), "services.json")).application.kind, "native-extension");
  assert.equal(second.sha256, first.sha256);
  const packageDirectory = path.dirname(first.file);
  const policy = path.join(packageDirectory, "verifier-1.json");
  fs.writeFileSync(policy, "tampered");
  assert.throws(() => createServiceHandoff(artifacts), /package file changed/);
});

test("start handoff requires only service readiness failures after verified configuration", () => {
  const { infraStartRequired } = require("../scripts/externalBridgeRollout");
  const report = { activationChecksRequired: true, safe: { executionOrder: [{ status: "DONE" }] },
    checks: [{ name: "verifiers", status: "FAILED" }, { name: "bridge-health", status: "FAILED" }] };
  assert.equal(infraStartRequired(report), true);
  assert.equal(infraStartRequired({ ...report, checks: [...report.checks, { name: "external-identity", status: "FAILED" }] }), false);
  assert.equal(infraStartRequired({ ...report, safe: { executionOrder: [{ status: "UNVERIFIED" }] } }), false);
  assert.equal(infraStartRequired({ ...report, activationChecksRequired: false }), false);
});

test("completed approval handoff is a no-op without creating admin history", async (t) => {
  const { portableSnapshot, createApprovalRequest, runApproval } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY");
  const approval = createApprovalRequest(portableSnapshot(f.manifestPath, f.artifacts.directory), { calls });
  let voted = false;
  const result = await runApproval({ request: approval.request, approve: approval.approval }, {
    inspect: async () => ({ source: {}, report: { calls: calls.map(call => ({ ...call, status: "COMPLETE" })) } }),
    vote: async () => { voted = true; },
  });
  assert.equal(result.status, "ALREADY_COMPLETE");
  assert.equal(voted, false);
});

test("native custody unpause precedes origin intake unpause", (t) => {
  const { nativeGovernanceCalls, nativeGovernanceProgress } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  Object.assign(f.manifest.inputs.nativeRoutes[0], { "external-name": "Test", "external-symbol": "TEST" });
  writeJson(f.manifestPath, f.manifest);
  const context = loadManifest(f.manifestPath, "activation");
  const calls = nativeGovernanceCalls(context, "activate", addr("8"));
  const v = calls.find(call => call.args._func === "setAsset").args._args.map(({ value }) => value);
  const asset = Object.fromEntries(["enabled", "externalChainId", "externalBridge", "representationToken", "externalName", "externalSymbol", "maxPerWithdrawal", "instantWithdrawalThreshold", "stratoToken"].map((field, i) => [field, v[i]]));
  const state = { bridge: { depositsPaused: true, withdrawalsPaused: true, bridgeOperator: context.settings.bridgeOperator,
    guardian: context.settings.guardian, tokenRouter: context.settings.tokenRouter, settlementVerifierThreshold: 2 },
    custody: { paused: true }, whitelist: new Set(["transfer", "transferFrom"].map(method => `${asset.stratoToken}:${method}:${addr("8").slice(2)}`)),
    verifiers: new Map(context.settings.settlementVerifiers.map(value => [value.slice(2), true])),
    assets: new Map([[`${asset.stratoToken}:${asset.externalChainId}`, asset]]), tokenConfigs: new Map(), autoRoutes: new Map() };
  let ready = nativeGovernanceProgress(calls, state).filter(({ status }) => status === "READY");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].call.args._target, addr("8").slice(2));
  state.custody.paused = false;
  ready = nativeGovernanceProgress(calls, state).filter(({ status }) => status === "READY");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].call.args._args.length, 2);
  assert.equal(ready[0].deploymentStage, 8);
  assert.equal(parseArgs(["activate", "--manifest", f.manifestPath]).command, "activate");
});


test("generate completes read-only native phases internally and returns real handoffs", async (t) => {
  const { advanceNative } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  const context = loadManifest(f.manifestPath, "activation");
  const report = { status: "READY_FOR_ACTIVATION_REVIEW", calls: [], operator: {}, safe: { executionOrder: [] } };
  const output = path.join(f.directory, ".deployment");
  const modes = [];
  const pending = await advanceNative(context, f.artifacts, report, output, f.manifestPath, {}, {
    nativeHandoff: async (_context, _artifacts, _path, mode) => {
      modes.push(mode);
      return mode === "configure" ? { status: "NATIVE_CONFIGURED" }
        : { status: "ACTION_REQUIRED", action: "APPROVE_NATIVE_CONFIGURATION", run: "current admin command" };
    },
  });
  assert.deepEqual(modes, ["configure", "activate"]);
  assert.equal(pending.action, "APPROVE_NATIVE_CONFIGURATION");
  assert.equal(pending.run, "current admin command");
  const done = await advanceNative(context, f.artifacts, report, output, f.manifestPath, {}, {
    nativeHandoff: async () => ({ status: "NATIVE_ACTIVE" }),
  });
  assert.equal(done, undefined);
  assert.equal(fs.existsSync(path.join(output, "native-active.json")), true);
});

test("later native enablement requires unchanged healthy active EAB and permits no EAB approvals", (t) => {
  const { nativeOnlyEabVerified, portableSnapshot, createApprovalRequest, decodeApprovalRequest } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  f.manifest.scope = "native";
  writeJson(f.manifestPath, f.manifest);
  const context = loadManifest(f.manifestPath, "activation");
  const proof = { source: {}, externalReady: true, router: { paused: false }, report: {
    status: "DEPOSITS_ACTIVE_CANARY_REQUIRED", calls: [{ status: "COMPLETE" }],
    checks: ["strato", "external-identity", "deposit-router", "withdrawal-pause", "safe-runtime-identities", "vault-configuration", "verifiers", "bridge-health"].map(name => ({ name, status: "PASSED" })),
  } };
  assert.equal(nativeOnlyEabVerified(context, proof), true);
  assert.equal(nativeOnlyEabVerified(context, { ...proof, report: { ...proof.report, calls: [{ status: "READY" }] } }), false);
  assert.equal(nativeOnlyEabVerified(context, { ...proof, report: { ...proof.report, checks: [] } }), false);
  const calls = governanceProgress(f.config, f.state).filter(({ status }) => status === "READY");
  const packet = createApprovalRequest(portableSnapshot(f.manifestPath, f.artifacts.directory), { calls });
  assert.throws(() => decodeApprovalRequest(packet.request, packet.approval), /cannot approve EAB changes/);
});

test("native readiness checks bind all native KMS signers and policy hashes", async (t) => {
  const { validateNativeReadiness } = require("../scripts/externalBridgeRollout");
  const f = fixture(t);
  completeHandoff(f, true);
  const context = loadManifest(f.manifestPath, "activation");
  const artifacts = generate(context, path.join(f.directory, "native-metadata"));
  let mismatch = false;
  const fetchImpl = async url => {
    const index = context.manifest.services.verifiers.findIndex(verifier => url.startsWith(verifier.url));
    const policy = readJson(artifacts.nativeVerifierPolicyPaths[index]);
    return { ok: true, json: async () => ({ status: "ok", native: {
      attestationSigner: mismatch ? addr("1") : context.nativeInputs.nativeConfig.attestationSigners[index],
      sourceBridge: policy.sourceBridge, destinationBridge: policy.destinationBridge, policyVersion: policy.version,
      baselinePolicyHash: policy.baselinePolicyHash, policyDigest: `sha256:${digest(fs.readFileSync(artifacts.nativeVerifierPolicyPaths[index], "utf8"))}`,
    } }) };
  };
  await validateNativeReadiness(context, artifacts, fetchImpl);
  mismatch = true;
  await assert.rejects(validateNativeReadiness(context, artifacts, fetchImpl), error => error.code === "NATIVE_READINESS");
});

test("router history uses wide complete ranges and safely narrows RPC range limits", async () => {
  const { queryFilterInChunks } = require("../scripts/scanTokenConfig");
  const intervals = [];
  const latest = 2_763_366;
  const history = [100, 999_999, 1_000_000, 2_763_366].map(blockNumber => ({ blockNumber }));
  const contract = { queryFilter: async (_filter, start, end) => {
    intervals.push([start, end]); return history.filter(event => event.blockNumber >= start && event.blockNumber <= end);
  } };
  assert.deepEqual(await queryFilterInChunks(contract, {}, 0, { getBlockNumber: async () => latest }), history);
  assert.equal(intervals.length, 3);
  assert.deepEqual(intervals, [[0, 999999], [1000000, 1999999], [2000000, latest]]);
  const accepted = [];
  const limited = { queryFilter: async (_filter, start, end) => {
    if (end - start + 1 > 1000) throw new Error("block range exceeds limit");
    accepted.push([start, end]); return history.filter(event => event.blockNumber >= start && event.blockNumber <= end);
  } };
  assert.deepEqual(await queryFilterInChunks(limited, {}, 0, { getBlockNumber: async () => 2000 }), [history[0]]);
  assert.equal(accepted[0][0], 0);
  assert.equal(accepted.at(-1)[1], 2000);
  for (let i = 1; i < accepted.length; i++) assert.equal(accepted[i][0], accepted[i-1][1] + 1);
  await assert.rejects(queryFilterInChunks({ queryFilter: async () => { throw new Error("RPC unavailable"); } }, {}, 0,
    { getBlockNumber: async () => 2000 }), /RPC unavailable/);
});

test("governance scans all active lifecycle batches with bounded concurrency", async () => {
  const ids = Array.from({ length: 205 }, (_, i) => i.toString(16).padStart(64, "0"));
  const call = { id: "call", call: { args: { _target: addr("2"), _func: "setRoute", _args: [{ value: "0" }] } } };
  let concurrent = 0, maximum = 0;
  const queried = new Set();
  const fetchImpl = async url => {
    const parsed = new URL(url), q = parsed.searchParams, offset = Number(q.get("offset"));
    let rows;
    if (parsed.pathname.endsWith("-currentIssues")) rows = ids.map(key => ({ key, value: true }));
    else if (parsed.pathname.endsWith("-admins")) rows = [{ value: addr("1") }];
    else {
      const batch = (q.get("issueId") || q.get("key")).slice(4,-1).split(",");
      assert(batch.length <= 50);
      if (parsed.pathname.endsWith("-IssueCreated")) {
        concurrent++; maximum = Math.max(maximum, concurrent);
        await new Promise(resolve => setTimeout(resolve, 5)); concurrent--;
        batch.forEach(id => queried.add(id));
        rows = batch.map(issueId => ({ issueId, target: addr("2"), func: "setRoute",
          args: [String(ids.indexOf(issueId))], block_number: "1", event_index: 0 }));
      } else if (parsed.pathname.endsWith("-IssueExecuted")) {
        assert.deepEqual(batch, [ids[0]], "unrelated execution history is not queried"); rows = [];
      } else {
        assert.deepEqual(batch, [ids[0]], "unrelated voter history is not queried");
        rows = batch.map(key => ({ key, value: addr("1"), key2: "0" }));
      }
    }
    return { ok: true, json: async () => rows.slice(offset, offset + 200) };
  };
  const counts = await fetchLiveAdminVoteCounts({ adminRegistry: addr("9") }, "https://node.example", "token", [call], {}, fetchImpl);
  assert.equal(counts.get("call"), 1);
  assert.equal(queried.size, 205);
  assert(maximum <= 3);
});

test("STRATO read limiter caps in-flight requests and releases slots after failures", async () => {
  const { limitConcurrentFetches } = require("../scripts/externalBridgeRollout");
  let active = 0, maximum = 0, completed = 0;
  const fetchImpl = async url => {
    active++; maximum = Math.max(maximum, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (url === "fail") throw new Error("unavailable");
      completed++; return { ok: true };
    } finally { active--; }
  };
  const limited = limitConcurrentFetches(fetchImpl);
  const results = await Promise.allSettled(["fail", ...Array(11).fill("read")].map(url => limited(url)));
  assert.equal(maximum, 3);
  assert.equal(active, 0);
  assert.equal(completed, 11);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
});

test("aborted queued STRATO reads are never sent to the server", async () => {
  const { limitConcurrentFetches } = require("../scripts/externalBridgeRollout");
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const limited = limitConcurrentFetches(async () => { calls++; await gate; return { ok: true }; }, 1);
  const first = limited("first");
  const controller = new AbortController();
  const queued = limited("queued", { signal: controller.signal });
  controller.abort(new Error("inspection deadline"));
  release();
  await first;
  await assert.rejects(queued, /inspection deadline/);
  assert.equal(calls, 1);
});

async function stagedFixture(t, { paused = true, enabling = false, inventoryError = false, routerMismatch = false, vaultMismatch = false, previousReport, sourceErrors = [], servicesReady = false, runtimeAccessMismatch = false } = {}) {
  const f = fixture(t); completeHandoff(f);
  const context = loadManifest(f.manifestPath, "activation");
  if (servicesReady) context.manifest.services.bridgeHealthUrl = "https://runtime.example/health";
  const rpcName = context.manifest.services.rpcUrlEnv;
  const previousRpc = process.env[rpcName]; process.env[rpcName] = "https://rpc.example";
  t.after(() => previousRpc === undefined ? delete process.env[rpcName] : process.env[rpcName] = previousRpc);
  const artifacts = generate(context, path.join(f.directory, "staged"));
  const { ethers } = require("ethers");
  const iface = new ethers.Interface(["function paused() view returns (bool)",
    "function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
  const provider = { getNetwork: async () => ({ chainId: 11155111n }), call: async transaction => {
    const method = iface.parseTransaction(transaction).name;
    return iface.encodeFunctionResult(method, method === "paused" ? [paused] : method === "getOwners" ? [[addr("1"), addr("d")]] : [2n]);
  } }; provider.provider = provider;
  const readyCall = enabling ? { id: "enable", status: "READY", requiredAdminVotes: 2,
    call: { args: { _func: "setDepositAction", _args: Array.from({length: 5}, (_, i) => ({ value: i === 4 ? true : "0" })) } } }
    : { ...governanceProgress(f.config, f.state).find(item => item.status === "READY"), requiredAdminVotes: 2 };
  const history = []; let voteReads = 0;
  const progress = [];
  const inspection = await inspect(context, artifacts, { staged: true, provider, previousReport, onProgress: line => progress.push(line),
    sourceState: async (_context, _artifacts, _fetch, _signal, options) => {
      assert.equal(options.deferVoteCounts, true);
      return { settings: f.config, state: f.state, calls: [readyCall], errors: sourceErrors, differences: sourceErrors.map(message => ({ code: "ROUTER_UNINITIALIZED", message, governanceCallIds: [readyCall.id] })), voteCountsDeferred: true };
    },
    checkImplementations: async () => [],
    verifyRouter: async (_file, options) => {
      history.push(options.scanHistory);
      const differences = routerMismatch ? ["Selected token permission mismatch"] : [];
      return { paused, historyVerified: options.scanHistory, errors: options.scanHistory && inventoryError ? ["Unexpected permitted route"] : differences, configurationErrors: differences };
    },
    readVaultState: async () => ({ configurationMatches: !vaultMismatch, routerTargetsVault: true,
      safeHasGovernanceRoles: true, guardianCanPause: true, routerOwnerIsSafe: true }),
    fetchVoteCounts: async (_settings, _url, _token, calls) => {
      voteReads++; calls.forEach(call => { call.governanceVoters = [addr("1").slice(2)]; });
      return new Map(calls.map(call => [call.id, 1]));
    },
    fetchImpl: async url => {
      if (!servicesReady) return { ok: false, status: 503 };
      const parsed = new URL(url);
      assert.equal(parsed.hostname, "runtime.example");
      assert.equal(parsed.searchParams.get("deploymentChainId"), "11155111");
      const verifiers = context.manifest.services.verifiers.map((verifier, index) => {
        const policy = context.rollout.verifierPolicies[index];
        return { status: "ok", destinationChainId: "11155111", destinationVault: policy.destinationVault,
          authorizationSigner: context.manifest.authorizationSigners[index], settlementAttestor: policy.settlementAttestor,
          access: { runtimeAccessAddress: runtimeAccessMismatch ? addr("0") : context.manifest.services.runtimeAccessAddress },
          verifierIndex: index + 1, baselinePolicyHash: context.rollout.baselinePolicyHash,
          policyDigest: `sha256:${digest(fs.readFileSync(artifacts.verifierPolicyPaths[index], "utf8"))}`,
          verificationRpcHostCount: 2, verifierConfirmations: verifier.confirmations };
      });
      return { ok: true, json: async () => ({ status: true, deployment: { chainId: "11155111", verifiers } }) };
    },
  });
  return { ...f, context, artifacts, inspection, history, voteReads, progress };
}

test("verification rejects verifiers that trust a different Runtime access address", async t => {
  const { inspection } = await stagedFixture(t, { enabling: true, servicesReady: true, runtimeAccessMismatch: true });
  assert.equal(inspection.report.checks.find(check => check.name === "verifiers").status, "FAILED");
});

test("generate defers history and vote reads while a pause handoff is pending", async t => {
  const { inspection, history, voteReads } = await stagedFixture(t, { paused: false });
  assert.deepEqual(history, [false]);
  assert.equal(voteReads, 0);
  assert.equal(inspection.report.liveVoteCounts.status, "DEFERRED");
  assert.equal(inspection.report.checks.find(c => c.name === "deposit-router").status, "DEFERRED");
  assert.equal(inspection.report.checks.find(c => c.name === "verifiers").status, "DEFERRED");
  assert.equal(inspection.report.safe.executionOrder[0].status, "PENDING");
});

test("configuration approval checks fresh votes without a full historical router scan", async t => {
  const { inspection, history, voteReads } = await stagedFixture(t);
  assert.deepEqual(history, [false]);
  assert.equal(voteReads, 1);
  assert.equal(inspection.report.liveVoteCounts.status, "LIVE");
  assert.equal(inspection.report.calls[0].recordedAdminVotes, 1);
  assert.equal(inspection.report.checks.find(c => c.name === "deposit-router").status, "DEFERRED");
  assert(inspection.report.safe.executionOrder.every(c => c.status === "DONE"));
});

test("activation requires the complete historical inventory and never approves an unexpected route", async t => {
  const { inspection, history, voteReads, context, artifacts } = await stagedFixture(t, { enabling: true, inventoryError: true });
  assert.deepEqual(history, [false, true]);
  assert.equal(inspection.report.checks.find(c => c.name === "deposit-router").status, "FAILED");
  assert.equal(inspection.report.calls[0].status, "BLOCKED");
  assert.equal(voteReads, 0);
  assert.throws(() => activate(context, artifacts, inspection, inspection.report.approvalHash), /gates/);
});

test("successful historical activation verification still requires service readiness", async t => {
  const { inspection, history } = await stagedFixture(t, { enabling: true });
  assert.deepEqual(history, [false, true]);
  assert.equal(inspection.report.checks.find(c => c.name === "deposit-router").status, "PASSED");
  assert.equal(inspection.report.checks.find(c => c.name === "verifiers").status, "FAILED");
  assert.equal(inspection.report.calls[0].status, "BLOCKED");
  assert.notEqual(inspection.report.status, "READY_FOR_ACTIVATION_REVIEW");
});

test("activation verifies private verifier metadata through Runtime", async t => {
  const { inspection } = await stagedFixture(t, { enabling: true, servicesReady: true });
  assert.equal(inspection.report.checks.find(c => c.name === "bridge-health").status, "PASSED");
  assert.equal(inspection.report.checks.find(c => c.name === "verifiers").status, "PASSED");
  assert.equal(inspection.report.calls[0].status, "READY");
});

test("deferred governance evidence cannot validate an admin approval", () => {
  const { validateApprovalCalls } = require("../scripts/externalBridgeRollout");
  const call = { id: "call", call: { args: { _func: "initialize" } } };
  const packet = { calls: [call] };
  const report = { calls: [{ ...call, status: "READY" }], liveVoteCounts: { status: "DEFERRED" } };
  assert.throws(() => validateApprovalCalls(packet, { source: {}, report }), /unavailable/);
  assert.throws(() => validateApprovalCalls(packet, { source: { voteCountsDeferred: true },
    report: { ...report, liveVoteCounts: undefined } }), /unavailable/);
});

test("uncompleted planned configuration is PENDING in both reports and progress", async t => {
  const { inspection, progress } = await stagedFixture(t, { routerMismatch: true, vaultMismatch: true,
    sourceErrors: ["TokenRouter is not initialized"] });
  for (const name of ["strato", "router-configuration", "vault-configuration"]) {
    assert.equal(inspection.report.checks.find(c => c.name === name).status, "PENDING");
    assert(progress.some(line => line.startsWith(`${name}: PENDING`)));
    assert(!progress.some(line => line.startsWith(`${name}: FAILED`)));
  }
  assert.notEqual(inspection.report.status, "READY_FOR_ACTIVATION_REVIEW");
});

test("completed configuration drift remains FAILED across subsequent runs", async t => {
  const first = await stagedFixture(t);
  const second = await stagedFixture(t, { routerMismatch: true, vaultMismatch: true, previousReport: first.inspection.report });
  assert.equal(first.inspection.report.configurationFingerprint, second.inspection.report.configurationFingerprint);
  const third = await stagedFixture(t, { routerMismatch: true, vaultMismatch: true, previousReport: second.inspection.report });
  for (const inspection of [second.inspection, third.inspection]) {
    for (const name of ["router-configuration", "vault-configuration"]) assert.equal(inspection.report.checks.find(c => c.name === name).status, "FAILED");
  }
});

test("STRATO pending status covers unfinished steps but excludes unsafe state and completed-call drift", t => {
  const { expectedSourceDifferences } = require("../scripts/externalBridgeRollout");
  const f = fixture(t); initialized(f);
  const chain = f.config.chains[0], route = chain.routes[0]; route.autoRouteEnabled = true;
  const calls = governanceProgress(f.config, f.state, { stage: "activation", activationErrors: [] });
  const methods = ["setMintPolicy", "setChain", "addWhitelist", "setDepositAction"];
  const differences = methods.map((method, index) => ({ code: `PLANNED_${index}`, message: `Human wording ${index}`,
    governanceCallIds: calls.filter(c => c.call.args._func === method).map(c => c.id) }));
  const source = { calls, settings: f.config, state: f.state, errors: differences.map(d => d.message), differences };
  assert.equal(expectedSourceDifferences(source), true);
  assert.equal(expectedSourceDifferences({ ...source, errors: [...source.errors, "Unexpected enabled route"],
    differences: [...differences, { code: "UNEXPECTED_ENABLED_ROUTE", governanceCallIds: [] }] }), false);
  const mint = calls.find(c => c.call.args._func === "setMintPolicy");
  assert.equal(expectedSourceDifferences(source, new Set([mint.id])), false);
  assert.equal(expectedSourceDifferences({ ...source, differences: undefined }), false);

});

test("implementation reads retry only unsupported numbered state at the same pinned block", async t => {
  const f = fixture(t), { ethers } = require("ethers");
  const { checkImplementations } = require("../scripts/externalBridgeRollout");
  const artifacts = new Map([[addr("a"), "ExternalBridgeVault"], [addr("b"), "ExternalAssetDepositRouter"]].map(([address, name]) =>
    [address, readJson(path.resolve(__dirname, `../artifacts/contracts/bridge/${name}.sol/${name}.json`)).deployedBytecode]));
  const blocks = []; let reads = 0, heads = 0;
  const provider = {
    getBlockNumber: async () => { heads++; return 1234; },
    getStorage: async (proxy, _slot, block) => {
      blocks.push(block); reads++;
      if (reads === 1) throw Object.assign(new Error("could not coalesce error"), { error: { code: -32000, message: "unsupported block number 1234" } });
      return ethers.zeroPadValue(proxy === addr("2") ? addr("a") : addr("b"), 32);
    },
    getCode: async (address, block) => { blocks.push(block); return artifacts.get(address.toLowerCase()); },
  };
  assert.equal((await checkImplementations(f.context, provider)).length, 2);
  assert.equal(heads, 1);
  assert.equal(reads, 3);
  assert(blocks.every(block => block === 1234));
  let failures = 0;
  await assert.rejects(checkImplementations(f.context, { ...provider, getStorage: async () => {
    failures++; throw Object.assign(new Error("RPC rejected block"), { error: { code: -32000, message: "unsupported block number 1234" } });
  } }), /after three attempts/);
  assert.equal(failures, 3);
  failures = 0;
  await assert.rejects(checkImplementations(f.context, { ...provider, getStorage: async () => {
    failures++; throw new Error("RPC unavailable");
  } }), /RPC unavailable/);
  assert.equal(failures, 1);
});

test("approval reports a failed external identity before deferred vote diagnostics", () => {
  const { validateApprovalCalls } = require("../scripts/externalBridgeRollout");
  const inspection = { source: { voteCountsDeferred: true }, report: { calls: [],
    liveVoteCounts: { status: "DEFERRED" }, checks: [{ name: "external-identity", status: "FAILED", error: "External RPC cannot serve pinned block" }] } };
  assert.throws(() => validateApprovalCalls({ calls: [] }, inspection), /Approval blocked by external-identity: External RPC/);
  assert.throws(() => validateApprovalCalls({ calls: [] }, { ...inspection,
    report: { ...inspection.report, checks: [] } }), /Live AdminRegistry vote counts are unavailable/);
});


test("preparation refuses unresolved reviewed limits even when identities need provisioning", t => {
  const f = fixture(t);
  f.manifest.services.confirmations = 12;
  f.manifest.policy.tokens[addr("b")].bucketCapacity = "REVIEW_REQUIRED";
  writeJson(f.manifestPath, f.manifest);
  const script = path.resolve(__dirname, "../scripts/externalBridgeRollout.js");
  const run = spawnSync(process.execPath, [script, "prepare", "--manifest", f.manifestPath], { encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.doesNotMatch(run.stdout, /PROVISIONING_PACKAGE_READY/);
});

test("current action is shared by saved reports and terminal output", () => {
  const args = { manifest: "/secure/deployment.json" };
  const cases = [
    [{ previousStageCompleted: true }, "RERUN_GENERATE"],
    [{ operationError: "Approval is stale; reconcile" }, "RERUN_GENERATE"],
    [{ status: "PENDING", nativeAction: { action: "EXECUTE_NATIVE_SAFE_TRANSACTION", file: "native.json" },
      adminApproval: { run: "expired-command" } }, "EXECUTE_NATIVE_SAFE_TRANSACTION"],
  ];
  for (const [report, expected] of cases) {
    const resolved = resolveNextAction(report, args);
    report.nextAction = resolved.nextAction;
    assert.equal(report.nextAction.action, expected);
    assert.deepEqual(terminalSummary(report, "report.json"), { ...report.nextAction, details: "report.json" });
  }
});

test("native progress changes with reviewed bindings and guardian, not reporting revisions", t => {
  const { nativeConfigurationFingerprint } = require("../scripts/externalBridgeRollout");
  const f = fixture(t); completeHandoff(f, true);
  const context = loadManifest(f.manifestPath, "activation");
  const hash = nativeConfigurationFingerprint(context);
  context.revision = "a-reporting-only-change";
  assert.equal(nativeConfigurationFingerprint(context), hash);
  context.settings.guardian = addr("f");
  assert.notEqual(nativeConfigurationFingerprint(context), hash);
});


test("an active combined rollout refreshes native progress only after read-only validation", async t => {
  const { advanceNative, nativeCoordinatorAction, nativeConfigurationFingerprint } = require("../scripts/externalBridgeRollout");
  const f = fixture(t); completeHandoff(f, true);
  const context = loadManifest(f.manifestPath, "activation");
  const output = path.join(f.directory, ".deployment");
  const report = { status: "DEPOSITS_ACTIVE_CANARY_REQUIRED", calls: [], operator: {}, safe: { executionOrder: [] } };
  for (const stage of ["configured", "active"]) writeJson(path.join(output, `native-${stage}.json`), { fingerprint: "old-code-fingerprint" });
  let validations = 0;
  const options = { verifyNativeActivation: async () => { validations++; },
    nativeHandoff: async () => { throw new Error("active configuration must not be repeated"); } };
  assert.equal(await advanceNative(context, f.artifacts, report, output, f.manifestPath, {}, options), undefined);
  assert.equal(validations, 1);
  assert.equal(nativeCoordinatorAction(context, report, output, f.manifestPath), undefined);
  assert.equal(readJson(path.join(output, "native-active.json")).fingerprint, nativeConfigurationFingerprint(context));
  writeJson(path.join(output, "native-active.json"), { fingerprint: "unverified" });
  await assert.rejects(advanceNative(context, f.artifacts, report, output, f.manifestPath, {}, {
    ...options, verifyNativeActivation: async () => { throw new Error("native configuration drift"); },
  }), /native configuration drift/);
  assert.equal(readJson(path.join(output, "native-active.json")).fingerprint, "unverified");
});


function remainingConfiguration(t, { required = () => 2, lag = false } = {}) {
  const { governanceBatch } = require("../scripts/lib/externalBridgeOrchestration");
  const f = fixture(t); configured(f);
  const chain = f.config.chains[0];
  chain.routes[0].rebaseRequired = true;
  chain.routes.forEach(route => { route.autoRouteEnabled = true; });
  f.state.routes.chains.clear(); f.state.routes.routes.clear(); f.state.routes.rebaseRequired.clear();
  const admins = [addr("8").slice(2), addr("9").slice(2), addr("a").slice(2)];
  const votes = new Map(), sends = [], executions = [];
  let actor = admins[0], staleState, waitCount = 0;
  const read = async () => {
    const calls = governanceProgress(f.config, staleState || f.state, { stage: "activation", activationErrors: [] });
    for (const item of calls) {
      item.governanceAdmins = admins;
      item.governanceVoters = [...(votes.get(item.id) || [])];
      item.requiredAdminVotes = required(item);
      item.recordedAdminVotes = item.governanceVoters.length;
    }
    return { calls, inactiveTokens: [] };
  };
  const inspect = async () => {
    const source = await read();
    return { source, externalReady: true, router: { paused: true }, report: {
      approvalHash: "batch", calls: source.calls, checks: [{ name: "strato", status: "PENDING" }], liveVoteCounts: { status: "LIVE" },
    } };
  };
  const options = {
    stateless: true, indexWaitMs: 1000,
    fetchImpl: async () => ({ ok: true, json: async () => ({ address: `0x${actor}` }) }),
    sourceState: read,
    wait: async () => { waitCount++; staleState = undefined; },
    submit: async (_user, call, record) => {
      const id = digest(call), item = (await read()).calls.find(item => item.id === id);
      assert(item, "only a call from the reviewed configuration can be submitted");
      const voters = votes.get(id) || new Set();
      assert(!voters.has(actor), "a prior vote must not be submitted again");
      voters.add(actor); votes.set(id, voters); sends.push({ id, actor, method: call.args._func });
      if (voters.size >= item.requiredAdminVotes) {
        assert.equal(item.status, "READY", "dependent calls must not execute before prerequisites");
        const values = call.args._args.map(arg => arg.value);
        if (call.args._func === "setChain") {
          if (lag) staleState = structuredClone(f.state);
          f.state.routes.chains.set(String(values[4]), { ...chain, enabled: values[3], lastProcessedBlock: values[5] });
        } else if (call.args._func === "setRoute") {
          const route = chain.routes.find(route => route.externalToken === values[0] && route.stratoToken === values[2]);
          f.state.routes.routes.set(`${values[0]}:${values[1]}:${values[2]}`, { ...route });
        } else if (call.args._func === "setRouteRebaseRequired") {
          const key = `${values[0]}:${values[1]}:${values[2]}`;
          values[3] ? f.state.routes.rebaseRequired.add(key) : f.state.routes.rebaseRequired.delete(key);
        } else throw new Error(`Unexpected mutation ${call.args._func}`);
        votes.delete(id); executions.push(call.args._func);
      }
      await record([`tx-${sends.length}`]);
      return { status: "VOTED", hashes: [`tx-${sends.length}`] };
    },
  };
  return { f, inspect, options, read, sends, executions, admins, votes, setActor: value => { actor = value; },
    batch: governanceBatch, waitCount: () => waitCount };
}

test("one reviewed batch resumes a partial rollout and completes dependencies with two admins", async t => {
  const { createApprovalRequest, decodeApprovalRequest, validateApprovalCalls } = require("../scripts/externalBridgeRollout");
  const h = remainingConfiguration(t), initial = await h.inspect();
  const request = createApprovalRequest({ schemaVersion: 1 }, initial.report);
  assert.equal(request.packet.phase, "configuration");
  assert.equal(request.packet.calls.length, 3);
  assert.deepEqual(request.packet.calls.map(item => item.call.args._func), ["setChain", "setRoute", "setRouteRebaseRequired"]);
  assert(!request.packet.calls.some(item => item.call.args._func === "initialize" || item.call.args._func === "setDepositAction"));
  const approved = validateApprovalCalls(request.packet, initial);
  const inspection = { ...initial, report: { ...initial.report, calls: approved } };
  const first = await vote(h.f.context, h.f.artifacts, inspection, "batch", h.options);
  assert.equal(first.length, 3); assert.equal(h.sends.length, 3); assert.equal(h.executions.length, 0);
  const retry = await vote(h.f.context, h.f.artifacts, inspection, "batch", h.options);
  assert(retry.every(result => result.status === "ALREADY_VOTED")); assert.equal(h.sends.length, 3);
  h.setActor(h.admins[1]);
  const current = await h.inspect();
  const second = await vote(h.f.context, h.f.artifacts, { ...current, report: { ...current.report,
    calls: validateApprovalCalls(request.packet, current) } }, "batch", h.options);
  assert.equal(second.length, 3); assert.equal(h.sends.length, 6);
  assert.deepEqual(h.executions, ["setChain", "setRoute", "setRouteRebaseRequired"]);
  const completed = await h.inspect();
  assert(validateApprovalCalls(request.packet, completed).every(item => item.status === "COMPLETE"));
  assert.deepEqual(h.batch(completed.report).calls.map(item => item.call.args._func), ["setChain", "setDepositAction"]);
  assert.equal(h.batch(completed.report).phase, "activation");
});

test("batch waits briefly for indexed prerequisite execution and then finishes in the same command", async t => {
  const h = remainingConfiguration(t, { lag: true });
  const first = await h.inspect(); await vote(h.f.context, h.f.artifacts, first, "batch", h.options);
  h.setActor(h.admins[1]);
  const second = await h.inspect(); await vote(h.f.context, h.f.artifacts, second, "batch", h.options);
  assert.equal(h.waitCount(), 1); assert.equal(h.executions.length, 3); assert.equal(h.sends.length, 6);
});

test("dependent votes that would execute under a lower threshold wait for prerequisites", async t => {
  const h = remainingConfiguration(t, { required: item => item.call.args._func === "setRoute" ? 1 : 2 });
  const inspection = await h.inspect();
  const result = await vote(h.f.context, h.f.artifacts, inspection, "batch", h.options);
  assert.deepEqual(h.sends.map(item => item.method), ["setChain"]);
  assert.equal(result.at(-1).status, "WAITING_FOR_PREREQUISITES");
  assert.equal(h.executions.length, 0); assert.equal(h.waitCount(), 0);
});

test("an interrupted batch resumes after fresh reconciliation without repeating votes", async t => {
  const h = remainingConfiguration(t), inspection = await h.inspect();
  let count = 0;
  await assert.rejects(vote(h.f.context, h.f.artifacts, inspection, "batch", { ...h.options,
    submit: async (...args) => { const receipt = await h.options.submit(...args); if (++count === 2) throw new Error("response lost after submitted vote"); return receipt; },
  }), /response lost/);
  assert.equal(h.sends.length, 2);
  const resumed = await h.inspect();
  const result = await vote(h.f.context, h.f.artifacts, resumed, "batch", h.options);
  assert.equal(h.sends.length, 3);
  assert.equal(result.filter(item => item.status === "ALREADY_VOTED").length, 2);
});

test("batch rejects changed arguments, missing parents, non-admin identities and expiry", async t => {
  const { createApprovalRequest, validateApprovalCalls } = require("../scripts/externalBridgeRollout");
  const h = remainingConfiguration(t), initial = await h.inspect();
  const packet = createApprovalRequest({ schemaVersion: 1 }, initial.report).packet;
  assert.throws(() => validateApprovalCalls({ ...packet, calls: packet.calls.slice(1) }, initial), /prerequisite/);
  const changed = structuredClone(packet); changed.calls[1].call.args._args[3].value = false;
  assert.throws(() => validateApprovalCalls(changed, initial), /changed/);
  h.setActor(addr("b").slice(2));
  await assert.rejects(vote(h.f.context, h.f.artifacts, initial, "batch", h.options), /not an admin/);
  assert.equal(h.sends.length, 0);
  h.setActor(h.admins[0]);
  await assert.rejects(vote(h.f.context, h.f.artifacts, initial, "batch", { ...h.options, approvalExpiresAt: Date.now() - 1 }), /expired/);
  assert.equal(h.sends.length, 0);
});

test("chain conflicts remain hard blockers even while token permissions are pending", t => {
  const { governanceBatch } = require("../scripts/lib/externalBridgeOrchestration");
  const f = fixture(t); configured(f);
  f.state.routes.chains.get(String(f.config.chains[0].externalChainId)).vault = addr("f");
  f.state.permissionErrors = [`Missing bridge mint permission for STRATO token ${f.config.chains[0].routes[0].stratoToken}`];
  const calls = governanceProgress(f.config, f.state);
  assert.equal(calls.find(item => item.call.args._func === "setChain").reasonCode, "CHAIN_CONFLICT");
  assert.equal(governanceBatch({ calls }).calls.length, 0);
});

test("default rebase flags do not create stale future governance issues", t => {
  const { governanceBatch } = require("../scripts/lib/externalBridgeOrchestration");
  const f = fixture(t); initialized(f);
  const calls = governanceProgress(f.config, f.state);
  assert(calls.filter(item => item.call.args._func === "setRouteRebaseRequired").every(item => item.status === "COMPLETE"));
  assert(!governanceBatch({ calls }).calls.some(item => item.call.args._func === "setRouteRebaseRequired"));
});


test("new EAB chains stay disabled through configuration and require readiness before enablement", t => {
  const { governanceBatch, isActivationCall } = require("../scripts/lib/externalBridgeOrchestration");
  const f = fixture(t); configured(f);
  const chain = f.config.chains[0];
  f.state.routes.chains.delete(String(chain.externalChainId));
  const initial = governanceProgress(f.config, f.state);
  const configuredChain = initial.find(item => item.call.args._func === "setChain" && !isActivationCall(item));
  assert.equal(configuredChain.call.args._args[3].value, false);
  assert.equal(governanceBatch({ calls: initial }).phase, "configuration");
  assert(governanceBatch({ calls: initial }).calls.every(item => !isActivationCall(item)));
  f.state.routes.chains.set(String(chain.externalChainId), { ...chain, enabled: false, lastProcessedBlock: "2000" });
  for (const route of chain.routes) f.state.actions.actionConfigs.set(`${route.externalToken}:${chain.externalChainId}:${route.stratoToken}`, { autoRoute: route.autoRouteEnabled });
  for (const options of [{ stage: "initial" }, { stage: "activation", activationErrors: ["runtime unavailable"] }]) {
    const calls = governanceProgress(f.config, f.state, options);
    const activation = calls.find(item => item.call.args._func === "setChain" && isActivationCall(item));
    assert.equal(activation.status, "BLOCKED");
    assert.equal(governanceBatch({ calls }).calls.length, 0);
  }
  const calls = governanceProgress(f.config, f.state, { stage: "activation", activationErrors: [] });
  const batch = governanceBatch({ calls });
  assert.equal(batch.phase, "activation");
  const enable = batch.calls.find(item => item.call.args._func === "setChain");
  assert.equal(enable.call.args._args[3].value, true);
  assert.equal(enable.call.args._args[5].value, "2000");
  assert.equal(enable.status, "READY");
  f.state.routes.chains.get(String(chain.externalChainId)).enabled = true;
  assert(governanceProgress(f.config, f.state, { stage: "activation", activationErrors: [] })
    .filter(item => item.call.args._func === "setChain").every(item => item.status === "COMPLETE"));
});
