import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clarifyComment, parseClarifyQuestions, renderPlan, statusComment } from "../pipeline/comments";

describe("comment rendering", () => {
  it("renders a plan with all sections", () => {
    const md = renderPlan({
      summary: "Add X",
      steps: ["one", "two"],
      files: [{ path: "a.ts", change: "add" }],
      migration: "003_x adds col",
      tests: ["covers X"],
      risks: ["none"],
      assumptions: ["y"],
    });
    for (const needle of ["**Summary.** Add X", "1. one", "`a.ts` — add", "003_x adds col", "- covers X", "- none", "- y"]) {
      assert.ok(md.includes(needle), `missing ${needle}`);
    }
  });
  it("round-trips the questions of a clarify comment", () => {
    const questions = ["Which columns should the table show?", "Should it respect the date filter?"];
    const md = clarifyComment(questions, "not specified yet");
    assert.deepEqual(parseClarifyQuestions(md), questions);
  });
  it("ignores comments that are not clarify comments", () => {
    assert.deepEqual(parseClarifyQuestions("### 🤖 Tracking bot\n\n1. a plan step"), []);
  });
  it("renders status lines", () => {
    const md = statusComment({ branch: "b", sha: "0123456789abcdef", prUrl: "http://pr", buildUrl: "http://b", phase: "x", lines: ["l1"] });
    assert.ok(md.includes("`b` @ 0123456789"));
    assert.ok(md.includes("http://pr"));
    assert.ok(md.includes("- l1"));
  });
});
