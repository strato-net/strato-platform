import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as apiClient from '../utils/apiClient';
import * as logger from '../utils/logger';
import oracleConfig from '../config/assets.json';
import { fetchPrices } from './genericRestAdapter';

const quotes = [
    { trade: ['2305.5', '0.25', 1700000000.125], price: 2305.5e18, feedTimestamp: '2023-11-14T22:13:20.125Z' },
    { trade: ['391.5', '0.8', 1700000001.5], price: 391.5e18, feedTimestamp: '2023-11-14T22:13:21.500Z' },
];

for (const [networkId, network] of Object.entries(oracleConfig.networks)) {
    for (const sourceName of ['Kraken', 'Kraken xStocks'] as const) {
        test(`${networkId} ${sourceName}: fetches each pair with its own trade timestamp`, async t => {
            t.mock.method(logger, 'logError', () => {});
            const config = network.sources[sourceName];
            const requestedPairs: string[] = [];
            t.mock.method(apiClient, 'apiRequest', async (request: { url: string }) => {
                const url = new URL(request.url);
                assert.equal(url.pathname, '/0/public/Trades');
                assert.equal(url.searchParams.get('count'), '1');
                assert.equal(url.searchParams.get('assetVersion'), '1');
                assert.equal(url.searchParams.get('asset_class'), sourceName === 'Kraken xStocks' ? 'tokenized_asset' : null);
                const pair = url.searchParams.get('pair')!;
                requestedPairs.push(pair);
                const index = Object.values(config.symbolMapping).indexOf(pair);
                assert.ok(index >= 0, `Unexpected pair: ${pair}`);
                return { data: { error: [], result: { [pair]: [quotes[index % quotes.length].trade], last: '1793052078702484954' } } };
            });

            const prices = await fetchPrices(config);
            assert.deepEqual(requestedPairs.sort(), Object.values(config.symbolMapping).sort());
            assert.deepEqual(Object.keys(prices).sort(), [...config.assets].sort());
            config.assets.forEach((symbol, index) => {
                const { price, feedTimestamp } = quotes[index % quotes.length];
                assert.deepEqual(prices[symbol], { price, feedTimestamp });
            });
        });
    }
}

const kraken = Object.values(oracleConfig.networks)[0].sources.Kraken;

test('Kraken rejects a quote without a valid trade timestamp instead of substituting local time', async t => {
    const logError = t.mock.method(logger, 'logError', () => {});
    let timestamp: unknown;
    t.mock.method(apiClient, 'apiRequest', async () => ({
        data: { error: [], result: { 'ETH/USD': [['2305.5', '0.25', timestamp]] } },
    }));

    for (timestamp of [undefined, null, '', '1700000000', false, 0, -1, NaN, Infinity, 1e20]) {
        await assert.rejects(fetchPrices({ ...kraken, assets: ['ETH'] }), /no prices parsed for \[ETH\]/);
    }
    assert.equal(logError.mock.callCount(), 10);
});

test('Kraken preserves provider error reporting when one pair fails', async t => {
    const logError = t.mock.method(logger, 'logError', () => {});
    t.mock.method(apiClient, 'apiRequest', async (request: { url: string }) => ({
        data: new URL(request.url).searchParams.get('pair') === 'ETH/USD'
            ? { error: [], result: { 'ETH/USD': [quotes[0].trade] } }
            : { error: ['EQuery:Unknown asset pair'], result: {} },
    }));

    await assert.rejects(fetchPrices({ ...kraken, assets: ['ETH', 'WBTC'] }), /Kraken: EQuery:Unknown asset pair/);
    assert.equal(logError.mock.callCount(), 1);
});

test('Kraken rejects an empty trade response', async t => {
    t.mock.method(logger, 'logError', () => {});
    t.mock.method(apiClient, 'apiRequest', async () => ({ data: { error: [], result: { 'ETH/USD': [] } } }));
    await assert.rejects(fetchPrices({ ...kraken, assets: ['ETH'] }), /no prices parsed for \[ETH\]/);
});

test('other providers retain their batch requests and quote timestamps', async t => {
    t.mock.method(logger, 'logError', () => {});
    const source = Object.values(oracleConfig.networks)[0].sources.CoinGecko;
    const request = t.mock.method(apiClient, 'apiRequest', async () => ({
        data: {
            ethereum: { usd: 2305.5, last_updated_at: 1700000000 },
            'wrapped-bitcoin': { usd: 65000, last_updated_at: 1700000001 },
        },
    }));
    const prices = await fetchPrices({ ...source, assets: ['ETH', 'WBTC'] });
    assert.equal(request.mock.callCount(), 1);
    assert.deepEqual(prices, {
        ETH: { price: 2305.5e18, feedTimestamp: '2023-11-14T22:13:20.000Z' },
        WBTC: { price: 65000e18, feedTimestamp: '2023-11-14T22:13:21.000Z' },
    });
});
