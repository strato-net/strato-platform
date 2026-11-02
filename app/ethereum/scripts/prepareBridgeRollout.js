const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { buildPolicyTemplate } = require("./lib/externalBridgeRolloutPlan");
const { writeJson } = require("./lib/externalBridgeOrchestration");
const { DEFAULT_MERCATA_BRIDGE, STRATO_BRIDGES } = require("./lib/stratoBridgeNetworks");

const REQUIRED = "REVIEW_REQUIRED";
const bare = value => String(value).replace(/^0x/i, "").toLowerCase();
const address = value => {
  if (!/^(0x)?[a-f0-9]{40}$/i.test(String(value))) throw new Error("Invalid contract/token address");
  return `0x${bare(value)}`;
};
const mappingAddress = value => String(value) === "0" ? ethers.ZeroAddress : address(value);
// Preserve raw token units and STRATO network IDs before JSON.parse can round them.
const parse = text => JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  token => token.startsWith('"') ? token : JSON.stringify(token)));
const value = row => typeof row?.value === "string"
  ? row.value.trim() === "" ? "" : parse(row.value)
  : row?.value;
const uint = v => /^\d+$/.test(String(v)) ? String(v) : REQUIRED;
const flag = v => v === true || v === "true" ? true
  : v === false || v === "false" || v === "" || /^0{40}$/.test(String(v)) ? false : REQUIRED;

function withExplicitEabPolicy(route) {
  return {
    ...route,
    mintPolicy: {
      capacity: REQUIRED,
      refillRate: REQUIRED,
      ...route.mintPolicy,
    },
    tokenPolicy: {
      minDepositAmount: REQUIRED,
      maxPerWithdrawal: REQUIRED,
      manualReviewThreshold: REQUIRED,
      bucketCapacity: REQUIRED,
      refillRate: REQUIRED,
      maxAutoWithdrawalAmount: REQUIRED,
      migrateAmount: REQUIRED,
      enabled: REQUIRED,
      ...route.tokenPolicy,
    },
    routePolicy: {
      depositsEnabled: REQUIRED,
      withdrawalsEnabled: REQUIRED,
      rebaseRequired: REQUIRED,
      autoRouteEnabled: REQUIRED,
      maxAutoDepositAmount: REQUIRED,
      ...route.routePolicy,
    },
  };
}

function withExplicitNativePolicy(route) {
  return {
    ...route,
    nativePolicy: {
      externalName: REQUIRED,
      externalSymbol: REQUIRED,
      maxPerWithdrawal: REQUIRED,
      instantWithdrawalThreshold: REQUIRED,
      enabled: REQUIRED,
      autoRouteEnabled: REQUIRED,
      sharedTokenSettings: {
        depositsDisabled: REQUIRED,
        withdrawalsDisabled: REQUIRED,
        maxOutstandingWithdrawal: REQUIRED,
        ...route.nativePolicy?.sharedTokenSettings,
      },
      ...route.nativePolicy,
    },
    destinationPolicy: {
      freezeRoute: REQUIRED,
      transfersEnabled: REQUIRED,
      ...route.destinationPolicy,
    },
  };
}

function scaleAmount(valueToScale, fromDecimals, toDecimals) {
  if (!/^\d+$/.test(String(valueToScale)) || !/^\d+$/.test(String(fromDecimals)) ||
      !/^\d+$/.test(String(toDecimals))) return REQUIRED;
  const value = BigInt(valueToScale);
  if (value === 0n) return "0";
  const from = BigInt(fromDecimals), to = BigInt(toDecimals);
  if (from === to) return value.toString();
  if (from < to) return (value * (10n ** (to - from))).toString();
  const divisor = 10n ** (from - to);
  return value % divisor === 0n ? (value / divisor).toString() : REQUIRED;
}

async function request(url, token, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Source query failed (${response.status}); no output generated`);
  const body = await response.text();
  try { return parse(body); }
  catch { throw new Error(`Expected JSON from ${new URL(url).pathname} (HTTP ${response.status}); check the node API endpoint and authentication`); }
}

async function readRows(source, table, filters, token, fetchImpl = fetch) {
  const rows = [];
  for (;;) {
    const query = new URLSearchParams({ ...filters, limit: "200", offset: String(rows.length) });
    const page = await request(`${source.nodeUrl}/cirrus/search/${table}?${query}`, token, fetchImpl);
    if (!Array.isArray(page)) throw new Error("Invalid Cirrus response");
    if (!page.length) return rows;
    rows.push(...page);
  }
}

async function discover(nodeUrl, chainId, token, fetchImpl = fetch, selections = {}) {
  const url = new URL(nodeUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Use an HTTPS node URL without credentials");
  if (!Number.isSafeInteger(Number(chainId)) || Number(chainId) <= 0) throw new Error("Invalid target chain ID");
  if (selections.sourceChainId && (!Number.isSafeInteger(Number(selections.sourceChainId)) || Number(selections.sourceChainId) <= 0)) throw new Error("Invalid source chain ID");
  if (!token) throw new Error("STRATO authentication is required for discovery");
  const source = { nodeUrl: nodeUrl.replace(/\/$/, "") };
  const metadata = await request(`${source.nodeUrl}/strato-api/eth/v1.2/metadata`, token, fetchImpl);
  if (!/^\d+$/.test(String(metadata.networkID))) throw new Error("Node metadata has no valid networkID");
  source.stratoChainId = String(metadata.networkID);
  const canonical = STRATO_BRIDGES[source.stratoChainId] || {};
  const candidates = {};
  const missing = [];
  for (const [name, contract] of [["eab", "ExternalAssetBridge"], ["native", "StratoNativeBridge"]]) {
    // Typed tables discover contract identities only; configuration comes from storage/mapping.
    const selected = selections[name] || canonical[name];
    let rows;
    if (name === "eab") {
      const legacyBridge = address(selected || DEFAULT_MERCATA_BRIDGE);
      try {
        rows = await readRows(source, "BlockApps-MercataBridge", {
          address: `eq.${bare(legacyBridge)}`, select: "address", order: "address.asc",
        }, token, fetchImpl);
      } catch (error) {
        if (!error.message.includes("(404)")) throw error;
        rows = [];
      }
      source.legacy = true;
    } else {
      try {
        rows = await readRows(source, `BlockApps-${contract}`, {
          ...(selected ? { address: `eq.${bare(address(selected))}` } : {}),
          select: "address", order: "address.asc",
        }, token, fetchImpl);
      } catch (error) {
        if (!error.message.includes("(404)")) throw error;
        rows = [];
      }
    }
    candidates[name] = [];
    for (const candidate of rows) {
      const stored = await readRows(source, "storage", { address: `eq.${bare(address(candidate.address))}`, select: "address,data", order: "address.asc" }, token, fetchImpl);
      const data = stored[0]?.data;
      const configured = name === "eab" ? (source.legacy ? Boolean(data?.tokenFactory && bare(data.tokenFactory) !== "0".repeat(40)) : flag(data?.initialized) === true)
        : data?.custodyVault && bare(data.custodyVault) !== "0".repeat(40);
      if (configured) candidates[name].push(address(candidate.address));
    }
    candidates[name] = [...new Set(candidates[name])];
    if (name === "eab") {
      if (selections.eab && candidates[name].length !== 1) throw new Error("Selected eab is not a discovered configured legacy MercataBridge");
      if (candidates[name].length === 1) source[name] = candidates[name][0];
      else missing.push("eab: configured legacy MercataBridge not found; provide --eab-address for a nonstandard deployment");
    } else if (selected) {
      const selectedAddress = address(selected);
      if (!candidates[name].includes(selectedAddress)) throw new Error(`${selections[name] ? "Selected" : "Canonical"} ${name} is not a discovered configured contract`);
      source[name] = selectedAddress;
    } else if (candidates[name].length === 1) source[name] = candidates[name][0];
    else missing.push(`${name}: ${candidates[name].length ? "select a contract from candidates" : "no configured contract found; deploy or identify the current contract"}`);
  }
  const config = { source, target: { stratoChainId: source.stratoChainId, chainId: Number(chainId), depositRouterDeploymentBlock: REQUIRED, nativeRepresentationBridge: REQUIRED }, eabRoutes: [], nativeRoutes: [] };
  const legacyThresholds = source.legacy ? await readRows(source, "mapping", {
    address: `eq.${bare(source.eab)}`, collection_name: "eq.hotWithdrawalThresholds",
    select: "collection_name,key,value", order: "collection_name.asc,key.asc",
  }, token, fetchImpl) : [];
  for (const name of ["eab", "native"]) {
    if (!source[name]) continue;
    const collectionFilter = name === "native"
      ? "in.(assets,tokenBridgeConfigs,autoRouteEnabled)"
      : name === "eab" && !source.legacy ? "eq.routes" : "eq.assets";
    const rows = await readRows(source, "mapping", { address: `eq.${bare(source[name])}`,
      collection_name: collectionFilter, select: "collection_name,key,value",
      order: "collection_name.asc,key.asc" }, token, fetchImpl);
    const parsed = rows.map(row => ({ row, asset: value(row), sourceChainId: String(row.key?.key2) }))
      .filter(({ row, asset }) => name === "native" ? row.collection_name === "assets" : asset?.stratoToken);
    const targetAssets = name === "eab" ? parsed.filter(item => item.sourceChainId === String(chainId)) : [];
    for (const item of parsed) {
      const { row, asset, sourceChainId } = item;
      if (selections.sourceChainId && sourceChainId !== String(selections.sourceChainId)) continue;
      if (source.legacy && flag(asset.enabled) !== true) continue;
      if (!/^\d+$/.test(sourceChainId)) throw new Error("Invalid discovered route");
      const stratoToken = address(name === "native" ? row.key.key : row.key.key3 || asset.stratoToken);
      const externalToken = name === "native" ? ethers.ZeroAddress : mappingAddress(row.key.key);
      const matches = targetAssets.filter(target => address(target.row.key.key3 || target.asset.stratoToken) === stratoToken);
      const enabledMatches = matches.filter(match => flag(match.asset.enabled) === true);
      const target = sourceChainId === String(chainId) ? item
        : enabledMatches.length === 1 ? enabledMatches[0]
          : matches.length === 1 ? matches[0] : undefined;
      const targetToken = target ? mappingAddress(target.row.key.key) : externalToken === ethers.ZeroAddress ? ethers.ZeroAddress : REQUIRED;
      const metadata = target?.asset || (externalToken === ethers.ZeroAddress ? asset : undefined);
      if (name === "eab") {
        const externalDecimals = metadata ? uint(metadata.externalDecimals) : REQUIRED;
        const legacyEnabled = source.legacy ? flag(asset.enabled) : REQUIRED;
        const discoveredThreshold = source.legacy
          ? lookup({ mappings: legacyThresholds }, "hotWithdrawalThresholds", sourceChainId, externalToken)
          : undefined;
        const legacyThreshold = discoveredThreshold === "" || discoveredThreshold === undefined
          ? "0" : discoveredThreshold;
        config.eabRoutes.push(withExplicitEabPolicy({
          include: false, sourceChainId, sourceExternalToken: externalToken, stratoToken,
          externalToken: targetToken,
          externalDecimals,
          externalName: metadata?.externalName || REQUIRED,
          externalSymbol: metadata?.externalSymbol || REQUIRED,
          tokenPolicy: source.legacy ? {
            maxPerWithdrawal: scaleAmount(asset.maxPerWithdrawal, 18, externalDecimals),
            manualReviewThreshold: scaleAmount(legacyThreshold, asset.externalDecimals, externalDecimals),
            enabled: legacyEnabled,
          } : undefined,
          routePolicy: source.legacy ? {
            depositsEnabled: legacyEnabled,
            withdrawalsEnabled: legacyEnabled,
            autoRouteEnabled: false,
          } : undefined,
        }));
      }
      else {
        const stratoToken = address(row.key.key);
        const tokenConfig = lookup({ mappings: rows }, "tokenBridgeConfigs", stratoToken) || {};
        config.nativeRoutes.push(withExplicitNativePolicy({
          include: false,
          sourceChainId,
          stratoToken,
          representationToken: sourceChainId === String(chainId) ? address(asset.representationToken) : REQUIRED,
          nativePolicy: {
            externalName: asset.externalName || REQUIRED,
            externalSymbol: asset.externalSymbol || REQUIRED,
            maxPerWithdrawal: uint(asset.maxPerWithdrawal),
            instantWithdrawalThreshold: uint(asset.instantWithdrawalThreshold),
            enabled: flag(asset.enabled),
            autoRouteEnabled: flag(lookup({ mappings: rows }, "autoRouteEnabled", stratoToken, sourceChainId)),
            sharedTokenSettings: {
              depositsDisabled: flag(tokenConfig.depositsDisabled),
              withdrawalsDisabled: flag(tokenConfig.withdrawalsDisabled),
              maxOutstandingWithdrawal: uint(tokenConfig.maxOutstandingWithdrawal),
            },
          },
        }));
      }
    }
  }
  return { config, candidates, missing };
}

async function snapshot(input, token, fetchImpl = fetch) {
  const source = input.source;
  for (const route of [...(input.eabRoutes || []), ...(input.nativeRoutes || [])]) {
    if (!Number.isSafeInteger(Number(route.sourceChainId)) || Number(route.sourceChainId) <= 0) throw new Error("Invalid source external chain ID");
  }
  const url = new URL(source.nodeUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Source node must be HTTPS without credentials");
  source.nodeUrl = source.nodeUrl.replace(/\/$/, "");
  if (!/^\d+$/.test(source.stratoChainId) || source.stratoChainId !== input.target.stratoChainId) throw new Error("Source and target STRATO networks must match exactly");
  if (!token) throw new Error("STRATO authentication is required");
  const metadata = await request(`${source.nodeUrl}/strato-api/eth/v1.2/metadata`, token, fetchImpl);
  if (String(metadata.networkID) !== source.stratoChainId) throw new Error("Source node networkID mismatch");
  const read = (bridge, table) => readRows(source, table, { address: `eq.${bare(address(bridge))}`,
    ...(table === "mapping" ? { collection_name: "in.(routes,assets,chains,mintPolicies,depositActionConfigs,routeRebaseRequired,nativeAutoRouteEnabled,tokenBridgeConfigs,autoRouteEnabled,settlementVerifiers,approvedYieldVaults)" } : {}),
    select: table === "mapping" ? "collection_name,key,value" : "address,data",
    order: table === "mapping" ? "collection_name.asc,key.asc" : "address.asc" }, token, fetchImpl);
  const result = {};
  for (const name of ["eab", "native"]) {
    if (!source[name]) continue;
    const [storage, mappings] = await Promise.all([read(source[name], "storage"), read(source[name], "mapping")]);
    if (storage.length !== 1) throw new Error(`${name} source contract missing or ambiguous`);
    result[name] = { address: address(source[name]), storage: storage[0].data, mappings };
  }
  if (input.target.externalAssetBridge) {
    const [storage, mappings] = await Promise.all([
      read(input.target.externalAssetBridge, "storage"),
      read(input.target.externalAssetBridge, "mapping"),
    ]);
    if (storage.length !== 1) throw new Error("Target ExternalAssetBridge missing or ambiguous");
    result.targetEab = { address: address(input.target.externalAssetBridge), storage: storage[0].data, mappings };
  }
  const routerAddress = result.eab?.storage?.tokenRouter || result.native?.storage?.tokenRouter;
  if (routerAddress && /^(0x)?[a-f0-9]{40}$/i.test(routerAddress) && bare(routerAddress) !== "0".repeat(40)) {
    const [storage, mappings] = await Promise.all([read(routerAddress, "storage"), read(routerAddress, "mapping")]);
    if (storage.length !== 1) throw new Error("TokenRouter missing or ambiguous");
    result.router = { address: address(routerAddress), storage: storage[0].data, mappings };
  }
  const tokens = {};
  for (const tokenAddress of new Set([...(input.eabRoutes || []), ...(input.nativeRoutes || [])].map(r => address(r.stratoToken)))) {
    const rows = await read(tokenAddress, "storage");
    if (rows.length !== 1) throw new Error("STRATO token missing or ambiguous");
    tokens[tokenAddress] = rows[0].data;
  }
  return { tokens, nodeUrl: source.nodeUrl, stratoChainId: source.stratoChainId, capturedAt: new Date().toISOString(), ...result };
}

function lookup(snapshot, collection, ...keys) {
  const matches = snapshot?.mappings.filter(row => row.collection_name === collection &&
    keys.every((key, i) => bare(row.key?.[i ? `key${i + 1}` : "key"]) === bare(key)));
  if (matches?.length > 1) throw new Error(`Ambiguous ${collection} source`);
  return value(matches?.[0]);
}

function prepare(input, state) {
  if (state.stratoChainId !== input.target.stratoChainId) throw new Error("Snapshot network mismatch");
  const chainId = Number(input.target.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid target external chain ID");
  const inventory = (input.eabRoutes || []).map(route => ({ externalToken: address(route.externalToken), stratoToken: address(route.stratoToken) }));
  const policy = buildPolicyTemplate(inventory, chainId, input.target.depositRouterDeploymentBlock || REQUIRED);
  const items = [];
  const seen = new Set();
  for (const route of input.eabRoutes || []) {
    const target = address(route.stratoToken), token = address(route.externalToken);
    const identity = `${token}:${target}`;
    if (seen.has(identity)) throw new Error("Duplicate target route");
    seen.add(identity);
    const mintPolicy = {
      capacity: uint(route.mintPolicy?.capacity),
      refillRate: uint(route.mintPolicy?.refillRate),
    };
    if (items.some(item => item.target === target) &&
        JSON.stringify(policy.mintPolicies[target]) !== JSON.stringify(mintPolicy)) {
      throw new Error("Conflicting shared STRATO-token mint policy");
    }
    policy.mintPolicies[target] = mintPolicy;
    const tokenPolicy = {
      minDepositAmount: uint(route.tokenPolicy?.minDepositAmount),
      maxPerWithdrawal: uint(route.tokenPolicy?.maxPerWithdrawal),
      manualReviewThreshold: uint(route.tokenPolicy?.manualReviewThreshold),
      bucketCapacity: uint(route.tokenPolicy?.bucketCapacity),
      refillRate: uint(route.tokenPolicy?.refillRate),
      maxAutoWithdrawalAmount: uint(route.tokenPolicy?.maxAutoWithdrawalAmount),
      migrateAmount: uint(route.tokenPolicy?.migrateAmount),
      enabled: flag(route.tokenPolicy?.enabled),
    };
    if (items.some(item => item.token === token) &&
        JSON.stringify(policy.tokens[token]) !== JSON.stringify(tokenPolicy)) {
      throw new Error("Conflicting shared external-token policy");
    }
    policy.tokens[token] = tokenPolicy;
    policy.routes[identity] = {
      depositsEnabled: flag(route.routePolicy?.depositsEnabled),
      withdrawalsEnabled: flag(route.routePolicy?.withdrawalsEnabled),
      rebaseRequired: flag(route.routePolicy?.rebaseRequired),
      autoRouteEnabled: flag(route.routePolicy?.autoRouteEnabled),
      maxAutoDepositAmount: uint(route.routePolicy?.maxAutoDepositAmount),
    };
    items.push({ token, target, isPermitted: true, externalDecimals: uint(route.externalDecimals),
      externalName: route.externalName || REQUIRED,
      externalSymbol: token === ethers.ZeroAddress ? "ETH" : route.externalSymbol || REQUIRED,
      stratoTokenStatus: uint(state.tokens?.[target]?.status) });
  }
  const native = (input.nativeRoutes || []).map(route => {
    const token = address(route.stratoToken);
    return { "bridge-address": input.target.nativeBridge ? bare(address(input.target.nativeBridge)) : state.native?.address ? bare(state.native.address) : REQUIRED,
      "external-chain-id": String(chainId), "external-bridge": input.target.nativeRepresentationBridge || REQUIRED,
      "representation-token": route.representationToken || REQUIRED, "strato-token": bare(token),
      "external-name": route.nativePolicy?.externalName || REQUIRED,
      "external-symbol": route.nativePolicy?.externalSymbol || REQUIRED,
      "max-per-withdrawal": uint(route.nativePolicy?.maxPerWithdrawal),
      "instant-withdrawal-threshold": uint(route.nativePolicy?.instantWithdrawalThreshold),
      "enabled": flag(route.nativePolicy?.enabled),
      "auto-route-enabled": flag(route.nativePolicy?.autoRouteEnabled),
      sharedTokenSettings: {
        depositsDisabled: flag(route.nativePolicy?.sharedTokenSettings?.depositsDisabled),
        withdrawalsDisabled: flag(route.nativePolicy?.sharedTokenSettings?.withdrawalsDisabled),
        maxOutstandingWithdrawal: uint(route.nativePolicy?.sharedTokenSettings?.maxOutstandingWithdrawal),
      } };
  });
  const unresolved = [];
  const scan = (v, p) => { if (v === REQUIRED) unresolved.push(p); else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => scan(x, `${p}.${k}`)); };
  const output = { policy, depositPlan: { operations: [{ chainId, transactions: [{ meta: { items } }] }] }, native };
  scan(output, "inputs");
  return { ...output, unresolved };
}

async function readTargetTokenMetadata(input, env = process.env) {
  const routes = (input.eabRoutes || []).filter(r => address(r.externalToken) !== ethers.ZeroAddress);
  if (!routes.length) return;
  const rpc = env[`CHAIN_${input.target.chainId}_RPC_URL`];
  if (!rpc) throw new Error(`Missing CHAIN_${input.target.chainId}_RPC_URL for target token metadata`);
  const provider = new ethers.JsonRpcProvider(rpc);
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(input.target.chainId)) throw new Error("Target RPC chain mismatch");
    const blockTag = await provider.getBlockNumber();
    const tokens = new Map();
    for (const route of routes) {
      const key = address(route.externalToken);
      if (!tokens.has(key)) {
        const token = new ethers.Contract(key, ["function decimals() view returns(uint8)", "function name() view returns(string)", "function symbol() view returns(string)"], provider);
        const [decimals, name, symbol] = await Promise.all([token.decimals({ blockTag }), token.name({ blockTag }), token.symbol({ blockTag })]);
        tokens.set(key, { externalDecimals: String(decimals), externalName: name, externalSymbol: symbol });
      }
      Object.assign(route, tokens.get(key));
    }
  } finally { provider.destroy(); }
}

function rolloutSettings(input, state) {
  const a = v => /^(0x)?[a-f0-9]{40}$/i.test(String(v)) && bare(v) !== "0".repeat(40) ? address(v) : REQUIRED;
  const configured = (...values) => values.find(value => a(value) !== REQUIRED);
  const targetEab = state.targetEab;
  const defaults = STRATO_BRIDGES[state.stratoChainId]?.dependencies || {};
  const bridge = targetEab?.storage || state.eab?.storage || {}, router = state.router?.storage || {};
  const sourceBridge = state.eab?.storage || {};
  const targetEabInitialized = flag(targetEab?.storage?.initialized) === true;
  const configuredVerifiers = (targetEab?.mappings || [])
    .filter(r => r.collection_name === "settlementVerifiers" && flag(value(r)) === true)
    .map(r => a(r.key?.key));
  return {
    sourceChainId: state.stratoChainId, externalDeployment: input.target.externalDeployment || "../external-deployment.json", depositPlan: "./deposit-plan.json",
    tokenRouter: a(input.target.tokenRouter || state.router?.address),
    externalAssetBridge: targetEab ? a(targetEab.address) : input.source.legacy ? REQUIRED : a(state.eab?.address),
    bridgeOperator: a(input.target.bridgeOperator || bridge.bridgeOperator || sourceBridge.bridgeOperator),
    guardian: a(targetEabInitialized ? bridge.guardian :
      input.target.guardian || bridge.guardian || sourceBridge.guardian),
    settlementVerifiers: input.target.settlementVerifiers?.map(a) ||
      (configuredVerifiers.length ? configuredVerifiers :
        (state.eab?.mappings || []).filter(r => r.collection_name === "settlementVerifiers" && flag(value(r)) === true).map(r => a(r.key?.key))),
    dependencies: { adminRegistry: a(configured(bridge._owner, sourceBridge._owner)), poolFactory: a(router.poolFactory || defaults.poolFactory), poolV3Factory: a(router.poolV3Factory || defaults.poolV3Factory),
      directMintPsm: a(router.directMintPsm || defaults.directMintPsm), metalForge: a(router.metalForge || defaults.metalForge), saveUsdstVault: a(router.saveUsdstVault || defaults.saveUsdstVault),
      yieldVaults: (state.router?.mappings || []).filter(r => r.collection_name === "approvedYieldVaults" && flag(value(r)) === true).map(r => a(r.key?.key)),
      tokenFactory: a(configured(bridge.tokenFactory, sourceBridge.tokenFactory)),
      usdst: a(configured(bridge.USDST_ADDRESS, sourceBridge.USDST_ADDRESS)),
      priceOracle: a(configured(bridge.priceOracle, sourceBridge.priceOracle, defaults.priceOracle)) },
  };
}

async function readNativeBaseline(input) {
  const baseline = { chainId: Number(input.target.chainId), bridgeAddress: input.target.nativeRepresentationBridge || REQUIRED,
    safeAddress: input.target.safeAddress || REQUIRED,
    executor: input.target.nativeConfig?.executor || REQUIRED,
    eabExecutor: input.target.nativeConfig?.eabExecutor || REQUIRED,
    attestationSigners: input.target.nativeConfig?.attestationSigners || [],
    disabledAttestationSigners: [],
    attestationThreshold: Number.isSafeInteger(Number(input.target.nativeConfig?.attestationThreshold))
      ? Number(input.target.nativeConfig.attestationThreshold) : REQUIRED,
    maxAttestationValiditySeconds: uint(input.target.nativeConfig?.maxAttestationValiditySeconds),
    tokens: [] };
  for (const route of input.nativeRoutes || []) {
    const target = { stratoToken: address(route.stratoToken), representationToken: route.representationToken || REQUIRED,
      freezeRoute: flag(route.destinationPolicy?.freezeRoute),
      transfersEnabled: flag(route.destinationPolicy?.transfersEnabled) };
    baseline.tokens.push(target);
  }
  return baseline;
}

function applyDeploymentArtifacts(input, configFile) {
  const directory = path.dirname(path.resolve(configFile));
  const read = file => JSON.parse(fs.readFileSync(path.resolve(directory, file), "utf8"));
  const externalFile = input.target.externalDeployment || "external-deployment.json";
  if (input.target.externalDeployment || fs.existsSync(path.resolve(directory, externalFile))) {
    const deployment = read(externalFile);
    if (String(deployment.chainId) !== String(input.target.chainId)) throw new Error("EAB deployment artifact chain mismatch");
    input.target.depositRouterDeploymentBlock = uint(deployment.depositRouterDeploymentBlock);
    input.target.externalDeployment = path.resolve(directory, externalFile);
  }
  const native = (file, contractName) => {
    const deployment = read(file);
    if (deployment.contractName !== contractName || String(deployment.network?.chainId) !== String(input.target.chainId)) throw new Error("Native deployment artifact contract/chain mismatch");
    return deployment;
  };
  if (input.target.nativeDeployment) {
    const deployment = native(input.target.nativeDeployment, "StratoNativeRepresentationBridge");
    input.target.nativeRepresentationBridge = address(deployment.addresses?.proxy);
    input.target.safeAddress = address(deployment.configuration?.initParams?.[0]);
  }
  for (const route of input.nativeRoutes || []) if (route.deployment) {
    const deployment = native(route.deployment, "StratoNativeRepresentationToken");
    route.representationToken = address(deployment.addresses?.proxy);
    route.externalName = deployment.configuration?.initParams?.[0] || REQUIRED;
    route.externalSymbol = deployment.configuration?.initParams?.[1] || REQUIRED;
  }
}

async function getReadToken(env = process.env, authenticate) {
  const required = ["GLOBAL_ADMIN_NAME", "GLOBAL_ADMIN_PASSWORD", "OAUTH_URL", "OAUTH_CLIENT_ID", "OAUTH_CLIENT_SECRET"];
  const missing = required.filter(name => !env[name]);
  if (missing.length) throw new Error(`Missing STRATO OAuth configuration: ${missing.join(", ")}`);
  if (!authenticate) {
    const config = require("../../contracts/deploy/config");
    Object.assign(config.nodes[0].oauth, { openIdDiscoveryUrl: env.OAUTH_URL, clientId: env.OAUTH_CLIENT_ID, clientSecret: env.OAUTH_CLIENT_SECRET });
    authenticate = require("../../contracts/deploy/auth").getUserToken;
  }
  const token = await authenticate(env.GLOBAL_ADMIN_NAME, env.GLOBAL_ADMIN_PASSWORD);
  if (typeof token !== "string" || !token) throw new Error("STRATO OAuth did not return an access token");
  return token;
}

function writeNativeOutputs(directory, routes, baseline) {
  if (!routes.length) return;
  writeJson(path.join(directory, "native-routes.json"), routes);
  writeJson(path.join(directory, "native.json"), baseline);
}

async function main(argv, options = {}) {
  require("dotenv").config({ quiet: true });
  require("dotenv").config({ path: path.resolve(__dirname, "../../contracts/.env"), quiet: true, override: false });
  if (argv[0] === "--discover") {
    const args = {};
    for (let i = 1; i < argv.length; i += 2) {
      if (!["--node-url", "--chain-id", "--source-chain-id", "--output-dir", "--eab-address", "--native-address"].includes(argv[i]) || !argv[i + 1] || args[argv[i]]) throw new Error("Use --discover --node-url URL --chain-id TARGET_ID --source-chain-id SOURCE_ID --output-dir NEW_DIRECTORY");
      args[argv[i]] = argv[i + 1];
    }
    if (!args["--output-dir"]) throw new Error("--output-dir is required");
    if (fs.existsSync(args["--output-dir"])) throw new Error("Output directory exists");
    const result = await discover(args["--node-url"], args["--chain-id"], options.token || await getReadToken(), options.fetchImpl || fetch, {
      eab: args["--eab-address"], native: args["--native-address"], sourceChainId: args["--source-chain-id"],
    });
    writeJson(path.join(args["--output-dir"], "prepare.json"), result.config);
    writeJson(path.join(args["--output-dir"], "discovery.json"), { candidates: result.candidates, missing: result.missing });
    if (!options.quiet) console.log(`Discovered ${result.config.eabRoutes.length} EAB and ${result.config.nativeRoutes.length} native routes. Select include:true for intended routes; ${result.missing.length} contract selections unresolved.`);
    return;
  }
  if (argv.length !== 4 || argv[0] !== "--config" || argv[2] !== "--output-dir") throw new Error("Usage: --config FILE --output-dir NEW_DIRECTORY");
  const input = JSON.parse(fs.readFileSync(argv[1], "utf8"));
  for (const name of ["eabRoutes", "nativeRoutes"]) input[name] = (input[name] || []).filter(route => route.include !== false);
  if (!input.eabRoutes.length && !input.nativeRoutes.length) throw new Error("Select at least one discovered route with include:true");
  applyDeploymentArtifacts(input, argv[1]);
  const directory = path.resolve(argv[3]);
  if (fs.existsSync(directory)) throw new Error("Output directory exists; use a new directory to preserve reviewed inputs");
  const state = await snapshot(input, options.token || await getReadToken(), options.fetchImpl || fetch);
  await readTargetTokenMetadata(input);
  const output = prepare(input, state);
  const nativeBaseline = output.native.length ? await readNativeBaseline(input) : undefined;
  const settings = rolloutSettings(input, state);
  const findMissing = (v, name) => {
    if (v === REQUIRED) output.unresolved.push(name);
    else if (v && typeof v === "object") Object.entries(v).forEach(([key, child]) => findMissing(child, `${name}.${key}`));
  };
  if (nativeBaseline) {
    findMissing(nativeBaseline, "native");
    if (!nativeBaseline.attestationSigners.length) output.unresolved.push("native.attestationSigners");
  }
  findMissing(settings, "settings");
  if (!settings.settlementVerifiers.length) output.unresolved.push("settings.settlementVerifiers");
  writeJson(path.join(directory, "source-snapshot.json"), state);
  writeJson(path.join(directory, "settings.json"), settings);
  writeJson(path.join(directory, "policy.json"), output.policy);
  writeJson(path.join(directory, "deposit-plan.json"), output.depositPlan);
  writeNativeOutputs(directory, output.native, nativeBaseline);
  writeJson(path.join(directory, "review-required.json"), output.unresolved);
  if (!options.quiet) console.log(`Prepared current-network inputs. ${output.unresolved.length} unresolved fields; no transactions submitted.`);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, lookup, prepare, snapshot, readRows, discover, rolloutSettings, applyDeploymentArtifacts,
  getReadToken, writeNativeOutputs, withExplicitEabPolicy, withExplicitNativePolicy, main };
