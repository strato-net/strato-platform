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

async function validateRoutePermissions(settings, nodeUrl, token, fetchImpl = fetch) {
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
    .map(({ token, func }) => `Missing bridge ${func} permission for STRATO token ${token}`);
}

function compareInitialization(settings, state) {
  const errors = [];
  const compareAddress = (label, actual, expected) => {
    if (normalizeAddress(actual) !== normalizeAddress(expected)) {
      errors.push(`${label} mismatch: expected ${expected}, got ${actual}`);
    }
  };
  if (!parseBool(state.tokenRouter.initialized)) {
    errors.push("TokenRouter is not initialized");
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
      errors.push(`TokenRouter yield vault is not approved: ${vault}`);
    }
  }

  if (!parseBool(state.bridge.initialized)) {
    errors.push("ExternalAssetBridge is not initialized");
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
  if (Number(state.bridge.settlementVerifierCount) !== 3) {
    errors.push(
      `Settlement verifier count must be 3, got ${state.bridge.settlementVerifierCount}`,
    );
  }
  if (
    String(state.bridge.settlementVerifierThreshold) !==
    String(settings.bridge.settlementVerifierThreshold)
  ) {
    errors.push(
      `Settlement verifier threshold mismatch: expected ${settings.bridge.settlementVerifierThreshold}, got ${state.bridge.settlementVerifierThreshold}`,
    );
  }
  for (const verifier of settings.bridge.settlementVerifiers) {
    if (!state.settlementVerifiers.has(normalizeAddress(verifier))) {
      errors.push(`Settlement verifier is not enabled: ${verifier}`);
    }
  }
  return errors;
}

function compareRoutes(settings, state) {
  const errors = [];
  for (const expectedChain of settings.chains) {
    const actualChain = state.chains.get(String(expectedChain.externalChainId));
    if (!actualChain) {
      errors.push(`Missing chain ${expectedChain.externalChainId}`);
      continue;
    }
    const addressFields = [
      ["vault", expectedChain.vault],
      ["depositRouter", expectedChain.depositRouter],
    ];
    for (const [field, expected] of addressFields) {
      if (normalizeAddress(actualChain[field]) !== normalizeAddress(expected)) {
        errors.push(
          `Chain ${expectedChain.externalChainId} ${field} mismatch: expected ${expected}, got ${actualChain[field]}`,
        );
      }
    }
    for (const field of ["chainName", "lastProcessedBlock"]) {
      if (String(actualChain[field]) !== String(expectedChain[field])) {
        errors.push(
          `Chain ${expectedChain.externalChainId} ${field} mismatch: expected ${expectedChain[field]}, got ${actualChain[field]}`,
        );
      }
    }
    if (parseBool(actualChain.enabled) !== expectedChain.enabled) {
      errors.push(`Chain ${expectedChain.externalChainId} enabled mismatch`);
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
        errors.push(`Missing route ${key}`);
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
          errors.push(
            `${key} ${field} mismatch: expected ${expected}, got ${actual}`,
          );
        }
      }
      const actualRebase = state.rebaseRequired.has(key);
      if (actualRebase !== expectedRoute.rebaseRequired) {
        errors.push(
          `${key} rebaseRequired mismatch: expected ${expectedRoute.rebaseRequired}, got ${actualRebase}`,
        );
      }
    }
    for (const [key, route] of state.routes) {
      if (
        key.split(":")[1] === String(expectedChain.externalChainId) &&
        !expectedRoutes.has(key) &&
        (parseBool(route.depositsEnabled) || parseBool(route.withdrawalsEnabled))
      ) {
        errors.push(`Unexpected enabled route ${key}`);
      }
    }
    for (const key of state.rebaseRequired) {
      if (
        key.split(":")[1] === String(expectedChain.externalChainId) &&
        !expectedRoutes.has(key)
      ) {
        errors.push(`Unexpected rebase requirement ${key}`);
      }
    }
  }
  return errors;
}

function compareActions(settings, state) {
  const errors = [];
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
        errors.push(
          `${key} AUTO_ROUTE mismatch: expected ${route.autoRouteEnabled}, got ${actualAutoRoute}`,
        );
      }
      if (parseBool(actual.autoSave)) {
        errors.push(`Unexpected AUTO_SAVE action ${key}`);
      }
      if (parseBool(actual.autoForge)) {
        errors.push(`Unexpected AUTO_FORGE action ${key}`);
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
      errors.push(`Unexpected enabled deposit action ${key}`);
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
  const [bridgeRows, routerRows, verifierRows, yieldVaultRows] =
    await Promise.all([
      cirrusSearch(
        nodeUrl,
        token,
        "BlockApps-ExternalAssetBridge",
        {
          address: `eq.${bridgeAddress}`,
          select:
            "initialized,tokenFactory,bridgeOperator,guardian,USDST_ADDRESS,priceOracle,tokenRouter,settlementVerifierCount,settlementVerifierThreshold",
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
    ]);
  if (!bridgeRows[0] || !routerRows[0]) {
    throw new Error("Initialized bridge or TokenRouter state is unavailable");
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
  const [chainRows, routeRows, rebaseRows] = await Promise.all([
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
  ]);
  return {
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

module.exports = {
  requiredRoutePermissions,
  validateRoutePermissions,
  compareInitialization,
  compareRoutes,
  compareActions,
  validateActiveRouteTokens,
  verifyConfiguration,
};
