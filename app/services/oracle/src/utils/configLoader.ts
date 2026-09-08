import { SourceConfig, Asset } from '../types';

type SourcesConfig = Record<string, SourceConfig>;

interface NetworkOracleConfig {
    assets: Record<string, Asset>;
    sources: SourcesConfig;
}

interface NetworksConfig {
    networks: Record<string, NetworkOracleConfig>;
}

export function getOracleNetworkId(): string {
    return process.env.ORACLE_NETWORK_ID || '';
}

export class ConfigLoader {
    private assets: Record<string, Asset> = {};
    private sources: SourcesConfig = {};

    constructor() {
        this.loadConfigurations();
    }

    private loadConfigurations(): void {
        const { networks } = require('../config/assets.json') as NetworksConfig;
        const networkId = getOracleNetworkId();
        const network = networks[networkId];
        if (!network?.assets || !network?.sources) {
            throw new Error(
                `No oracle assets/sources for network "${networkId || '(default)'}". Add a networks["${networkId}"] block in assets.json.`
            );
        }

        this.assets = network.assets;
        this.sources = {};
        Object.entries(network.sources).forEach(([name, config]) => {
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
