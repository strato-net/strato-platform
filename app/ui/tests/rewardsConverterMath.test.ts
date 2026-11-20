// The converter's payout and rate math of src/utils/rewardsConverterMath.ts.
// Run with `node --experimental-strip-types --test tests/`.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatRate,
  formatShare,
  maxConvertAmount,
  payoutFor,
  rateFromDecimal,
  rateToDecimal,
} from '../src/utils/rewardsConverterMath.ts';

const E18 = 10n ** 18n;

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

test('rateFromDecimal reads a decimal rate at 18 decimals without float loss', () => {
  assert.equal(rateFromDecimal('1'), E18);
  assert.equal(rateFromDecimal('0.333333333333333333'), 333333333333333333n);
  assert.equal(rateFromDecimal('0.1'), 100000000000000000n);
  assert.equal(rateFromDecimal('1234.000000000000000001'), 1234000000000000000001n);
  assert.equal(rateFromDecimal('2.'), 2n * E18);
  assert.equal(rateFromDecimal('.5'), E18 / 2n);
  // Digits past 18 places are dropped, not rounded
  assert.equal(rateFromDecimal('0.3333333333333333339'), 333333333333333333n);
  assert.equal(rateFromDecimal(''), 0n);
  assert.equal(rateFromDecimal('abc'), 0n);
});

test('rateToDecimal gives the full value and round-trips', () => {
  assert.equal(rateToDecimal(E18), '1');
  assert.equal(rateToDecimal(333333333333333333n), '0.333333333333333333');
  assert.equal(rateToDecimal(1500000000000000000n), '1.5');
  assert.equal(rateToDecimal(1n), '0.000000000000000001');
  for (const rate of [1n, 333333333333333333n, E18, 1234000000000000000001n]) {
    assert.equal(rateFromDecimal(rateToDecimal(rate)), rate);
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
