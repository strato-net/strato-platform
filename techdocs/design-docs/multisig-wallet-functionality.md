# Multisig Wallet: How It Works

A plain-language guide to how dedicated multisig wallets behave, with the nuances that
are easy to miss. The full design is in
[multisig-wallet-specification.md](multisig-wallet-specification.md).

## The three pieces

| Piece | Contract | What it is | Can it change? |
|---|---|---|---|
| Multisig wallet | `MultisigWallet` (the "shell") | The permanent address that holds the funds, plus the upgrade machinery | Never, for an existing multisig wallet. Fixed at creation. |
| Rules | `MultisigLogic` | Proposals, approvals, signers, waiting period | Yes, per multisig wallet, through the 7-day upgrade |
| Registry | `MultisigFactory` (behind a standard proxy) | Creates multisig wallets and keeps the list of approved rule versions | Yes, in place, by its proxy owner |

Every call a multisig wallet does not handle itself is passed to its current rules
contract and runs against the multisig wallet's own storage and funds.

## Creating a multisig wallet

1. Anyone creates an **invitation**: a name, at least three signers, the number of
   approvals required, a waiting period, and a rules version.
2. **Every** named signer confirms the invitation.
3. On the last confirmation the multisig wallet is created, already active.

Nuances:

- Required approvals `M` must satisfy `2 <= M < N`. All-signers-required is not allowed.
- The creator gets no special authority. If they are not a signer, their only power is
  cancelling the invitation before it completes.
- The creator or any named signer can cancel a pending invitation. One signer is enough.
- An invitation expires after 30 days.
- The name is public, permanent, at most 64 bytes, and **not unique**. Anyone can create
  a multisig wallet with the same name as another one. Signers should check the other
  signers and the approval count before confirming.
- The multisig wallet address exists only after the last confirmation. SMD does not show
  an address before then. Funds sent to a predicted address are lost if the invitation
  is cancelled or expires.
- If the chosen rules version is deprecated before the last confirmation, creation is
  refused and a new invitation is needed.
- A multisig wallet cannot be one of its own signers.

## Proposals

Everything a multisig wallet does goes through a proposal: transfers, protocol actions,
signer changes, upgrades.

1. A signer **proposes**. Proposing counts as that signer's approval.
2. Other signers **approve**. Each approver resubmits the full action, so an approval
   only counts for exactly what was proposed.
3. When approvals reach `M`, the **waiting period** starts.
4. After the waiting period, any signer **executes** it, within 7 days.

| Situation | What happens |
|---|---|
| Waiting period is zero | The proposal runs in the same transaction as the final approval |
| Not enough approvals within 30 days | The proposal expires |
| Not executed within 7 days of becoming executable | The proposal expires |
| A signer changes their mind before `M` is reached | They can withdraw their approval |
| The proposer wants to drop it | Allowed only while no other signer has approved |
| Signers want to stop a proposal already in its waiting period | A "cancel" proposal, which runs as soon as it reaches `M` approvals, with no waiting period |
| The action fails when executed | The whole transaction is undone; the proposal can be retried until it expires |

Only signers can propose, approve, and execute.

## Changing signers, approvals, or the waiting period

| Change | How | Extra step |
|---|---|---|
| Remove a signer or change required approvals | Proposal | None |
| Add a signer | Proposal that nominates the new account | The nominee must accept within 30 days |
| Change the waiting period (max 30 days) | Proposal | None |

Nuances:

- All of these wait out the **current** waiting period. Shortening the waiting period
  still takes the old one.
- A nomination can add exactly one new signer and may remove others in the same step.
- Only one nomination is open at a time. A new one replaces it.
- Withdrawing a nomination is a normal proposal and waits the waiting period, so the
  nominee can still accept in the meantime.
- **Any** of these changes invalidates every open proposal, the open nomination, and a
  pending upgrade. Signers must propose them again. This prevents approvals collected
  under the old signer set from being used under the new one.

## Upgrading a multisig wallet's rules

This is what the 7-day upgrade delay is for. Publishing new rules never changes a
multisig wallet on its own; each multisig wallet opts in.

1. **Platform side, once.** The new rules are published in the registry as a version,
   and an upgrade path from the old version to the new one is approved.
2. Signers **propose** the upgrade and reach `M` approvals.
3. The multisig wallet's **waiting period** passes.
4. The **7-day upgrade delay** runs.
5. **Anyone** can execute the upgrade during the following 7 days. After that it expires
   and must be proposed again.

Nuances:

- The total wait is the multisig wallet's waiting period plus 7 days.
- Cancelling a pending upgrade runs as soon as the cancel proposal reaches `M`
  approvals.
- Only one upgrade can be pending at a time.
- The version and the upgrade path are checked again at execution. If either was
  withdrawn during the delay, the upgrade is refused.
- A signer or waiting-period change during the delay cancels the pending upgrade.
- After an upgrade, all open proposals are invalidated.
- An upgrade may include one migration step. Its name must start with `migrate`, it
  takes no input, and it can only run as part of the upgrade. If it fails, the whole
  upgrade is undone.
- Signers can **freeze upgrades** permanently. A frozen multisig wallet can never
  receive fixes; the only remedy is moving funds to a new multisig wallet.

## Deprecating a rules version

Deprecating (revoking) a version in the registry:

- Stops new multisig wallets from starting on it.
- Stops upgrades **to** it.
- Does **not** stop multisig wallets already running it. On-chain they can still
  propose, approve, move funds, and upgrade away from it.
- Does not force anything. A multisig wallet stays on the deprecated version until its
  own signers upgrade.

SMD currently treats a deprecated version as a failed check and makes the multisig
wallet read-only, including the upgrade controls. Until that changes, publish the
replacement version and its upgrade path, and let affected multisig wallets upgrade,
**before** deprecating the old version.

## Changing the registry

| Action | Address | Effect on existing multisig wallets |
|---|---|---|
| Upgrade in place (swap the code behind the proxy) | Unchanged | None. They keep working. |
| Deploy a new registry | New | They stay bound to the old address forever and SMD marks them as not matching |

- Once multisig wallets hold funds, the registry should only ever be upgraded in place.
- A registry upgrade has no built-in delay. It is controlled by the proxy owner
  (`AdminRegistry`), and can be given up permanently by renouncing proxy ownership.
  Version publishing keeps working after that.
- A registry upgrade can change how **new** multisig wallets are created and which
  versions count as approved. It cannot move funds, change signers, or change the rules
  of an existing multisig wallet.
- A change to the shell code reaches only multisig wallets created afterwards.

## How the node resolves calls

The node (bloc) recognises `MultisigWallet` as a proxy. For each call it checks a fixed
list of the shell's own functions:

`initializeDeployment`, `scheduleUpgrade`, `cancelUpgrade`, `executeUpgrade`,
`freezeUpgrades`, `advanceConfiguration`, `argumentAt`

- A function on the list is resolved against the shell.
- Anything else is resolved against the rules contract found in the multisig wallet's
  `logicContract` storage field.

Consequences:

- New functions in a new rules version need no node change.
- A new function on the shell needs adding to the list in
  `strato/api/bloc/bloc2/src/Bloc/Database/Queries.hs` and a node release.
- `logicContract` is a reserved name. A rules version must never declare a variable
  with that name, or with any other name the shell uses.

## Timings

| Setting | Value | Adjustable? |
|---|---|---|
| Invitation lifetime | 30 days | No |
| Time to collect approvals on a proposal | 30 days | No |
| Waiting period | 0 to 30 days | Yes, per multisig wallet |
| Time to execute after the waiting period | 7 days | No |
| Nomination lifetime | 30 days | No |
| Upgrade delay | 7 days | No |
| Time to execute an upgrade after the delay | 7 days | No |

## What cannot be undone or recovered

- **No recovery authority.** Nobody outside a multisig wallet's own signers can move its
  funds, change its signers, or upgrade it.
- **Lost keys.** A multisig wallet survives losing at most `N - M` signer keys.
- **Frozen upgrades** are permanent.
- **The name** cannot be changed.
- **The shell** cannot be changed. A flaw in the shell means creating a new multisig
  wallet and moving funds.
- **Funds sent to a predicted address** before creation can be stranded.
