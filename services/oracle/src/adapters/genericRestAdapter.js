const axios = require('axios');

async function fetchGenericPrice(feedConfig, sourceConfig) {
    const apiKey = process.env[sourceConfig.apiKeyEnvVar];
    let url = sourceConfig.urlTemplate;

    // Replace placeholders
    for (const paramKey in feedConfig.apiParams) {
        url = url.replace(`\${${paramKey}}`, feedConfig.apiParams[paramKey]);
    }
    url = url.replace('${API_KEY}', apiKey);

    console.log(`[GenericAdapter] Fetching ${feedConfig.name} from ${url.replace(apiKey, '***')}`);

    const response = await axios.get(url);

    const priceUSD = extractNestedProperty(response.data, sourceConfig.parsePath);
    const feedTimestamp = extractNestedProperty(response.data, sourceConfig.feedTimestampPath) || new Date().toISOString();

    if (!priceUSD || isNaN(parseFloat(priceUSD))) {
        throw new Error(`Invalid price data received for ${feedConfig.name}: ${priceUSD}`);
    }

    console.log(`[GenericAdapter] ${feedConfig.name} → $${priceUSD} @ feedTimestamp: ${feedTimestamp}`);

    return {
        price: Math.floor(parseFloat(priceUSD) * 1e8), // Convert to 8-decimal format
        feedTimestamp
    };
}

function extractNestedProperty(obj, path) {
    return path.split('.').reduce((o, key) => o?.[key], obj);
}

module.exports = { fetchGenericPrice }; 