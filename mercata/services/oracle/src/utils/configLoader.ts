import { SourceConfig, Asset } from '../types';
import { getNetworkId } from './networkConfig';
import { logInfo } from './logger';

type SourcesConfig = Record<string, SourceConfig>;

const ASSETS_FILE_BY_NETWORK: Record<string, string> = {
    '33056204878082667': '../config/assets.upquark.json',
    '114784819836269': '../config/assets.helium.json',
};

export class ConfigLoader {
    private assets: Record<string, Asset> = {};
    private sources: SourcesConfig = {};

    constructor() {
        this.loadConfigurations();
    }

    private loadConfigurations(): void {
        const networkId = getNetworkId();
        const assetsFile = ASSETS_FILE_BY_NETWORK[networkId];
        if (!assetsFile) {
            throw new Error(`No assets file configured for networkId ${networkId}. Add an entry to ASSETS_FILE_BY_NETWORK.`);
        }
        const assetsConfig = require(assetsFile) as { assets: Record<string, Asset> };
        this.assets = assetsConfig.assets;
        logInfo('ConfigLoader', `Loaded ${Object.keys(this.assets).length} assets from ${assetsFile.replace('../config/', '')} (networkId ${networkId})`);

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
