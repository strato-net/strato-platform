import { constants } from "./constants";
import * as config from "./config";
import type { ExplicitTokenClassification } from "./tokenClassification";

const normalizeRegistryAddress = (value: string | undefined | null): string =>
  (value || "").toLowerCase().replace(/^0x/, "");

const createExplicit = (
  entry: ExplicitTokenClassification
): ExplicitTokenClassification => entry;

interface CanonicalTokenRegistryEntry {
  addresses: Array<string | undefined | null>;
  entry: ExplicitTokenClassification;
}

const registerCanonicalEntry = (
  registry: Map<string, ExplicitTokenClassification>,
  definition: CanonicalTokenRegistryEntry
) => {
  for (const address of definition.addresses) {
    const normalizedAddress = normalizeRegistryAddress(address);
    if (!normalizedAddress) continue;
    registry.set(normalizedAddress, createExplicit(definition.entry));
  }
};

export const CANONICAL_STABLECOIN_SYMBOLS = ["USDST", "USDC", "USDT"] as const;
export const CANONICAL_METAL_SYMBOLS = ["GOLD", "SILV", "PAXG", "XAUT", "XAUTST", "GOLDST", "SILVST"] as const;

export const getCanonicalTokenRegistry = (): Map<string, ExplicitTokenClassification> => {
  const registry = new Map<string, ExplicitTokenClassification>();

  // This registry is intentionally limited to protocol-canonical assets and known
  // protocol-issued receipt/reward tokens. It is not a full inventory of every
  // token that may appear in BlockApps-Token on a given network.
  const canonicalEntries: CanonicalTokenRegistryEntry[] = [
    {
      addresses: [constants.USDST],
      entry: {
        classification: {
          assetClass: "stablecoin",
          economicRole: "underlying",
          issuanceOrigin: "native",
          isStablecoin: true,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: true,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "USDST",
      },
    },
    {
      addresses: ["6aeacaa19c68e53035bf495d15e0a328fc600ba8"],
      entry: {
        classification: {
          assetClass: "stablecoin",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: true,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: true,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "USDC",
      },
    },
    {
      addresses: ["5ed0bdfb378ac0d06249d70759536d7a41906216"],
      entry: {
        classification: {
          assetClass: "stablecoin",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: true,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: true,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "USDT",
      },
    },
    {
      addresses: ["93fb7295859b2d70199e0a4883b7c320cf874e6c"],
      entry: {
        classification: {
          assetClass: "crypto",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "ETH",
      },
    },
    {
      addresses: ["7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9"],
      entry: {
        classification: {
          assetClass: "crypto",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "WBTC",
      },
    },
    {
      addresses: ["f2aa370405030a434ae07e7826178325c675e925"],
      entry: {
        classification: {
          assetClass: "crypto",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "WSTETH",
      },
    },
    {
      addresses: ["2e4789eb7db143576da25990a3c0298917a8a87d"],
      entry: {
        classification: {
          assetClass: "crypto",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "RETH",
      },
    },
    {
      addresses: ["491cdfe98470bfe69b662ab368826dca0fc2f24d"],
      entry: {
        classification: {
          assetClass: "metal",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: false,
          isMetal: true,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "PAXG",
      },
    },
    {
      addresses: ["6e2d93d323edf1b3cc4672a909681b6a430cae64"],
      entry: {
        classification: {
          assetClass: "stablecoin",
          economicRole: "underlying",
          issuanceOrigin: "wrapped",
          isStablecoin: true,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "SUSDS",
      },
    },
    {
      addresses: ["c6c3e9881665d53ae8c222e24ca7a8d069aa56ca"],
      entry: {
        classification: {
          assetClass: "stablecoin",
          economicRole: "underlying",
          issuanceOrigin: "wrapped",
          isStablecoin: true,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "SYRUPUSDC",
      },
    },
    {
      addresses: ["f147e193fd1a629aa75aedd4758444ec0c969ca8"],
      entry: {
        classification: {
          assetClass: "other",
          economicRole: "underlying",
          issuanceOrigin: "wrapped",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "WTSLAX",
      },
    },
    {
      addresses: ["1ac696799624c75050b10b7ee3e6fcf6f1f39aa1"],
      entry: {
        classification: {
          assetClass: "other",
          economicRole: "underlying",
          issuanceOrigin: "wrapped",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "WSPYX",
      },
    },
    {
      addresses: ["cdc93d30182125e05eec985b631c7c61b3f63ff0"],
      entry: {
        classification: {
          assetClass: "metal",
          economicRole: "underlying",
          issuanceOrigin: "native",
          isStablecoin: false,
          isMetal: true,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "GOLDST",
      },
    },
    {
      addresses: ["2c59ef92d08efde71fe1a1cb5b45f4f6d48fcc94"],
      entry: {
        classification: {
          assetClass: "metal",
          economicRole: "underlying",
          issuanceOrigin: "native",
          isStablecoin: false,
          isMetal: true,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "SILVST",
      },
    },
    {
      addresses: ["47de839c03a3b014c0cc4f3b9352979a5038f910"],
      entry: {
        classification: {
          assetClass: "metal",
          economicRole: "bridged_representation",
          issuanceOrigin: "bridged",
          isStablecoin: false,
          isMetal: true,
          isReceiptToken: false,
          includeInTvlUnderlying: true,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "XAUT",
      },
    },
    {
      addresses: ["000000000000000000000000000000000000100f"],
      entry: {
        classification: {
          assetClass: "lending_receipt",
          economicRole: "receipt",
          issuanceOrigin: "protocol_minted",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: true,
          includeInTvlUnderlying: false,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "LENDUSDST",
      },
    },
    {
      addresses: ["2d436fce87f609a4d15f7ccb7cbbfaa8ffd143b3"],
      entry: {
        classification: {
          assetClass: "vault_share",
          economicRole: "receipt",
          issuanceOrigin: "protocol_minted",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: true,
          includeInTvlUnderlying: false,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "SLP",
      },
    },
    {
      addresses: ["2680dc6693021cd3fefb84351570874fbef8332a"],
      entry: {
        classification: {
          assetClass: "other",
          economicRole: "reward",
          issuanceOrigin: "protocol_minted",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: false,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "CATA",
      },
    },
    {
      addresses: [
        "0000000000000000000000000000000000001018",
        "000000000000000000000000000000000000101a",
        "000000000000000000000000000000000000101c",
        "000000000000000000000000000000000000101e",
        "1141c2f2f20aaf3ee0eff67157ec9327a396ae47",
        "69010124cdaa64286f6e413267a7001ea9379df4",
        "07d7350ce8f9f809b2264da7728b22e2c0b438af",
        "96c26f8306a0097d985d1654b4596c48bb6277c4",
        "af543d9086416b048564fa165f9587aa565cce2f",
        "ac621a150f49198036f84ffe90b4f2286b623583",
        "2e99b16c78474c437c7003c814ca79a3ba50e5d8",
        "488265afc86c2979c72900db087d421954c3ec4b",
        "d18a739fc9daa5ff19d2083b1f9b20823133b0cb",
        "a049efb1a3417801b3dd3877dd566aa24b95b3a0",
        "f84425db11cf977dfcaace0431a080e0ff2604ca",
        "aad3b82eb22fa76b8cd7a4f937de1263557c9956",
      ],
      entry: {
        classification: {
          assetClass: "lp_token",
          economicRole: "receipt",
          issuanceOrigin: "protocol_minted",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: true,
          includeInTvlUnderlying: false,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "LP_TOKEN",
      },
    },
    {
      addresses: [constants.voucher],
      entry: {
        classification: {
          assetClass: "voucher",
          economicRole: "other",
          issuanceOrigin: "protocol_minted",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: false,
          includeInTvlUnderlying: false,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "VOUCHER",
      },
    },
  ];

  canonicalEntries.forEach((entry) => registerCanonicalEntry(registry, entry));

  if (config.sToken) {
    registerCanonicalEntry(registry, {
      addresses: [config.sToken],
      entry: {
        classification: {
          assetClass: "safety_receipt",
          economicRole: "receipt",
          issuanceOrigin: "protocol_minted",
          isStablecoin: false,
          isMetal: false,
          isReceiptToken: true,
          includeInTvlUnderlying: false,
          includeInStablecoinSupply: false,
        },
        source: "registry_override",
        confidence: "high",
        canonicalSymbol: "SUSDST",
      },
    });
  }

  return registry;
};
