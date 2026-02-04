import { apiRequest } from '../utils/apiClient';
import { SourceConfig, BatchPriceResult, Asset } from '../types';
import { logError } from '../utils/logger';

function extractNestedProperty(obj: any, path: string): any {
    if (!path) return undefined;
    return path.split('.').reduce((o, key) => {
        const accessKey = key.replace(/\[(\d+)\]/g, '.$1');
        return accessKey.split('.').reduce((nested, k) => nested?.[k], o);
    }, obj);
}

function isValidPrice(price: number): boolean {
    return price > 0 && isFinite(price);
}

// Generate constant prices for asset keys
export function generateConstantPrices(assetKeys: string[], assets: Record<string, Asset>): BatchPriceResult {
    const result: BatchPriceResult = {};
    const timestamp = new Date().toISOString();
    
    assetKeys.forEach(key => {
        const asset = assets[key];
        if (!asset || !asset.constantPrice) {
            throw new Error(`Asset ${key} has no constantPrice`);
        }
        result[key] = { price: asset.constantPrice, feedTimestamp: timestamp };
    });
    
    return result;
}

// Main fetch function - uses sourceConfig directly
export async function fetchPrices(sourceConfig: SourceConfig): Promise<BatchPriceResult> {
    const url = buildUrl(sourceConfig);
    const requestOptions = buildRequestOptions(sourceConfig, url);

    const response = await apiRequest(requestOptions, {
        logPrefix: 'GenericRestAdapter',
        apiUrl: url,
        method: requestOptions.method || 'GET'
    });

    if (response.data && response.data.success === false) {
        const errorMessage = response.data.error?.message || response.data.error || 'API returned error response';
        throw new Error(`${sourceConfig.url}: ${errorMessage}`);
    }

    return parseResponse(response.data, sourceConfig);
}

function buildUrl(sourceConfig: SourceConfig): string {
    let url = sourceConfig.url || '';
    const symbols = sourceConfig.assets;
    const apiKey = sourceConfig.apiKey || '';

    if (apiKey) {
        url = url.replace(/\$\{API_KEY\}/g, apiKey);
    }

    // Handle OANDA account ID substitution
    if (sourceConfig.accountId) {
        url = url.replace(/\$\{ACCOUNT_ID\}/g, sourceConfig.accountId);
    }
    
    if (sourceConfig.params) {
        const queryParams = new URLSearchParams();
        sourceConfig.params.split(',').map(p => p.trim()).forEach(param => {
            // API key params (contains '_key' or is 'api_key'/'access_key'/'apikey')
            if ((param.includes('_key') || param === 'api_key' || param === 'access_key' || param === 'apikey') && apiKey) {
                queryParams.append(param, apiKey);
            // Static key=value params
            } else if (param.includes('=')) {
                const [key, value] = param.split('=');
                queryParams.append(key, value);
            // Repeated assets param (e.g., symbols[])
            } else if (param.endsWith('[]')) {
                const paramName = param.slice(0, -2);
                symbols.forEach(s => queryParams.append(paramName, sourceConfig.symbolMapping?.[s] || s));
            // Comma-separated assets param
            } else {
                const mapped = symbols.map(s => sourceConfig.symbolMapping?.[s] || s).join(',');
                queryParams.append(param, mapped);
            }
        });
        
        // TwelveData: Add exchange=LSE for bCSPX (CSPX on London Stock Exchange)
        if (url.includes('twelvedata.com') && symbols.includes('bCSPX')) {
            queryParams.append('exchange', 'LSE');
        }
        
        if (queryParams.toString()) {
            url += '?' + queryParams.toString();
        }
    }
    
    return url;
}

function buildRequestOptions(sourceConfig: SourceConfig, url: string): any {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };

    // Add API key headers
    if (sourceConfig.headers && sourceConfig.apiKey) {
        sourceConfig.headers.split(',').forEach(h => {
            const headerName = h.trim();
            // OANDA uses Bearer token auth
            if (headerName === 'Authorization') {
                headers[headerName] = `Bearer ${sourceConfig.apiKey}`;
            } else {
                headers[headerName] = sourceConfig.apiKey!;
            }
        });
    }

    const requestOptions: any = { method: sourceConfig.method || 'GET', url, headers };

    // Add POST body if needed
    if (sourceConfig.body && sourceConfig.method === 'POST') {
        requestOptions.data = {
            codes: sourceConfig.assets.map(s => sourceConfig.symbolMapping?.[s] || s),
            currency: 'USD',
            meta: false
        };
    }

    return requestOptions;
}

function parseResponse(data: any, sourceConfig: SourceConfig): BatchPriceResult {
    const result: BatchPriceResult = {};
    const parsePattern = sourceConfig.parse;
    const symbols = sourceConfig.assets;
    
    // Alchemy: data[].prices[0].value
    if (parsePattern === 'data[].prices[0].value' && data.data && Array.isArray(data.data)) {
        symbols.forEach(symbol => {
            const mapped = sourceConfig.symbolMapping?.[symbol] || symbol;
            const item = data.data.find((d: any) => d.symbol === mapped);
            if (item?.prices?.[0]?.value) {
                const price = Math.floor(parseFloat(item.prices[0].value) * 1e18);
                if (isValidPrice(price)) result[symbol] = { price, feedTimestamp: item.prices[0].lastUpdatedAt || new Date().toISOString() };
            }
        });
        
    // CoinMarketCap: data.{symbol}[0].quote.USD.price
    } else if (parsePattern.includes('data.{symbol}[0].quote.USD.price') && data.data) {
        symbols.forEach(symbol => {
            const symbolData = data.data[symbol];
            if (symbolData?.[0]?.quote?.USD?.price) {
                const price = Math.floor(parseFloat(symbolData[0].quote.USD.price) * 1e18);
                if (isValidPrice(price)) result[symbol] = { price, feedTimestamp: symbolData[0].quote.USD.last_updated || new Date().toISOString() };
            }
        });
        
    // CoinGecko: {id}.usd
    } else if (parsePattern === '{id}.usd') {
        symbols.forEach(symbol => {
            const id = sourceConfig.symbolMapping?.[symbol] || symbol.toLowerCase();
            if (data[id]?.usd) {
                const price = Math.floor(parseFloat(data[id].usd) * 1e18);
                if (isValidPrice(price)) {
                    const ts = data[id].last_updated_at ? new Date(data[id].last_updated_at * 1000).toISOString() : new Date().toISOString();
                    result[symbol] = { price, feedTimestamp: ts };
                }
            }
        });
        
    // CoinAPI: assets array
    } else if (parsePattern === 'assets' && Array.isArray(data)) {
        symbols.forEach(symbol => {
            const assetId = sourceConfig.symbolMapping?.[symbol] || symbol;
            const assetData = data.find((a: any) => a.asset_id === assetId);
            if (assetData?.price_usd) {
                const price = Math.floor(parseFloat(assetData.price_usd) * 1e18);
                if (isValidPrice(price)) result[symbol] = { price, feedTimestamp: assetData.data_quote_start || new Date().toISOString() };
            }
        });
        
    // LiveCoinWatch: coins array
    } else if (parsePattern === 'coins' && Array.isArray(data)) {
        symbols.forEach(symbol => {
            const code = sourceConfig.symbolMapping?.[symbol] || symbol;
            const coinData = data.find((c: any) => c.code === code);
            if (coinData?.rate) {
                const price = Math.floor(parseFloat(coinData.rate) * 1e18);
                if (isValidPrice(price)) result[symbol] = { price, feedTimestamp: new Date().toISOString() };
            }
        });
        
    // Commodities-API: data.rates.{symbol}
    } else if (parsePattern === 'data.rates.{symbol}' && data.data?.rates) {
        symbols.forEach(symbol => {
            const mapped = sourceConfig.symbolMapping?.[symbol] || symbol;
            const rate = data.data.rates[mapped];
            if (rate) {
                const price = Math.floor((1 / parseFloat(rate)) * 1e18); // Inverted rate
                if (isValidPrice(price)) {
                    const ts = data.data.timestamp ? new Date(data.data.timestamp * 1000).toISOString() : new Date().toISOString();
                    result[symbol] = { price, feedTimestamp: ts };
                }
            }
        });
        
    // Metals.dev / MetalsAPI
    } else if (parsePattern.includes('metals.{metal}') || parsePattern.includes('rates.USD{symbol}')) {
        symbols.forEach(symbol => {
            let priceUSD: number;
            let ts: string;
            
            if (parsePattern.includes('metals.{metal}')) {
                const metalKey = sourceConfig.symbolMapping?.[symbol] || symbol;
                priceUSD = parseFloat(data.metals[metalKey]);
                ts = data.timestamps?.metal || new Date().toISOString();
            } else {
                priceUSD = parseFloat(data.rates[`USD${symbol}`]);
                ts = data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString();
            }
            
            if (!isNaN(priceUSD) && priceUSD > 0) {
                const price = Math.floor(priceUSD * 1e18);
                if (isValidPrice(price)) {
                    result[symbol] = { price, feedTimestamp: ts };
                }
            }
        });
        
    // CommodityPriceAPI: rates.{symbol} object with close price
    } else if (parsePattern === 'rates.{symbol}' && data.rates) {
        symbols.forEach(symbol => {
            const rate = data.rates[symbol];
            if (rate) {
                // Handle both direct number and object with close price
                const priceUSD = typeof rate === 'number' ? rate : (rate.close || rate.price || rate.value);
                if (priceUSD) {
                    const price = Math.floor(parseFloat(priceUSD) * 1e18);
                    if (isValidPrice(price)) {
                        const ts = data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString();
                        result[symbol] = { price, feedTimestamp: ts };
                    }
                }
            }
        });

    // TwelveData: {symbol}.price where symbol is mapped (e.g., XAU/USD)
    // Single symbol returns {"price": "..."}, multiple returns {"XAU/USD": {"price": "..."}}
    } else if (parsePattern === '{symbol}.price') {
        symbols.forEach(symbol => {
            const mapped = sourceConfig.symbolMapping?.[symbol] || symbol;
            // Handle single symbol response (direct price) vs batch response (keyed by symbol)
            const symbolData = data[mapped] || (symbols.length === 1 ? data : null);
            if (symbolData?.price) {
                const price = Math.floor(parseFloat(symbolData.price) * 1e18);
                if (isValidPrice(price)) {
                    result[symbol] = { price, feedTimestamp: new Date().toISOString() };
                }
            }
        });

    // OANDA: prices array with instrument, bids, asks - use mid price (avg of best bid/ask)
    } else if (parsePattern === 'oanda.prices' && data.prices && Array.isArray(data.prices)) {
        symbols.forEach(symbol => {
            const mapped = sourceConfig.symbolMapping?.[symbol] || symbol;
            const priceData = data.prices.find((p: any) => p.instrument === mapped);
            if (priceData?.bids?.[0]?.price && priceData?.asks?.[0]?.price) {
                const bid = parseFloat(priceData.bids[0].price);
                const ask = parseFloat(priceData.asks[0].price);
                const midPrice = (bid + ask) / 2;
                const price = Math.floor(midPrice * 1e18);
                if (isValidPrice(price)) {
                    result[symbol] = { price, feedTimestamp: priceData.time || new Date().toISOString() };
                }
            }
        });

    // Generic fallback
    } else {
        symbols.forEach(symbol => {
            try {
                const path = parsePattern.replace(/\{symbol\}/g, symbol);
                const priceUSD = extractNestedProperty(data, path);
                if (priceUSD) {
                    const price = Math.floor(parseFloat(priceUSD) * 1e18);
                    if (isValidPrice(price)) result[symbol] = { price, feedTimestamp: new Date().toISOString() };
                }
            } catch (err) {
                logError('GenericRestAdapter', new Error(`Failed to parse ${symbol}: ${err}`));
            }
        });
    }
    
    return result;
}
