import { logInfo, logError } from "./logger";
import { config } from "../config";
import { signerAddress } from "./signer";
import { cirrus } from "./api";
import { checkBalances } from "./balanceCheck";

export async function validateReferralConfig(): Promise<boolean> {
  const errors: string[] = [];

  for (const varName of ["NODE_URL", "ESCROW_ADDRESS"]) {
    if (!process.env[varName]) errors.push(`Missing required environment variable: ${varName}`);
  }
  if (config.escrow.address && !/^(0x)?[0-9a-fA-F]{40}$/.test(config.escrow.address)) {
    errors.push("ESCROW_ADDRESS is not an address");
  }

  // The signing key: loads SIGNER_PRIVATE_KEY, or makes and keeps one.
  try {
    logInfo("ConfigValidator", `Signing as ${signerAddress()} (fund this account with USDST or vouchers for gas)`);
  } catch (e) {
    errors.push(`Signer: ${(e as Error).message}`);
  }

  // The node: one Cirrus read, which also proves the escrow is known there.
  if (config.api.nodeUrl && config.escrow.address) {
    try {
      const rows = await cirrus.get("/mapping", {
        params: { select: "key", address: `eq.${config.escrow.address.replace(/^0x/, "").toLowerCase()}`, collection_name: "eq.deposits", limit: "1" },
      });
      if (!Array.isArray(rows)) errors.push("Cirrus did not answer with rows");
    } catch (e) {
      errors.push(`Node unreachable: ${(e as Error).message}`);
    }
  }

  if (errors.length > 0) {
    logError("ConfigValidator", new Error(`Configuration errors:\n${errors.map((error) => `   ${error}`).join("\n")}`));
    return false;
  }

  // Low balances are logged (and flagged on /health), never fatal at startup.
  await checkBalances();
  logInfo("ConfigValidator", "Configuration validated");
  return true;
}
