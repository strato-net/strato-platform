// The converter's payout and rate math of src/utils/rewardsConverterMath.ts.
// Run with `node --experimental-strip-types --test tests/`.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatAmount,
  formatFraction,
  formatRate,
  formatRelevant,
  formatShare,
  fundingForCoverage,
  maxConvertAmount,
  payoutFor,
  rateFromDecimal,
  rateToDecimal,
  shareToDecimal,
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

test('formatRate shows 4 decimals, rounded down, and one for a whole number', () => {
  assert.equal(formatRate(E18), '1.0');
  assert.equal(formatRate(25n * E18), '25.0');
  assert.equal(formatRate(E18 + 1n), '1.0');
  assert.equal(formatRate(E18 + 10n ** 14n), '1.0001');
  assert.equal(formatRate(333333333333333333n), '0.3333');
  assert.equal(formatRate(999999999999999999n), '0.9999');
  assert.equal(formatRate(12345678900000000000n), '12.3456');
  assert.equal(formatRate(500000000000000000n), '0.5000');
  assert.equal(formatRate(50000000000000000n), '0.0500');
  assert.equal(formatRate(0n), '0.0');
});

test('formatRate keeps the leading digits of a rate too small for 4 decimals, with dots for a long run of zeros', () => {
  assert.equal(formatRate(12345678900000000n), '0.01234');
  assert.equal(formatRate(123456789000000n), '0.0001234');
  assert.equal(formatRate(100000000000000n), '0.0001');
  assert.equal(formatRate(12345678900000n), '0.0...1234');
  assert.equal(formatRate(7n), '0.0...7');
  assert.equal(formatRate(1n), '0.0...1');
});

test('formatFraction keeps the leading digits of an amount below one token, at any token decimals', () => {
  assert.equal(formatFraction(500000000000000000n, 18), '0.50');
  assert.equal(formatFraction(1234567890000000n, 18), '0.001234');
  assert.equal(formatFraction(42n, 18), '0.0...42');
  assert.equal(formatFraction(0n, 18), '0.0');
  assert.equal(formatFraction(500000n, 6), '0.50');
  assert.equal(formatFraction(42n, 6), '0.0...42');
  assert.equal(formatFraction(420n, 6), '0.00042');
});

test('formatAmount shows 2 decimals up to the places given, rounded down, and one for a whole number', () => {
  const strato = { address: '2'.repeat(40), symbol: 'STRATO', decimals: 18 };
  assert.equal(formatAmount(1250n * E18, strato, 6), '1,250.0 STRATO');
  assert.equal(formatAmount(E18, strato, 4), '1.0 STRATO');
  assert.equal(formatAmount('0', strato, 4), '0.0 STRATO');
  assert.equal(formatAmount(1250750000000000000000n, strato, 6), '1,250.75 STRATO');
  assert.equal(formatAmount(1250500000000000000000n, strato, 6), '1,250.50 STRATO');
  assert.equal(formatAmount('6992681116999999999999', strato, 6), '6,992.681116 STRATO');
  assert.equal(formatAmount('6992681116999999999999', strato, 4), '6,992.6811 STRATO');
  // Whole as far as it is shown
  assert.equal(formatAmount(E18 + 1n, strato, 6), '1.0 STRATO');
  assert.equal(formatAmount(1000001n * 10n ** 12n, strato, 6), '1.000001 STRATO');
  assert.equal(formatAmount(5000000n, { ...strato, decimals: 6 }, 4), '5.0 STRATO');
});

test('formatShare shows 2 decimals from 1% up, rounded down, one for a whole number, or a dash when the whole is zero', () => {
  assert.equal(formatShare(4n * E18, 10n * E18), '40.0%');
  assert.equal(formatShare(E18, E18), '100.0%');
  assert.equal(formatShare(1505999n, 1000000n), '150.59%');
  assert.equal(formatShare(1n, 100n), '1.0%');
  assert.equal(formatShare(0n, E18), '0.0%');
  assert.equal(formatShare(E18, 0n), '—');
});

test('formatShare keeps the leading digits of a share below 1%, with dots for a long run of zeros', () => {
  const whole = 10n ** 20n;
  // `part` is the percentage scaled by 1e18
  assert.equal(formatShare(999999999999999999n, whole), '0.9999%');
  assert.equal(formatShare(500000000000000000n, whole), '0.50%');
  assert.equal(formatShare(123456789000000000n, whole), '0.1234%');
  assert.equal(formatShare(50000000000000000n, whole), '0.05%');
  assert.equal(formatShare(3400000000000000n, whole), '0.0034%');
  assert.equal(formatShare(123456789000000n, whole), '0.0001234%');
  assert.equal(formatShare(100100000000000n, whole), '0.0001001%');
  assert.equal(formatShare(12345678900000n, whole), '0.0...1234%');
  assert.equal(formatShare(10009n, whole), '0.0...1%');
  assert.equal(formatShare(1n, whole), '0.0...1%');
  // Under the 18th decimal of a percent nothing is left to show
  assert.equal(formatShare(1n, whole * 10n), '0.0%');
});

test('shareToDecimal is the percentage to its 18th decimal, rounded down, or a dash when the whole is zero', () => {
  const whole = 10n ** 20n;
  assert.equal(shareToDecimal(4n * E18, 10n * E18), '40%');
  assert.equal(shareToDecimal(125n, 1000n), '12.5%');
  assert.equal(shareToDecimal(12345678900000n, whole), '0.0000123456789%');
  assert.equal(shareToDecimal(1n, whole), '0.000000000000000001%');
  assert.equal(shareToDecimal(1n, 3n), '33.333333333333333333%');
  assert.equal(shareToDecimal(2n, 3n), '66.666666666666666666%');
  assert.equal(shareToDecimal(0n, E18), '0%');
  assert.equal(shareToDecimal(E18, 0n), '—');
  // Sizes a number cannot hold: one raw unit of the rewards token short of 12.5%
  assert.equal(shareToDecimal(72603492681839049770101206n, 580827941454712398160809626n), '12.5%');
  assert.equal(shareToDecimal(72603492681839049770101203n, 580827941454712398160809626n), '12.499999999999999999%');
});

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
    const cents = (hundredths % 100n).toString().padStart(2, '0');
    const expected = `${hundredths / 100n}.${cents === '00' ? '0' : cents}%`;
    assert.equal(formatShare(maxConvertible(amount, rate), supply), expected, `supply ${supply} rate ${rate}`);
  }
});
