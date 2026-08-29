import { logInfo, logError } from "./logger";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  getEnabledChains,
  getEnabledNativeChainIds,
  getTokenRouterWiring,
} from "../services/cirrusService";
import {
  config,
  getExternalBridgeExecutorPrivateKey,
  getExternalBridgeSignerUrls,
  getNativeBridgePrivateKeys,
} from "../config";
import { ensureHexPrefix } from "./utils";

const isPrivateKey = (value: string): boolean =>
  /^(0x)?[a-fA-F0-9]{64}$/.test(value);

const REPRESENTATION_BRIDGE_ABI = [
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
];

const EXTERNAL_VAULT_ABI = [
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
];

const isAddress = (value: string): boolean =>
  /^(0x)?[a-fA-F0-9]{40}$/.test(value);

const normalizePrivateKey = (value: string): string =>
  value.startsWith("0x") ? value : `0x${value}`;

export async function validateBridgeConfig(): Promise<boolean> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate required environment variables
  const requiredEnvVars = [
    "BA_USERNAME",
    "BA_PASSWORD",
    "CLIENT_SECRET",
    "CLIENT_ID",
    "OPENID_DISCOVERY_URL",
    "BRIDGE_ADDRESS",
    "EXTERNAL_ASSET_BRIDGE_ADDRESS",
    "STRATO_APP_API_URL",
    "TOKEN_ROUTER",
    "SAFE_ADDRESS",
    "SAFE_PROPOSER_ADDRESS",
    "SAFE_PROPOSER_PRIVATE_KEY",
  ];

  requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  });
  if (
    !["development", "test"].includes(process.env.NODE_ENV || "") &&
    !process.env.DEPOSIT_WEBHOOK_TOKEN
  ) {
    errors.push("Missing required environment variable: DEPOSIT_WEBHOOK_TOKEN");
  }
  if (
    !["development", "test"].includes(process.env.NODE_ENV || "") &&
    !process.env.DEPOSIT_OPERATIONS_TOKEN
  ) {
    errors.push("Missing required environment variable: DEPOSIT_OPERATIONS_TOKEN");
  }

  // Initialize OAuth first (required for chain/asset validation)
  let oauthInitialized = false;
  if (
    process.env.OPENID_DISCOVERY_URL &&
    process.env.CLIENT_ID &&
    process.env.CLIENT_SECRET
  ) {
    try {
      // Test OAuth discovery URL
      const response = await fetch(process.env.OPENID_DISCOVERY_URL);
      if (!response.ok) {
        errors.push(
          `OAuth discovery failed with status ${response.status}: ${response.statusText}`,
        );
      } else {
        const discovery = (await response.json()) as any;
        if (!discovery.jwks_uri || !discovery.issuer) {
          errors.push(
            "OAuth discovery response is invalid - missing jwks_uri or issuer",
          );
        } else {
          // Test actual user authentication
          try {
            const { initOpenIdConfig, getBAUserToken } = await import(
              "../auth"
            );

            // Initialize OAuth
            await initOpenIdConfig();
            oauthInitialized = true;

            // Test user authentication by getting a token
            const token = await getBAUserToken();
            if (!token) {
              errors.push("User authentication failed - no token received");
            } else {
              logInfo("ConfigValidator", "User authentication test passed");
            }
          } catch (authError) {
            errors.push(
              `User authentication error: ${(authError as Error).message}`,
            );
          }
        }
      }
    } catch (error) {
      errors.push(`OAuth discovery error: ${(error as Error).message}`);
    }
  } else {
    errors.push("Incomplete OAuth configuration");
  }

  // Validate bridge contract address format
  if (config.bridge.address) {
    if (!/^(0x)?[a-fA-F0-9]{40}$/.test(config.bridge.address)) {
      errors.push(
        `Invalid bridge contract address format: ${config.bridge.address}`,
      );
    }
  }

  if (
    config.externalAssetBridge.address &&
    !isAddress(config.externalAssetBridge.address)
  ) {
    errors.push(
      `Invalid external asset bridge address format: ${config.externalAssetBridge.address}`,
    );
  }
  if (config.tokenRouter.address && !isAddress(config.tokenRouter.address)) {
    errors.push(
      `Invalid TokenRouter address format: ${config.tokenRouter.address}`,
    );
  }
  if (oauthInitialized && config.tokenRouter.address) {
    try {
      const wiring = await getTokenRouterWiring();
      const expected = config.tokenRouter.address.toLowerCase().replace(/^0x/, "");
      const configured = wiring.bridgeTokenRouter
        ?.toLowerCase()
        .replace(/^0x/, "");
      if (configured !== expected) {
        errors.push(
          "ExternalAssetBridge.tokenRouter does not match TOKEN_ROUTER",
        );
      }
      if (!wiring.initialized) {
        errors.push("Configured TokenRouter is not initialized");
      }
    } catch (error) {
      errors.push(
        `TokenRouter wiring validation failed: ${(error as Error).message}`,
      );
    }
  }
  if (
    !Number.isSafeInteger(
      config.externalAssetBridge.manualReviewValiditySeconds,
    ) ||
    config.externalAssetBridge.manualReviewValiditySeconds <= 0
  ) {
    errors.push(
      "EXTERNAL_BRIDGE_MANUAL_REVIEW_VALIDITY_SECONDS must be a positive integer",
    );
  }

  // Validate Safe wallet configuration
  if (config.safe.address) {
    if (!/^(0x)?[a-fA-F0-9]{40}$/.test(config.safe.address)) {
      errors.push(`Invalid Safe wallet address format: ${config.safe.address}`);
    }
  }

  if (config.safe.safeProposerAddress) {
    if (!/^(0x)?[a-fA-F0-9]{40}$/.test(config.safe.safeProposerAddress)) {
      errors.push(
        `Invalid Safe proposer address format: ${config.safe.safeProposerAddress}`,
      );
    }
  }

  if (config.safe.safeProposerPrivateKey) {
    if (!isPrivateKey(config.safe.safeProposerPrivateKey)) {
      errors.push(
        "Invalid Safe proposer private key format",
      );
    }
  }

  if (config.safe.apiKey) {
    if (!/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(config.safe.apiKey)) {
      errors.push(
        `Invalid Safe API key format: ${config.safe.apiKey.substring(0, 10)}...`,
      );
    }
  }

  // Validate voucher contract address format
  if (config.voucher.contractAddress) {
    if (!/^(0x)?[a-fA-F0-9]{40}$/.test(config.voucher.contractAddress)) {
      errors.push(
        `Invalid voucher contract address format: ${config.voucher.contractAddress}`,
      );
    }
  }

  // Validate polling intervals
  if (config.polling.bridgeInInterval < 10000) {
    warnings.push(
      "Bridge-in polling interval is very short (< 10s) - may cause rate limiting",
    );
  }

  if (config.polling.bridgeOutInterval < 30000) {
    warnings.push(
      "Bridge-out polling interval is very short (< 30s) - may cause rate limiting",
    );
  }

  if (config.polling.withdrawalInterval < 5000) {
    warnings.push(
      "Withdrawal polling interval is very short (< 5s) - may cause rate limiting",
    );
  }
  const missingReceiptGraceMs = Number(
    process.env.DEPOSIT_MISSING_RECEIPT_GRACE_MS || 5 * 60 * 1000,
  );
  if (
    !Number.isSafeInteger(missingReceiptGraceMs) ||
    missingReceiptGraceMs <= 0
  ) {
    errors.push("DEPOSIT_MISSING_RECEIPT_GRACE_MS must be a positive integer");
  }
  const settlementRetryGraceMs = Number(
    process.env.DEPOSIT_SETTLEMENT_RETRY_GRACE_MS || 15 * 60 * 1000,
  );
  if (
    !Number.isSafeInteger(settlementRetryGraceMs) ||
    settlementRetryGraceMs <= 0
  ) {
    errors.push("DEPOSIT_SETTLEMENT_RETRY_GRACE_MS must be a positive integer");
  }
  const reviewRecordRetryMs = Number(
    process.env.DEPOSIT_REVIEW_RECORD_RETRY_MS || 60 * 1000,
  );
  if (
    !Number.isSafeInteger(reviewRecordRetryMs) ||
    reviewRecordRetryMs <= 0
  ) {
    errors.push("DEPOSIT_REVIEW_RECORD_RETRY_MS must be a positive integer");
  }

  // Validate chain RPC URLs (only if OAuth is initialized)
  if (oauthInitialized) {
    try {
      const enabledChainsArr = Array.from((await getEnabledChains()).values());
      const missingChainRpcUrls: string[] = [];

      for (const chainInfo of enabledChainsArr) {
        const externalChainId = chainInfo?.externalChainId;
        if (!externalChainId) {
          continue;
        }

        const envVarName = `CHAIN_${externalChainId}_RPC_URL`;

        if (!process.env[envVarName]) {
          missingChainRpcUrls.push(envVarName);
        } else {
          // Test RPC URL accessibility
          try {
            const rpcUrl = process.env[envVarName]!;
            const response = await fetch(rpcUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_blockNumber",
                params: [],
              }),
            });

            if (!response.ok) {
              throw new Error(
                `HTTP ${response.status}: ${response.statusText}`,
              );
            }

            const result = (await response.json()) as any;
            if (result.error) {
              throw new Error(
                `RPC Error: ${result.error.message || JSON.stringify(result.error)}`,
              );
            }
          } catch (error) {
            warnings.push(
              `RPC URL for chain ${externalChainId} is not accessible: ${(error as Error).message}`,
            );
          }
        }
      }

      if (missingChainRpcUrls.length > 0) {
        errors.push(
          `Missing RPC URL environment variables for enabled chains: ${missingChainRpcUrls.join(", ")}`,
        );
      }

      logInfo(
        "ConfigValidator",
        `Found ${enabledChainsArr.length} enabled chains`,
      );

      for (const chain of enabledChainsArr) {
        const chainId = chain.externalChainId;
        const confirmationValue =
          process.env[`CHAIN_${chainId}_DEPOSIT_CONFIRMATIONS`];
        if (
          process.env.NODE_ENV === "production" &&
          (!confirmationValue ||
            !Number.isSafeInteger(Number(confirmationValue)) ||
            Number(confirmationValue) <= 0)
        ) {
          errors.push(
            `CHAIN_${chainId}_DEPOSIT_CONFIRMATIONS must be an explicit positive integer in production`,
          );
        }
        const signerUrls = getExternalBridgeSignerUrls(chainId);
        const executorPrivateKey = getExternalBridgeExecutorPrivateKey(chainId);
        if (signerUrls.length === 0) {
          errors.push(
            `Missing external bridge environment variable: CHAIN_${chainId}_EXTERNAL_BRIDGE_SIGNER_URLS`,
          );
        }
        if (!executorPrivateKey || !isPrivateKey(executorPrivateKey)) {
          errors.push(
            `Missing or invalid external bridge executor key: CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR_PRIVATE_KEY`,
          );
        }
        if (!chain.vault || !isAddress(chain.vault)) {
          errors.push(`Invalid external bridge vault for chain ${chainId}`);
          continue;
        }

        const rpcUrl = process.env[`CHAIN_${chainId}_RPC_URL`];
        if (!rpcUrl || signerUrls.length === 0) continue;

        try {
          const vault = new Contract(
            chain.vault,
            EXTERNAL_VAULT_ABI,
            new JsonRpcProvider(rpcUrl),
          );
          const signerMetadata = await Promise.all(
            signerUrls.map(async (url) => {
              const response = await fetch(`${url}/health`, {
                headers: process.env.EXTERNAL_BRIDGE_SIGNER_API_TOKEN
                  ? {
                      Authorization: `Bearer ${process.env.EXTERNAL_BRIDGE_SIGNER_API_TOKEN}`,
                    }
                  : undefined,
              });
              if (!response.ok) {
                throw new Error(`Signer ${url} health returned ${response.status}`);
              }
              return (await response.json()) as {
                signer: string;
                destinationChainId: string;
                destinationVault: string;
              };
            }),
          );
          const signerAddresses = signerMetadata.map(({ signer }) => signer);
          if (new Set(signerAddresses.map((value) => value.toLowerCase())).size !== signerAddresses.length) {
            errors.push(`External bridge signer URLs for chain ${chainId} contain duplicate signers`);
          }
          signerMetadata.forEach((metadata, index) => {
            if (
              metadata.destinationChainId !== String(chainId) ||
              metadata.destinationVault.toLowerCase() !==
                ensureHexPrefix(chain.vault!).toLowerCase()
            ) {
              errors.push(`External bridge signer ${signerUrls[index]} is configured for a different vault`);
            }
          });
          const executorAddress = new Wallet(
            normalizePrivateKey(executorPrivateKey!),
          ).address;
          const [
            threshold,
            validitySeconds,
            signerStatuses,
            executorIsSigner,
          ] = await Promise.all([
            vault.attestationThreshold(),
            vault.maxAuthorizationValiditySeconds(),
            Promise.all(
              signerAddresses.map((signer) =>
                vault.attestationSigners(signer),
              ),
            ),
            vault.attestationSigners(executorAddress),
          ]);
          if (executorIsSigner) {
            errors.push(
              `External bridge executor ${executorAddress} must not be an attestation signer on chain ${chainId}`,
            );
          }
          const enabledSignerCount = signerStatuses.filter(Boolean).length;
          if (Number(threshold) <= 0 || Number(threshold) > enabledSignerCount) {
            errors.push(
              `External vault on chain ${chainId} requires ${String(threshold)} signatures; ${enabledSignerCount} independent signer(s) are enabled`,
            );
          }
          if (BigInt(validitySeconds.toString()) <= 0n) {
            errors.push(
              `External vault on chain ${chainId} maxAuthorizationValiditySeconds must be greater than zero`,
            );
          }
        } catch (error) {
          errors.push(
            `Failed to validate external vault policy for chain ${chainId}: ${(error as Error).message}`,
          );
        }
      }

      if (config.nativeBridge.address) {
        const nativeChainIds = await getEnabledNativeChainIds();
        const missingNativeBridgeEnvVars: string[] = [];

        for (const chainId of nativeChainIds) {
          const representationBridgeEnv =
            `CHAIN_${chainId}_NATIVE_REPRESENTATION_BRIDGE_ADDRESS`;
          const bridgeKeyEnv =
            `CHAIN_${chainId}_NATIVE_BRIDGE_PRIVATE_KEY`;
          const rpcEnv = `CHAIN_${chainId}_RPC_URL`;
          const representationBridgeAddress = process.env[representationBridgeEnv];
          const bridgePrivateKeys = getNativeBridgePrivateKeys(chainId);

          if (!representationBridgeAddress) {
            missingNativeBridgeEnvVars.push(representationBridgeEnv);
          } else if (!isAddress(representationBridgeAddress)) {
            errors.push(`Invalid native representation bridge address format: ${representationBridgeEnv}`);
          }

          if (bridgePrivateKeys.length === 0) {
            missingNativeBridgeEnvVars.push(bridgeKeyEnv);
          }

          const signerAddresses = new Map<string, string>();
          for (const { envVar, privateKey } of bridgePrivateKeys) {
            if (!isPrivateKey(privateKey)) {
              errors.push(`Invalid native bridge private key format: ${envVar}`);
              continue;
            }

            const signerAddress = new Wallet(normalizePrivateKey(privateKey)).address;
            const existingEnv = signerAddresses.get(signerAddress.toLowerCase());
            if (existingEnv) {
              errors.push(`${envVar} resolves to same signer as ${existingEnv}: ${signerAddress}`);
            } else {
              signerAddresses.set(signerAddress.toLowerCase(), envVar);
            }
          }

          if (
            process.env[rpcEnv] &&
            representationBridgeAddress &&
            isAddress(representationBridgeAddress) &&
            bridgePrivateKeys.length > 0 &&
            bridgePrivateKeys.every(({ privateKey }) => isPrivateKey(privateKey))
          ) {
            try {
              const provider = new JsonRpcProvider(process.env[rpcEnv]);
              const nativeBridge = new Contract(
                representationBridgeAddress,
                REPRESENTATION_BRIDGE_ABI,
                provider,
              );
              const [
                threshold,
                maxAttestationValiditySeconds,
                signerStatuses,
              ] = await Promise.all([
                nativeBridge.attestationThreshold(),
                nativeBridge.maxAttestationValiditySeconds(),
                Promise.all(
                  bridgePrivateKeys.map(({ privateKey }) =>
                    nativeBridge.attestationSigners(
                      new Wallet(normalizePrivateKey(privateKey)).address,
                    ),
                  ),
                ),
              ]);

              const enabledConfiguredSignerCount = signerStatuses.filter(Boolean).length;
              signerStatuses.forEach((enabled, index) => {
                if (!enabled) {
                  const keyConfig = bridgePrivateKeys[index];
                  const signerAddress = new Wallet(normalizePrivateKey(keyConfig.privateKey)).address;
                  errors.push(
                    `${keyConfig.envVar} resolves to ${signerAddress}, which is not enabled on ${representationBridgeEnv}`,
                  );
                }
              });
              if (Number(threshold) <= 0) {
                errors.push(
                  `${representationBridgeEnv} attestationThreshold must be greater than zero`,
                );
              } else if (Number(threshold) > enabledConfiguredSignerCount) {
                errors.push(
                  `${representationBridgeEnv} attestationThreshold is ${String(threshold)}; bridge service has ${enabledConfiguredSignerCount} enabled configured native bridge signer(s)`,
                );
              }
              if (BigInt(maxAttestationValiditySeconds.toString()) <= 0n) {
                errors.push(
                  `${representationBridgeEnv} maxAttestationValiditySeconds must be greater than zero`,
                );
              }
            } catch (error) {
              errors.push(
                `Failed to validate native destination bridge policy for chain ${chainId}: ${(error as Error).message}`,
              );
            }
          }
        }

        if (missingNativeBridgeEnvVars.length > 0) {
          errors.push(
            `Missing native bridge environment variables for enabled native routes: ${missingNativeBridgeEnvVars.join(", ")}`,
          );
        }

        logInfo(
          "ConfigValidator",
          `Found ${nativeChainIds.length} enabled native route chains`,
        );
      }
    } catch (error) {
      errors.push(
        `Failed to validate chain/asset configuration: ${(error as Error).message}`,
      );
    }
  } else {
    warnings.push("Skipping chain/asset validation - OAuth not initialized");
  }

  // Validate username/password format
  if (config.auth.baUsername) {
    if (config.auth.baUsername.length < 3) {
      errors.push("BA_USERNAME appears to be too short");
    }
  }

  if (config.auth.baPassword) {
    if (config.auth.baPassword.length < 6) {
      warnings.push("BA_PASSWORD appears to be too short - may be insecure");
    }
  }

  // Validate client credentials
  if (config.auth.clientId) {
    if (config.auth.clientId.length < 3) {
      errors.push("CLIENT_ID appears to be too short");
    }
  }

  if (config.auth.clientSecret) {
    if (config.auth.clientSecret.length < 3) {
      errors.push("CLIENT_SECRET appears to be too short");
    }
  }

  // Report results
  if (errors.length > 0) {
    logError(
      "ConfigValidator",
      new Error(
        `Configuration errors:\n${errors.map((error) => `   ${error}`).join("\n")}`,
      ),
    );
    return false;
  }

  if (warnings.length > 0) {
    logInfo(
      "ConfigValidator",
      `Configuration warnings:\n${warnings.map((warning) => `   ${warning}`).join("\n")}`,
    );
  }

  logInfo("ConfigValidator", "Configuration validation completed successfully");
  return true;
}
