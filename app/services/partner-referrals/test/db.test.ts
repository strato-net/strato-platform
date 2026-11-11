// End-to-end check of the API and the commit step against a real Postgres.
// Needs postgres_host/postgres_password etc. in the environment; without a
// postgres_host it reports itself skipped so `npm test` still runs anywhere.
if (!process.env.postgres_host) {
  console.log("db.test: SKIPPED (set postgres_host/postgres_password to run the Postgres suite)");
  process.exit(0);
}
process.env.PARTNER_REFERRALS_DB_NAME = "partner_referrals_test";
process.env.PARTNER_API_KEYS = "creatorwire:key-a,other:key-b";
process.env.PARTNER_INTERNAL_KEY = "key-internal";
process.env.PARTNER_REF_LINK_BASE = "https://app.example/";
import assert from "assert";
import express from "express";
import { AddressInfo } from "net";
import { bootstrapDb } from "../src/db/bootstrap";
import { pool, query } from "../src/db/pool";
import { router } from "../src/api/routes";
import { commit } from "../src/indexer/cirrus";
import { State } from "../src/indexer/activity";

const alice = "11".repeat(20);
const bob = "22".repeat(20);
const owner = "33".repeat(20);

(async () => {
  await bootstrapDb();
  await query("TRUNCATE activity, referrals, codes, prices, pools, progress CASCADE");
  const server = express().use("/partner-api", router).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/partner-api`;
  const call = async (method: string, path: string, key?: string, body?: object) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  // --- Endpoint 1: issue a code ---
  assert.strictEqual((await call("POST", "/referrals/codes", undefined, { external_user_id: "u1" })).status, 401);
  const bad = await call("POST", "/referrals/codes", "nope", { external_user_id: "u1" });
  assert.deepStrictEqual([bad.status, bad.body.error.code], [401, "UNAUTHORIZED"]);
  const missing = await call("POST", "/referrals/codes", "key-a", { email: "a@example.com" });
  assert.deepStrictEqual([missing.status, missing.body.error.code], [400, "BAD_REQUEST"]);
  assert.strictEqual((await call("POST", "/referrals/codes", "key-a", { external_user_id: "u1", wallet: "0x12" })).status, 400);

  const first = await call("POST", "/referrals/codes", "key-a", { external_user_id: "u1", email: "Owner@Example.com" });
  assert.strictEqual(first.status, 200);
  assert.match(first.body.code, /^[A-Z2-9]{10}$/);
  assert.deepStrictEqual(first.body, { code: first.body.code, ref_link: `https://app.example/?ref=${first.body.code}`, created: true });
  const code = first.body.code;
  // Same user again: same code, and the wallet shared this time is taken in
  const again = await call("POST", "/referrals/codes", "key-a", { external_user_id: "u1", wallet: `0x${owner}` });
  assert.deepStrictEqual([again.body.code, again.body.created], [code, false]);
  assert.deepStrictEqual((await query("SELECT email, wallet FROM codes")).rows, [{ email: "owner@example.com", wallet: owner }]);
  // The same external id under another key is another partner's user
  const other = await call("POST", "/referrals/codes", "key-b", { external_user_id: "u1" });
  assert.notStrictEqual(other.body.code, code);
  const quiet = (await call("POST", "/referrals/codes", "key-a", { external_user_id: "u2" })).body.code;

  // --- Signups (internal) ---
  assert.strictEqual((await call("POST", "/referrals/signups", "key-a", { code, account: alice })).status, 401);
  const signup = (account: string, c: string, username?: string) =>
    call("POST", "/referrals/signups", "key-internal", { code: c, account, username }).then((r) => r.body.recorded);
  assert.strictEqual(await signup(owner, code), false, "the owner's wallet is not their referral");
  assert.strictEqual(await signup(bob, code, "OWNER@example.com"), false, "nor is the owner's email");
  assert.strictEqual(await signup(alice, "NOSUCHCODE"), false);
  assert.strictEqual(await signup(alice, code.toLowerCase(), "alice"), true);
  assert.strictEqual(await signup(alice, other.body.code), false, "first code wins");
  await query("UPDATE referrals SET created_at = '2026-11-05T00:00:00Z'");

  // --- Commit: only referred accounts' activity is kept, once ---
  const state: State = { prices: new Map([["aa".repeat(20), 10n ** 18n]]), pools: new Map(), dirtyPrices: new Set(["aa".repeat(20)]), dirtyPools: new Set() };
  const activities = [
    { eventId: 1, account: alice, blockTs: new Date("2026-11-10T00:00:00Z"), usdWad: 100555n * 10n ** 15n },
    { eventId: 2, account: alice, blockTs: new Date("2026-12-01T00:00:00Z"), usdWad: 7n * 10n ** 18n },
    { eventId: 3, account: bob, blockTs: new Date("2026-11-10T00:00:00Z"), usdWad: 999n * 10n ** 18n },
  ];
  await commit(state, activities, 3, new Date("2026-11-11T12:00:00Z"));
  await commit(state, activities, 3, new Date("2026-11-11T12:00:00Z")); // replay
  assert.strictEqual(state.dirtyPrices.size, 0);
  assert.deepStrictEqual((await query("SELECT event_id::int FROM activity ORDER BY 1")).rows, [{ event_id: 1 }, { event_id: 2 }]);
  assert.deepStrictEqual((await query("SELECT price::text FROM prices")).rows, [{ price: "1000000000000000000" }]);

  // --- Endpoint 2: metrics ---
  const window = "from=2026-11-01T00:00:00Z&to=2026-12-01T00:00:00Z";
  assert.strictEqual((await call("GET", `/referrals/metrics?${window}`)).status, 401);
  assert.strictEqual((await call("GET", "/referrals/metrics?from=2026-11-01T00:00:00Z", "key-a")).status, 400);
  assert.strictEqual((await call("GET", `/referrals/metrics?${window}&limit=0`, "key-a")).status, 400);
  const metrics = (await call("GET", `/referrals/metrics?${window}`, "key-a")).body;
  assert.strictEqual(metrics.data_as_of, "2026-11-11T12:00:00.000Z");
  assert.strictEqual(metrics.next_cursor, null);
  const byCode = Object.fromEntries(metrics.codes.map((c: any) => [c.code, c]));
  // to is exclusive: the 2026-12-01T00:00:00Z event is outside the window
  assert.deepStrictEqual(byCode[code], { code, external_user_id: "u1", referrals: 1, traders: 1, volume_usd: "100.56" });
  assert.deepStrictEqual(byCode[quiet], { code: quiet, external_user_id: "u2", referrals: 0, traders: 0, volume_usd: "0.00" });
  assert.strictEqual(metrics.codes.length, 2, "only this key's codes");
  // A later window: the signup is outside it, the trade inside
  const december = (await call("GET", "/referrals/metrics?from=2026-12-01T00:00:00Z&to=2027-01-01T00:00:00Z", "key-a")).body;
  const dec = december.codes.find((c: any) => c.code === code);
  assert.deepStrictEqual([dec.referrals, dec.traders, dec.volume_usd], [0, 1, "7.00"]);
  // Paging
  const page1 = (await call("GET", `/referrals/metrics?${window}&limit=1`, "key-a")).body;
  assert.strictEqual(page1.codes.length, 1);
  assert.strictEqual(page1.next_cursor, page1.codes[0].code);
  const page2 = (await call("GET", `/referrals/metrics?${window}&limit=1&cursor=${page1.next_cursor}`, "key-a")).body;
  assert.deepStrictEqual([page2.codes.length, page2.next_cursor], [1, null]);
  assert.notStrictEqual(page2.codes[0].code, page1.codes[0].code);

  server.close();
  await pool.end();
  console.log("db.test: OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
