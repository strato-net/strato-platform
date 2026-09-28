# Runbook: sweep a bridge withdrawal to the triage wallet

Use this when a withdrawal on the MercataBridge (0x1008) must not go out, and its escrow
should be captured for redistribution instead of refunded to the requester.

The order is fixed: **sweep on STRATO first, reject the Safe proposal second.** The
sweep locks the outcome on STRATO; the rejection stops the payout on the external chain.
Never execute the Safe proposal after a sweep: that pays the recipient on both sides.

## Before you start

- `app/contracts/.env` has your admin credentials (`GLOBAL_ADMIN_NAME`, `GLOBAL_ADMIN_PASSWORD`,
  `OAUTH_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, plus `OAUTH_TOTP` if your account uses OTP).
  Nothing else needs configuring; the network is chosen on the command line.
- You have the withdrawal id(s) and the triage wallet address.
- `cd app/contracts && npm install` has been run once on this machine.

## 1. Dry run (no credentials used, nothing submitted)

```bash
cd app/contracts
node deploy/sweep-withdrawal.js --env prod --ids 274 --triage <triage-wallet>
```

Check the printout: the withdrawal is `INITIATED` or `PENDING_REVIEW`, the sender, token and
amount are the ones you expect, and the destination is the triage wallet. The command refuses
anything that is not sweepable, so a wrong id cannot be swept by accident.

If a line says `flagged useHotWallet`, stop and read it: hot-wallet withdrawals are paid by the
relayer without signatures, so a `PENDING_REVIEW` one may already be paid on the external chain.
Check the custody tx hash on the explorer before adding `--allow-hot-wallet`.

## 2. Sweep

```bash
node deploy/sweep-withdrawal.js --env prod --ids 274 --triage <triage-wallet> --execute
```

The command does all of the STRATO side:

1. Checks that the bridge logic has `cancelAndSweepWithdrawal`. If it does not, it deploys the
   patched MercataBridge implementation (or reuses one another admin already deployed) and points
   the proxy at it.
2. Calls `cancelAndSweepWithdrawalBatch(ids, triageWallet)`.
3. Prints the Safe proposal(s) to reject.

It ends in one of two ways:

- **`STRATO side done`**: go to step 3.
- **`PENDING GOVERNANCE VOTES`** (exit code 2): the bridge is governed by the AdminRegistry, so on
  mainnet each step is a vote. Have the other admin(s) run the **same command with the same ids and
  triage wallet**, then run it again yourself. Every run advances whatever is pending and skips what
  is already done; nothing is deployed or swept twice. Repeat until it says done.

## 3. Reject the Safe proposal

The command prints, per withdrawal: the external chain, the custody Safe address and the
`safeTxHash`. In the Safe app open that Safe, find the transaction under **Queue** by its hash,
choose **Reject**, collect the signatures and execute the rejection.

The relayer sees the rejection and tries to abort the withdrawal on STRATO. That call fails with
`MB: not abortable` because the withdrawal is already `SWEPT`; the relayer logs it as already
handled and moves on. No action needed.

## Verify

- Cirrus: `.../cirrus/search/BlockApps-MercataBridge-withdrawals?address=eq.0000000000000000000000000000000000001008&key=eq.274`
  shows `"bridgeStatus": "5"` (SWEPT).
- The triage wallet holds the escrowed amount of the STRATO token.
- The Safe queue no longer contains the proposal.

## If something goes wrong

- Re-running the command is always safe.
- To sweep to a different wallet than another admin proposed, every admin has to re-run with the
  new wallet; votes are per (ids, wallet) combination.
- `--no-upgrade` makes the command fail instead of upgrading the bridge, if you prefer to run
  `deploy/upgrade.js` separately (see the README table, proxy 1008).
- `--force-upgrade` redeploys the bridge logic from the current `BaseCodeCollection.sol` even if the
  deployed logic can already sweep. The command compares the on-chain code hash of the proxy's logic
  with the hash of the local source (shown in the dry run) and only redeploys on a mismatch, so
  re-running it later is still a no-op. Use it when the earlier deployment was built from the wrong
  file or an older source.
- Never whitelist the relayer for `cancelAndSweepWithdrawal`.
