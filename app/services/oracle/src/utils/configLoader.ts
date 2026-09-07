import { SourceConfig, Asset } from '../types';

type SourcesConfig = Record<string, SourceConfig>;

const NETWORK_ASSET_KEY = /^(.+)_(\d+)$/;

export function parseNetworkAssetKey(assetKey: string): { sourceAsset: string; networkId: string } | null {
    const match = assetKey.match(NETWORK_ASSET_KEY);
    if (!match) return null;
    return { sourceAsset: match[1], networkId: match[2] };
}

export function getTestnetNetworkIds(): string[] {
    return (process.env.ORACLE_TESTNET_NETWORK_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);
}

export class ConfigLoader {
    private assets: Record<string, Asset> = {};
    private sources: SourcesConfig = {};

    constructor() {
        this.loadConfigurations();
    }

    private loadConfigurations(): void {
        // Load assets registry
        const assetsConfig = require('../config/assets.json') as { assets: Record<string, Asset> };
        const testnetNetworkIds = new Set(getTestnetNetworkIds());
        this.assets = Object.fromEntries(
            Object.entries(assetsConfig.assets).filter(([assetKey]) => !parseNetworkAssetKey(assetKey))
        );
        Object.entries(assetsConfig.assets).forEach(([assetKey, asset]) => {
            const networkAsset = parseNetworkAssetKey(assetKey);
            if (networkAsset && testnetNetworkIds.has(networkAsset.networkId)) {
                this.assets[networkAsset.sourceAsset] = asset;
            }
        });

        // Load sources configuration and resolve API keys
        const rawSources = require('../config/sources.json') as SourcesConfig;
        this.sources = {};
        
        Object.entries(rawSources).forEach(([name, config]) => {
            this.sources[name] = {
                ...config,
                apiKey: config.apiKeyEnvVar ? process.env[config.apiKeyEnvVar] || '' : '',
                accountId: config.accountIdEnvVar ? process.env[config.accountIdEnvVar] || '' : ''
            };
        });
    }

    /**
     * Get all source names that support a given asset
     */
    public getSourcesForAsset(assetKey: string): string[] {
        return Object.entries(this.sources)
            .filter(([_, config]) => config.assets?.includes(assetKey))
            .map(([name]) => name);
    }

    /**
     * Get sources that have a symbol mapping for the given proxy symbol
     * Used for weekend lookups where we need to fetch using proxy token
     */
    public getSourcesForProxySymbol(proxySymbol: string): string[] {
        return Object.entries(this.sources)
            .filter(([_, config]) => {
                // Check if source has this symbol in symbolMapping or assets
                return config.symbolMapping?.[proxySymbol] || config.assets?.includes(proxySymbol);
            })
            .map(([name]) => name);
    }

    public getAllSourceConfigs(): SourcesConfig {
        return this.sources;
    }

    public getAllAssets(): Record<string, Asset> {
        return this.assets;
    }
}
