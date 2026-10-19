// node --test deploy/tokenomics/plan.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildPlan, fillPlaceholders, toWei, scheduleProblems, fundingShortfall, externalSupply } = require('./plan');
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

test('treasury grants resolve to the treasury address', () => {
  const d = explicitlyAssigned();
  const plan = buildPlan(schedule, d, LIVE);
  assert.strictEqual(byKey(plan, 'ecosystemFund').grants[0].address, d.treasury);
  assert.strictEqual(byKey(plan, 'ongoingTvl').recipient, d.treasury);
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

function chainState(plan, instance) {
  const row = {
    contract: instance.contract,
    category: instance.label,
    token: plan.token,
    tgeTimestamp: plan.tgeTimestamp,
    setupAdmin: plan.setupAdmin,
    finalized: false,
  };
  if (instance.contract === 'VestingSchedule') {
    Object.assign(row, {
      cliffMonths: instance.cliffMonths,
      cliffUnlockBps: instance.cliffUnlockBps,
      vestingMonths: instance.vestingMonths,
      totalGranted: instance.fundWei,
    });
    return { row, details: { grants: Object.fromEntries(instance.grants.map(g => [g.address, g.wei])) } };
  }
  Object.assign(row, { recipient: instance.recipient, total: instance.fundWei });
  return { row, details: { yearlyWei: [...instance.yearlyWei] } };
}

test('schedule verification rejects stale immutable terms and recipients', () => {
  const plan = buildPlan(schedule, explicitlyAssigned(), LIVE);
  const team = byKey(plan, 'team');
  const teamState = chainState(plan, team);
  assert.deepStrictEqual(scheduleProblems(team, teamState.row, teamState.details, plan), []);
  teamState.row.cliffMonths += 1;
  assert.ok(scheduleProblems(team, teamState.row, teamState.details, plan).some(p => p.includes('cliffMonths')));

  const boot = byKey(plan, 'bootstrapping');
  const bootState = chainState(plan, boot);
  assert.deepStrictEqual(scheduleProblems(boot, bootState.row, bootState.details, plan), []);
  bootState.row.recipient = '1'.repeat(40);
  assert.ok(scheduleProblems(boot, bootState.row, bootState.details, plan).some(p => p.includes('recipient')));
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
});

test('released tokens remain attributed to their schedules', () => {
  const total = toWei('100000000');
  const vesting = { address: '1'.repeat(40), contract: 'VestingSchedule', totalReleased: 0 };
  const emission = { address: '2'.repeat(40), contract: 'EmissionSchedule', released: 0 };
  const balances = {
    [vesting.address]: toWei('80000000'),
    [emission.address]: toWei('17250000'),
  };
  assert.strictEqual(externalSupply(total, [vesting, emission], balances), toWei('2750000'));

  balances[vesting.address] -= toWei('1000000');
  vesting.totalReleased = toWei('1000000');
  balances[emission.address] -= toWei('250000');
  emission.released = toWei('250000');
  const external = externalSupply(total, [vesting, emission], balances);
  assert.strictEqual(external, toWei('2750000'));
  assert.deepStrictEqual(buildPlan(schedule, filled(), external).problems, []);
});
