import assert from "node:assert/strict";
import test from "node:test";
import {
  convertExternalToStratoAmount,
  supportsAutoRouteRouter,
} from "./bridge-route.service";

test("converts six-decimal external amounts to STRATO decimals", () => {
  assert.equal(
    convertExternalToStratoAmount(1_000_000_000n, 6),
    1_000n * 10n ** 18n
  );
});

test("applies a rebase factor before decimal conversion", () => {
  assert.equal(
    convertExternalToStratoAmount(
      2_000_000n,
      6,
      (2n * 10n ** 18n).toString()
    ),
    1n * 10n ** 18n
  );
});

test("rejects unsupported external decimals", () => {
  assert.throws(
    () => convertExternalToStratoAmount(1n, 19),
    /Unsupported external token decimals/
  );
});

test("requires DepositRouter 3.2 for routed ETH", () => {
  assert.equal(supportsAutoRouteRouter("3.1.0", true), false);
  assert.equal(supportsAutoRouteRouter("3.2.0", true), true);
  assert.equal(supportsAutoRouteRouter("3.0.0", false), true);
});
