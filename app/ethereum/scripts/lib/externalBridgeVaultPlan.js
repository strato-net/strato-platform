const { ethers } = require("ethers");

const ZERO_ADDRESS = ethers.ZeroAddress;

function asAddress(value, field, { allowZero = false } = {}) {
  let address;
  try {
    address = ethers.getAddress(String(value || ""));
  } catch {
    throw new Error(`${field} must be a valid address`);
  }
  if (!allowZero && address === ZERO_ADDRESS) {
    throw new Error(`${field} must not be the zero address`);
  }
  return address;
}

function asUint(value, field, { positive = false } = {}) {
  let parsed;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${field} must be an unsigned integer`);
  }
  if (parsed < 0n || (positive && parsed === 0n)) {
    throw new Error(`${field} must be ${positive ? "positive" : "non-negative"}`);
  }
  return parsed;
}

function normalizeConfig(input) {
  const sourceChainId = asUint(input.sourceChainId, "sourceChainId", {
    positive: true,
  });
  const sourceBridge = asAddress(input.sourceBridge, "sourceBridge");
  if (!Array.isArray(input.chains) || input.chains.length === 0) {
    throw new Error("chains must contain at least one chain");
  }

  const seenChains = new Set();
  const chains = input.chains.map((chain, chainIndex) => {
    const prefix = `chains[${chainIndex}]`;
    const chainId = Number(chain.chainId);
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new Error(`${prefix}.chainId must be a positive safe integer`);
    }
    if (seenChains.has(chainId)) {
      throw new Error(`Duplicate chainId ${chainId}`);
    }
    seenChains.add(chainId);

    const attestationSigners = (chain.attestationSigners || []).map(
      (address, index) =>
        asAddress(address, `${prefix}.attestationSigners[${index}]`),
    );
    const disabledAttestationSigners = (
      chain.disabledAttestationSigners || []
    ).map((address, index) =>
      asAddress(address, `${prefix}.disabledAttestationSigners[${index}]`),
    );
    if (
      new Set(attestationSigners.map((address) => address.toLowerCase())).size !==
      attestationSigners.length
    ) {
      throw new Error(`${prefix}.attestationSigners contains duplicates`);
    }
    if (attestationSigners.length > 255) {
      throw new Error(`${prefix}.attestationSigners exceeds 255 signers`);
    }
    const activeSignerSet = new Set(
      attestationSigners.map((address) => address.toLowerCase()),
    );
    if (
      disabledAttestationSigners.some((address) =>
        activeSignerSet.has(address.toLowerCase()),
      )
    ) {
      throw new Error(
        `${prefix}.disabledAttestationSigners overlaps active signers`,
      );
    }
    const threshold = Number(chain.attestationThreshold);
    if (
      !Number.isSafeInteger(threshold) ||
      threshold <= 0 ||
      threshold > 255 ||
      threshold > attestationSigners.length
    ) {
      throw new Error(
        `${prefix}.attestationThreshold must be between 1 and the configured signer count`,
      );
    }

    const tokens = (chain.tokens || []).map((token, tokenIndex) => {
      const tokenPrefix = `${prefix}.tokens[${tokenIndex}]`;
      if (typeof token.enabled !== "boolean") {
        throw new Error(`${tokenPrefix}.enabled must be a boolean`);
      }
      const normalizedToken = {
        token: asAddress(token.token, `${tokenPrefix}.token`, {
          allowZero: true,
        }),
        enabled: token.enabled,
        maxPerWithdrawal: asUint(
          token.maxPerWithdrawal,
          `${tokenPrefix}.maxPerWithdrawal`,
        ),
        windowLimit: asUint(
          token.windowLimit,
          `${tokenPrefix}.windowLimit`,
        ),
        windowSeconds: asUint(
          token.windowSeconds,
          `${tokenPrefix}.windowSeconds`,
        ),
        manualReviewThreshold: asUint(
          token.manualReviewThreshold,
          `${tokenPrefix}.manualReviewThreshold`,
        ),
        migrateAmount: asUint(
          token.migrateAmount || 0,
          `${tokenPrefix}.migrateAmount`,
        ),
      };
      if (
        normalizedToken.windowLimit > 0n &&
        normalizedToken.windowSeconds === 0n
      ) {
        throw new Error(
          `${tokenPrefix}.windowSeconds must be positive when windowLimit is set`,
        );
      }
      return normalizedToken;
    });
    if (
      new Set(tokens.map(({ token }) => token.toLowerCase())).size !==
      tokens.length
    ) {
      throw new Error(`${prefix}.tokens contains duplicate token addresses`);
    }

    return {
      chainId,
      safeAddress: asAddress(chain.safeAddress, `${prefix}.safeAddress`),
      guardianAddress: asAddress(
        chain.guardianAddress,
        `${prefix}.guardianAddress`,
      ),
      vaultAddress: asAddress(chain.vaultAddress, `${prefix}.vaultAddress`),
      depositRouterAddress: asAddress(
        chain.depositRouterAddress,
        `${prefix}.depositRouterAddress`,
      ),
      attestationSigners,
      disabledAttestationSigners,
      attestationThreshold: threshold,
      maxAuthorizationValiditySeconds: asUint(
        chain.maxAuthorizationValiditySeconds || 1800,
        `${prefix}.maxAuthorizationValiditySeconds`,
        { positive: true },
      ),
      tokens,
    };
  });

  return { sourceChainId, sourceBridge, chains };
}

function buildOperations(config, chain) {
  const configure = [
    {
      target: chain.vaultAddress,
      method: "setSourceBridge",
      args: [config.sourceChainId, config.sourceBridge, true],
      value: 0n,
    },
    ...chain.attestationSigners.map((signer) => ({
      target: chain.vaultAddress,
      method: "setAttestationSigner",
      args: [signer, true],
      value: 0n,
    })),
    {
      target: chain.vaultAddress,
      method: "setAttestationThreshold",
      args: [chain.attestationThreshold],
      value: 0n,
    },
    ...chain.disabledAttestationSigners.map((signer) => ({
      target: chain.vaultAddress,
      method: "setAttestationSigner",
      args: [signer, false],
      value: 0n,
    })),
    {
      target: chain.vaultAddress,
      method: "setMaxAuthorizationValiditySeconds",
      args: [chain.maxAuthorizationValiditySeconds],
      value: 0n,
    },
    ...chain.tokens.map((token) => ({
      target: chain.vaultAddress,
      method: "setTokenPolicy",
      args: [
        token.token,
        token.enabled,
        token.maxPerWithdrawal,
        token.windowLimit,
        token.windowSeconds,
        token.manualReviewThreshold,
      ],
      value: 0n,
    })),
  ];
  const router = [{
    target: chain.depositRouterAddress,
    method: "setExternalBridgeVault",
    args: [chain.vaultAddress],
    value: 0n,
  }];
  const liquidity = chain.tokens
    .filter((token) => token.migrateAmount > 0n)
    .map((token) =>
      token.token === ZERO_ADDRESS
        ? {
            target: chain.vaultAddress,
            method: "transferNative",
            args: [],
            value: token.migrateAmount,
          }
        : {
            target: token.token,
            method: "transfer",
            args: [chain.vaultAddress, token.migrateAmount],
            value: 0n,
          },
    );

  return { configure, router, liquidity };
}

function getServiceSignerAddresses(chainId, env = process.env) {
  const envVar = `CHAIN_${chainId}_EXTERNAL_BRIDGE_SIGNER_ADDRESSES`;
  return String(env[envVar] || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean)
    .map((address, index) => ({
      envVar: `${envVar}[${index}]`,
      address: ethers.getAddress(address),
    }));
}

function getServiceExecutor(chainId, env = process.env) {
  const prefix = `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR`;
  const kmsAddress = String(env[`${prefix}_ADDRESS`] || "").trim();
  const kmsUrl = String(env[`${prefix}_KMS_URL`] || "").trim();
  const kmsApiToken = String(env[`${prefix}_KMS_API_TOKEN`] || "").trim();
  const privateKey = String(env[`${prefix}_PRIVATE_KEY`] || "").trim();

  if (kmsAddress || kmsUrl || kmsApiToken) {
    const errors = [];
    if (!kmsAddress) errors.push(`${prefix}_ADDRESS`);
    if (!kmsUrl) errors.push(`${prefix}_KMS_URL`);
    let address = null;
    if (kmsAddress) {
      try {
        address = ethers.getAddress(kmsAddress);
      } catch {
        errors.push(`${prefix}_ADDRESS`);
      }
    }
    return {
      source: "kms",
      address,
      valid: errors.length === 0,
      errors,
    };
  }

  if (!privateKey) {
    return {
      source: "privateKey",
      address: null,
      valid: false,
      errors: [`${prefix}_PRIVATE_KEY`],
    };
  }

  try {
    return {
      source: "privateKey",
      address: new ethers.Wallet(
        privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`,
      ).address,
      valid: true,
      errors: [],
    };
  } catch {
    return {
      source: "privateKey",
      address: null,
      valid: false,
      errors: [`${prefix}_PRIVATE_KEY`],
    };
  }
}

function validateServiceSigners(chain, env = process.env) {
  const configured = getServiceSignerAddresses(chain.chainId, env);
  const executor = getServiceExecutor(chain.chainId, env);
  const executorAddress = executor.address;
  const expected = new Set(
    chain.attestationSigners.map((address) => address.toLowerCase()),
  );
  const actual = new Set(
    configured.map(({ address }) => address.toLowerCase()),
  );
  return {
    valid:
      actual.size >= chain.attestationThreshold &&
      [...actual].every((address) => expected.has(address)) &&
      executorAddress !== null &&
      executor.valid &&
      !expected.has(executorAddress.toLowerCase()),
    threshold: chain.attestationThreshold,
    configured: configured.map(({ envVar, address }) => ({ envVar, address })),
    missingSignerCount: Math.max(0, chain.attestationThreshold - actual.size),
    unexpectedAddresses: [...actual].filter((address) => !expected.has(address)),
    executorAddress,
    executorConfigSource: executor.source,
    executorConfigErrors: executor.errors,
    executorIsSigner:
      executorAddress !== null && expected.has(executorAddress.toLowerCase()),
  };
}

module.exports = {
  ZERO_ADDRESS,
  normalizeConfig,
  buildOperations,
  getServiceSignerAddresses,
  getServiceExecutor,
  validateServiceSigners,
};
