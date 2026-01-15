import { SourceConfig, Asset, AssetsBySchedule } from '../types';

interface AssetsConfig {
    assets: Record<string, Asset>;
}

interface SourcesConfig {
    [key: string]: SourceConfig;
}

export class ConfigLoader {
    private assets: Record<string, Asset> = {};
    private sources: SourcesConfig = {};

    constructor() {
        this.loadConfigurations();
    }

    private loadConfigurations(): void {
        // Load assets registry
        const assetsConfig = require('../config/assets.json') as AssetsConfig;
        this.assets = assetsConfig.assets;

        // Load sources configuration
        this.sources = require('../config/sources.json') as SourcesConfig;
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

    /**
     * Check if an asset is only used as a weekend proxy (not submitted as a regular asset)
     * An asset is proxy-only if:
     * - It's used as a weekendProxy by another asset
     * - AND it shares the same targetAssetAddress as the asset using it
     * - AND it doesn't have its own schedule properties
     * 
     * Note: Proxy-only assets are still fetched (for weekend proxy use) but not submitted separately
     */
    public isProxyOnlyAsset(assetKey: string): boolean {
        const asset = this.assets[assetKey];
        if (!asset) return false;
        
        // Check if any other asset uses this as a weekendProxy and shares the same address
        const isUsedAsProxyWithSameAddress = Object.entries(this.assets).some(([key, a]) => 
            a.weekendProxy === assetKey && a.targetAssetAddress === asset.targetAssetAddress
        );
        
        // If it's used as a proxy with same address and doesn't have its own schedule properties, it's proxy-only
        return isUsedAsProxyWithSameAddress && asset.constantPrice === undefined && asset.weekendProxy === undefined;
    }

    /**
     * Get assets grouped by their schedule type
     * Schedule is derived from asset properties:
     * - Has constantPrice field -> constant
     * - Has weekendProxy field -> metals (use proxy when market closed)
     * - Everything else -> always
     * 
     * Note: Proxy-only assets are included here so they get fetched (for weekend proxy use)
     * They will be filtered out at submission time in cronScheduler
     */
    public getAssetsBySchedule(): AssetsBySchedule {
        const result: AssetsBySchedule = {
            always: [],
            metals: [],
            constant: []
        };

        Object.entries(this.assets).forEach(([key, asset]) => {
            if (asset.constantPrice !== undefined) {
                result.constant.push(key);
            } else if (asset.weekendProxy) {
                result.metals.push(key);
            } else {
                result.always.push(key);
            }
        });

        return result;
    }

    /**
     * Get all asset keys
     */
    public getAllAssetKeys(): string[] {
        return Object.keys(this.assets);
    }

    public getSourceConfig(sourceName: string): SourceConfig {
        const source = this.sources[sourceName];
        if (!source) {
            throw new Error(`Source '${sourceName}' not found in sources configuration`);
        }
        return source;
    }

    public getAllSourceConfigs(): SourcesConfig {
        return this.sources;
    }

    public getAsset(assetKey: string): Asset {
        const asset = this.assets[assetKey];
        if (!asset) {
            throw new Error(`Asset '${assetKey}' not found in assets registry`);
        }
        return asset;
    }

    public getAllAssets(): Record<string, Asset> {
        return this.assets;
    }
}
