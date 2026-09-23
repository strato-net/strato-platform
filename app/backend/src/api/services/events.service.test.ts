import assert from "node:assert/strict";
import test from "node:test";
import { applyDepositActionOutcomes } from "../helpers/events.helper";

const event = (index: number, name: string, attributes = {}): any => ({
  address: "bridge", transaction_hash: "settlement", event_index: index,
  event_name: name, attributes: {
    externalChainId: "1", externalTxHash: "external", recipient: "user",
    stratoRecipient: "user", ...attributes,
  },
});

test("matches separate routed, fallback and plain deposits in one transaction", () => {
  const routed = event(1, "DepositCompleted");
  const fallback = event(3, "DepositCompleted");
  const plain = event(4, "DepositCompleted");
  const history = [
    event(0, "AutoRouted", { finalToken: "route", finalAmount: "42" }), routed,
    event(2, "DepositActionFallback", { fallbackToken: "source", fallbackAmount: "100" }), fallback, plain,
  ];
  applyDepositActionOutcomes([routed, fallback, plain], history.reverse());
  assert.equal(routed.depositOutcome, "route");
  assert.equal(routed.finalAmount, "42");
  assert.equal(fallback.depositOutcome, "fallback");
  assert.equal(fallback.finalToken, "source");
  assert.equal(plain.depositOutcome, undefined);
});

test("pagination does not reuse an earlier deposit outcome", () => {
  const plain = event(2, "DepositCompleted");
  applyDepositActionOutcomes([plain], [event(0, "AutoRouted"), event(1, "DepositCompleted"), plain]);
  assert.equal(plain.depositOutcome, undefined);
});

test("rejects mismatched identity, contract and ambiguous event ordering", () => {
  for (const outcome of [
    event(0, "AutoRouted", { externalTxHash: "different" }),
    { ...event(0, "AutoRouted"), address: "other" },
    event(1, "AutoRouted"),
    { ...event(0, "AutoRouted"), event_index: undefined },
  ]) {
    const completion = event(1, "DepositCompleted");
    applyDepositActionOutcomes([completion], [outcome, completion]);
    assert.equal(completion.depositOutcome, undefined);
  }
});

async function activityHarness(t: any, configuredBridge = `0x${'ab'.repeat(20).toUpperCase()}`) {
  const config = await import('../../config/config');
  const { cirrus } = await import('../../utils/appApiHelper');
  const { getActivitiesByTypes } = await import('./events.service');
  const { ACTIVITY_FILTER_CONFIGS } = await import('./activityFilterConfigs');
  const bridge = 'ab'.repeat(20);
  const previousBridge = config.externalAssetBridge;
  (config as any).externalAssetBridge = configuredBridge;
  t.after(() => { (config as any).externalAssetBridge = previousBridge; });
  t.mock.method(config, 'getInternalAddresses', async () => [bridge, 'other-protocol']);
  const activity = (id: number, contract: string, name: string, attributes: any) => ({
    ...event(name === 'DepositCompleted' ? 1 : 2, name, attributes), id,
    address: contract === 'ExternalAssetBridge' ? bridge : 'router',
    block_timestamp: '2026-09-22T00:00:00Z',
    storage: { contract: [{ contract_name: contract }] },
  });
  const completion = activity(9, 'ExternalAssetBridge', 'DepositCompleted', { stratoRecipient: 'user' });
  const rows = [
    activity(10, 'TokenRouter', 'RouteExecuted', { caller: bridge, recipient: 'user' }),
    completion,
    activity(8, 'TokenRouter', 'RouteExecuted', { caller: 'user', recipient: 'other' }),
    activity(7, 'TokenRouter', 'RouteExecuted', { caller: 'other-protocol', recipient: 'user' }),
    activity(6, 'TokenRouter', 'RouteExecuted', { caller: 'other', recipient: 'other' }),
    activity(5, 'TokenRouter', 'RouteStepExecuted', { caller: bridge, recipient: 'user' }),
  ];
  const queries: any[] = [];
  t.mock.method(cirrus, 'get', async (_token: string, _path: string, { params }: any) => {
    if (params.event_name === 'in.(AutoRouted,DepositActionFallback,DepositCompleted)') {
      return { data: [
        { ...event(0, 'AutoRouted', { finalToken: 'metal', finalAmount: '250' }), address: bridge },
        completion,
      ] };
    }
    queries.push(params);
    const contract = params['storage.contract.contract_name'].slice(3);
    const names = params.event_name.startsWith('eq.') ? [params.event_name.slice(3)] : params.event_name.slice(4, -1).split(',');
    let filtered = rows.filter((row) => row.storage.contract[0].contract_name === contract && names.includes(row.event_name));
    if (params.and) {
      assert.equal(contract, 'TokenRouter');
      assert.equal(params.and, `(or(event_name.neq.RouteExecuted,attributes->>caller.neq.${bridge}))`);
      filtered = filtered.filter((row) => row.event_name !== 'RouteExecuted' || row.attributes.caller !== bridge);
    }
    if (params.or) {
      const matches = [...params.or.matchAll(/attributes->>(\w+).eq.([^,()]+)/g)];
      filtered = filtered.filter((row) => matches.some((match: any) => row.attributes[match[1]] === match[2]));
    }
    return { data: params.select.includes('count()') ? [{ count: filtered.length }] : filtered.slice(0, Number(params.limit)) };
  });
  const pair = (contract_name: string, event_name: string) => ({
    contract_name, event_name, filterConfig: ACTIVITY_FILTER_CONFIGS[`${contract_name}:${event_name}`],
  });
  return { getActivitiesByTypes, queries, pair };
}

for (const user of ['user', undefined]) {
  test(`${user ? 'personal' : 'global'} activity keeps one enriched bridge deposit and direct routes`, async (t) => {
    const { getActivitiesByTypes, queries, pair } = await activityHarness(t);
    const result = await getActivitiesByTypes('token', [
      pair('TokenRouter', 'RouteExecuted'), pair('ExternalAssetBridge', 'DepositCompleted'),
    ], user, 10, 0);
    assert.deepEqual(result.events.map((row: any) => row.id), user ? [9, 8, 7] : [9, 8, 7, 6]);
    assert.equal(result.total, user ? 3 : 4);
    assert.equal(result.events[0].depositOutcome, 'route');
    assert.equal(result.events[0].finalAmount, '250');
    const routeQueries = queries.filter((query) => query['storage.contract.contract_name'] === 'eq.TokenRouter');
    assert.equal(routeQueries.length, 2);
    assert.ok(routeQueries.every((query) => query.and === routeQueries[0].and));
    assert.ok(routeQueries[0].and);
    assert.equal(routeQueries[0].or, user ? '(attributes->>caller.eq.user,attributes->>recipient.eq.user)' : undefined);
  });
}

test('recent routed trades exclude bridge executions before counting and filling the page', async (t) => {
  const { getActivitiesByTypes, pair } = await activityHarness(t);
  const pairs = [pair('TokenRouter', 'RouteExecuted')];
  const first = await getActivitiesByTypes('token', pairs, 'user', 1, 0);
  const next = await getActivitiesByTypes('token', pairs, 'user', 1, 1);
  assert.equal(first.total, 2);
  assert.equal(next.total, 2);
  assert.equal((first.events[0] as any).id, 8);
  assert.equal((next.events[0] as any).id, 7);
});

test('route exclusion preserves other router events sharing the same user filter', async (t) => {
  const { getActivitiesByTypes, pair } = await activityHarness(t);
  const route = pair('TokenRouter', 'RouteExecuted');
  const result = await getActivitiesByTypes('token', [route, { ...route, event_name: 'RouteStepExecuted' }], 'user', 10, 0);
  assert.deepEqual(result.events.map((row: any) => row.id), [8, 7, 5]);
  assert.equal(result.total, 3);
});

test('an unconfigured external bridge does not produce an empty-address exclusion', async (t) => {
  const { getActivitiesByTypes, queries, pair } = await activityHarness(t, '');
  const result = await getActivitiesByTypes('token', [pair('TokenRouter', 'RouteExecuted')], 'user', 10, 0);
  assert.equal(result.total, 3);
  assert.ok(queries.every((query) => query.and === undefined));
});
