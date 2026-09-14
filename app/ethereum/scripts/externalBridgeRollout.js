const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const dotenv = require("dotenv");
dotenv.config({ quiet: true });
dotenv.config({ path: path.resolve(__dirname, "../../contracts/.env"), quiet: true, override: false });
const { ethers } = require("ethers");
const {
  CONTRACTS, digest, readJson, writeJson, address, bool, initializeManifest, createPortableBundle, loadManifest,
  generate, governanceProgress, currentCursorSettings, loadConfig,
} = require("./lib/externalBridgeOrchestration");
const verification = require("../../contracts/deploy/external-bridge-verification");
const { buildPlan, submit } = require("../../contracts/deploy/configure-external-bridge");
const { normalizeConfig } = require("./lib/externalBridgeVaultPlan");
const { buildTransactionBuilderBatch } = require("./lib/depositRouterSafeOps");
const { readState } = require("./externalBridgeVaultOps");
const { verifyFromManifest } = require("./scanTokenConfig");
const { buildDepositRouterControl } = require("./lib/externalBridgeArtifacts");

const TIMEOUT_MS = 30_000;
const DEFAULT_ADMIN_CONFIG = path.join(os.homedir(), ".config", "strato", "eab-admin.json");
const DEFAULT_TECHNICIAN_CONFIG = path.join(os.homedir(), ".config", "strato", "eab-technician.json");
const inferAdminNumber = (...values) => {
  const match = values.filter(Boolean).map(String).join(" ").match(/admin[-_ ]?([12])/i);
  return match?.[1];
};
function parseArgs(argv) {
  const command = argv[0]?.startsWith("--") ? "plan" : argv.shift() || "plan";
  if (!["init", "bundle", "technician-setup", "admin-setup", "plan", "resume", "status", "next", "verify", "vote", "activate"].includes(command)) {
    throw new Error("Use init|bundle|technician-setup|admin-setup|plan|status|next|resume|verify|vote|activate");
  }
  const args = { command };
  const allowed = command === "init" ? ["manifest", "settings", "policy"]
    : command === "bundle" ? ["manifest", "bundle"]
      : command === "technician-setup" ? ["config", "manifest", "output-dir", "stage", "env-file"]
      : command === "admin-setup" ? ["admin", "config", "manifest", "output-dir", "stage", "env-file"]
        : ["config", "manifest", "output-dir", "stage", "env-file",
          ...(["vote", "activate"].includes(command) ? ["approve"] : [])];
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index].replace(/^--/, "");
    if (!argv[index].startsWith("--") || !allowed.includes(name) || !argv[index + 1] || argv[index + 1].startsWith("--") || args[name]) throw new Error(`Invalid or duplicate option ${argv[index]}`);
    args[name] = argv[index + 1];
  }
  if (command === "technician-setup") args.config ||= DEFAULT_TECHNICIAN_CONFIG;
  if (command === "admin-setup") args.config ||= DEFAULT_ADMIN_CONFIG;
  if (!args.config && !args.manifest && process.env.EAB_ROLLOUT_CONFIG) {
    args.config = process.env.EAB_ROLLOUT_CONFIG;
  }
  if (!args.config && !args.manifest && fs.existsSync(DEFAULT_ADMIN_CONFIG)) {
    args.config = DEFAULT_ADMIN_CONFIG;
  }
  if (args.config && !["technician-setup", "admin-setup"].includes(command)) {
    const config = readJson(path.resolve(args.config));
    if (config.manifestSha256 && digest(fs.readFileSync(config.manifest, "utf8")) !== config.manifestSha256) {
      throw new Error("Configured deployment bundle changed; stop and repeat admin-setup with the technician");
    }
    args.manifest ||= config.manifest;
    args["output-dir"] ||= config.outputDir;
    args.stage ||= config.stage;
    args["env-file"] ||= config.environmentFile;
    if (config.admin) args.admin ||= config.admin;
  }
  const inferredAdmin = inferAdminNumber(args.config, args["env-file"]);
  if (!args.admin && inferredAdmin) args.admin = inferredAdmin;
  if (args.admin && !["1", "2"].includes(String(args.admin))) throw new Error("--admin must be 1 or 2");
  if (["technician-setup", "admin-setup"].includes(command)) {
    for (const required of ["manifest", "output-dir"]) {
      if (!args[required]) throw new Error(`admin-setup requires --${required}`);
    }
    return args;
  }
  if (command === "bundle" && !args.bundle) throw new Error("bundle requires --bundle");
  if (!args.manifest) throw new Error("--manifest is required");
  if (["vote", "activate"].includes(command) && !/^[a-f0-9]{64}$/.test(args.approve || "")) throw new Error("Explicit --approve <approvalHash> from the reviewed resume report is required");
  if (args.stage && !["initial", "activation"].includes(args.stage)) throw new Error("--stage must be initial|activation");
  return args;
}

function loadRolloutEnvironment(manifest, configuredFile) {
  const file = configuredFile
    ? path.resolve(configuredFile) : path.join(path.dirname(path.resolve(manifest)), "deployment.env");
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, quiet: true, override: true });
    const config = require("../../contracts/deploy/config");
    config.nodes[0].oauth.openIdDiscoveryUrl = process.env.OAUTH_URL;
    config.nodes[0].oauth.clientId = process.env.OAUTH_CLIENT_ID;
    config.nodes[0].oauth.clientSecret = process.env.OAUTH_CLIENT_SECRET;
  }
  return file;
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

function validateSafeRuntimeIdentities(context, owners, threshold) {
  const { safeProposerAddress, executorAddress } = context.manifest.services;
  const identities = [safeProposerAddress, executorAddress, ...context.manifest.authorizationSigners];
  if (identities.length !== 5 || identities.some((value) => !ethers.isAddress(value)) ||
      new Set(identities.map(address)).size !== 5) {
    throw new Error("Configure five distinct proposer, executor and verifier KMS addresses");
  }
  const normalizedOwners = owners.map(address);
  const minimumThreshold = context.deployment.production === false ? 1n : 2n;
  if (threshold < minimumThreshold || normalizedOwners.includes(address(safeProposerAddress)) ||
      normalizedOwners.includes(address(executorAddress))) {
    throw new Error(`Safe must exclude the proposer and executor and require a threshold of at least ${minimumThreshold}`);
  }
  return { owners: [...owners], threshold: String(threshold), executorAddress, safeProposerAddress };
}

async function jsonFetch(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function resolveSourceToken(context, authImpl) {
  const tokenEnv = context.manifest.services.sourceTokenEnv;
  if (process.env[tokenEnv]) return process.env[tokenEnv];
  const { GLOBAL_ADMIN_NAME: username, GLOBAL_ADMIN_PASSWORD: password } = process.env;
  if (!username || !password) throw new Error(`Set ${tokenEnv} or configure STRATO credentials in app/contracts/.env`);
  const auth = authImpl || require("../../contracts/deploy/auth");
  const token = await auth.getUserToken(username, password);
  if (!token) throw new Error("STRATO OAuth did not return an access token");
  process.env[tokenEnv] = token;
  return token;
}

function stratoApiUrl(nodeUrl) {
  const url = new URL(nodeUrl);
  const pathName = url.pathname.replace(/\/+$/, "");
  url.pathname = pathName.endsWith("/strato-api") ? pathName : `${pathName}/strato-api`;
  return url.href.replace(/\/$/, "");
}

function normalizeStratoRequestUrl(nodeUrl, requestUrl) {
  const baseUrl = nodeUrl.replace(/\/$/, "");
  if (requestUrl.startsWith(`${baseUrl}/eth/`)) {
    return `${stratoApiUrl(baseUrl)}${requestUrl.slice(baseUrl.length)}`;
  }
  return requestUrl;
}

async function fetchAdminVotingPolicy(settings, nodeUrl, token, fetchImpl = fetch) {
  const registry = address(settings.adminRegistry);
  const fetchRows = (table, params) => jsonFetch(
    `${nodeUrl.replace(/\/$/, "")}/cirrus/search/${table}?${new URLSearchParams(params)}`, token, fetchImpl);
  const registryRows = await fetchRows("BlockApps-AdminRegistry", {
    address: `eq.${registry}`,
    select: "defaultVotingThresholdBps,admins:BlockApps-AdminRegistry-admins(address:value),thresholds:BlockApps-AdminRegistry-votingThresholds(target:key,func:key2,threshold:value)",
    limit: 1,
  });
  const row = registryRows[0] || {};
  const admins = Array.isArray(row.admins)
    ? row.admins.filter(({ address: admin }) => admin && admin !== "Unknown") : [];
  if (!Array.isArray(admins) || admins.length === 0) throw new Error("AdminRegistry admins are unavailable");
  const defaultThresholdBps = Number(row.defaultVotingThresholdBps);
  if (!Number.isSafeInteger(defaultThresholdBps) || defaultThresholdBps <= 0) throw new Error("AdminRegistry default threshold is unavailable");
  const thresholds = new Map((row.thresholds || []).map(({ target, func, threshold }) =>
    [`${address(target)}:${func}`, Number(threshold)]));
  return { adminCount: admins.length, defaultThresholdBps, thresholds };
}

function requiredAdminVotes(policy, call) {
  if (!policy) return undefined;
  const bps = policy.thresholds.get(`${address(call.args._target)}:${call.args._func}`) ||
    policy.defaultThresholdBps;
  return Math.ceil((bps * policy.adminCount) / 10000);
}

function recordedVoteMetadata(calls, artifacts) {
  if (!artifacts?.directory || !fs.existsSync(path.dirname(artifacts.directory))) return new Map();
  const callIds = new Set(calls.map(({ id }) => id));
  const metadata = new Map();
  for (const entry of fs.readdirSync(path.dirname(artifacts.directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(path.dirname(artifacts.directory), entry.name);
    for (const file of fs.readdirSync(directory).filter((name) => /^votes-[a-f0-9]{40}\.json$/.test(name))) {
      for (const [id, vote] of Object.entries(readJson(path.join(directory, file)))) {
        if (!callIds.has(id)) continue;
        const current = metadata.get(id) || { hashes: new Set() };
        for (const hash of vote.hashes || []) current.hashes.add(String(hash).toLowerCase());
        const issueId = vote.issueId || vote.receipt?.issueId;
        if (issueId) current.issueId = String(issueId).toLowerCase();
        metadata.set(id, current);
      }
    }
  }
  return metadata;
}

function recordedIssueIds(calls, artifacts) {
  return new Map([...recordedVoteMetadata(calls, artifacts)]
    .filter(([, value]) => value.issueId).map(([id, value]) => [id, value.issueId]));
}

async function fetchLiveAdminVoteCounts(settings, nodeUrl, token, calls, artifacts, fetchImpl = fetch) {
  const metadata = recordedVoteMetadata(calls, artifacts);
  if (metadata.size === 0) return new Map();
  const transactionToCall = new Map([...metadata].flatMap(([id, value]) =>
    [...value.hashes].map((hash) => [hash, id])));
  const missingIssueHashes = [...transactionToCall.keys()]
    .filter((hash) => !metadata.get(transactionToCall.get(hash)).issueId);
  const baseUrl = `${nodeUrl.replace(/\/$/, "")}/cirrus/search/BlockApps-AdminRegistry-IssueVoted`;
  if (missingIssueHashes.length) {
    const rows = await jsonFetch(`${baseUrl}?${new URLSearchParams({
      address: `eq.${address(settings.adminRegistry)}`,
      transaction_hash: `in.(${missingIssueHashes.join(",")})`,
      select: "issueId,transaction_hash",
      limit: 10000,
    })}`, token, fetchImpl);
    for (const row of rows) {
      const id = transactionToCall.get(String(row.transaction_hash || "").toLowerCase());
      if (id && row.issueId) metadata.get(id).issueId = String(row.issueId).toLowerCase();
    }
  }
  const issues = new Map([...metadata].filter(([, value]) => value.issueId)
    .map(([id, value]) => [id, value.issueId]));
  if (issues.size === 0) return new Map();
  const issueIds = [...new Set(issues.values())];
  const rows = await jsonFetch(
    `${baseUrl}?${new URLSearchParams({
      address: `eq.${address(settings.adminRegistry)}`,
      issueId: `in.(${issueIds.join(",")})`,
      select: "issueId,voter",
      limit: 10000,
    })}`, token, fetchImpl);
  const voters = new Map();
  for (const { issueId, voter } of rows) {
    const key = String(issueId || "").toLowerCase();
    if (!voters.has(key)) voters.set(key, new Set());
    voters.get(key).add(address(voter));
  }
  return new Map([...issues].map(([id, issueId]) => [id, voters.get(issueId)?.size || 0]));
}

async function sourceState(context, artifacts, fetchImpl = fetch) {
  const { services } = context.manifest;
  const token = await resolveSourceToken(context);
  const nodeUrl = services.nodeUrl.replace(/\/$/, "");
  const boundedFetch = (url, options) => fetchImpl(normalizeStratoRequestUrl(nodeUrl, url),
    { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const metadata = await jsonFetch(normalizeStratoRequestUrl(nodeUrl, `${nodeUrl}/eth/v1.2/metadata`), token, boundedFetch);
  if (typeof metadata.networkID === "number" && !Number.isSafeInteger(metadata.networkID)) throw new Error("Unsafe numeric STRATO network ID");
  if (String(metadata.networkID) !== context.settings.sourceChainId) throw new Error("STRATO node chain ID does not match the manifest");
  const settings = loadConfig(artifacts.bridgeConfigPath);
  const args = [settings, nodeUrl, token, boundedFetch];
  await verification.validateDeploymentDependencies(...args);
  const [initialization, routes, actions, permissionErrors, inactiveTokens, votingPolicyResult] = await Promise.all([
    verification.fetchInitializationState(...args), verification.fetchRouteState(...args),
    verification.fetchActionState(...args), verification.validateRoutePermissions(...args), verification.validateActiveRouteTokens(...args),
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
  const prerequisiteErrors = [
    ...verification.compareInitialization(settings, initialization),
    ...verification.compareRoutes(currentCursorSettings(settings, routes), routes),
    ...permissionErrors, ...inactiveTokens,
  ];
  const activationErrors = [...prerequisiteErrors, ...verification.compareActions(beforeEnable, actions)];
  const calls = governanceProgress(settings, state, { stage: context.stage, activationErrors });
  calls.forEach((item) => { item.requiredAdminVotes = requiredAdminVotes(votingPolicy, item.call); });
  const liveVoteCounts = await fetchLiveAdminVoteCounts(
    settings, nodeUrl, token, calls.filter(({ status }) => status === "READY"),
    artifacts, boundedFetch).catch(() => new Map());
  calls.forEach((item) => { item.recordedAdminVotes = liveVoteCounts.get(item.id); });
  return { settings, state, inactiveTokens, votingPolicy: votingPolicy && {
    adminCount: votingPolicy.adminCount, defaultThresholdBps: votingPolicy.defaultThresholdBps,
  }, votingPolicyError: votingPolicyResult.error, calls, errors: [
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
  if (source) {
    const stratoCheck = checks.find((item) => item.name === "strato");
    stratoCheck.data = { errors: source.errors,
      cursors: source.settings.chains.map((chain) => ({ chainId: chain.externalChainId, configuredStart: chain.lastProcessedBlock,
        live: source.state.routes.chains.get(chain.externalChainId)?.lastProcessedBlock })) };
    const incompleteGovernanceIsExpected = source.calls.some(({ status }) => status === "READY") &&
      source.calls.filter(({ status }) => status === "BLOCKED")
        .every(({ reason }) => String(reason).startsWith("Wait for "));
    if (stratoCheck.status === "FAILED" && incompleteGovernanceIsExpected) {
      stratoCheck.status = "PENDING";
      stratoCheck.reason = "Expected configuration differences remain until the current governance stage executes";
    }
  }
  let router;
  let vaultState;
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
        router = await check("deposit-router", async () => {
          const contract = new ethers.Contract(context.rollout.depositRouter.address, ["function paused() view returns (bool)"], provider);
          const paused = await contract.paused();
          return verifyFromManifest(artifacts.manifestPath, { expectedPaused: paused, provider, quiet: true });
        });
        vaultState = await check("withdrawal-pause", async () => {
          const vault = new ethers.Contract(context.rollout.vaultConfig.chains[0].vaultAddress, ["function paused() view returns (bool)"], provider);
          const paused = await vault.paused();
          const expectedPaused = router?.paused !== false || context.rollout.summary.withdrawalsEnabledCount === 0;
          if (paused !== expectedPaused) {
            throw new Error(expectedPaused ? "External vault must remain paused before activation"
              : "External vault must be unpaused with a withdrawal-enabled DepositRouter");
          }
          return { paused };
        });
        externalReady = !!vaultState;
        await check("safe-runtime-identities", async () => {
          const safe = new ethers.Contract(context.rollout.vaultConfig.chains[0].safeAddress,
            ["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"], provider);
          const [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
          return validateSafeRuntimeIdentities(context, owners, threshold);
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
  const preActivationGovernancePending = source?.calls.some(({ status, call }) =>
    status !== "COMPLETE" && call.args._func !== "setDepositAction");
  const activationChecksRequired = context.stage === "activation" && !!source && !preActivationGovernancePending;
  const checkVerifiers = async () => {
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
      const expectedConfirmations = verifier.confirmations ?? services.confirmations;
      const confirmationMismatch = verifier.confirmations === undefined
        ? !Number.isSafeInteger(data.verifierConfirmations) || data.verifierConfirmations < expectedConfirmations
        : data.verifierConfirmations !== expectedConfirmations;
      if (data.status !== "ok" || String(data.destinationChainId) !== String(context.rollout.chainId) ||
          address(data.destinationVault) !== address(policy.destinationVault) || address(data.authorizationSigner) !== address(context.manifest.authorizationSigners[index]) ||
          address(data.settlementAttestor) !== address(policy.settlementAttestor) || data.verifierIndex !== index + 1 ||
          data.baselinePolicyHash !== context.rollout.baselinePolicyHash ||
          data.policyDigest !== `sha256:${digest(fs.readFileSync(artifacts.verifierPolicyPaths[index], "utf8"))}` ||
          !Number.isSafeInteger(data.verificationRpcHostCount) || data.verificationRpcHostCount < 2 ||
          confirmationMismatch) throw new Error(`Verifier ${index + 1} identity, policy, or confirmation mismatch`);
      return data;
    }));
    return metadata;
  };
  const checkBridgeHealth = async () => {
    const url = context.manifest.services.bridgeHealthUrl;
    if (!url || !/^https:\/\//.test(url)) throw new Error("Configure services.bridgeHealthUrl after Runtime deployment");
    const data = await jsonFetch(url, undefined, options.fetchImpl);
    if (data.status !== true) throw new Error("Bridge health is not ready");
    return data;
  };
  if (activationChecksRequired) {
    await check("verifiers", checkVerifiers);
    await check("bridge-health", checkBridgeHealth);
  } else {
    checks.push({ name: "verifiers", status: "DEFERRED", reason: "Required only after pre-activation governance completes" });
    checks.push({ name: "bridge-health", status: "DEFERRED", reason: "Required only after pre-activation governance completes" });
  }
  const calls = source?.calls || [];
  for (const item of calls) {
    if (item.status === "READY" && item.call.args._func === "setDepositAction" && item.call.args._args[4].value === true &&
        (!externalReady || router?.paused !== true || checks.some(({ name, status }) => name !== "strato" && status !== "PASSED"))) {
      item.status = "BLOCKED";
      item.reason = "Activation requires verified policy artifacts, verifier policies, vault/router configuration and service health";
    }
  }
  const ready = checks.every(({ status }) => status === "PASSED");
  const passed = (name) => checks.find((item) => item.name === name)?.status === "PASSED";
  const safeExecutionOrder = [
    { step: "pause-router", path: artifacts.depositRouterPausePath, status: router?.paused === true ? "DONE" : "PENDING" },
    { step: "pause-vault", path: artifacts.vaultPausePath, status: vaultState?.paused === true ? "DONE" : "PENDING" },
    ...artifacts.depositRouterBatchPaths.map((file, index) =>
      ({ step: `configure-router-${index + 1}`, path: file, status: passed("deposit-router") ? "DONE" : "PENDING" })),
    ...(artifacts.vaultConfigurePath
      ? [{ step: "configure-vault", path: artifacts.vaultConfigurePath, status: passed("vault-configuration") ? "DONE" : "PENDING" }]
      : []),
  ];
  const report = {
    revision: context.revision, observedAt: new Date().toISOString(), checks, calls, activationChecksRequired,
    governance: source?.votingPolicy
      ? { status: "LIVE", ...source.votingPolicy }
      : { status: "UNAVAILABLE", error: source?.votingPolicyError },
    status: ready ? (router.paused ? "READY_FOR_ACTIVATION_REVIEW" : "DEPOSITS_ACTIVE_CANARY_REQUIRED") : "PENDING",
    approvalHash: digest({ revision: context.revision, calls: calls.map(({ id, status }) => ({ id, status })), ready, routerPaused: router?.paused }),
    safe: { executionOrder: safeExecutionOrder, vaultPause: artifacts.vaultPausePath,
      vaultConfigure: artifacts.vaultConfigurePath, routerPause: artifacts.depositRouterPausePath,
      routerTokens: artifacts.depositRouterBatchPaths },
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
  const token = await resolveSourceToken(context);
  const nodeUrl = context.manifest.services.nodeUrl.replace(/\/$/, "");
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
      journal[item.id] = { ...previous, status: "VOTED", receipt: results };
      writeJson(journalFile, journal);
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
  const routerBatch = buildDepositRouterControl(context.rollout, "unpause");
  const transactions = [...routerBatch.transactions];
  if (context.rollout.summary.withdrawalsEnabledCount > 0) {
    const chain = context.rollout.vaultConfig.chains[0];
    const vault = new ethers.Interface(["function unpause()"]);
    transactions.unshift({ to: chain.vaultAddress, value: "0", data: vault.encodeFunctionData("unpause"), operation: 0 });
  }
  const file = path.join(artifacts.directory, `activation-unpause-${approval}.json`);
  writeJson(file, buildTransactionBuilderBatch(context.rollout.chainId,
    context.rollout.vaultConfig.chains[0].safeAddress, transactions,
    { name: "Activate External Asset Bridge", description: "Unpause the reviewed EAB vault and DepositRouter" }));
  return file;
}

function recordedVoteCounts(calls, artifacts) {
  if (!artifacts?.directory) return calls.map(() => 0);
  const journals = new Map();
  for (const entry of fs.readdirSync(path.dirname(artifacts.directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(path.dirname(artifacts.directory), entry.name);
    for (const file of fs.readdirSync(directory).filter((name) => /^votes-[a-f0-9]{40}\.json$/.test(name))) {
      const voter = file.slice(6, -5);
      const journal = journals.get(voter) || {};
      for (const [id, vote] of Object.entries(readJson(path.join(directory, file)))) {
        if (vote.status === "VOTED") journal[id] = vote;
      }
      journals.set(voter, journal);
    }
  }
  return calls.map(({ id }) => [...journals.values()].filter((journal) => journal[id]?.status === "VOTED").length);
}

function operatorGuidance(report, args, artifacts, context, environmentFile) {
  const common = args.config ? [`--config ${args.config}`] : [`--manifest ${args.manifest}`];
  if (!args.config && args["output-dir"]) common.push(`--output-dir ${args["output-dir"]}`);
  if (!args.config && args.stage) common.push(`--stage ${args.stage}`);
  const resumeCommand = `npm run external:rollout -- status ${common.join(" ")}`;
  const safeChecklist = report.safe?.executionOrder;
  const sourceToken = context?.manifest.services.sourceTokenEnv;
  const rpcUrl = context?.manifest.services.rpcUrlEnv;
  const oauthReady = process.env[sourceToken] || (process.env.GLOBAL_ADMIN_NAME &&
    process.env.GLOBAL_ADMIN_PASSWORD && process.env.OAUTH_URL && process.env.OAUTH_CLIENT_ID &&
    process.env.OAUTH_CLIENT_SECRET);
  const oauthRequirement = `${sourceToken} or GLOBAL_ADMIN_NAME + GLOBAL_ADMIN_PASSWORD + OAUTH_URL + OAUTH_CLIENT_ID + OAUTH_CLIENT_SECRET`;
  const environment = context && {
    secretsFile: environmentFile,
    secretsFileLoaded: fs.existsSync(environmentFile),
    availableNow: [
      process.env[rpcUrl] && rpcUrl,
      oauthReady && oauthRequirement,
    ].filter(Boolean),
    missingNow: [
      !process.env[rpcUrl] && rpcUrl,
      !oauthReady && oauthRequirement,
    ].filter(Boolean),
    requiredAtActivation: context.manifest.services.verifiers.map(({ tokenEnv }) => tokenEnv),
    runtimeServiceVariables: "Not rollout inputs; fill the generated bridge/verifier env templates only when deploying services.",
  };
  if (report.operationError) {
    return { action: "The operation submitted no new work. Resolve the error and rerun resume.", safeChecklist, environment, resumeCommand };
  }
  const ready = report.calls?.filter(({ status }) => status === "READY") || [];
  if (ready.length) {
    const voteCounts = recordedVoteCounts(ready, artifacts)
      .map((count, index) => Math.max(count, ready[index].recordedAdminVotes || 0));
    const requirementsKnown = ready.every(({ requiredAdminVotes }) =>
      Number.isSafeInteger(requiredAdminVotes) && requiredAdminVotes > 0);
    const voteRequirements = ready.map((item, index) => ({
      id: item.id,
      required: item.requiredAdminVotes,
      recorded: voteCounts[index],
      remaining: requirementsKnown ? Math.max(0, item.requiredAdminVotes - voteCounts[index]) : undefined,
    }));
    const maximumRemainingVotes = requirementsKnown
      ? Math.max(...voteRequirements.map(({ remaining }) => remaining)) : undefined;
    const minimumRecordedVotes = Math.min(...voteCounts);
    const readyMethods = Object.entries(ready.reduce((counts, { call }) => {
      counts[call.args._func] = (counts[call.args._func] || 0) + 1;
      return counts;
    }, {})).map(([method, count]) => ({ method, count }));
    const voteCommand = `npm run external:rollout -- vote ${common.join(" ")} --approve ${report.approvalHash}`;
    const adminHandoffCommand = `npm run external:rollout -- vote --approve ${report.approvalHash}`;
    const voteState = !requirementsKnown ? "GOVERNANCE_THRESHOLD_UNAVAILABLE"
      : maximumRemainingVotes === 0 ? "WAITING_FOR_EXECUTION"
      : maximumRemainingVotes === 1 && minimumRecordedVotes === 1 &&
        voteRequirements.every(({ required }) => required === 2)
        ? "WAITING_ON_SECOND_ADMIN"
        : minimumRecordedVotes === 0 ? "FIRST_ADMIN_VOTE_REQUIRED" : "ADMIN_VOTES_REQUIRED";
    return {
      currentStage: `${ready[0].deploymentStage}/12: ${ready[0].deploymentStageName}`,
      readyCallCount: ready.length,
      readyMethods,
      voteRequirements,
      voteState,
      action: voteState === "WAITING_FOR_EXECUTION"
        ? "The live AdminRegistry threshold is met. Wait for execution/indexing, then rerun status."
        : voteState === "WAITING_ON_SECOND_ADMIN"
          ? "The first administrator vote is recorded. This stage is waiting on the second administrator."
          : voteState === "GOVERNANCE_THRESHOLD_UNAVAILABLE"
            ? "The live AdminRegistry threshold is unavailable. Do not infer quorum from local vote files; restore the STRATO governance query and rerun status."
          : voteState === "FIRST_ADMIN_VOTE_REQUIRED"
            ? "No successful administrator vote is recorded for every READY call. An administrator votes now."
            : `${maximumRemainingVotes} additional administrator vote(s) are required for at least one READY call.`,
      voteCommand: ["WAITING_FOR_EXECUTION", "GOVERNANCE_THRESHOLD_UNAVAILABLE"].includes(voteState)
        ? undefined : voteCommand,
      adminHandoffCommand,
      afterQuorum: "Wait for execution, then rerun status. Never reuse an older approval hash.",
      safeChecklist,
      environment,
      resumeCommand,
    };
  }
  if (report.status === "READY_FOR_ACTIVATION_REVIEW") {
    return {
      action: "All governance and verification gates pass. Review and generate the Safe unpause transaction.",
      safeChecklist,
      environment,
      activateCommand: `npm run external:rollout -- activate ${common.join(" ")} --approve ${report.approvalHash}`,
    };
  }
  return {
    action: report.next,
    failedChecks: report.checks?.filter(({ status }) => status === "FAILED").map(({ name }) => name) || [],
    safeChecklist,
    environment,
    resumeCommand,
  };
}

function terminalSummary(report, reportFile) {
  const operator = report.operator || {};
  const details = reportFile;
  if (report.activationFile) {
    return {
      status: "ACTION_REQUIRED",
      action: "EXECUTE_ACTIVATION_TRANSACTION_IN_SAFE",
      file: report.activationFile,
      then: "Run status after Safe execution, then complete the canary.",
      details,
    };
  }
  if (report.submittedVotes?.length) {
    if (report.voteOutcome === "STAGE_EXECUTED") {
      return {
        status: "STAGE_EXECUTED",
        action: "TECHNICIAN_RUN_STATUS",
        run: "npm run external:rollout -- status",
        then: "The technician runs status with their own technician profile.",
        details,
      };
    }
    if (report.voterAdmin === "2" || report.voteInputState === "WAITING_ON_SECOND_ADMIN") {
      return {
        status: "VOTE_SUBMITTED",
        action: "TECHNICIAN_RUN_STATUS",
        run: "npm run external:rollout -- status",
        then: "The technician runs status with their own profile. If still pending, wait for indexing; do not vote again.",
        details,
      };
    }
    return {
      status: "HANDOFF_REQUIRED",
      action: "ADMIN_2_VOTE",
      run: operator.adminHandoffCommand,
      then: "The technician runs status after Admin 2 votes.",
      details,
    };
  }
  const requirements = operator.voteRequirements || [];
  const progress = requirements.length === 1
    ? `${requirements[0].recorded}/${requirements[0].required} admin votes recorded`
    : undefined;
  if (operator.voteState === "FIRST_ADMIN_VOTE_REQUIRED") {
    return {
      status: "ACTION_REQUIRED",
      step: operator.currentStage,
      action: "ADMIN_1_VOTE",
      progress,
      run: operator.adminHandoffCommand,
      then: "Run status again. It will tell Admin 2 to vote.",
      details,
    };
  }
  if (operator.voteState === "WAITING_ON_SECOND_ADMIN") {
    return {
      status: "ACTION_REQUIRED",
      step: operator.currentStage,
      action: "ADMIN_2_VOTE",
      progress,
      run: operator.adminHandoffCommand,
      then: "Run status again after Admin 2 votes.",
      details,
    };
  }
  if (operator.voteState === "ADMIN_VOTES_REQUIRED") {
    return {
      status: "ACTION_REQUIRED",
      step: operator.currentStage,
      action: "ADDITIONAL_ADMIN_VOTE",
      progress,
      run: operator.adminHandoffCommand,
      then: "Run status again after this admin votes.",
      details,
    };
  }
  if (operator.voteState === "WAITING_FOR_EXECUTION") {
    return {
      status: "WAITING",
      step: operator.currentStage,
      action: "Wait for governance execution/indexing.",
      run: operator.resumeCommand,
      details,
    };
  }
  if (operator.activateCommand) {
    return {
      status: "ACTION_REQUIRED",
      action: "GENERATE_ACTIVATION_TRANSACTION",
      run: operator.activateCommand,
      details,
    };
  }
  return {
    status: report.status,
    action: operator.action || report.next,
    run: operator.resumeCommand,
    failedChecks: operator.failedChecks?.length ? operator.failedChecks : undefined,
    details,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs([...argv]);
  const manifestPath = path.resolve(args.manifest);
  if (["technician-setup", "admin-setup"].includes(args.command)) {
    const configPath = path.resolve(args.config);
    const stage = args.stage || "activation";
    loadManifest(manifestPath, stage);
    const profile = {
      role: args.command === "technician-setup" ? "technician" : "administrator",
      ...(args.admin ? { admin: String(args.admin) } : {}),
      manifest: manifestPath,
      manifestSha256: digest(fs.readFileSync(manifestPath, "utf8")),
      outputDir: path.resolve(args["output-dir"]),
      stage,
      ...(args["env-file"] ? { environmentFile: path.resolve(args["env-file"]) } : {}),
    };
    fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
    writeJson(configPath, profile);
    fs.chmodSync(configPath, 0o600);
    console.log(JSON.stringify({
      status: args.command === "technician-setup" ? "TECHNICIAN_CONFIGURED" : "ADMIN_CONFIGURED",
      config: configPath,
      action: `Run this once in this persona's terminal: export EAB_ROLLOUT_CONFIG=${JSON.stringify(configPath)}`,
    }, null, 2));
    return;
  }
  if (args.command === "bundle") {
    const bundlePath = path.resolve(args.bundle);
    createPortableBundle(manifestPath, bundlePath);
    console.log(JSON.stringify({
      status: "BUNDLE_CREATED",
      bundle: bundlePath,
      sha256: digest(fs.readFileSync(bundlePath, "utf8")),
      action: "Give this non-secret file and its SHA-256 checksum to both administrators.",
    }, null, 2));
    return;
  }
  if (args.command === "init") {
    const settingsPath = args.settings ? path.resolve(args.settings) : manifestPath;
    if (!fs.existsSync(settingsPath) && !args.settings) {
      fs.mkdirSync(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.resolve(__dirname, "../externalBridgeRollout.settings.example.json"),
        manifestPath, fs.constants.COPYFILE_EXCL);
      console.log(JSON.stringify({
        status: "DRAFT_CREATED",
        manifest: manifestPath,
        action: "Fill the deployment inputs and rerun this exact init command.",
      }, null, 2));
      return;
    }
    if (!fs.existsSync(settingsPath)) throw new Error(`Settings file not found: ${settingsPath}`);
    initializeManifest(settingsPath, args.policy && path.resolve(args.policy), manifestPath);
    console.log(`Created ${manifestPath}. Review policy, confirmation counts, and service bindings there.`);
    return;
  }
  const environmentFile = loadRolloutEnvironment(manifestPath, args["env-file"]);
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
          if (args.command === "vote") {
            report.voterAdmin = args.admin;
            report.voteInputState = operatorGuidance(
              report, args, artifacts, context, environmentFile).voteState;
            report.submittedVotes = await vote(context, artifacts, inspection, args.approve);
            const submittedIds = new Set(report.submittedVotes.map(({ id }) => id));
            const refreshed = await sourceState(context, artifacts).catch(() => undefined);
            const refreshedCalls = refreshed?.calls.filter(({ id }) => submittedIds.has(id)) || [];
            report.voteOutcome = refreshedCalls.length === submittedIds.size &&
              refreshedCalls.every(({ status }) => status === "COMPLETE")
              ? "STAGE_EXECUTED" : "AWAITING_ANOTHER_ADMIN";
          } else {
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
    report.operator = operatorGuidance(report, args, artifacts, context, environmentFile);
    const reportFile = path.join(artifacts.directory, `report-${Date.now()}-${randomUUID()}.json`);
    writeJson(reportFile, report);
    writeJson(path.join(output, "latest.json"), { revision: context.revision, reportFile });
    console.log(JSON.stringify(terminalSummary(report, reportFile), null, 2));
    if (args.command === "verify" && report.status !== "READY_FOR_ACTIVATION_REVIEW" && report.status !== "DEPOSITS_ACTIVE_CANARY_REQUIRED") process.exitCode = 1;
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}

if (require.main === module) main().catch((error) => { console.error(redact(error.message)); process.exitCode = 1; });
module.exports = { parseArgs, loadRolloutEnvironment, redact, validateSafeRuntimeIdentities, resolveSourceToken, stratoApiUrl, normalizeStratoRequestUrl, fetchAdminVotingPolicy, requiredAdminVotes, recordedIssueIds, fetchLiveAdminVoteCounts, sourceState, checkImplementations, inspect, vote, activate, recordedVoteCounts, operatorGuidance, terminalSummary, main };
