import { validateAwsKmsAddress } from "./kmsSigner";
import { NATIVE_EXECUTOR_FORBIDDEN_BRIDGE_ROLES, NATIVE_EXECUTOR_FORBIDDEN_TOKEN_ROLES } from "../config/bridgeAbi";
import { readOAuthDiscovery } from "../auth/discovery";
import { MIN_SERVICE_TOKEN_LENGTH } from "../config/verifierAccess";
import { validateVerificationRpcEndpoints } from "../services/rpcService";
import { logInfo, logError } from "./logger";
import { Contract, id, JsonRpcProvider, ZeroHash } from "ethers";
import {
  getEnabledChains,
  getEnabledNativeChainIds,
  getNativeRepresentationTokens,
  getSettlementVerifierConfig,
  getTokenRouterWiring,
} from "../services/cirrusService";
import {
  config,
  getExternalBridgeExecutorKmsConfig,
  getExternalBridgeExecutorPrivateKey,
  getExternalBridgeVerifierApiTokens,
  getExternalBridgeVerifierUrls,
  getNativeMintExecutorKmsConfig,
  getNativeVerifierApiTokens,
  getNativeVerifierUrls,
  NATIVE_VERIFIER_REQUEST_TIMEOUT_MS,
} from "../config";
import { ensureHexPrefix } from "./utils";

const REPRESENTATION_BRIDGE_ABI = [
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function maxAttestationValiditySeconds() view returns (uint256)",
  "function hasRole(bytes32,address) view returns (bool)",
];

export const validateNativeExecutorRoles = async (
  bridge: Contract,
  provider: JsonRpcProvider,
  executor: string,
  safe: string,
  representationTokens: string[],
): Promise<void> => {
  const roleId = (role: string) => role === "DEFAULT_ADMIN_ROLE" ? ZeroHash : id(role);
  for (const role of NATIVE_EXECUTOR_FORBIDDEN_BRIDGE_ROLES) {
    if (await bridge.hasRole(roleId(role), executor)) {
      throw new Error(`Native executor must not hold bridge ${role}`);
    }
  }
  for (const role of ["DEFAULT_ADMIN_ROLE", "MINT_CANCELLER_ROLE"]) {
    if (!await bridge.hasRole(roleId(role), safe)) {
      throw new Error(`Native Safe must hold ${role}`);
    }
  }
  for (const address of representationTokens) {
    if (!isAddress(address)) throw new Error("Invalid native representation token address");
    const token = new Contract(ensureHexPrefix(address), ["function hasRole(bytes32,address) view returns (bool)"], provider);
    for (const role of NATIVE_EXECUTOR_FORBIDDEN_TOKEN_ROLES) {
      if (await token.hasRole(roleId(role), executor)) {
        throw new Error(`Native executor must not hold token ${role}: ${address}`);
      }
    }
    if (!await token.hasRole(id("BRIDGE_ROLE"), await bridge.getAddress())) {
      throw new Error(`Native representation bridge lacks token BRIDGE_ROLE: ${address}`);
    }
  }
};

const EXTERNAL_VAULT_ABI = [
  "function attestationSigners(address) view returns (bool)",
  "function attestationThreshold() view returns (uint8)",
  "function maxAuthorizationValiditySeconds() view returns (uint256)",
];

const isAddress = (value: string): boolean =>
  /^(0x)?[a-fA-F0-9]{40}$/.test(value);

interface ExternalBridgeExecutorValidationResult {
  executorAddress?: string;
  errors: string[];
  warnings: string[];
}

export const validateExternalBridgeVerifierUrls = (
  urls: string[],
): string[] =>
  urls.flatMap((url) => {
    try {
      return new URL(url).protocol === "https:"
        ? []
        : [`External bridge verifier URL must use HTTPS: ${url}`];
    } catch {
      return [`Invalid external bridge verifier URL: ${url}`];
    }
  });

export const validateExternalBridgeExecutorConfig = (
  chainId: number | bigint,
  kmsConfig: ReturnType<typeof getExternalBridgeExecutorKmsConfig>,
  privateKey: string | undefined,
  _deployed: boolean,
): ExternalBridgeExecutorValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (
    !Number.isSafeInteger(NATIVE_VERIFIER_REQUEST_TIMEOUT_MS) ||
    NATIVE_VERIFIER_REQUEST_TIMEOUT_MS <= 0
  ) {
    errors.push("NATIVE_VERIFIER_REQUEST_TIMEOUT_MS must be a positive integer");
  }
  const prefix = `CHAIN_${chainId}_EXTERNAL_BRIDGE_EXECUTOR`;
  let executorAddress: string | undefined;

  if (!kmsConfig) {
    errors.push(
      `External bridge executor requires ${prefix}_ADDRESS, ${prefix}_KMS_KEY_ID, and ${prefix}_KMS_REGION`,
    );
    return { executorAddress, errors, warnings };
  }

  if (!kmsConfig.address || !isAddress(kmsConfig.address)) {
    errors.push(
      `Missing or invalid external bridge executor address: ${prefix}_ADDRESS`,
    );
  } else {
    executorAddress = ensureHexPrefix(kmsConfig.address);
  }
  if (!kmsConfig.keyId) errors.push(`Missing ${prefix}_KMS_KEY_ID`);
  if (!kmsConfig.region) errors.push(`Missing ${prefix}_KMS_REGION`);
  if (privateKey) {
    errors.push(
      `${prefix}_PRIVATE_KEY must not be configured; use AWS workload-identity KMS`,
    );
  }

  return { executorAddress, errors, warnings };
};

export async function validateBridgeConfig(): Promise<boolean> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let settlementVerifierAddresses: string[] = [];
  let operatorAddress = "";
  let relayerAddress = "";

  if (config.email.approverEmails.length) {
    if (!process.env.SENDGRID_API_KEY) errors.push("SENDGRID_API_KEY is required for bridge review notifications");
  } else {
    warnings.push("TRANSACTION_APPROVER_EMAILS is unset: governance review queue emails are disabled");
  }

  // Validate required environment variables
  const requiredEnvVars = [
    "BA_USERNAME",
    "BA_PASSWORD",
    "CLIENT_SECRET",
    "CLIENT_ID",
    "OPENID_DISCOVERY_URL",
    "RELAYER_BA_USERNAME",
    "RELAYER_BA_PASSWORD",
    "RELAYER_CLIENT_SECRET",
    "RELAYER_CLIENT_ID",
    "RELAYER_OPENID_DISCOVERY_URL",
    "EXTERNAL_ASSET_BRIDGE_ADDRESS",
    "STRATO_APP_API_URL",
    "TOKEN_ROUTER",
    "SAFE_ADDRESS",
    "SAFE_PROPOSER_ADDRESS",
    "SAFE_PROPOSER_KMS_KEY_ID",
    "SAFE_PROPOSER_KMS_REGION",
  ];

  requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  });
  if (!process.env.DEPOSIT_WEBHOOK_TOKEN) {
    errors.push("Missing required environment variable: DEPOSIT_WEBHOOK_TOKEN");
  }
  if (!process.env.DEPOSIT_OPERATIONS_TOKEN) {
    errors.push("Missing required environment variable: DEPOSIT_OPERATIONS_TOKEN");
  }

  for (const name of ["DEPOSIT_WEBHOOK_TOKEN", "DEPOSIT_OPERATIONS_TOKEN"]) {
    if (process.env[name] && process.env[name]!.length < MIN_SERVICE_TOKEN_LENGTH) {
      errors.push(`${name} must contain at least ${MIN_SERVICE_TOKEN_LENGTH} characters`);
    }
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
      const discovery = await readOAuthDiscovery(process.env.OPENID_DISCOVERY_URL);
      if (!discovery.jwks_uri || !discovery.issuer) {
        errors.push(
          "OAuth discovery response is invalid - missing jwks_uri or issuer",
        );
      } else {
        // Test actual user authentication
        try {
          const {
            initOpenIdConfig,
            getBAUserAddress,
            getBAUserToken,
            getRelayerToken,
          } = await import(
            "../auth"
          );

          // Initialize OAuth
          await initOpenIdConfig();
          oauthInitialized = true;

          // Test user authentication by getting a token
          const token = await getBAUserToken();
          const relayerToken = await getRelayerToken();
          if (!token) {
            errors.push("User authentication failed - no token received");
          } else if (!relayerToken) {
            errors.push("Relayer authentication failed - no token received");
          } else {
            const { relayerStrato } = await import("./api");
            const [operatorKey, relayerKey] = await Promise.all([
              getBAUserAddress(),
              relayerStrato.get<{ address: string }>("/key"),
            ]);
            operatorAddress = operatorKey.toLowerCase().replace(/^0x/, "");
            relayerAddress = relayerKey.address
              .toLowerCase()
              .replace(/^0x/, "");
            if (relayerAddress === operatorAddress) {
              errors.push(
                "STRATO relayer and bridge operator must use different accounts",
              );
            }
            logInfo("ConfigValidator", "User authentication test passed");
          }
        } catch (authError) {
          errors.push(
            `User authentication error: ${(authError as Error).message}`,
          );
        }
      }
    } catch (error) {
      errors.push(`OAuth discovery error: ${(error as Error).message}`);
    }
  } else {
    errors.push("Incomplete OAuth configuration");
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
  if (oauthInitialized && config.externalAssetBridge.address) {
    try {
      const verifierConfig = await getSettlementVerifierConfig();
      settlementVerifierAddresses = verifierConfig.verifiers;
      if (verifierConfig.threshold !== 2) {
        errors.push(
          "ExternalAssetBridge settlement verifier threshold must be 2",
        );
      }
      if (verifierConfig.count < 3) {
        errors.push(
          "ExternalAssetBridge must have at least 3 settlement verifiers",
        );
      }
      if (
        relayerAddress &&
        settlementVerifierAddresses.includes(relayerAddress)
      ) {
        errors.push(
          "STRATO relayer must not be an enabled settlement verifier",
        );
      }
      if (
        operatorAddress &&
        settlementVerifierAddresses.includes(operatorAddress)
      ) {
        errors.push(
          "STRATO bridge operator must not be an enabled settlement verifier",
        );
      }
    } catch (error) {
      errors.push(
        `Settlement verifier validation failed: ${(error as Error).message}`,
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
            await validateVerificationRpcEndpoints(externalChainId);
          } catch (error) {
            errors.push(
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
          !confirmationValue ||
          !Number.isSafeInteger(Number(confirmationValue)) ||
          Number(confirmationValue) <= 0
        ) {
          errors.push(
            `CHAIN_${chainId}_DEPOSIT_CONFIRMATIONS must be an explicit positive integer`,
          );
        }
        const signerUrls = getExternalBridgeVerifierUrls(chainId);
        const signerApiTokens = getExternalBridgeVerifierApiTokens(chainId);
        const executorKmsConfig = getExternalBridgeExecutorKmsConfig(chainId);
        const executorPrivateKey = getExternalBridgeExecutorPrivateKey(chainId);
        const executorValidation = validateExternalBridgeExecutorConfig(
          chainId,
          executorKmsConfig,
          executorPrivateKey,
          true,
        );
        errors.push(...executorValidation.errors);
        warnings.push(...executorValidation.warnings);
        const executorAddress = executorValidation.executorAddress;
        if (signerUrls.length < 3) {
          errors.push(
            `CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_URLS must contain 3 independent verifier services`,
          );
        }
        if (new Set(signerUrls).size !== signerUrls.length) {
          errors.push(
            `CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_URLS must contain distinct URLs`,
          );
        }
        if (signerApiTokens.length !== signerUrls.length) {
          errors.push(
            `CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS must contain one token per verifier URL`,
          );
        } else if (new Set(signerApiTokens).size !== signerApiTokens.length) {
          errors.push(
            `CHAIN_${chainId}_EXTERNAL_BRIDGE_VERIFIER_API_TOKENS must contain distinct tokens`,
          );
        }
        errors.push(...validateExternalBridgeVerifierUrls(signerUrls));
        if (!chain.vault || !isAddress(chain.vault)) {
          errors.push(`Invalid external bridge vault for chain ${chainId}`);
          continue;
        }

        const rpcUrl = process.env[`CHAIN_${chainId}_RPC_URL`];
        if (
          !rpcUrl ||
          signerUrls.length === 0 ||
          signerApiTokens.length !== signerUrls.length ||
          !executorAddress
        ) {
          continue;
        }

        try {
          const vault = new Contract(
            ensureHexPrefix(chain.vault),
            EXTERNAL_VAULT_ABI,
            new JsonRpcProvider(rpcUrl),
          );
          const signerMetadata = await Promise.all(
            signerUrls.map(async (url, index) => {
              const response = await fetch(`${url}/health`, {
                headers: {
                  Authorization: `Bearer ${signerApiTokens[index]}`,
                },
              });
              if (!response.ok) {
                throw new Error(`Signer ${url} health returned ${response.status}`);
              }
              return (await response.json()) as {
                authorizationSigner: string;
                settlementAttestor: string;
                verifierConfirmations: number;
                destinationChainId: string;
                destinationVault: string;
                policyVersion: string;
                policyDigest: string;
                baselinePolicyHash: string;
                verifierIndex: number;
              };
            }),
          );
          const signerAddresses = signerMetadata.map(
            ({ authorizationSigner }) => authorizationSigner,
          );
          const verifierAddresses = signerMetadata.map(
            ({ settlementAttestor }) => String(settlementAttestor || ""),
          );
          if (
            signerMetadata.some(
              ({
                policyVersion,
                policyDigest,
                baselinePolicyHash,
                verifierIndex,
              }) =>
                !policyVersion ||
                !/^sha256:[0-9a-f]{64}$/.test(policyDigest) ||
                !/^sha256:[0-9a-f]{64}$/.test(baselinePolicyHash) ||
                !Number.isSafeInteger(verifierIndex) ||
                verifierIndex <= 0,
            )
          ) {
            errors.push(
              `External bridge signer metadata for chain ${chainId} is missing a valid local policy version or digest`,
            );
          }
          if (
            new Set(
              signerMetadata.map(({ baselinePolicyHash }) => baselinePolicyHash),
            ).size !== 1
          ) {
            errors.push(
              `External bridge verifiers for chain ${chainId} do not share one baseline policy hash`,
            );
          }
          if (
            new Set(
              signerMetadata.map(({ verifierIndex }) => verifierIndex),
            ).size !== signerMetadata.length
          ) {
            errors.push(
              `External bridge verifiers for chain ${chainId} contain duplicate policy indexes`,
            );
          }
          if (new Set(signerAddresses.map((value) => value.toLowerCase())).size !== signerAddresses.length) {
            errors.push(`External bridge signer URLs for chain ${chainId} contain duplicate signers`);
          }
          if (
            verifierAddresses.some((value) => !isAddress(value)) ||
            new Set(verifierAddresses.map((value) => value.toLowerCase()))
              .size !== verifierAddresses.length
          ) {
            errors.push(
              `External bridge signer URLs for chain ${chainId} must expose distinct STRATO settlement verifiers`,
            );
          }
          verifierAddresses.forEach((verifier, index) => {
            if (
              !settlementVerifierAddresses.includes(
                verifier.toLowerCase().replace(/^0x/, ""),
              )
            ) {
              errors.push(
                `External bridge signer ${signerUrls[index]} is not an enabled STRATO settlement verifier`,
              );
            }
          });
          signerMetadata.forEach((metadata, index) => {
            if (
              metadata.destinationChainId !== String(chainId) ||
              metadata.destinationVault.toLowerCase() !==
                ensureHexPrefix(chain.vault!).toLowerCase()
            ) {
              errors.push(`External bridge signer ${signerUrls[index]} is configured for a different vault`);
            }
            if (
              !Number.isSafeInteger(
                metadata.verifierConfirmations,
              ) ||
              metadata.verifierConfirmations <= 0 ||
              (confirmationValue &&
                metadata.verifierConfirmations <
                  Number(confirmationValue))
            ) {
              errors.push(
                `External bridge signer ${signerUrls[index]} has an invalid or insufficient confirmation policy`,
              );
            }
          });
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
          if (Number(threshold) < 2 || Number(threshold) > enabledSignerCount) {
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
          const executorEnv = `CHAIN_${chainId}_NATIVE_MINT_EXECUTOR`;
          const verifierUrlsEnv = `CHAIN_${chainId}_NATIVE_VERIFIER_URLS`;
          const verifierTokensEnv = `CHAIN_${chainId}_NATIVE_VERIFIER_API_TOKENS`;
          const rpcEnv = `CHAIN_${chainId}_RPC_URL`;
          const representationBridgeAddress = process.env[representationBridgeEnv];
          const executorKms = getNativeMintExecutorKmsConfig(chainId);
          const verifierUrls = getNativeVerifierUrls(chainId);
          const verifierTokens = getNativeVerifierApiTokens(chainId);

          if (!representationBridgeAddress) {
            missingNativeBridgeEnvVars.push(representationBridgeEnv);
          } else if (!isAddress(representationBridgeAddress)) {
            errors.push(`Invalid native representation bridge address format: ${representationBridgeEnv}`);
          }

          if (!executorKms?.address || !isAddress(executorKms.address) ||
              !executorKms.keyId || !executorKms.region) {
            errors.push(`${executorEnv} requires a valid ADDRESS, KMS_KEY_ID and KMS_REGION`);
          }
          if (process.env[`${executorEnv}_PRIVATE_KEY`]?.trim()) {
            errors.push(`${executorEnv}_PRIVATE_KEY must not be configured; use AWS workload-identity KMS`);
          }
          if (verifierUrls.length === 0) {
            missingNativeBridgeEnvVars.push(verifierUrlsEnv);
          }
          if (verifierTokens.length !== verifierUrls.length) {
            errors.push(`${verifierTokensEnv} must contain one token per native verifier URL`);
          }

          if (
            process.env[rpcEnv] &&
            representationBridgeAddress &&
            isAddress(representationBridgeAddress) &&
            executorKms?.keyId && executorKms.region &&
            isAddress(executorKms.address)
          ) {
            try {
              const provider = new JsonRpcProvider(process.env[rpcEnv]);
              const nativeBridge = new Contract(
                representationBridgeAddress,
                REPRESENTATION_BRIDGE_ABI,
                provider,
              );
              await validateAwsKmsAddress(executorKms);
              const representationTokens = await getNativeRepresentationTokens(chainId);
              await validateNativeExecutorRoles(nativeBridge, provider, ensureHexPrefix(executorKms.address),
                ensureHexPrefix(config.safe.address!), representationTokens);
              const [
                threshold,
                maxAttestationValiditySeconds,
                executorIsSigner,
                executorIsAuthorized,
              ] = await Promise.all([
                nativeBridge.attestationThreshold(),
                nativeBridge.maxAttestationValiditySeconds(),
                nativeBridge.attestationSigners(
                  ensureHexPrefix(executorKms.address),
                ),
                nativeBridge.hasRole(
                  id("MINT_EXECUTOR_ROLE"),
                  ensureHexPrefix(executorKms.address),
                ),
              ]);

              if (Number(threshold) < 2) {
                errors.push(
                  `${representationBridgeEnv} attestationThreshold must be at least two`,
                );
              } else if (Number(threshold) > verifierUrls.length) {
                errors.push(
                  `${representationBridgeEnv} attestationThreshold is ${String(threshold)}; bridge service has ${verifierUrls.length} configured native verifier(s)`,
                );
              }
              if (executorIsSigner) {
                errors.push(`${executorEnv} must not resolve to a native attestation signer`);
              }
              if (!executorIsAuthorized) {
                errors.push(`${executorEnv} does not hold MINT_EXECUTOR_ROLE`);
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
