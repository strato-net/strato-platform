# Validator → operator binding: `strato-authorize-operator` and the signed-consent flow

**Status:** rev 3, 2026-09-29: Components A, B and C implemented and tested (see the "Implemented" notes in §4, §5, §6); helium end-to-end pending a real validator run. Rev 2 (2026-09-22, after review) was the last pure proposal. The contract side is shipped
(validator-keyed `ValidatorRegistry` / `StratoStaking`, live on helium since the 2026-09-14 logic
swap). Backend `register` and the UI "Become a validator" card exist. This document covers the
node-side signer that replaces `deploy/sign-validator-authorization.js`, the missing
operator-change path, the UX glue that turns the flow into "one command on the node, one link in
the app", and one optional contract change (§8) that closes a replay gap the review found.

Rev 2 changes: a `setOperator` signature is an execute-now instruction, not a shareable artefact
(§3, §7); admin binding changes leave outstanding authorizations valid (§7, §8); V2 detection by
function entry, not by storage (§4 step 5); "listed" and "active in consensus" are separate facts
read from separate contracts (§4 step 7, §6); credentials never enter process arguments (§4).
Rev 2.1 (same day, from a mainnet validator's actual config): `vaultUrl` already includes the API
path and `nodeUrl` is the machine's OS hostname.
Rev 2.2 (2026-09-23): Component A no longer talks to the local node at all. The only chain facts it
needs (registry version, the validator's record, the nonce) come from the network's public app
host, so the endpoint probing, the simulate cross-check and the staking-state reads are gone. The
script is one python file of about 150 lines with no dependencies.

Companion docs: `techdocs/design-docs/staking-consensus.md` (§ validator identity),
`techdocs/design-docs/staking-phase-2-design-decisions.md`,
`app/contracts/deploy/RUNBOOK-staking-validator-keyed.md`.

## 1. Problem

A validator record is keyed by the consensus node's address (its vault key). The operator is the
human-controlled account that self-bonds, sets commission and collects the operator share. Binding
the two must be authorised by the party holding the unforgeable credential, the node key, or anyone
could claim a node they do not run. The contract already enforces this; what is missing is a
frictionless way for a node runner to *produce* that authorisation.

Today's signer is a Node.js script inside the repo that needs a pre-minted vault token. Validator
hosts have neither Node.js nor a checkout, and nobody knows how to mint that token by hand.

### Goals

- A node runner binds an operator with **one command on the node** and **one link in the app**.
- The node key never leaves the vault. The script requests one signature over one digest.
- The node key never needs USDST. All transactions are paid by the operator's app account.
- Works on Docker and native nodes with only bash, curl and python3 (what `strato-user-add` needs).
- Covers first registration and later operator changes.
- Fails closed with an actionable message at every step.

### Non-goals

- Submitting transactions from the node key. Every STRATO transaction runs the fee decider, which
  transfers 0.01 USDST from the sender; a sender with no USDST and no voucher is rejected before
  execution (`TFInsufficientFunds`). Funding node keys is the janky step we are avoiding. See §11.
- Changing the consent digest format. §8 proposes a nonce-bump change that keeps the digest as is.
- Slashing, evidence, or anything else in the staking roadmap.

## 2. What exists (verified against `develop` on 2026-09-22)

**Contract** (`app/contracts/concrete/Staking/ValidatorRegistry.sol`)

- `register(validator, commissionBps, name, description, metadataURI, v, r, s)`: `msg.sender`
  becomes operator. Requires `validator`'s consent to `msg.sender`. Reverts if already listed.
- `setOperator(validator, newOperator, v, r, s)`: **anyone** may submit; requires `validator`'s
  consent to `newOperator`. Requires the record to exist; works on delisted records too, and does
  not relist them.
- Consent = `msg.sender == validator`, or `ecrecover(digest) == validator` where
  `digest = keccak256(abi.encodePacked("STRATO validator operator authorization", registry,
  validator, operator, authorizationNonce[validator]))`. Raw 32-byte hash, no prefix. The nonce
  increments **only** inside `_consumeAuthorization`, i.e. on `register` / `setOperator`. `v`
  accepted as 0/1 or 27/28. `operatorAuthorizationDigest(validator, operator)` is a public view.
- Admin paths (`addValidator(s)`, `adminSetOperator`, `removeValidator`) need no signature and
  **do not advance the nonce**.
- Registry `profile.active` means *listed*, not *in the consensus set*.
- `StratoStaking.syncValidatorOperator` (called on every operator change, signed or admin) pays the
  outgoing operator its accrued rewards and fees, queues its self-bond for unbonding and re-runs
  eligibility in the same transaction. Consensus membership is `StratoStaking.isValidator`;
  `status()` returns 0 Missing, 1 Registered, 2 Active, 3 Kicked (delisted). Eligibility is
  `selfBond ≥ minStake`, except while `selfBondGraceUntil` is 0 or in the future, when
  `selfBond + delegatedStake ≥ minStake` suffices.

**Backend** (`app/backend/src/api/{routes,controllers,services}/staking.*`)

- `GET /staking/authorization-digest?validator&operator` (auth required): reads the live nonce and
  returns registry, validator, operator, digest.
- `POST /staking/register` (`walletAuth`): validates `signature` as 0x + 130 hex, splits into
  v/r/s, requires it unless the caller *is* the validator, posts `register`. External-wallet
  callers get an unsigned transaction back (`externalSigning` context).
- No user-facing `setOperator`. Only the admin vote `PATCH /admin/operators/operator`.
- Contract version is detected from bloc state **function entries** (`creditBlockReward` for
  staking), because bloc omits every storage field that was never written.

**UI** (`app/ui/src/components/staking/BecomeValidatorCard.tsx`, page `/dashboard/earn-staking`)

- Fetches the digest for (typed validator, connected account), shows the digest and a
  `node app/contracts/deploy/sign-validator-authorization.js …` command, accepts a pasted signature.
- Skips the signature when the connected account equals the validator.

**Node identity and vault**

- `strato-login` writes `~/.secrets/strato_credentials.yaml` (`discoveryUrl`, `clientId`,
  `clientSecret`); `strato-setup` copies it to `<node>/secrets/oauth_credentials.yaml` and writes
  `~/.strato/default-node` (the node directory path).
- `<node>/.ethereumH/ethconf.yaml` → `urlConfig.vaultUrl` and `urlConfig.nodeUrl`. On a real node
  (hasan-mercata, 2026-09-22) these are `https://vault.blockapps.net:8093/strato/v2.3` and
  `https://strato-mercata`. The vault URL **includes** the `/strato/v2.3` path: the Haskell vault
  client's routes carry no prefix, so the base URL must (local-auth nodes get
  `<nodeUrl>/vault/strato/v2.3`; the path-less value in `EthConf/Model.hs` is only the `def`
  placeholder). `nodeUrl` is `https://` + the machine's OS hostname, set by `strato-init`; it is
  not an external DNS name and the node's TLS certificate will not match it.
- The existing `deploy/sign-validator-authorization.js` appends `/strato/v2.3/key` to `VAULT_URL`
  while telling the user to copy `urlConfig.vaultUrl`, which doubles the path against a real
  ethconf. One more reason to retire it.
- The node mints a `client_credentials` token and calls the vault with it. The vault's nginx
  verifies the JWT and maps `sub` to the stored key. That key **is** the validator address.
- Vault API under `<vaultUrl>/strato/v2.3/`: `GET key` → `{status, address, pubkey}`;
  `POST signature` `{"msgHash": "<64 hex, no 0x>"}` → `{"r": hex, "s": hex, "v": 0|1}`. There is
  no private-key export.

**Chain state.** Every STRATO node serves `GET /bloc/v2.2/contracts/<Name>/<address>/state`
without authentication: all written storage (nested objects keyed by lowercase hex address) plus a
function entry per function. Never-written fields are omitted. The network's public app host is
such a node behind a valid certificate, so the script reads state from
`https://app.testnet.strato.nexus` (helium) or `https://app.strato.nexus` (upquark) and never
touches the local node. Checked 2026-09-23: the helium registry state is 5 KB, carries the
`operatorAuthorizationDigest` entry, and has no `authorizationNonce` key because every binding so
far was an admin vote. The local node is not used because `nodeUrl` is the OS hostname, its
certificate does not match, Docker nodes do not publish strato-api, and reaching nginx from the
host needs redirect and TLS workarounds. None of that is worth it for two public reads.

## 3. Flow

```
node runner (on the validator host)                 operator (in the app, may be the same person)
────────────────────────────────────                ────────────────────────────────────────────
$ strato-authorize-operator 0xOPERATOR
  ├─ read secrets + ethconf from node dir
  ├─ mint client-credentials token
  ├─ vault GET key            → validator address
  ├─ node  metadata + registry state + staking state
  ├─ compute digest locally, cross-check with chain view
  ├─ show consequences, confirm      ◄── this prompt is the only real gate
  ├─ vault POST signature     → r, s, v
  ├─ recover locally == validator, else abort
  └─ print summary, signature, deep link  ─────────► open link, log in as 0xOPERATOR
                                                      ├─ card prefilled: validator, signature
                                                      ├─ enter name + commission (first time only)
                                                      └─ Register / Change operator
                                                          → POST /staking/register | /staking/operator
                                                          → operator's account pays the fee
                                                          → registry consumes the nonce
                                                      then: self-bond ≥ minStake, Activate
```

**What a signature is, by case.** A signature cannot be bent to a different operator, registry or
nonce. Beyond that the two cases differ:

- **First registration** (`register`): only the named operator can submit, because the contract
  requires `msg.sender` to be the operator in the digest. The signature is inert in anyone else's
  hands and may be shared freely.
- **Operator change** (`setOperator`): **anyone holding the signature can submit it at once**, and
  the change executes with all its side effects (self-bond release, eligibility re-check, possible
  removal from the consensus set). The holder cannot alter the outcome, only the timing. Under the
  existing contract, signing an operator change therefore *is* the authorisation to execute it now.
  The script says so before signing (§4 step 7) and the UI warning is informational only.

## 4. Component A: `bin/strato-authorize-operator`

**Implemented 2026-09-29.** `bin/strato-authorize-operator` (python3, stdlib only, ~330 lines),
installed by `make install` / removed by `make uninstall` (Makefile), operator docs in
`techdocs/node/operations.md` ("Bind an operator to your validator"). Verified by the start-up
Keccak self-test, a mock-server suite that was run during development and then dropped by decision
on 2026-10-01 (no other `bin/` tool carries tests and nothing runs them automatically), and the
hybrid run against the real helium registry described below.

### Usage

```
strato-authorize-operator <operator-address> [--node-dir DIR] [--registry ADDR] [--api-url URL]
                          [--yes] [--digest-only]
```

### What it does (one function per step in the source)

1. **Node files.** Node dir from `--node-dir` or `~/.strato/default-node`; credentials from
   `<node>/secrets/oauth_credentials.yaml`, else `~/.secrets/strato_credentials.yaml`
   (`discoveryUrl`, `clientId`, `clientSecret`); from
   `<node>/.ethereumH/ethconf.yaml`: `urlConfig.vaultUrl` (appends `/strato/v2.3` only if missing)
   and `networkConfig.network`. Per-network app host: helium → `https://app.testnet.strato.nexus`,
   upquark → `https://app.strato.nexus`; `--api-url` overrides. Registry address from
   `GET <api>/api/staking/info/public` → `validatorRegistryAddress`; `--registry` overrides.
2. **Token.** OpenID discovery → `token_endpoint`; `POST grant_type=client_credentials` with
   HTTP Basic auth, exactly as the node does. Secret and token stay in-process; the script spawns
   nothing. Redirects are refused on every request. Non-HTTPS URLs are refused except localhost.
3. **Validator.** `GET <vault>/key` with the token → `address`.
4. **Registry state.** `GET <api>/bloc/v2.2/contracts/ValidatorRegistry/<registry>/state`.
   Validator-keyed iff the `operatorAuthorizationDigest` function entry exists (exit 7 otherwise).
   Nonce `authorizationNonce[validator]`, absent → 0. Record → action: `register` (absent),
   `change` (different operator; `operator` field absent means the validator itself), `same`
   (exit 0, nothing signed); `active` absent → "not listed as active, will not relist" line.
5. **Digest.** Local Keccak-256 over the 131-byte packed preimage; self-tested at start-up against
   the contract test vector (exit 9 on failure).
6. **Chain check, then confirm.** Simulates the deployed `operatorAuthorizationDigest(validator,
   operator)` and refuses (exit 7, "logic predates the nonce fix") if it differs from the local
   digest. Prints network, validator (+ registry name), operator, registry (+ source), nonce,
   digest and the action text from the design (execute-now warning for changes), then `Sign? [y/N]`
   read from `/dev/tty`; `--yes` skips, `--digest-only` prints the digest and exits, no terminal
   without `--yes` → exit 10.
7. **Sign.** `POST <vault>/signature {"msgHash": <64 hex>}` → `r`, `s`, `v`; r/s left-padded to
   32 bytes, `v` passed through (0/1); output `0x`+r+s+v (132 chars). One retry on connection
   errors only.
8. **Print.** Signature alone on stdout; on stderr the next steps and
   `<api>/dashboard/earn-staking?validator=0x…&operator=0x…&signature=0x…&nonce=N`, with the
   self-bond and activate reminder for operator changes (the "anyone holding this link" caution was
   dropped on 2026-10-02: the signature names the operator, so a third party can only make that
   operator the operator).

Exit codes: 0 ok / nothing to do · 2 usage · 3 node files · 4 token · 5 vault · 6 app host ·
7 registry not ready · 8 unknown network · 9 self-test · 10 declined / no terminal.

### Found while testing against the live app host

- Cloudflare returns 403 to Python's default user agent, and the node's nginx CSRF layer rejects
  unauthenticated POSTs (the simulate call) unless the user agent contains a known API-client
  substring such as `curl/`. The script sends `strato-authorize-operator/1.0 curl/8.7.1`, which
  passes both. A custom name alone gets 200 on GETs and 403 on POSTs.
- Hybrid end-to-end (mock Keycloak and vault, real helium registry, 2026-09-29): for validator
  `0c4c…` and its current operator the script exits 0 with "nothing to do"; for a new operator it
  passes the chain check, signs (mock) and prints the link. The helium registry logic had been
  swapped to `52735600…` since 2026-09-24 and now computes the digest with the nonce, so the check
  passes; against the old logic it exits 7 as designed (exercised against a mock registry
  during development).

### Deliberately not done

Node endpoint probing, staking-state reads for a precise eligibility prediction, local signature
recovery and `--json` (see rev 2.2 rationale in the git history of this file). The chain
cross-check that rev 2.2 removed was reinstated after the nonce-encoding bug showed that the
deployed logic can disagree with a correct signer.

### Still to do

A real run on a helium validator host (mock-free), then §9.7's end-to-end through the UI.

## 5. Component B: backend

**Status: implemented 2026-09-29** (`app/backend/src`; `npm run build` and `npm test` green, 45 tests).

1. **`POST /staking/operator`** (`walletAuth`) → `StakingController.setOperator` →
   `setStratoOperator(accessToken, userAddress, { validator, signature? })` in
   `staking.service.ts`. Body `{ validator, signature? }`; the connected account is the new
   operator. 400 `{ error: "Invalid operator change request" }` on malformed input; signature
   required unless the caller is the validator (same message as `register`). Posts
   `ValidatorRegistry.setOperator(validator, newOperator=caller, v, r, s)` via `buildAndPost`, so
   external wallets get the unsigned transaction as everywhere else. Response
   `{ status, hash, validator?: { address, status, isValidator, operator } }`; `validator` is read
   fresh from staking after a committed tx (status 0/1/2/3 via the existing `v2ValidatorRecords`)
   and omitted for `status: "unsigned"` or if the read fails (never fails a committed tx).
2. **`GET /staking/authorization-digest`** already returned `nonce` (decimal string) with
   registry/validator/operator/digest; unchanged.
3. **Revert mapping**: `mapRegistryRevert` in the new pure module
   `app/backend/src/api/services/stakingAuthorization.ts` (also home of `authorizationDigest`
   and `splitSignature`, moved out of the service unchanged). Applied to both
   `registerStratoOperator` and `setStratoOperator`. Contract reverts arrive as a `StratoError`
   whose message carries the revert string (`txHelper.txFailureMessage`); the mapper returns a
   new `StratoError` with the status/text below and the original text in `detail` (logged; the
   error middleware renders `{ error: { message, status, type } }`).

   | Contract revert | HTTP | User text |
   |---|---|---|
   | `VR: validator did not authorize operator` | 409 | "Authorization invalid or already used. Re-run strato-authorize-operator on the node." |
   | `VR: already registered` | 409 | "This validator is already listed. Use Change operator." |
   | `VR: same operator` | 409 | "You already operate this validator." |
   | `VR: validator missing` | 404 | "Validator not listed. Use Register." |

4. **Activity feed**: not touched; `OperatorChanged` handling to be confirmed with Component C.
5. **Tests**: `app/backend/src/api/services/staking.service.test.ts` (node:test) covers the
   digest vector (`0xb40f…9bd3`), `splitSignature` accept/reject rules and 400 status, and the
   revert mapper incl. passthrough.

- **One validator per operator (added 2026-10-01).** `assertOperatesNoOtherValidator` runs in
  `registerStratoOperator` and `setStratoOperator` (the latter excepting the target validator):
  reads staking state fresh, and if the caller already operates an active validator throws
  `StratoError` 409 "This account already operates validator <name (0x…)>. An operator can run one
  validator; use a different account." Pure helper `findOperatedValidator` in
  `stakingAuthorization.ts`, unit-tested. Admin votes are not checked (contract rule pending, §8).

## 6. Component C: UI

Implemented 2026-09-29, redesigned 2026-10-01 after the first real helium run (`app/ui/src`).
Verified with `npm run build`, `tsc -b` clean on touched files, eslint clean except one pre-existing
`as any` on the page.

- **One card, `components/staking/BecomeValidatorCard.tsx`**, covers both first registration and
  taking over a listed validator. Collapsed by default: title, one line on what it takes, one
  button ("Become a validator" / "Add a validator"). Expanded: a three-step guide — 1 run a node
  (link to https://docs.strato.nexus), 2 run `strato-authorize-operator <connected address>` on it
  (the command block is the hero; it never mentions registering, since it is the one way to bind a
  node to this account), 3 finish here via the link the command prints. Step 3 routes by the
  validator address once known: not listed → name / description / commission + **Register**
  (`POST /staking/register`); listed under another operator → record, current operator, status
  badge, consequence text as information (and the delisted line for status 3) + **Change operator**
  (`POST /staking/operator`); already operated by this account → says so, no action; connected
  account is the validator → no signature needed. Manual entry of validator and signature is a
  toggle; the raw digest (with nonce) sits under an "Advanced: key held outside a vault"
  disclosure. After success the card collapses to a status row (badge + next step).
- **Deep link** `/dashboard/earn-staking?validator&operator&signature&nonce`
  (`pages/EarnStaking.tsx`): if the connected account is not `operator`, a page-level banner says
  to log in as that account and nothing is prefilled; otherwise the card opens at step 3 with the
  validator and signature as read-only rows ("Change" reveals manual entry) and steps 1–2 marked
  done. If the fetched digest's nonce differs from the link's, the card says the authorization is
  no longer valid and blocks submit. The login redirect already preserves the query string.
- **Errors** from the backend (409/404 registry reverts) render inline in the card via
  `requestErrorMessage`, which accepts both `{ error: string }` and `{ error: { message } }`.
- **After success** the page refetches staking info and the card shows the real status via
  `ValidatorStatusBadge` plus `describeValidatorNextStep` ("Self-bond at least …", "Activate to
  join the validator set", "In the validator set", "Relisting needs an admin vote").
- Shared primitives: `components/staking/AuthorizationInstructions.tsx` (CommandBlock,
  OnboardingStep, PrefilledRow, DigestDisclosure, CopyValueButton), `authorization.ts` (command
  string, validators, error extractor), `validatorNextStep.ts`.
- Removed on 2026-10-01 by decision: the separate "Take over a validator" card and the sentence
  "Validators need 10,000 STRATO of self-bond; delegated stake no longer counts toward it".

## 7. Security considerations

- **No key export.** The vault signs a 32-byte hash; the private key stays encrypted at rest.
- **Token scope.** The same client-credentials token can make the vault sign block seals and PBFT
  votes for this validator. That is the existing trust model; the script adds no capability. It
  must run on the host, as the node's user, and never print or persist the token. Documentation
  says explicitly: do not copy the credentials elsewhere to "sign from your laptop".
- **Credentials never enter process arguments or the environment.** The script is a single python
  process that spawns nothing. There is no `curl … "client_secret=$SECRET"` and no header built in
  a shell string.
- **Domain separation.** The digest has a fixed prefix string, the registry address and a nonce.
  It cannot collide with a block hash or any consensus message, and cannot be bent to another
  operator, registry or nonce.
- **Local digest is authoritative.** The key signs consent for the operator the user typed. A
  wrong or hostile node API can at worst produce a useless signature, never consent to a different
  operator.
- **The chain must agree with the local digest before signing.** The cross-check in §4 step 5
  never changes what is signed; it only refuses when the deployed registry logic would reject the
  signature anyway (strato-net/private#220: `operatorAuthorizationDigest` dropped a never-written
  nonce from the packed encoding until the `+ 0` fix). A wrong answer from the app host can only
  cause a refusal, never a different signature.
- **The chain-state connection carries no secrets.** The token goes only to the vault. The single
  request to the app host is a public read over verified TLS; a wrong answer yields at worst a
  useless or later-valid signature for the operator the user typed, never consent to a different
  operator (§4, trust boundaries).
- **A `register` signature is inert for anyone but the named operator.** A `setOperator`
  signature is an execute-now instruction for whoever holds it: it cannot change the outcome but
  it can trigger the self-bond release and eligibility re-check before the intended moment. The
  script states this before signing, and the operator-change deep link is addressed to the new
  operator only. There is no UI-side guard that can prevent early execution under the current
  contract.
- **Admin binding changes do not invalidate outstanding authorizations.** `adminSetOperator`,
  `addValidator(s)` and `removeValidator` never touch `authorizationNonce`. Scenario: the validator
  signs consent for B; admins vote the operator to C; whoever still holds the B signature submits
  it and moves the operator back to B, releasing C's self-bond. The same holds for an unused
  `register` signature after an admin listing, though there only B could submit it. **Under the
  current contract this is an accepted limitation**, mitigated operationally: sign only when the
  handover is about to happen, and treat any admin rebinding as a reason to check for signatures
  in flight. §8 removes the gap with a small contract change.
- **Operator has no consent step on `setOperator`.** A validator can name any account as operator.
  Being named grants only rights (rewards, commission control); there is no slashing in this phase.
  `register` is consented by construction. Accepted.
- **Listed ≠ active.** Registry `active` means listed; consensus membership lives in staking. The
  script therefore states consequences generically ("may leave the consensus set") and the app,
  which has staking state, shows the precise status after the transaction (§6.4).
- **One validator per operator is an app rule, not yet a contract rule.** Hasan's rule (2026-10-01):
  an operator operates at most one validator. `ValidatorRegistry` has no operator-uniqueness check
  (helium operator `7b1f…` runs four genesis validators), so the backend refuses `register` /
  `setOperator` for an account that already operates an active validator (409) and the UI offers
  no second-validator path. Admin votes and direct contract calls can still create 1:N bindings
  until §8's contract change lands.
- **Digest lacks chainId.** Registry address scoping suffices today (helium and upquark registries
  differ). Note for a future logic swap; not changed here.

## 8. Contract changes for the next registry logic swap: nonce bump on every binding write, one validator per operator

Recommended to ride along with the prod registry logic swap (runbook step 1) and, on helium, one
more `setLogicContract` vote on the registry proxy. The digest format is unchanged, so the script,
backend and UI are unaffected.

Change in `ValidatorRegistry.sol`:

- `_consumeAuthorization` only verifies; it no longer increments.
- `_list` (first listing and relisting, admin or permissionless) and `_changeOperator` (signed or
  admin) each do `authorizationNonce[validator] += 1` after the binding is written.

Effect: every path that writes a validator → operator binding, including every admin vote,
retires all outstanding signatures for that validator. The scenario in §7 becomes impossible: after
admins set C, the B signature is over a stale nonce and reverts. Signed paths still consume exactly
one nonce per binding, so nothing changes for the happy path.

Second change for the same swap, **one validator per operator** (rule set 2026-10-01): keep a
`mapping(address => address) validatorOf` (operator → validator) written in `_list` and
`_changeOperator`; require `validatorOf[operator] == address(0) || validatorOf[operator] ==
validator` on every binding write, admin paths included. Grandfather existing 1:N data (helium's
`7b1f…` with four validators) by only enforcing on writes, never on reads; an admin
`adminSetOperator` away from a shared operator clears its slot.

Tests to add in `tests/Staking/ValidatorRegistry.test.sol` (§9 items 3–5, plus: second `register`
by the same operator reverts; `setOperator` to an operator that already has a validator reverts;
admin re-assignment frees the slot) and a one-line update to `staking-consensus.md`'s description
of the nonce and operator binding.

## 9. Testing

1. **Vector test for the script's crypto.** The contract test
   (`tests/Staking/ValidatorRegistry.test.sol`) pins digest
   `0xb40f7746740b70994c96fae88ae656ddfaf42a06872675fdde41dbee73e79bd3` for registry `0x1111…`,
   validator `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`, operator `0x2222…`, nonce 7, and a
   signature (r `0xb5eefa7d…d121`, s `0x545274b8…939f`, v 27) recovering to that validator. The
   script's Keccak and recovery code must reproduce both (`--digest-only` plus a hidden self-test).
2. **Script**: start-up Keccak self-test against the contract vector; a mock-server suite covered
   every exit code during development and was dropped on 2026-10-01 (decision: no tests for `bin/`
   tools); the hybrid run against the live helium registry (§4) is the standing check.
3. **Contract: third-party submission.** A `User` that is neither validator nor operator submits a
   valid `setOperator` signature; the binding changes and the outgoing self-bond is queued. This
   documents the execute-now property in §3.
4. **Contract: unused signature survives an admin reassignment (current behaviour).** Validator
   signs for B (nonce 0); owner `adminSetOperator` → C; the B signature still succeeds and moves the
   operator back to B. Marked as the documented limitation; flipped to "reverts" when §8 lands.
5. **Contract: with §8**, the same sequence reverts with `VR: validator did not authorize operator`,
   and `addValidator` on a fresh validator also retires a pre-signed `register` authorization.
6. **Contract: untouched nonce.** A validator listed only through admin paths has
   `authorizationNonce == 0` and `operatorAuthorizationDigest` equals `authorizationDigest(…, 0)`.
   Landed as `it_digest_for_a_fresh_validator_includes_nonce_zero` with the fix for
   strato-net/private#220; it failed on `develop` before the `+ 0`.
7. **Helium end-to-end** on a *new* node (not one of the four active validators, which are bound to
   `7b1f8cd0…` and would lose their self-bond): run the script, open the link, register with a test
   operator, verify `ValidatorListed`; run again for a second operator, submit through the
   Change-operator card **from a third account** to confirm the execute-now behaviour, verify
   `OperatorChanged` and nonce 2. Confirm the stale-signature path by submitting the first
   signature again. Confirm the delisted path after an admin `removeValidator` vote on the test
   record.
8. **Backend unit tests** per §5.

## 10. Rollout

1. Merge the script, Makefile entries and `techdocs/node/operations.md` section ("Bind an operator
   to your validator"), including the execute-now and admin-rebinding caveats in plain words.
2. Merge backend and UI changes; deploy with runbook step 8 (helium backend/UI are pending anyway).
3. Helium end-to-end (§9.7).
4. §8 contract change: registry logic vote on helium; include in the prod registry logic swap.
5. Prod: the script refuses to run against the V1 registry, so it is safe to ship before the prod
   logic swap. The 17 prod validators are admin-listed with their operators (runbook step 5); the
   script is for later operator changes and new joiners.
6. Delete `deploy/sign-validator-authorization.js` once §9.7 passes (it also doubles the vault
   path against real ethconf values, see §2); update the design docs that reference it.

## 11. Appendix: why the node does not submit the transaction itself

`register`/`setOperator` accept `msg.sender == validator` with no signature, and the node's own
bloc endpoint would sign with the vault key given the node's token. But `payFees` (FeeRouter,
delegatecalled by the genesis `Decider`) transfers 0.01 USDST from the sender per transaction and
the node rejects the transaction outright when that throws. Node keys hold no USDST or vouchers,
so a validator runner would first have to fund the node address from the app. That extra step is
worse than the paste. If node keys ever get a fee exemption or a voucher grant, the same script
grows a `--submit` flag; nothing here precludes it. Note that a node-submitted `setOperator` would
also sidestep the execute-now concern in §3, since no detached signature would exist.
