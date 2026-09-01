import assert from "node:assert/strict";
import test from "node:test";
import {
  convertExternalToStratoAmount,
  getBridgeRouteMode,
} from "./bridge-route.service";

test("converts six-decimal external amounts to STRATO decimals", () => {
  assert.equal(
    convertExternalToStratoAmount(1_000_000_000n, 6),
    1_000n * 10n ** 18n
  );
});

test("applies a rebase factor before decimal conversion", () => {
  assert.equal(
    convertExternalToStratoAmount(2_000_000n, 6, (2n * 10n ** 18n).toString()),
    1n * 10n ** 18n
  );
});

test("rejects external decimals unsupported by MercataBridge", () => {
  assert.throws(
    () => convertExternalToStratoAmount(1n, 19),
    /Unsupported external token decimals/
  );
});

test("allows native ETH to bridge directly to its STRATO token", () => {
  assert.equal(
    getBridgeRouteMode(
      "0000000000000000000000000000000000000000",
      "1111111111111111111111111111111111111111",
      "1111111111111111111111111111111111111111"
    ),
    "direct"
  );
});

test("defers native ETH routing beyond its STRATO token", () => {
  assert.equal(
    getBridgeRouteMode(
      "0000000000000000000000000000000000000000",
      "1111111111111111111111111111111111111111",
      "2222222222222222222222222222222222222222"
    ),
    "unsupported-native-route"
  );
});
