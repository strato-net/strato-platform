import fs from "fs";
import path from "path";

// Per-issue lifecycle. Transitions are driven by pipeline/processIssue.ts;
// every terminal-ish state re-enters "screening" when a human comments.
export type IssueStatus =
  | "screening" // criteria + implement/clarify/decline decision pending
  | "declined" // a selection criterion failed or the bot decided not to implement
  | "clarifying" // questions posted, waiting for a human answer
  | "planning" // plan generation + posting
  | "implementing" // agent working / local validation / push
  | "ci" // pushed; waiting on Jenkins for headSha
  | "deploying" // Jenkins green; SSH deploy in progress
  | "done" // deployed
  | "needs_human" // gave up (see lastError); a human comment restarts screening
  | "closed"; // issue closed or bot unassigned

export interface ScreeningRecord {
  inScope: boolean;
  scopeReason: string;
  decision: "implement" | "clarify" | "decline" | "reply" | "none";
  decisionReason: string;
  reply: string;
  assumptions: string[];
  questions: string[];
  isFollowUp: boolean;
}

export interface FinishRecord {
  summary: string;
  testsAdded: string[];
  deviations: string;
  notes: string;
}

export interface IssueState {
  number: number;
  status: IssueStatus;
  title?: string;
  branch?: string;
  headSha?: string;
  prNumber?: number;
  prUrl?: string;
  planCommentId?: number;
  statusCommentId?: number;
  plan?: string;
  screening?: ScreeningRecord;
  finish?: FinishRecord;
  // Comment id of the last human comment the bot has reacted to; a newer
  // one wakes the issue up again
  lastSeenCommentId?: number;
  lastSeenUpdatedAt?: string;
  // Parked status before a human comment woke the issue (restored when the
  // comment needs no work)
  wokenFrom?: IssueStatus;
  declinedFor?: "core-team" | "scope" | "decision";
  ciRounds: number;
  ciFix?: boolean; // implementing state entered because Jenkins failed
  buildUrl?: string;
  buildNumber?: number;
  ciStartedAt?: string;
  ciFailureContext?: string;
  scanTriggeredAt?: string;
  buildTriggeredAt?: string;
  deployedSha?: string;
  lastError?: string;
  errors?: number; // consecutive slow-lane crashes (reset on every transition)
  updatedAt: string;
  history: { at: string; event: string }[];
}

export interface TriageRecord {
  number: number;
  contentHash: string; // sha1 of title/body/labels when classified
  relevant: boolean;
  reason: string;
  assigned: boolean;
  at: string;
}

interface StateFile {
  version: 1;
  issues: Record<string, IssueState>;
  triage: Record<string, TriageRecord>;
}

const empty = (): StateFile => ({ version: 1, issues: {}, triage: {} });

export class StateStore {
  private data: StateFile;

  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, "utf8")) as StateFile;
      } catch (error) {
        throw new Error(`State file ${file} is corrupt: ${error}`);
      }
    } else {
      this.data = empty();
      this.flush();
    }
  }

  private flush(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  getIssue(number: number): IssueState | undefined {
    return this.data.issues[String(number)];
  }

  allIssues(): IssueState[] {
    return Object.values(this.data.issues).sort((a, b) => a.number - b.number);
  }

  upsertIssue(number: number, patch: Partial<IssueState>, event?: string): IssueState {
    const existing = this.data.issues[String(number)] ?? {
      number,
      status: "screening" as IssueStatus,
      ciRounds: 0,
      updatedAt: new Date().toISOString(),
      history: [],
    };
    const next: IssueState = { ...existing, ...patch, number, updatedAt: new Date().toISOString() };
    if (event) next.history = [...existing.history, { at: next.updatedAt, event }].slice(-100);
    this.data.issues[String(number)] = next;
    this.flush();
    return next;
  }

  getTriage(number: number): TriageRecord | undefined {
    return this.data.triage[String(number)];
  }

  setTriage(record: TriageRecord): void {
    this.data.triage[String(record.number)] = record;
    this.flush();
  }

  snapshot(): StateFile {
    return JSON.parse(JSON.stringify(this.data));
  }
}
