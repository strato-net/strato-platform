const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, lookup, prepare, snapshot, readRows } = require('../scripts/prepareBridgeRollout');
const a = n => '0x' + String(n).padStart(40, '0');
const row = (collection_name, keys, value) => ({ collection_name, key: Object.fromEntries(keys.map((k,i) => [i ? `key${i+1}` : 'key', k])), value });
const input = { source: { nodeUrl: 'https://example.test', stratoChainId: '33056204878082667' },
  target: { stratoChainId: '33056204878082667', chainId: 84532 },
  eabRoutes: [{ stratoToken: a(1), externalToken: a(2), sourceExternalToken: a(3), sourceChainId: 1, externalDecimals: '6' }] };
const state = { stratoChainId: input.source.stratoChainId, tokens: { [a(1)]: { status: '2' } }, eab: { mappings: [
  row('routes', [a(3),1,a(1)], { externalDecimals: '6', maxPerWithdrawal: '1000000', manualReviewThreshold: '500000', depositsEnabled: true, withdrawalsEnabled: false }),
  row('mintPolicies', [a(1)], { capacity: '1000000000000000000001', refillRate: '17' }),
] } };
test('lossless JSON preserves large quantities and quoted strings', () => {
  assert.deepEqual(parse('{"x":1000000000000000000001,"s":"12 \\" hi","b":false}'), { x:'1000000000000000000001', s:'12 " hi', b:false });
});
test('current source limits prefill without inventing missing policy', () => {
  const result = prepare(input, state);
  assert.equal(result.policy.tokens[a(2)].maxPerWithdrawal, '1000000');
  assert.equal(result.policy.mintPolicies[a(1)].capacity, '1000000000000000000001');
  assert.equal(result.policy.tokens[a(2)].bucketCapacity, 'REVIEW_REQUIRED');
  assert.equal(result.policy.routes[`${a(2)}:${a(1)}`].autoRouteEnabled, true);
  assert.equal(result.depositPlan.operations[0].transactions[0].meta.items[0].stratoTokenStatus, '2');
});
test('network mixing, duplicate routes and ambiguous mapping rows fail', () => {
  assert.throws(() => prepare(input, { ...state, stratoChainId:'other' }), /network/);
  assert.throws(() => prepare({ ...input, eabRoutes:[...input.eabRoutes,...input.eabRoutes] }, state), /Duplicate/);
  assert.throws(() => lookup({ mappings:[...state.eab.mappings,...state.eab.mappings] }, 'mintPolicies', a(1)), /Ambiguous/);
});
test('different external decimals never copy raw limits', () => {
  const result = prepare({ ...input, eabRoutes:[{ ...input.eabRoutes[0], externalDecimals:'18' }] }, state);
  assert.equal(result.policy.tokens[a(2)].maxPerWithdrawal, 'REVIEW_REQUIRED');
});
test('native external routes use the canonical ETH symbol', () => {
  const route = { ...input.eabRoutes[0], externalToken: a(0), externalSymbol: 'Eth' };
  const result = prepare({ ...input, eabRoutes:[route] }, state);
  assert.equal(result.depositPlan.operations[0].transactions[0].meta.items[0].externalSymbol, 'ETH');
});
test('pagination continues under a server row cap', async () => {
  const offsets = [];
  const rows = await readRows(input.source, 'mapping', {}, 'secret', async url => {
    const offset = Number(new URL(url).searchParams.get('offset')); offsets.push(offset);
    return { ok:true, text:async () => offset < 2 ? '[{"value":123456789012345678901}]' : '[]' };
  });
  assert.deepEqual(offsets,[0,1,2]); assert.equal(rows[0].value,'123456789012345678901');
});
test('metadata network mismatch aborts before Cirrus reads', async () => {
  let requests = 0;
  await assert.rejects(snapshot(input, 'secret', async () => { requests++; return { ok:true, text:async () => '{"networkID":114784819836269}' }; }), /networkID mismatch/);
  assert.equal(requests,1);
});
test('disagreement between STRATO and vault limits requires review', () => {
  const result = prepare(input, state, { [`1:${a(3)}`]: { maxPerWithdrawal:'2000000', manualReviewThreshold:'500000', bucketCapacity:'9000000', refillRate:'10' } });
  assert.equal(result.policy.tokens[a(2)].maxPerWithdrawal, 'REVIEW_REQUIRED');
  assert.equal(result.policy.tokens[a(2)].manualReviewThreshold, '500000');
});
test('native prefills keep token-wide settings separate from route calls', () => {
  const nativeState = { ...state, native: { address:a(9), mappings:[
    row('assets',[a(1),1], { externalName:'Native', externalSymbol:'N', maxPerWithdrawal:'0', instantWithdrawalThreshold:'42', enabled:true }),
    row('tokenBridgeConfigs',[a(1)], { depositsDisabled:false, withdrawalsDisabled:true, maxOutstandingWithdrawal:'999999999999999999999' }),
    row('autoRouteEnabled',[a(1),1],true),
  ] } };
  const result = prepare({ ...input, eabRoutes:[], nativeRoutes:[{ stratoToken:a(1), sourceChainId:1 }] }, nativeState);
  assert.equal(result.native[0]['instant-withdrawal-threshold'],'42');
  assert.equal(result.native[0]['auto-route-enabled'],true);
  assert.equal(result.native[0].sharedTokenSettings.maxOutstandingWithdrawal,'999999999999999999999');
  assert.equal(result.native[0]['max-outstanding-withdrawal'],undefined);
  assert.equal(result.native[0]['representation-token'],'REVIEW_REQUIRED');
});
const { discover } = require('../scripts/prepareBridgeRollout');
test('discovery derives network, contract addresses and routes without an address registry', async () => {
  const requests = [];
  const mercataBridge = '0x0000000000000000000000000000000000001008';
  const fetch = async raw => {
    const url = new URL(raw); requests.push(url);
    const offset = Number(url.searchParams.get('offset') || 0);
    let data = [];
    if (url.pathname.endsWith('/metadata')) data = { networkID:'33056204878082667' };
    else if (!offset && url.pathname.endsWith('/BlockApps-MercataBridge')) data = [{ address:mercataBridge }];
    else if (!offset && url.pathname.endsWith('/storage')) data = [{ address:mercataBridge, data:{ tokenFactory:a(8) } }];
    else if (!offset && url.pathname.endsWith('/mapping')) data = [
      row('assets',[a(3),1], { enabled:true, stratoToken:a(1), externalDecimals:'6', externalName:'Token', externalSymbol:'TOK' }),
      row('assets',[a(4),1], { enabled:false, stratoToken:a(2), externalDecimals:'18', externalName:'Disabled', externalSymbol:'OFF' }),
      row('assets',[a(5),84532], { enabled:false, stratoToken:a(1), externalDecimals:'18', externalName:'Target Token', externalSymbol:'TT' }),
      row('assets',[a(6),999], { enabled:true, stratoToken:a(3), externalDecimals:'18', externalName:'Other Chain', externalSymbol:'OTHER' }),
    ];
    return { ok:true, text:async () => JSON.stringify(data) };
  };
  const result = await discover('https://current.test',84532,'secret',fetch,{ sourceChainId:1 });
  assert.equal(result.config.source.stratoChainId,'33056204878082667');
  assert.equal(result.config.target.stratoChainId,'33056204878082667');
  assert.equal(result.config.source.eab,mercataBridge);
  assert.equal(result.config.source.legacy,true);
  assert.equal(result.config.eabRoutes.length,1);
  assert.equal(result.config.eabRoutes[0].stratoToken,a(1));
  assert.equal(result.config.eabRoutes[0].externalToken,a(5));
  assert.equal(result.config.eabRoutes[0].externalDecimals,'18');
  assert.equal(result.config.eabRoutes[0].externalName,'Target Token');
  assert.equal(result.config.eabRoutes[0].externalSymbol,'TT');
  assert.equal(result.config.eabRoutes[0].include,false);
  assert.ok(requests.every(url => url.hostname === 'current.test'));
  assert.equal(result.missing.length,1);
});
test('discovery rejects an unconfigured custom legacy MercataBridge', async () => {
  const fetch = async raw => {
    const url = new URL(raw); let data=[];
    if (url.pathname.endsWith('/metadata')) data={networkID:'1'};
    return {ok:true,text:async()=>JSON.stringify(data)};
  };
  await assert.rejects(discover('https://current.test',84532,'secret',fetch,{eab:a(7)}),/not a discovered configured legacy MercataBridge/);
});
test('EAB settings use discovered storage and never a fixed address registry', () => {
  const { rolloutSettings } = require('../scripts/prepareBridgeRollout');
  const settings = rolloutSettings(input, { ...state, eab:{address:a(9), storage:{_owner:a(8), bridgeOperator:a(7)}, mappings:[]},
    router:{address:a(6),storage:{poolFactory:a(5)},mappings:[]} });
  assert.equal(settings.dependencies.adminRegistry,a(8));
  assert.equal(settings.dependencies.poolFactory,a(5));
  assert.equal(settings.dependencies.priceOracle,'REVIEW_REQUIRED');
  assert.equal(settings.sourceChainId,state.stratoChainId);
  assert.equal(rolloutSettings({...input,source:{...input.source,legacy:true}},state).externalAssetBridge,'REVIEW_REQUIRED');
  const targetEab = { address:a(10), storage:{ _owner:a(8), bridgeOperator:a(7), guardian:a(6), priceOracle:a(4) },
    mappings:[row('settlementVerifiers',[a(3)],true)] };
  const migrated = rolloutSettings({...input,source:{...input.source,legacy:true}}, { ...state, targetEab });
  assert.equal(migrated.externalAssetBridge,a(10));
  assert.equal(migrated.guardian,a(6));
  assert.deepEqual(migrated.settlementVerifiers,[a(3)]);
  assert.equal(migrated.dependencies.priceOracle,a(4));
});
test('deployment artifacts supply new addresses and reject a different chain', () => {
  const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
  const {applyDeploymentArtifacts}=require('../scripts/prepareBridgeRollout');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rollout-artifacts-'));
  try {
    fs.writeFileSync(path.join(dir,'external-deployment.json'),JSON.stringify({chainId:84532,depositRouterDeploymentBlock:'123'}));
    fs.writeFileSync(path.join(dir,'native.json'),JSON.stringify({contractName:'StratoNativeRepresentationBridge',network:{chainId:'84532'},addresses:{proxy:a(9)},configuration:{initParams:[a(8)]}}));
    const config={target:{chainId:84532,nativeDeployment:'native.json'},nativeRoutes:[]};
    applyDeploymentArtifacts(config,path.join(dir,'prepare.json'));
    assert.equal(config.target.nativeRepresentationBridge,a(9));
    assert.equal(config.target.safeAddress,a(8));
    assert.equal(config.target.depositRouterDeploymentBlock,'123');
    assert.throws(()=>applyDeploymentArtifacts({target:{chainId:1}},path.join(dir,'prepare.json')),/chain mismatch/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('preparation authenticates with existing STRATO OAuth username/password', async () => {
  const {getReadToken}=require('../scripts/prepareBridgeRollout');
  const env={GLOBAL_ADMIN_NAME:'reader',GLOBAL_ADMIN_PASSWORD:'password',OAUTH_URL:'https://auth.test/discovery',OAUTH_CLIENT_ID:'client',OAUTH_CLIENT_SECRET:'secret'};
  let credentials;
  const token=await getReadToken(env,async (...args)=>{credentials=args;return 'temporary-token';});
  assert.deepEqual(credentials,['reader','password']);
  assert.equal(token,'temporary-token');
  await assert.rejects(getReadToken({...env,GLOBAL_ADMIN_PASSWORD:''},async()=>assert.fail('must not authenticate')),/GLOBAL_ADMIN_PASSWORD/);
  await assert.rejects(getReadToken(env,async()=>undefined),/did not return/);
});
test('discovery uses the STRATO metadata API path, not the frontend fallback', async () => {
  let called;
  await assert.rejects(discover('https://current.test',84532,'secret',async url => {
    called=new URL(url).pathname;
    return {ok:true,status:200,text:async()=>'<html>app</html>'};
  }),/Expected JSON from \/strato-api\/eth\/v1.2\/metadata/);
  assert.equal(called,'/strato-api/eth/v1.2/metadata');
});
