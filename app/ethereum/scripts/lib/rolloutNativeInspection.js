const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { digest, readJson, writeJson, address, bool, governanceBatch, isActivationCall, loadConfig, shellQuote } = require("./externalBridgeOrchestration");
const { getExternalBridgeNetwork } = require("./externalBridgeNetworks");
const { inspect } = require("./rolloutEabInspection");
const { comparableGovernanceValue, fetchAdminVotingPolicy, requiredAdminVotes, fetchLiveAdminVoteCounts } = require("./rolloutGovernance");
const { portableSnapshot, createApprovalRequest, writeApprovalFile, createServiceHandoff } = require("./rolloutHandoff");
const { jsonFetch, resolveSourceToken, withDeadline, INSPECTION_TIMEOUT_MS, CHECK_TIMEOUT_MS, TIMEOUT_MS, redactFor, ROLLOUT_SCHEMA_VERSION } = require("./rolloutRuntime");

function nativeGovernanceCalls(context, mode, custodyAddress) {
  if (!["configure", "activate"].includes(mode)) throw new Error("Invalid native mode");
  const routes = context.nativeInputs.nativeRoutes;
  if (!routes?.length) throw new Error("No native routes selected");
  const calls = routes.flatMap(route => {
    const verifierInput = route["settlement-verifiers"] || context.settings.settlementVerifiers;
    const tokenSettings = route.sharedTokenSettings;
    return require("../../../contracts/deploy/configure-native-route").buildPlan({
      ...route,
      ...(tokenSettings ? {
        "deposits-disabled": tokenSettings.depositsDisabled,
        "withdrawals-disabled": tokenSettings.withdrawalsDisabled,
        "max-outstanding-withdrawal": tokenSettings.maxOutstandingWithdrawal,
      } : {}),
      "admin-registry": context.settings.dependencies.adminRegistry,
      "token-router": route["token-router"] || context.settings.tokenRouter,
      "settlement-verifiers": Array.isArray(verifierInput) ? verifierInput.join(",") : verifierInput,
      "settlement-verifier-threshold": route["settlement-verifier-threshold"] || String(getExternalBridgeNetwork(context.rollout.chainId).verifierThreshold),
      enabled: mode === "activate" && route.enabled === true,
      "auto-route-enabled": mode === "activate" && route["auto-route-enabled"] === true,
    }).calls;
  });
  const bridge = address(routes[0]["bridge-address"]);
  calls.unshift({ contract: address(context.settings.dependencies.adminRegistry), method: "castVoteOnIssue", args: {
    _target: bridge, _func: "setPause", _args: [{ type: "bool", value: mode === "configure" }, { type: "bool", value: mode === "configure" }],
  } });
  for (const [method, value] of [["setBridgeOperator", context.settings.bridgeOperator], ["setGuardian", context.settings.guardian]]) {
    calls.push({ contract: address(context.settings.dependencies.adminRegistry), method: "castVoteOnIssue", args: {
      _target: bridge, _func: method, _args: [{ type: "address", value: address(value) }],
    } });
  }
  if (custodyAddress) {
    for (const token of new Set(routes.map(route => address(route["strato-token"])))) {
      for (const method of ["transfer", "transferFrom"]) calls.push({ contract: address(context.settings.dependencies.adminRegistry), method: "castVoteOnIssue", args: {
        _target: address(context.settings.dependencies.adminRegistry), _func: "addWhitelist",
        _args: [{ type: "address", value: token }, { type: "string", value: method }, { type: "address", value: address(custodyAddress) }],
      } });
    }
  }
  if (mode === "activate" && custodyAddress) calls.push({ contract: address(context.settings.dependencies.adminRegistry), method: "castVoteOnIssue", args: {
    _target: address(custodyAddress), _func: "setPause", _args: [{ type: "bool", value: false }],
  } });
  const scopes = new Map();
  for (const call of calls) {
    const method = call.args._func, values = call.args._args.map(({ value }) => value);
    const suffix = method === "addWhitelist" ? `${values[0]}:${values[1]}:${values[2]}`
      : method === "setAsset" ? `${values[8]}:${values[1]}`
      : method === "setAutoRouteEnabled" ? `${values[0]}:${values[1]}`
      : ["setSettlementVerifier", "setTokenBridgeConfig"].includes(method) ? values[0] : "";
    const key = `${call.args._target}:${method}:${suffix}`;
    if (scopes.has(key) && digest(scopes.get(key)) !== digest(call)) throw new Error("Conflicting native configuration for the same setting");
    scopes.set(key, call);
  }
  return [...scopes.values()];
}

function nativeGovernanceProgress(calls, state) {
  const stages = { setPause: 0, addWhitelist: 1, setSettlementVerifier: 1, setSettlementVerifierThreshold: 2,
    setBridgeOperator: 1, setGuardian: 1, setTokenRouter: 3, setAsset: 4, setTokenBridgeConfig: 5, setAutoRouteEnabled: 6 };
  const entries = calls.map(call => {
    const values = call.args._args.map(({ value }) => value);
    const method = call.args._func;
    const equal = (a, b) => comparableGovernanceValue(a) === comparableGovernanceValue(b);
    let done;
    if (method === "setPause") done = values.length === 1 ? equal(state.custody?.paused, values[0])
      : equal(state.bridge.depositsPaused, values[0]) && equal(state.bridge.withdrawalsPaused, values[1]);
    else if (method === "addWhitelist") done = state.whitelist?.has(`${address(values[0])}:${values[1]}:${address(values[2])}`) || false;
    else if (method === "setSettlementVerifier") done = equal(state.verifiers.get(address(values[0])) || false, values[1]);
    else if (method === "setSettlementVerifierThreshold") done = equal(state.bridge.settlementVerifierThreshold, values[0]);
    else if (method === "setTokenRouter") done = equal(state.bridge.tokenRouter, values[0]);
    else if (method === "setBridgeOperator") done = equal(state.bridge.bridgeOperator, values[0]);
    else if (method === "setGuardian") done = equal(state.bridge.guardian, values[0]);
    else if (method === "setAsset") {
      const asset = state.assets.get(`${address(values[8])}:${values[1]}`);
      done = !!asset && ["enabled", "externalChainId", "externalBridge", "representationToken", "externalName", "externalSymbol", "maxPerWithdrawal", "instantWithdrawalThreshold", "stratoToken"]
        .every((field, i) => equal(asset[field], values[i]));
    } else if (method === "setTokenBridgeConfig") {
      const config = state.tokenConfigs.get(address(values[0]));
      done = !!config && ["depositsDisabled", "withdrawalsDisabled", "maxOutstandingWithdrawal"].every((field, i) => equal(config[field], values[i + 1]));
    } else if (method === "setAutoRouteEnabled") done = equal(state.autoRoutes.get(`${address(values[0])}:${values[1]}`) || false, values[2]);
    else throw new Error("Unsupported native governance method");
    return { id: digest(call), call, status: done ? "COMPLETE" : "BLOCKED", deploymentStage: method === "setPause" && values[0] === false ? (values.length === 1 ? 7 : 8) : stages[method], deploymentStageName: method };
  });
  const next = Math.min(...entries.filter(({ status }) => status !== "COMPLETE").map(({ deploymentStage }) => deploymentStage));
  entries.forEach(entry => {
    entry.dependencies = entries.filter(parent => parent.status !== "COMPLETE" && parent.deploymentStage < entry.deploymentStage).map(({ id }) => id);
    if (entry.status !== "COMPLETE") {
      if (entry.deploymentStage === next) entry.status = "READY";
      else entry.reasonCode = "WAIT_FOR_GOVERNANCE";
    }
  });
  return entries;
}

function nativeOnlyEabVerified(context, inspection) {
  return context.manifest.scope === "native" && inspection.externalReady && inspection.router?.paused === false &&
    inspection.report.status === "DEPOSITS_ACTIVE_CANARY_REQUIRED" &&
    !!inspection.source && inspection.report.calls?.every(({ status }) => status === "COMPLETE") &&
    ["strato", "external-identity", "deposit-router", "withdrawal-pause", "safe-runtime-identities", "vault-configuration", "verifiers", "bridge-health"]
      .every(name => inspection.report.checks?.find(check => check.name === name)?.status === "PASSED");
}

async function validateNativeReadiness(context, artifacts, fetchImpl = fetch, runtimeVerifierHealth) {
  try {
    const metadata = runtimeVerifierHealth || await Promise.all(context.manifest.services.verifiers.map(async (verifier) =>
      jsonFetch(`${verifier.url.replace(/\/$/, "")}/health`, undefined, fetchImpl)));
    if (!Array.isArray(metadata) || metadata.length !== context.manifest.services.verifiers.length) {
      throw new Error("Runtime did not return complete native verifier health");
    }
    metadata.forEach((data, index) => {
      const file = artifacts.nativeVerifierPolicyPaths[index];
      const policy = file && readJson(file);
      if (data.status !== "ok" || !policy || !data.native ||
          address(data.native.attestationSigner) !== address(context.nativeInputs.nativeConfig.attestationSigners[index]) ||
          address(data.native.sourceBridge) !== address(policy.sourceBridge) ||
          address(data.native.destinationBridge) !== address(policy.destinationBridge) ||
          data.native.policyVersion !== policy.version || data.native.baselinePolicyHash !== policy.baselinePolicyHash ||
          data.native.policyDigest !== `sha256:${digest(fs.readFileSync(file, "utf8"))}`) throw new Error(`Native verifier ${index + 1} signer/policy/binding is not ready`);
    });
  } catch (error) {
    const failed = new Error(`Native service readiness: ${error.message}. Apply the native service configuration before activation.`);
    failed.code = "NATIVE_READINESS";
    throw failed;
  }
}

async function nativeApprovalInspection(context, artifacts, mode, eabInspection, options = {}) {
  const eab = eabInspection || await (options.inspectEab || inspect)(context, artifacts);
  const existingEab = nativeOnlyEabVerified(context, eab) || (mode === "activate" && options.readOnlyActiveEab === true &&
    nativeOnlyEabVerified({ ...context, manifest: { ...context.manifest, scope: "native" } }, eab));
  if (!eab.source || !eab.externalReady || (eab.router?.paused !== true && !existingEab)) throw new Error("Native governance requires verified EAB configuration and paused external intake");
  if (mode === "activate" && eab.report.status !== "READY_FOR_ACTIVATION_REVIEW" && !existingEab) throw new Error("Native activation requires completed EAB governance and service readiness");
  if (mode === "activate") {
    const runtimeVerifierHealth = eab.report.checks?.find(check => check.name === "bridge-health")?.data?.deployment?.verifiers;
    await (options.validateNativeReadiness || validateNativeReadiness)(context, artifacts, options.fetchImpl, runtimeVerifierHealth);
  }
  const node = context.manifest.services.nodeUrl.replace(/\/$/, "");
  const token = await resolveSourceToken(context);
  const bridge = address(context.nativeInputs.nativeRoutes[0]["bridge-address"]);
  const read = async (suffix, params = {}) => {
    const rows = [], seen = new Set();
    for (let offset = 0; ;) {
      const page = await jsonFetch(`${node}/cirrus/search/BlockApps-StratoNativeBridge${suffix}?${new URLSearchParams({ address: `eq.${bridge}`, ...params,
        ...(suffix ? { limit: 200, offset, order: "key.asc" } : {}) })}`, token, options.fetchImpl);
      if (!Array.isArray(page)) throw new Error("Native state query returned invalid data");
      if (!suffix) return page;
      if (!page.length) return rows;
      for (const row of page) {
        const key = `${row.key}:${row.key2 || ""}`;
        if (seen.has(key)) throw new Error("Native inventory pagination repeated an entry");
        seen.add(key);
      }
      rows.push(...page);
      if (rows.length > 1000) throw new Error("Native inventory exceeds the supported review size");
      offset += page.length;
    }
  };
  const [base, verifiers, assets, configs, auto] = await Promise.all([
    read("", { limit: 2 }), read("-settlementVerifiers", { limit: 256 }),
    read("-assets", { key2: `eq.${context.rollout.chainId}`, limit: 1001 }),
    read("-tokenBridgeConfigs", { limit: 1001 }), read("-autoRouteEnabled", { key2: `eq.${context.rollout.chainId}`, limit: 1001 }),
  ]);
  if (base.length !== 1 || address(base[0].owner) !== address(context.settings.dependencies.adminRegistry) ||
      assets.length >= 1001 || configs.length >= 1001 || auto.length >= 1001 ||
      ![true, false, "true", "false"].includes(base[0].depositsPaused) || ![true, false, "true", "false"].includes(base[0].withdrawalsPaused) ||
      !ethers.isAddress(`0x${address(base[0].bridgeOperator)}`) || !ethers.isAddress(`0x${address(base[0].guardian)}`)) throw new Error("Native owner/operator, pause state or complete inventory could not be verified");
  if (mode === "activate" && (address(base[0].bridgeOperator) !== address(context.settings.bridgeOperator) ||
      address(base[0].guardian) !== address(context.settings.guardian))) throw new Error("Native operator/guardian changed; rerun paused configuration before activation");
  if (!/^\d+$/.test(String(base[0].settlementVerifierCount)) ||
      Number(base[0].settlementVerifierCount) !== verifiers.filter(row => bool(row.value)).length ||
      !/^\d+$/.test(String(base[0].settlementVerifierThreshold))) throw new Error("Native settlement verifier inventory is incomplete");
  const custodyAddress = address(base[0].custodyVault);
  if (!ethers.isAddress(`0x${custodyAddress}`) || custodyAddress === address(ethers.ZeroAddress) ||
      address(base[0].tokenFactory) !== address(context.settings.dependencies.tokenFactory)) throw new Error("Native bridge initialization/dependencies do not match the reviewed deployment");
  const custodyRows = await jsonFetch(`${node}/cirrus/search/BlockApps-StratoNativeCustodyVault?${new URLSearchParams({ address: `eq.${custodyAddress}`, limit: 2 })}`, token, options.fetchImpl);
  if (!Array.isArray(custodyRows) || custodyRows.length !== 1 || address(custodyRows[0].bridge) !== bridge ||
      address(custodyRows[0].owner) !== address(context.settings.dependencies.adminRegistry) ||
      ![true, false, "true", "false"].includes(custodyRows[0].paused)) throw new Error("Native custody ownership/binding/pause state could not be verified");
  const tokens = [...new Set(context.nativeInputs.nativeRoutes.map(route => address(route["strato-token"])))];
  const permissions = await jsonFetch(`${node}/cirrus/search/BlockApps-AdminRegistry-whitelist?${new URLSearchParams({
    address: `eq.${address(context.settings.dependencies.adminRegistry)}`, key: `in.(${tokens.join(",")})`,
    key2: "in.(transfer,transferFrom)", key3: `eq.${custodyAddress}`, value: "eq.true", select: "key,key2,key3,value", limit: tokens.length * 2,
  })}`, token, options.fetchImpl);
  if (!Array.isArray(permissions)) throw new Error("Native custody transfer permissions could not be read");
  const object = value => {
    const parsed = typeof value === "string" ? require("../prepareBridgeRollout").parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Native mapping value is unreadable");
    if (Object.values(parsed).some(field => typeof field === "number" && !Number.isSafeInteger(field))) throw new Error("Native mapping contains an unsafe numeric quantity");
    return parsed;
  };
  const state = { bridge: base[0], custody: custodyRows[0],
    whitelist: new Set(permissions.filter(row => bool(row.value) && address(row.key3) === custodyAddress)
      .map(row => `${address(row.key)}:${row.key2}:${address(row.key3)}`)), verifiers: new Map(verifiers.map(row => [address(row.key), row.value])),
    assets: new Map(assets.map(row => [`${address(row.key)}:${row.key2}`, object(row.value)])),
    tokenConfigs: new Map(configs.map(row => [address(row.key), object(row.value)])),
    autoRoutes: new Map(auto.map(row => [`${address(row.key)}:${row.key2}`, row.value])) };
  for (const route of context.nativeInputs.nativeRoutes) {
    const current = state.assets.get(`${address(route["strato-token"])}:${route["external-chain-id"]}`);
    if (current && address(current.representationToken) !== address(ethers.ZeroAddress) &&
        (address(current.representationToken) !== address(route["representation-token"]) ||
         address(current.externalBridge) !== address(route["external-bridge"]))) throw new Error("Native mapping conflicts; migration requires separate review");
  }
  const calls = nativeGovernanceProgress(nativeGovernanceCalls(context, mode, custodyAddress), state);
  const settings = loadConfig(artifacts.bridgeConfigPath);
  const policy = await fetchAdminVotingPolicy(settings, node, token, options.fetchImpl);
  calls.forEach(call => { call.requiredAdminVotes = requiredAdminVotes(policy, call.call); call.policyAdmins = policy.admins; });
  const votes = await fetchLiveAdminVoteCounts(settings, node, token, governanceBatch({ calls, nativeMode: mode }).calls, artifacts, options.fetchImpl);
  calls.forEach(call => { call.recordedAdminVotes = votes.get(call.id); });
  const report = { ...eab.report, calls, nativeMode: mode, approvalHash: digest({ mode, calls: calls.map(({ id, status }) => ({ id, status })) }) };
  return { ...eab, report, source: { ...eab.source, calls } };
}

async function nativeHandoff(context, artifacts, manifestPath, mode, options = {}) {
  const rpc = process.env[context.manifest.services.rpcUrlEnv];
  if (!rpc || !rpc.startsWith("https://")) throw new Error("Set the selected HTTPS RPC before preparing native configuration");
  const request = new ethers.FetchRequest(rpc);
  request.timeout = TIMEOUT_MS;
  const provider = options.provider || new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const result = await withDeadline("Native Safe configuration", () => (options.nativePlan || require("../nativeBridgeConfigure").plan)(context.nativeInputs.nativeConfig, provider, mode), CHECK_TIMEOUT_MS);
    if (result.transactions.length) {
      // Configuration can pause and configure atomically. Activation waits for live readiness.
      if (mode === "activate") {
        const source = await nativeApprovalInspection(context, artifacts, mode, undefined, options);
        const pending = source.report.calls.filter(({ status }) => status !== "COMPLETE");
        const onlyOriginUnpause = pending.length > 0 && pending.every(({ call }) =>
          call.args._func === "setPause" && call.args._args.length === 2 &&
          call.args._args.every(({ value }) => value === false));
        // Activate the destination before the final origin intake unpause.
        if (pending.length && !onlyOriginUnpause) {
          const approval = createApprovalRequest(portableSnapshot(manifestPath, artifacts.directory), source.report);
          const handoff = writeApprovalFile(artifacts.directory, approval);
          return { status: "ACTION_REQUIRED", role: "admins", action: "APPROVE_NATIVE_CONFIGURATION",
            summary: approval.packet.calls.map(({ call }) => ({ target: call.args._target, method: call.args._func, args: call.args._args })),
            file: handoff.file, approvalId: handoff.approvalId,
            run: `npm run external:rollout -- approve --file ${shellQuote(path.basename(handoff.file))}`,
            instruction: "Run with each required admin account; Coordinator reruns continue before Safe activation." };
        }
      }
      result.safe.createdAt = 0;
      const file = path.join(artifacts.directory, `native-safe-${digest(result.safe)}`, `${mode}.safe.json`);
      writeJson(file, result.safe);
      return { status: "ACTION_REQUIRED", role: "admins", action: "EXECUTE_NATIVE_SAFE_TRANSACTION", file,
        instruction: "Review and execute this one Safe batch, then the Coordinator reruns continue." };
    }
    const inspection = await withDeadline("Native STRATO configuration", () => nativeApprovalInspection(context, artifacts, mode, undefined, options), INSPECTION_TIMEOUT_MS);
    if (governanceBatch(inspection.report).calls.length) {
      if (options.deferApproval) return { status: "NATIVE_APPROVAL_READY", inspection };
      const approval = createApprovalRequest(portableSnapshot(manifestPath, artifacts.directory), inspection.report);
      const handoff = writeApprovalFile(artifacts.directory, approval);
      return { status: "ACTION_REQUIRED", role: "admins", action: "APPROVE_NATIVE_CONFIGURATION",
        summary: approval.packet.calls.map(({ call }) => ({ target: call.args._target, method: call.args._func, args: call.args._args })),
        file: handoff.file, approvalId: handoff.approvalId,
        run: `npm run external:rollout -- approve --file ${shellQuote(path.basename(handoff.file))}`,
        instruction: "Each required admin runs the same current command with their own credentials. No profiles or history. Coordinator reruns continue after execution." };
    }
    return { status: mode === "configure" ? "NATIVE_CONFIGURED" : "NATIVE_ACTIVE", action: "COORDINATOR_CONTINUE",
      run: `npm run external:rollout -- continue --manifest ${shellQuote(manifestPath)}` };
  } finally { if (!options.provider) provider.destroy(); }
}

function nativeConfigurationFingerprint(context) {
  return digest({ nativeInputs: context.nativeInputs, sourceChainId: context.settings.sourceChainId,
    dependencies: context.settings.dependencies, operator: context.settings.bridgeOperator, guardian: context.settings.guardian,
    eabBridge: context.settings.externalAssetBridge,
    router: context.settings.tokenRouter, verifiers: context.settings.settlementVerifiers,
    schemaVersion: ROLLOUT_SCHEMA_VERSION });
}

function nativeCoordinatorAction(context, report, output, manifestPath) {
  const eabConfigurationReady = report.calls?.every(item => item.status === "COMPLETE" || isActivationCall(item)) ||
    (report.operator?.approvalRequired === true && !report.activationChecksRequired);
  if (!context.nativeInputs.nativeRoutes?.length || report.operator?.safeAction ||
      report.safe?.executionOrder?.some(({ status }) => status !== "DONE") ||
      !eabConfigurationReady) return undefined;
  const fingerprint = nativeConfigurationFingerprint(context);
  const completed = stage => {
    const file = path.join(output, `native-${stage}.json`);
    return fs.existsSync(file) && readJson(file).fingerprint === fingerprint;
  };
  const stage = !completed("configured") ? "initial"
    : ["READY_FOR_ACTIVATION_REVIEW", "DEPOSITS_ACTIVE_CANARY_REQUIRED"].includes(report.status) && !completed("active") ? "activation" : undefined;
  return stage && { role: "coordinator", action: stage === "initial" ? "CONFIGURE_NATIVE_BRIDGE" : "ACTIVATE_NATIVE_BRIDGE",
    run: `npm run external:rollout -- continue --manifest ${shellQuote(manifestPath)}`,
    instruction: "This generates the current native Safe JSON or self-contained admin command. Rerun it after execution; no admin setup or deployment history." };
}

function recordNativeCompletion(context, output, result) {
  if (!["NATIVE_CONFIGURED", "NATIVE_ACTIVE"].includes(result.status)) return;
  writeJson(path.join(output, result.status === "NATIVE_CONFIGURED" ? "native-configured.json" : "native-active.json"), {
    fingerprint: nativeConfigurationFingerprint(context), observedAt: new Date().toISOString(),
  });
}

async function advanceNative(context, artifacts, report, output, manifestPath, inspection, options = {}) {
  // Complete read-only native phases internally; stop only for a real owner/admin/Infra action.
  if (context.manifest.scope !== "native" && report.status === "DEPOSITS_ACTIVE_CANARY_REQUIRED") {
    await (options.verifyNativeActivation || verifyNativeActivation)(context, artifacts, inspection);
    recordNativeCompletion(context, output, { status: "NATIVE_CONFIGURED" });
    recordNativeCompletion(context, output, { status: "NATIVE_ACTIVE" });
    return undefined;
  }
  for (let phase = 0; phase < 2; phase++) {
    const action = nativeCoordinatorAction(context, report, output, manifestPath);
    if (!action) return undefined;
    const mode = action.action === "CONFIGURE_NATIVE_BRIDGE" ? "configure" : "activate";
    try {
      const result = await (options.nativeHandoff || nativeHandoff)(context, artifacts, manifestPath, mode,
        { ...options, inspectEab: async () => inspection, deferApproval: context.manifest.scope !== "native" });
      if (result.status === "NATIVE_APPROVAL_READY") return result;
      if (!["NATIVE_CONFIGURED", "NATIVE_ACTIVE"].includes(result.status)) return {
        ...result,
        instruction: result.action === "EXECUTE_NATIVE_SAFE_TRANSACTION"
          ? "Safe owners import this JSON into the intended Safe, review and execute it. Coordinator reruns continue after execution."
          : "Send each required admin the exact approval file and short command. Each admin reviews the decoded calls, confirms the short ID and runs with their own credentials. Coordinator reruns continue after execution/indexing.",
        resume: `npm run external:rollout -- continue --manifest ${shellQuote(manifestPath)}`,
      };
      recordNativeCompletion(context, output, result);
    } catch (error) {
      if (error.code !== "NATIVE_READINESS") throw error;
      return { status: "ACTION_REQUIRED", role: "infra", action: "ENABLE_NATIVE_SERVICES",
        infra: createServiceHandoff(artifacts, { nativeExtension: context.manifest.scope === "native" }), failedChecks: [redactFor(context, error.message)],
        instruction: context.manifest.scope === "native"
          ? "Apply native settings to the existing Runtime/verifiers, preserving Running=Yes, EAB bindings, journals and Safe writer ownership. Confirm healthy native policies, then Coordinator reruns continue."
          : "Start/repair the native Runtime/verifier configuration from this archive, then Coordinator reruns continue." };
    }
  }
  return undefined;
}

async function verifyNativeActivation(context, artifacts, inspection) {
  if (!context.nativeInputs.nativeRoutes?.length) return;
  const rpc = process.env[context.manifest.services.rpcUrlEnv];
  const request = new ethers.FetchRequest(rpc);
  request.timeout = TIMEOUT_MS;
  const provider = new ethers.JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
    await withDeadline("Native activation verification", async () => {
      await require("../nativeBridgeConfigure").plan(context.nativeInputs.nativeConfig, provider, "verify");
      const native = await nativeApprovalInspection(context, artifacts, "activate", inspection, { readOnlyActiveEab: true });
      if (native.report.calls.some(({ status }) => status !== "COMPLETE")) throw new Error("Native STRATO activation is incomplete");
    }, INSPECTION_TIMEOUT_MS);
  } finally { provider.destroy(); }
}

module.exports = { nativeGovernanceCalls, nativeGovernanceProgress, nativeOnlyEabVerified, validateNativeReadiness, nativeApprovalInspection, nativeHandoff, nativeConfigurationFingerprint, nativeCoordinatorAction, recordNativeCompletion, advanceNative, verifyNativeActivation };
