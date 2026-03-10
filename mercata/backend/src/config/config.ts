import { fetchOpenIdConfig, getServiceToken } from "../utils/authHelper";
import { JSONWebKeySet } from "jose";

// Load local .env files when not in production
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// Verify the env vars
if (!process.env.OAUTH_DISCOVERY_URL) {
  throw new Error("OAUTH_DISCOVERY_URL is not defined");
}
if (!process.env.OAUTH_CLIENT_ID) {
  throw new Error("OAUTH_CLIENT_ID is not defined");
}
if (!process.env.OAUTH_CLIENT_SECRET) {
  throw new Error("OAUTH_CLIENT_SECRET is not defined");
}
if (!process.env.NODE_URL) {
  throw new Error("NODE_URL is not defined");
}

// TODO: potentially add the TTL for cached values, to update values after a period of time
export let openIdTokenEndpoint: string | undefined;
export let openIdJwks: JSONWebKeySet | undefined;
/**
 * Init function to be called from the App.js to make sure the app is served after the token endpoint is asynchronously fetched from OpenID Discovery URL 
 */
export async function initOpenIdConfig() {
  const { tokenEndpoint, jwks } = await fetchOpenIdConfig(process.env.OAUTH_DISCOVERY_URL);
  openIdTokenEndpoint = tokenEndpoint;
  openIdJwks = jwks;
}

export const clientId = process.env.OAUTH_CLIENT_ID;
export const clientSecret = process.env.OAUTH_CLIENT_SECRET;
export const nodeUrl = process.env.NODE_URL;
export const baseUrl = process.env.BASE_URL || "http://localhost";

// Smart contract addresses
export const burnAddress = process.env.BURN_ADDRESS || "0000000000000000000000000000000000000000";
export const poolConfigurator = process.env.POOL_CONFIGURATOR || "0000000000000000000000000000000000001006";
export const lendingRegistry = process.env.LENDING_REGISTRY || "0000000000000000000000000000000000001007";
export const mercataBridge = process.env.MERCATA_BRIDGE || "0000000000000000000000000000000000001008";
export const poolFactory = process.env.POOL_FACTORY || "000000000000000000000000000000000000100a";
export const tokenFactory = process.env.TOKEN_FACTORY || "000000000000000000000000000000000000100b";
export const adminRegistry = process.env.ADMIN_REGISTRY || "000000000000000000000000000000000000100c";
export const voucher = process.env.VOUCHER_CONTRACT_ADDRESS || "000000000000000000000000000000000000100e";
export const cdpRegistry = process.env.CDP_REGISTRY || "0000000000000000000000000000000000001012";
export const rewardsChef = process.env.REWARDS_CHEF || "000000000000000000000000000000000000101f";

// Hidden swap pools - these pools are filtered out from API responses
export const hiddenSwapPools: Set<string> = new Set([
  "9c75280f9e2368005d2b7342f19c59f9176b5962", // sUSDST-USDST swap pool - This is a hot fix to hide the pool from the user 
]);

/*
   Network-specific defaults;
   These are used to set bridge URL and rewards address based on network ID.
*/
export const defaultBridgeServiceFor: Record<string, string> = {
  "114784819836269":"https://bridge.testnet.strato.nexus", // Helium testnet
  "33056204878082667":"https://bridge.strato.nexus",       // Upquark mainnet
};
export const defaultRewardsAddressFor: Record<string, string> = {
  "114784819836269": "170147f58738c9f46112a874030420b823901f3b", // Helium testnet
  "33056204878082667": "4a116cf8cb056036632aef08f7c0df27c720f1c0", // Upquark mainnet
};
export const defaultEscrowAddressFor: Record<string, string> = {
  "114784819836269": "7fa32d329b5f61a1808418304eea249b1b0b28fc", // Helium testnet
  "33056204878082667": "4b4a14095077946c20fb680980db511932b7cf4b", // Upquark mainnet
}
export const defaultReferralServiceFor: Record<string, string> = {
  "114784819836269": "http://ec2-54-89-36-118.compute-1.amazonaws.com", // Helium testnet
  "33056204878082667": "http://ec2-18-218-166-133.us-east-2.compute.amazonaws.com", // Upquark mainnet
};

export const defaultVaultFactoryFor: Record<string, string> = {
  "114784819836269": "37b446ec53607a0cdae38c820b838baf240a8b74", // Helium testnet
  "33056204878082667": "55c77951e9cadc73af24ec18881d01fedff1f1f1" // Upquark mainnet
};

export const defaultMetalForgeFor: Record<string, string> = {
  "114784819836269": "c5ed981b816a626981a5747d125e0e7296b2c7c6", // Helium testnet
  "33056204878082667": "", // Upquark mainnet — TODO: set after deployment
};

export const defaultCreditCardTopUpFor: Record<string, string> = {
  "114784819836269": "337bbb2b6e85e8c4903f8cba56bb4e1807db0bc6", // Helium testnet
  "33056204878082667": "656139504763b2fab4e158ddb1f4ca8eb878305d" // Upquark mainnet
};

export let bridgeUrl: string | undefined;
export let rewards: string | undefined;
export let networkId: string | undefined;
export let referralUrl: string | undefined;
export let escrow: string = '';
export let vaultFactory: string = '';
export let metalForge: string = '';
export let creditCardTopUp: string = '';

function setBridgeConfig(networkId: string) {
  if (process.env.BRIDGE_SERVICE_URL) {
    bridgeUrl = process.env.BRIDGE_SERVICE_URL;
  } else {
    bridgeUrl = defaultBridgeServiceFor[networkId];
  }
}

function setRewardsConfig(networkId: string) {
  if (process.env.REWARDS) {
    rewards = process.env.REWARDS;
  } else {
    rewards = defaultRewardsAddressFor[networkId];
  }
}

function setReferralConfig(networkId: string) {
  if (process.env.ESCROW_ADDRESS) {
    escrow = process.env.ESCROW_ADDRESS;
  } else {
    escrow = defaultEscrowAddressFor[networkId];
  }
  if (process.env.REDEMPTION_SERVER_URL) {
    referralUrl = process.env.REDEMPTION_SERVER_URL;
  } else {
    referralUrl = defaultReferralServiceFor[networkId];
  }
}

function setVaultFactoryConfig(networkId: string) {
  if (process.env.VAULT_FACTORY) {
    vaultFactory = process.env.VAULT_FACTORY;
  } else {
    vaultFactory = defaultVaultFactoryFor[networkId];
  }
}

function setMetalForgeConfig(networkId: string) {
  if (process.env.METAL_FORGE) {
    metalForge = process.env.METAL_FORGE;
  } else {
    metalForge = defaultMetalForgeFor[networkId];
  }
}

export function setCreditCardTopUpConfig(networkId: string) {
  if (process.env.CREDIT_CARD_TOP_UP_ADDRESS) {
    creditCardTopUp = process.env.CREDIT_CARD_TOP_UP_ADDRESS;
  } else {
    creditCardTopUp = defaultCreditCardTopUpFor[networkId] || "";
  }
}

export async function initNetworkConfig() {
  // Import eth here to avoid circular dependency (eth depends on nodeUrl)
  const { eth } = await import("../utils/mercataApiHelper");
  const accessToken = await getServiceToken();
  const { data } = await eth.get(accessToken, `/metadata`);
  networkId = data.networkID;
  if (!networkId) {
    throw new Error("Network ID not found in metadata");
  }
  setBridgeConfig(networkId);
  setRewardsConfig(networkId);
  setReferralConfig(networkId);
  setVaultFactoryConfig(networkId);
  setMetalForgeConfig(networkId);
  setCreditCardTopUpConfig(networkId);
}

// Addresses of internal protocol contracts whose Token:Transfer events should
// be excluded from the activity feed (gas fees, pool operations, minting, etc.).
// Populated at startup by initInternalAddresses().
export let internalAddresses: Array<string> = [];

/**
 * Fetch and cache internal protocol contract addresses by querying the on-chain registries and factories.
 * Must be called after initNetworkConfig() so network-specific addresses are available.
 * Used to exclude internal transfers from the My Activity / All Activity feed.
 */
export async function initInternalAddresses() {
  const { cirrus } = await import("../utils/mercataApiHelper");
  const accessToken = await getServiceToken();

  // Static: well-known system contract addresses from config
  const addresses: string[] = [
    mercataBridge,
    burnAddress,
  ];

  // Network-specific addresses (set by initNetworkConfig)
  addresses.push(rewards || '', escrow, vaultFactory);

  // Lending Registry --> lendingPool, collateralVault, liquidityPool
  const { data: [lending] } = await cirrus.get(accessToken, "/BlockApps-LendingRegistry", {
    params: {
      address: `eq.${lendingRegistry}`,
      select: "lendingPool:lendingPool_fkey(address),collateralVault:collateralVault_fkey(address),liquidityPool:liquidityPool_fkey(address)",
    },
  });
  addresses.push(lending.lendingPool.address, lending.collateralVault.address, lending.liquidityPool.address);

  // CDP Registry --> cdpEngine, cdpVault, feeCollector
  const { data: [cdp] } = await cirrus.get(accessToken, "/BlockApps-CDPRegistry", {
    params: {
      address: `eq.${cdpRegistry}`,
      select: "feeCollector,cdpEngine:cdpEngine_fkey(address),cdpVault:cdpVault_fkey(address),cdpReserve:cdpReserve_fkey(address)",
    },
  });
  addresses.push(cdp.feeCollector, cdp.cdpEngine.address, cdp.cdpVault.address, cdp.cdpReserve.address);

  // Pool Factory --> all swap pool addresses
  const { data: pools } = await cirrus.get(accessToken, "/BlockApps-PoolFactory-allPools", {
    params: { address: `eq.${poolFactory}`, select: "value" },
  });
  addresses.push(...pools.map((pool: any) => pool.value));

  // Vault Factory --> all vault addresses + their botExecutor addresses
  if (vaultFactory) {
    const { data: vaults } = await cirrus.get(accessToken, "/BlockApps-VaultFactory-allVaults", {
      params: { address: `eq.${vaultFactory}`, select: "value" },
    });
    const vaultAddresses = vaults.map((v: any) => v.value);
    addresses.push(...vaultAddresses);

    if (vaultAddresses.length > 0) {
      const { data: vaultRecords } = await cirrus.get(accessToken, "/BlockApps-Vault", {
        params: { address: `in.(${vaultAddresses.join(",")})`, select: "botExecutor" },
      });
      addresses.push(...vaultRecords.map((v: any) => v.botExecutor));
    }
  }

  internalAddresses = Array.from(new Set(addresses.filter(Boolean)));
}
