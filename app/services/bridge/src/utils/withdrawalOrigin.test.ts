import "../test/setupEnv";
import assert from "node:assert/strict";
import test from "node:test";
import { buildWithdrawalOrigin, parseWithdrawalOrigin } from "./withdrawalOrigin";

const BRIDGE = "0000000000000000000000000000000000001008";

test("a withdrawal tag round-trips and names the withdrawal", () => {
  const origin = buildWithdrawalOrigin(BRIDGE, "592");
  assert.equal(JSON.parse(origin).name, "STRATO bridge withdrawal 592");
  assert.equal(parseWithdrawalOrigin(BRIDGE, origin), "592");
  assert.equal(parseWithdrawalOrigin(`0x${BRIDGE.toUpperCase()}`, origin), "592");
});

test("a tag fits the Safe service's 200-character origin limit", () => {
  const longBridge = "0x" + "ab".repeat(20);
  assert.ok(buildWithdrawalOrigin(longBridge, "9".repeat(40)).length <= 200);
  assert.throws(() => buildWithdrawalOrigin(longBridge, "9".repeat(200)), /exceeds 200/);
});

test("the tag is read back whether the service returns it as JSON text or as an object", () => {
  const origin = buildWithdrawalOrigin(BRIDGE, "7");
  assert.equal(parseWithdrawalOrigin(BRIDGE, JSON.stringify(origin)), "7");
  assert.equal(parseWithdrawalOrigin(BRIDGE, JSON.parse(origin)), "7");
});

test("origins from other bridges, apps, or nothing at all are not withdrawal tags", () => {
  const otherBridge = buildWithdrawalOrigin("0000000000000000000000000000000000009999", "7");
  for (const origin of [
    otherBridge,
    "{}",
    '{"url":"https://app.safe.global","name":"Transaction Builder"}',
    `{"bridge":"${BRIDGE}","withdrawalId":7}`,
    "not json",
    "",
    null,
    undefined,
  ]) {
    assert.equal(parseWithdrawalOrigin(BRIDGE, origin), null, String(origin));
  }
});
