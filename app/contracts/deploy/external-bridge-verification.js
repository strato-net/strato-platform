const normalizeAddress = (value) =>
  String(value || "").toLowerCase().replace(/^0x/, "");

const parseBool = (value) =>
  value === true || String(value).toLowerCase() === "true";

const parseValue = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const routeKey = (externalToken, chainId, stratoToken) =>
  [
    normalizeAddress(externalToken),
    String(chainId),
    normalizeAddress(stratoToken),
  ].join(":");

function requiredRoutePermissions(settings) {
  const permissions = new Map();
  for (const chain of settings.chains) {
    for (const route of chain.routes) {
      for (const [func, enabled] of [["mint", route.depositsEnabled], ["burn", route.withdrawalsEnabled]]) {
        if (!enabled) continue;
        const token = normalizeAddress(route.stratoToken);
        permissions.set(`${token}:${func}`, { token, func });
      }
    }
  }
  return [...permissions.values()];
}

async function validateRoutePermissions(settings, nodeUrl, token, fetchImpl = fetch, diagnostics) {
  const required = requiredRoutePermissions(settings);
  if (!required.length) return [];
  const rows = await cirrusSearch(nodeUrl, token, "BlockApps-AdminRegistry-whitelist", {
    address: `eq.${normalizeAddress(settings.adminRegistry)}`,
    key: `in.(${[...new Set(required.map(({ token }) => token))].join(",")})`,
    key2: "in.(mint,burn)",
    key3: `eq.${normalizeAddress(settings.bridge.address)}`,
    value: "eq.true",
    select: "key,key2,key3,value",
    limit: required.length * 2,
  }, fetchImpl);
  const granted = new Set(rows.filter((row) =>
    parseBool(row.value) && normalizeAddress(row.key3) === normalizeAddress(settings.bridge.address),
  ).map((row) => `${normalizeAddress(row.key)}:${row.key2}`));
  return required.filter(({ token, func }) => !granted.has(`${token}:${func}`))
    .map(({ token, func }) => {
      const message = `Missing bridge ${func} permission for STRATO token ${token}`;
      diagnostics?.push({ code: "TOKEN_PERMISSION_MISSING", message, governance: {
        target: settings.adminRegistry, method: "addWhitelist", arguments: { 0: token, 1: func, 2: settings.bridge.address },
      } });
      return message;
    });
}

function recordDifference(errors, diagnostics, code, message, governance) {
  errors.push(message);
  diagnostics?.push({ code, message, ...(governance ? { governance } : {}) });
}

function compareInitialization(settings, state, diagnostics) {
  const errors = [];
  const add = (code, message, governance) => recordDifference(errors, diagnostics, code, message, governance);
  const compareAddress = (label, actual, expected) => {
    if (normalizeAddress(actual) !== normalizeAddress(expected)) {
      const router = label.startsWith("TokenRouter.");
      const method = label === "ExternalAssetBridge.priceOracle" ? "setPriceOracle"
        : label === "ExternalAssetBridge.tokenRouter" ? "setTokenRouter" : "initialize";
      add("INITIALIZATION_ADDRESS_MISMATCH", `${label} mismatch: expected ${expected}, got ${actual}`, {
        target: router ? settings.tokenRouter.address : settings.bridge.address, method,
      });
    }
  };
  if (!parseBool(state.tokenRouter.initialized)) {
    add("ROUTER_UNINITIALIZED", "TokenRouter is not initialized", { target: settings.tokenRouter.address, method: "initialize" });
  }
  compareAddress(
    "TokenRouter.poolFactory",
    state.tokenRouter.poolFactory,
    settings.tokenRouter.poolFactory,
  );
  compareAddress(
    "TokenRouter.poolV3Factory",
    state.tokenRouter.poolV3Factory,
    settings.tokenRouter.poolV3Factory,
  );
  compareAddress(
    "TokenRouter.directMintPsm",
    state.tokenRouter.directMintPsm,
    settings.tokenRouter.directMintPsm,
  );
  compareAddress(
    "TokenRouter.metalForge",
    state.tokenRouter.metalForge,
    settings.tokenRouter.metalForge,
  );
  compareAddress(
    "TokenRouter.saveUsdstVault",
    state.tokenRouter.saveUsdstVault,
    settings.tokenRouter.saveUsdstVault,
  );
  for (const vault of settings.tokenRouter.yieldVaults) {
    if (!state.approvedYieldVaults.has(normalizeAddress(vault))) {
      add("YIELD_VAULT_MISSING", `TokenRouter yield vault is not approved: ${vault}`, { target: settings.tokenRouter.address, method: "setYieldVault", arguments: { 0: vault } });
    }
  }

  if (!parseBool(state.bridge.initialized)) {
    add("BRIDGE_UNINITIALIZED", "ExternalAssetBridge is not initialized", { target: settings.bridge.address, method: "initialize" });
  }
  for (const [label, actual, expected] of [
    [
      "ExternalAssetBridge.tokenFactory",
      state.bridge.tokenFactory,
      settings.bridge.tokenFactory,
    ],
    [
      "ExternalAssetBridge.bridgeOperator",
      state.bridge.bridgeOperator,
      settings.bridge.bridgeOperator,
    ],
    [
      "ExternalAssetBridge.guardian",
      state.bridge.guardian,
      settings.bridge.guardian,
    ],
    [
      "ExternalAssetBridge.USDST_ADDRESS",
      state.bridge.USDST_ADDRESS,
      settings.bridge.usdst,
    ],
    [
      "ExternalAssetBridge.priceOracle",
      state.bridge.priceOracle,
      settings.bridge.priceOracle,
    ],
    [
      "ExternalAssetBridge.tokenRouter",
      state.bridge.tokenRouter,
      settings.tokenRouter.address,
    ],
  ]) {
    compareAddress(label, actual, expected);
  }
  const expectedVerifierCount = settings.bridge.settlementVerifiers.length;
  if (Number(state.bridge.settlementVerifierCount) !== expectedVerifierCount) {
    add("VERIFIER_COUNT_MISMATCH", `Settlement verifier count must be ${expectedVerifierCount}, got ${state.bridge.settlementVerifierCount}`,
      Number(state.bridge.settlementVerifierCount) < settings.bridge.settlementVerifiers.length
        ? { target: settings.bridge.address, method: "setSettlementVerifier" } : undefined);
  }
  if (
    String(state.bridge.settlementVerifierThreshold) !==
    String(settings.bridge.settlementVerifierThreshold)
  ) {
    add("VERIFIER_THRESHOLD_MISMATCH", `Settlement verifier threshold mismatch: expected ${settings.bridge.settlementVerifierThreshold}, got ${state.bridge.settlementVerifierThreshold}`,
      { target: settings.bridge.address, method: "setSettlementVerifierThreshold" });
  }
  for (const verifier of settings.bridge.settlementVerifiers) {
    if (!state.settlementVerifiers.has(normalizeAddress(verifier))) {
      add("VERIFIER_MISSING", `Settlement verifier is not enabled: ${verifier}`, { target: settings.bridge.address, method: "setSettlementVerifier", arguments: { 0: verifier } });
    }
  }
  return errors;
}

function verifyUninitializedProxy(settings, name, targetAddress, proxyRows, logicRows) {
  const proxy = proxyRows.find((row) =>
    normalizeAddress(row.address) === normalizeAddress(targetAddress));
  if (!proxy || normalizeAddress(proxy._owner) !== normalizeAddress(settings.adminRegistry)) {
    throw new Error(`${name} state is unavailable and its AdminRegistry-owned proxy was not found`);
  }
  const logic = logicRows.find((row) =>
    normalizeAddress(row.address) === normalizeAddress(proxy.logicContract));
  if (!logic || (logic.initialized !== false && logic.initialized !== "false")) {
    throw new Error(`${name} proxy implementation state cannot prove a fresh uninitialized deployment`);
  }
  return name === "ExternalAssetBridge"
    ? {
      initialized: false,
      depositsPaused: false,
      withdrawalsPaused: false,
      settlementVerifierCount: 0,
      settlementVerifierThreshold: 0,
    }
    : { initialized: false };
}

function compareRoutes(settings, state, diagnostics) {
  const errors = [];
  const add = (code, message, method, args) => recordDifference(errors, diagnostics, code, message,
    method ? { target: settings.bridge.address, method, arguments: args } : undefined);
  const routeArgs = (route, chain) => ({ 0: route.externalToken, 1: chain.externalChainId, 2: route.stratoToken });
  for (const policy of settings.mintPolicies || []) {
    const actual = state.mintPolicies?.get(normalizeAddress(policy.token));
    if (!actual || String(actual.capacity) !== policy.capacity || String(actual.refillRate) !== policy.refillRate) add("MINT_POLICY_MISMATCH", `Mint policy mismatch for ${policy.token}`, "setMintPolicy", { 0: policy.token });
  }
  for (const expectedChain of settings.chains) {
    const actualChain = state.chains.get(String(expectedChain.externalChainId));
    if (!actualChain) {
      add("CHAIN_MISSING", `Missing chain ${expectedChain.externalChainId}`, "setChain", { 4: expectedChain.externalChainId });
      continue;
    }
    const addressFields = [
      ["vault", expectedChain.vault],
      ["depositRouter", expectedChain.depositRouter],
    ];
    for (const [field, expected] of addressFields) {
      if (normalizeAddress(actualChain[field]) !== normalizeAddress(expected)) {
        add("CHAIN_FIELD_MISMATCH", `Chain ${expectedChain.externalChainId} ${field} mismatch: expected ${expected}, got ${actualChain[field]}`, "setChain", { 4: expectedChain.externalChainId });
      }
    }
    for (const field of ["chainName", "lastProcessedBlock"]) {
      if (String(actualChain[field]) !== String(expectedChain[field])) {
        add("CHAIN_FIELD_MISMATCH", `Chain ${expectedChain.externalChainId} ${field} mismatch: expected ${expectedChain[field]}, got ${actualChain[field]}`, "setChain", { 4: expectedChain.externalChainId });
      }
    }
    if (parseBool(actualChain.enabled) !== expectedChain.enabled) {
      add("CHAIN_ENABLED_MISMATCH", `Chain ${expectedChain.externalChainId} enabled mismatch`, "setChain", { 4: expectedChain.externalChainId });
    }

    const expectedRoutes = new Set();
    for (const expectedRoute of expectedChain.routes) {
      const key = routeKey(
        expectedRoute.externalToken,
        expectedChain.externalChainId,
        expectedRoute.stratoToken,
      );
      expectedRoutes.add(key);
      const actualRoute = state.routes.get(key);
      if (!actualRoute) {
        add("ROUTE_MISSING", `Missing route ${key}`, "setRoute", routeArgs(expectedRoute, expectedChain));
        continue;
      }
      for (const field of [
        "depositsEnabled",
        "withdrawalsEnabled",
        "externalName",
        "externalSymbol",
        "externalDecimals",
        "maxPerWithdrawal",
        "manualReviewThreshold",
      ]) {
        const actual =
          field.endsWith("Enabled")
            ? parseBool(actualRoute[field])
            : String(actualRoute[field]);
        const expected =
          field.endsWith("Enabled")
            ? expectedRoute[field]
            : String(expectedRoute[field]);
        if (actual !== expected) {
          add("ROUTE_FIELD_MISMATCH", `${key} ${field} mismatch: expected ${expected}, got ${actual}`, "setRoute", routeArgs(expectedRoute, expectedChain));
        }
      }
      const actualRebase = state.rebaseRequired.has(key);
      if (actualRebase !== expectedRoute.rebaseRequired) {
        add("ROUTE_REBASE_MISMATCH", `${key} rebaseRequired mismatch: expected ${expectedRoute.rebaseRequired}, got ${actualRebase}`, "setRouteRebaseRequired", routeArgs(expectedRoute, expectedChain));
      }
    }
    for (const [key, route] of state.routes) {
      if (
        key.split(":")[1] === String(expectedChain.externalChainId) &&
        !expectedRoutes.has(key) &&
        (parseBool(route.depositsEnabled) || parseBool(route.withdrawalsEnabled))
      ) {
        add("UNEXPECTED_ENABLED_ROUTE", `Unexpected enabled route ${key}`);
      }
    }
    for (const key of state.rebaseRequired) {
      if (
        key.split(":")[1] === String(expectedChain.externalChainId) &&
        !expectedRoutes.has(key)
      ) {
        add("UNEXPECTED_REBASE_REQUIREMENT", `Unexpected rebase requirement ${key}`);
      }
    }
  }
  return errors;
}

function compareActions(settings, state, diagnostics) {
  const errors = [];
  const add = (code, message, governance) => recordDifference(errors, diagnostics, code, message, governance);
  const expectedRoutes = new Set();
  const expectedChainIds = new Set(
    settings.chains.map((chain) => String(chain.externalChainId)),
  );

  for (const chain of settings.chains) {
    for (const route of chain.routes) {
      const key = routeKey(
        route.externalToken,
        chain.externalChainId,
        route.stratoToken,
      );
      expectedRoutes.add(key);
      const actual = state.actionConfigs.get(key) || {};
      const actualAutoRoute = parseBool(actual.autoRoute);
      if (actualAutoRoute !== route.autoRouteEnabled) {
        add("AUTO_ROUTE_MISMATCH", `${key} AUTO_ROUTE mismatch: expected ${route.autoRouteEnabled}, got ${actualAutoRoute}`, {
          target: settings.bridge.address, method: "setDepositAction", arguments: { 0: route.externalToken, 1: chain.externalChainId, 2: route.stratoToken },
        });
      }
      if (parseBool(actual.autoSave)) {
        add("UNEXPECTED_AUTO_SAVE", `Unexpected AUTO_SAVE action ${key}`);
      }
      if (parseBool(actual.autoForge)) {
        add("UNEXPECTED_AUTO_FORGE", `Unexpected AUTO_FORGE action ${key}`);
      }
    }
  }

  for (const [key, actual] of state.actionConfigs) {
    if (
      expectedChainIds.has(key.split(":")[1]) &&
      !expectedRoutes.has(key) &&
      (parseBool(actual.autoRoute) ||
        parseBool(actual.autoSave) ||
        parseBool(actual.autoForge))
    ) {
      add("UNEXPECTED_DEPOSIT_ACTION", `Unexpected enabled deposit action ${key}`);
    }
  }

  return errors;
}

async function cirrusSearch(nodeUrl, token, table, params, fetchImpl = fetch) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const response = await fetchImpl(
    `${nodeUrl.replace(/\/$/, "")}/cirrus/search/${table}?${query}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    },
  );
  if (!response.ok) {
    throw new Error(
      `${table} query failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
    );
  }
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

async function validateActiveRouteTokens(
  settings,
  nodeUrl,
  token,
  fetchImpl = fetch,
) {
  const routes = settings.chains.flatMap((chain) =>
    chain.routes.filter(
      (route) => route.depositsEnabled || route.withdrawalsEnabled,
    ),
  );
  const addresses = [
    ...new Set(routes.map((route) => normalizeAddress(route.stratoToken))),
  ];
  if (!addresses.length) return [];
  const rows = await cirrusSearch(
    nodeUrl,
    token,
    "BlockApps-Token",
    {
      address: `in.(${addresses.join(",")})`,
      select: "address,status,_symbol",
      limit: addresses.length,
    },
    fetchImpl,
  );
  const statuses = new Map(
    rows.map((row) => [
      normalizeAddress(row.address),
      {
        status: Number(row.status),
        symbol: String(row._symbol || "").trim(),
      },
    ]),
  );
  return addresses.flatMap((tokenAddress) => {
    const tokenState = statuses.get(tokenAddress);
    if (tokenState?.status === 2) return [];
    return [
      `${tokenAddress}${tokenState?.symbol ? ` (${tokenState.symbol})` : ""}: status=${
        tokenState?.status ?? "NOT_FOUND"
      }`,
    ];
  });
}

async function fetchInitializationState(settings, nodeUrl, token, fetchImpl) {
  const bridgeAddress = normalizeAddress(settings.bridge.address);
  const routerAddress = normalizeAddress(settings.tokenRouter.address);
  const [bridgeRows, routerRows, verifierRows, yieldVaultRows, proxyRows] =
    await Promise.all([
      cirrusSearch(
        nodeUrl,
        token,
        "BlockApps-ExternalAssetBridge",
        {
          address: `eq.${bridgeAddress}`,
          select:
            "initialized,tokenFactory,bridgeOperator,guardian,USDST_ADDRESS,priceOracle,tokenRouter,settlementVerifierCount,settlementVerifierThreshold,depositsPaused,withdrawalsPaused",
          limit: 1,
        },
        fetchImpl,
      ),
      cirrusSearch(
        nodeUrl,
        token,
        "BlockApps-TokenRouter",
        {
          address: `eq.${routerAddress}`,
          select:
            "initialized,poolFactory,poolV3Factory,directMintPsm,metalForge,saveUsdstVault",
          limit: 1,
        },
        fetchImpl,
      ),
      cirrusSearch(
        nodeUrl,
        token,
        "BlockApps-ExternalAssetBridge-settlementVerifiers",
        {
          address: `eq.${bridgeAddress}`,
          value: "eq.true",
          select: "key",
          limit: 20000,
        },
        fetchImpl,
      ),
      cirrusSearch(
        nodeUrl,
        token,
        "BlockApps-TokenRouter-approvedYieldVaults",
        {
          address: `eq.${routerAddress}`,
          value: "eq.true",
          select: "key",
          limit: 20000,
        },
        fetchImpl,
      ),
      cirrusSearch(
        nodeUrl,
        token,
        "BlockApps-Proxy",
        {
          address: `in.(${bridgeAddress},${routerAddress})`,
          select: "address,_owner,logicContract",
          limit: 2,
        },
        fetchImpl,
      ),
    ]);
  const missing = [
    ["ExternalAssetBridge", bridgeAddress, bridgeRows],
    ["TokenRouter", routerAddress, routerRows],
  ].filter(([, , rows]) => !rows[0]);
  const logicStates = await Promise.all(missing.map(([name, targetAddress]) => {
    const proxy = proxyRows.find((row) =>
      normalizeAddress(row.address) === normalizeAddress(targetAddress));
    return proxy ? cirrusSearch(nodeUrl, token, `BlockApps-${name}`, {
      address: `eq.${normalizeAddress(proxy.logicContract)}`,
      select: "address,initialized",
      limit: 1,
    }, fetchImpl) : [];
  }));
  for (let index = 0; index < missing.length; index += 1) {
    const [name, targetAddress, rows] = missing[index];
    rows.push(verifyUninitializedProxy(settings, name, targetAddress, proxyRows, logicStates[index]));
  }
  return {
    bridge: bridgeRows[0],
    tokenRouter: routerRows[0],
    settlementVerifiers: new Set(
      verifierRows.map((row) => normalizeAddress(row.key)),
    ),
    approvedYieldVaults: new Set(
      yieldVaultRows.map((row) => normalizeAddress(row.key)),
    ),
  };
}

async function fetchRouteState(settings, nodeUrl, token, fetchImpl) {
  const bridgeAddress = normalizeAddress(settings.bridge.address);
  const chainIds = settings.chains.map((chain) => chain.externalChainId);
  const filters = {
    address: `eq.${bridgeAddress}`,
    key2: `in.(${chainIds.join(",")})`,
    select: "key,key2,key3,value",
    limit: 20000,
  };
  const [chainRows, routeRows, rebaseRows, mintRows] = await Promise.all([
    cirrusSearch(
      nodeUrl,
      token,
      "BlockApps-ExternalAssetBridge-chains",
      {
        address: `eq.${bridgeAddress}`,
        key: `in.(${chainIds.join(",")})`,
        select: "key,value",
        limit: 20000,
      },
      fetchImpl,
    ),
    cirrusSearch(
      nodeUrl,
      token,
      "BlockApps-ExternalAssetBridge-routes",
      filters,
      fetchImpl,
    ),
    cirrusSearch(
      nodeUrl,
      token,
      "BlockApps-ExternalAssetBridge-routeRebaseRequired",
      { ...filters, value: "eq.true" },
      fetchImpl,
    ),
    cirrusSearch(nodeUrl, token, "BlockApps-ExternalAssetBridge-mintPolicies", {
      address: `eq.${bridgeAddress}`, select: "key,value", limit: 20000,
    }, fetchImpl),
  ]);
  return {
    mintPolicies: new Map(mintRows.map((row) => [normalizeAddress(row.key), parseValue(row.value)])),
    chains: new Map(
      chainRows.map((row) => [String(row.key), parseValue(row.value)]),
    ),
    routes: new Map(
      routeRows.map((row) => [
        routeKey(row.key, row.key2, row.key3),
        parseValue(row.value),
      ]),
    ),
    rebaseRequired: new Set(
      rebaseRows.map((row) => routeKey(row.key, row.key2, row.key3)),
    ),
  };
}

async function fetchActionState(settings, nodeUrl, token, fetchImpl) {
  const bridgeAddress = normalizeAddress(settings.bridge.address);
  const chainIds = settings.chains.map((chain) => chain.externalChainId);
  const actionRows = await cirrusSearch(
    nodeUrl,
    token,
    "BlockApps-ExternalAssetBridge-depositActionConfigs",
    {
      address: `eq.${bridgeAddress}`,
      key2: `in.(${chainIds.join(",")})`,
      select: "key,key2,key3,value",
      limit: 20000,
    },
    fetchImpl,
  );
  return {
    actionConfigs: new Map(
      actionRows.map((row) => [
        routeKey(row.key, row.key2, row.key3),
        parseValue(row.value),
      ]),
    ),
  };
}

async function verifyConfiguration(settings, step, options) {
  const args = [
    settings,
    options.nodeUrl,
    options.token,
    options.fetchImpl,
  ];
  await validateDeploymentDependencies(...args);
  let state;
  let errors;
  if (step === "verify-initialize") {
    state = await fetchInitializationState(...args);
    errors = compareInitialization(settings, state);
  } else if (step === "verify-actions") {
    state = await fetchActionState(...args);
    errors = compareActions(settings, state);
  } else {
    state = await fetchRouteState(...args);
    errors = compareRoutes(settings, state);
    errors.push(...await validateRoutePermissions(...args));
  }
  return {
    step,
    status: errors.length ? "FAILED" : "PASSED",
    errors,
  };
}

async function validateDeploymentDependencies(settings, nodeUrl, token, fetchImpl = fetch) {
  const response = await fetchImpl(`${nodeUrl.replace(/\/$/, "")}/strato-api/eth/v1.2/metadata`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("STRATO metadata unavailable");
  const metadata = await response.json();
  if ((typeof metadata.networkID === "number" && !Number.isSafeInteger(metadata.networkID)) ||
      String(metadata.networkID) !== settings.sourceChainId) throw new Error("STRATO source chain ID mismatch");
  for (const [name, address] of [["TokenFactory", settings.bridge.tokenFactory], ["PriceOracle", settings.bridge.priceOracle], ["Token", settings.bridge.usdst]]) {
    const rows = await cirrusSearch(nodeUrl, token, `BlockApps-${name}`, {
      address: `eq.${normalizeAddress(address)}`, select: name === "Token" ? "address,status,_symbol,tokenFactory" : "address", limit: 1,
    }, fetchImpl);
    if (rows.length !== 1 || normalizeAddress(rows[0].address) !== normalizeAddress(address)) throw new Error(`${name} dependency is not deployed at ${address}`);
    if (name === "Token" && (Number(rows[0].status) !== 2 || rows[0]._symbol !== "USDST" || normalizeAddress(rows[0].tokenFactory) !== normalizeAddress(settings.bridge.tokenFactory))) throw new Error("USDST dependency must be the active USDST token");
  }
}

module.exports = {
  verifyUninitializedProxy,
  validateDeploymentDependencies,
  fetchInitializationState,
  fetchRouteState,
  fetchActionState,
  requiredRoutePermissions,
  validateRoutePermissions,
  compareInitialization,
  compareRoutes,
  compareActions,
  validateActiveRouteTokens,
  verifyConfiguration,
};
