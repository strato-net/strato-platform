import assert from "node:assert/strict";
import test from "node:test";
import { cachedAnonymousQuote } from "./anonymousQuoteCache.service";

test("anonymous quotes coalesce, expire, isolate mutations and do not cache errors or authenticated requests", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  const load = async () => ({ amount: ++calls, deadline: 1234 });
  const results = await Promise.all([cachedAnonymousQuote("quote", undefined, load), cachedAnonymousQuote("quote", undefined, load)]);
  assert.equal(calls, 1);
  results[0].amount = 99;
  assert.equal((await cachedAnonymousQuote("quote", undefined, load)).amount, 1);
  await cachedAnonymousQuote("quote", "user", load);
  assert.equal(calls, 2);
  now += 1001;
  assert.equal((await cachedAnonymousQuote("quote", undefined, load)).amount, 3);
  await assert.rejects(cachedAnonymousQuote("failure", undefined, async () => { throw Error("unavailable"); }));
  assert.equal((await cachedAnonymousQuote("failure", undefined, load)).amount, 4);
});
