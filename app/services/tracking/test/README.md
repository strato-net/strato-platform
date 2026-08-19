# Tracking service integration tests

Black-box suite for `app/services/tracking`. It runs the **real service image**
against a throwaway Postgres and mocked upstreams, and asserts over HTTP plus
direct DB reads. Jenkins runs it in the `Tracking Server Tests` stage of
`pipelines/Jenkinsfile.autobuild` (parallel with the other test stages).

```sh
cd app/services/tracking
docker compose -f docker-compose.test.yml -p tracking-tests up --build \
  --abort-on-container-exit --exit-code-from tests
docker compose -f docker-compose.test.yml -p tracking-tests down -v
```

## Stack (`../docker-compose.test.yml`)

| Service | Image | Role |
|---|---|---|
| `postgres` | `postgres:14.18` | empty DB; the service creates `tracking` and runs its embedded migrations |
| `mocks` | this dir, `npm run mocks` | OpenID discovery + JWKS + `POST /__test/token` (mints RS256 JWTs the service verifies), and a Cirrus/PostgREST look-alike fed by `POST/PUT /__test/cirrus/<table>` / `DELETE /__test/cirrus` |
| `tracking` | `../Dockerfile` (production image) | `NODE_URL` and `OPENID_DISCOVERY_URL` point at `mocks`; `TRACKING_AUTHORIZED_USERS=tester@example.com`; `TRACKING_CACHE_TTL_SECONDS=0` so every dashboard read rebuilds the attribution snapshot |
| `tests` | this dir, `npm test` | `node --test` over `dist/*.test.js`, files run sequentially |

## Writing tests

- One file per feature area: `src/<area>.test.ts`, using `node:test` +
  `node:assert/strict`. Start every suite with `before(() => waitForReady())`
  and end with `after(() => db.end())`.
- Use `src/helpers.ts`: `api()` (raw fetch, redirects not followed),
  `authed()` (adds a bearer token for the allowlisted user), `token(user)`,
  `createLink()`, `openLink(slug, ua)` (returns the `strato_tid` cookie),
  `seedCirrus(table, rows)`, `resetCirrus()`, `sql()` for DB assertions,
  `randomAddress()` / `cirrusAddress()`.
- Create fresh links/addresses per test — the DB is shared for the whole run
  and files run in order, but never assume anything about existing rows.
- The resolver persists sessions fire-and-forget after the 302: poll the row
  (see `sessionRow` in `resolver.test.ts`) or `sleep(200)` before asserting.
- Cirrus rows are served as seeded; the mock understands `eq/neq/in/gt/gte/
  lt/lte/is/like`, `attributes->>key`, `order`, `limit`, `offset`, and
  `select` projections (`alias:column::cast`). Seed unified `event` rows with
  a plain `contract_name` field — the service's
  `storage.contract.contract_name=eq.X` filter is matched against it.
- A migration change must come with a test that asserts the new schema
  (`schema_migrations` row + the columns/tables it adds); an API change must
  come with an HTTP-level test; a UI change is covered by the `tracking-ui`
  image build (tsc + vite) in the same Jenkins stage.
