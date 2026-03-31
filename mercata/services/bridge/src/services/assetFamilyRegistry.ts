import { cirrus } from "../utils/api";
import { config } from "../config";
import { logInfo, logError } from "../utils/logger";
import { AssetInfo, AssetFamily, AssetFamilyInfo } from "../types";

const LOG_CTX = "AssetFamilyRegistry";

const MERCATA_URL = "BlockApps-MercataBridge";

/**
 * Centralized registry that classifies bridge assets into families.
 * Loads from MercataBridge Cirrus tables on initialization.
 */
export class AssetFamilyRegistry {
  /** Key: "externalToken:chainId" -> AssetFamilyInfo */
  private byExternalKey = new Map<string, AssetFamilyInfo>();

  /** Key: stratoToken address (lowercase) -> AssetFamily */
  private familyByStratoToken = new Map<string, AssetFamily>();

  /** Key: stratoToken address (lowercase) -> array of { chainId, externalToken } */
  private externalsByStratoToken = new Map<
    string,
    Array<{ chainId: number; externalToken: string }>
  >();

  async initialize(): Promise<void> {
    const bridgeAddress = config.bridge.address;

    const data: any[] = await cirrus.get(`/${MERCATA_URL}-assets`, {
      params: {
        "value->>enabled": "eq.true",
        address: `eq.${bridgeAddress}`,
        select: "key,key2,value",
        limit: "10000",
      },
    });

    if (!Array.isArray(data) || !data.length) {
      logInfo(LOG_CTX, "No assets found during initialization");
      return;
    }

    for (const { key: externalToken, key2: chainId, value: v } of data) {
      const isNative = !!v.isNative;
      const assetFamily: AssetFamily = isNative
        ? "strato-canonical"
        : "external-canonical";

      const info: AssetFamilyInfo = {
        enabled: !!v.enabled,
        isNative,
        stratoToken: v.stratoToken,
        externalName: v.externalName,
        externalToken: v.externalToken,
        externalSymbol: v.externalSymbol,
        externalChainId: Number(v.externalChainId),
        externalDecimals: Number(v.externalDecimals),
        maxPerWithdrawal: Number(v.maxPerWithdrawal),
        assetFamily,
      };

      const extKey = `${externalToken}:${chainId}`;
      this.byExternalKey.set(extKey, info);

      const stratoLower = String(v.stratoToken).toLowerCase();
      this.familyByStratoToken.set(stratoLower, assetFamily);

      if (!this.externalsByStratoToken.has(stratoLower)) {
        this.externalsByStratoToken.set(stratoLower, []);
      }
      this.externalsByStratoToken.get(stratoLower)!.push({
        chainId: Number(chainId),
        externalToken: String(externalToken),
      });
    }

    logInfo(LOG_CTX, "Initialized", {
      totalAssets: this.byExternalKey.size,
      stratoTokens: this.familyByStratoToken.size,
    });
  }

  getFamily(stratoToken: string): AssetFamily {
    return (
      this.familyByStratoToken.get(stratoToken.toLowerCase()) ??
      "external-canonical"
    );
  }

  isNative(stratoToken: string): boolean {
    return this.getFamily(stratoToken) === "strato-canonical";
  }

  getAssetInfo(
    externalToken: string,
    chainId: number,
  ): AssetFamilyInfo | undefined {
    return this.byExternalKey.get(`${externalToken}:${chainId}`);
  }

  /**
   * Get all external chain entries for a given STRATO token.
   * Used by the liquidity manager to query vault balances across chains.
   */
  getExternalTokensForFamily(
    stratoToken: string,
  ): Array<{ chainId: number; externalToken: string }> {
    return (
      this.externalsByStratoToken.get(stratoToken.toLowerCase()) ?? []
    );
  }

  /** Get all unique STRATO token addresses for external-canonical families. */
  getExternalCanonicalTokens(): string[] {
    const tokens = new Set<string>();
    for (const [strato, family] of this.familyByStratoToken) {
      if (family === "external-canonical") tokens.add(strato);
    }
    return [...tokens];
  }

  /** Get all entries in the registry. */
  getAllAssets(): AssetFamilyInfo[] {
    return [...this.byExternalKey.values()];
  }
}
