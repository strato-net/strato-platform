import assert from "node:assert/strict";
import test from "node:test";
import type { RawGetPool } from "@strato/shared-types";
import { filterRegisteredPools } from "../helpers/swapping.helper";

const TOKEN_A = "a".repeat(40);
const TOKEN_B = "b".repeat(40);
const REGISTERED_POOL = "c".repeat(40);
const LOOKALIKE_POOL = "d".repeat(40);

const pool = (address: string): RawGetPool => ({
  address,
  tokenA: { address: TOKEN_A },
  tokenB: { address: TOKEN_B },
} as RawGetPool);

test("only pools listed in PoolFactory allPools are accepted", () => {
  const rows = [{ value: `0x${REGISTERED_POOL.toUpperCase()}` }];

  assert.deepEqual(
    filterRegisteredPools([pool(REGISTERED_POOL), pool(LOOKALIKE_POOL)], rows),
    [pool(REGISTERED_POOL)]
  );
});

test("allPools membership validates multi-token pools without pair entries", () => {
  const registered = { address: REGISTERED_POOL, coins: [TOKEN_A, TOKEN_B, "e".repeat(40)] };
  const lookalike = { address: LOOKALIKE_POOL, coins: [TOKEN_A, TOKEN_B, "f".repeat(40)] };

  assert.deepEqual(
    filterRegisteredPools([registered, lookalike], [{ value: REGISTERED_POOL }]),
    [registered]
  );
});
