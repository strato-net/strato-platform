import assert from "node:assert/strict";
import test from "node:test";
import { AxiosError, InternalAxiosRequestConfig } from "axios";
import { cirrus } from "./appApiHelper";
import { nodeCallWatch } from "./sharedPromise";

// A per-request adapter that fails the call as the node's answer with `status`, or with no
// answer at all.
const failing = (status?: number) => (config: InternalAxiosRequestConfig) =>
  Promise.reject(
    status
      ? new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_RESPONSE, config, null, {
          status,
          statusText: "",
          data: {},
          headers: {},
          config,
        })
      : new AxiosError("socket hang up", "ECONNRESET", config)
  );

// The mark a watch is left with after one failing call made inside it.
const markAfter = async (status?: number) => {
  const watch: { failedCall?: string } = {};
  await assert.rejects(nodeCallWatch.run(watch, () => cirrus.get("token", "/BlockApps-Pool", { adapter: failing(status) })));
  return watch.failedCall;
};

test("a failed node call marks the watch it runs in; a 4xx answer other than 429 does not", async () => {
  assert.equal(await markAfter(503), "/BlockApps-Pool 503");
  assert.equal(await markAfter(429), "/BlockApps-Pool 429");
  assert.equal(await markAfter(), "/BlockApps-Pool ECONNRESET");
  assert.equal(await markAfter(404), undefined);
});

test("a failed node call outside any watch rejects with its own error", async () => {
  await assert.rejects(cirrus.get("token", "/BlockApps-Pool", { adapter: failing(503) }), {
    message: "Request failed with status code 503",
  });
});
