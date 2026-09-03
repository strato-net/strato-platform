import axios from 'axios';
import { SourceConfig, Asset } from '../types';
import { logInfo } from './logger';

const HELIUM_NETWORK_ID = '114784819836269';

let cachedIsTestnet: boolean | null = null;
let cachedNetworkName = '';
let cachedNetworkId = '';

function metadataUrls(nodeUrl: string): string[] {
    const base = nodeUrl.replace(/\/+$/, '');
    return [
        `${base}/eth/v1.2/metadata`,
        `${base}/strato-api/eth/v1.2/metadata`,
    ];
}

function parseMetadata(data: unknown): { networkID: string; networkName: string } | null {
    if (!data || typeof data !== 'object') return null;
    const networkID = (data as { networkID?: unknown }).networkID;
    if (networkID == null || String(networkID) === '') return null;
    const networkName = (data as { networkName?: unknown }).networkName;
    return {
        networkID: String(networkID),
        networkName: networkName == null ? '' : String(networkName),
    };
}

export async function initOracleNetwork(): Promise<void> {
    const nodeUrl = process.env.STRATO_NODE_URL;
    if (!nodeUrl) {
        throw new Error('STRATO_NODE_URL is required to fetch network metadata');
    }

    const errors: string[] = [];
    for (const url of metadataUrls(nodeUrl)) {
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                validateStatus: () => true,
            });
            const meta = parseMetadata(response.data);
            if (meta) {
                cachedNetworkId = meta.networkID;
                cachedNetworkName = meta.networkName;
                cachedIsTestnet = meta.networkName === 'helium' || meta.networkID === HELIUM_NETWORK_ID;
                logInfo(
                    'ConfigLoader',
                    `STRATO network ${cachedNetworkName} (${cachedNetworkId}); using ${cachedIsTestnet ? 'testnet' : 'prod'} asset addresses`
                );
                return;
            }
            errors.push(`${url}: HTTP ${response.status}, not metadata JSON`);
        } catch (error) {
            errors.push(`${url}: ${(error as Error).message}`);
        }
    }

    throw new Error(`Failed to fetch STRATO metadata: ${errors.join('; ')}`);
}

export function isOracleTestnet(): boolean {
    if (cachedIsTestnet === null) {
        throw new Error('Oracle network not initialized; call initOracleNetwork first');
    }
    return cachedIsTestnet;
}

export function resolveTargetAssetAddress(asset: Asset): string {
    if (isOracleTestnet() && asset.targetAssetAddressTestnet) {
        return asset.targetAssetAddressTestnet;
    }
    return asset.targetAssetAddress;
}

type SourcesConfig = Record<string, SourceConfig>;

export class ConfigLoader {
    private assets: Record<string, Asset> = {};
    private sources: SourcesConfig = {};

    constructor() {
        this.loadConfigurations();
    }

    private loadConfigurations(): void {
        // Load assets registry
        const assetsConfig = require('../config/assets.json') as { assets: Record<string, Asset> };
        this.assets = assetsConfig.assets;

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

    public resolveTargetAddress(asset: Asset): string {
        return resolveTargetAssetAddress(asset);
    }
}
