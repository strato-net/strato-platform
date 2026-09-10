import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyClarifyGuard } from "../pipeline/screening";
import { sanitizeStrings, stripToolMarkup } from "../agent/sanitize";
import { ScreeningRecord } from "../state/store";

const record = (patch: Partial<ScreeningRecord> = {}): ScreeningRecord => ({
  inScope: true,
  scopeReason: "tracking ui + api",
  decision: "clarify",
  decisionReason: "needs detail",
  reply: "",
  assumptions: [],
  questions: [],
  isFollowUp: false,
  ...patch,
});

const guard = (screening: ScreeningRecord, askedQuestions: string[] = [], clarifyRounds = 0, maxClarifyRounds = 2) =>
  applyClarifyGuard({ screening, askedQuestions, clarifyRounds, maxClarifyRounds });

describe("clarify guard", () => {
  it("passes through a non-clarify decision untouched", () => {
    const screening = record({ decision: "implement" });
    const result = guard(screening);
    assert.equal(result.screening, screening);
    assert.deepEqual(result.questions, []);
    assert.equal(result.overrideReason, undefined);
  });

  it("asks real questions on the first round", () => {
    const result = guard(record({ questions: ["Which columns should the wallet table show?"] }));
    assert.equal(result.screening.decision, "clarify");
    assert.deepEqual(result.questions, ["Which columns should the wallet table show?"]);
  });

  it("implements instead of asking when the verdict has no questions", () => {
    const result = guard(record({ questions: [] }));
    assert.equal(result.screening.decision, "implement");
    assert.deepEqual(result.questions, []);
    assert.match(result.overrideReason ?? "", /without naming a single answerable question/);
    assert.equal(result.screening.assumptions.length, 1);
  });

  it("drops the generic fallback question", () => {
    const result = guard(record({ questions: ["Could you describe the expected behaviour in more detail?"] }));
    assert.equal(result.screening.decision, "implement");
    assert.deepEqual(result.questions, []);
  });

  it("never re-asks a question it already asked", () => {
    const asked = ["For the Wallets breakdown, what columns are wanted?"];
    const result = guard(record({ questions: ["For the wallets breakdown, what columns are wanted?!"] }), asked, 1);
    assert.equal(result.screening.decision, "implement");
    assert.match(result.overrideReason ?? "", /already been asked/);
  });

  it("keeps only the questions that are new", () => {
    const result = guard(record({ questions: ["Old question?", "Brand new question?"] }), ["Old question?"], 1);
    assert.equal(result.screening.decision, "clarify");
    assert.deepEqual(result.questions, ["Brand new question?"]);
  });

  it("de-duplicates repeated questions within one verdict", () => {
    const result = guard(record({ questions: ["Same question?", "Same question?"] }));
    assert.deepEqual(result.questions, ["Same question?"]);
  });

  it("stops asking once the round limit is reached", () => {
    const result = guard(record({ questions: ["A genuinely new question?"] }), ["Something else?"], 2);
    assert.equal(result.screening.decision, "implement");
    assert.match(result.overrideReason ?? "", /limit 2/);
  });

  it("strips leaked tool-call markup from questions", () => {
    const result = guard(record({ questions: ['What should the drawer show?</questions>\n<parameter name="isFollowUp">'] }));
    assert.deepEqual(result.questions, ["What should the drawer show?"]);
  });
});

describe("tool markup sanitiser", () => {
  it("removes the leaked closing tag and parameter markers", () => {
    const leaked = 'The request is clear enough to implement.</decisionReason>\n<parameter name="reply">';
    assert.equal(stripToolMarkup(leaked, ["decisionReason", "reply"]), "The request is clear enough to implement.");
  });

  it("removes function-call wrappers regardless of the field list", () => {
    assert.equal(stripToolMarkup("<invoke name=\"record_screening\">ok</invoke>"), "ok");
  });

  it("leaves ordinary markdown and html-ish text alone", () => {
    const body = "Use `<div>` in the UI and see <https://example.com>.";
    assert.equal(stripToolMarkup(body, ["reply"]), body);
  });

  it("sanitises strings nested in arrays", () => {
    const clean = sanitizeStrings({ questions: ["a</questions>", "b"], inScope: true }, ["questions"]);
    assert.deepEqual(clean, { questions: ["a", "b"], inScope: true });
  });
});
