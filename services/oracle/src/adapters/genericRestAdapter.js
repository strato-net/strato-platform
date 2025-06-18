const axios = require('axios');

async function fetchGenericPrice(feedConfig, sourceConfig) {
    const apiKey = process.env[sourceConfig.apiKeyEnvVar];
    let url = sourceConfig.urlTemplate;

    // Replace placeholders in URL
    for (const paramKey in feedConfig.apiParams) {
        url = url.replace(`\${${paramKey}}`, feedConfig.apiParams[paramKey]);
    }
    url = url.replace('${API_KEY}', apiKey);

    // Prepare request options
    const requestOptions = {
        method: sourceConfig.method || 'GET',
        url: url,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    // Handle POST request body if present
    if (sourceConfig.requestBody) {
        let requestBody = JSON.parse(JSON.stringify(sourceConfig.requestBody)); // Deep clone
        
        // Replace placeholders in request body
        const bodyStr = JSON.stringify(requestBody);
        let processedBodyStr = bodyStr;
        
        for (const paramKey in feedConfig.apiParams) {
            processedBodyStr = processedBodyStr.replace(new RegExp(`\\$\\{${paramKey}\\}`, 'g'), feedConfig.apiParams[paramKey]);
        }
        processedBodyStr = processedBodyStr.replace(/\$\{API_KEY\}/g, apiKey);
        
        requestOptions.data = JSON.parse(processedBodyStr);
    }

    console.log(`[GenericAdapter] Fetching ${feedConfig.name} from ${url.replace(apiKey || 'NO_API_KEY', '***')} (${requestOptions.method})`);

    const response = await axios(requestOptions);

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
    // Use bracket notation to handle both object properties and array indices
    return path.split('.').reduce((o, key) => {
        // Convert array notation like "data[0]" to bracket notation
        const accessKey = key.replace(/\[(\d+)\]/g, '.$1');
        return accessKey.split('.').reduce((nested, k) => nested?.[k], o);
    }, obj);
}

module.exports = { fetchGenericPrice }; 