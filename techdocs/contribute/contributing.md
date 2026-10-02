# Contributing to STRATO

How to propose changes to the STRATO platform codebase. The canonical rules are in `CONTRIBUTING.md` at the repository root. This page summarizes them and adds the practical workflow.

---

## Before You Start

1. Read `DISCLAIMER.md` in the repository root.
2. Set up your environment: [Setup](setup.md).
3. Learn how the pieces fit together: [Architecture](architecture.md).

!!! warning "Security issues"
    Do not report vulnerabilities in public issues. Email **security@strato.nexus** with a description, reproduction steps and affected components (see `SECURITY.md`).

---

## Issues

Use [GitHub Issues](https://github.com/strato-net/strato-platform/issues) to report bugs or suggest features.

- Search open and closed issues first. If a matching issue exists, comment on it instead of opening a new one.
- For feature requests, describe the use cases behind them. Features are prioritized by their impact on the ecosystem.
- If you plan to work on something, say so first to avoid duplicated effort.

---

## Pull Requests

Well-structured contributions that address real issues are welcome. If in doubt, reach out before starting. The maintainers may block accounts that repeatedly submit low-effort changes or disrupt the project.

### Workflow

1. **Fork** [strato-net/strato-platform](https://github.com/strato-net/strato-platform) and clone your fork.
2. **Branch from `develop`.** `develop` is the default and integration branch.

    ```bash
    git remote add upstream https://github.com/strato-net/strato-platform.git
    git fetch upstream
    git checkout -b fix/short-description upstream/develop
    ```

    There is no enforced branch naming scheme. `feature/...` and `fix/...` prefixes are common.

3. **Make your change**, with tests where the component has them (see [Testing](#testing)).
4. **Commit with a DCO sign-off** (see below).
5. **Open a pull request against `develop`.**

Releases are cut by maintainers: `release/<version>` branches are merged into `master`, and `master` is merged back into `develop`. Contributors don't need to target these branches.

### Developer Certificate of Origin (DCO)

`CONTRIBUTING.md` requires every commit to carry a DCO sign-off line with your legal name. By signing off, you certify the terms in the `DCO` file (Developer Certificate of Origin 1.1).

```bash
git config user.name "FIRST_NAME LAST_NAME"
git config user.email "MY_NAME@example.com"

git commit -s -m "Your message"
```

If you commit through the GitHub web UI, make your email address public in your GitHub profile so the sign-off doesn't use the `@users.noreply.github.com` placeholder.

There is no required commit message format. Write clear messages that describe the change.

### License

The repository is licensed under the Apache License 2.0 (`LICENSE`). See also `NOTICE` and `TRADEMARK_POLICY.md`.

---

## Git Hooks

`scripts/hooks/pre-commit` removes trailing whitespace from staged `.hs` and `.sol` files, then re-stages them. Install it with:

```bash
cp scripts/hooks/pre-commit .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

To check the whole tree without the hook, run `scripts/delete-trailing-whitespaces.sh --check`. It needs a clean working tree and exits non-zero if it had to change any file.

---

## Code Style

There is no repository-wide linter configuration for every language. Follow the style of the surrounding code, keep changes scoped to the task, and don't reformat unrelated code.

| Area | Tooling |
|------|---------|
| Haskell (`strato/`) | `make pretty` formats tracked `.hs` files with ormolu. It touches the whole tree, so don't commit unrelated reformatting. Local packages build with `-Wall -Werror`, so fix every warning. |
| UI (`app/ui/`) | ESLint: `npm run lint` |
| Backend (`app/backend/`) | Type-check with `npx tsc --noEmit` |
| Contracts (`app/contracts/`) | SolidVM dialect. Follow existing contracts; see [SolidVM](../solidvm/index.md) for semantics that differ from Solidity. |

Never commit secrets, private keys or `.env` files.

---

## Testing

Run the checks that apply to the code you changed:

| Area | Command |
|------|---------|
| Core (Haskell) | `cd strato && stack build <package>` and `stack test <package>`; then `make` |
| Contracts | From the test's directory: `solid-vm-cli test <File>.test.sol` (or `app/contracts/tests/test.sh <File>.test.sol`) |
| Backend | `cd app/backend && npm test` |
| UI | `cd app/ui && npm run lint && npm run build` |
| Bridge service | `cd app/services/bridge && npm test` |
| Tracking bot | `cd app/services/tracking-bot && npm run build && npm test` |
| Tracking service | `cd app/services/tracking && docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from tests` |
| End to end | Build with `make`, then do a [clean node restart](setup.md#clean-restart) and exercise the change |

`make test` does not run tests. It only prints the build version.

---

## Continuous Integration

CI runs on Jenkins, using the pipeline definitions in `pipelines/`. `Jenkinsfile.autobuild` does the following:

1. Skips branches (other than `develop`) that have no changes compared to `develop`.
2. Runs `make`, deploys a node, and checks that the node is healthy and receiving blocks.
3. Runs contract tests: `solid-vm-cli test` on every `app/contracts/tests/**/*.test.sol`, except `*V2.test.sol`. Failures mark the build **unstable**.
4. Runs the SMD tests (`docker build --target test` in `smd-ui/`).
5. Runs the tracking service tests: the UI build plus `docker-compose.test.yml`.

Other pipelines cover app-only builds (`Jenkinsfile.buildtestapp`), sync and snapshot tests (`Jenkinsfile.synctest`), releases (`Jenkinsfile.release`) and publishing this documentation site (`Jenkinsfile.mkdocs`).

---

## Documentation

This site is built from `techdocs/` and `mkdocs.yml`. Update the relevant pages in the same pull request when you do any of the following:

- change user-visible behavior
- change an API
- add or remove a node flag
- change a contract interface

Every technical claim in the docs should match the code on `develop`.

---

## Getting Help

- **Documentation:** [docs.strato.nexus](https://docs.strato.nexus)
- **Support:** [support.blockapps.net](https://support.blockapps.net)
- **Telegram:** [t.me/strato_net](https://t.me/strato_net)
- For questions about a specific change, comment on the GitHub issue or pull request.
