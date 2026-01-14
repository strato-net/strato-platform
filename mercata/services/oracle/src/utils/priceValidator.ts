import { logError, logInfo } from './logger';

/**
 * Price validation configuration
 */
export interface PriceValidationConfig {
    minPrice?: number;  // Minimum acceptable price (in 18-decimal format)
    maxPrice?: number;  // Maximum acceptable price (in 18-decimal format)
    maxStalenessMs?: number;  // Maximum age of price data in milliseconds
    maxDeviationPercent?: number;  // Maximum acceptable deviation between sources (0-100)
}

/**
 * Price data with metadata
 */
export interface PriceData {
    price: number;
    feedTimestamp: string;
    sourceName?: string;
}

/**
 * Default validation thresholds
 */
const DEFAULT_MAX_STALENESS_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_DEVIATION_PERCENT = 10; // 10% deviation between sources

/**
 * Validates a single price value for basic sanity checks
 * @param price - Price in 18-decimal format
 * @param assetName - Asset identifier for error messages
 * @returns true if valid, false otherwise
 */
export function validatePriceSanity(price: number, assetName: string): boolean {
    // Check for NaN
    if (isNaN(price)) {
        logError('PriceValidator', new Error(`${assetName}: Price is NaN`));
        return false;
    }

    // Check for infinity
    if (!isFinite(price)) {
        logError('PriceValidator', new Error(`${assetName}: Price is infinite`));
        return false;
    }

    // Check for negative prices
    if (price < 0) {
        logError('PriceValidator', new Error(`${assetName}: Price is negative (${price})`));
        return false;
    }

    // Check for zero prices (smart contract also rejects this)
    if (price === 0) {
        logError('PriceValidator', new Error(`${assetName}: Price is zero`));
        return false;
    }

    return true;
}

/**
 * Validates price against configured boundaries
 * @param price - Price in 18-decimal format
 * @param assetName - Asset identifier for error messages
 * @param config - Validation configuration with min/max bounds
 * @returns true if valid, false otherwise
 */
export function validatePriceBounds(
    price: number,
    assetName: string,
    config: PriceValidationConfig
): boolean {
    if (config.minPrice !== undefined && price < config.minPrice) {
        const priceUSD = (price / 1e18).toFixed(8);
        const minUSD = (config.minPrice / 1e18).toFixed(8);
        logError('PriceValidator', new Error(
            `${assetName}: Price $${priceUSD} below minimum $${minUSD}`
        ));
        return false;
    }

    if (config.maxPrice !== undefined && price > config.maxPrice) {
        const priceUSD = (price / 1e18).toFixed(8);
        const maxUSD = (config.maxPrice / 1e18).toFixed(8);
        logError('PriceValidator', new Error(
            `${assetName}: Price $${priceUSD} above maximum $${maxUSD}`
        ));
        return false;
    }

    return true;
}

/**
 * Validates timestamp freshness
 * @param feedTimestamp - ISO timestamp string from price feed
 * @param assetName - Asset identifier for error messages
 * @param maxStalenessMs - Maximum acceptable age in milliseconds
 * @returns true if fresh, false if stale
 */
export function validatePriceFreshness(
    feedTimestamp: string,
    assetName: string,
    maxStalenessMs: number = DEFAULT_MAX_STALENESS_MS
): boolean {
    try {
        const feedTime = new Date(feedTimestamp).getTime();
        const now = Date.now();

        // Check for invalid timestamp
        if (isNaN(feedTime)) {
            logError('PriceValidator', new Error(`${assetName}: Invalid timestamp format: ${feedTimestamp}`));
            return false;
        }

        // Check for future timestamps (clock skew tolerance: 1 minute)
        if (feedTime > now + 60000) {
            logError('PriceValidator', new Error(
                `${assetName}: Timestamp is in the future: ${feedTimestamp}`
            ));
            return false;
        }

        const ageMs = now - feedTime;
        if (ageMs > maxStalenessMs) {
            const ageMinutes = Math.floor(ageMs / 60000);
            const maxMinutes = Math.floor(maxStalenessMs / 60000);
            logError('PriceValidator', new Error(
                `${assetName}: Price data is stale (${ageMinutes}m old, max ${maxMinutes}m)`
            ));
            return false;
        }

        return true;
    } catch (error) {
        logError('PriceValidator', new Error(
            `${assetName}: Error validating timestamp: ${(error as Error).message}`
        ));
        return false;
    }
}

/**
 * Validates deviation between multiple price sources
 * @param prices - Array of price values from different sources
 * @param assetName - Asset identifier for error messages
 * @param maxDeviationPercent - Maximum acceptable deviation percentage
 * @returns true if deviation is acceptable, false otherwise
 */
export function validatePriceDeviation(
    prices: number[],
    assetName: string,
    maxDeviationPercent: number = DEFAULT_MAX_DEVIATION_PERCENT
): boolean {
    if (prices.length < 2) {
        // No deviation check needed for single source
        return true;
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);

    // Calculate deviation as percentage of the average
    const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const deviation = ((maxPrice - minPrice) / avgPrice) * 100;

    if (deviation > maxDeviationPercent) {
        const minUSD = (minPrice / 1e18).toFixed(8);
        const maxUSD = (maxPrice / 1e18).toFixed(8);
        logError('PriceValidator', new Error(
            `${assetName}: Price deviation ${deviation.toFixed(2)}% exceeds threshold ${maxDeviationPercent}% ` +
            `(range: $${minUSD} - $${maxUSD})`
        ));
        return false;
    }

    return true;
}

/**
 * Comprehensive validation for a single price data point
 * @param priceData - Price data with timestamp
 * @param assetName - Asset identifier for error messages
 * @param config - Validation configuration
 * @returns true if all validations pass, false otherwise
 */
export function validateSinglePrice(
    priceData: PriceData,
    assetName: string,
    config: PriceValidationConfig = {}
): boolean {
    // Sanity checks
    if (!validatePriceSanity(priceData.price, assetName)) {
        return false;
    }

    // Boundary checks
    if (!validatePriceBounds(priceData.price, assetName, config)) {
        return false;
    }

    // Freshness checks
    if (config.maxStalenessMs !== undefined) {
        if (!validatePriceFreshness(priceData.feedTimestamp, assetName, config.maxStalenessMs)) {
            return false;
        }
    }

    return true;
}

/**
 * Validates and filters price data from multiple sources
 * Returns only valid prices and logs warnings for invalid ones
 * @param pricesData - Array of price data from different sources
 * @param assetName - Asset identifier for error messages
 * @param config - Validation configuration
 * @returns Array of valid prices (may be empty if all are invalid)
 */
export function validateAndFilterPrices(
    pricesData: PriceData[],
    assetName: string,
    config: PriceValidationConfig = {}
): PriceData[] {
    const validPrices: PriceData[] = [];

    for (const priceData of pricesData) {
        if (validateSinglePrice(priceData, assetName, config)) {
            validPrices.push(priceData);
        }
    }

    // Check deviation among valid prices
    if (validPrices.length >= 2) {
        const prices = validPrices.map(pd => pd.price);
        const maxDeviation = config.maxDeviationPercent ?? DEFAULT_MAX_DEVIATION_PERCENT;

        if (!validatePriceDeviation(prices, assetName, maxDeviation)) {
            logInfo('PriceValidator',
                `${assetName}: Proceeding with ${validPrices.length} sources despite deviation warning`
            );
        }
    }

    return validPrices;
}
