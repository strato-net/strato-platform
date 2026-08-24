import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.WORKSPACE_DIR ??= "/tmp/tracking-bot-test";

describe("diff policy", async () => {
  const { checkDiffPolicy } = await import("../workspace/checks");
  const { evaluateBuild } = await import("../ci/jenkins");

  it("requires tests for substantive changes", () => {
    const verdict = checkDiffPolicy(["app/services/tracking/src/index.ts", "BUILD_METADATA"]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.missingTests, true);
    assert.deepEqual(verdict.disallowed, []);
  });
  it("passes when tests accompany the change", () => {
    const verdict = checkDiffPolicy(["app/services/tracking/src/index.ts", "app/services/tracking/test/src/links.test.ts"]);
    assert.equal(verdict.ok, true);
  });
  it("flags files outside the allowed area", () => {
    const verdict = checkDiffPolicy(["app/ui/src/main.tsx", "app/services/tracking/test/src/x.test.ts"]);
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.disallowed, ["app/ui/src/main.tsx"]);
  });
  it("does not require tests for docs-only changes", () => {
    const verdict = checkDiffPolicy(["app/services/tracking/README.md"]);
    assert.equal(verdict.ok, true);
  });
  it("rejects an empty diff", () => {
    assert.equal(checkDiffPolicy([]).ok, false);
  });

  it("evaluates Jenkins results with the unstable rule", () => {
    assert.equal(evaluateBuild(null), "not_found");
    assert.equal(evaluateBuild({ number: 1, url: "", building: true, result: null, timestamp: 0, stages: [] }), "pending");
    assert.equal(evaluateBuild({ number: 1, url: "", building: false, result: "SUCCESS", timestamp: 0, stages: [] }), "success");
    assert.equal(evaluateBuild({ number: 1, url: "", building: false, result: "FAILURE", timestamp: 0, stages: [] }), "failure");
    assert.equal(
      evaluateBuild({ number: 1, url: "", building: false, result: "UNSTABLE", timestamp: 0, stages: [{ id: "1", name: "Tracking Server Tests", status: "SUCCESS" }, { id: "2", name: "Contract tests", status: "UNSTABLE" }] }),
      "success"
    );
    assert.equal(
      evaluateBuild({ number: 1, url: "", building: false, result: "UNSTABLE", timestamp: 0, stages: [{ id: "1", name: "Tracking Server Tests", status: "FAILED" }] }),
      "failure"
    );
    assert.equal(evaluateBuild({ number: 1, url: "", building: false, result: "UNSTABLE", timestamp: 0, stages: [] }), "failure");
  });
});
