const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { ethers } = require("ethers");
const {
  collectInventory, buildPolicyTemplate, buildRolloutTemplates,
  buildSynchronizedRollout, validateInitialRollout,
} = require("./externalBridgeRolloutPlan");
const { buildDepositRouterBatches, buildDepositRouterControl } = require("./externalBridgeArtifacts");
const { normalizeConfig, buildOperations } = require("./externalBridgeVaultPlan");
const { buildTransactionBuilderBatch } = require("./depositRouterSafeOps");
const { getExternalBridgeNetwork } = require("./externalBridgeNetworks");
const { loadConfig, buildPlan } = require("../../../contracts/deploy/configure-external-bridge");

const CONTRACTS = path.resolve(__dirname, "../../../contracts/deploy");
const digest = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const address = (value) => String(value || "").replace(/^0x/i, "").toLowerCase();
const bool = (value) => value === true || value === "true";
const shellQuote = (value) => {
  if (/[\r\n]/.test(String(value))) throw new Error("Command paths must not contain line breaks");
  return `'${String(value).replace(/'/g, "'\\''")}'`;
};
const key = (token, chain, stratoToken) => `${address(token)}:${chain}:${address(stratoToken)}`;
const rolloutCodeFiles = () => [
  __filename, ...["rolloutRuntime", "rolloutGovernance", "rolloutEabInspection", "rolloutNativeInspection", "rolloutHandoff", "rolloutOutput"].map(name => path.join(__dirname, `${name}.js`)),
  path.join(__dirname, "externalBridgeRolloutPlan.js"),
  path.join(__dirname, "externalBridgeVaultPlan.js"), path.join(__dirname, "depositRouterSafeOps.js"),
  path.join(__dirname, "externalBridgeArtifacts.js"), path.join(__dirname, "externalBridgeNetworks.js"),
  path.join(__dirname, "../externalBridgeRollout.js"),
  path.join(__dirname, "../nativeBridgeConfigure.js"), path.join(__dirname, "../nativeBridgeSignerOps.js"),
  path.join(__dirname, "../prepareBridgeRollout.js"),
  path.join(__dirname, "../scanTokenConfig.js"), path.join(__dirname, "../externalBridgeVaultOps.js"),
  path.join(CONTRACTS, "configure-external-bridge.js"), path.join(CONTRACTS, "external-bridge-verification.js"),
  path.join(CONTRACTS, "configure-native-route.js"),
];
const rolloutToolingRevision = () =>
  digest(rolloutCodeFiles().map((name) => digest(fs.readFileSync(name, "utf8"))));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function loadBridgeDefaults(settings, directory) {
  if (settings.dependencies && settings.bridgeTemplate) {
    throw new Error("Use settings.dependencies or settings.bridgeTemplate, not both");
  }
  if (settings.dependencies) {
    const dependencies = settings.dependencies;
    const required = [
      "adminRegistry", "poolFactory", "poolV3Factory", "directMintPsm",
      "metalForge", "saveUsdstVault", "yieldVaults", "tokenFactory", "usdst",
      "priceOracle",
    ];
    const missing = required.filter((name) =>
      dependencies[name] === undefined ||
      dependencies[name] === null ||
      dependencies[name] === "",
    );
    if (missing.length) {
      throw new Error(`settings.dependencies requires ${missing.join(", ")}`);
    }
    if (!Array.isArray(dependencies.yieldVaults)) {
      throw new Error("settings.dependencies.yieldVaults must be an array");
    }
    return {
      adminRegistry: dependencies.adminRegistry,
      tokenRouter: {
        poolFactory: dependencies.poolFactory,
        poolV3Factory: dependencies.poolV3Factory,
        directMintPsm: dependencies.directMintPsm,
        metalForge: dependencies.metalForge,
        saveUsdstVault: dependencies.saveUsdstVault,
        yieldVaults: dependencies.yieldVaults,
      },
      externalAssetBridge: {
        tokenFactory: dependencies.tokenFactory,
        usdst: dependencies.usdst,
        priceOracle: dependencies.priceOracle,
      },
    };
  }
  if (!settings.bridgeTemplate) {
    throw new Error("settings.dependencies is required");
  }
  settings.bridgeTemplate = path.resolve(directory, settings.bridgeTemplate);
  return readJson(settings.bridgeTemplate);
}

function initializeManifest(settingsPath, policyPath, manifestPath) {
  const inPlace = path.resolve(settingsPath) === path.resolve(manifestPath);
  if (fs.existsSync(manifestPath) && !inPlace) throw new Error("Manifest already exists; it was not overwritten");
  const settings = readJson(settingsPath);
  if (inPlace && settings.schemaVersion !== undefined) throw new Error("Manifest is already initialized");
  for (const name of ["externalDeployment", "depositPlan"]) {
    if (!settings[name]) throw new Error(`settings.${name} is required`);
    settings[name] = path.resolve(path.dirname(settingsPath), settings[name]);
  }
  const bridgeDefaults = loadBridgeDefaults(settings, path.dirname(settingsPath));
  const deployment = readJson(settings.externalDeployment);
  const depositPlan = readJson(settings.depositPlan);
  const templates = buildRolloutTemplates({ settings, deployment, bridgeDefaults });
  const inventory = collectInventory(depositPlan, templates.chainId);
  const manifest = {
    schemaVersion: 1,
    settings,
    inputs: { externalDeployment: deployment, depositPlan },
    policy: policyPath ? readJson(policyPath) : buildPolicyTemplate(inventory, templates.chainId, templates.lastProcessedBlock),
    authorizationSigners: [],
    services: {
      nodeUrl: "REVIEW_REQUIRED",
      rpcUrlEnv: `CHAIN_${templates.chainId}_RPC_URL`,
      sourceTokenEnv: "ACCESS_TOKEN",
      confirmations: "REVIEW_REQUIRED",
      verifiers: [],
      bridgeHealthUrlEnv: "BRIDGE_HEALTH_URL",
      safeProposerAddress: "REVIEW_REQUIRED",
      executorAddress: "REVIEW_REQUIRED",
    },
  };
  const nativeInputs = readNativeInputs(manifest, path.dirname(settingsPath));
  Object.assign(manifest.inputs, nativeInputs);
  writeJson(manifestPath, manifest);
  return manifest;
}

function readNativeInputs(manifest, directory) {
  if (manifest.inputs?.nativeRoutes !== undefined || manifest.inputs?.nativeConfig !== undefined) {
    if (!Array.isArray(manifest.inputs.nativeRoutes) || !manifest.inputs.nativeConfig ||
        typeof manifest.inputs.nativeConfig !== "object" || Array.isArray(manifest.inputs.nativeConfig)) {
      throw new Error("Native deployment requires both inputs.nativeRoutes and inputs.nativeConfig");
    }
    return { nativeRoutes: manifest.inputs.nativeRoutes, nativeConfig: manifest.inputs.nativeConfig };
  }
  if (manifest.settings.depositPlan.startsWith("embedded:")) return {};
  const prepared = path.dirname(path.resolve(directory, manifest.settings.depositPlan));
  const routes = path.join(prepared, "native-routes.json");
  const config = path.join(prepared, "native.json");
  if (!fs.existsSync(routes) && !fs.existsSync(config)) return {};
  if (!fs.existsSync(routes) || !fs.existsSync(config)) throw new Error("Native deployment requires native-routes.json and native.json");
  return readNativeInputs({ inputs: { nativeRoutes: readJson(routes), nativeConfig: readJson(config) } }, directory);
}

function createPortableBundle(manifestPath, bundlePath, stage = "activation") {
  const context = loadManifest(manifestPath, stage);
  const manifest = context.manifest;
  const services = manifest.services;
  const network = getExternalBridgeNetwork(context.rollout.chainId);
  const identities = [
    services.safeProposerAddress,
    services.executorAddress,
    ...manifest.authorizationSigners,
  ];
  if (stage === "activation" && (services.verifiers.length !== network.verifierCount ||
      manifest.authorizationSigners.length !== network.verifierCount ||
      identities.some((value) => !ethers.isAddress(value)) ||
      new Set(identities.map(address)).size !== identities.length ||
      !services.bridgeHealthUrlEnv || JSON.stringify(context.nativeInputs).includes("REVIEW_REQUIRED"))) {
    throw new Error(`Bundle requires ${network.verifierCount} verifiers, ${network.verifierCount + 2} distinct KMS identities, and bridgeHealthUrlEnv`);
  }
  const directory = path.dirname(manifestPath);
  const externalDeployment = manifest.inputs?.externalDeployment ||
    readJson(path.resolve(directory, manifest.settings.externalDeployment));
  const depositPlan = manifest.inputs?.depositPlan ||
    readJson(path.resolve(directory, manifest.settings.depositPlan));
  const defaults = loadBridgeDefaults({ ...manifest.settings }, directory);
  const bundle = {
    ...manifest,
    ...(stage === "initial" ? { bundlePurpose: "provisioning" } : {}),
    toolingRevision: rolloutToolingRevision(),
    settings: {
      ...manifest.settings,
      dependencies: {
        adminRegistry: defaults.adminRegistry, ...defaults.tokenRouter,
        tokenFactory: defaults.externalAssetBridge.tokenFactory,
        usdst: defaults.externalAssetBridge.usdst, priceOracle: defaults.externalAssetBridge.priceOracle,
      },
      externalDeployment: "embedded:externalDeployment",
      depositPlan: "embedded:depositPlan",
    },
    inputs: { externalDeployment, depositPlan, ...readNativeInputs(manifest, directory) },
  };
  delete bundle.settings.bridgeTemplate;
  if (fs.existsSync(bundlePath)) {
    const existing = readJson(bundlePath);
    if (digest(existing) !== digest(bundle)) {
      throw new Error("Existing deployment bundle differs from the current manifest; preserve it and choose a new rollout directory");
    }
    return existing;
  }
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true, mode: 0o700 });
  writeJson(bundlePath, bundle);
  return bundle;
}

function loadManifest(file, stage = "initial") {
  if (!["initial", "activation"].includes(stage)) throw new Error("--stage must be initial|activation");
  const manifest = readJson(file);
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported manifest schemaVersion");
  if (manifest.bundlePurpose === "provisioning" && stage !== "initial") {
    throw new Error("Provisioning bundles cannot configure activation; join the final reviewed bundle");
  }
  if (manifest.toolingRevision && manifest.toolingRevision !== rolloutToolingRevision()) {
    throw new Error("Deployment bundle requires a different reviewed rollout code revision");
  }
  const services = manifest.services;
  if (!services || !/^https:\/\//.test(services.nodeUrl || "")) throw new Error("services.nodeUrl must use HTTPS");
  for (const name of ["rpcUrlEnv", "sourceTokenEnv"]) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(services[name] || "")) throw new Error(`${name} must name an environment variable, not a secret value`);
  }
  if (services.bridgeHealthUrlEnv &&
      !/^[A-Z][A-Z0-9_]*$/.test(services.bridgeHealthUrlEnv)) {
    throw new Error("bridgeHealthUrlEnv must name an environment variable");
  }
  if (!Array.isArray(services.verifiers) || !Array.isArray(manifest.authorizationSigners)) throw new Error("verifiers and authorizationSigners must be arrays");
  for (const value of [services.nodeUrl, ...services.verifiers.map(({ url }) => url)]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || /[\r\n]/.test(value) || url.username || url.password || url.search || url.hash) throw new Error("Service base URLs must be HTTPS without credentials, query strings or control characters");
  }
  for (const verifier of services.verifiers) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(verifier.tokenEnv || "")) throw new Error("Verifier tokenEnv must name an environment variable");
  }
  if (services.verifiers.length) {
    if (!Number.isSafeInteger(services.confirmations) || services.confirmations <= 0) {
      throw new Error("services.confirmations must be a positive integer");
    }
    services.verifiers.forEach((verifier, index) => {
      const confirmations = verifier.confirmations ?? services.confirmations;
      if (!Number.isSafeInteger(confirmations) || confirmations < services.confirmations) {
        throw new Error(`services.verifiers[${index}].confirmations must be an integer at least services.confirmations`);
      }
    });
  }
  if (typeof manifest.settings?.sourceChainId !== "string") throw new Error("settings.sourceChainId must be a decimal string");
  const settings = { ...manifest.settings };
  const nativeInputs = readNativeInputs(manifest, path.dirname(file));
  if (nativeInputs.nativeRoutes?.length && String(nativeInputs.nativeConfig.chainId) !== String(
      manifest.inputs?.externalDeployment?.chainId || readJson(path.resolve(path.dirname(file), settings.externalDeployment)).chainId)) {
    throw new Error("Native configuration must use the rollout's external chain");
  }
  const deployment = manifest.inputs?.externalDeployment ||
    readJson(path.resolve(path.dirname(file), settings.externalDeployment));
  const depositPlan = manifest.inputs?.depositPlan ||
    readJson(path.resolve(path.dirname(file), settings.depositPlan));
  const defaults = loadBridgeDefaults(settings, path.dirname(file));
  const templates = buildRolloutTemplates({ settings, deployment, bridgeDefaults: defaults });
  const signers = manifest.authorizationSigners || [];
  const network = getExternalBridgeNetwork(templates.chainId);
  if (signers.length !== 0 && (signers.length !== network.verifierCount ||
      new Set(signers.map(address)).size !== network.verifierCount ||
      signers.some((signer) => !ethers.isAddress(signer)))) {
    throw new Error(`Provide either no authorizationSigners before KMS provisioning, or exactly ${network.verifierCount} distinct addresses`);
  }
  templates.vaultTemplate.chains[0].attestationSigners = signers;
  const rollout = buildSynchronizedRollout({ depositPlan, ...templates, policy: manifest.policy, chainId: templates.chainId });
  validateInitialRollout(rollout, { activation: stage === "activation" });
  if (nativeInputs.nativeRoutes?.length && !JSON.stringify(nativeInputs).includes("REVIEW_REQUIRED")) {
    const native = nativeInputs.nativeConfig;
    require("../nativeBridgeSignerOps").normalizeConfig(native);
    if (native.attestationSigners.length !== network.verifierCount || native.attestationThreshold !== network.verifierThreshold ||
        !ethers.isAddress(native.executor) || address(native.eabExecutor) !== address(services.executorAddress) ||
        [native.safeAddress, native.eabExecutor, ...native.attestationSigners].some(value => address(value) === address(native.executor))) {
      throw new Error("Native signer threshold/count and distinct executor must match the reviewed rollout");
    }
    const sourceBridges = new Set(nativeInputs.nativeRoutes.map(route => address(route["bridge-address"])));
    if (sourceBridges.size !== 1 || !ethers.isAddress(`0x${[...sourceBridges][0]}`) ||
        [...sourceBridges][0] === address(ethers.ZeroAddress)) throw new Error("Native routes must share one STRATO bridge");
    if (!Array.isArray(native.tokens) || native.tokens.length !== nativeInputs.nativeRoutes.length ||
        nativeInputs.nativeRoutes.some(route => String(route["external-chain-id"]) !== String(native.chainId) ||
          address(route["external-bridge"]) !== address(native.bridgeAddress) ||
          !/^\d+$/.test(String(route["instant-withdrawal-threshold"])) ||
          !native.tokens.some(token => address(token.stratoToken) === address(route["strato-token"]) &&
            address(token.representationToken) === address(route["representation-token"])))) {
      throw new Error("Native route token/bridge bindings must match inputs.nativeConfig");
    }
  }
  if (rollout.inventory.length === 0) throw new Error("Deployment inventory is empty");
  const operator = address(settings.bridgeOperator);
  if (settings.settlementVerifiers.some((verifier) => address(verifier) === operator)) throw new Error("Operator cannot be a settlement verifier");
  // Code changes invalidate approval and cached generation just like input changes.
  const codeFiles = rolloutCodeFiles();
  const revision = digest({ stage, manifest, settings, deployment, depositPlan, defaults, nativeInputs,
    code: codeFiles.map((name) => digest(fs.readFileSync(name, "utf8"))) });
  return { stage, manifest, rollout, revision, settings, deployment, nativeInputs };
}

function generate(context, outputDirectory, options = {}) {
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
  const nativeRoutesPath = context.nativeInputs?.nativeRoutes?.length
    ? save("native-routes.json", context.nativeInputs.nativeRoutes.map(route => ({
      ...route,
      "token-router": route["token-router"] || context.settings.tokenRouter,
      "settlement-verifiers": route["settlement-verifiers"] || context.settings.settlementVerifiers.join(","),
      "settlement-verifier-threshold": route["settlement-verifier-threshold"] ||
        String(rollout.bridgeConfig.externalAssetBridge.settlementVerifierThreshold),
    }))) : undefined;
  const nativeConfigPath = nativeRoutesPath ? save("native.json", context.nativeInputs.nativeConfig) : undefined;
  const nativeVerifierPolicyPaths = [];
  if (nativeRoutesPath && !JSON.stringify({ routes: context.nativeInputs.nativeRoutes,
      bridge: context.nativeInputs.nativeConfig.bridgeAddress }).includes("REVIEW_REQUIRED")) {
    const baseline = {
      version: "1", sourceChainId: context.settings.sourceChainId,
      sourceBridge: address(context.nativeInputs.nativeRoutes[0]["bridge-address"]),
      destinationChainId: String(rollout.chainId),
      destinationBridge: ethers.getAddress(context.nativeInputs.nativeConfig.bridgeAddress),
      routes: context.nativeInputs.nativeRoutes.map(route => ({
        stratoToken: address(route["strato-token"]),
        representationToken: ethers.getAddress(route["representation-token"]),
        instantEnabled: bool(route.enabled) && BigInt(route["instant-withdrawal-threshold"]) > 0n,
        maxInstantAmount: String(route["instant-withdrawal-threshold"]),
      })),
    };
    rollout.verifierPolicies.forEach((_, index) => nativeVerifierPolicyPaths.push(save(`native-verifier-${index + 1}.json`, {
      ...baseline, baselinePolicyHash: `sha256:${digest(baseline)}`, verifierIndex: index + 1,
    })));
  }
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
  if (chain.attestationSigners.length === getExternalBridgeNetwork(rollout.chainId).verifierCount) {
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
  if (options.includeServiceTemplates !== false) {
    const services = context.manifest.services;
    const bridgeEnvironment = {
      NODE_URL: services.nodeUrl, EXTERNAL_ASSET_BRIDGE_ADDRESS: context.settings.externalAssetBridge,
      TOKEN_ROUTER: context.settings.tokenRouter, USDST_ADDRESS: rollout.bridgeConfig.externalAssetBridge.usdst, PRICE_ORACLE_ADDRESS: rollout.bridgeConfig.externalAssetBridge.priceOracle,
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
    if (nativeVerifierPolicyPaths.length) {
      bridgeEnvironment.STRATO_NATIVE_BRIDGE_ADDRESS = context.nativeInputs.nativeRoutes[0]["bridge-address"];
      bridgeEnvironment[`CHAIN_${rollout.chainId}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`] = context.nativeInputs.nativeConfig.bridgeAddress;
      bridgeEnvironment[`CHAIN_${rollout.chainId}_NATIVE_VERIFIER_URLS`] = services.verifiers.map(({ url }) => url).join(",");
      bridgeEnvironment[`CHAIN_${rollout.chainId}_NATIVE_VERIFIER_API_TOKENS`] = services.verifiers.map(({ tokenEnv }) => reference(tokenEnv)).join(",");
      bridgeEnvironment[`CHAIN_${rollout.chainId}_NATIVE_MINT_EXECUTOR_ADDRESS`] = context.nativeInputs.nativeConfig.executor;
      for (const suffix of ["KMS_KEY_ID", "KMS_REGION"]) bridgeEnvironment[`CHAIN_${rollout.chainId}_NATIVE_MINT_EXECUTOR_${suffix}`] = reference(`CHAIN_${rollout.chainId}_NATIVE_MINT_EXECUTOR_${suffix}`);
    }
    saveEnv("bridge.env.template", bridgeEnvironment);
    rollout.verifierPolicies.forEach((policy, index) => {
      const prefix = `VERIFIER_${index + 1}`;
      const verifier = services.verifiers[index];
      saveEnv(`verifier-${index + 1}.env.template`, {
        BRIDGE_IMAGE: reference("BRIDGE_IMAGE"), PORT: 3004, SOURCE_CHAIN_ID: policy.sourceChainId,
        STRATO_NODE_URL: services.nodeUrl, EXTERNAL_ASSET_BRIDGE_ADDRESS: policy.sourceBridge,
        DESTINATION_CHAIN_ID: policy.destinationChainId, DESTINATION_VAULT_ADDRESS: policy.destinationVault,
        VAULT_AUTHORIZATION_SIGNER_ADDRESS: context.manifest.authorizationSigners[index] || "REVIEW_REQUIRED",
        KMS_KEY_ID: reference(`${prefix}_KMS_KEY_ID`), KMS_REGION: reference(`${prefix}_KMS_REGION`),
        VERIFIER_RPC_URL: reference(`${prefix}_RPC_URL`), VERIFIER_INDEPENDENT_RPC_URLS: reference(`${prefix}_INDEPENDENT_RPC_URLS`), VERIFIER_CONFIRMATIONS: verifier?.confirmations ?? services.confirmations,
        VERIFIER_POLICY_PATH: "/run/secrets/eab-verifier-policy.json", VERIFIER_POLICY_PATH_HOST: reference("VERIFIER_POLICY_PATH_HOST"),
        SETTLEMENT_ATTESTOR_OPENID_DISCOVERY_URL: reference(`${prefix}_OPENID_DISCOVERY_URL`),
        SETTLEMENT_ATTESTOR_CLIENT_ID: reference(`${prefix}_CLIENT_ID`), SETTLEMENT_ATTESTOR_CLIENT_SECRET: reference(`${prefix}_CLIENT_SECRET`),
        SETTLEMENT_ATTESTOR_BA_USERNAME: reference(`${prefix}_BA_USERNAME`), SETTLEMENT_ATTESTOR_BA_PASSWORD: reference(`${prefix}_BA_PASSWORD`),
        EXTERNAL_BRIDGE_VERIFIER_API_TOKEN: reference(services.verifiers[index]?.tokenEnv || `${prefix}_API_TOKEN`),
        ...(nativeVerifierPolicyPaths.length ? {
          STRATO_NATIVE_BRIDGE_ADDRESS: context.nativeInputs.nativeRoutes[0]["bridge-address"],
          NATIVE_REPRESENTATION_BRIDGE_ADDRESS: context.nativeInputs.nativeConfig.bridgeAddress,
          NATIVE_ATTESTATION_SIGNER_ADDRESS: context.nativeInputs.nativeConfig.attestationSigners[index] || "REVIEW_REQUIRED",
          NATIVE_KMS_KEY_ID: reference(`${prefix}_NATIVE_KMS_KEY_ID`),
          NATIVE_KMS_REGION: reference(`${prefix}_NATIVE_KMS_REGION`),
          NATIVE_VERIFIER_POLICY_PATH: "/run/secrets/native-verifier-policy.json",
        } : {}),
      });
    });
  }
  const index = { serviceTemplates, revision: context.revision, hashes, bridgeConfigPath, vaultConfigPath, verifierPolicyPaths,
    ...(nativeRoutesPath ? { nativeRoutesPath, nativeConfigPath, nativeVerifierPolicyPaths } : {}),
    depositRouterBatchPaths, depositRouterPausePath, vaultPausePath, vaultConfigurePath, manifestPath };
  writeJson(indexFile, index);
  return { directory, ...index };
}

function governanceProgress(settings, state, { stage = "initial", activationErrors } = {}) {
  const { initialization: init, routes, actions, permissionErrors } = state;
  const calls = [];
  const initialized = bool(init.tokenRouter.initialized) && bool(init.bridge.initialized);
  const order = (call) => {
    const method = call.call.args._func;
    if (method === "setChain" && call.call.args._args[3].value === true) return 12;
    if (method === "setDepositAction" && call.call.args._args[4].value === false) return 11;
    if (method === "initialize") {
      return address(call.call.args._target) === address(settings.tokenRouter.address) ? 1 : 3;
    }
    return {
      setYieldVault: 2,
      setPriceOracle: 4,
      setTokenRouter: 4,
      setSettlementVerifier: 5,
      setSettlementVerifierThreshold: 6,
      addWhitelist: 7,
      setMintPolicy: 8,
      setChain: 9,
      setRoute: 10,
      setRouteRebaseRequired: 11,
      setDepositAction: 13,
    }[method] || Number.MAX_SAFE_INTEGER;
  };
  const stageNames = {
    1: "TokenRouter initialization",
    2: "yield vault approval",
    3: "ExternalAssetBridge initialization",
    4: "PriceOracle and TokenRouter connection",
    5: "settlement verifier registration",
    6: "settlement verifier threshold",
    7: "token whitelist",
    8: "mint policy",
    9: "external chain configuration",
    10: "route configuration",
    11: "route rebase and deposit action safety configuration",
    12: "external chain activation",
    13: "deposit action configuration",
  };
  for (const step of ["initialize", "routes", "actions"]) {
    const plan = buildPlan(settings, step);
    if (step === "routes") {
      for (const call of plan.filter(call => call.args._func === "setChain")) call.args._args[3].value = false;
    }
    if (step === "actions") {
      plan.unshift(...buildPlan(currentCursorSettings(settings, routes), "routes").filter(call =>
        call.args._func === "setChain" && call.args._args[3].value === true));
    }
    plan.forEach((call, index) => {
      const method = call.args._func;
      const values = call.args._args.map(({ value }) => value);
      let complete = false;
      let blocked;
      let blockCode;
      if (method === "initialize") {
        const router = address(call.args._target) === address(settings.tokenRouter.address);
        const actual = router ? init.tokenRouter : init.bridge;
        const fields = router ? ["poolFactory", "poolV3Factory", "directMintPsm", "metalForge", "saveUsdstVault"] : ["tokenFactory", "bridgeOperator", "guardian", "USDST_ADDRESS"];
        if (bool(actual.initialized)) {
          complete = fields.every((field, i) => address(actual[field]) === address(values[i]));
          if (!complete) { blocked = "Already initialized with different values; requires reviewed corrective governance, never reinitialization"; blockCode = "INITIALIZATION_CONFLICT"; }
        } else if (actual.initialized !== false && actual.initialized !== "false") { blocked = "Initialization state is unknown"; blockCode = "STATE_UNAVAILABLE"; }
      } else if (method === "setYieldVault") {
        complete = init.approvedYieldVaults.has(address(values[0]));
        if (!bool(init.tokenRouter.initialized)) { blocked = "Wait for TokenRouter initialization quorum"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      } else if (method === "setPriceOracle" || method === "setTokenRouter") {
        complete = address(init.bridge[method === "setPriceOracle" ? "priceOracle" : "tokenRouter"]) === address(values[0]);
      } else if (method === "setSettlementVerifier") complete = init.settlementVerifiers.has(address(values[0]));
      else if (method === "setSettlementVerifierThreshold") {
        complete = String(init.bridge.settlementVerifierThreshold) === String(values[0]);
        if (settings.bridge.settlementVerifiers.some((verifier) => !init.settlementVerifiers.has(address(verifier)))) { blocked = "Wait for verifier registration quorum"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      } else if (method === "setMintPolicy") {
        const actual = routes.mintPolicies?.get(address(values[0]));
        complete = !!actual && String(actual.capacity) === String(values[1]) && String(actual.refillRate) === String(values[2]);
      } else if (method === "addWhitelist") {
        complete = !permissionErrors.includes(`Missing bridge ${values[1]} permission for STRATO token ${address(values[0])}`);
      } else if (method === "setChain") {
        const actual = routes.chains.get(String(values[4]));
        if (actual) {
          const matching = actual.chainName === values[0] && address(actual.vault) === address(values[1]) &&
            address(actual.depositRouter) === address(values[2]);
          complete = matching && (values[3] === false || bool(actual.enabled));
          if (!matching) { blocked = "Existing chain differs; reconcile separately to preserve its live cursor and pending operations"; blockCode = "CHAIN_CONFLICT"; }
          else if (BigInt(actual.lastProcessedBlock) < BigInt(values[5])) {
            complete = false;
            blocked = "Live cursor is behind configured start; reconcile instead of advancing it automatically";
            blockCode = "CURSOR_CONFLICT";
          }
        }
        if (!complete && values[3] === true && !blocked) {
          if (stage !== "activation") { blocked = "Chain enablement requires activation"; blockCode = "ACTIVATION_STAGE_REQUIRED"; }
          else if (!activationErrors || activationErrors.length) { blocked = "Chain enablement requires activation readiness"; blockCode = "ACTIVATION_PREREQUISITES"; }
        }
      } else if (method === "setRoute") {
        const actual = routes.routes.get(key(values[0], values[1], values[2]));
        const fields = ["depositsEnabled", "withdrawalsEnabled", "externalDecimals", "externalName", "externalSymbol", "maxPerWithdrawal", "manualReviewThreshold"];
        complete = !!actual && fields.every((field, i) => String(actual[field]) === String(values[i + 3]));
        if (!routes.chains.has(String(values[1]))) { blocked = "Wait for chain configuration quorum"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      } else if (method === "setRouteRebaseRequired") {
        const routeKey = key(values[0], values[1], values[2]);
        complete = routes.rebaseRequired.has(routeKey) === values[3];
        if (!routes.routes.has(routeKey)) { blocked = "Wait for route configuration quorum"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      } else if (method === "setDepositAction") {
        const config = actions.actionConfigs.get(key(values[0], values[1], values[2])) || {};
        complete = bool(config.autoRoute) === bool(values[4]);
        if (!complete && bool(values[4])) {
          if (stage !== "activation") { blocked = "Regenerate policy artifacts with --stage activation"; blockCode = "ACTIVATION_STAGE_REQUIRED"; }
          else if (!activationErrors || activationErrors.length) { blocked = "Activation prerequisites and pre-enable verify-actions must pass"; blockCode = "ACTIVATION_PREREQUISITES"; }
        }
      } else { blocked = `Unsupported governance method ${method}`; blockCode = "UNSUPPORTED_METHOD"; }
      if (step !== "initialize" && !initialized && (!blocked || blockCode === "WAIT_FOR_GOVERNANCE")) { blocked = "Wait for both initializations"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      if (step === "routes" && method !== "addWhitelist" && permissionErrors.length && (!blocked || blockCode === "WAIT_FOR_GOVERNANCE")) { blocked = "Wait for token permission quorum"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      if (step === "initialize" && !["initialize", "setYieldVault"].includes(method) && !bool(init.bridge.initialized) && (!blocked || blockCode === "WAIT_FOR_GOVERNANCE")) { blocked = "Wait for ExternalAssetBridge initialization quorum"; blockCode = "WAIT_FOR_GOVERNANCE"; }
      calls.push({ id: digest(call), step, callNumber: index + 1, call,
        status: complete ? "COMPLETE" : blocked ? "BLOCKED" : "READY", reason: complete ? undefined : blocked, reasonCode: complete ? undefined : blockCode });
    });
  }
  for (const item of calls) {
    item.deploymentStage = order(item);
    item.deploymentStageName = stageNames[item.deploymentStage];
  }
  for (const item of calls) item.dependencies = calls.filter(parent => parent.status !== "COMPLETE" &&
    parent.deploymentStage < item.deploymentStage).map(({ id }) => id);
  const earliestIncompleteStage = Math.min(...calls.filter(({ status }) => status !== "COMPLETE").map(order));
  for (const item of calls) {
    if (item.status === "READY" && order(item) > earliestIncompleteStage) {
      item.status = "BLOCKED";
      item.reason = `Wait for ${stageNames[earliestIncompleteStage]} quorum`;
      item.reasonCode = "WAIT_FOR_GOVERNANCE";
    }
  }
  return calls;
}

function isDependencyPending(item) {
  return item.status === "BLOCKED" && item.reasonCode === "WAIT_FOR_GOVERNANCE" && item.dependencies?.length > 0;
}

function isActivationCall(item) {
  return (item.call.args._func === "setChain" && item.call.args._args[3]?.value === true) ||
    (item.call.args._func === "setDepositAction" && item.call.args._args[4]?.value === true);
}

function governanceBatch(report) {
  const calls = report.calls || [];
  const isActivation = isActivationCall;
  const configuration = calls.filter(item => !isActivation(item) && item.status !== "COMPLETE");
  const phase = report.nativeMode ? (report.nativeMode === "activate" ? "activation" : "configuration")
    : configuration.length ? "configuration" : "activation";
  const pending = calls.filter(item => item.status !== "COMPLETE" &&
    (report.nativeMode || (phase === "configuration" ? !isActivation(item) : isActivation(item))));
  const blocked = pending.some(item => item.status !== "READY" && !isDependencyPending(item));
  return { phase, calls: blocked ? [] : pending.sort((a, b) => (a.deploymentStage || 0) - (b.deploymentStage || 0)) };
}

function currentCursorSettings(settings, routes) {
  return { ...settings, chains: settings.chains.map((chain) => {
    const live = routes.chains.get(String(chain.externalChainId));
    return live && BigInt(live.lastProcessedBlock) >= BigInt(chain.lastProcessedBlock)
      ? { ...chain, lastProcessedBlock: String(live.lastProcessedBlock) } : chain;
  }) };
}

module.exports = { CONTRACTS, digest, readJson, writeJson, address, bool, initializeManifest, createPortableBundle, loadManifest,
  generate, governanceProgress, governanceBatch, isActivationCall, isDependencyPending, currentCursorSettings, loadConfig, shellQuote };
