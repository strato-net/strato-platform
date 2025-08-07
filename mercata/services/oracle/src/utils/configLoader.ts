import { FeedConfig, SourceConfig, Asset } from '../types';

interface AssetsConfig {
    assets: Record<string, Asset>;
}

interface SourcesConfig {
    [key: string]: SourceConfig;
}

interface ResolvedFeedConfig {
    name: string;
    sources: string[];
    assets: Asset[];
    minPrice?: number;
    maxPrice?: number;
}

export class ConfigLoader {
    private assets: Record<string, Asset> = {};
    private sources: SourcesConfig = {};
    private feeds: FeedConfig[] = [];

    constructor() {
        this.loadConfigurations();
    }

    private loadConfigurations(): void {
        // Load assets registry
        const assetsConfig = require('../config/assets.json') as AssetsConfig;
        this.assets = assetsConfig.assets;

        // Load sources configuration
        this.sources = require('../config/sources.json') as SourcesConfig;

        // Load feeds configuration
        const feedsConfig = require('../config/feeds.json');
        this.feeds = feedsConfig.feeds;
    }

    public getResolvedFeeds(): ResolvedFeedConfig[] {
        return this.feeds.map(feed => {
            const resolvedAssets = feed.assets.map(assetKey => {
                const asset = this.assets[assetKey];
                if (!asset) {
                    throw new Error(`Asset '${assetKey}' not found in assets registry`);
                }
                return asset;
            });

            return {
                name: feed.name,
                sources: feed.sources,
                assets: resolvedAssets,
                minPrice: feed.minPrice,
                maxPrice: feed.maxPrice
            };
        });
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