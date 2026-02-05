import { apiGet } from './apiClient';
import { oauthClient } from './oauth';
import { logError } from './logger';

/**
 * Fetches all previous prices from Cirrus for the oracle contract
 * @returns Map of asset address -> price (in wei), empty map on failure
 */
export async function fetchPreviousPrices(): Promise<Map<string, number>> {
    const priceMap = new Map<string, number>();

    try {
        const accessToken = await oauthClient().getAccessToken();
        const oracleAddress = process.env.PRICE_ORACLE_ADDRESS;
        
        const pricesEndpoint = `${process.env.STRATO_NODE_URL}/cirrus/search/BlockApps-PriceOracle-prices`;
        
        const response = await apiGet(
            pricesEndpoint,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                params: {
                    address: `eq.${oracleAddress}`,
                    select: 'key,value'
                },
                timeout: 10000
            },
            {
                logPrefix: 'PriceReader',
                apiUrl: pricesEndpoint,
                method: 'GET'
            }
        );

        // Parse response and build price map
        if (Array.isArray(response.data)) {
            for (const row of response.data) {
                if (row.key && row.value) {
                    const price = typeof row.value === 'string' ? parseFloat(row.value) : row.value;
                    if (price > 0) {
                        priceMap.set(row.key.toLowerCase(), price);
                    }
                }
            }
        }
    } catch (err) {
        logError('PriceReader', new Error(`Failed to fetch previous prices from Cirrus: ${(err as Error).message}`));
        // Return empty map - caller will continue with submission
    }

    return priceMap;
}
