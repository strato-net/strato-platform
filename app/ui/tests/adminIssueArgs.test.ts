import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildValidatedAdminIssueArgs,
  validateAdminIssueArg,
  type AdminIssueArgType,
} from '../src/components/admin/adminIssueArgs.ts';

const ADDRESS: AdminIssueArgType = { tag: 'Address' };
const UINT256: AdminIssueArgType = { tag: 'Int' };
const BOOL: AdminIssueArgType = { tag: 'Bool' };
const STRING: AdminIssueArgType = { tag: 'String' };
const ENUM: AdminIssueArgType = { tag: 'Enum', typedef: 'ActionType' } as AdminIssueArgType;
const VARIADIC: AdminIssueArgType = { tag: 'Variadic' };
const STRING_ARRAY: AdminIssueArgType = { tag: 'Array', entry: STRING };
const UINT_ARRAY: AdminIssueArgType = { tag: 'Array', entry: UINT256 };
const ADDRESS_ARRAY: AdminIssueArgType = { tag: 'Array', entry: ADDRESS };
const NESTED_UINT_ARRAY: AdminIssueArgType = { tag: 'Array', entry: UINT_ARRAY };
const STRUCT_ARRAY: AdminIssueArgType = {
  tag: 'Array',
  entry: { tag: 'Struct' } as AdminIssueArgType,
};

const types: Array<[string, { type: AdminIssueArgType }]> = [
  ['recipient', { type: ADDRESS }],
  ['amount', { type: UINT256 }],
  ['enabled', { type: BOOL }],
  ['label', { type: STRING }],
  ['labels', { type: STRING_ARRAY }],
];

const accept = (type: AdminIssueArgType, value: unknown): unknown => {
  const [success, result] = validateAdminIssueArg(type, value);
  assert.equal(success, true, `expected ${JSON.stringify(String(value))} to validate, got: ${String(result)}`);
  return result;
};

const reject = (type: AdminIssueArgType, value: unknown): string => {
  const [success, result] = validateAdminIssueArg(type, value);
  assert.equal(success, false, `expected ${JSON.stringify(String(value))} to be rejected, got: ${JSON.stringify(result)}`);
  assert.equal(typeof result, 'string', 'a rejection must carry a message the form can show');
  return result as string;
};

test('the create-issue form only changes an argument where the chain requires it', () => {
  const entered = [
    { value: 'ABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD' },
    { value: '900719925474099312345678901234567890' },
    { value: 'TRUE' },
    { value: '  preserve surrounding spaces  ' },
    { value: '["  first  ", "second"]' },
  ];

  const submitted = buildValidatedAdminIssueArgs(entered, types);

  assert.deepEqual(submitted, [
    // addresses gain the 0x prefix and lose case, which the chain treats as the same value
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    '900719925474099312345678901234567890',
    true,
    '  preserve surrounding spaces  ',
    ['  first  ', 'second'],
  ]);

  assert.equal(
    submitted[1],
    entered[1].value,
    'large integer digits must reach the API without precision loss',
  );
  assert.equal(
    submitted[3],
    entered[3].value,
    'a string argument must reach the chain exactly as typed, whitespace included',
  );
  assert.equal(
    (submitted[4] as string[])[0],
    '  first  ',
    'strings nested in an array must be preserved too',
  );
});

test('the fall-through branch preserves every tag it carries, not just String', () => {
  // This layer must not decide on the backend's behalf, since the trimmed value is
  // what gets hashed. The backend trims bytes and decimal itself; enum and variadic
  // it does not, so a padded one now fails on chain rather than being corrected.
  assert.equal(accept(VARIADIC, '  0xd200  '), '  0xd200  ');
  assert.equal(accept(ENUM, '  Deposit  '), '  Deposit  ');
  assert.equal(accept({ tag: 'Bytes' }, ' 0xdeadbeef '), ' 0xdeadbeef ');
  assert.equal(accept({ tag: 'UnknownLabel', contents: 'Foo' } as AdminIssueArgType, ' x '), ' x ');
});

test('characters a text editor substitutes survive inside array elements', () => {
  // Valid JSON: curly quotes and invisible spaces are ordinary characters inside a
  // string literal, so they belong to the value and must not be normalized away.
  assert.deepEqual(accept(STRING_ARRAY, '["it’s"]'), ['it’s']);
  assert.deepEqual(accept(STRING_ARRAY, '["a\u00A0b"]'), ['a\u00A0b']);
  assert.deepEqual(accept(STRING_ARRAY, '["a\u200Bb"]'), ['a\u200Bb']);
  assert.deepEqual(accept(STRING_ARRAY, '["a\uFEFFb"]'), ['a\uFEFFb']);

  assert.deepEqual(
    accept(STRING_ARRAY, '["“quoted”"]'),
    ['“quoted”'],
    'curly quotes inside an element must not be re-read as delimiters, which split it in two',
  );
});

test('invisible characters outside a string literal are layout, and do not block a paste', () => {
  // A BOM or non-breaking space between tokens cannot be part of any value, so
  // normalizing it is provably lossless — and rejecting it would refuse a paste
  // whose values are entirely correct.
  assert.deepEqual(accept(ADDRESS_ARRAY, '\uFEFF["d200"]'), ['0xd200']);
  assert.deepEqual(accept(ADDRESS_ARRAY, '["d200",\u00A0"d201"]'), ['0xd200', '0xd201']);
  assert.deepEqual(accept(UINT_ARRAY, '[1,\u20092]\u200B'), ['1', '2']);
  assert.deepEqual(accept(UINT_ARRAY, '[\u00A01\u00A0]'), ['1']);
});

test('an invisible character cannot splice two tokens into one value', () => {
  // Folding these to a space rather than deleting them is what keeps this safe:
  // deleting joins whatever sat on either side, so `[1<ZWSP>2]` would be read as the
  // fabricated `[12]`, and a misplaced one inside a wei amount would go unnoticed.
  for (const [label, input] of [
    ['zero-width space', '[1​2]'],
    ['byte order mark', '[1﻿2]'],
    ['zero-width non-joiner', '[1‌2]'],
    ['inside a wei amount', '[1000​000000000000000]'],
  ] as Array<[string, string]>) {
    assert.match(reject(UINT_ARRAY, input), /^Invalid JSON: /, `for ${label}`);
  }
  assert.match(reject({ tag: 'Array', entry: BOOL }, '[tr​ue]'), /^Invalid JSON: /);
});

test('SolidVM struct notation is accepted, since it is the form the chain emits', () => {
  // A type name before `{` cannot occur in JSON, so dropping it cannot change a
  // value — and this is how an event's struct arg reads in Cirrus. (The vote
  // screen re-serializes to plain JSON, covered by the next assertion.)
  assert.deepEqual(
    accept(STRUCT_ARRAY, '[ActionableEvent{"eventName": "Deposit", "actionType": 1}]'),
    [{ eventName: 'Deposit', actionType: 1 }],
  );
  assert.deepEqual(
    accept(STRUCT_ARRAY, '[{"eventName": "Deposit", "actionType": 1}]'),
    [{ eventName: 'Deposit', actionType: 1 }],
    'plain JSON must keep working',
  );
  // A quoted type name is a value, not a prefix.
  assert.deepEqual(accept(STRING_ARRAY, '["Foo{a}"]'), ['Foo{a}']);
  // The prefix rule must not swallow a JSON keyword and invent an object from text
  // the author got wrong. Solidity reserves these, so no struct can be named them.
  for (const keyword of ['[null{"a":1}]', '[true{"a":1}]', '[false{"a":1}]']) {
    assert.match(reject(STRING_ARRAY, keyword), /^Invalid JSON: /, `for ${keyword}`);
  }
  assert.deepEqual(
    accept(STRUCT_ARRAY, '[truex{"a":1}]'),
    [{ a: 1 }],
    'a struct whose name merely starts with a keyword is still a struct',
  );
});

test('malformed array JSON is reported, never repaired', () => {
  // Each of these used to be silently rewritten into a valid array, submitting a
  // value — and sometimes an element count — that nobody entered.
  // The reason text comes from JSON.parse and is engine-authored, so only our own
  // prefix is asserted; the messages this file pins exactly are the ones we write.
  for (const malformed of [
    '["0xd200"',
    '["0xd200",]',
    "['0xd200']",
    '[0xd200]',
    'd200',
    '["a" "b"]',
    '',
    '   ',
  ]) {
    assert.match(
      reject(ADDRESS_ARRAY, malformed),
      /^Invalid JSON: \S/,
      `for ${JSON.stringify(malformed)}`,
    );
  }

  assert.match(
    reject(STRING_ARRAY, '[“a”]'),
    /Replace curly quotes/,
    'curly quotes used as delimiters should say so, since only the author knows which was meant',
  );
  assert.doesNotMatch(
    reject(STRING_ARRAY, '["it’s",]'),
    /Replace curly quotes/,
    'a curly apostrophe inside a value is correct there; advising its removal would corrupt it',
  );

  assert.equal(reject(ADDRESS_ARRAY, '"0xd200"'), 'Invalid array');
  assert.equal(reject(ADDRESS_ARRAY, '{"0":"0xd200"}'), 'Invalid array');
});

test('json-bigint leniency that alters a value is rejected, not accepted', () => {
  // json-bigint turns a malformed \u escape into NUL plus whatever followed, so a
  // Windows path or a stray backslash would reach the chain as a different string.
  for (const corrupting of ['["C:\\users"]', '["a\\uq"]', '["\\uZZZZ"]', '["a\\x41"]']) {
    assert.match(reject(STRING_ARRAY, corrupting), /^Invalid JSON: /, `for ${corrupting}`);
  }
  // Raw control characters, trailing bytes and leading zeros are all invalid JSON
  // that json-bigint's own parser waves through.
  assert.match(reject(STRING_ARRAY, '["a\u0000b"]'), /^Invalid JSON: /);
  assert.match(reject(STRING_ARRAY, '["a\u001Fb"]'), /^Invalid JSON: /);
  assert.match(reject(UINT_ARRAY, '[1]\u0000'), /^Invalid JSON: /);
  assert.match(reject(UINT_ARRAY, '[01]'), /^Invalid JSON: /);
  assert.match(reject(UINT_ARRAY, '[5.]'), /^Invalid JSON: /);

  // A well-formed escape is still a value.
  assert.deepEqual(accept(STRING_ARRAY, '["a\\u0041b"]'), ['aAb']);
  assert.deepEqual(accept(STRING_ARRAY, '["C:\\\\users"]'), ['C:\\users']);
});

test('array element types are still validated and coerced', () => {
  assert.deepEqual(accept(ADDRESS_ARRAY, '[]'), []);
  assert.deepEqual(accept(ADDRESS_ARRAY, '["d200","0xD201"]'), ['0xd200', '0xd201']);
  assert.deepEqual(accept(BOOL, 'false'), false);

  assert.deepEqual(
    accept(UINT_ARRAY, '[1,900719925474099312345678901234567890]'),
    ['1', '900719925474099312345678901234567890'],
    'every digit of an oversized element must survive as a string',
  );

  assert.deepEqual(
    accept(NESTED_UINT_ARRAY, '[[1,2],[3]]'),
    [['1', '2'], ['3']],
    'an array-of-arrays type recurses into each element',
  );

  reject(UINT_ARRAY, '[1.5]');
  reject(STRING_ARRAY, '[1]');
});

test('a parse failure never escapes as an unrenderable value', () => {
  // Deep nesting overflows the parser's stack; the form still gets a string.
  const deep = '['.repeat(20000) + '1' + ']'.repeat(20000);
  assert.match(reject(UINT_ARRAY, deep), /^Invalid JSON: /);
  // Every rejection above already asserts typeof === 'string' via reject().
});
