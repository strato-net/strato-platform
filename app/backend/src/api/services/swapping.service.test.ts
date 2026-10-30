import assert from "node:assert/strict";
import test from "node:test";
import { cirrus } from "../../utils/appApiHelper";
import * as config from "../../config/config";
import { constants } from "../../config/constants";
import { POOL_V3_CONTRACTS } from "../../config/poolV3Constants";
import { getPairSwapHistory, getSwapHistory } from "./swapping.service";

const user = "ab".repeat(20), other = "cd".repeat(20), router = "ef".repeat(20);
const a = "1".repeat(40), b = "2".repeat(40), pool = "3".repeat(40);

// Evaluate the PostgREST boolean filters against fixtures, including nested
// AND/OR groups, so broadening the user filter cannot silently broaden the pair.
function matches(row: any, expression: string): boolean {
  for (const operator of ["and", "or"]) {
    if (!expression.startsWith(`${operator}(`)) continue;
    const terms: string[] = [];
    let depth = 0, start = 0;
    const body = expression.slice(operator.length + 1, -1);
    for (let i = 0; i <= body.length; i++) {
      if (body[i] === "(") depth++;
      if (body[i] === ")") depth--;
      if (i === body.length || (body[i] === "," && depth === 0)) {
        terms.push(body.slice(start, i));
        start = i + 1;
      }
    }
    return operator === "and"
      ? terms.every(term => matches(row, term))
      : terms.some(term => matches(row, term));
  }
  const [field, operator, ...rest] = expression.split(".");
  const value = rest.join(".");
  if (operator === "in") return value.slice(1, -1).split(",").includes(row[field]);
  assert.equal(operator, "eq");
  return row[field] === value;
}

test("personal pair history includes user-signed router swaps with correct counts and pagination", async (t) => {
  const previousRouter = config.tokenRouter;
  (config as any).tokenRouter = `0x${router.toUpperCase()}`;
  t.after(() => { (config as any).tokenRouter = previousRouter; });
  const event = (id: number, sender: string, transaction_sender: string) => ({
    id, address: pool, sender, transaction_sender,
    block_timestamp: `2026-09-${String(id).padStart(2, "0")}T00:00:00Z`,
    transaction_hash: String(id),
  });
  const v2 = [
    event(1, user, user), event(3, router, user), event(9, router, other),
    event(8, other, user),
  ].map(row => ({ ...row, tokenIn: a, tokenOut: b, amountIn: "100", amountOut: "200",
    pool: { isStable: false, tokenA: { address: a, symbol: "A" }, tokenB: { address: b, symbol: "B" } } }));
  v2.push({ ...v2[1], id: 7, address: other, tokenOut: other });
  const v3 = [
    { ...event(2, other, other), recipient: user },
    { ...event(4, router, user), recipient: router },
    { ...event(10, router, other), recipient: router },
  ].map(row => ({ ...row, amount0: "100", amount1: "-200" }));
  const queries: Array<{ table: string; params: any }> = [];
  t.mock.method(cirrus, "get", async (_token: string, table: string, { params }: any) => {
    if (table === `/${constants.Token}`) return { data: [{ address: a, _symbol: "A" }, { address: b, _symbol: "B" }] };
    if (table === `/${POOL_V3_CONTRACTS.PoolV3}`) return { data: [{ address: pool, fee: 3000,
      token0: { address: a, _symbol: "A" }, token1: { address: b, _symbol: "B" } }] };
    assert.ok([`/${constants.PoolSwap}`, `/${POOL_V3_CONTRACTS.PoolV3SwapEvent}`].includes(table), table);
    queries.push({ table, params });
    const rows = (table === `/${constants.PoolSwap}` ? v2 : v3).filter(row =>
      Object.entries(params).every(([key, value]) => {
        if (["and", "or"].includes(key)) return matches(row, `${key}${value}`);
        if (["sender", "recipient", "address"].includes(key)) return matches(row, `${key}.${value}`);
        return true;
      }),
    ).sort((x, y) => y.block_timestamp.localeCompare(x.block_timestamp));
    const offset = Number(params.offset || 0);
    return { data: params.select === "count()" ? [{ count: rows.length }] : rows.slice(offset, offset + Number(params.limit)) };
  });

  const first = await getPairSwapHistory("token", `0x${a}`, b, 1, 2, `0x${user.toUpperCase()}`);
  const second = await getPairSwapHistory("token", a, b, 2, 2, user);
  assert.equal(first.totalCount, 4);
  assert.equal(second.totalCount, 4);
  assert.deepEqual(first.data.map(row => row.id), [4, 3]);
  assert.deepEqual(first.data.map(row => row.sender), [user, user]);
  assert.deepEqual(second.data.map(row => row.id), [2, 1]);
  const poolFirst = await getSwapHistory("token", pool, 1, 1, `0x${user.toUpperCase()}`);
  const poolSecond = await getSwapHistory("token", pool, 2, 1, user);
  assert.equal(poolFirst.totalCount, 2);
  assert.equal(poolSecond.totalCount, 2);
  assert.deepEqual(poolFirst.data.map(row => row.id), [3]);
  assert.deepEqual(poolSecond.data.map(row => row.id), [1]);
  assert.equal(poolFirst.data[0].sender, user);
  // Data and count queries must apply identical pair/user filters.
  for (let i = 0; i < queries.length; i += 2) {
    assert.equal(queries[i].table, queries[i + 1].table);
    for (const key of ["and", "or", "address"]) assert.equal(queries[i].params[key], queries[i + 1].params[key]);
  }

  const all = await getPairSwapHistory("token", a, b, 1, 20);
  assert.equal(all.totalCount, 7);
  assert.equal(all.data.find(row => row.id === 3)?.sender, router);
  (config as any).tokenRouter = "";
  const legacy = await getPairSwapHistory("token", a, b, 1, 20, user);
  assert.equal(legacy.totalCount, 2);
  assert.deepEqual(legacy.data.map(row => row.id), [2, 1]);
});
