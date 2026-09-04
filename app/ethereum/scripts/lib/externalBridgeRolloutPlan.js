const { ethers } = require("ethers");

const ZERO_ADDRESS = ethers.ZeroAddress;

const address = (value, label) => {
  try {
    const raw = String(value || "");
    return ethers.getAddress(/^[a-fA-F0-9]{40}$/.test(raw) ? `0x${raw}` : raw);
  } catch {
    throw new Error(`${label} must be a valid address`);
  }
};

const uint = (value, label) => {
  const normalized = String(value ?? "");
  if (!/^[0-9]+$/.test(normalized)) {
    throw new Error(`${label} must be an unsigned integer`);
  }
  return normalized;
};

const keyAddress = (value) => address(value, "address").toLowerCase();
const routeKey = (token, target) =>
  `${keyAddress(token)}:${keyAddress(target)}`;

function collectInventory(depositPlan, chainId) {
  const operation = (depositPlan.operations || []).find(
    (item) => Number(item.chainId) === Number(chainId),
  );
  if (!operation) {
    throw new Error(`DepositRouter plan has no operation for chain ${chainId}`);
  }

  const routes = new Map();
  for (const transaction of operation.transactions || []) {
    for (const item of transaction.meta?.items || []) {
      if (!item.isPermitted) continue;
      const token = address(item.token, "DepositRouter token");
      const target = address(item.target, "DepositRouter target");
      const externalDecimals = uint(
        item.externalDecimals,
        `externalDecimals for ${token}`,
      );
      const externalName = String(item.externalName || "").trim();
      const externalSymbol = String(item.externalSymbol || "").trim();
      if (!externalName || !externalSymbol) {
        throw new Error(`Missing external metadata for ${token}`);
      }
      routes.set(routeKey(token, target), {
        externalToken: token,
        stratoToken: target,
        externalDecimals,
        externalName,
        externalSymbol,
        legacyStratoMaxPerWithdrawal: String(
          item.legacyStratoMaxPerWithdrawal ?? "",
        ),
      });
    }
  }
  if (!routes.size) {
    throw new Error(`DepositRouter plan has no enabled routes for chain ${chainId}`);
  }
  return [...routes.values()].sort((left, right) =>
    routeKey(left.externalToken, left.stratoToken).localeCompare(
      routeKey(right.externalToken, right.stratoToken),
    ),
  );
}

function buildPolicyTemplate(inventory, chainId) {
  const tokens = {};
  const routes = {};
  for (const route of inventory) {
    const token = keyAddress(route.externalToken);
    tokens[token] ||= {
      minDepositAmount: "REVIEW_REQUIRED",
      maxPerWithdrawal: "REVIEW_REQUIRED",
      manualReviewThreshold: "REVIEW_REQUIRED",
      windowLimit: "REVIEW_REQUIRED",
      windowSeconds: "86400",
      migrateAmount: "0",
      enabled: true,
    };
    routes[routeKey(route.externalToken, route.stratoToken)] = {
      depositsEnabled: true,
      withdrawalsEnabled: false,
      rebaseRequired: false,
      autoRouteEnabled: false,
    };
  }
  return {
    chainId: Number(chainId),
    lastProcessedBlock: "REVIEW_REQUIRED",
    tokens,
    routes,
  };
}

function tokenPolicy(policy, token) {
  const key = keyAddress(token);
  const value = policy.tokens?.[key];
  if (!value) throw new Error(`Missing token policy for ${key}`);
  const normalized = {
    minDepositAmount: uint(
      value.minDepositAmount,
      `${key}.minDepositAmount`,
    ),
    maxPerWithdrawal: uint(
      value.maxPerWithdrawal,
      `${key}.maxPerWithdrawal`,
    ),
    manualReviewThreshold: uint(
      value.manualReviewThreshold,
      `${key}.manualReviewThreshold`,
    ),
    windowLimit: uint(value.windowLimit, `${key}.windowLimit`),
    windowSeconds: uint(value.windowSeconds, `${key}.windowSeconds`),
    migrateAmount: uint(value.migrateAmount ?? 0, `${key}.migrateAmount`),
    enabled: value.enabled !== false,
  };
  if (BigInt(normalized.minDepositAmount) > (1n << 96n) - 1n) {
    throw new Error(`${key}.minDepositAmount exceeds uint96`);
  }
  if (
    BigInt(normalized.windowLimit) > 0n &&
    BigInt(normalized.windowSeconds) === 0n
  ) {
    throw new Error(`${key}.windowSeconds must be positive`);
  }
  return normalized;
}

function routePolicy(policy, route) {
  const key = routeKey(route.externalToken, route.stratoToken);
  const value = policy.routes?.[key];
  if (!value) throw new Error(`Missing route policy for ${key}`);
  for (const field of [
    "depositsEnabled",
    "withdrawalsEnabled",
    "rebaseRequired",
    "autoRouteEnabled",
  ]) {
    if (typeof value[field] !== "boolean") {
      throw new Error(`${key}.${field} must be boolean`);
    }
  }
  return value;
}

function selectedChain(config, chainId, label) {
  const chain = (config.chains || []).find(
    (item) =>
      Number(item.externalChainId ?? item.chainId) === Number(chainId),
  );
  if (!chain) throw new Error(`${label} has no chain ${chainId}`);
  return chain;
}

function buildSynchronizedRollout({
  depositPlan,
  bridgeTemplate,
  vaultTemplate,
  policy,
  chainId,
}) {
  if (Number(policy.chainId) !== Number(chainId)) {
    throw new Error(`Policy chainId must be ${chainId}`);
  }
  const inventory = collectInventory(depositPlan, chainId);
  const bridgeChain = selectedChain(
    bridgeTemplate,
    chainId,
    "ExternalAssetBridge template",
  );
  const vaultChain = selectedChain(
    vaultTemplate,
    chainId,
    "ExternalBridgeVault template",
  );
  const lastProcessedBlock = uint(
    policy.lastProcessedBlock,
    "lastProcessedBlock",
  );

  const depositRouterUpdates = [];
  const bridgeRoutes = [];
  const vaultTokens = new Map();
  if (
    keyAddress(bridgeChain.vault) !== keyAddress(vaultChain.vaultAddress) ||
    keyAddress(bridgeChain.depositRouter) !==
      keyAddress(vaultChain.depositRouterAddress)
  ) {
    throw new Error("Bridge and vault templates reference different deployments");
  }
  if (
    keyAddress(vaultTemplate.sourceBridge) !==
    keyAddress(bridgeTemplate.externalAssetBridge?.address)
  ) {
    throw new Error("Vault sourceBridge does not match ExternalAssetBridge");
  }

  for (const route of inventory) {
    const token = tokenPolicy(policy, route.externalToken);
    const routeSettings = routePolicy(policy, route);
    if (routeSettings.withdrawalsEnabled && !token.enabled) {
      throw new Error(
        `Withdrawal route ${routeKey(
          route.externalToken,
          route.stratoToken,
        )} requires an enabled vault token policy`,
      );
    }
    depositRouterUpdates.push({
      token: route.externalToken,
      targetStratoToken: route.stratoToken,
      minDepositAmount: token.minDepositAmount,
      permitted: true,
    });
    bridgeRoutes.push({
      externalToken: route.externalToken.slice(2).toLowerCase(),
      stratoToken: route.stratoToken.slice(2).toLowerCase(),
      depositsEnabled: routeSettings.depositsEnabled,
      withdrawalsEnabled: routeSettings.withdrawalsEnabled,
      externalDecimals: route.externalDecimals,
      externalName: route.externalName,
      externalSymbol: route.externalSymbol,
      maxPerWithdrawal: token.maxPerWithdrawal,
      manualReviewThreshold: token.manualReviewThreshold,
      rebaseRequired: routeSettings.rebaseRequired,
      autoRouteEnabled: routeSettings.autoRouteEnabled,
    });
    vaultTokens.set(keyAddress(route.externalToken), {
      token:
        route.externalToken === ZERO_ADDRESS
          ? ZERO_ADDRESS
          : route.externalToken,
      enabled: token.enabled,
      maxPerWithdrawal: token.maxPerWithdrawal,
      windowLimit: token.windowLimit,
      windowSeconds: token.windowSeconds,
      manualReviewThreshold: token.manualReviewThreshold,
      migrateAmount: token.migrateAmount,
    });
  }

  const bridgeConfig = {
    ...bridgeTemplate,
    chains: (bridgeTemplate.chains || []).map((chain) =>
      Number(chain.externalChainId) === Number(chainId)
        ? { ...chain, lastProcessedBlock, routes: bridgeRoutes }
        : chain,
    ),
  };
  const vaultConfig = {
    ...vaultTemplate,
    chains: (vaultTemplate.chains || []).map((chain) =>
      Number(chain.chainId) === Number(chainId)
        ? { ...chain, tokens: [...vaultTokens.values()] }
        : chain,
    ),
  };

  return {
    chainId: Number(chainId),
    inventory,
    depositRouter: {
      address: address(
        vaultChain.depositRouterAddress,
        "depositRouterAddress",
      ),
      safeAddress: address(vaultChain.safeAddress, "safeAddress"),
      updates: depositRouterUpdates,
    },
    bridgeConfig,
    vaultConfig,
    summary: {
      routeCount: inventory.length,
      externalTokenCount: vaultTokens.size,
      depositsEnabledCount: bridgeRoutes.filter(
        (route) => route.depositsEnabled,
      ).length,
      withdrawalsEnabledCount: bridgeRoutes.filter(
        (route) => route.withdrawalsEnabled,
      ).length,
      autoRouteEnabledCount: bridgeRoutes.filter(
        (route) => route.autoRouteEnabled,
      ).length,
    },
  };
}

module.exports = {
  collectInventory,
  buildPolicyTemplate,
  buildSynchronizedRollout,
};
