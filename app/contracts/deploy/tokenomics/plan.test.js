// node --test deploy/tokenomics/plan.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildPlan, fillPlaceholders, toWei, scheduleProblems, walletAllocation, fundingShortfall, externalSupply } = require('./plan');
const schedule = require('./schedule.json');
const deployment = require('./deployment.json');

// Live mainnet supply on 2026-10-19: not a whole number of tokens.
const LIVE = 3143581465753424700000000n;

const filled = () => fillPlaceholders(deployment).deployment;
const explicitlyAssigned = () => {
  const d = filled();
  d.preMinted.bootstrapping = '393581.4657534247';
  return d;
};
const byKey = (plan, key) => plan.instances.find(i => i.key === key);

test('the checked-in deployment reports placeholders and unassigned supply', () => {
  const plan = buildPlan(schedule, deployment, LIVE);
  assert.ok(plan.problems.some(p => p.includes('placeholder')), plan.problems.join('\n'));
  assert.ok(plan.problems.some(p => p.includes('393581.4657534247 pre-minted STRATO is not assigned')), plan.problems.join('\n'));
});

test('explicit pre-minted allocations come off their categories and land on 100M', () => {
  const plan = buildPlan(schedule, explicitlyAssigned(), LIVE);
  assert.deepStrictEqual(plan.problems, []);

  assert.strictEqual(byKey(plan, 'publicSales').fundWei, toWei('2250000'));
  assert.strictEqual(plan.preMintedTotal, LIVE);

  const sheet = schedule.categories.find(c => c.key === 'bootstrapping').yearlyWei.map(BigInt);
  const boot = byKey(plan, 'bootstrapping');
  assert.strictEqual(boot.yearlyWei[0], sheet[0] - toWei('393581.4657534247'));
  assert.deepStrictEqual(boot.yearlyWei.slice(1), sheet.slice(1));

  const funded = plan.instances.reduce((s, i) => s + i.fundWei, 0n);
  assert.strictEqual(funded + LIVE, toWei('100000000'));
});

test('treasury categories vest straight to the treasury, member categories through VestingClaims', () => {
  const d = explicitlyAssigned();
  const plan = buildPlan(schedule, d, LIVE);
  const fund = byKey(plan, 'ecosystemFund');
  assert.strictEqual(fund.contract, 'MonthlyVestingWallet');
  assert.strictEqual(fund.beneficiary, d.treasury);
  assert.strictEqual(byKey(plan, 'ongoingTvl').contract, 'EmissionVestingWallet');
  assert.strictEqual(byKey(plan, 'ongoingTvl').beneficiary, d.treasury);
  assert.strictEqual(byKey(plan, 'team').contract, 'VestingClaims');

  d.beneficiaries.team = [];
  assert.ok(buildPlan(schedule, d, LIVE).problems.includes('beneficiaries.team: no members'));
});

test('supply drift is rejected instead of changing bootstrapping', () => {
  const d = explicitlyAssigned();
  const clean = buildPlan(schedule, d, LIVE);
  const drifted = buildPlan(schedule, d, LIVE + toWei('1'));
  assert.ok(drifted.problems.some(p => p.includes('1 pre-minted STRATO is not assigned')), drifted.problems.join('\n'));
  assert.deepStrictEqual(byKey(drifted, 'bootstrapping').yearlyWei, byKey(clean, 'bootstrapping').yearlyWei);
});

test('grants that do not add up are reported', () => {
  const d = explicitlyAssigned();
  d.beneficiaries.team[0].tokens = '14039999';
  const plan = buildPlan(schedule, d, LIVE);
  assert.ok(plan.problems.some(p => p.startsWith('beneficiaries.team: grants total 14039999')), plan.problems.join('\n'));
});

test('an explicit emission premint larger than year 1 is reported', () => {
  const d = filled();
  d.preMinted.bootstrapping = '5000000';
  const plan = buildPlan(schedule, d, toWei('7750000'));
  assert.ok(plan.problems.some(p => p.includes('bootstrapping: pre-minted amount 5000000 exceeds year 1')), plan.problems.join('\n'));
});

// What readChain reports for a correctly deployed category: its contract row and,
// in details.wallet, its vesting wallet (the same row unless it is a VestingClaims).
function chainState(plan, instance) {
  const address = '9'.repeat(40);
  const walletAddress = instance.contract === 'VestingClaims' ? '8'.repeat(40) : address;
  const wallet = {
    contract: instance.contract === 'VestingClaims' ? 'MonthlyVestingWallet' : instance.contract,
    address: walletAddress,
    wallet: walletAddress,
    category: instance.label,
    start: plan.tgeTimestamp,
    beneficiary: instance.contract === 'VestingClaims' ? address : instance.beneficiary,
  };
  if (instance.contract === 'EmissionVestingWallet') {
    wallet.total = instance.fundWei;
    return { row: wallet, details: { wallet, yearlyWei: [...instance.yearlyWei] } };
  }
  Object.assign(wallet, {
    cliffMonths: instance.cliffMonths,
    cliffUnlockBps: instance.cliffUnlockBps,
    vestingMonths: instance.vestingMonths,
  });
  if (instance.contract === 'MonthlyVestingWallet') return { row: wallet, details: { wallet } };
  const row = {
    contract: 'VestingClaims',
    address,
    wallet: walletAddress,
    category: instance.label,
    token: plan.token,
    setupAdmin: plan.setupAdmin,
    finalized: false,
    totalGranted: instance.fundWei,
  };
  return { row, details: { wallet, grants: Object.fromEntries(instance.grants.map(g => [g.address, g.wei])) } };
}

test('deployment TGE controls the on-chain schedule independently of spreadsheet metadata', () => {
  const d = explicitlyAssigned();
  d.tge = '2027-01-15T00:00:00Z';
  const plan = buildPlan({ ...schedule, sheetTgeDate: '2000-01-01' }, d, LIVE);
  assert.strictEqual(plan.tgeTimestamp, Date.parse(d.tge) / 1000);

  const team = byKey(plan, 'team');
  const state = chainState(plan, team);
  assert.deepStrictEqual(scheduleProblems(team, state.row, state.details, plan), []);
  state.details.wallet.start += 1;
  assert.ok(scheduleProblems(team, state.row, state.details, plan).some(p => p.includes('start')));
});

test('schedule verification rejects stale immutable terms and recipients', () => {
  const plan = buildPlan(schedule, explicitlyAssigned(), LIVE);
  const team = byKey(plan, 'team');
  const teamState = chainState(plan, team);
  assert.deepStrictEqual(scheduleProblems(team, teamState.row, teamState.details, plan), []);
  teamState.details.wallet.cliffMonths += 1;
  assert.ok(scheduleProblems(team, teamState.row, teamState.details, plan).some(p => p.includes('cliffMonths')));
  teamState.details.wallet.beneficiary = '1'.repeat(40);
  assert.ok(scheduleProblems(team, teamState.row, teamState.details, plan).some(p => p.includes('wallet beneficiary')));

  const fund = byKey(plan, 'ecosystemFund');
  const fundState = chainState(plan, fund);
  assert.deepStrictEqual(scheduleProblems(fund, fundState.row, fundState.details, plan), []);
  fundState.details.wallet.cliffUnlockBps = 2500;
  assert.ok(scheduleProblems(fund, fundState.row, fundState.details, plan).some(p => p.includes('cliffUnlockBps')));

  const boot = byKey(plan, 'bootstrapping');
  const bootState = chainState(plan, boot);
  assert.deepStrictEqual(scheduleProblems(boot, bootState.row, bootState.details, plan), []);
  bootState.details.wallet.beneficiary = '1'.repeat(40);
  assert.ok(scheduleProblems(boot, bootState.row, bootState.details, plan).some(p => p.includes('beneficiary')));
});

test('schedule verification checks same-total yearly curves and every grant', () => {
  const plan = buildPlan(schedule, explicitlyAssigned(), LIVE);
  const boot = byKey(plan, 'bootstrapping');
  const bootState = chainState(plan, boot);
  bootState.details.yearlyWei[0] -= 1n;
  bootState.details.yearlyWei[1] += 1n;
  assert.ok(scheduleProblems(boot, bootState.row, bootState.details, plan).some(p => p.includes('yearlyAmounts[0]')));

  const team = byKey(plan, 'team');
  const teamState = chainState(plan, team);
  teamState.details.grants = {};
  assert.ok(scheduleProblems(team, teamState.row, teamState.details, plan).some(p => p.includes('grant')));
});

test('a finalized schedule is never funded again after releases', () => {
  const plan = buildPlan(schedule, explicitlyAssigned(), LIVE);
  const team = byKey(plan, 'team');
  const state = chainState(plan, team);
  state.row.finalized = 'true';
  state.row.setupAdmin = '0'.repeat(40);
  assert.deepStrictEqual(scheduleProblems(team, state.row, state.details, plan), []);
  assert.strictEqual(fundingShortfall(team, { finalized: true }, 0n), 0n);
  assert.strictEqual(fundingShortfall(team, { finalized: false }, team.fundWei - 1n), 1n);

  // A treasury wallet has no finalize; its releases keep counting as funded.
  const fund = byKey(plan, 'ecosystemFund');
  const wallet = { wallet: '1'.repeat(40), released: toWei('1000') };
  const allocation = walletAllocation(wallet, { [wallet.wallet]: fund.fundWei - toWei('1000') });
  assert.strictEqual(fundingShortfall(fund, wallet, allocation), 0n);
});

test('released tokens remain attributed to their schedules', () => {
  const total = toWei('100000000');
  // A VestingClaims row is counted through its wallet; what the wallet released
  // to it (held or already claimed) stays attributed to the category.
  const claims = { address: '1'.repeat(40), wallet: '3'.repeat(40), released: 0n };
  const emission = { address: '2'.repeat(40), wallet: '2'.repeat(40), released: 0n };
  const balances = {
    [claims.wallet]: toWei('80000000'),
    [emission.wallet]: toWei('17250000'),
  };
  assert.strictEqual(externalSupply(total, [claims, emission], balances), toWei('2750000'));

  balances[claims.wallet] -= toWei('1000000');
  balances[claims.address] = toWei('400000');
  claims.released = toWei('1000000');
  balances[emission.wallet] -= toWei('250000');
  emission.released = toWei('250000');
  const external = externalSupply(total, [claims, emission], balances);
  assert.strictEqual(external, toWei('2750000'));
  assert.deepStrictEqual(buildPlan(schedule, filled(), external).problems, []);
});
