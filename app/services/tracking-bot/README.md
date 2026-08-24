# STRATO Tracking Bot

A CI/CD bot for the tracking server (`app/services/tracking`). It watches
GitHub issues in `strato-net/strato-platform`, assigns itself to the ones
about the tracking server, and for every issue it owns:

1. **Screens** it against the selection criteria — assigned to the bot; the
   creator is a member of the strato-net core team; the scope is limited to
   the tracking UI, API, server code, or tracking DB migrations. A failed
   criterion gets a comment naming the criterion and why it failed.
2. **Decides** whether to implement (or asks clarifying questions / declines
   with a reason) after reading the whole conversation.
3. **Plans** the change with read-only access to the repo and posts the plan
   on the issue.
4. **Implements** it on `tracking-bot/issue-<n>-<slug>` with an LLM agent
   (file tools + bash), enforces the path allowlist and the "integration
   tests required" rule, runs the tracking typecheck/build and the
   `docker-compose.test.yml` suite locally, then commits (including a
   regenerated `BUILD_METADATA`), pushes, and opens a PR.
5. **Waits for Jenkins** (multibranch autobuild) — `SUCCESS`, or `UNSTABLE`
   with the `Tracking Server Tests` stage green. Failures feed the logs back
   to the agent for up to `CI_MAX_FIX_ROUNDS` fix rounds.
6. **Deploys** over SSH: pulls the branch on the tracking server, `make
   tracking tracking-nginx tracking-ui docker-compose`, `docker compose up
   -d`, health-checks, and rolls back the checkout on failure.
7. Posts a completion comment. Follow-up comments on the issue re-enter the
   loop on the same branch; "thanks"/questions get a reply or nothing.

Only steps 1–4 (and the CI-fix rounds) talk to a model. Polling, GitHub
writes, git, Jenkins and SSH are plain code.

## Models

`TRIAGE_MODEL` (classification, screening) and `IMPLEMENT_MODEL` (planning,
implementation, CI fixes) are `<provider>:<model>`:

| provider | examples | API |
|---|---|---|
| `anthropic` | `claude-opus-5`, `claude-sonnet-5`, `claude-fable-5` | Anthropic Messages (adaptive thinking + `MODEL_EFFORT`) |
| `openai` | `gpt-5.2-codex`, `gpt-5.2`, `o4-mini` | OpenAI Responses (reasoning effort, `previous_response_id` chaining) |
| `xai` | `grok-4`, `grok-code-fast-1` | xAI chat completions (OpenAI-compatible) |
| `openai-compatible` | anything behind `OPENAI_COMPAT_BASE_URL` | chat completions |

All providers share the same tool set (`read_file`, `list_files`, `search`,
`bash`, `write_file`, `edit_file`) and stop tools (`submit_plan`, `finish`).

## Guardrails

- Writes outside `ALLOWED_PATHS` (default `app/services/tracking/**`,
  `docker-compose.tracking.tpl.yml`, `BUILD_METADATA`) are rejected by the
  tools *and* re-checked on the final diff.
- A substantive diff without changes under `REQUIRED_TEST_PATHS`
  (`app/services/tracking/test/**`) is sent back to the agent.
- The agent's bash refuses git branch/commit/push/reset, `sudo`, `rm -rf /`,
  and docker prunes; it runs with a scrubbed environment (no bot secrets).
- Local validation before every push: service `tsc`, UI build, tests
  `tsc`, and the docker-compose integration suite (needs the docker socket).
- One implementation at a time (single workspace); Jenkins polling and
  deploys run in a separate fast lane every poll.
- `DRY_RUN=true` reads GitHub and runs models but never assigns, comments,
  pushes, or deploys.
- Bounded retries everywhere (`AGENT_MAX_FIX_ROUNDS`, `CI_MAX_FIX_ROUNDS`,
  Jenkins/deploy timeouts) — the bot posts a "needs a human" comment and
  parks the issue rather than looping.

## Running

```sh
cp .env.example .env         # fill in tokens/keys/hosts
npm ci && npm run build
npm start                    # or: docker compose up -d --build
curl localhost:3020/status   # issues, current job, last poll
```

State lives in `$WORKSPACE_DIR/state.json` (one JSON document; safe to
delete to forget everything), the repo clone in `$WORKSPACE_DIR/repo`, and
per-issue transcripts under `$WORKSPACE_DIR/logs/issue-<n>/`.

## GitHub setup

- A machine account (e.g. `strato-tracking-bot`) with **write** access to the
  repo (needed to be assignable and to push branches).
- Fine-grained PAT: Issues R/W, Pull requests R/W, Contents R/W, Metadata R;
  organization permission Members: read (for the team check). Without the
  org permission set `CORE_TEAM_MEMBERS=login1,login2`.
- `CORE_TEAM_SLUG` = the org team slug of the core team.
- Optional: label tracking issues `tracking` to skip model triage.

## Jenkins

`JENKINS_JOB` is the multibranch job that runs `pipelines/Jenkinsfile.autobuild`
for feature branches. The bot reads `job/<name>/job/<branch>/api/json`,
`/wfapi/describe` (Pipeline Stage View) for per-stage results, and the
console/stage logs on failure. If a new branch is not indexed within a few
minutes it triggers a branch scan, and after `JENKINS_TRIGGER_AFTER_MINUTES`
a branch build. Auth: user + API token.

## Tracking server (deploy target)

SSH user + key with permission to run `git`, `make` and `docker compose` in
`DEPLOY_REPO_DIR` (a checkout of strato-platform with the compose env in
place: `DEPLOY_ENV_FILE`, or exported by the compose file's environment).
`DEPLOY_HEALTH_URL` (e.g. `https://go.strato.nexus/health`) gates rollback.
`DEPLOY_COMMAND` overrides the built-in script entirely if the server has its
own deploy wrapper.

## EC2 host

```sh
AWS_PROFILE=... BOT_SSH_CIDR=<your ip>/32 npm run provision   # idempotent
cp .env.example infra/bot.env && $EDITOR infra/bot.env
BOT_DEPLOY_KEY_FILE=~/.ssh/tracking-server.pem infra/deploy-bot.sh up
infra/deploy-bot.sh logs | status | restart | ssh
```

`infra/provision.ts` creates a t3.medium Ubuntu 24.04 instance with a 40 GB
gp3 volume, an SSH-only security group, a key pair (`infra/<key>.pem`), and
cloud-init that installs docker; `infra/deploy-bot.sh` rsyncs this directory
plus `infra/bot.env` and runs `docker compose up -d --build` on the host.
