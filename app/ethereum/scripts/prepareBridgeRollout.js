const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { buildPolicyTemplate } = require("./lib/externalBridgeRolloutPlan");
const { writeJson } = require("./lib/externalBridgeOrchestration");

const REQUIRED = "REVIEW_REQUIRED";
const DEFAULT_MERCATA_BRIDGE = "0x0000000000000000000000000000000000001008";
const bare = value => String(value).replace(/^0x/i, "").toLowerCase();
const address = value => {
  if (!/^(0x)?[a-f0-9]{40}$/i.test(String(value))) throw new Error("Invalid contract/token address");
  return `0x${bare(value)}`;
};
const mappingAddress = value => String(value) === "0" ? ethers.ZeroAddress : address(value);
// Preserve raw token units and STRATO network IDs before JSON.parse can round them.
const parse = text => JSON.parse(text.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  token => token.startsWith('"') ? token : JSON.stringify(token)));
const value = row => typeof row?.value === "string" ? parse(row.value) : row?.value;
const uint = v => /^\d+$/.test(String(v)) ? String(v) : REQUIRED;
const flag = v => v === true || v === "true" ? true
  : v === false || v === "false" || v === "" || /^0{40}$/.test(String(v)) ? false : REQUIRED;

async function request(url, token, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Source query failed (${response.status}); no output generated`);
  const body = await response.text();
  try { return parse(body); }
  catch { throw new Error(`Expected JSON from ${new URL(url).pathname} (HTTP ${response.status}); check the node API endpoint and authentication`); }
}

async function retryRead(read) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await read(); }
    catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError;
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
  const candidates = {};
  const missing = [];
  for (const [name, contract] of [["eab", "ExternalAssetBridge"], ["native", "StratoNativeBridge"]]) {
    // Typed tables discover contract identities only; configuration comes from storage/mapping.
    let rows;
    if (name === "eab") {
      const selected = address(selections.eab || DEFAULT_MERCATA_BRIDGE);
      try {
        rows = await readRows(source, "BlockApps-MercataBridge", {
          address: `eq.${bare(selected)}`, select: "address", order: "address.asc",
        }, token, fetchImpl);
      } catch (error) {
        if (!error.message.includes("(404)")) throw error;
        rows = [];
      }
      source.legacy = true;
    } else {
      try {
        rows = await readRows(source, `BlockApps-${contract}`, { select: "address", order: "address.asc" }, token, fetchImpl);
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
    } else if (selections[name]) {
      const selected = address(selections[name]);
      if (!candidates[name].includes(selected)) throw new Error(`Selected ${name} is not a discovered configured contract`);
      source[name] = selected;
    } else if (candidates[name].length === 1) source[name] = candidates[name][0];
    else missing.push(`${name}: ${candidates[name].length ? "select a contract from candidates" : "no configured contract found; deploy or identify the current contract"}`);
  }
  const config = { source, target: { stratoChainId: source.stratoChainId, chainId: Number(chainId), depositRouterDeploymentBlock: REQUIRED, nativeRepresentationBridge: REQUIRED }, eabRoutes: [], nativeRoutes: [] };
  for (const name of ["eab", "native"]) {
    if (!source[name]) continue;
    const rows = await readRows(source, "mapping", { address: `eq.${bare(source[name])}`, collection_name: name === "eab" && !source.legacy ? "eq.routes" : "eq.assets", select: "collection_name,key,value", order: "collection_name.asc,key.asc" }, token, fetchImpl);
    const parsed = rows.map(row => ({ row, asset: value(row), sourceChainId: String(row.key?.key2) }))
      .filter(({ asset }) => asset?.stratoToken);
    const targetAssets = name === "eab" ? parsed.filter(item => item.sourceChainId === String(chainId)) : [];
    for (const item of parsed) {
      const { row, asset, sourceChainId } = item;
      if (selections.sourceChainId && sourceChainId !== String(selections.sourceChainId)) continue;
      if (source.legacy && flag(asset.enabled) !== true) continue;
      if (!/^\d+$/.test(sourceChainId)) throw new Error("Invalid discovered route");
      const stratoToken = address(row.key.key3 || asset.stratoToken);
      const externalToken = mappingAddress(row.key.key);
      const matches = targetAssets.filter(target => address(target.row.key.key3 || target.asset.stratoToken) === stratoToken);
      const enabledMatches = matches.filter(match => flag(match.asset.enabled) === true);
      const target = sourceChainId === String(chainId) ? item
        : enabledMatches.length === 1 ? enabledMatches[0]
          : matches.length === 1 ? matches[0] : undefined;
      const targetToken = target ? mappingAddress(target.row.key.key) : externalToken === ethers.ZeroAddress ? ethers.ZeroAddress : REQUIRED;
      const metadata = target?.asset || (externalToken === ethers.ZeroAddress ? asset : undefined);
      if (name === "eab") config.eabRoutes.push({ include: false, sourceChainId,
        sourceExternalToken: externalToken, stratoToken,
        externalToken: targetToken,
        externalDecimals: metadata ? uint(metadata.externalDecimals) : REQUIRED,
        externalName: metadata?.externalName || REQUIRED,
        externalSymbol: metadata?.externalSymbol || REQUIRED });
      else config.nativeRoutes.push({ include: false, sourceChainId, stratoToken: address(row.key.key),
        representationToken: sourceChainId === String(chainId) ? address(asset.representationToken) : REQUIRED });
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

function prepare(input, state, external = {}) {
  if (state.stratoChainId !== input.target.stratoChainId) throw new Error("Snapshot network mismatch");
  const chainId = Number(input.target.chainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid target external chain ID");
  const inventory = (input.eabRoutes || []).map(route => ({ externalToken: address(route.externalToken), stratoToken: address(route.stratoToken) }));
  const policy = buildPolicyTemplate(inventory, chainId, input.target.depositRouterDeploymentBlock || REQUIRED);
  const items = [];
  const seen = new Set();
  const current = (collection, ...keys) =>
    lookup(state.targetEab, collection, ...keys) ?? lookup(state.eab, collection, ...keys);
  for (const route of input.eabRoutes || []) {
    const target = address(route.stratoToken), token = address(route.externalToken);
    const identity = `${token}:${target}`;
    if (seen.has(identity)) throw new Error("Duplicate target route");
    seen.add(identity);
    const oldToken = address(route.sourceExternalToken);
    const old = current("routes", oldToken, route.sourceChainId, target);
    const legacy = lookup(state.eab, "assets", oldToken, route.sourceChainId);
    const source = old || (bare(legacy?.stratoToken) === bare(target) ? legacy : undefined);
    const mint = current("mintPolicies", target);
    const sameDecimals = source && uint(source.externalDecimals) === uint(route.externalDecimals) && uint(route.externalDecimals) !== REQUIRED;
    const externalState = sameDecimals ? external[`${route.sourceChainId}:${oldToken}`] || {} : {};
    policy.mintPolicies[target] = { capacity: uint(mint?.capacity), refillRate: uint(mint?.refillRate) };
    const tokenPolicy = {
      ...policy.tokens[token], minDepositAmount: uint(externalState.minDepositAmount),
      maxPerWithdrawal: uint(sameDecimals ? source?.maxPerWithdrawal : undefined), manualReviewThreshold: uint(sameDecimals ? source?.manualReviewThreshold : undefined),
      bucketCapacity: uint(externalState.bucketCapacity), refillRate: uint(externalState.refillRate),
      enabled: flag(externalState.enabled),
    };
    if (items.some(i => i.token === token) && JSON.stringify(policy.tokens[token]) !== JSON.stringify(tokenPolicy)) throw new Error("Conflicting shared external-token limits");
    policy.tokens[token] = tokenPolicy;
    for (const name of ["maxPerWithdrawal", "manualReviewThreshold"]) {
      if (externalState[name] !== undefined && tokenPolicy[name] !== uint(externalState[name])) tokenPolicy[name] = REQUIRED;
    }
    const action = current("depositActionConfigs", oldToken, route.sourceChainId, target);
    const actionEnabled = flag(action?.autoRoute);
    const autoRouteEnabled = oldToken === ethers.ZeroAddress && actionEnabled === true
      ? flag(current("nativeAutoRouteEnabled", route.sourceChainId, target)) : actionEnabled;
    policy.routes[`${token}:${target}`] = {
      ...policy.routes[`${token}:${target}`],
      depositsEnabled: flag(old?.depositsEnabled ?? legacy?.enabled),
      withdrawalsEnabled: flag(old?.withdrawalsEnabled ?? legacy?.enabled),
      rebaseRequired: flag(current("routeRebaseRequired", oldToken, route.sourceChainId, target)),
      autoRouteEnabled: autoRouteEnabled === REQUIRED ? true : autoRouteEnabled,
    };
    items.push({ token, target, isPermitted: true, externalDecimals: uint(route.externalDecimals),
      externalName: route.externalName || REQUIRED, externalSymbol: route.externalSymbol || REQUIRED, stratoTokenStatus: uint(state.tokens?.[target]?.status) });
  }
  const native = (input.nativeRoutes || []).map(route => {
    const token = address(route.stratoToken);
    const asset = lookup(state.native, "assets", token, route.sourceChainId);
    const config = lookup(state.native, "tokenBridgeConfigs", token);
    const autoRouteEnabled = flag(lookup(state.native, "autoRouteEnabled", token, route.sourceChainId));
    return { "bridge-address": input.target.nativeBridge ? bare(address(input.target.nativeBridge)) : state.native?.address ? bare(state.native.address) : REQUIRED,
      "external-chain-id": String(chainId), "external-bridge": input.target.nativeRepresentationBridge || REQUIRED,
      "representation-token": route.representationToken || REQUIRED, "strato-token": bare(token),
      "external-name": route.externalName || asset?.externalName || REQUIRED,
      "external-symbol": route.externalSymbol || asset?.externalSymbol || REQUIRED,
      "max-per-withdrawal": uint(asset?.maxPerWithdrawal), "instant-withdrawal-threshold": uint(asset?.instantWithdrawalThreshold),
      "enabled": flag(asset?.enabled),
      "auto-route-enabled": autoRouteEnabled === REQUIRED ? true : autoRouteEnabled,
      sharedTokenSettings: { depositsDisabled: flag(config?.depositsDisabled), withdrawalsDisabled: flag(config?.withdrawalsDisabled),
        maxOutstandingWithdrawal: uint(config?.maxOutstandingWithdrawal) } };
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

async function readExternal(input, state, env = process.env) {
  const result = {};
  for (const route of input.eabRoutes || []) {
    const legacyChain = lookup(state.eab, "chains", route.sourceChainId);
    const policyChain = lookup(state.targetEab, "chains", route.sourceChainId);
    if (!legacyChain?.depositRouter) continue;
    const rpc = env[`CHAIN_${route.sourceChainId}_RPC_URL`];
    if (!rpc) throw new Error(`Missing CHAIN_${route.sourceChainId}_RPC_URL for existing source chain`);
    const provider = new ethers.JsonRpcProvider(rpc);
    try {
      if ((await provider.getNetwork()).chainId !== BigInt(route.sourceChainId)) throw new Error("Source external RPC chain mismatch");
      const blockTag = await provider.getBlockNumber();
      const token = address(route.sourceExternalToken), key = `${route.sourceChainId}:${token}`;
      if (result[key]) continue;
      const router = new ethers.Contract(address(legacyChain.depositRouter), ["function tokenConfig(address) view returns(uint96 min,bool isPermitted)"], provider);
      const r = await router.tokenConfig(token, { blockTag });
      result[key] = { blockTag, minDepositAmount: r.min.toString(), enabled: r.isPermitted };
      const vaultAddress = policyChain?.vault || legacyChain.externalBridgeVault;
      if (vaultAddress && bare(vaultAddress) !== "0".repeat(40)) {
        const vault = new ethers.Contract(address(vaultAddress), ["function tokenPolicies(address) view returns(bool enabled,uint256 maxPerWithdrawal,uint256 bucketCapacity,uint256 refillRate,uint256 lastRefillAt,uint256 consumedCapacity,uint256 manualReviewThreshold)"], provider);
        try {
          const v = await vault.tokenPolicies(token, { blockTag });
          Object.assign(result[key], { enabled: v.enabled, bucketCapacity: v.bucketCapacity.toString(), refillRate: v.refillRate.toString(),
            maxPerWithdrawal: v.maxPerWithdrawal.toString(), manualReviewThreshold: v.manualReviewThreshold.toString() });
        } catch (error) {
          if (policyChain?.vault || (error?.code !== "CALL_EXCEPTION" && error?.code !== "BAD_DATA")) throw error;
        }
      }
    } finally { provider.destroy(); }
  }
  return result;
}

function rolloutSettings(input, state) {
  const a = v => /^(0x)?[a-f0-9]{40}$/i.test(String(v)) && bare(v) !== "0".repeat(40) ? address(v) : REQUIRED;
  const targetEab = state.targetEab;
  const bridge = targetEab?.storage || state.eab?.storage || {}, router = state.router?.storage || {};
  return {
    sourceChainId: state.stratoChainId, externalDeployment: input.target.externalDeployment || "../external-deployment.json", depositPlan: "./deposit-plan.json",
    tokenRouter: a(state.router?.address), externalAssetBridge: targetEab ? a(targetEab.address) : input.source.legacy ? REQUIRED : a(state.eab?.address),
    bridgeOperator: a(bridge.bridgeOperator), guardian: a(bridge.guardian),
    settlementVerifiers: (targetEab?.mappings || state.eab?.mappings || []).filter(r => r.collection_name === "settlementVerifiers" && flag(value(r)) === true).map(r => a(r.key?.key)),
    dependencies: { adminRegistry: a(bridge._owner), poolFactory: a(router.poolFactory), poolV3Factory: a(router.poolV3Factory),
      directMintPsm: a(router.directMintPsm), metalForge: a(router.metalForge), saveUsdstVault: a(router.saveUsdstVault),
      yieldVaults: (state.router?.mappings || []).filter(r => r.collection_name === "approvedYieldVaults" && flag(value(r)) === true).map(r => a(r.key?.key)),
      tokenFactory: a(bridge.tokenFactory), usdst: a(bridge.USDST_ADDRESS), priceOracle: a(bridge.priceOracle) },
  };
}

async function readNativeBaseline(input, state, env = process.env) {
  const baseline = { chainId: Number(input.target.chainId), bridgeAddress: input.target.nativeRepresentationBridge || REQUIRED,
    safeAddress: input.target.safeAddress || REQUIRED, executor: REQUIRED, eabExecutor: REQUIRED, attestationSigners: [], disabledAttestationSigners: [],
    attestationThreshold: REQUIRED, maxAttestationValiditySeconds: REQUIRED, tokens: [] };
  const thresholds = new Set(), validities = new Set();
  const rpc = env[`CHAIN_${input.target.chainId}_RPC_URL`];
  if (!rpc) throw new Error(`Missing CHAIN_${input.target.chainId}_RPC_URL for native baseline`);
  const provider = new ethers.JsonRpcProvider(rpc);
  try {
    if ((await provider.getNetwork()).chainId !== BigInt(input.target.chainId)) throw new Error("Native baseline RPC chain mismatch");
    const blockTag = await provider.getBlockNumber();
    for (const route of input.nativeRoutes || []) {
    const target = { stratoToken: address(route.stratoToken), representationToken: route.representationToken || REQUIRED,
      freezeRoute: REQUIRED, transfersEnabled: REQUIRED };
    baseline.tokens.push(target);
      if (!input.target.nativeRepresentationBridge || !route.representationToken) continue;
      const bridge = new ethers.Contract(address(input.target.nativeRepresentationBridge), ["function routeFrozen(address) view returns(bool)",
        "function maxAttestationValiditySeconds() view returns(uint256)", "function attestationThreshold() view returns(uint8)"], provider);
      const token = new ethers.Contract(address(route.representationToken), ["function transfersEnabled() view returns(bool)"], provider);
      const reads = await Promise.allSettled([
        retryRead(() => bridge.routeFrozen(target.stratoToken, { blockTag })),
        retryRead(() => token.transfersEnabled({ blockTag })),
        retryRead(() => bridge.maxAttestationValiditySeconds({ blockTag })),
        retryRead(() => bridge.attestationThreshold({ blockTag })),
      ]);
      // Older native contracts may not expose the newer authorization controls.
      for (const read of reads) if (read.status === "rejected" && read.reason?.code !== "CALL_EXCEPTION" && read.reason?.code !== "BAD_DATA") throw read.reason;
      target.freezeRoute = reads[0].status === "fulfilled" ? reads[0].value : REQUIRED;
      target.transfersEnabled = reads[1].status === "fulfilled" ? reads[1].value : REQUIRED;
      validities.add(reads[2].status === "fulfilled" ? String(reads[2].value) : REQUIRED);
      thresholds.add(reads[3].status === "fulfilled" ? Number(reads[3].value) : REQUIRED);
    }
  } finally {
    provider.destroy();
  }
  if (validities.size === 1) baseline.maxAttestationValiditySeconds = [...validities][0];
  if (thresholds.size === 1 && [...thresholds][0] >= 2) baseline.attestationThreshold = [...thresholds][0];
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

async function main(argv) {
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
    const result = await discover(args["--node-url"], args["--chain-id"], await getReadToken(), fetch, {
      eab: args["--eab-address"], native: args["--native-address"], sourceChainId: args["--source-chain-id"],
    });
    writeJson(path.join(args["--output-dir"], "prepare.json"), result.config);
    writeJson(path.join(args["--output-dir"], "discovery.json"), { candidates: result.candidates, missing: result.missing });
    console.log(`Discovered ${result.config.eabRoutes.length} EAB and ${result.config.nativeRoutes.length} native routes. Select include:true for intended routes; ${result.missing.length} contract selections unresolved.`);
    return;
  }
  if (argv.length !== 4 || argv[0] !== "--config" || argv[2] !== "--output-dir") throw new Error("Usage: --config FILE --output-dir NEW_DIRECTORY");
  const input = JSON.parse(fs.readFileSync(argv[1], "utf8"));
  for (const name of ["eabRoutes", "nativeRoutes"]) input[name] = (input[name] || []).filter(route => route.include !== false);
  if (!input.eabRoutes.length && !input.nativeRoutes.length) throw new Error("Select at least one discovered route with include:true");
  applyDeploymentArtifacts(input, argv[1]);
  const directory = path.resolve(argv[3]);
  if (fs.existsSync(directory)) throw new Error("Output directory exists; use a new directory to preserve reviewed inputs");
  const state = await snapshot(input, await getReadToken());
  await readTargetTokenMetadata(input);
  const external = await readExternal(input, state);
  const output = prepare(input, state, external);
  const nativeBaseline = await readNativeBaseline(input, state);
  const settings = rolloutSettings(input, state);
  const findMissing = (v, name) => {
    if (v === REQUIRED) output.unresolved.push(name);
    else if (v && typeof v === "object") Object.entries(v).forEach(([key, child]) => findMissing(child, `${name}.${key}`));
  };
  findMissing(nativeBaseline, "native"); findMissing(settings, "settings");
  if (!nativeBaseline.attestationSigners.length) output.unresolved.push("native.attestationSigners");
  if (!settings.settlementVerifiers.length) output.unresolved.push("settings.settlementVerifiers");
  writeJson(path.join(directory, "source-snapshot.json"), { ...state, external });
  writeJson(path.join(directory, "settings.json"), settings);
  writeJson(path.join(directory, "policy.json"), output.policy);
  writeJson(path.join(directory, "deposit-plan.json"), output.depositPlan);
  writeJson(path.join(directory, "native-routes.json"), output.native);
  writeJson(path.join(directory, "native.json"), nativeBaseline);
  writeJson(path.join(directory, "review-required.json"), output.unresolved);
  console.log(`Prepared current-network inputs. ${output.unresolved.length} unresolved fields; no transactions submitted.`);
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { parse, lookup, prepare, snapshot, readRows, readExternal, discover, rolloutSettings, applyDeploymentArtifacts, getReadToken };
