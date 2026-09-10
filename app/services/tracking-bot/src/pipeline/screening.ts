import { ScreeningRecord } from "../state/store";
import { stripToolMarkup } from "../agent/sanitize";

// Guard around the screening verdict, so the bot can never get stuck asking
// for clarification forever (issue #7473: the same generic question was posted
// five times in a row).
//
// Two failure modes are handled:
//   * a malformed/unparseable model verdict, which validate() coerces to
//     "clarify" with no questions — asking nothing is never useful;
//   * a model that keeps re-asking questions the humans have already answered.
// In both cases the bot proceeds to implement with what it has, recording why.

// Never post this as a question: it carries no information and it is what the
// bot fell back to when the verdict came back empty.
const USELESS_QUESTIONS = [
  "could you describe the expected behaviour in more detail?",
  "could you describe the expected behavior in more detail?",
  "can you describe the expected behaviour in more detail?",
  "could you provide more detail?",
  "could you clarify?",
];

// Field names of ScreeningRecord, so a leaked closing tag such as
// "</questions>" is stripped even when the guard is called on a raw verdict.
const SCREENING_FIELDS = [
  "inScope",
  "scopeReason",
  "decision",
  "decisionReason",
  "reply",
  "assumptions",
  "questions",
  "isFollowUp",
];

// Loose comparison so trivial rewording is still recognised as a repeat
const normalizeQuestion = (q: string): string =>
  stripToolMarkup(q, SCREENING_FIELDS)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface ClarifyGuardInput {
  screening: ScreeningRecord;
  // Questions the bot has already posted on this issue
  askedQuestions: string[];
  // Clarify comments already posted on this issue
  clarifyRounds: number;
  maxClarifyRounds: number;
}

export interface ClarifyGuardResult {
  screening: ScreeningRecord;
  // Questions to post; non-empty exactly when screening.decision === "clarify"
  questions: string[];
  // Set when the guard turned a "clarify" verdict into "implement"
  overrideReason?: string;
}

export const applyClarifyGuard = ({ screening, askedQuestions, clarifyRounds, maxClarifyRounds }: ClarifyGuardInput): ClarifyGuardResult => {
  if (screening.decision !== "clarify") return { screening, questions: [] };

  const useless = new Set(USELESS_QUESTIONS.map(normalizeQuestion));
  const seen = new Set(askedQuestions.map(normalizeQuestion).filter(Boolean));
  const questions: string[] = [];
  for (const raw of screening.questions) {
    const question = stripToolMarkup(raw, SCREENING_FIELDS);
    const key = normalizeQuestion(question);
    if (!key || seen.has(key) || useless.has(key)) continue;
    seen.add(key);
    questions.push(question);
  }

  const proceed = (overrideReason: string): ClarifyGuardResult => ({
    screening: {
      ...screening,
      decision: "implement",
      assumptions: [...screening.assumptions, `Proceeding without further clarification: ${overrideReason}. Implementing the request as understood from the conversation so far.`],
    },
    questions: [],
    overrideReason,
  });

  if (!questions.length) {
    return proceed(
      clarifyRounds > 0
        ? "no clarifying question left that has not already been asked and answered"
        : "the screening verdict asked for clarification without naming a single answerable question"
    );
  }
  if (clarifyRounds >= maxClarifyRounds) {
    return proceed(`already asked ${clarifyRounds} round(s) of clarifying questions on this issue (limit ${maxClarifyRounds})`);
  }
  return { screening: { ...screening, questions }, questions };
};
