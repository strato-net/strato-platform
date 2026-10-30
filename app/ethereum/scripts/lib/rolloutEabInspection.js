const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { digest, readJson, writeJson, address, bool, governanceProgress, governanceBatch, isActivationCall, currentCursorSettings, loadConfig } = require("./externalBridgeOrchestration");
const verification = require("../../../contracts/deploy/external-bridge-verification");
const { normalizeConfig } = require("./externalBridgeVaultPlan");
const { buildTransactionBuilderBatch } = require("./depositRouterSafeOps");
const { readState } = require("../externalBridgeVaultOps");
const { verifyFromManifest } = require("../scanTokenConfig");
const { buildDepositRouterControl } = require("./externalBridgeArtifacts");
const { getExternalBridgeNetwork } = require("./externalBridgeNetworks");
const { fetchAdminVotingPolicy, requiredAdminVotes, fetchLiveAdminVoteCounts, comparableGovernanceValue } = require("./rolloutGovernance");
const { jsonFetch, resolveSourceToken, normalizeStratoRequestUrl, limitConcurrentFetches, withDeadline,
  redactFor, TIMEOUT_MS, CHECK_TIMEOUT_MS } = require("./rolloutRuntime");
const SCRIPTS_DIR = path.resolve(__dirname, "..");

function validateSafeRuntimeIdentities(context, owners, threshold) {
  const { safeProposerAddress, executorAddress } = context.manifest.services;
  const identities = [safeProposerAddress, executorAddress, ...context.manifest.authorizationSigners];
  const expectedIdentities = getExternalBridgeNetwork(context.rollout.chainId).verifierCount + 2;
  if (identities.length !== expectedIdentities || identities.some((value) => !ethers.isAddress(value)) ||
      new Set(identities.map(address)).size !== expectedIdentities) {
    throw new Error(`Configure ${expectedIdentities} distinct proposer, executor and verifier KMS addresses`);
  }
  const normalizedOwners = owners.map(address);
  const minimumThreshold = context.deployment.production === false ? 1n : 2n;
  if (threshold < minimumThreshold || normalizedOwners.includes(address(safeProposerAddress)) ||
      normalizedOwners.includes(address(executorAddress))) {
    throw new Error(`Safe must exclude the proposer and executor and require a threshold of at least ${minimumThreshold}`);
  }
  return { owners: [...owners], threshold: String(threshold), executorAddress, safeProposerAddress };
}

async function sourceState(context, artifacts, fetchImpl = fetch, signal, options = {}) {
  const { services } = context.manifest;
  const token = await resolveSourceToken(context);
  const nodeUrl = services.nodeUrl.replace(/\/$/, "");
  const queryFetch = limitConcurrentFetches(fetchImpl);
  const boundedFetch = (url, options) => queryFetch(normalizeStratoRequestUrl(nodeUrl, url),
    { ...options, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) });
  const metadata = await jsonFetch(normalizeStratoRequestUrl(nodeUrl, `${nodeUrl}/eth/v1.2/metadata`), token, boundedFetch);
  if (typeof metadata.networkID === "number" && !Number.isSafeInteger(metadata.networkID)) throw new Error("Unsafe numeric STRATO network ID");
  if (String(metadata.networkID) !== context.settings.sourceChainId) throw new Error("STRATO node chain ID does not match the manifest");
  const settings = loadConfig(artifacts.bridgeConfigPath);
  const args = [settings, nodeUrl, token, boundedFetch];
  await verification.validateDeploymentDependencies(...args);
  const diagnostics = [];
  const [initialization, routes, actions, permissionErrors, inactiveTokens, votingPolicyResult] = await Promise.all([
    verification.fetchInitializationState(...args), verification.fetchRouteState(...args),
    verification.fetchActionState(...args), verification.validateRoutePermissions(...args, diagnostics), verification.validateActiveRouteTokens(...args),
    fetchAdminVotingPolicy(settings, nodeUrl, token, boundedFetch)
      .then((policy) => ({ policy })).catch((error) => ({ error: error.message })),
  ]);
  const votingPolicy = votingPolicyResult.policy;
  const state = { initialization, routes, actions, permissionErrors };
  // Before enabling, accept already-enabled desired routes and verify all remaining actions are disabled.
  const beforeEnable = { ...settings, chains: settings.chains.map((chain) => ({ ...chain,
    routes: chain.routes.map((route) => ({ ...route, autoRouteEnabled: route.autoRouteEnabled && bool(
      actions.actionConfigs.get(`${address(route.externalToken)}:${chain.externalChainId}:${address(route.stratoToken)}`)?.autoRoute),
    })),
  })) };
  // Chain enablement has its own activation call; disabled configuration is ready for service validation.
  const beforeChainEnable = { ...settings, chains: settings.chains.map(chain => ({ ...chain,
    enabled: bool(routes.chains.get(String(chain.externalChainId))?.enabled),
  })) };
  const prerequisiteErrors = [
    ...verification.compareInitialization(settings, initialization, diagnostics),
    ...verification.compareRoutes(currentCursorSettings(beforeChainEnable, routes), routes, diagnostics),
    ...permissionErrors, ...inactiveTokens,
  ];
  const activationErrors = [...prerequisiteErrors, ...verification.compareActions(beforeEnable, actions)];
  const calls = governanceProgress(settings, state, { stage: context.stage, activationErrors });
  calls.forEach((item) => { item.requiredAdminVotes = requiredAdminVotes(votingPolicy, item.call); item.policyAdmins = votingPolicy?.admins; });
  const liveVoteCountsResult = options.deferVoteCounts ? {} : await fetchLiveAdminVoteCounts(
    settings, nodeUrl, token, governanceBatch({ calls }).calls,
    artifacts, boundedFetch).then((counts) => ({ counts })).catch((error) => ({ error: error.message }));
  if (liveVoteCountsResult.counts) {
    calls.forEach((item) => { item.recordedAdminVotes = liveVoteCountsResult.counts.get(item.id); });
  }
  diagnostics.push(...inactiveTokens.map(message => ({ code: "INACTIVE_TOKEN", message })));
  if (bool(initialization.bridge.depositsPaused)) diagnostics.push({ code: "SETTLEMENT_PAUSED", message: "STRATO deposit settlement is paused or its pause state is unavailable" });
  const errors = [...prerequisiteErrors, ...verification.compareActions(settings, actions, diagnostics),
    ...(initialization.bridge.depositsPaused === false || initialization.bridge.depositsPaused === "false" ? [] : ["STRATO deposit settlement is paused or its pause state is unavailable"])];
  for (const difference of diagnostics) {
    const expected = difference.governance;
    difference.governanceCallIds = expected ? calls.filter(({ call }) => address(call.args._target) === address(expected.target) && call.args._func === expected.method &&
      Object.entries(expected.arguments || {}).every(([index, value]) => comparableGovernanceValue(call.args._args[index]?.value) === comparableGovernanceValue(value)))
      .map(({ id }) => id) : [];
    delete difference.governance;
  }
  return { settings, state, inactiveTokens, differences: diagnostics, votingPolicy: votingPolicy && {
    adminCount: votingPolicy.adminCount, defaultThresholdBps: votingPolicy.defaultThresholdBps,
  }, voteCountsDeferred: options.deferVoteCounts === true, votingPolicyError: votingPolicyResult.error, liveVoteCountsError: liveVoteCountsResult.error, calls, errors };
}

async function checkImplementations(context, provider) {
  const block = await provider.getBlockNumber();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await checkImplementationsAtBlock(context, provider, block);
    } catch (error) {
      const rpcError = error.error || error.info?.error;
      if (rpcError?.code !== -32000 || !/^unsupported block number\b/i.test(rpcError.message || "")) throw error;
      if (attempt === 2) throw new Error(`External RPC cannot serve pinned block ${block} after three attempts. Rerun continue; if persistent, use a reviewed RPC that serves numbered state reads.`);
    }
  }
}

async function checkImplementationsAtBlock(context, provider, block) {
  const results = [];
  const slot = ethers.toBeHex(BigInt(ethers.keccak256(ethers.toUtf8Bytes("eip1967.proxy.implementation"))) - 1n, 32);
  for (const [field, name] of [["externalBridgeVault", "ExternalBridgeVault"], ["depositRouter", "ExternalAssetDepositRouter"]]) {
    const entry = context.deployment[field];
    const actual = ethers.getAddress(`0x${(await provider.getStorage(entry.proxy, slot, block)).slice(-40)}`);
    if (address(actual) !== address(entry.implementation)) throw new Error(`${name} implementation differs from deployment artifact`);
    const artifactPath = path.resolve(SCRIPTS_DIR, `../artifacts/contracts/bridge/${name}.sol/${name}.json`);
    const artifact = readJson(artifactPath);
    const debugPath = artifactPath.replace(/\.json$/, ".dbg.json");
    const build = readJson(path.resolve(path.dirname(debugPath), readJson(debugPath).buildInfo));
    const sources = new Set([artifact.sourceName]);
    for (const sourceName of sources) {
      const source = build.input.sources[sourceName];
      const sourceFile = path.resolve(SCRIPTS_DIR, "..", sourceName.startsWith("@") ? "node_modules" : "", sourceName);
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

function expectedSourceDifferences(source, completedCalls = new Set()) {
  const pending = new Set(source.calls.filter(item => item.status !== "COMPLETE" && !completedCalls.has(item.id) &&
    (item.status === "READY" || item.reasonCode === "WAIT_FOR_GOVERNANCE" ||
      (isActivationCall(item) && item.reasonCode === "ACTIVATION_PREREQUISITES"))).map(({ id }) => id));
  return source.errors.length > 0 && source.differences?.length === source.errors.length &&
    source.differences.every(({ code, governanceCallIds }) => typeof code === "string" &&
      governanceCallIds?.some(id => pending.has(id)));
}

async function inspect(context, artifacts, options = {}) {
  const checks = [];
  const configurationFingerprint = digest({ bridge: context.rollout.bridgeConfig, vault: context.rollout.vaultConfig,
    router: context.rollout.depositRouter, updates: context.rollout.depositRouterUpdates });
  const latestFile = path.join(path.dirname(artifacts.directory), "latest.json");
  const previous = options.previousReport || (fs.existsSync(latestFile) ? readJson(readJson(latestFile).reportFile) : undefined);
  const completedCalls = new Set([...(previous?.completedEvidence?.calls || []),
    ...(previous?.calls || []).filter(item => item.status === "COMPLETE").map(item => item.id)]);
  const sameConfiguration = previous?.configurationFingerprint === configurationFingerprint;
  const completedChecks = new Set(sameConfiguration ? [...(previous.completedEvidence?.checks || []),
    ...(previous.checks || []).filter(item => item.status === "PASSED").map(item => item.name)] : []);
  const check = async (name, work, expectedPending) => {
    const started = Date.now();
    options.onProgress?.(`${name}: checking`);
    try {
      const data = await withDeadline(name, work, options.checkTimeoutMs || CHECK_TIMEOUT_MS, options.signal);
      const errors = data?.errors || [];
      const pending = errors.length && !completedChecks.has(name) && expectedPending?.(data);
      const status = errors.length ? pending ? "PENDING" : "FAILED" : "PASSED";
      checks.push({ name, status, data, ...(pending ? { reason: "Awaiting the reviewed configuration action" } : {}) });
      options.onProgress?.(`${name}: ${status} (${Math.round((Date.now() - started) / 1000)}s)${pending ? " — awaiting configuration" : ""}`);
      return data;
    } catch (error) {
      const message = redactFor(context, error.message);
      checks.push({ name, status: "FAILED", error: message });
      options.onProgress?.(`${name}: FAILED (${Math.round((Date.now() - started) / 1000)}s) — ${message}`);
      return undefined;
    }
  };
  const source = await check("strato", (signal) => (options.sourceState || sourceState)(context, artifacts, options.fetchImpl || fetch, signal, { deferVoteCounts: options.staged === true }), data => expectedSourceDifferences(data, completedCalls));
  // Maps/sets are only used for reconciliation; persist the actionable errors and cursor evidence.
  if (source) {
    const stratoCheck = checks.find((item) => item.name === "strato");
    stratoCheck.data = { errors: source.errors, differences: source.differences,
      cursors: source.settings.chains.map((chain) => ({ chainId: chain.externalChainId, configuredStart: chain.lastProcessedBlock,
        live: source.state.routes.chains.get(chain.externalChainId)?.lastProcessedBlock })) };

  }
  const preActivationGovernancePending = source?.calls.some(item =>
    item.status !== "COMPLETE" && !isActivationCall(item));
  const activationCandidate = context.stage === "activation" && !!source && !preActivationGovernancePending;
  let activationChecksRequired = !options.staged && activationCandidate;
  let router;
  let vaultState;
  let externalReady = false;
  const rpcUrl = process.env[context.manifest.services.rpcUrlEnv];
  if (!rpcUrl || !/^https:\/\//.test(rpcUrl)) checks.push({ name: "external", status: "FAILED", error: `Set HTTPS ${context.manifest.services.rpcUrlEnv}` });
  else {
    const request = new ethers.FetchRequest(rpcUrl);
    request.timeout = TIMEOUT_MS;
    const provider = options.provider || new ethers.JsonRpcProvider(request, undefined, {
      batchMaxCount: 1,
      cacheTimeout: -1,
    });
    try {
      const identity = await check("external-identity", async () => {
        if ((await provider.getNetwork()).chainId !== BigInt(context.rollout.chainId)) throw new Error("External RPC chain ID mismatch");
        return (options.checkImplementations || checkImplementations)(context, provider);
      });
      if (identity) {
        router = await check(options.staged ? "router-configuration" : "deposit-router", async () => {
          const contract = new ethers.Contract(context.rollout.depositRouter.address, ["function paused() view returns (bool)"], provider);
          const paused = await contract.paused();
          return (options.verifyRouter || verifyFromManifest)(artifacts.manifestPath, { expectedPaused: paused, provider, quiet: true, scanHistory: !options.staged });
        }, data => !completedChecks.has("deposit-router") && !completedChecks.has("router-configuration") && data.configurationErrors?.length === data.errors.length);
        vaultState = await check("withdrawal-pause", async () => {
          const vault = new ethers.Contract(context.rollout.vaultConfig.chains[0].vaultAddress, ["function paused() view returns (bool)"], provider);
          const paused = await vault.paused();
          const expectedPaused = router?.paused !== false || context.rollout.summary.withdrawalsEnabledCount === 0;
          return { paused, errors: paused === expectedPaused ? [] : [expectedPaused
            ? "External vault must remain paused before activation"
            : "External vault must be unpaused with a withdrawal-enabled ExternalAssetDepositRouter"] };
        }, data => data.paused === false && router?.paused !== false && !!artifacts.vaultPausePath);
        externalReady = !!vaultState && !vaultState.errors?.length;
        await check("safe-runtime-identities", async () => {
          const safe = new ethers.Contract(context.rollout.vaultConfig.chains[0].safeAddress,
            ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"], provider);
          const [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
          return validateSafeRuntimeIdentities(context, owners, threshold);
        });
        const vaultConfiguration = await check("vault-configuration", async () => {
          const config = normalizeConfig(context.rollout.vaultConfig);
          const base = path.resolve(SCRIPTS_DIR, "../artifacts/contracts/bridge");
          const state = await (options.readVaultState || readState)(config, config.chains[0], readJson(`${base}/ExternalBridgeVault.sol/ExternalBridgeVault.json`), readJson(`${base}/ExternalAssetDepositRouter.sol/ExternalAssetDepositRouter.json`), provider);
          return { ...state, errors: state.configurationMatches && state.routerTargetsVault && state.safeHasGovernanceRoles && state.guardianCanPause && state.routerOwnerIsSafe ? [] : ["Vault policies, signer set, governance roles, or router binding differ"] };
        }, data => data.configurationMatches === false && data.routerTargetsVault && data.safeHasGovernanceRoles &&
          data.guardianCanPause && data.routerOwnerIsSafe && !!artifacts.vaultConfigurePath);
        if (options.staged) {
          const configurationVerified = !!router && !router.errors?.length && !!vaultConfiguration && !vaultConfiguration.errors?.length;
          activationChecksRequired = activationCandidate && configurationVerified;
          if (activationChecksRequired) {
            router = await check("deposit-router", () => (options.verifyRouter || verifyFromManifest)(artifacts.manifestPath,
              { expectedPaused: router.paused, provider, quiet: true, scanHistory: true }));
          } else {
            checks.push({ name: "deposit-router", status: "DEFERRED", reason: "Complete historical route inventory is required once configuration is ready for activation" });
          }
        }
      }
    } finally { if (!options.provider) provider.destroy(); }
  }
  let runtimeDeploymentHealth;
  const checkVerifiers = async () => {
    const services = context.manifest.services;
    const verifierCount = getExternalBridgeNetwork(context.rollout.chainId).verifierCount;
    if (!Number.isSafeInteger(services.confirmations) || services.confirmations <= 0) throw new Error("Approve services.confirmations as a positive integer");
    if (services.verifiers.length !== verifierCount || context.manifest.authorizationSigners.length !== verifierCount) {
      throw new Error(`Configure ${verifierCount} verifier endpoints and KMS addresses in the manifest`);
    }
    const urls = new Set();
    for (const verifier of services.verifiers) {
      const url = new URL(verifier.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Verifier base URLs must be HTTPS without embedded credentials or query strings");
      if (urls.has(url.href)) throw new Error("Verifier URLs must be distinct");
      urls.add(url.href);
    }
    const metadata = runtimeDeploymentHealth?.deployment?.verifiers;
    if (String(runtimeDeploymentHealth?.deployment?.chainId) !== String(context.rollout.chainId) ||
        !Array.isArray(metadata) || metadata.length !== services.verifiers.length) {
      throw new Error("Runtime did not return complete verifier deployment health");
    }
    metadata.forEach((data, index) => {
      const verifier = services.verifiers[index];
      const policy = context.rollout.verifierPolicies[index];
      const expectedConfirmations = verifier.confirmations ?? services.confirmations;
      const confirmationMismatch = verifier.confirmations === undefined
        ? !Number.isSafeInteger(data.verifierConfirmations) || data.verifierConfirmations < expectedConfirmations
        : data.verifierConfirmations !== expectedConfirmations;
      if (data.status !== "ok" || String(data.destinationChainId) !== String(context.rollout.chainId) ||
          address(data.access?.runtimeAccessAddress) !== address(services.runtimeAccessAddress) ||
          address(data.destinationVault) !== address(policy.destinationVault) || address(data.authorizationSigner) !== address(context.manifest.authorizationSigners[index]) ||
          address(data.settlementAttestor) !== address(policy.settlementAttestor) || data.verifierIndex !== index + 1 ||
          data.baselinePolicyHash !== context.rollout.baselinePolicyHash ||
          data.policyDigest !== `sha256:${digest(fs.readFileSync(artifacts.verifierPolicyPaths[index], "utf8"))}` ||
          !Number.isSafeInteger(data.verificationRpcHostCount) || data.verificationRpcHostCount < 2 ||
          confirmationMismatch) throw new Error(`Verifier ${index + 1} identity, policy, or confirmation mismatch`);
    });
    return metadata;
  };
  const checkBridgeHealth = async () => {
    const { bridgeHealthUrl, bridgeHealthUrlEnv = "BRIDGE_HEALTH_URL" } = context.manifest.services;
    const url = bridgeHealthUrl === "REVIEW_REQUIRED"
      ? process.env[bridgeHealthUrlEnv]
      : bridgeHealthUrl || process.env[bridgeHealthUrlEnv];
    if (!url || !/^https:\/\/[^<>\s]+$/.test(url)) {
      throw new Error("Set services.bridgeHealthUrl to the deployed Runtime HTTPS health URL");
    }
    const deploymentUrl = new URL(url);
    deploymentUrl.searchParams.set("deploymentChainId", String(context.rollout.chainId));
    const data = await jsonFetch(deploymentUrl.href, undefined, options.fetchImpl);
    if (data.status !== true) throw new Error("Bridge health is not ready");
    runtimeDeploymentHealth = data;
    return data;
  };
  if (activationChecksRequired && (!options.staged || checks.find(item => item.name === "deposit-router")?.status === "PASSED")) {
    await check("bridge-health", checkBridgeHealth);
    await check("verifiers", checkVerifiers);
  } else {
    checks.push({ name: "verifiers", status: "DEFERRED", reason: "Required only after pre-activation governance completes" });
    checks.push({ name: "bridge-health", status: "DEFERRED", reason: "Required only after pre-activation governance completes" });
  }
  if (source?.voteCountsDeferred) {
    const prerequisitesVerified = router?.paused === true && vaultState?.paused === true &&
      ["external-identity", "safe-runtime-identities", "router-configuration", "vault-configuration"].every(name => checks.find(item => item.name === name)?.status === "PASSED");
    const pending = governanceBatch({ calls: source.calls }).calls;
    const enabling = pending.some(isActivationCall);
    const activationVerified = !enabling || checks.every(item => item.name === "strato" || item.status === "PASSED");
    if (prerequisitesVerified && activationVerified && pending.length) {
      const result = await check("governance-votes", async signal => {
        const token = await resolveSourceToken(context);
        const nodeUrl = context.manifest.services.nodeUrl.replace(/\/$/, "");
        const boundedFetch = (url, requestOptions) => (options.fetchImpl || fetch)(normalizeStratoRequestUrl(nodeUrl, url),
          { ...requestOptions, signal: AbortSignal.any([signal, requestOptions.signal || AbortSignal.timeout(TIMEOUT_MS)]) });
        const counts = await (options.fetchVoteCounts || fetchLiveAdminVoteCounts)(source.settings, nodeUrl, token, pending, artifacts, boundedFetch);
        pending.forEach(item => { item.recordedAdminVotes = counts.get(item.id); });
        return { errors: [] };
      });
      source.voteCountsDeferred = false;
      if (!result) source.liveVoteCountsError = "Live governance vote verification failed; restore the query before approval";
    } else if (!pending.length) source.voteCountsDeferred = false;
  }
  const calls = source?.calls || [];
  for (const item of calls) {
    if (item.status === "READY" && isActivationCall(item) &&
        (!externalReady || router?.paused !== true || checks.some(({ name, status }) => name !== "strato" && status !== "PASSED"))) {
      item.status = "BLOCKED";
      item.reason = "Activation requires verified policy artifacts, verifier policies, vault/router configuration and service health";
    }
  }
  const ready = checks.every(({ status }) => status === "PASSED") && calls.every(({ status }) => status === "COMPLETE");
  const failedCheckNames = checks.filter(({ status }) => status === "FAILED").map(({ name }) => name);
  const configurationStatus = (name) => {
    const checkResult = checks.find((item) => item.name === (options.staged && name === "deposit-router" ? "router-configuration" : name));
    if (checkResult?.status === "PASSED") return "DONE";
    return !checkResult || checkResult.error ? "UNVERIFIED" : "PENDING";
  };
  const alreadyConfigured = !!source && source.calls.every(({ status }) => status === "COMPLETE") &&
    ["external-identity", "deposit-router", "withdrawal-pause", "safe-runtime-identities", "vault-configuration"].every(name => checks.find(check => check.name === name)?.status === "PASSED");
  const safeExecutionOrder = [
    { step: "pause-router", path: artifacts.depositRouterPausePath,
      status: router?.paused === true || alreadyConfigured ? "DONE" : router?.paused === false ? "PENDING" : "UNVERIFIED" },
    { step: "pause-vault", path: artifacts.vaultPausePath,
      status: vaultState?.paused === true || alreadyConfigured ? "DONE" : vaultState?.paused === false ? "PENDING" : "UNVERIFIED" },
    ...artifacts.depositRouterBatchPaths.map((file, index) =>
      ({ step: `configure-router-${index + 1}`, path: file, status: configurationStatus("deposit-router") })),
    ...(artifacts.vaultConfigurePath
      ? [{ step: "configure-vault", path: artifacts.vaultConfigurePath, status: configurationStatus("vault-configuration") }]
      : []),
  ];
  const pendingSafeConfiguration = safeExecutionOrder.some(({ status }) => status === "PENDING");
  const unverifiedSafeConfiguration = safeExecutionOrder.some(({ status }) => status === "UNVERIFIED");
  const report = {
    revision: context.revision, observedAt: new Date().toISOString(), checks, calls, activationChecksRequired,
    configurationFingerprint,
    completedEvidence: {
      calls: [...new Set([...completedCalls, ...calls.filter(item => item.status === "COMPLETE").map(item => item.id)])].filter(id => calls.some(item => item.id === id)),
      checks: [...new Set([...completedChecks, ...checks.filter(item => item.status === "PASSED").map(item => item.name)])],
    },
    governance: source?.votingPolicy
      ? { status: "LIVE", ...source.votingPolicy }
      : { status: "UNAVAILABLE", error: source?.votingPolicyError },
    liveVoteCounts: source?.voteCountsDeferred ? { status: "DEFERRED", reason: "Read current votes once paused external configuration is verified" } : source?.liveVoteCountsError
      ? { status: "UNAVAILABLE", error: redactFor(context, source.liveVoteCountsError) }
      : source ? { status: "LIVE" } : undefined,
    status: ready ? (router.paused ? "READY_FOR_ACTIVATION_REVIEW" : "DEPOSITS_ACTIVE_CANARY_REQUIRED") : "PENDING",
    approvalHash: digest({ revision: context.revision, calls: calls.map(({ id, status }) => ({ id, status })), ready, routerPaused: router?.paused }),
    safe: { executionOrder: safeExecutionOrder, vaultPause: artifacts.vaultPausePath,
      vaultConfigure: artifacts.vaultConfigurePath, routerPause: artifacts.depositRouterPausePath,
      routerTokens: artifacts.depositRouterBatchPaths },
    next: !source ? "Resolve STRATO read access before voting" : source.liveVoteCountsError
      ? "Live AdminRegistry vote counts are unavailable; restore the STRATO vote query and rerun generate"
      : calls.some(({ status }) => status === "READY") ? "Review the current self-contained admin approval command" : !ready
      ? pendingSafeConfiguration
        ? "Resolve failed checks; execute only the pending reviewed Safe configuration; rerun generate"
        : unverifiedSafeConfiguration
          ? "EAB configuration could not be verified. Do not execute generated Safe files; rerun generate after the failed reads recover"
          : activationChecksRequired
          ? failedCheckNames.length
            ? `Resolve failed activation checks (${failedCheckNames.join(", ")}); activation governance remains blocked until they pass`
            : "Resolve remaining activation readiness checks and rerun verify"
          : "Resolve failed EAB readiness checks and rerun verify"
      : router.paused ? "Review activation, then run activate to generate the Safe unpause file" : "Reconcile canary custody and issuance before declaring launch complete",
  };
  return { report, source, externalReady, router };
}

// Current handoffs carry configuration and approved calls, never credentials or deployment history.

function activate(context, artifacts, inspection, approval) {
  const report = inspection.report;
  if (report.approvalHash !== approval) throw new Error("Approval is stale; review a fresh resume report");
  if (report.status !== "READY_FOR_ACTIVATION_REVIEW") throw new Error("Activation gates are not satisfied or deposits are already active");
  const routerBatch = buildDepositRouterControl(context.rollout, "unpause");
  const transactions = [...routerBatch.transactions];
  if (context.rollout.summary.withdrawalsEnabledCount > 0) {
    const chain = context.rollout.vaultConfig.chains[0];
    const vault = new ethers.Interface(["function unpause()"]);
    transactions.unshift({ to: chain.vaultAddress, value: "0", data: vault.encodeFunctionData("unpause"), operation: 0 });
  }
  const file = path.join(artifacts.directory, `safe-${approval}`, "activate.safe.json");
  writeJson(file, buildTransactionBuilderBatch(context.rollout.chainId,
    context.rollout.vaultConfig.chains[0].safeAddress, transactions,
    { name: "Activate External Asset Bridge", description: "Unpause the reviewed EAB vault and ExternalAssetDepositRouter" }));
  return file;
}

module.exports = { validateSafeRuntimeIdentities, sourceState, checkImplementations, checkImplementationsAtBlock, expectedSourceDifferences, inspect, activate };
