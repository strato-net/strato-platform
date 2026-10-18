const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { ethers } = require("ethers");

const {
  digest, readJson, writeJson, initializeManifest, loadManifest, generate,
  governanceBatch, isActivationCall,
} = require("./externalBridgeOrchestration");
const {
  parseArgs, loadRolloutEnvironment, resolveSourceToken, jsonFetch,
} = require("./rolloutRuntime");
const {
  validateSafeRuntimeIdentities, inspect, activate,
} = require("./rolloutEabInspection");
const {
  portableSnapshot, createApprovalRequest, runApproval,
} = require("./rolloutHandoff");
const {
  validateNativeReadiness, nativeApprovalInspection, nativeOnlyEabVerified, verifyNativeActivation,
} = require("./rolloutNativeInspection");
const { buildTransactionBuilderBatch } = require("./depositRouterSafeOps");
const { getExternalBridgeNetwork } = require("./externalBridgeNetworks");
const { withExplicitEabPolicy, withExplicitNativePolicy } = require("../prepareBridgeRollout");

const DEFAULT_PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

function scopeOf(context) {
  const scope = context.manifest.scope || "combined";
  if (!["combined", "eab-only", "native-extension"].includes(scope)) {
    throw new Error("scope must be combined, eab-only, or native-extension");
  }
  const hasNative = !!context.nativeInputs.nativeRoutes?.length;
  if (scope === "combined" && !hasNative) throw new Error("combined scope requires native routes");
  if (scope === "eab-only" && hasNative) throw new Error("eab-only scope cannot include native routes");
  if (scope === "native-extension" && !hasNative) throw new Error("native-extension scope requires native routes");
  return scope;
}

function validateReviewedInputs(context) {
  const scope = scopeOf(context);
  const services = context.manifest.services;
  const network = getExternalBridgeNetwork(context.rollout.chainId);
  if (services.verifiers.length !== network.verifierCount ||
      context.manifest.authorizationSigners.length !== network.verifierCount) {
    throw new Error(`Provide ${network.verifierCount} verifier endpoints and authorization signers`);
  }
  if (!Number.isSafeInteger(services.confirmations) || services.confirmations <= 0 ||
      services.verifiers.some(verifier =>
        !Number.isSafeInteger(verifier.confirmations ?? services.confirmations) ||
        (verifier.confirmations ?? services.confirmations) < services.confirmations)) {
    throw new Error("Review positive Runtime and verifier finality confirmations");
  }
  const identities = [
    services.safeProposerAddress,
    services.executorAddress,
    ...context.manifest.authorizationSigners,
  ];
  if (identities.some(value => !ethers.isAddress(value)) ||
      new Set(identities.map(value => value.toLowerCase())).size !== identities.length) {
    throw new Error("Runtime proposer, executor, and authorization signer identities must be valid and distinct");
  }
  if (!/^https:\/\//.test(services.bridgeHealthUrl || "")) {
    throw new Error("Review services.bridgeHealthUrl");
  }
  const eabSafe = context.rollout.vaultConfig.chains[0].safeAddress;
  if (services.safeAddress &&
      services.safeAddress.toLowerCase() !== eabSafe.toLowerCase()) {
    throw new Error("Deployed EAB Safe differs from the reviewed Safe");
  }
  const nativeSafe = context.nativeInputs.nativeConfig?.safeAddress;
  if (scope === "combined" && nativeSafe?.toLowerCase() !== eabSafe.toLowerCase()) {
    throw new Error("Combined EAB and native destination configuration must use one Safe");
  }
}

function mergeDiscovery(current, discovered) {
  if (!current?.discovery) return { schemaVersion: 0, scope: "combined", discovery: discovered };
  const old = current.discovery;
  const routes = name => (discovered[name] || []).map(route => {
    const prior = (old[name] || []).find(item =>
      String(item.sourceChainId) === String(route.sourceChainId) &&
      String(item.stratoToken).toLowerCase() === String(route.stratoToken).toLowerCase());
    return prior ? { ...route, ...prior } : route;
  });
  return {
    ...current,
    schemaVersion: 0,
    discovery: {
      ...discovered,
      target: { ...discovered.target, ...old.target },
      eabRoutes: routes("eabRoutes"),
      nativeRoutes: routes("nativeRoutes"),
    },
  };
}

async function expandDraft(manifestPath, options = {}) {
  const draft = readJson(manifestPath);
  if (draft.schemaVersion !== 0 || !draft.discovery) return false;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-init-"));
  try {
    const config = structuredClone(draft.discovery);
    const base = path.dirname(manifestPath);
    for (const field of ["externalDeployment", "nativeDeployment"]) {
      if (config.target?.[field]) config.target[field] = path.resolve(base, config.target[field]);
    }
    for (const route of config.nativeRoutes || []) {
      if (route.deployment) route.deployment = path.resolve(base, route.deployment);
    }
    const input = path.join(temporary, "discovery.json");
    const prepared = path.join(temporary, "prepared");
    const expanded = path.join(temporary, "deployment.json");
    writeJson(input, config);
    const token = await (options.resolveToken || resolveSourceToken)(
      { manifest: { services: { sourceTokenEnv: "ACCESS_TOKEN" } } });
    await (options.prepare || require("../prepareBridgeRollout").main)(
      ["--config", input, "--output-dir", prepared], { token, quiet: true });
    initializeManifest(path.join(prepared, "settings.json"), path.join(prepared, "policy.json"), expanded);
    const manifest = readJson(expanded);
    const eab = config.eabRoutes?.some(({ include }) => include !== false);
    const native = config.nativeRoutes?.some(({ include }) => include !== false);
    manifest.scope = eab && native ? "combined" : native ? "native-extension" : "eab-only";
    if (draft.scope) manifest.scope = draft.scope;
    if (draft.services) {
      manifest.services = {
        ...draft.services,
        safeAddress: draft.discovery.target.safeAddress,
        permit2Address: draft.discovery.target.permit2Address,
      };
    }
    if (draft.authorizationSigners) manifest.authorizationSigners = draft.authorizationSigners;
    writeJson(manifestPath, manifest);
    return true;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function initializeDraft(discovered, nodeUrl, env = process.env) {
  const chainId = Number(discovered.target.chainId);
  const network = getExternalBridgeNetwork(chainId);
  const safeEnv = `CHAIN_${chainId}_SAFE_ADDRESS`;
  const configuredSafe = env[safeEnv];
  if (!ethers.isAddress(configuredSafe) || configuredSafe === ethers.ZeroAddress) {
    throw new Error(`Set valid nonzero ${safeEnv} in app/ethereum/.env before init`);
  }
  const safeAddress = ethers.getAddress(configuredSafe);
  const permit2Env = `CHAIN_${chainId}_PERMIT2_ADDRESS`;
  const configuredPermit2 = env[permit2Env] || DEFAULT_PERMIT2_ADDRESS;
  if (!ethers.isAddress(configuredPermit2) || configuredPermit2 === ethers.ZeroAddress) {
    throw new Error(`Set valid nonzero ${permit2Env} in app/ethereum/.env`);
  }
  const permit2Address = ethers.getAddress(configuredPermit2);
  const roleVariables = {
    vaultDefaultAdminAddress: "VAULT_DEFAULT_ADMIN_ADDRESS",
    vaultUpgraderAddress: "VAULT_UPGRADER_ADDRESS",
    vaultPolicyAdminAddress: "VAULT_POLICY_ADMIN_ADDRESS",
    guardianAddress: "GUARDIAN_ADDRESS",
    vaultUnpauserAddress: "VAULT_UNPAUSER_ADDRESS",
    vaultAttestationAdminAddress: "VAULT_ATTESTATION_ADMIN_ADDRESS",
    largeWithdrawalApproverAddress: "LARGE_WITHDRAWAL_APPROVER_ADDRESS",
  };
  const roles = Object.fromEntries(Object.entries(roleVariables).map(([name, suffix]) => {
    const envName = `CHAIN_${chainId}_${suffix}`;
    const value = env[envName] || safeAddress;
    if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
      throw new Error(`Set valid nonzero ${envName} in app/ethereum/.env`);
    }
    return [name, ethers.getAddress(value)];
  }));
  return {
    schemaVersion: 0,
    scope: "combined",
    discovery: {
      ...discovered,
      eabRoutes: (discovered.eabRoutes || []).map(withExplicitEabPolicy),
      nativeRoutes: (discovered.nativeRoutes || []).map(withExplicitNativePolicy),
      target: {
        ...discovered.target,
        externalDeployment: ".deployment/external/external-deployment.json",
        externalAssetBridge: discovered.target.externalAssetBridge || "DEPLOY_REQUIRED",
        tokenRouter: discovered.target.tokenRouter || "DEPLOY_REQUIRED",
        bridgeOperator: "REVIEW_REQUIRED",
        guardian: "REVIEW_REQUIRED",
        settlementVerifiers: Array(network.verifierCount).fill("REVIEW_REQUIRED"),
        safeAddress,
        permit2Address,
        deploymentConfirmations: "REVIEW_REQUIRED",
        roles,
        nativeConfig: {
          executor: "REVIEW_REQUIRED",
          eabExecutor: "REVIEW_REQUIRED",
          attestationSigners: Array(network.verifierCount).fill("REVIEW_REQUIRED"),
          attestationThreshold: network.verifierThreshold,
          maxAttestationValiditySeconds: "REVIEW_REQUIRED",
          ...discovered.target.nativeConfig,
        },
      },
    },
    authorizationSigners: Array(network.verifierCount).fill("REVIEW_REQUIRED"),
    services: {
      nodeUrl,
      rpcUrlEnv: `CHAIN_${chainId}_RPC_URL`,
      sourceTokenEnv: "ACCESS_TOKEN",
      confirmations: "REVIEW_REQUIRED",
      verifiers: Array.from({ length: network.verifierCount }, () => ({
        url: "REVIEW_REQUIRED",
        confirmations: "REVIEW_REQUIRED",
      })),
      bridgeHealthUrl: "REVIEW_REQUIRED",
      safeProposerAddress: "REVIEW_REQUIRED",
      executorAddress: "REVIEW_REQUIRED",
      runtimeAccessAddress: "REVIEW_REQUIRED",
    },
  };
}

async function preflightDraft(draft, options = {}) {
  if (!["combined", "eab-only", "native-extension"].includes(draft.scope)) {
    throw new Error("scope must be combined, eab-only, or native-extension");
  }
  const includedEab = draft.discovery.eabRoutes?.filter(({ include }) => include);
  const includedNative = draft.discovery.nativeRoutes?.filter(({ include }) => include);
  const reviewed = structuredClone(draft);
  reviewed.discovery.eabRoutes = includedEab;
  reviewed.discovery.nativeRoutes = includedNative;
  if (draft.scope === "eab-only") {
    delete reviewed.discovery.target.nativeRepresentationBridge;
    delete reviewed.discovery.target.nativeConfig;
  }
  if (JSON.stringify(reviewed).includes("REVIEW_REQUIRED")) {
    throw new Error("Resolve every REVIEW_REQUIRED value used by this rollout");
  }
  if (draft.scope === "combined" && (!includedEab?.length || !includedNative?.length)) {
    throw new Error("combined scope requires included EAB and native routes");
  }
  if (draft.scope === "eab-only" && (!includedEab?.length || includedNative?.length)) {
    throw new Error("eab-only scope requires EAB routes and excludes native routes");
  }
  if (draft.scope === "native-extension" && (!includedNative?.length || includedEab?.length)) {
    throw new Error("Native extension must start from the existing initialized EAB deployment.json");
  }
  const chainId = Number(draft.discovery.target.chainId);
  const network = getExternalBridgeNetwork(chainId);
  const services = draft.services;
  if (!services || services.verifiers?.length !== network.verifierCount ||
      draft.authorizationSigners?.length !== network.verifierCount) {
    throw new Error(`Provide ${network.verifierCount} verifier endpoints and authorization signers`);
  }
  const confirmations = Number(services.confirmations);
  if (!Number.isSafeInteger(confirmations) || confirmations <= 0 ||
      services.verifiers.some(verifier => {
        const verifierConfirmations = Number(verifier.confirmations);
        return !/^https:\/\//.test(verifier.url || "") ||
          !Number.isSafeInteger(verifierConfirmations) ||
          verifierConfirmations < confirmations;
      }) ||
      !/^https:\/\//.test(services.bridgeHealthUrl || "")) {
    throw new Error("Review Runtime/verifier URLs and positive finality confirmations");
  }
  const normalizedServices = {
    ...services,
    confirmations,
    verifiers: services.verifiers.map(verifier => ({
      ...verifier,
      confirmations: Number(verifier.confirmations),
    })),
  };
  const target = draft.discovery.target;
  const addresses = [
    ...[target.externalAssetBridge, target.tokenRouter]
      .filter(value => value !== "DEPLOY_REQUIRED"),
    target.safeAddress,
    target.permit2Address, ...Object.values(target.roles || {}),
    target.bridgeOperator, target.guardian, ...(target.settlementVerifiers || []),
    services.safeProposerAddress, services.executorAddress, ...draft.authorizationSigners,
  ];
  if (addresses.some(value => !ethers.isAddress(value))) {
    throw new Error("Deployment addresses and identities must be valid");
  }
  if (!Number.isSafeInteger(Number(target.deploymentConfirmations)) ||
      Number(target.deploymentConfirmations) <= 0) {
    throw new Error("deploymentConfirmations must be a positive safe integer");
  }
  const context = {
    manifest: { ...reviewed, services: { ...normalizedServices, permit2Address: target.permit2Address } },
    settings: { sourceChainId: draft.discovery.source.stratoChainId },
    rollout: { chainId, vaultConfig: { chains: [{ safeAddress: target.safeAddress }] } },
  };
  return preflight(context, { ...options, skipReviewed: true });
}

async function preflight(context, options = {}) {
  if (!options.skipReviewed) scopeOf(context);
  if (JSON.stringify(context.manifest).includes("REVIEW_REQUIRED")) {
    throw new Error("Resolve every REVIEW_REQUIRED value in deployment.json");
  }
  if (!options.skipReviewed) validateReviewedInputs(context);
  const services = context.manifest.services;
  const rpc = process.env[services.rpcUrlEnv];
  if (!rpc?.startsWith("https://")) throw new Error(`Set HTTPS ${services.rpcUrlEnv} in deployment.env`);
  const provider = options.provider || new ethers.JsonRpcProvider(rpc, undefined, {
    batchMaxCount: 1, cacheTimeout: -1,
  });
  try {
    const safeAddress = context.rollout.vaultConfig.chains[0].safeAddress;
    const [network, safeCode, permit2Code, finalized, safeState] = await Promise.all([
      provider.getNetwork(),
      provider.getCode(safeAddress),
      services.permit2Address ? provider.getCode(services.permit2Address) : "0x01",
      provider.getBlock("finalized"),
      options.readSafe
        ? options.readSafe(safeAddress, provider)
        : Promise.all([
          new ethers.Contract(safeAddress, ["function getOwners() view returns (address[])"], provider).getOwners(),
          new ethers.Contract(safeAddress, ["function getThreshold() view returns (uint256)"], provider).getThreshold(),
        ]).then(([owners, threshold]) => ({ owners, threshold })),
    ]);
    if (network.chainId !== BigInt(context.rollout.chainId)) throw new Error("Target RPC chain ID mismatch");
    if (safeCode === "0x") throw new Error("Reviewed Safe has no target-chain bytecode");
    if (permit2Code === "0x") throw new Error("Reviewed Permit2 has no target-chain bytecode");
    if (!finalized || !Number.isSafeInteger(finalized.number) ||
        !/^0x[0-9a-f]{64}$/i.test(finalized.hash || "")) {
      throw new Error("Target RPC does not provide a canonical finalized block");
    }
    if (!Array.isArray(safeState.owners) || !safeState.owners.length ||
        !safeState.owners.every(ethers.isAddress) ||
        BigInt(safeState.threshold) <= 0n ||
        BigInt(safeState.threshold) > BigInt(safeState.owners.length)) {
      throw new Error("Reviewed Safe owners or threshold are invalid");
    }
    validateSafeRuntimeIdentities({
      ...context,
      deployment: context.deployment || {
        production: getExternalBridgeNetwork(context.rollout.chainId).production,
      },
    }, safeState.owners, BigInt(safeState.threshold));
  } finally {
    if (!options.provider) provider.destroy();
  }
  const token = await (options.resolveToken || resolveSourceToken)(context);
  const metadata = await (options.fetchJson || jsonFetch)(
    `${services.nodeUrl.replace(/\/$/, "")}/strato-api/eth/v1.2/metadata`, token, options.fetchImpl);
  if (String(metadata.networkID) !== String(context.settings.sourceChainId)) {
    throw new Error("STRATO node network ID mismatch");
  }
  return { status: "PREFLIGHT_PASSED",
    scope: options.skipReviewed ? context.manifest.scope : scopeOf(context),
    stratoChainId: context.settings.sourceChainId, targetChainId: String(context.rollout.chainId) };
}

function writeAdmin(file, manifestPath, report) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-admin-"));
  try {
    const request = createApprovalRequest(portableSnapshot(manifestPath, temporary), report);
    writeJson(file, { format: "eab-admin-approval", approval: request.approval, packet: request.packet });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function nativeBatch(context, mode, options = {}) {
  if (!context.nativeInputs.nativeRoutes?.length) return undefined;
  const rpc = process.env[context.manifest.services.rpcUrlEnv];
  const provider = options.provider || new ethers.JsonRpcProvider(rpc, undefined, {
    batchMaxCount: 1, cacheTimeout: -1,
  });
  try {
    return await (options.nativePlan || require("../nativeBridgeConfigure").plan)(
      context.nativeInputs.nativeConfig, provider, mode);
  } finally {
    if (!options.provider) provider.destroy();
  }
}

function writeServices(current, artifacts, scope) {
  const files = [...artifacts.serviceTemplates, ...artifacts.verifierPolicyPaths,
    ...(artifacts.nativeVerifierPolicyPaths || [])];
  const entries = files.map(file => ({
    name: path.basename(file),
    sha256: digest(fs.readFileSync(file, "utf8")),
  }));
  const index = {
    application: scope === "native-extension"
      ? { kind: "native-extension", runtime: "merge-running" }
      : { kind: "chain-install", runtime: "merge-chain-bindings", initialRunning: false },
    files: entries,
  };
  writeJson(path.join(current, "services.json"), index);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-services-"));
  try {
    writeJson(path.join(staging, "services.json"), index);
    files.forEach(file => fs.copyFileSync(file, path.join(staging, path.basename(file))));
    execFileSync("tar", ["-czf", path.join(current, "service-config.tar.gz"), "-C", staging,
      "services.json", ...entries.map(({ name }) => name)]);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function bootstrapContext(manifestPath, directory) {
  const manifest = structuredClone(readJson(manifestPath));
  if (manifest.schemaVersion !== 1) {
    throw new Error("Bootstrap requires an initialized deployment.json");
  }
  manifest.scope = "eab-only";
  manifest.authorizationSigners = [];
  manifest.services = { ...manifest.services, verifiers: [] };
  if (manifest.inputs) {
    delete manifest.inputs.nativeRoutes;
    delete manifest.inputs.nativeConfig;
  }
  const file = path.join(directory, "bootstrap-manifest.json");
  writeJson(file, manifest);
  return loadManifest(file, "initial");
}

function writeBootstrapPackage(current, artifacts, context, includeNative) {
  const bridgeTemplate = artifacts.serviceTemplates.find(file =>
    path.basename(file) === "bridge.env.template");
  if (!bridgeTemplate) throw new Error("Bootstrap did not generate bridge.env.template");
  const files = [bridgeTemplate, ...artifacts.verifierPolicyPaths];
  const entries = files.map(file => ({
    name: path.basename(file),
    sha256: digest(fs.readFileSync(file, "utf8")),
  }));
  const index = {
    format: "eab-infra-bootstrap",
    chainId: String(context.rollout.chainId),
    application: {
      initialRunning: false,
      provisioningOnly: true,
      requiresFinalConfiguration: true,
      phase: "verifier-identities",
    },
    files: entries,
    requiredReturn: [
      "verifierUrls",
      "authorizationSigners",
      "safeProposerAddress",
      "executorAddress",
      "bridgeHealthUrl",
      "runtimeAccessAddress",
      ...(includeNative ? ["nativeAttestationSigners", "nativeExecutorAddress"] : []),
    ],
  };
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-bootstrap-package-"));
  try {
    writeJson(path.join(staging, "infra-bootstrap.json"), index);
    files.forEach(file => fs.copyFileSync(file, path.join(staging, path.basename(file))));
    writeJson(path.join(current, "infra-bootstrap.json"), index);
    execFileSync("tar", ["-czf", path.join(current, "infra-bootstrap.tar.gz"), "-C", staging,
      "infra-bootstrap.json", ...entries.map(({ name }) => name)]);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function writeFoundationBootstrapPackage(current, chainId, includeNative, artifacts) {
  const bridgeTemplate = artifacts.serviceTemplates.find(file =>
    path.basename(file) === "bridge.env.template");
  if (!bridgeTemplate) throw new Error("Foundation bootstrap did not generate bridge.env.template");
  const entry = {
    name: path.basename(bridgeTemplate),
    sha256: digest(fs.readFileSync(bridgeTemplate, "utf8")),
  };
  const index = {
    format: "eab-infra-bootstrap",
    chainId: String(chainId),
    application: {
      initialRunning: false,
      provisioningOnly: true,
      requiresFinalConfiguration: true,
      phase: "foundation-identities",
    },
    files: [entry],
    requiredReturn: [
      "settlementVerifierAddresses",
      "safeProposerAddress",
      "executorAddress",
      "bridgeHealthUrl",
      "runtimeAccessAddress",
      ...(includeNative ? ["nativeExecutorAddress"] : []),
    ],
  };
  fs.mkdirSync(current, { recursive: true, mode: 0o700 });
  writeJson(path.join(current, "infra-bootstrap.json"), index);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-bootstrap-foundation-"));
  try {
    writeJson(path.join(staging, "infra-bootstrap.json"), index);
    fs.copyFileSync(bridgeTemplate, path.join(staging, entry.name));
    execFileSync("tar", ["-czf", path.join(current, "infra-bootstrap.tar.gz"), "-C", staging,
      "infra-bootstrap.json", entry.name]);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

async function generateBootstrap(manifestPath, options = {}) {
  const current = path.join(path.dirname(manifestPath), ".deployment", "bootstrap");
  fs.rmSync(current, { recursive: true, force: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-bootstrap-"));
  try {
    const reviewedManifest = readJson(manifestPath);
    if (reviewedManifest.scope === "native-extension") {
      throw new Error("Native extension reuses the existing Runtime and verifier infrastructure; complete its reviewed identities and run preflight");
    }
    const includeNative = reviewedManifest.scope !== "eab-only" &&
      (!!reviewedManifest.inputs?.nativeRoutes?.length ||
        reviewedManifest.discovery?.nativeRoutes?.some(route => route.include !== false));
    const chainId = reviewedManifest.discovery?.target?.chainId ||
      reviewedManifest.inputs?.externalDeployment?.chainId || options.context?.rollout?.chainId;
    const settlementVerifiers = reviewedManifest.discovery?.target?.settlementVerifiers ||
      reviewedManifest.settings?.settlementVerifiers || [];
    const expectedVerifierCount = getExternalBridgeNetwork(chainId).verifierCount;
    const foundationPhase = settlementVerifiers.length !== expectedVerifierCount ||
      new Set(settlementVerifiers.map(value => String(value).toLowerCase())).size !== expectedVerifierCount ||
      !settlementVerifiers.every(value => ethers.isAddress(value) && value !== ethers.ZeroAddress);
    let bootstrapManifest = manifestPath;
    if (!options.context && reviewedManifest.schemaVersion === 0) {
      const draft = structuredClone(reviewedManifest);
      const base = path.dirname(path.resolve(manifestPath));
      for (const field of ["externalDeployment", "nativeDeployment"]) {
        if (draft.discovery.target?.[field]) {
          draft.discovery.target[field] = path.resolve(base, draft.discovery.target[field]);
        }
      }
      for (const route of draft.discovery.nativeRoutes || []) {
        if (route.deployment) route.deployment = path.resolve(base, route.deployment);
      }
      for (const route of draft.discovery.eabRoutes || []) {
        if (route.include === false) continue;
        route.routePolicy = {
          ...route.routePolicy,
          autoRouteEnabled: false,
        };
        route.tokenPolicy = { ...route.tokenPolicy, migrateAmount: "0" };
      }
      if (foundationPhase) {
        draft.discovery.target.settlementVerifiers = Array.from(
          { length: expectedVerifierCount },
          (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`);
      }
      bootstrapManifest = path.join(work, "deployment.json");
      writeJson(bootstrapManifest, draft);
      await expandDraft(bootstrapManifest, options);
    }
    const context = options.context || bootstrapContext(bootstrapManifest, work);
    const artifacts = (options.generate || generate)(context, path.join(work, "artifacts"));
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    if (foundationPhase) {
      writeFoundationBootstrapPackage(current, chainId, includeNative, artifacts);
      return {
        status: "INFRA_FOUNDATION_BOOTSTRAP_GENERATED",
        directory: current,
        files: fs.readdirSync(current).sort(),
      };
    }
    writeBootstrapPackage(current, artifacts, context, includeNative);
    return {
      status: "INFRA_BOOTSTRAP_GENERATED",
      directory: current,
      files: fs.readdirSync(current).sort(),
    };
  } catch (error) {
    fs.rmSync(current, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function activationReady(context, inspection) {
  if (scopeOf(context) === "native-extension") return nativeOnlyEabVerified(context, inspection);
  const checks = inspection.report.checks;
  const required = [
    "external-identity", "deposit-router", "withdrawal-pause",
    "safe-runtime-identities", "vault-configuration", "verifiers", "bridge-health",
  ];
  return inspection.router?.paused === true &&
    required.every(name => checks.find(check => check.name === name)?.status === "PASSED") &&
    inspection.report.safe.executionOrder.every(({ status }) => status === "DONE") &&
    inspection.report.calls.filter(call => !isActivationCall(call))
      .every(({ status }) => status === "COMPLETE");
}

function activationVerified(inspection) {
  const required = [
    "external-identity", "deposit-router", "withdrawal-pause",
    "safe-runtime-identities", "vault-configuration", "verifiers", "bridge-health",
  ];
  return inspection.externalReady && inspection.router?.paused === false &&
    inspection.report.status === "DEPOSITS_ACTIVE_CANARY_REQUIRED" &&
    required.every(name => inspection.report.checks.find(check => check.name === name)?.status === "PASSED") &&
    inspection.report.calls.every(({ status }) => status === "COMPLETE");
}

async function generateCurrent(context, manifestPath, phase, options = {}) {
  validateReviewedInputs(context);
  const current = path.join(path.dirname(manifestPath), ".deployment", "current");
  fs.rmSync(current, { recursive: true, force: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-generate-"));
  try {
    const artifacts = (options.generate || generate)(context, work);
    const inspection = await (options.inspect || inspect)(context, artifacts, {
      staged: phase === "preactivation",
    });
    const identityFailures = inspection.report.checks.filter(({ name, status }) =>
      status === "FAILED" && ["strato", "external-identity", "safe-runtime-identities"].includes(name));
    if (identityFailures.length) {
      throw new Error(`Live reconciliation failed: ${identityFailures.map(({ name }) => name).join(", ")}`);
    }
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    if (phase === "preactivation") {
      let adminReport = inspection.report;
      if (context.nativeInputs.nativeRoutes?.length) {
        const nativeInspection = await (options.nativeInspection || nativeApprovalInspection)(
          context, artifacts, "configure", inspection, options);
        const calls = [...inspection.report.calls, ...nativeInspection.report.calls];
        if (new Set(calls.map(({ id }) => id)).size !== calls.length) {
          throw new Error("Combined EAB/native governance contains duplicate calls");
        }
        adminReport = { ...inspection.report, calls,
          approvalKind: scopeOf(context) === "native-extension" ? "native" : "all",
          nativeMode: scopeOf(context) === "native-extension" ? "configure" : undefined };
      }
      if (governanceBatch(adminReport).calls.length) {
        writeAdmin(path.join(current, "preactivation-admin.json"), manifestPath, adminReport);
      }
      if (inspection.report.safe.executionOrder.some(({ status }) =>
        !["DONE", "PENDING"].includes(status))) {
        throw new Error("Safe configuration could not be fully verified");
      }
      const eab = inspection.report.safe.executionOrder
        .filter(({ status }) => status === "PENDING")
        .map(({ path: file }) => readJson(file));
      const native = await nativeBatch(context, "configure", options);
      const batches = [...eab, ...(native?.transactions?.length ? [native.safe] : [])];
      if (batches.length) {
        const safes = new Set(batches.map(batch => batch.meta.createdFromSafeAddress.toLowerCase()));
        if (safes.size !== 1) {
          throw new Error("Preactivation requires one Safe; EAB and native destination use multiple Safes");
        }
        const safe = batches[0].meta.createdFromSafeAddress;
        const batch = buildTransactionBuilderBatch(context.rollout.chainId, safe,
          batches.flatMap(({ transactions }) => transactions),
          { name: "Bridge preactivation", description: "Pause and configure EAB/native atomically" });
        batch.meta.reviewBinding = digest({ manifest: context.revision, live: inspection.report.approvalHash });
        writeJson(path.join(current, `preactivation-safe-${safe.toLowerCase()}.json`), batch);
      }
      writeServices(current, artifacts, scopeOf(context));
    } else {
      if (!activationReady(context, inspection)) {
        throw new Error("Activation readiness is not verified");
      }
      let adminReport = inspection.report;
      if (context.nativeInputs.nativeRoutes?.length) {
        const nativeInspection = await (options.nativeInspection || nativeApprovalInspection)(
          context, artifacts, "activate", inspection, options);
        const calls = [...inspection.report.calls, ...nativeInspection.report.calls];
        adminReport = { ...inspection.report, calls,
          approvalKind: scopeOf(context) === "native-extension" ? "native" : "all",
          nativeMode: scopeOf(context) === "native-extension" ? "activate" : undefined };
      }
      if (governanceBatch(adminReport).calls.length) {
        writeAdmin(path.join(current, "activation-admin.json"), manifestPath, adminReport);
      }
      const native = await nativeBatch(context, "activate", options);
      const batches = [];
      if (scopeOf(context) !== "native-extension") {
        batches.push(readJson((options.activate || activate)(
          context, artifacts,
          { ...inspection, report: { ...inspection.report, status: "READY_FOR_ACTIVATION_REVIEW" } },
          inspection.report.approvalHash)));
      }
      if (native?.transactions?.length) batches.push(native.safe);
      if (!batches.length) throw new Error("No activation Safe transactions remain");
      const safes = new Set(batches.map(batch => batch.meta.createdFromSafeAddress.toLowerCase()));
      if (safes.size !== 1) throw new Error("Activation requires one Safe; EAB and native destination use multiple Safes");
      const safe = batches[0].meta.createdFromSafeAddress;
      const batch = buildTransactionBuilderBatch(context.rollout.chainId, safe,
        batches.flatMap(({ transactions }) => transactions),
        { name: "Bridge activation", description: "Activation only" });
      batch.meta.reviewBinding = digest({ manifest: context.revision, live: inspection.report.approvalHash });
      writeJson(path.join(current, `activation-safe-${safe.toLowerCase()}.json`), batch);
    }
    return { status: phase === "preactivation" ? "PREACTIVATION_GENERATED" : "ACTIVATION_GENERATED",
      directory: current, files: fs.readdirSync(current).sort() };
  } catch (error) {
    fs.rmSync(current, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs([...argv]);
  if (args.command === "approve") {
    return runApproval(args);
  }
  const manifestPath = path.resolve(args.manifest);
  loadRolloutEnvironment(manifestPath, args["env-file"]);
  if (args.command === "init") {
    if (args["chain-id"] || args["source-chain-id"]) {
      const nodeUrl = args["node-url"] || process.env.NODE_URL;
      if (!nodeUrl) throw new Error("Set NODE_URL in app/contracts/.env");
      const token = await (options.resolveToken || resolveSourceToken)(
        { manifest: { services: { sourceTokenEnv: "ACCESS_TOKEN" } } });
      const result = await (options.discover || require("../prepareBridgeRollout").discover)(
        nodeUrl, args["chain-id"], token, options.fetchImpl || fetch,
        { sourceChainId: args["source-chain-id"] });
      const current = fs.existsSync(manifestPath) ? readJson(manifestPath) : undefined;
      if (current?.schemaVersion === 1) throw new Error("deployment.json is already initialized");
      const discovered = initializeDraft(result.config, nodeUrl);
      writeJson(manifestPath, mergeDiscovery(current, discovered.discovery));
      if (!current?.discovery) {
        const initial = readJson(manifestPath);
        Object.assign(initial, {
          scope: discovered.scope,
          services: discovered.services,
          authorizationSigners: discovered.authorizationSigners,
        });
        writeJson(manifestPath, initial);
      }
      return { status: "INITIALIZED", manifest: manifestPath, missing: result.missing };
    }
    if (!fs.existsSync(manifestPath)) throw new Error("init requires live discovery arguments");
    await expandDraft(manifestPath, options);
    return { status: "INITIALIZED", manifest: manifestPath };
  }
  let draft = readJson(manifestPath);
  if (args.command === "bootstrap") {
    return generateBootstrap(manifestPath, options);
  }
  if (args.command === "preflight" && draft.schemaVersion === 0) {
    return preflightDraft(draft, options);
  }
  await expandDraft(manifestPath, options);
  const context = loadManifest(manifestPath, "activation");
  if (args.command === "preflight") return preflight(context, options);
  await preflight(context, options);
  if (args.command === "generate") return generateCurrent(context, manifestPath, "preactivation", options);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-verify-"));
  try {
    const artifacts = (options.generate || generate)(context, work);
    const inspection = await (options.inspect || inspect)(context, artifacts);
    if (args.command === "verify" && activationVerified(inspection)) {
      await (options.verifyNativeActivation || verifyNativeActivation)(context, artifacts, inspection);
      return { status: "ACTIVE_VERIFIED", next: "Run deposit and withdrawal canaries before declaring launch complete" };
    }
    if (!activationReady(context, inspection)) {
      throw new Error("Preactivation is incomplete or Runtime is not ready");
    }
    if (context.nativeInputs.nativeRoutes?.length) {
      await (options.validateNativeReadiness || validateNativeReadiness)(context, artifacts,
        options.fetchImpl || fetch,
        inspection.report.checks.find(({ name }) => name === "bridge-health")?.data?.deployment?.verifiers);
      const native = await (options.nativeInspection || nativeApprovalInspection)(
        context, artifacts, "configure", inspection, options);
      if (native.report.calls.some(({ status }) => status !== "COMPLETE")) {
        throw new Error("Native STRATO preactivation is incomplete");
      }
    }
    if (args.command === "verify") return { status: "READY_FOR_ACTIVATION" };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  return generateCurrent(context, manifestPath, "activation", options);
}

module.exports = {
  scopeOf, mergeDiscovery, initializeDraft, expandDraft, preflightDraft, preflight, activationReady, activationVerified,
  generateBootstrap, generateCurrent, main,
};
