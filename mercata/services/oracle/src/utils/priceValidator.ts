import { logInfo, logError } from './logger';

/**
 * Configuration for price validation and safety checks
 */
export const PRICE_VALIDATION_CONFIG = {
    // Maximum age of price data in milliseconds (5 minutes)
    MAX_STALENESS_MS: 5 * 60 * 1000,
    // Maximum allowed price jump from last known good price (15%)
    MAX_PRICE_JUMP_PERCENT: 0.15,
};

/**
 * Interface for validated price data
 */
export interface ValidatedPrice {
    price: number;
    feedTimestamp: string;
    source: string;
}

/**
 * Storage for last known good prices (in-memory)
 * Maps asset name to last successfully published price
 */
const lastKnownGoodPrices: Map<string, number> = new Map();

/**
 * Validates a single price response
 * Returns null if price is invalid
 */
export function validatePrice(
    assetName: string,
    priceData: { price: number; feedTimestamp: string },
    sourceName: string
): ValidatedPrice | null {
    // Check if price exists
    if (!priceData || priceData.price === undefined) {
        logInfo('PriceValidator', `${assetName} from ${sourceName}: Missing price data`);
        return null;
    }

    const { price, feedTimestamp } = priceData;

    // Check if price is finite
    if (!Number.isFinite(price)) {
        logInfo('PriceValidator', `${assetName} from ${sourceName}: Non-finite price (${price})`);
        return null;
    }

    // Check if price is positive
    if (price <= 0) {
        logInfo('PriceValidator', `${assetName} from ${sourceName}: Non-positive price (${price})`);
        return null;
    }

    // Check if timestamp is missing
    if (!feedTimestamp) {
        logInfo('PriceValidator', `${assetName} from ${sourceName}: Missing timestamp`);
        return null;
    }

    // Check if price is stale
    const timestampMs = new Date(feedTimestamp).getTime();
    const now = Date.now();
    const age = now - timestampMs;

    if (isNaN(timestampMs) || age > PRICE_VALIDATION_CONFIG.MAX_STALENESS_MS) {
        const ageMinutes = Math.floor(age / 60000);
        logInfo('PriceValidator', `${assetName} from ${sourceName}: Stale price (${ageMinutes} minutes old)`);
        return null;
    }

    return { price, feedTimestamp, source: sourceName };
}

/**
 * Calculates the median of an array of numbers
 */
export function calculateMedian(values: number[]): number {
    if (values.length === 0) {
        throw new Error('Cannot calculate median of empty array');
    }

    if (values.length === 1) {
        return values[0];
    }

    // Sort values in ascending order
    const sorted = [...values].sort((a, b) => a - b);

    const mid = Math.floor(sorted.length / 2);

    // If even number of values, return average of middle two
    if (sorted.length % 2 === 0) {
        return Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
    }

    // If odd number of values, return middle value
    return sorted[mid];
}

/**
 * Performs anchoring safety check
 * Returns the candidate price if safe, or null if rejected
 */
export function anchoringSafetyCheck(
    assetName: string,
    candidatePrice: number
): number | null {
    const lastGoodPrice = lastKnownGoodPrices.get(assetName);

    // If no last known good price exists, accept the candidate
    if (!lastGoodPrice) {
        logInfo('PriceValidator', `${assetName}: No last-known-good price, accepting candidate`);
        return candidatePrice;
    }

    // Calculate price jump percentage
    const jump = Math.abs(candidatePrice - lastGoodPrice) / lastGoodPrice;

    if (jump <= PRICE_VALIDATION_CONFIG.MAX_PRICE_JUMP_PERCENT) {
        logInfo('PriceValidator', `${assetName}: Price jump ${(jump * 100).toFixed(2)}% is within safe limit (15%)`);
        return candidatePrice;
    }

    // Price jump exceeds safe limit - reject update
    const jumpPercent = (jump * 100).toFixed(2);
    logError('PriceValidator', new Error(
        `${assetName}: Price jump ${jumpPercent}% exceeds safe limit (15%). ` +
        `Last good: ${lastGoodPrice}, Candidate: ${candidatePrice}. ` +
        `Retaining last-known-good price.`
    ));

    return null;
}

/**
 * Updates the last known good price for an asset
 */
export function updateLastKnownGoodPrice(assetName: string, price: number): void {
    lastKnownGoodPrices.set(assetName, price);
}

/**
 * Gets the last known good price for an asset
 */
export function getLastKnownGoodPrice(assetName: string): number | undefined {
    return lastKnownGoodPrices.get(assetName);
}

/**
 * Clears all stored last known good prices (for testing)
 */
export function clearLastKnownGoodPrices(): void {
    lastKnownGoodPrices.clear();
}
