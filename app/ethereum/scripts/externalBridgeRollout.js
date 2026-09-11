const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
require("dotenv").config({ quiet: true });
const { ethers } = require("ethers");
const {
  CONTRACTS, digest, readJson, writeJson, address, bool, initializeManifest, loadManifest,
  generate, governanceProgress, currentCursorSettings, loadConfig,
} = require("./lib/externalBridgeOrchestration");
const verification = require("../../contracts/deploy/external-bridge-verification");
const { buildPlan, submit } = require("../../contracts/deploy/configure-external-bridge");
const { normalizeConfig } = require("./lib/externalBridgeVaultPlan");
const { readState } = require("./externalBridgeVaultOps");
const { verifyFromManifest } = require("./scanTokenConfig");
const { buildDepositRouterControl } = require("./generateExternalBridgeRollout");

const TIMEOUT_MS = 30_000;
function parseArgs(argv) {
  const command = argv[0]?.startsWith("--") ? "plan" : argv.shift() || "plan";
  if (!["init", "plan", "resume", "verify", "vote", "activate"].includes(command)) throw new Error("Use init|plan|resume|verify|vote|activate");
  const args = { command };
  const allowed = command === "init" ? ["manifest", "settings", "policy"] : ["manifest", "output-dir", "stage", ...(["vote", "activate"].includes(command) ? ["approve"] : [])];
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index].replace(/^--/, "");
    if (!argv[index].startsWith("--") || !allowed.includes(name) || !argv[index + 1] || argv[index + 1].startsWith("--") || args[name]) throw new Error(`Invalid or duplicate option ${argv[index]}`);
    args[name] = argv[index + 1];
  }
  if (!args.manifest || (command === "init" && !args.settings)) throw new Error("--manifest is required; init also requires --settings");
  if (["vote", "activate"].includes(command) && !/^[a-f0-9]{64}$/.test(args.approve || "")) throw new Error("Explicit --approve <approvalHash> from the reviewed resume report is required");
  if (args.stage && !["initial", "activation"].includes(args.stage)) throw new Error("--stage must be initial|activation");
  return args;
}

function redact(message, env = process.env, secretNames = []) {
  let result = String(message);
  for (const [name, value] of Object.entries(env)) {
    if (value?.length >= 8 && (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|RPC.*URL|API_KEY/.test(name) || secretNames.includes(name))) result = result.split(value).join("[REDACTED]");
  }
  return result.replace(/https?:\/\/[^\s"<>]+/g, (url) => {
    try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}/[REDACTED]`; } catch { return "[REDACTED URL]"; }
  });
}

const redactFor = (context, message) => redact(message, process.env, [
  context.manifest.services.sourceTokenEnv, context.manifest.services.rpcUrlEnv,
  ...context.manifest.services.verifiers.map(({ tokenEnv }) => tokenEnv),
]);

async function jsonFetch(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function sourceState(context, artifacts, fetchImpl = fetch) {
  const { services } = context.manifest;
  const token = process.env[services.sourceTokenEnv];
  if (!token) throw new Error(`Set ${services.sourceTokenEnv} to a STRATO access token`);
  const metadata = await jsonFetch(`${services.nodeUrl.replace(/\/$/, "")}/eth/v1.2/metadata`, token, fetchImpl);
  if (typeof metadata.networkID === "number" && !Number.isSafeInteger(metadata.networkID)) throw new Error("Unsafe numeric STRATO network ID");
  if (String(metadata.networkID) !== context.settings.sourceChainId) throw new Error("STRATO node chain ID does not match the manifest");
  const settings = loadConfig(artifacts.bridgeConfigPath);
  const boundedFetch = (url, options) => fetchImpl(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const args = [settings, services.nodeUrl, token, boundedFetch];
  await verification.validateDeploymentDependencies(...args);
  const [initialization, routes, actions, permissionErrors, inactiveTokens] = await Promise.all([
    verification.fetchInitializationState(...args), verification.fetchRouteState(...args),
    verification.fetchActionState(...args), verification.validateRoutePermissions(...args), verification.validateActiveRouteTokens(...args),
  ]);
  const state = { initialization, routes, actions, permissionErrors };
  // Before enabling, accept already-enabled desired routes and verify all remaining actions are disabled.
  const beforeEnable = { ...settings, chains: settings.chains.map((chain) => ({ ...chain,
    routes: chain.routes.map((route) => ({ ...route, autoRouteEnabled: route.autoRouteEnabled && bool(
      actions.actionConfigs.get(`${address(route.externalToken)}:${chain.externalChainId}:${address(route.stratoToken)}`)?.autoRoute),
    })),
  })) };
  const prerequisiteErrors = [
    ...verification.compareInitialization(settings, initialization),
    ...verification.compareRoutes(currentCursorSettings(settings, routes), routes),
    ...permissionErrors, ...inactiveTokens,
  ];
  const activationErrors = [...prerequisiteErrors, ...verification.compareActions(beforeEnable, actions)];
  return { settings, state, inactiveTokens, calls: governanceProgress(settings, state, { stage: context.stage, activationErrors }), errors: [
    ...prerequisiteErrors, ...verification.compareActions(settings, actions),
    ...(initialization.bridge.depositsPaused === false || initialization.bridge.depositsPaused === "false" ? [] : ["STRATO deposit settlement is paused or its pause state is unavailable"]),
  ] };
}

async function checkImplementations(context, provider) {
  const results = [];
  const slot = ethers.toBeHex(BigInt(ethers.keccak256(ethers.toUtf8Bytes("eip1967.proxy.implementation"))) - 1n, 32);
  const block = await provider.getBlockNumber();
  for (const [field, name] of [["externalBridgeVault", "ExternalBridgeVault"], ["depositRouter", "DepositRouter"]]) {
    const entry = context.deployment[field];
    const actual = ethers.getAddress(`0x${(await provider.getStorage(entry.proxy, slot, block)).slice(-40)}`);
    if (address(actual) !== address(entry.implementation)) throw new Error(`${name} implementation differs from deployment artifact`);
    const artifactPath = path.resolve(__dirname, `../artifacts/contracts/bridge/${name}.sol/${name}.json`);
    const artifact = readJson(artifactPath);
    const debugPath = artifactPath.replace(/\.json$/, ".dbg.json");
    const build = readJson(path.resolve(path.dirname(debugPath), readJson(debugPath).buildInfo));
    const sources = new Set([artifact.sourceName]);
    for (const sourceName of sources) {
      const source = build.input.sources[sourceName];
      const sourceFile = path.resolve(__dirname, "..", sourceName.startsWith("@") ? "node_modules" : "", sourceName);
      if (fs.readFileSync(sourceFile, "utf8") !== source.content) throw new Error("Local contract build is stale; compile the approved release before verification");
      for (const node of build.output.sources[sourceName].ast.nodes) {
        if (node.nodeType === "ImportDirective") sources.add(node.absolutePath);
      }
    }
    const compiled = build.output.contracts[artifact.sourceName][name].evm.deployedBytecode;
    const code = await provider.getCode(actual, block);
    const mask = (hex) => {
      const bytes = Buffer.from(hex.replace(/^0x/, ""), "hex");
      for (const ranges of Object.values(compiled.immutableReferences || {})) {
        for (const { start, length } of ranges) bytes.fill(0, start, start + length);
      }
      return bytes;
    };
    if (code === "0x" || code.length !== compiled.object.length + 2 || !mask(code).equals(mask(compiled.object))) throw new Error(`${name} deployed bytecode does not match the local build; verify or replace the old deployment`);
    results.push({ name, proxy: entry.proxy, implementation: actual, codeHash: ethers.keccak256(code), block });
  }
  return results;
}

async function inspect(context, artifacts, options = {}) {
  const checks = [];
  const check = async (name, work) => {
    try {
      const data = await work();
      const errors = data?.errors || [];
      checks.push({ name, status: errors.length ? "FAILED" : "PASSED", data });
      return data;
    } catch (error) { checks.push({ name, status: "FAILED", error: redactFor(context, error.message) }); return undefined; }
  };
  const source = await check("strato", () => (options.sourceState || sourceState)(context, artifacts));
  // Maps/sets are only used for reconciliation; persist the actionable errors and cursor evidence.
  if (source) checks.find((item) => item.name === "strato").data = { errors: source.errors,
    cursors: source.settings.chains.map((chain) => ({ chainId: chain.externalChainId, configuredStart: chain.lastProcessedBlock,
      live: source.state.routes.chains.get(chain.externalChainId)?.lastProcessedBlock })) };
  let router;
  let externalReady = false;
  const rpcUrl = process.env[context.manifest.services.rpcUrlEnv];
  if (!rpcUrl || !/^https:\/\//.test(rpcUrl)) checks.push({ name: "external", status: "FAILED", error: `Set HTTPS ${context.manifest.services.rpcUrlEnv}` });
  else {
    const request = new ethers.FetchRequest(rpcUrl);
    request.timeout = TIMEOUT_MS;
    const provider = options.provider || new ethers.JsonRpcProvider(request, undefined, { cacheTimeout: -1 });
    try {
      const identity = await check("external-identity", async () => {
        if ((await provider.getNetwork()).chainId !== BigInt(context.rollout.chainId)) throw new Error("External RPC chain ID mismatch");
        return (options.checkImplementations || checkImplementations)(context, provider);
      });
      if (identity) {
        const pause = await check("withdrawal-pause", async () => {
          const vault = new ethers.Contract(context.rollout.vaultConfig.chains[0].vaultAddress, ["function paused() view returns (bool)"], provider);
          if (!(await vault.paused())) throw new Error("External vault must remain paused for this deposit-only rollout");
          return { paused: true };
        });
        externalReady = !!pause;
        router = await check("deposit-router", async () => {
          const contract = new ethers.Contract(context.rollout.depositRouter.address, ["function paused() view returns (bool)"], provider);
          const paused = await contract.paused();
          return verifyFromManifest(artifacts.manifestPath, { expectedPaused: paused, provider, quiet: true });
        });
        await check("safe-runtime-identities", async () => {
          const { safeProposerAddress, executorAddress } = context.manifest.services;
          const identities = [safeProposerAddress, executorAddress, ...context.manifest.authorizationSigners];
          if (identities.length !== 5 || identities.some((value) => !ethers.isAddress(value)) || new Set(identities.map(address)).size !== 5) throw new Error("Configure five distinct proposer, executor and verifier KMS addresses");
          const safe = new ethers.Contract(context.rollout.vaultConfig.chains[0].safeAddress,
            ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"], provider);
          const [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
          if (threshold < 2n || !owners.map(address).includes(address(safeProposerAddress)) || owners.map(address).includes(address(executorAddress))) throw new Error("Safe must include the proposer, exclude the executor, and require at least two owners");
          return { owners: [...owners], threshold: String(threshold), executorAddress, safeProposerAddress };
        });
        await check("vault-configuration", async () => {
          const config = normalizeConfig(context.rollout.vaultConfig);
          const base = path.resolve(__dirname, "../artifacts/contracts/bridge");
          const state = await readState(config, config.chains[0], readJson(`${base}/ExternalBridgeVault.sol/ExternalBridgeVault.json`), readJson(`${base}/DepositRouter.sol/DepositRouter.json`), provider);
          return { ...state, errors: state.configurationMatches && state.routerTargetsVault && state.safeHasGovernanceRoles && state.guardianCanPause && state.routerOwnerIsSafe ? [] : ["Vault policies, signer set, governance roles, or router binding differ"] };
        });
      }
    } finally { if (!options.provider) provider.destroy(); }
  }
  await check("verifiers", async () => {
    const services = context.manifest.services;
    if (!Number.isSafeInteger(services.confirmations) || services.confirmations <= 0) throw new Error("Approve services.confirmations as a positive integer");
    if (services.verifiers.length !== 3 || context.manifest.authorizationSigners.length !== 3) throw new Error("Configure three verifier endpoints and KMS addresses in the manifest");
    const urls = new Set();
    const tokens = new Set();
    for (const verifier of services.verifiers) {
      const url = new URL(verifier.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Verifier base URLs must be HTTPS without embedded credentials or query strings");
      const token = process.env[verifier.tokenEnv];
      if (!token || tokens.has(token) || urls.has(url.href)) throw new Error("Verifier tokens and URLs must be present and distinct");
      urls.add(url.href); tokens.add(token);
    }
    const metadata = await Promise.all(services.verifiers.map(async (verifier, index) => {
      const data = await jsonFetch(`${verifier.url.replace(/\/$/, "")}/health`, process.env[verifier.tokenEnv], options.fetchImpl);
      const policy = context.rollout.verifierPolicies[index];
      if (data.status !== "ok" || String(data.destinationChainId) !== String(context.rollout.chainId) ||
          address(data.destinationVault) !== address(policy.destinationVault) || address(data.authorizationSigner) !== address(context.manifest.authorizationSigners[index]) ||
          address(data.settlementAttestor) !== address(policy.settlementAttestor) || data.verifierIndex !== index + 1 ||
          data.baselinePolicyHash !== context.rollout.baselinePolicyHash ||
          data.policyDigest !== `sha256:${digest(fs.readFileSync(artifacts.verifierPolicyPaths[index], "utf8"))}` ||
          !Number.isSafeInteger(data.verificationRpcHostCount) || data.verificationRpcHostCount < 2 ||
          !Number.isSafeInteger(data.verifierConfirmations) || data.verifierConfirmations < services.confirmations) throw new Error(`Verifier ${index + 1} identity, policy, or confirmation mismatch`);
      return data;
    }));
    return metadata;
  });
  await check("bridge-health", async () => {
    const url = context.manifest.services.bridgeHealthUrl;
    if (!url || !/^https:\/\//.test(url)) throw new Error("Configure services.bridgeHealthUrl after Runtime deployment");
    const data = await jsonFetch(url, undefined, options.fetchImpl);
    if (data.status !== true) throw new Error("Bridge health is not ready");
    return data;
  });
  const calls = source?.calls || [];
  for (const item of calls) {
    if (item.status === "READY" && item.call.args._func === "setDepositAction" && item.call.args._args[4].value === true &&
        (!externalReady || router?.paused !== true || checks.some(({ name, status }) => name !== "strato" && status !== "PASSED"))) {
      item.status = "BLOCKED";
      item.reason = "Activation requires verified policy artifacts, verifier policies, vault/router configuration and service health";
    }
  }
  const ready = checks.every(({ status }) => status === "PASSED");
  const report = {
    revision: context.revision, observedAt: new Date().toISOString(), checks, calls,
    status: ready ? (router.paused ? "READY_FOR_ACTIVATION_REVIEW" : "DEPOSITS_ACTIVE_CANARY_REQUIRED") : "PENDING",
    approvalHash: digest({ revision: context.revision, calls: calls.map(({ id, status }) => ({ id, status })), ready, routerPaused: router?.paused }),
    safe: { vaultPause: artifacts.vaultPausePath, vaultConfigure: artifacts.vaultConfigurePath,
      routerPause: artifacts.depositRouterPausePath, routerTokens: artifacts.depositRouterBatchPaths },
    next: !source ? "Resolve STRATO read access before voting" : calls.some(({ status }) => status === "READY") ? "Review READY governance calls and run vote with approvalHash" : !ready ? "Resolve failed checks; execute only the pending reviewed Safe configuration; rerun resume" : router.paused ? "Review activation, then generate the Safe unpause file with activate --approve" : "Reconcile canary custody and issuance before declaring launch complete",
  };
  return { report, source, externalReady, router };
}

async function vote(context, artifacts, inspection, approval, options = {}) {
  if (inspection.report.approvalHash !== approval) throw new Error("Approval is stale; review a fresh resume report");
  if (!inspection.source || !inspection.externalReady || inspection.router?.paused !== true) throw new Error("Voting requires verified external code, paused vault/router, and readable STRATO state");
  if (inspection.source.inactiveTokens?.length || inspection.report.calls.some(({ status, call }) => status === "BLOCKED" && call.args._func === "initialize")) {
    throw new Error("Resolve inactive tokens or conflicting initialization before voting");
  }
  const token = process.env[context.manifest.services.sourceTokenEnv];
  const nodeUrl = context.manifest.services.nodeUrl;
  const identity = await jsonFetch(`${nodeUrl.replace(/\/$/, "")}/strato/v2.3/key`, token, options.fetchImpl);
  if (!/^[a-f0-9]{40}$/.test(address(identity.address))) throw new Error("Unable to resolve STRATO voter identity");
  const config = require(path.join(CONTRACTS, "config"));
  config.nodes[0].url = nodeUrl;
  const journalFile = path.join(artifacts.directory, `votes-${address(identity.address)}.json`);
  const journal = fs.existsSync(journalFile) ? readJson(journalFile) : {};
  const submitted = [];
  for (const item of inspection.report.calls.filter(({ status }) => status === "READY")) {
    const enabling = item.call.args._func === "setDepositAction" && item.call.args._args[4].value === true;
    const refreshed = enabling ? await (options.inspect || inspect)(context, artifacts) : undefined;
    if (enabling && (!refreshed.externalReady || refreshed.router?.paused !== true ||
        refreshed.report.calls.find(({ id }) => id === item.id)?.status !== "READY")) {
      throw new Error("Activation gates changed; stop and review before voting");
    }
    const fresh = refreshed?.source || await (options.sourceState || sourceState)(context, artifacts);
    if (fresh.inactiveTokens?.length) throw new Error("Token status changed; stop and review before voting");
    if (fresh.calls.find(({ id }) => id === item.id)?.status !== "READY") continue;
    if (journal[item.id]) {
      const previous = journal[item.id];
      if (!previous.hashes?.length) throw new Error(`Uncertain prior submission for ${item.id}; reconcile chain evidence before retrying`);
      const results = await (options.receipts || (async (hashes) => {
        const { rest } = require(require.resolve("blockapps-rest", { paths: [CONTRACTS] }));
        return rest.getBlocResults({ token }, hashes, { config, isAsync: true });
      }))(previous.hashes);
      if (!Array.isArray(results) || results.length !== previous.hashes.length || results.some((result) => result.status !== "Success" || !previous.hashes.includes(result.hash)) || new Set(results.map((result) => result.hash)).size !== results.length) throw new Error(`Prior vote ${item.id} is pending, failed, or unavailable; reconcile before retrying`);
      submitted.push({ id: item.id, status: "WAITING_FOR_QUORUM", hashes: previous.hashes });
      continue;
    }
    journal[item.id] = { status: "SUBMITTING", call: item.call };
    writeJson(journalFile, journal);
    try {
      const receipt = await (options.submit || submit)({ token }, item.call, async (hashes) => {
        journal[item.id].hashes = hashes;
        writeJson(journalFile, journal);
      });
      journal[item.id] = { ...journal[item.id], status: "VOTED", receipt };
      writeJson(journalFile, journal);
      submitted.push({ id: item.id, ...receipt, note: "Vote succeeded; execution is established by the next live reconciliation" });
    } catch (error) {
      journal[item.id].error = redactFor(context, error.message);
      writeJson(journalFile, journal);
      throw error;
    }
  }
  return submitted;
}

function activate(context, artifacts, inspection, approval) {
  const report = inspection.report;
  if (report.approvalHash !== approval) throw new Error("Approval is stale; review a fresh resume report");
  if (report.status !== "READY_FOR_ACTIVATION_REVIEW") throw new Error("Activation gates are not satisfied or deposits are already active");
  const file = path.join(artifacts.directory, `router-unpause-${approval}.json`);
  writeJson(file, buildDepositRouterControl(context.rollout, "unpause"));
  return file;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs([...argv]);
  const manifestPath = path.resolve(args.manifest);
  if (args.command === "init") {
    initializeManifest(path.resolve(args.settings), args.policy && path.resolve(args.policy), manifestPath);
    console.log(`Created ${manifestPath}. Review policy, confirmation count, and service bindings there.`);
    return;
  }
  const output = path.resolve(args["output-dir"] || path.join(path.dirname(manifestPath), "deployment"));
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const lock = path.join(output, ".lock");
  const handle = fs.openSync(lock, "wx", 0o600);
  fs.writeFileSync(handle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  try {
    const context = loadManifest(manifestPath, args.stage);
    const artifacts = generate(context, output);
    let report;
    if (args.command === "plan") {
      const settings = loadConfig(artifacts.bridgeConfigPath);
      report = { revision: context.revision, status: "OFFLINE_PLAN_NOT_VERIFIED", artifacts,
        governance: ["initialize", "routes", "actions"].flatMap((step) => buildPlan(settings, step)),
        next: "Run resume to reconcile live state before any approval" };
    } else {
      const inspection = await inspect(context, artifacts);
      report = inspection.report;
      if (["activate", "vote"].includes(args.command)) {
        try {
          if (report.approvalHash !== args.approve) throw new Error("Approval is stale; review a fresh resume report");
          if (args.command === "vote") report.submittedVotes = await vote(context, artifacts, inspection, args.approve);
          else {
            report.activationFile = activate(context, artifacts, inspection, args.approve);
            report.next = "Review and execute this Safe transaction manually, then run resume and reconcile the canary";
          }
        } catch (error) {
          report.operationError = redactFor(context, error.message);
          report.status = "OPERATION_FAILED";
          process.exitCode = 1;
        }
      }
    }
    const reportFile = path.join(artifacts.directory, `report-${Date.now()}-${randomUUID()}.json`);
    writeJson(reportFile, report);
    writeJson(path.join(output, "latest.json"), { revision: context.revision, reportFile });
    console.log(JSON.stringify({ status: report.status, reportFile, revision: context.revision, approvalHash: report.approvalHash, next: report.next, activationFile: report.activationFile, error: report.operationError,
      checks: report.checks?.map(({ name, status, error, data }) => ({ name, status, error, errors: data?.errors })),
      governance: report.calls && { complete: report.calls.filter(({ status }) => status === "COMPLETE").length,
        ready: report.calls.filter(({ status }) => status === "READY").length, blocked: report.calls.filter(({ status }) => status === "BLOCKED").length } }, null, 2));
    if (args.command === "verify" && report.status !== "READY_FOR_ACTIVATION_REVIEW" && report.status !== "DEPOSITS_ACTIVE_CANARY_REQUIRED") process.exitCode = 1;
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}

if (require.main === module) main().catch((error) => { console.error(redact(error.message)); process.exitCode = 1; });
module.exports = { parseArgs, redact, sourceState, checkImplementations, inspect, vote, activate, main };
