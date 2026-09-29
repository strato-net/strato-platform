const { test } = require('node:test');
const assert = require('node:assert/strict');
const apiClient = require('../dist/utils/apiClient');
const logger = require('../dist/utils/logger');
const { ICE_BRENT } = require('../dist/utils/constants');
const { parseBrentExpiryCalendar, selectBrentContract } = require('../dist/adapters/brentFutures');

const HEADER = '"CONTRACT SYMBOL","FTD","LTD","FND","LND","FDD","LDD","FSD"';
const CALENDAR = [
    HEADER,
    '"=""Oct26""","04/16/2019","08/28/2026","08/28/2026","08/28/2026","","","08/31/2026",',
    '"=""Nov26""","04/16/2019","09/30/2026","09/30/2026","09/30/2026","","","10/01/2026",',
    '"=""Dec26""","04/16/2019","10/30/2026","10/30/2026","10/30/2026","","","11/02/2026",',
    '"=""Jan27""","04/16/2019","11/30/2026","11/30/2026","11/30/2026","","","12/01/2026",',
    '"=""Feb27""","04/16/2019","12/30/2026","12/30/2026","12/30/2026","","","12/31/2026",'
].join('\n');

function loadAdapters(t, now = '2026-09-29T14:00:00Z') {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
    t.mock.method(logger, 'logWarning', () => {});
    delete require.cache[require.resolve('../dist/adapters/brentFutures')];
    delete require.cache[require.resolve('../dist/adapters/genericRestAdapter')];
    return {
        ...require('../dist/adapters/brentFutures'),
        ...require('../dist/adapters/genericRestAdapter')
    };
}

function sourceConfig(assets = ['BRENT']) {
    return {
        url: 'https://commodities-api.com/api/latest',
        params: 'access_key,base=USD,symbols',
        parse: 'data.rates.{symbol}',
        apiKey: 'test-key',
        assets,
        symbolMapping: { BRENT: ICE_BRENT.AUTO_SYMBOL }
    };
}

test('uses ICE last trading dates, including August bank holiday and London DST', () => {
    const contracts = parseBrentExpiryCalendar(CALENDAR);
    const cases = [
        ['2026-08-28T18:29:59.999Z', 'BRNV26'],
        ['2026-08-28T18:30:00.000Z', 'BRNX26'],
        ['2026-08-31T12:00:00.000Z', 'BRNX26'],
        ['2026-09-30T18:29:59.999Z', 'BRNX26'],
        ['2026-09-30T18:30:00.000Z', 'BRNZ26'],
        ['2026-10-30T19:29:59.999Z', 'BRNZ26'],
        ['2026-10-30T19:30:00.000Z', 'BRNF27'],
        ['2026-11-30T19:30:00.000Z', 'BRNG27']
    ];
    for (const [time, expected] of cases) {
        assert.equal(selectBrentContract(contracts, Date.parse(time)).symbol, expected, time);
    }
    assert.throws(() => selectBrentContract(contracts, Date.parse('2027-01-01T00:00:00Z')), /no unexpired contract/);
});

test('parses leap-year expiries and rejects malformed, missing or inconsistent dates', () => {
    const leap = parseBrentExpiryCalendar(HEADER + '\n"Apr28","04/16/2019","02/29/2028","","","","","03/01/2028",');
    assert.equal(new Date(leap[0].expiresAt).toISOString(), '2028-02-29T19:30:00.000Z');
    for (const invalid of [
        '<html>Unavailable</html>',
        HEADER,
        CALENDAR.replace('"09/30/2026"', '"09/31/2026"'),
        CALENDAR.replace('"09/30/2026"', '"10/30/2026"'),
        CALENDAR.replace('"09/30/2026"', '""'),
        CALENDAR + '\n' + CALENDAR.split('\n')[1]
    ]) {
        assert.throws(() => parseBrentExpiryCalendar(invalid));
    }
});

test('both network configurations request and parse the dated contract, preserving the config', async t => {
    const { fetchPrices } = loadAdapters(t);
    const calendar = t.mock.method(apiClient, 'apiGet', async url => {
        assert.equal(url, ICE_BRENT.CALENDAR_URL);
        return { data: CALENDAR };
    });
    t.mock.method(apiClient, 'apiRequest', async options => {
        const params = new URL(options.url).searchParams;
        assert.equal(params.get('symbols'), 'BRNX26');
        assert.equal(params.get('base'), 'USD');
        return { data: { data: { rates: { BRNX26: 0.01, BRENTOIL: 0.02 }, timestamp: Date.now() / 1000 } } };
    });

    const { networks } = require('../dist/config/assets.json');
    for (const network of Object.values(networks)) {
        const config = network.sources['Commodities-API'];
        assert.equal(config.symbolMapping.BRENT, ICE_BRENT.AUTO_SYMBOL);
        const before = JSON.stringify(config);
        assert.equal((await fetchPrices(config)).BRENT.price, 100 * 1e18);
        assert.equal(JSON.stringify(config), before);
        assert.equal(network.sources.CommodityPriceAPI.symbolMapping.BRENT, 'BRENTOIL-FUT');
        assert.equal(network.sources.TwelveData.assets.includes('BRENT'), false);
        assert.equal(network.sources.TwelveData.symbolMapping.BRENT, undefined);
    }
    assert.equal(calendar.mock.callCount(), 1);
});

test('rolls automatically with a cached calendar and parses the new response key', async t => {
    const { fetchPrices } = loadAdapters(t, '2026-09-30T18:29:59Z');
    const calendar = t.mock.method(apiClient, 'apiGet', async () => ({ data: CALENDAR }));
    const requested = [];
    t.mock.method(apiClient, 'apiRequest', async options => {
        const symbol = new URL(options.url).searchParams.get('symbols');
        requested.push(symbol);
        return { data: { data: { rates: { [symbol]: symbol === 'BRNX26' ? 0.01 : 0.0125 } } } };
    });
    const config = sourceConfig();
    assert.equal((await fetchPrices(config)).BRENT.price, 100 * 1e18);
    t.mock.timers.setTime(Date.parse('2026-09-30T18:30:00Z'));
    assert.equal((await fetchPrices(config)).BRENT.price, 80 * 1e18);
    assert.deepEqual(requested, ['BRNX26', 'BRNZ26']);
    assert.equal(calendar.mock.callCount(), 1);
});

test('drops a Brent response crossing expiry while preserving other assets', async t => {
    const { fetchPrices } = loadAdapters(t, '2026-09-30T18:29:59Z');
    t.mock.method(apiClient, 'apiGet', async () => ({ data: CALENDAR }));
    t.mock.method(apiClient, 'apiRequest', async options => {
        assert.equal(new URL(options.url).searchParams.get('symbols'), 'BRNX26,XAU');
        t.mock.timers.setTime(Date.parse('2026-09-30T18:30:00Z'));
        return { data: { data: { rates: { BRNX26: 0.01, XAU: 0.0002 } } } };
    });
    const prices = await fetchPrices(sourceConfig(['BRENT', 'XAU']));
    assert.equal(prices.BRENT, undefined);
    assert.equal(prices.XAU.price, 5000 * 1e18);
});

test('uses the shared batch time if calendar resolution crosses expiry', async t => {
    const { fetchPrices } = loadAdapters(t, '2026-09-30T18:29:59Z');
    const asOf = Date.now();
    t.mock.method(apiClient, 'apiGet', async () => {
        t.mock.timers.setTime(Date.parse('2026-09-30T18:30:00Z'));
        return { data: CALENDAR };
    });
    t.mock.method(apiClient, 'apiRequest', async options => {
        assert.equal(new URL(options.url).searchParams.get('symbols'), 'BRNX26');
        return { data: { data: { rates: { BRNX26: 0.01 } } } };
    });
    assert.deepEqual(await fetchPrices(sourceConfig(), asOf), {});
});

test('rejects a dated quote that expires while waiting for the other providers', async t => {
    const { fetchPrices } = loadAdapters(t, '2026-09-30T18:29:59Z');
    t.mock.method(logger, 'logError', () => {});
    t.mock.method(apiClient, 'apiGet', async () => ({ data: CALENDAR }));
    t.mock.method(apiClient, 'apiRequest', async () => ({ data: { data: { rates: { BRNX26: 0.01 } } } }));
    const datedPrices = await fetchPrices(sourceConfig());
    const continuousPrices = { BRENT: { price: 100 * 1e18, feedTimestamp: new Date().toISOString() } };
    const results = new Map([
        ['CommodityPriceAPI', { success: true, prices: continuousPrices }],
        ['Commodities-API', { success: true, prices: datedPrices }],
        ['OANDA', { success: true, prices: continuousPrices }]
    ]);
    const loader = {
        getAllAssets: () => ({ BRENT: { targetAssetAddress: '4252454e54000000000000000000000000000000' } }),
        getSourcesForAsset: () => Array.from(results.keys())
    };
    const { aggregatePrices } = require('../dist/cronScheduler');
    assert.equal(aggregatePrices(loader, results, false, new Map())[0].failed, undefined);
    t.mock.timers.setTime(Date.parse('2026-09-30T18:30:00Z'));
    const [price] = aggregatePrices(loader, results, false, new Map());
    assert.equal(price.failed, true);
    assert.equal(price.medianPrice, 0);
    assert.equal(price.sources.some(source => source.name === 'Commodities-API'), false);
});

test('omits Brent when ICE is unavailable without requesting a generic fallback', async t => {
    const { fetchPrices } = loadAdapters(t);
    const calendar = t.mock.method(apiClient, 'apiGet', async () => { throw new Error('ICE unavailable'); });
    const prices = t.mock.method(apiClient, 'apiRequest', async options => {
        assert.equal(new URL(options.url).searchParams.get('symbols'), 'XAU');
        return { data: { data: { rates: { XAU: 0.0002 } } } };
    });
    const result = await fetchPrices(sourceConfig(['BRENT', 'XAU']));
    assert.equal(result.BRENT, undefined);
    assert.equal(result.XAU.price, 5000 * 1e18);
    assert.deepEqual(await fetchPrices(sourceConfig()), {});
    assert.equal(prices.mock.callCount(), 1);
    assert.equal(calendar.mock.callCount(), 1);
});

test('shares calendar refreshes and bounds cache use during an outage', async t => {
    const { getBrentFrontMonth } = loadAdapters(t);
    const startedAt = Date.now();
    let available = true;
    const calendar = t.mock.method(apiClient, 'apiGet', async () => {
        if (!available) throw new Error('ICE unavailable');
        return { data: CALENDAR };
    });
    await Promise.all([getBrentFrontMonth(startedAt), getBrentFrontMonth(startedAt)]);
    assert.equal(calendar.mock.callCount(), 1);

    available = false;
    t.mock.timers.setTime(startedAt + ICE_BRENT.CALENDAR_REFRESH_MS);
    assert.equal((await getBrentFrontMonth(Date.now())).symbol, 'BRNX26');
    assert.equal(calendar.mock.callCount(), 2);
    t.mock.timers.setTime(Date.now() + 1000);
    await getBrentFrontMonth(Date.now());
    assert.equal(calendar.mock.callCount(), 2);

    t.mock.timers.setTime(startedAt + ICE_BRENT.CALENDAR_MAX_AGE_MS + 1);
    await assert.rejects(getBrentFrontMonth(Date.now()), /ICE unavailable/);
    available = true;
    t.mock.timers.setTime(Date.now() + ICE_BRENT.CALENDAR_RETRY_MS);
    assert.equal((await getBrentFrontMonth(Date.now())).symbol, 'BRNZ26');
});

test('CommodityPriceAPI still requests and parses its continuous futures symbol', async t => {
    const { fetchPrices } = loadAdapters(t);
    const calendar = t.mock.method(apiClient, 'apiGet', async () => { throw new Error('unexpected calendar request'); });
    t.mock.method(apiClient, 'apiRequest', async options => {
        assert.equal(new URL(options.url).searchParams.get('symbols'), 'BRENTOIL-FUT,XAU');
        return { data: { rates: { 'BRENTOIL-FUT': { close: 103.86 }, XAU: 5000 }, timestamp: Date.now() / 1000 } };
    });
    const result = await fetchPrices({
        url: 'https://api.commoditypriceapi.com/v2/rates/latest',
        params: 'symbols',
        parse: 'rates.{symbol}',
        assets: ['BRENT', 'XAU'],
        symbolMapping: { BRENT: 'BRENTOIL-FUT' }
    });
    assert.equal(result.BRENT.price, Math.floor(103.86 * 1e18));
    assert.equal(result.XAU.price, 5000 * 1e18);
    assert.equal(calendar.mock.callCount(), 0);
});
