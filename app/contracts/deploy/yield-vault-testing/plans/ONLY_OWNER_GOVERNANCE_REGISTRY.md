# YieldVault onlyOwner governance registry

This is the exhaustive `onlyOwner` registry for the YieldVault testnet tooling.
The executable source is
`deploy/yield-vault-testing/scripts/only-owner-registry.js`; offline tests compare every
submitted funding, seed, E2E, local pointer, and manual-runbook operation to it.
An unregistered or unmarked `onlyOwner` transaction fails before submission.

| Scope | Checkpoint(s) | Contract | Function |
|---|---|---|---|
| Funding | `mint-*` | `Token` | `mint(address,uint256)` |
| Old seed | `100` | `YieldVaultOld` | `initialize(address,string,string)` |
| Old seed | `130` | `YieldVaultOld` | `setMinIdleBps(uint256)` |
| Old seed | `131` | `YieldVaultOld` | `setStrategyApproval(address,bool)` |
| Old seed | `140`, `160` | `YieldVaultOld` | `deployCapital(address,uint256)` |
| Old seed | `152` | `YieldVaultOld` | `returnCapital(address,uint256)` |
| Old seed | `171` | `YieldVaultOld` | `reportStrategyLoss(address,uint256)` |
| Old seed | `182` | `YieldVaultOld` | `processQueue(uint256,uint256)` |
| Post-upgrade E2E | `202`, `213`, `605` | `YieldVault` | `returnCapital(address,uint256)` |
| Post-upgrade E2E | `210`, `600` | `YieldVault` | `deployCapital(address,uint256)` |
| Post-upgrade E2E | `212` | `YieldVault` | `reportStrategyLoss(address,uint256)` |
| Post-upgrade E2E | `400`, `411` | `YieldVault` | `setPerSecondSavingsRate(uint256)` |
| Post-upgrade E2E | `410` | `YieldVault` | `accrue()` |
| Post-upgrade E2E | `602`, `606` | `YieldVault` | `processQueue(uint256,uint256)` |
| Local deployment | `deploy-proxy`, `deploy-old-implementation`, `deploy-new-implementation` | original DEPLOYER `User` contract | `createContract(string,string,variadic)` |
| Local pointer | `activate-old-implementation`, `upgrade-pointer`, `rollback-pointer` | `Proxy` | `setLogicContract(address)` |
| Manual runbook | `pause` | `YieldVault` | `pause()` |
| Manual runbook | `initializeAccrual`, `initializeAccrualRepeat` | `YieldVault` | `initializeAccrual()` |
| Manual runbook | `setRewardDistributor` | `YieldVault` | `setRewardDistributor(address)` |
| Manual runbook | `setPerSecondSavingsRate` | `YieldVault` | `setPerSecondSavingsRate(uint256)` |
| Manual runbook | `unpause` | `YieldVault` | `unpause()` |
| Manual smoke | `smokeProcessQueue` | `YieldVault` | `processQueue(uint256,uint256)` |

`YieldVaultOld.pause()` and `YieldVaultOld.unpause()` are registered contract
operations but no old-seed checkpoint submits them. `YieldVault`
`setStrategyApproval`, `setMinIdleBps`, `setRewardDistributor`, `pause`, and
`unpause` are likewise registered even when a particular automated sequence
does not submit them.

For governed mode, `VAULT_OWNER_ADDRESS` (or the token storage owner for
funding) is AdminRegistry `000000000000000000000000000000000000100c`.
`DEPLOYER_ADDRESS`, `OWNER_ADDRESS`, and `MINTER_ADDRESS` remain primary
authenticated EOA signers. `APPROVER_ADDRESS` is the dedicated second admin.
Every signer used by a governed operation must have nonzero live
`AdminRegistry.adminMap` membership, and APPROVER must differ from that
operation's primary signer. Direct-owner disposable mode remains valid when the
primary signer equals the relevant storage owner.

Every governed checkpoint records the primary submission hash and nonce, exact
`IssueCreated` issue ID/target/function/positional arguments/block/timestamp,
then journals and submits the same target/function/arguments with APPROVER.
No flow calls `AdminRegistry.castVoteOnIssue`. The APPROVER raw transaction,
hash, nonce, receipt, exact newer `IssueExecuted`, target events, and post-state
are verified under the execution transaction. Hashless approval recovery uses
the saved APPROVER account sequence and fails closed if it cannot prove the
exact transaction or definitive absence. The entire reconciliation remains
inside the 60-second boundary and resumes without duplicating either call.
