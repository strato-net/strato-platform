import assert from "node:assert/strict";
import test from "node:test";
import { StratoError } from "../../errors/StratoError";
import { authorizationDigest, findOperatedValidator, mapRegistryRevert, splitSignature } from "./stakingAuthorization";

// Pinned by tests/Staking/ValidatorRegistry.test.sol (it_matches_off_chain_digests_and_recovers_real_signatures).
const VECTOR = {
  registry: "0x1111111111111111111111111111111111111111",
  validator: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  operator: "0x2222222222222222222222222222222222222222",
  nonce: 7n,
  digest: "0xb40f7746740b70994c96fae88ae656ddfaf42a06872675fdde41dbee73e79bd3",
};

test("authorization digest matches the contract's packed encoding", () => {
  assert.equal(authorizationDigest(VECTOR.registry, VECTOR.validator, VECTOR.operator, VECTOR.nonce), VECTOR.digest);
  // Prefix-less lowercase addresses (the service's normalised form) hash the same.
  assert.equal(
    authorizationDigest(VECTOR.registry.slice(2), VECTOR.validator.slice(2).toLowerCase(), VECTOR.operator.slice(2), VECTOR.nonce),
    VECTOR.digest
  );
  // The nonce is 32 bytes of the preimage: changing it changes the digest.
  assert.notEqual(authorizationDigest(VECTOR.registry, VECTOR.validator, VECTOR.operator, 0n), VECTOR.digest);
});

const R = "b5eefa7d20ec97007bd0fb457ac8da3140d90a4f163337c3de9778650b83d121";
const S = "545274b8ace3c5a2044b42023d102bdc9cce776288710f2d4a09ef1751ba939f";

test("splitSignature accepts r||s||v with v as 0/1 or 27/28 and returns decimal r, s", () => {
  for (const [vHex, vDec] of [["00", "0"], ["01", "1"], ["1b", "27"], ["1c", "28"]]) {
    const split = splitSignature(`0x${R}${S}${vHex}`);
    assert.ok(split);
    assert.equal(split.v, vDec);
    assert.equal(split.r, BigInt(`0x${R}`).toString());
    assert.equal(split.s, BigInt(`0x${S}`).toString());
  }
  // Prefix optional, surrounding whitespace tolerated.
  assert.deepEqual(splitSignature(` ${R}${S}1b `), splitSignature(`0x${R}${S}1b`));
});

test("splitSignature treats an absent signature as null and rejects malformed ones", () => {
  assert.equal(splitSignature(undefined), null);
  assert.equal(splitSignature(null), null);
  assert.equal(splitSignature(""), null);
  assert.throws(() => splitSignature(`0x${R}${S}`), /130 hex characters/);          // 128: v missing
  assert.throws(() => splitSignature(`0x${R}${S}1b00`), /130 hex characters/);      // 132: too long
  assert.throws(() => splitSignature(`0x${R}${S}zz`), /130 hex characters/);        // not hex
  assert.throws(() => splitSignature(`0x${R}${S}02`), /v must be 0, 1, 27 or 28/);  // bad recovery id
  try {
    splitSignature(`0x${R}${S}05`);
    assert.fail("expected a throw");
  } catch (error: any) {
    assert.equal(error.statusCode, 400);
  }
});

test("mapRegistryRevert translates the registry's consent reverts and keeps the original text", () => {
  const cases: [string, number, RegExp][] = [
    ["VR: validator did not authorize operator", 409, /Authorization invalid or already used/],
    ["VR: already registered", 409, /already listed/],
    ["VR: same operator", 409, /already operate/],
    ["VR: validator missing", 404, /not listed/],
  ];
  for (const [revert, status, message] of cases) {
    const original = new StratoError(`Transaction failed: revert ${revert}`, 400);
    const mapped = mapRegistryRevert(original) as any;
    assert.notEqual(mapped, original);
    assert.ok(mapped instanceof StratoError);
    assert.equal(mapped.status, status);
    assert.match(mapped.message, message);
    assert.equal((mapped as any).detail, original.message);
  }
});

test("mapRegistryRevert passes every other error through unchanged", () => {
  const other = new StratoError("Insufficient gas fee coverage", 400);
  assert.equal(mapRegistryRevert(other), other);
  const plain = new Error("network down");
  assert.equal(mapRegistryRevert(plain), plain);
  assert.equal(mapRegistryRevert("VR: staking missing"), "VR: staking missing");
  assert.equal(mapRegistryRevert(undefined), undefined);
});

test("findOperatedValidator returns the active record the account operates, case- and prefix-insensitive", () => {
  const records = [
    { validator: "aaaa000000000000000000000000000000000001", operator: "7b1f8cd02cd09ab9510e30fc8e15ff898a639771", active: true },
    { validator: "aaaa000000000000000000000000000000000002", operator: "3b23c91aedc1c0f4ad442c7248f6e49cc1547c1d", active: false },
    { validator: "aaaa000000000000000000000000000000000003", operator: "3b23c91aedc1c0f4ad442c7248f6e49cc1547c1d", active: true },
  ];
  assert.equal(findOperatedValidator(records, "0x3B23C91AEDC1C0F4AD442C7248F6E49CC1547C1D")?.validator, "aaaa000000000000000000000000000000000003");
  assert.equal(findOperatedValidator(records, "7b1f8cd02cd09ab9510e30fc8e15ff898a639771")?.validator, "aaaa000000000000000000000000000000000001");
  // Inactive (delisted) records do not count.
  assert.equal(findOperatedValidator(records.filter((r) => !r.active), "3b23c91aedc1c0f4ad442c7248f6e49cc1547c1d"), null);
  // Nobody / empty input.
  assert.equal(findOperatedValidator(records, "0x2222222222222222222222222222222222222222"), null);
  assert.equal(findOperatedValidator([], "0x3b23c91aedc1c0f4ad442c7248f6e49cc1547c1d"), null);
  assert.equal(findOperatedValidator(records, ""), null);
});
