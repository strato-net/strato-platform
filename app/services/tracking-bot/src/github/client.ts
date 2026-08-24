import { Octokit } from "@octokit/rest";
import { config } from "../config";
import { log } from "../log";

export interface IssueUser {
  login: string;
  type: string; // "User" | "Bot"
}

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  user: IssueUser;
  assignees: string[];
  labels: string[];
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  isPullRequest: boolean;
}

export interface IssueComment {
  id: number;
  user: IssueUser;
  body: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

const toIssue = (raw: any): IssueSummary => ({
  number: raw.number,
  title: raw.title ?? "",
  body: raw.body ?? "",
  state: raw.state,
  user: { login: raw.user?.login ?? "", type: raw.user?.type ?? "User" },
  assignees: (raw.assignees ?? []).map((a: any) => a.login),
  labels: (raw.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean),
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
  htmlUrl: raw.html_url,
  isPullRequest: Boolean(raw.pull_request),
});

const toComment = (raw: any): IssueComment => ({
  id: raw.id,
  user: { login: raw.user?.login ?? "", type: raw.user?.type ?? "User" },
  body: raw.body ?? "",
  createdAt: raw.created_at,
  updatedAt: raw.updated_at,
  htmlUrl: raw.html_url,
});

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly owner = config.github.owner;
  private readonly repo = config.github.repo;
  private loginCache: string | null = null;
  private readonly teamCache = new Map<string, { member: boolean | null; at: number }>();

  constructor(token: string = config.github.token) {
    this.octokit = new Octokit({ ...(token ? { auth: token } : {}), userAgent: "strato-tracking-bot" });
    if (!token) log.warn("GitHub", "No GITHUB_TOKEN: anonymous read-only mode (dry run forced, 60 requests/hour)");
  }

  get repoSlug(): string {
    return `${this.owner}/${this.repo}`;
  }

  async botLogin(): Promise<string> {
    if (this.loginCache) return this.loginCache;
    if (config.github.botLogin) {
      this.loginCache = config.github.botLogin;
      return this.loginCache;
    }
    if (!config.github.token) throw new Error("GITHUB_BOT_LOGIN is required when GITHUB_TOKEN is not set");
    const { data } = await this.octokit.users.getAuthenticated();
    this.loginCache = data.login;
    return data.login;
  }

  // Open issues (not PRs) in the repo, newest activity first
  async listOpenIssues(options: { assignee?: string; since?: string } = {}): Promise<IssueSummary[]> {
    const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
      owner: this.owner,
      repo: this.repo,
      state: "open",
      per_page: 100,
      sort: "updated",
      direction: "desc",
      ...(options.assignee ? { assignee: options.assignee } : {}),
      ...(options.since ? { since: options.since } : {}),
    });
    return issues.map(toIssue).filter((i) => !i.isPullRequest);
  }

  async getIssue(number: number): Promise<IssueSummary> {
    const { data } = await this.octokit.issues.get({ owner: this.owner, repo: this.repo, issue_number: number });
    return toIssue(data);
  }

  async listComments(number: number): Promise<IssueComment[]> {
    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      owner: this.owner,
      repo: this.repo,
      issue_number: number,
      per_page: 100,
    });
    return comments.map(toComment);
  }

  async addAssignee(number: number, login: string): Promise<void> {
    if (config.dryRun) return log.info("GitHub", `[dry-run] assign #${number} -> ${login}`);
    await this.octokit.issues.addAssignees({ owner: this.owner, repo: this.repo, issue_number: number, assignees: [login] });
  }

  async ensureLabel(name: string, color: string, description: string): Promise<void> {
    try {
      await this.octokit.issues.getLabel({ owner: this.owner, repo: this.repo, name });
    } catch (error: any) {
      if (error?.status !== 404) throw error;
      if (config.dryRun) return log.info("GitHub", `[dry-run] create label ${name}`);
      await this.octokit.issues.createLabel({ owner: this.owner, repo: this.repo, name, color, description });
    }
  }

  async setBotLabel(number: number, currentLabels: string[], label: string): Promise<void> {
    const prefix = `${config.github.labelPrefix}:`;
    const stale = currentLabels.filter((l) => l.startsWith(prefix) && l !== label);
    if (config.dryRun) return log.info("GitHub", `[dry-run] label #${number} ${label} (remove ${stale.join(",") || "-"})`);
    for (const old of stale) {
      await this.octokit.issues
        .removeLabel({ owner: this.owner, repo: this.repo, issue_number: number, name: old })
        .catch(() => {});
    }
    if (!currentLabels.includes(label)) {
      await this.ensureLabel(label, "5319e7", "Managed by the tracking CI/CD bot");
      await this.octokit.issues.addLabels({ owner: this.owner, repo: this.repo, issue_number: number, labels: [label] });
    }
  }

  async createComment(number: number, body: string): Promise<number> {
    if (config.dryRun) {
      log.info("GitHub", `[dry-run] comment on #${number}:\n${body}`);
      return -1;
    }
    const { data } = await this.octokit.issues.createComment({ owner: this.owner, repo: this.repo, issue_number: number, body });
    return data.id;
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    if (config.dryRun) return log.info("GitHub", `[dry-run] update comment ${commentId}:\n${body}`);
    await this.octokit.issues.updateComment({ owner: this.owner, repo: this.repo, comment_id: commentId, body });
  }

  // true/false when the API answered; null when the token cannot read the
  // team (403/404 on the team itself), so the caller can fall back
  async isCoreTeamMember(username: string): Promise<boolean | null> {
    const key = username.toLowerCase();
    const cached = this.teamCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.member;
    let member: boolean | null;
    try {
      const { data } = await this.octokit.teams.getMembershipForUserInOrg({
        org: this.owner,
        team_slug: config.github.coreTeamSlug,
        username,
      });
      member = data.state === "active";
    } catch (error: any) {
      if (error?.status === 404) {
        // Either the user is not a member, or the team is invisible to us.
        // Distinguish by asking for the team itself.
        try {
          await this.octokit.teams.getByName({ org: this.owner, team_slug: config.github.coreTeamSlug });
          member = false;
        } catch (teamError: any) {
          log.warn("GitHub", `Cannot read team ${config.github.coreTeamSlug}: ${teamError?.status ?? teamError}`);
          member = null;
        }
      } else if (error?.status === 403 || error?.status === 401) {
        log.warn("GitHub", `Token cannot read team memberships (${error.status}); falling back to CORE_TEAM_MEMBERS`);
        member = null;
      } else {
        throw error;
      }
    }
    this.teamCache.set(key, { member, at: Date.now() });
    return member;
  }

  async findOpenPullRequest(headBranch: string): Promise<{ number: number; htmlUrl: string } | null> {
    const { data } = await this.octokit.pulls.list({
      owner: this.owner,
      repo: this.repo,
      state: "open",
      head: `${this.owner}:${headBranch}`,
      per_page: 5,
    });
    return data.length ? { number: data[0].number, htmlUrl: data[0].html_url } : null;
  }

  async createPullRequest(head: string, base: string, title: string, body: string): Promise<{ number: number; htmlUrl: string }> {
    if (config.dryRun) {
      log.info("GitHub", `[dry-run] open PR ${head} -> ${base}: ${title}`);
      return { number: -1, htmlUrl: "" };
    }
    const { data } = await this.octokit.pulls.create({ owner: this.owner, repo: this.repo, head, base, title, body });
    return { number: data.number, htmlUrl: data.html_url };
  }

  async getBranchSha(branch: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getBranch({ owner: this.owner, repo: this.repo, branch });
      return data.commit.sha;
    } catch (error: any) {
      if (error?.status === 404) return null;
      throw error;
    }
  }
}
