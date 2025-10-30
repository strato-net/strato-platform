import { logInfo, logError } from "./logger";
import { getEnabledChains, getEnabledAssets } from "../services/cirrusService";
import { config } from "../config";

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
    "SAFE_ADDRESS",
    "SAFE_PROPOSER_ADDRESS",
    "SAFE_PROPOSER_PRIVATE_KEY",
  ];

  requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      errors.push(`Missing required environment variable: ${varName}`);
    }
  });

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
    if (!/^[a-fA-F0-9]{64}$/.test(config.safe.safeProposerPrivateKey)) {
      errors.push(
        `Invalid Safe proposer private key format: ${config.safe.safeProposerPrivateKey.substring(0, 10)}...`,
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

  // Validate chain RPC URLs (only if OAuth is initialized)
  if (oauthInitialized) {
    try {
      const enabledChains = await getEnabledChains();
      const missingChainRpcUrls: string[] = [];

      for (const chainInfo of enabledChains) {
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

      // Validate assets configuration
      const enabledAssets = await getEnabledAssets();
      for (const asset of enabledAssets) {
        const stratoToken = asset?.stratoToken;
        const assetPrefix = `   Asset ${stratoToken || "unknown"}:`;

        if (!stratoToken) {
          errors.push(`${assetPrefix} Missing stratoToken address`);
        } else if (!/^(0x)?[a-fA-F0-9]{40}$/.test(stratoToken)) {
          errors.push(
            `${assetPrefix} Invalid stratoToken address format: ${stratoToken}`,
          );
        }

        if (!asset.externalToken) {
          errors.push(`${assetPrefix} Missing externalToken address`);
        } else if (!/^(0x)?[a-fA-F0-9]{40}$/.test(asset.externalToken)) {
          errors.push(
            `${assetPrefix} Invalid externalToken address format: ${asset.externalToken}`,
          );
        }

        if (!asset.externalChainId) {
          errors.push(`${assetPrefix} Missing externalChainId`);
        }

        if (asset.permissions === undefined) {
          errors.push(`${assetPrefix} Missing permissions flag`);
        }

        if (!asset.externalSymbol) {
          errors.push(`${assetPrefix} Missing externalSymbol`);
        }

        if (!asset.externalName) {
          errors.push(`${assetPrefix} Missing externalName`);
        }

        if (!asset.externalDecimals) {
          errors.push(`${assetPrefix} Missing externalDecimals`);
        } else if (isNaN(Number(asset.externalDecimals))) {
          errors.push(
            `${assetPrefix} Invalid externalDecimals format: ${asset.externalDecimals}`,
          );
        }
      }

      logInfo(
        "ConfigValidator",
        `Found ${enabledChains.length} enabled chains and ${enabledAssets.length} enabled assets`,
      );
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
