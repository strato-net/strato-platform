import { logInfo, logError } from "./logger";
import { config } from "../config";

export async function validateReferralConfig(): Promise<boolean> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate required environment variables
  const requiredEnvVars = [
    "BA_USERNAME",
    "BA_PASSWORD",
    "CLIENT_SECRET",
    "CLIENT_ID",
    "OPENID_DISCOVERY_URL",
    "ESCROW_ADDRESS",
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

  // Validate escrow contract address format
  if (config.escrow.address) {
    if (!/^(0x)?[a-fA-F0-9]{40}$/.test(config.escrow.address)) {
      errors.push(
        `Invalid escrow contract address format: ${config.escrow.address}`,
      );
    }
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
