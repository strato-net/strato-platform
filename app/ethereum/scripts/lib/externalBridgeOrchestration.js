const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { ethers } = require("ethers");
const {
  collectInventory, buildPolicyTemplate, buildRolloutTemplates,
  buildSynchronizedRollout, validateInitialRollout,
} = require("./externalBridgeRolloutPlan");
const { buildDepositRouterBatches, buildDepositRouterControl } = require("../generateExternalBridgeRollout");
const { normalizeConfig, buildOperations } = require("./externalBridgeVaultPlan");
const { buildTransactionBuilderBatch } = require("./depositRouterSafeOps");
const { loadConfig, buildPlan } = require("../../../contracts/deploy/configure-external-bridge");

const CONTRACTS = path.resolve(__dirname, "../../../contracts/deploy");
const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const address = (value) => String(value || "").replace(/^0x/i, "").toLowerCase();
const bool = (value) => value === true || value === "true";
const key = (token, chain, stratoToken) => `${address(token)}:${chain}:${address(stratoToken)}`;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function initializeManifest(settingsPath, policyPath, manifestPath) {
  if (fs.existsSync(manifestPath)) throw new Error("Manifest already exists; it was not overwritten");
  const settings = readJson(settingsPath);
  for (const name of ["externalDeployment", "depositPlan", "bridgeTemplate"]) {
    if (!settings[name]) throw new Error(`settings.${name} is required`);
    settings[name] = path.resolve(path.dirname(settingsPath), settings[name]);
  }
  const deployment = readJson(settings.externalDeployment);
  const templates = buildRolloutTemplates({ settings, deployment, bridgeDefaults: readJson(settings.bridgeTemplate) });
  const inventory = collectInventory(readJson(settings.depositPlan), templates.chainId);
  const manifest = {
    schemaVersion: 1,
    settings,
    policy: policyPath ? readJson(policyPath) : buildPolicyTemplate(inventory, templates.chainId, templates.lastProcessedBlock),
    authorizationSigners: [],
    services: {
      nodeUrl: "REVIEW_REQUIRED",
      rpcUrlEnv: `CHAIN_${templates.chainId}_RPC_URL`,
      sourceTokenEnv: "ACCESS_TOKEN",
      confirmations: "REVIEW_REQUIRED",
      verifiers: [],
      bridgeHealthUrl: "REVIEW_REQUIRED",
      safeProposerAddress: "REVIEW_REQUIRED",
      executorAddress: "REVIEW_REQUIRED",
    },
  };
  writeJson(manifestPath, manifest);
  return manifest;
}

function loadManifest(file, stage = "initial") {
  if (!["initial", "activation"].includes(stage)) throw new Error("--stage must be initial|activation");
  const manifest = readJson(file);
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported manifest schemaVersion");
  const services = manifest.services;
  if (!services || !/^https:\/\//.test(services.nodeUrl || "")) throw new Error("services.nodeUrl must use HTTPS");
  for (const name of ["rpcUrlEnv", "sourceTokenEnv"]) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(services[name] || "")) throw new Error(`${name} must name an environment variable, not a secret value`);
  }
  if (!Array.isArray(services.verifiers) || !Array.isArray(manifest.authorizationSigners)) throw new Error("verifiers and authorizationSigners must be arrays");
  for (const value of [services.nodeUrl, ...services.verifiers.map(({ url }) => url)]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || /[\r\n]/.test(value) || url.username || url.password || url.search || url.hash) throw new Error("Service base URLs must be HTTPS without credentials, query strings or control characters");
  }
  for (const verifier of services.verifiers) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(verifier.tokenEnv || "")) throw new Error("Verifier tokenEnv must name an environment variable");
  }
  if (typeof manifest.settings?.sourceChainId !== "string") throw new Error("settings.sourceChainId must be a decimal string");
  const settings = { ...manifest.settings };
  for (const name of ["externalDeployment", "depositPlan", "bridgeTemplate"]) settings[name] = path.resolve(path.dirname(file), settings[name]);
  const deployment = readJson(settings.externalDeployment);
  const depositPlan = readJson(settings.depositPlan);
  const defaults = readJson(settings.bridgeTemplate);
  const templates = buildRolloutTemplates({ settings, deployment, bridgeDefaults: defaults });
  const signers = manifest.authorizationSigners || [];
  if (signers.length !== 0 && (signers.length !== 3 || new Set(signers.map(address)).size !== 3 || signers.some((signer) => !ethers.isAddress(signer)))) {
    throw new Error("Provide either no authorizationSigners before KMS provisioning, or exactly three distinct addresses");
  }
  templates.vaultTemplate.chains[0].attestationSigners = signers;
  const rollout = buildSynchronizedRollout({ depositPlan, ...templates, policy: manifest.policy, chainId: templates.chainId });
  validateInitialRollout(rollout, { activation: stage === "activation" });
  if (rollout.inventory.length === 0) throw new Error("Deployment inventory is empty");
  const operator = address(settings.bridgeOperator);
  if (settings.settlementVerifiers.some((verifier) => address(verifier) === operator)) throw new Error("Operator cannot be a settlement verifier");
  // Code changes invalidate approval and cached generation just like input changes.
  const codeFiles = [__filename, path.join(__dirname, "externalBridgeRolloutPlan.js"),
    path.join(__dirname, "externalBridgeVaultPlan.js"), path.join(__dirname, "depositRouterSafeOps.js"),
    path.join(__dirname, "../externalBridgeRollout.js"), path.join(__dirname, "../generateExternalBridgeRollout.js"),
    path.join(__dirname, "../scanTokenConfig.js"), path.join(__dirname, "../externalBridgeVaultOps.js"),
    path.join(CONTRACTS, "configure-external-bridge.js"), path.join(CONTRACTS, "external-bridge-verification.js")];
  const revision = digest({ stage, manifest, settings, deployment, depositPlan, defaults,
    code: codeFiles.map((name) => digest(fs.readFileSync(name, "utf8"))) });
  return { stage, manifest, rollout, revision, settings, deployment };
}

function generate(context, outputDirectory) {
  const directory = path.resolve(outputDirectory, context.revision);
  const indexFile = path.join(directory, "artifacts.json");
  const { rollout } = context;
  const hashes = {};
  const saveText = (name, encoded) => {
    const file = path.join(directory, name);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") !== encoded) {
      throw new Error(`Generated artifact changed: ${name}; restore it rather than editing generated configuration`);
    }
    if (!fs.existsSync(file)) {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, encoded, { mode: 0o600 });
    }
    hashes[name] = digest(encoded);
    return file;
  };
  const save = (name, value) => {
    if (value.createdAt !== undefined) value.createdAt = 0;
    return saveText(name, `${JSON.stringify(value, null, 2)}\n`);
  };
  const bridgeConfigPath = save("bridge.json", rollout.bridgeConfig);
  const vaultConfigPath = save("vault.json", rollout.vaultConfig);
  const verifierPolicyPaths = rollout.verifierPolicies.map((policy, index) => save(`verifier-${index + 1}.json`, policy));
  const depositRouterBatchPaths = buildDepositRouterBatches(rollout).map(({ index, transactionBuilder }) => save(`router-tokens-${index}.json`, transactionBuilder));
  const depositRouterPausePath = save("router-pause.json", buildDepositRouterControl(rollout, "pause"));
  // Activation material is generated only after a fresh successful readiness check.
  const manifestPath = save("rollout.json", {
    stage: context.stage, chainId: rollout.chainId, inventory: rollout.inventory,
    depositRouterUpdates: rollout.depositRouter.updates,
    outputs: { bridgeConfigPath, vaultConfigPath, verifierPolicyPaths },
  });
  let vaultConfigurePath;
  const vaultInterface = new ethers.Interface([
    "function setSourceBridge(uint256,address,bool)", "function setAttestationSigner(address,bool)",
    "function setAttestationThreshold(uint8)", "function setMaxAuthorizationValiditySeconds(uint256)",
    "function setTokenPolicy(address,bool,uint256,uint256,uint256,uint256)", "function pause()",
  ]);
  const chain = rollout.vaultConfig.chains[0];
  const vaultPausePath = save("vault-pause.json", buildTransactionBuilderBatch(rollout.chainId, chain.safeAddress,
    [{ to: chain.vaultAddress, value: "0", data: vaultInterface.encodeFunctionData("pause"), operation: 0 }], { name: "Pause external vault" }));
  if (chain.attestationSigners.length === 3) {
    const config = normalizeConfig(rollout.vaultConfig);
    const transactions = buildOperations(config, config.chains[0]).configure.map((operation) => ({
      to: operation.target, value: "0", operation: 0, data: vaultInterface.encodeFunctionData(operation.method, operation.args),
    }));
    vaultConfigurePath = save("vault-configure.json", buildTransactionBuilderBatch(rollout.chainId, chain.safeAddress, transactions, { name: "Configure external vault" }));
  }
  const serviceTemplates = [];
  const reference = (name) => "${" + name + "}";
  const saveEnv = (name, values) => serviceTemplates.push(saveText(name,
    "# Generated bindings; resolve environment references through the deployment secret renderer.\n" +
    Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n"));
  const services = context.manifest.services;
  const bridgeEnvironment = {
    NODE_URL: services.nodeUrl, EXTERNAL_ASSET_BRIDGE_ADDRESS: context.settings.externalAssetBridge,
    TOKEN_ROUTER: context.settings.tokenRouter, PRICE_ORACLE_ADDRESS: rollout.bridgeConfig.externalAssetBridge.priceOracle,
    SAFE_ADDRESS: chain.safeAddress,
    [`CHAIN_${rollout.chainId}_RPC_URL`]: reference(services.rpcUrlEnv),
    [`CHAIN_${rollout.chainId}_DEPOSIT_CONFIRMATIONS`]: services.confirmations,
    [`CHAIN_${rollout.chainId}_EXTERNAL_BRIDGE_VERIFIER_URLS`]: services.verifiers.map(({ url }) => url).join(","),
    [`CHAIN_${rollout.chainId}_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS`]: services.verifiers.map(({ tokenEnv }) => reference(tokenEnv)).join(","),
  };
  for (const name of ["BRIDGE_IMAGE", "BRIDGENGINX_IMAGE", "BRIDGE_ADDRESS", "STRATO_APP_API_URL", "BA_USERNAME", "BA_PASSWORD", "CLIENT_ID", "CLIENT_SECRET", "OPENID_DISCOVERY_URL",
    "RELAYER_BA_USERNAME", "RELAYER_BA_PASSWORD", "RELAYER_CLIENT_ID", "RELAYER_CLIENT_SECRET", "RELAYER_OPENID_DISCOVERY_URL",
    "SAFE_PROPOSER_ADDRESS", "SAFE_PROPOSER_KMS_KEY_ID", "SAFE_PROPOSER_KMS_REGION", "SAFE_API_KEY", "DEPOSIT_WEBHOOK_TOKEN", "DEPOSIT_OPERATIONS_TOKEN",
    ...["WS_RPC_URL", "VERIFICATION_RPC_URLS", "EXTERNAL_BRIDGE_EXECUTOR_ADDRESS", "EXTERNAL_BRIDGE_EXECUTOR_KMS_KEY_ID", "EXTERNAL_BRIDGE_EXECUTOR_KMS_REGION"].map((suffix) => `CHAIN_${rollout.chainId}_${suffix}`)]) bridgeEnvironment[name] = reference(name);
  bridgeEnvironment.SAFE_PROPOSER_ADDRESS = services.safeProposerAddress || "REVIEW_REQUIRED";
  bridgeEnvironment[`CHAIN_${rollout.chainId}_EXTERNAL_BRIDGE_EXECUTOR_ADDRESS`] = services.executorAddress || "REVIEW_REQUIRED";
  saveEnv("bridge.env.template", bridgeEnvironment);
  rollout.verifierPolicies.forEach((policy, index) => {
    const prefix = `VERIFIER_${index + 1}`;
    saveEnv(`verifier-${index + 1}.env.template`, {
      BRIDGE_IMAGE: reference("BRIDGE_IMAGE"), PORT: 3004, SOURCE_CHAIN_ID: policy.sourceChainId,
      STRATO_NODE_URL: services.nodeUrl, EXTERNAL_ASSET_BRIDGE_ADDRESS: policy.sourceBridge,
      DESTINATION_CHAIN_ID: policy.destinationChainId, DESTINATION_VAULT_ADDRESS: policy.destinationVault,
      VAULT_AUTHORIZATION_SIGNER_ADDRESS: context.manifest.authorizationSigners[index] || "REVIEW_REQUIRED",
      KMS_KEY_ID: reference(`${prefix}_KMS_KEY_ID`), KMS_REGION: reference(`${prefix}_KMS_REGION`),
      VERIFIER_RPC_URL: reference(`${prefix}_RPC_URL`), VERIFIER_INDEPENDENT_RPC_URLS: reference(`${prefix}_INDEPENDENT_RPC_URLS`), VERIFIER_CONFIRMATIONS: services.confirmations,
      VERIFIER_POLICY_PATH: "/run/secrets/eab-verifier-policy.json", VERIFIER_POLICY_PATH_HOST: reference("VERIFIER_POLICY_PATH_HOST"),
      SETTLEMENT_ATTESTOR_OPENID_DISCOVERY_URL: reference(`${prefix}_OPENID_DISCOVERY_URL`),
      SETTLEMENT_ATTESTOR_CLIENT_ID: reference(`${prefix}_CLIENT_ID`), SETTLEMENT_ATTESTOR_CLIENT_SECRET: reference(`${prefix}_CLIENT_SECRET`),
      SETTLEMENT_ATTESTOR_BA_USERNAME: reference(`${prefix}_BA_USERNAME`), SETTLEMENT_ATTESTOR_BA_PASSWORD: reference(`${prefix}_BA_PASSWORD`),
      EXTERNAL_BRIDGE_VERIFIER_API_TOKEN: reference(services.verifiers[index]?.tokenEnv || `${prefix}_API_TOKEN`),
    });
  });
  const index = { serviceTemplates, revision: context.revision, hashes, bridgeConfigPath, vaultConfigPath, verifierPolicyPaths,
    depositRouterBatchPaths, depositRouterPausePath, vaultPausePath, vaultConfigurePath, manifestPath };
  writeJson(indexFile, index);
  return { directory, ...index };
}

function governanceProgress(settings, state, { stage = "initial", activationErrors } = {}) {
  const { initialization: init, routes, actions, permissionErrors } = state;
  const calls = [];
  const initialized = bool(init.tokenRouter.initialized) && bool(init.bridge.initialized);
  for (const step of ["initialize", "routes", "actions"]) {
    buildPlan(settings, step).forEach((call, index) => {
      const method = call.args._func;
      const values = call.args._args.map(({ value }) => value);
      let complete = false;
      let blocked;
      if (method === "initialize") {
        const router = address(call.args._target) === address(settings.tokenRouter.address);
        const actual = router ? init.tokenRouter : init.bridge;
        const fields = router ? ["poolFactory", "poolV3Factory", "directMintPsm", "metalForge", "saveUsdstVault"] : ["tokenFactory", "bridgeOperator", "guardian", "USDST_ADDRESS"];
        if (bool(actual.initialized)) {
          complete = fields.every((field, i) => address(actual[field]) === address(values[i]));
          if (!complete) blocked = "Already initialized with different values; requires reviewed corrective governance, never reinitialization";
        } else if (actual.initialized !== false && actual.initialized !== "false") blocked = "Initialization state is unknown";
      } else if (method === "setYieldVault") {
        complete = init.approvedYieldVaults.has(address(values[0]));
        if (!bool(init.tokenRouter.initialized)) blocked = "Wait for TokenRouter initialization quorum";
      } else if (method === "setPriceOracle" || method === "setTokenRouter") {
        complete = address(init.bridge[method === "setPriceOracle" ? "priceOracle" : "tokenRouter"]) === address(values[0]);
      } else if (method === "setSettlementVerifier") complete = init.settlementVerifiers.has(address(values[0]));
      else if (method === "setSettlementVerifierThreshold") {
        complete = String(init.bridge.settlementVerifierThreshold) === String(values[0]);
        if (settings.bridge.settlementVerifiers.some((verifier) => !init.settlementVerifiers.has(address(verifier)))) blocked = "Wait for verifier registration quorum";
      } else if (method === "setMintPolicy") {
        const actual = routes.mintPolicies?.get(address(values[0]));
        complete = !!actual && String(actual.capacity) === String(values[1]) && String(actual.refillRate) === String(values[2]);
      } else if (method === "addWhitelist") {
        complete = !permissionErrors.includes(`Missing bridge ${values[1]} permission for STRATO token ${address(values[0])}`);
      } else if (method === "setChain") {
        const actual = routes.chains.get(String(values[4]));
        if (actual) {
          complete = actual.chainName === values[0] && address(actual.vault) === address(values[1]) &&
            address(actual.depositRouter) === address(values[2]) && bool(actual.enabled) === values[3];
          if (!complete) blocked = "Existing chain differs; reconcile separately to preserve its live cursor and pending operations";
          else if (BigInt(actual.lastProcessedBlock) < BigInt(values[5])) {
            complete = false;
            blocked = "Live cursor is behind configured start; reconcile instead of advancing it automatically";
          }
        }
      } else if (method === "setRoute") {
        const actual = routes.routes.get(key(values[0], values[1], values[2]));
        const fields = ["depositsEnabled", "withdrawalsEnabled", "externalDecimals", "externalName", "externalSymbol", "maxPerWithdrawal", "manualReviewThreshold"];
        complete = !!actual && fields.every((field, i) => String(actual[field]) === String(values[i + 3]));
        if (!routes.chains.has(String(values[1]))) blocked = "Wait for chain configuration quorum";
      } else if (method === "setRouteRebaseRequired") {
        const routeKey = key(values[0], values[1], values[2]);
        complete = routes.routes.has(routeKey) && routes.rebaseRequired.has(routeKey) === values[3];
        if (!routes.routes.has(routeKey)) blocked = "Wait for route configuration quorum";
      } else if (method === "setDepositAction") {
        const config = actions.actionConfigs.get(key(values[0], values[1], values[2])) || {};
        complete = bool(config.autoRoute) === bool(values[4]);
        if (!complete && bool(values[4])) {
          if (stage !== "activation") blocked = "Regenerate policy artifacts with --stage activation";
          else if (!activationErrors || activationErrors.length) blocked = "Activation prerequisites and pre-enable verify-actions must pass";
        }
      } else blocked = `Unsupported governance method ${method}`;
      if (step !== "initialize" && !initialized) blocked = "Wait for both initializations";
      if (step === "routes" && method !== "addWhitelist" && permissionErrors.length) blocked = "Wait for token permission quorum";
      if (step === "initialize" && !["initialize", "setYieldVault"].includes(method) && !bool(init.bridge.initialized)) blocked = "Wait for ExternalAssetBridge initialization quorum";
      calls.push({ id: digest(call), step, callNumber: index + 1, call,
        status: complete ? "COMPLETE" : blocked ? "BLOCKED" : "READY", reason: complete ? undefined : blocked });
    });
  }
  return calls;
}

function currentCursorSettings(settings, routes) {
  return { ...settings, chains: settings.chains.map((chain) => {
    const live = routes.chains.get(String(chain.externalChainId));
    return live && BigInt(live.lastProcessedBlock) >= BigInt(chain.lastProcessedBlock)
      ? { ...chain, lastProcessedBlock: String(live.lastProcessedBlock) } : chain;
  }) };
}

module.exports = { CONTRACTS, digest, readJson, writeJson, address, bool, initializeManifest, loadManifest,
  generate, governanceProgress, currentCursorSettings, loadConfig };
