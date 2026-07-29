# YieldVault testnet command sheet

Run from `mercata/contracts`:

```bash
set -a
source deploy/yield-vault-testing/.env
set +a
```

The local `.env` must provide independently authenticated
`APPROVER_USERNAME` (`Admin #3`), `APPROVER_PASSWORD`, and
`APPROVER_ADDRESS`. Scripts verify live nonzero AdminRegistry membership and
reject any operation whose primary signer equals APPROVER.

When a command prints `GOVERNANCE_ISSUE`, it automatically journals and submits
the exact same target/function/arguments with `APPROVER`. It never calls
`AdminRegistry.castVoteOnIssue`. If transport/indexing interrupts reconciliation,
rerun the same command (or printed `--checkpoint` command); never start with
fresh artifact paths while a run is pending.

## Abandoned Phase 0 artifacts

Do not use proxy `917e95e65bf009dd17610d3b68052c05d91ffb7b` or old
implementation `f4c539b8f15fa2ea059ad8457b8d882e5bf3ee35`. Both were created
by `Admin #2`, so they are not indexed in Cirrus for this workflow.
They are abandoned; do not delete them.

Never approve pending issue
`cfb8808c4c13a7dea92b41fe673b7763db45a9c96dc10bdfd6a2883291c460d9`.
Do not resume its old run-state.

The first `Admin #1` retry created proxy
`992b80a357a8791be149bab77b67de39eb96293e` and implementation
`22cba31ff2dec15e6ed0c1e84190e872408535b3`, but the implementation was
not indexed because the request omitted the repository's required
`query.username=BlockApps` option. Abandon both and never approve issue
`3fb3989392fd44b77e53085968a8500156e21dd686880a7adfef87cfca2c723d`.

## Fresh Step 0 after artifact cleanup

Confirm `DEPLOYER_USERNAME` is `Admin #1` and that DEPLOYER credentials/address
match MINTER. OWNER remains `Admin #2`; `VAULT_OWNER_ADDRESS` remains
AdminRegistry. After the separately handled local runtime-artifact cleanup, use
new paths:

```bash
npm run yield-vault:deploy-old-proxy -- \
  --run-state ./yield-vault-old-proxy-run-state-cirrus-v2.json \
  --evidence-output ./yield-vault-old-proxy-evidence-cirrus-v2.json
```

DEPLOYER submits Proxy and YieldVaultOld creation with
`query.username=BlockApps`. For each governed deployment, APPROVER calls
`createContract` on the same DEPLOYER User contract with identical name, source,
and nested constructor arguments. OWNER submits `Proxy.setLogicContract`, and
APPROVER repeats the identical pointer call.

Fresh Step 0 is complete:

```text
VAULT_PROXY=f55ea6d9e708dd326a5f9faeb49e07e4609696d3
OLD_IMPLEMENTATION=a36c2124057aded1da21c363ac8ee3ec5300d9f9
```

The Proxy creation, YieldVaultOld creation, and pointer activation issues are
approved and the completed evidence is
`yield-vault-old-proxy-evidence-cirrus-v2.json`.

## Complete workflow

### 1. Verify tooling and generate the actor file

```bash
npm test

npm run yield-vault:actors -- \
  --output ./yield-vault-actors.json
```

### 2. Fund actors

```bash
npm run yield-vault:fund-actors -- \
  --asset "$ASSET_ADDRESS" \
  --fee-token "$FEE_TOKEN_ADDRESS" \
  --runs 10 \
  --actors ./yield-vault-actors.json \
  --output ./yield-vault-funding-manifest.json
```

The script automatically repeats each governed `Token.mint(to, amount)` with
APPROVER. Rerun the same command after an interrupted reconciliation; it resumes from
`yield-vault-funding-manifest.json.run-state.json`.

### 3. Deploy the old fixture (fresh runs only)

```bash
npm run yield-vault:deploy-old-proxy -- \
  --run-state ./yield-vault-old-proxy-run-state-cirrus.json \
  --evidence-output ./yield-vault-old-proxy-evidence-cirrus.json
```

Approve each printed creation issue and the later
`Proxy.setLogicContract(YieldVaultOld)` issue, rerunning the identical command
after each stop.

### 4. Seed `YieldVaultOld`

```bash
npm run yield-vault:seed-old -- \
  --run-state ./yield-vault-seed-run-state.json
```

For every interrupted checkpoint, resume exactly as printed; the saved
APPROVER intent/hash/nonce prevents duplicate primary and approval calls:

```bash
npm run yield-vault:seed-old -- \
  --run-state ./yield-vault-seed-run-state.json \
  --checkpoint <PRINTED_CHECKPOINT>
```

### 5. Capture the pre-upgrade state

```bash
npm run yield-vault:capture-runbook -- \
  --phase initial \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --output ./yield-vault-runbook-initial-snapshot.json
```

### 6. Execute the safe-upgrade runbook

Submit these transactions in order, retaining every receipt/event:

1. `OWNER -> YieldVault.pause()`, then `APPROVER -> YieldVault.pause()`.
2. Run the guarded old-to-new upgrade:

   ```bash
   npm run yield-vault:safe-upgrade -- \
     --proxy-address "$VAULT_PROXY" \
     --expected-old-implementation "$OLD_IMPLEMENTATION" \
     --expected-owner "$VAULT_OWNER_ADDRESS" \
     --run-state ./yield-vault-safe-upgrade-run-state.json \
     --evidence-output ./yield-vault-upgrade-evidence.json
   ```

   The script automatically repeats the DEPLOYER User contract's
   `createContract("YieldVault", combinedSource, deadbeef)` with APPROVER, then
   repeats OWNER's `Proxy.setLogicContract(newImplementation)` with APPROVER.
3. `OWNER -> YieldVault.initializeAccrual()`, then the identical APPROVER call.
4. Repeat the OWNER/APPROVER `initializeAccrual()` pair and retain the expected
   failed APPROVER execution receipt.
5. Capture post-initialization:

   ```bash
   npm run yield-vault:capture-runbook -- \
     --phase post-initialization \
     --seed-manifest ./yield-vault-seed-manifest.json \
     --funding-manifest ./yield-vault-funding-manifest.json \
     --output ./yield-vault-runbook-post-initialization-snapshot.json
   ```

6. OWNER and then APPROVER manually call identical
   `YieldVault.setRewardDistributor(REWARD_DISTRIBUTOR)`.
7. OWNER and then APPROVER manually call identical
   `YieldVault.setPerSecondSavingsRate(10^27)`.
8. Run the remaining smoke preparation transactions:

   ```bash
   npm run yield-vault:prepare-smoke -- \
     --seed-manifest ./yield-vault-seed-manifest.json \
     --funding-manifest ./yield-vault-funding-manifest.json \
     --run-state ./yield-vault-smoke-preparation-run-state.json \
     --evidence-output ./yield-vault-smoke-preparation-evidence.json
   ```

   This submits, in order:
   - `REWARD_DISTRIBUTOR -> ASSET.approve(VAULT_PROXY, 30 * 10^18)`
   - `SMOKE_USER -> ASSET.approve(VAULT_PROXY, 10 * 10^18)`

   It refuses to submit either allowance unless the live reward distributor
   exactly matches `REWARD_DISTRIBUTOR` and the live rate is exactly `10^27`.
9. Capture pre-smoke:

    ```bash
    npm run yield-vault:capture-runbook -- \
      --phase pre-smoke \
      --seed-manifest ./yield-vault-seed-manifest.json \
      --funding-manifest ./yield-vault-funding-manifest.json \
      --output ./yield-vault-runbook-pre-smoke-snapshot.json
    ```

10. OWNER and then APPROVER call identical `YieldVault.unpause()`.
11. Run the four smoke transactions:

    ```bash
    npm run yield-vault:run-smoke -- \
      --seed-manifest ./yield-vault-seed-manifest.json \
      --funding-manifest ./yield-vault-funding-manifest.json \
      --run-state ./yield-vault-smoke-run-state.json \
      --evidence-output ./yield-vault-smoke-evidence.json
    ```

    The script submits, in order:
    - `SMOKE_USER -> deposit(10 * 10^18, SMOKE_USER)`
    - `SMOKE_USER -> redeemOrQueue(10 * 10^18, SMOKE_USER, SMOKE_USER)`
    - OWNER and APPROVER identical `processQueue(3, 160 * 10^18)` calls
    - `SMOKE_USER -> claim(SMOKE_USER)`

### 7. Build the validated runbook report

```bash
cp deploy/yield-vault-testing/fixtures/manual-upgrade-evidence.example.json \
  ./yield-vault-manual-upgrade-evidence.json

# Fill the copied file with the retained live receipts/events, then:
npm run yield-vault:runbook-report -- \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --upgrade-evidence ./yield-vault-upgrade-evidence.json \
  --manual-evidence ./yield-vault-manual-upgrade-evidence.json \
  --output ./yield-vault-safe-upgrade-report.json
```

### 8. Run post-upgrade E2E

```bash
npm run yield-vault:upgrade-e2e -- \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --runbook-report ./yield-vault-safe-upgrade-report.json \
  --run-state ./yield-vault-e2e-run-state.json
```

After an interrupted reconciliation, resume exactly as printed:

```bash
npm run yield-vault:upgrade-e2e -- \
  --seed-manifest ./yield-vault-seed-manifest.json \
  --funding-manifest ./yield-vault-funding-manifest.json \
  --runbook-report ./yield-vault-safe-upgrade-report.json \
  --run-state ./yield-vault-e2e-run-state.json \
  --checkpoint <PRINTED_CHECKPOINT>
```
