import assert from 'node:assert/strict';
import test from 'node:test';
import { amountText, formatTokens } from '../src/components/terminal/format.ts';

const units = (text: string) => {
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole + fraction.padEnd(18, '0'));
};

test('amountText keeps six significant digits and rounds down', () => {
  assert.equal(amountText(units('100')), '100');
  assert.equal(amountText(units('21.093011530864197')), '21.093');
  assert.equal(amountText(units('21.093999')), '21.0939');
  assert.equal(amountText(units('0.023756123456789012')), '0.0237561');
  assert.equal(amountText(units('0.000004618748197324')), '0.00000461874');
  assert.equal(amountText(units('4208.0843764')), '4208.08');
  assert.equal(amountText(units('1234567.891')), '1234567');
  assert.equal(amountText(0n), '0');
  assert.equal(amountText(1n), '0.000000000000000001');
});

test('amountText with every digit is exact', () => {
  assert.equal(amountText(units('84.372046123456789'), Infinity), '84.372046123456789');
  assert.equal(amountText(units('84'), Infinity), '84');
  assert.equal(amountText(1n, Infinity), '0.000000000000000001');
});

test('formatTokens groups thousands and keeps small amounts readable', () => {
  assert.equal(formatTokens(units('1234567.891')), '1,234,567');
  assert.equal(formatTokens(units('4990')), '4,990');
  assert.equal(formatTokens(units('0.000236919357144998')), '0.000236919');
  assert.equal(formatTokens(0n), '0');
});
