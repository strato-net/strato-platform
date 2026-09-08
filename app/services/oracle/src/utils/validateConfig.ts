import dotenv from 'dotenv';
import { oauthClient } from './oauth';
import { logInfo, logError } from './logger';
import { ORACLE_CONFIG } from './constants';
import { getOracleNetworkId } from './configLoader';
import { Asset, SourceConfig } from '../types';

const oracleConfig = require('../config/assets.json') as {
    networks: Record<string, { assets: Record<string, Asset>; sources: Record<string, SourceConfig> }>;
};

dotenv.config();

function getSourcesForSymbol(sourcesConfig: Record<string, SourceConfig>, symbol: string): string[] {
    return Object.entries(sourcesConfig)
        .filter(([_, config]) => {
            return config.assets?.includes(symbol) || config.symbolMapping?.[symbol];
        })
        .map(([name]) => name);
}

function validateNetwork(
    networkId: string,
    assets: Record<string, Asset>,
    sourcesConfig: Record<string, SourceConfig>,
    errors: string[],
    warnings: string[],
    checkApiKeys: boolean
): void {
    const networkLabel = networkId || '(default)';
    const assetKeys = Object.keys(assets);
    const sourceNames = Object.keys(sourcesConfig);

    assetKeys.forEach(assetKey => {
        const asset = assets[assetKey];
        const assetPrefix = `   Network ${networkLabel} asset ${assetKey}:`;

        if (!asset.targetAssetAddress) {
            errors.push(`${assetPrefix} Missing targetAssetAddress`);
        } else if (!/^[a-fA-F0-9]{40}$/.test(asset.targetAssetAddress)) {
            errors.push(`${assetPrefix} Invalid targetAssetAddress format: ${asset.targetAssetAddress}`);
        }

        if (asset.constantPrice !== undefined && typeof asset.constantPrice !== 'number') {
            errors.push(`${assetPrefix} constantPrice must be a number`);
        }

        if (asset.weekendProxy !== undefined && typeof asset.weekendProxy !== 'string') {
            errors.push(`${assetPrefix} weekendProxy must be a string (proxy symbol)`);
        }

        if (asset.weekendProxy) {
            const proxySources = getSourcesForSymbol(sourcesConfig, asset.weekendProxy);
            if (proxySources.length < ORACLE_CONFIG.MIN_VALID_SOURCES) {
                errors.push(
                    `${assetPrefix} weekendProxy '${asset.weekendProxy}' has only ${proxySources.length} source(s), ` +
                    `needs at least ${ORACLE_CONFIG.MIN_VALID_SOURCES}. Sources: [${proxySources.join(', ')}]`
                );
            }
        }

        if (asset.submit !== undefined && typeof asset.submit !== 'boolean') {
            errors.push(`${assetPrefix} submit must be a boolean`);
        }
    });

    const assetSourceCount: Record<string, string[]> = {};

    sourceNames.forEach(sourceName => {
        const source = sourcesConfig[sourceName];
        const sourcePrefix = `   Network ${networkLabel} source ${sourceName}:`;

        if (!source.assets || !Array.isArray(source.assets)) {
            errors.push(`${sourcePrefix} Missing or invalid 'assets' array`);
            return;
        }

        if (sourceName !== 'constant' && !source.url) {
            errors.push(`${sourcePrefix} Missing url`);
        }

        if (!source.parse) {
            errors.push(`${sourcePrefix} Missing parse pattern`);
        }

        if (checkApiKeys && source.apiKeyEnvVar && !process.env[source.apiKeyEnvVar]) {
            errors.push(`Missing required API key for source ${sourceName}: ${source.apiKeyEnvVar}`);
        }

        source.assets.forEach((assetKey: string) => {
            if (!assets[assetKey]) {
                errors.push(`${sourcePrefix} References unknown asset: ${assetKey}`);
                return;
            }

            if (!assetSourceCount[assetKey]) {
                assetSourceCount[assetKey] = [];
            }
            assetSourceCount[assetKey].push(sourceName);

            if (source.symbolMapping && !source.symbolMapping[assetKey]) {
                warnings.push(`${sourcePrefix} No symbolMapping for asset ${assetKey} (may use default)`);
            }
        });

        if (sourceName === 'constant') {
            source.assets.forEach((assetKey: string) => {
                const asset = assets[assetKey];
                if (asset && (asset.constantPrice === undefined || typeof asset.constantPrice !== 'number')) {
                    errors.push(`${sourcePrefix} Asset ${assetKey} must have a numeric constantPrice field`);
                }
            });
        }
    });

    assetKeys.forEach(assetKey => {
        const asset = assets[assetKey];
        const sources = assetSourceCount[assetKey] || [];

        if (asset.submit === false) {
            return;
        }

        if (asset.rebase) {
            if (!assets[asset.rebase.underlyingAsset]) {
                errors.push(`Network ${networkLabel} asset ${assetKey} rebase.underlyingAsset '${asset.rebase.underlyingAsset}' not found`);
            }
            return;
        }

        if (asset.constantPrice !== undefined) {
            if (!sources.includes('constant')) {
                warnings.push(`Network ${networkLabel} asset ${assetKey} has constantPrice but no 'constant' source references it`);
            }
            return;
        }

        if (asset.weekendProxy !== undefined) {
            if (sources.length === 0) {
                warnings.push(`Network ${networkLabel} asset ${assetKey} has no direct sources, relies on weekendProxy '${asset.weekendProxy}'`);
            }
            return;
        }

        const requiredSources = ORACLE_CONFIG.MIN_VALID_SOURCES;
        if (sources.length < requiredSources) {
            errors.push(
                `Network ${networkLabel} asset ${assetKey} has only ${sources.length} source(s), needs at least ${requiredSources}. ` +
                `Sources: [${sources.join(', ')}]`
            );
        }
    });
}

export async function validateConfig(): Promise<boolean> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const requiredEnvVars = [
        'STRATO_NODE_URL', 'OAUTH_DISCOVERY_URL', 'OAUTH_CLIENT_ID',
        'OAUTH_CLIENT_SECRET', 'USERNAME', 'PASSWORD', 'PRICE_ORACLE_ADDRESS'
    ];

    requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        }
    });

    if (process.env.OAUTH_DISCOVERY_URL && process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET) {
        try {
            const isValid = await oauthClient().validateToken();
            if (!isValid) {
                errors.push('OAuth authentication failed - check credentials');
            }
        } catch (error) {
            errors.push(`OAuth authentication error: ${(error as Error).message}`);
        }
    } else {
        errors.push('Incomplete OAuth configuration');
    }

    if (!oracleConfig.networks || typeof oracleConfig.networks !== 'object') {
        errors.push('assets.json must contain a "networks" object');
    } else {
        const selectedNetworkId = getOracleNetworkId();
        if (!oracleConfig.networks[selectedNetworkId]) {
            errors.push(`assets.json has no networks["${selectedNetworkId || ''}"] block for ORACLE_NETWORK_ID`);
        }

        Object.entries(oracleConfig.networks).forEach(([networkId, network]) => {
            if (!network?.assets || typeof network.assets !== 'object') {
                errors.push(`Network ${networkId || '(default)'} must contain an "assets" object`);
                return;
            }
            if (!network?.sources || typeof network.sources !== 'object') {
                errors.push(`Network ${networkId || '(default)'} must contain a "sources" object`);
                return;
            }
            validateNetwork(networkId, network.assets, network.sources, errors, warnings, networkId === selectedNetworkId);
        });
    }

    if (errors.length > 0) {
        logError('ConfigValidator', new Error(`Configuration errors:\n${errors.map(error => `   ${error}`).join('\n')}`));
        return false;
    }

    if (warnings.length > 0) {
        logInfo('ConfigValidator', `Warnings:\n${warnings.map(warning => `   ${warning}`).join('\n')}`);
    }

    const selected = oracleConfig.networks[getOracleNetworkId()];
    const assetKeys = Object.keys(selected?.assets || {});
    const proxyOnlyAssets = assetKeys.filter(k => selected.assets[k].submit === false);
    const submitCount = assetKeys.length - proxyOnlyAssets.length;
    const sourceNames = Object.keys(selected?.sources || {});

    let summary = `Configuration valid. Network "${getOracleNetworkId() || '(default)'}": ${submitCount}/${assetKeys.length} assets to submit, ${sourceNames.length} sources.`;
    if (proxyOnlyAssets.length > 0) {
        summary += ` Proxy-only: [${proxyOnlyAssets.join(', ')}]`;
    }
    logInfo('ConfigValidator', summary);

    return true;
}

if (require.main === module) {
    validateConfig().then(isValid => {
        process.exit(isValid ? 0 : 1);
    }).catch(error => {
        logError('ConfigValidator', new Error(`Validation error: ${error}`));
        process.exit(1);
    });
}
