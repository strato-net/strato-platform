import assert from "node:assert/strict";
import test from "node:test";
import { StratoError } from "../../errors/StratoError";
import { authorizationDigest, findOperatedValidator, mapRegistryRevert, profileText, splitSignature } from "./stakingAuthorization";

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

test("profileText blanks the forty-zero placeholder Cirrus emits for unset strings", () => {
  assert.equal(profileText("0000000000000000000000000000000000000000"), "");
  assert.equal(profileText("0x0000000000000000000000000000000000000000"), "");
  assert.equal(profileText(undefined), "");
  assert.equal(profileText(null), "");
  assert.equal(profileText("ipfs://meta"), "ipfs://meta");
  assert.equal(profileText("node1-0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82"), "node1-0c4cecae296c33f71f9a6e6fb57f418f9d5f7e82");
});

// The candidates reconcileSet is handed, read back from the transaction the service posts.
// The validators below are every way a listed record can look eligible and still not be
// StratoStaking.isWaiter, beside two that are.
const reconcileCandidates = async (t: any, governanceSyncEnabled: boolean): Promise<{ candidates: string[]; governanceReads: number }> => {
  // The service reads its configuration when it is first imported.
  process.env.OAUTH_DISCOVERY_URL ??= "http://localhost/discovery";
  process.env.NODE_URL ??= "http://localhost";
  const { bloc, strato } = await import("../../utils/appApiHelper");
  const config = await import("../../config/config");
  const fees = await import("./fees.service");
  const { reconcileStratoValidatorSet } = await import("./staking.service");

  const staking = "5".repeat(40);
  const governance = "0".repeat(37) + "100";
  const [matureSmall, immatureBond, immatureDelegation, matureLarge, pinnedOut, seated] = ["c", "d", "e", "f", "1", "2"].map((c) => c.repeat(40));
  const stake = (units: number) => (BigInt(units) * 10n ** 18n).toString();
  // A delay longer than the clock: the chain is in window 0 of generation 1 throughout.
  const window = (1n << 64n).toString();
  const record = (selfBond: number, delegatedStake = 0) => ({ exists: true, active: true, selfBond: stake(selfBond), delegatedStake: stake(delegatedStake) });

  const previousStaking = config.stratoStaking;
  (config as any).stratoStaking = staking;
  t.after(() => {
    (config as any).stratoStaking = previousStaking;
  });

  let governanceReads = 0;
  t.mock.method(bloc, "get", (async (_token: string, path: string) => {
    if (path.includes(staking)) {
      return {
        status: 200,
        data: {
          creditBlockReward: "function (address) returns ()",
          governance,
          governanceSyncEnabled,
          maxBatchSize: "2",
          minStake: stake(1000),
          selfBondMinimum: stake(1000),
          stakeDelaySeconds: (10n ** 12n).toString(),
          stakeDelayGeneration: "1",
          isValidator: { [seated]: true },
          operators: {
            [matureSmall]: record(1000),
            [immatureBond]: record(5000),
            [immatureDelegation]: record(1000, 9000),
            [matureLarge]: record(2000),
            [pinnedOut]: record(3000),
            [seated]: record(4000),
          },
          pendingSelfBond: { [immatureBond]: { newWindow: window, newAmount: stake(5000), oldWindow: "0", oldAmount: "0" } },
          pendingWeight: { [immatureBond]: { [window]: stake(5000) }, [immatureDelegation]: { [window]: stake(9000) } },
        },
      };
    }
    if (path.includes(governance)) {
      governanceReads += 1;
      return { status: 200, data: { pinnedOut: { [pinnedOut]: true, [matureLarge]: false } } };
    }
    throw new Error(`Unexpected node read: ${path}`);
  }) as any);
  t.mock.method(fees, "ensureFeeCoverage", async () => {});

  const posted: any[] = [];
  t.mock.method(strato, "post", (async (_token: string, _path: string, body: any) => {
    posted.push(body.txs[0].payload);
    return { status: 200, data: [{ status: "Success", hash: "0xreconcile" }] };
  }) as any);

  await reconcileStratoValidatorSet("access-token", "9".repeat(40));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].method, "reconcileSet");
  assert.equal(posted[0].contractAddress, staking);
  return { candidates: posted[0].args.candidates, governanceReads };
};

test("reconcile hands the contract its own waiters, by voting weight, before cutting to the batch size", async (t) => {
  // Not the unmatured bond (5000), not the validator pinned out (3000), not the seated one
  // (4000). The 9000 still waiting behind the fifth does not rank it above a matured 2000;
  // it ties the other 1000 on voting weight and the lower address goes first.
  const { candidates, governanceReads } = await reconcileCandidates(t, true);
  assert.deepEqual(candidates, ["f".repeat(40), "c".repeat(40)]);
  assert.equal(governanceReads, 1);
});

test("reconcile reads no pins while the governance link is off, as the contract reads none", async (t) => {
  const { candidates, governanceReads } = await reconcileCandidates(t, false);
  assert.deepEqual(candidates, ["1".repeat(40), "f".repeat(40)]);
  assert.equal(governanceReads, 0);
});
