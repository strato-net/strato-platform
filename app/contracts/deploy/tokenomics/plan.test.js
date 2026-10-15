// node --test deploy/tokenomics/plan.test.js
const test = require('node:test');
const assert = require('node:assert');
const { buildPlan, fillPlaceholders, toWei } = require('./plan');
const schedule = require('./schedule.json');
const deployment = require('./deployment.json');

// Live mainnet supply on 2026-10-15: not a whole number of tokens.
const LIVE = 3143580465753424700000000n;

const filled = () => fillPlaceholders(deployment).deployment;
const byKey = (plan, key) => plan.instances.find(i => i.key === key);

test('the checked-in deployment only lacks its placeholders', () => {
  const plan = buildPlan(schedule, deployment, LIVE);
  assert.ok(plan.problems.length > 0);
  assert.ok(plan.problems.every(p => p.includes('placeholder')), plan.problems.join('\n'));
});

test('pre-minted supply comes off public sales and bootstrapping year 1, landing on 100M', () => {
  const plan = buildPlan(schedule, filled(), LIVE);
  assert.deepStrictEqual(plan.problems, []);

  assert.strictEqual(byKey(plan, 'publicSales').fundWei, toWei('2250000'));
  assert.strictEqual(plan.remainder, LIVE - toWei('2750000'));  // 393,580.4657534247

  const sheet = schedule.categories.find(c => c.key === 'bootstrapping').yearlyWei.map(BigInt);
  const boot = byKey(plan, 'bootstrapping');
  assert.strictEqual(boot.yearlyWei[0], sheet[0] - plan.remainder);
  assert.deepStrictEqual(boot.yearlyWei.slice(1), sheet.slice(1));

  const funded = plan.instances.reduce((s, i) => s + i.fundWei, 0n);
  assert.strictEqual(funded + LIVE, toWei('100000000'));
});

test('treasury grants resolve to the treasury address', () => {
  const d = filled();
  const plan = buildPlan(schedule, d, LIVE);
  assert.strictEqual(byKey(plan, 'ecosystemFund').grants[0].address, d.treasury);
  assert.strictEqual(byKey(plan, 'ongoingTvl').recipient, d.treasury);
});

test('supply drift moves the bootstrapping deduction, never the total', () => {
  const plan = buildPlan(schedule, filled(), LIVE + toWei('1'));
  assert.deepStrictEqual(plan.problems, []);
  const funded = plan.instances.reduce((s, i) => s + i.fundWei, 0n);
  assert.strictEqual(funded + LIVE + toWei('1'), toWei('100000000'));
});

test('grants that do not add up are reported', () => {
  const d = filled();
  d.beneficiaries.team[0].tokens = '14039999';
  const plan = buildPlan(schedule, d, LIVE);
  assert.ok(plan.problems.some(p => p.startsWith('beneficiaries.team: grants total 14039999')), plan.problems.join('\n'));
});

test('a remainder larger than year 1 is reported', () => {
  const plan = buildPlan(schedule, filled(), toWei('5000000'));
  assert.ok(plan.problems.some(p => p.includes('exceeds year 1')), plan.problems.join('\n'));
});
