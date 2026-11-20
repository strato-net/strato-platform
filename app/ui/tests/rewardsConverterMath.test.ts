// The converter's payout and rate math of src/utils/rewardsConverterMath.ts.
// Run with `node --experimental-strip-types --test tests/`.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRate,
  formatRelevant,
  formatShare,
  fundingForCoverage,
  maxConvertAmount,
  payoutFor,
  rateFromDecimal,
  rateToDecimal,
} from '../src/utils/rewardsConverterMath.ts';

const E18 = 10n ** 18n;

/** A repeatable stream of integers below `bound`, so a failure names a case that fails again. */
const sequence = (seed: bigint) => (bound: bigint): bigint => {
  let value = 0n;
  for (let i = 0; i < 2; i++) {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
    value = (value << 64n) + seed;
  }
  return value % bound;
};

test('payoutFor is amount × rate ÷ 1e18, rounded down', () => {
  assert.equal(payoutFor(4n * E18, E18), 4n * E18);
  // Helium test run, step 3.3
  assert.equal(payoutFor(1000000000000000001n, 333333333333333333n), 333333333333333333n);
  // Helium test run, step 3.4: a payout that rounds to zero
  assert.equal(payoutFor(2n, 333333333333333333n), 0n);
  assert.equal(payoutFor(0n, E18), 0n);
  // Beyond what a float can hold
  assert.equal(payoutFor(311584735999999999999068943n, 2n * E18), 623169471999999999998137886n);
});

test('maxConvertAmount is the smaller of the balance and max convertible', () => {
  assert.equal(maxConvertAmount(7n * E18, 996n * E18), 7n * E18);
  assert.equal(maxConvertAmount(4002827208295469080n, E18), E18);
  assert.equal(maxConvertAmount(5n, 5n), 5n);
  assert.equal(maxConvertAmount(5n, 0n), 0n);
});

test('rateFromDecimal reads a decimal rate exactly at 18 decimals', () => {
  assert.equal(rateFromDecimal('1'), E18);
  assert.equal(rateFromDecimal('0.333333333333333333'), 333333333333333333n);
  assert.equal(rateFromDecimal('0.000000000000000001'), 1n);
  assert.equal(rateFromDecimal('1234.000000000000000001'), 1234000000000000000001n);
  assert.equal(rateFromDecimal('2.'), 2n * E18);
  assert.equal(rateFromDecimal('.5'), E18 / 2n);
  assert.equal(rateFromDecimal('007.50'), 7500000000000000000n);
  // Decimals a float cannot hold
  assert.equal(rateFromDecimal('0.1'), 100000000000000000n);
  assert.equal(rateFromDecimal('0.7'), 700000000000000000n);
  assert.equal(rateFromDecimal('0.30000000000000004'), 300000000000000040n);
  assert.equal(rateFromDecimal('1.1') + rateFromDecimal('2.2'), rateFromDecimal('3.3'));
  // Past 2^53, where a float skips integers
  assert.equal(rateFromDecimal('9007199254740993'), 9007199254740993n * E18);
  assert.equal(rateFromDecimal('9007199254740993.000000000000000001'), 9007199254740993000000000000000001n);
  // Zeros past 18 places lose nothing
  assert.equal(rateFromDecimal('1.50000000000000000000'), 1500000000000000000n);
});

test('rateFromDecimal reads nothing from a value it would have to cut or guess', () => {
  const unreadable = [
    // A digit past 18 places: reading it would drop that digit
    '0.3333333333333333339',
    '0.0000000000000000019',
    '0.0000000000000000001',
    '1.0000000000000000001',
    // A comma: a decimal comma and a thousands separator read differently
    '0,5',
    '1,5',
    '1,000.5',
    // More than one point
    '1.2.3',
    '1..2',
    // Notations the field does not take
    '1e3',
    '1e-3',
    '0x10',
    '+1',
    '1/3',
    '50%',
    '١',
    '１',
    ' 1',
    '1 ',
    '1 000',
    'abc',
    'NaN',
    'Infinity',
    '.',
    '',
  ];
  for (const value of unreadable) assert.equal(rateFromDecimal(value), 0n, JSON.stringify(value));
  // A negative value is never a rate
  assert.ok(rateFromDecimal('-1') < 0n);
  assert.ok(rateFromDecimal('-0.000000000000000001') < 0n);
});

test('rateToDecimal gives the full value and round-trips', () => {
  assert.equal(rateToDecimal(E18), '1');
  assert.equal(rateToDecimal(333333333333333333n), '0.333333333333333333');
  assert.equal(rateToDecimal(1500000000000000000n), '1.5');
  assert.equal(rateToDecimal(1n), '0.000000000000000001');
  assert.equal(rateToDecimal(9007199254740993000000000000000001n), '9007199254740993.000000000000000001');
  for (const rate of [1n, 333333333333333333n, E18, 1234000000000000000001n]) {
    assert.equal(rateFromDecimal(rateToDecimal(rate)), rate);
  }
  // Every digit survives the trip, whatever the size
  const next = sequence(7n);
  for (let i = 0; i < 2000; i++) {
    const rate = next(10n ** BigInt(1 + (i % 40))) + 1n;
    assert.equal(rateFromDecimal(rateToDecimal(rate)), rate, rate.toString());
  }
});

test('formatRate shows 4 decimals, rounded down', () => {
  assert.equal(formatRate(E18), '1.0000');
  assert.equal(formatRate(333333333333333333n), '0.3333');
  assert.equal(formatRate(999999999999999999n), '0.9999');
  assert.equal(formatRate(12345678900000000000n), '12.3456');
  assert.equal(formatRate(1n), '0.0000');
});

test('formatShare shows a percentage to 2 decimals, or a dash when the whole is zero', () => {
  assert.equal(formatShare(4n * E18, 10n * E18), '40.00%');
  assert.equal(formatShare(E18, E18), '100.00%');
  assert.equal(formatShare(1505999n, 1000000n), '150.59%');
  assert.equal(formatShare(0n, E18), '0.00%');
  assert.equal(formatShare(E18, 0n), '—');
});

test('formatRelevant keeps the first non-zero decimal and up to 4 digits after it', () => {
  const plain = (raw: bigint, decimals = 18) => formatRelevant(raw, decimals).replace(/,/g, '');
  assert.equal(plain(24201164227279683232499238n), '24201164.22727');
  assert.equal(plain(3115847359999000000000n), '3115.84735');
  // However far down the first digit is, it shows
  assert.equal(plain(1n), '0.000000000000000001');
  assert.equal(plain(750000000000000000005n), '750.000000000000000005');
  assert.equal(plain(123456789000000n), '0.00012345');
  assert.equal(plain(5000030000000000000n), '5.00003');
  // Cut, not rounded
  assert.equal(plain(999999999999999999n), '0.99999');
  // No trailing zeros
  assert.equal(plain(1100002340000000000n), '1.1');
  assert.equal(plain(1500000000000000000n), '1.5');
  assert.equal(plain(123400000000000n), '0.0001234');
  assert.equal(plain(400n * E18), '400');
  assert.equal(plain(0n), '0');
  // Other decimals
  assert.equal(plain(1123456n, 6), '1.12345');
  assert.equal(plain(42n, 0), '42');
  // The whole part is exact past 2^53 and grouped
  assert.equal(plain(9007199254740993n * E18 + 1n), '9007199254740993.000000000000000001');
  assert.match(formatRelevant(1234567n * E18, 18), /^1.234.567$/);
});

test('fundingForCoverage is what the reserve lacks to pay for that share of the supply', () => {
  const rate = E18 / 2n;
  // Paying for all 1000 takes 500: 100 are there
  assert.equal(fundingForCoverage(100n * E18, 1000n * E18, rate, 100n * E18), 400n * E18);
  assert.equal(fundingForCoverage(25n * E18, 1000n * E18, rate, 100n * E18), 25n * E18);
  // Headroom past the whole supply
  assert.equal(fundingForCoverage(150n * E18, 1000n * E18, rate, 0n), 750n * E18);
  // Already covered
  assert.equal(fundingForCoverage(20n * E18, 1000n * E18, rate, 100n * E18), 0n);
  assert.equal(fundingForCoverage(0n, 1000n * E18, rate, 0n), 0n);
  assert.equal(fundingForCoverage(100n * E18, 0n, rate, 0n), 0n);
  // Rounded up, so the funded reserve reaches the coverage
  assert.equal(fundingForCoverage(100n * E18, 10n, 333333333333333333n, 0n), 4n);
  // A small fraction of a percent of a large supply is still an amount: 0.001% of 311,584,735.9999 at 1:1
  assert.equal(
    fundingForCoverage(E18 / 1000n, 311584735999900000000000000n, E18, 0n),
    3115847359999000000000n,
  );
  // The smallest coverage the field takes, of the same supply: 1e-18 %
  assert.equal(fundingForCoverage(1n, 311584735999900000000000000n, E18, 0n), 3115848n);
});

// RewardsConverter.maxConvertible: reserve × 1e18 ÷ rate, rounded down
const maxConvertible = (reserve: bigint, rate: bigint): bigint => (reserve * E18) / rate;

/** The funded reserve's max convertible is at least `coverage` (a percentage scaled by 1e18) of `supply`. */
const covers = (reserve: bigint, rate: bigint, coverage: bigint, supply: bigint): boolean =>
  maxConvertible(reserve, rate) * 100n * E18 >= supply * coverage;

test('fundingForCoverage reaches a coverage the supply and rate do not divide evenly', () => {
  // 12.5% of 580,827,941.45… at 0.333…: one raw unit less shows as 12.49%
  const supply = 580827941454712398160809626n;
  const rate = 333333333333333333n;
  const coverage = 125n * E18 / 10n;
  const amount = fundingForCoverage(coverage, supply, rate, 0n);
  assert.equal(amount, 24201164227279683232499238n);
  assert.ok(covers(amount, rate, coverage, supply));
  assert.ok(!covers(amount - 1n, rate, coverage, supply));
  assert.equal(formatShare(maxConvertible(amount, rate), supply), '12.50%');
  assert.equal(formatShare(maxConvertible(amount - 1n, rate), supply), '12.49%');
  // A rate above 1:1, where one raw rewards unit costs several of STRATO
  assert.equal(fundingForCoverage(40n * E18, 11n, 3n * E18, 0n), 15n);
  assert.ok(covers(15n, 3n * E18, 40n * E18, 11n));
  assert.ok(!covers(14n, 3n * E18, 40n * E18, 11n));
});

test('fundingForCoverage sends the least that reaches the coverage, for any supply, rate and reserve', () => {
  const rates = ['1', '0.5', '0.7', '0.333333333333333333', '3', '2.5', '0.01', '1234.000000000000000001', '0.000000000000000007'];
  const coverages = ['40', '100', '33.33', '0.001', '150', '12.5', '99.99', '66.666666666666666666', '0.000000000000000001'];
  const next = sequence(12345n);
  for (let i = 0; i < 20000; i++) {
    const supply = next(10n ** BigInt(1 + (i % 28))) + 1n;
    const rate = rateFromDecimal(rates[i % rates.length]);
    const coverage = rateFromDecimal(coverages[(i * 7) % coverages.length]);
    const reserve = i % 3 === 0 ? 0n : next((supply * rate) / E18 + 2n);
    const amount = fundingForCoverage(coverage, supply, rate, reserve);
    const where = `supply ${supply} rate ${rate} reserve ${reserve} coverage ${coverage} amount ${amount}`;
    assert.ok(amount >= 0n, where);
    assert.ok(covers(reserve + amount, rate, coverage, supply), `short: ${where}`);
    if (amount > 0n) assert.ok(!covers(reserve + amount - 1n, rate, coverage, supply), `over: ${where}`);
  }
});

test('funding to a coverage then shows that coverage as max convertible', () => {
  const rates = ['1', '0.5', '0.7', '0.333333333333333333', '3', '2.5', '0.01'];
  const next = sequence(99n);
  for (let i = 0; i < 5000; i++) {
    // Realistic sizes: a million to a billion rewards tokens
    const supply = 10n ** 24n + next(10n ** 27n);
    const rate = rateFromDecimal(rates[i % rates.length]);
    const hundredths = next(20000n) + 1n;
    const amount = fundingForCoverage((hundredths * E18) / 100n, supply, rate, 0n);
    const expected = `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}%`;
    assert.equal(formatShare(maxConvertible(amount, rate), supply), expected, `supply ${supply} rate ${rate}`);
  }
});
