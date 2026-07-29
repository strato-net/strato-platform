# YieldVault Contract Tests

Run:

```sh
solid-vm-cli test mercata/contracts/tests/YieldVault/YieldVault.test.sol
```

Each test starts with a newly initialized vault and standard 18-decimal asset token.

## Initialization, capital, loss, and pause

1. `it_initializes_correctly` — Creates a vault and checks its asset, empty accounting, default rate, idle policy, and queue ID.
2. `it_cannot_initialize_twice` — Calls `initialize` again and requires a revert.
3. `it_only_deploys_to_approved_strategies_and_respects_idle_reserve` — Attempts unapproved and excessive deployment, then verifies an approved deployment leaves the configured idle reserve.
4. `it_returnCapital_realizes_profit_without_manual_gain_reporting` — Deploys principal, returns more than the debt, and checks the excess raises assets and share price.
5. `it_returnCapital_settles_accrual_before_realizing_profit` — Waits with funded accrual, returns strategy profit, and verifies accrual used the pre-profit asset base.
6. `it_reportStrategyLoss_is_strategy_specific_write_down` — Deploys to two strategies, reports one loss, and checks only that strategy and global deployed assets decrease.
7. `it_reportStrategyLoss_settles_accrual_before_write_down` — Waits with funded accrual, reports a loss, and verifies accrual settles before the write-down.
8. `it_pause_blocks_new_entry_and_admin_mutation_but_allows_unwind` — Pauses after deployment and verifies entry, processing, deployment, loss, and explicit accrual stop while capital return remains possible.

## Instant and queued exits

9. `it_redeemOrQueue_queues_when_idle_is_insufficient` — Deploys most idle assets, redeems all shares, and checks the request and escrowed shares enter the queue.
10. `it_redeemOrQueue_pays_immediately_when_fully_liquid` — Redeems in a liquid vault and checks assets transfer, shares burn, and no request is created.
11. `it_redeemOrQueue_queues_full_request_and_stores_receiver_when_not_fully_liquid` — Forces queueing and checks the complete share amount and requested receiver are stored.
12. `it_restricts_users_to_one_active_request` — Creates one request and requires a second request by the same owner to revert.
13. `it_cancelRequest_returns_head_request_shares` — Cancels the sole head request and checks shares and all queue pointers are restored.
14. `it_cancelRequest_advances_head_without_touching_tail` — Queues three users, cancels the head, and checks the next request becomes head while the tail remains unchanged.
15. `it_processQueue_partially_processes_head_when_idle_is_limited` — Processes a request with limited idle and checks only the liquid portion burns and becomes claimable.
16. `it_processQueue_partial_fill_respects_asset_budget_at_non_unit_rate` — Raises the share price, applies a small processing budget, and checks reserved assets stay within that budget.
17. `it_processQueue_fully_processes_fifo_before_next_request` — Queues two users and verifies the first clears before the second receives a partial fill.
18. `it_claim_transfers_reserved_assets` — Processes a partial request, adds stray assets, claims, and checks the reservation pays while stray assets go to the distributor.
19. `it_allows_new_deposits_while_queue_exists` — Opens a queue, deposits from another user, and checks new shares coexist with queued shares.
20. `it_keeps_queued_unprocessed_shares_in_pricing` — Realizes profit before queueing and verifies queued shares remain in supply and new deposits use the same price.
21. `it_immediate_withdrawals_are_capped_by_claimable_reservations` — Partially processes a request and checks another holder has no instant exit capacity while the queue and claims remain.
22. `it_open_queue_blocks_instant_exits_and_deployment_after_capital_returns` — Returns capital into an open queue and verifies it remains reserved for FIFO processing.
23. `it_proxy_single_open_request_keeps_head_and_tail_aligned` — Runs one queued request through a proxy and checks head, tail, ID, and queued shares agree.
24. `it_proxy_full_process_of_last_request_clears_queue_pointers` — Processes and claims the final proxied request and checks queue and claim state fully clear.

## Accrual, donations, and upgrade

25. `it_initializes_funded_accrual_once` — Checks default accrual state and requires a second accrual initialization to revert.
26. `it_only_allows_owner_to_call_external_accrue` — Requires a non-owner accrual call to revert and confirms the owner can call it.
27. `it_rejects_vault_as_reward_distributor` — Attempts to set the vault as its own distributor and checks configuration is unchanged.
28. `it_rejects_indebted_strategy_as_reward_distributor` — Gives a strategy debt, attempts to make it distributor, and requires a revert.
29. `it_rejects_deployment_to_reward_distributor` — Approves the distributor as a strategy but verifies deployment to it still reverts.
30. `it_keeps_virtual_and_live_accounting_aligned_without_donations` — Executes entry, exit, deployment, profit, loss, and accrual while checking `accountedAssets` after each step.
31. `it_removes_direct_donations_before_deposit_pricing` — Donates assets, deposits another user, and verifies the donation is excluded from pricing and returned to the distributor.
32. `it_cleans_preexisting_donation_when_initial_distributor_is_configured` — Donates before configuring a distributor and checks configuration removes the excess.
33. `it_cleans_donation_before_capital_deployment` — Donates before deployment and verifies only accounted assets can become strategy debt.
34. `it_prevents_donations_from_inflating_distributor_accrual` — Adds a large donation and checks accrual target and funded amount remain based on accounted assets.
35. `it_accrues_compounded_funded_rewards_into_idle_assets` — Waits with funded rewards and checks actual credited assets raise idle assets and share price without minting shares.
36. `it_accrues_only_available_funding_without_backlog` — Underfunds one interval and verifies later funding does not retroactively pay the skipped amount.
37. `it_caps_accrual_by_distributor_allowance` — Funds the distributor above its allowance and checks accrual credits only the allowance.
38. `it_accrues_before_pricing_a_new_deposit` — Waits with funded rewards, previews a deposit, and checks execution settles accrual before minting.
39. `it_accrues_before_pricing_a_mint_and_matches_preview` — Previews a mint after elapsed funded yield and checks the exact previewed assets are spent.
40. `it_accrues_before_withdrawal_pricing` — Previews an asset withdrawal after elapsed yield and checks execution burns the previewed shares.
41. `it_accrues_before_redeem_pricing` — Previews a share redemption after elapsed yield and checks execution pays the previewed assets.
42. `it_projects_max_exit_on_reconciled_assets_and_pending_accrual` — Adds pending rewards and a donation, then checks previews and maximum exits include only reconciled funded value.
43. `it_projects_donation_reconciliation_that_funds_distributor` — Donates to an underfunded distributor path and verifies projected and executed redemption agree.
44. `it_accrues_before_queue_processing_and_keeps_processed_claim_fixed` — Processes after elapsed yield, waits again, and checks the processed claim no longer changes.
45. `it_rate_change_settles_old_rate_before_update` — Changes to a flat rate after elapsed yield and verifies the old rate settles exactly once.
46. `it_distributor_change_settles_from_old_distributor` — Switches distributors after elapsed yield and checks the old distributor funds the settled interval.
47. `it_keeps_realized_and_projected_exchange_rates_separate` — Compares realized and funded projected rates, accrues, and checks realized value catches up.
48. `it_proxy_upgrade_preserves_state_and_initializes_accrual` — Upgrades a proxied vault with deployment and queue state, initializes accrual, and verifies all legacy state survives.

## Economic and authorization invariants

49. `it_reconciled_share_rate_never_decreases_without_loss` — Runs deposits, minting, deployment, returns, profit, accrual, exits, donation cleanup, queueing, processing, and claim while cross-multiplying reconciled NAV and supply after every step.
50. `it_only_authorized_reported_loss_reduces_share_value_exactly` — Simulates a strategy loss, rejects unauthorized and invalid reports, then checks the valid report reduces debt, NAV, and each holder's value exactly.
51. `it_partial_queue_claim_stays_fixed_while_remainder_bears_loss` — Processes half a request, reports a loss, and verifies the fixed half is protected while the queued remainder and active holder bear the loss.
52. `it_keeps_claim_reserves_senior_after_queue_closes` — Fully processes one holder, closes the queue, returns capital, and verifies another holder can exit without consuming the reserved claim.
53. `it_rejects_new_deposits_into_a_fully_impaired_share_supply` — Writes active NAV to zero while shares remain and requires a new deposit to revert.
54. `it_enforces_owner_authorization_for_value_management` — Attempts deployment, return, loss, configuration, and processing as an attacker and checks every call reverts without state changes.
55. `it_enforces_delegated_exit_allowances` — Rejects unapproved delegated exits, then verifies approved queueing and redemption consume exactly the granted share allowance.
56. `it_conserves_accounting_and_classifies_every_underlying_outflow` — Tracks actual balance deltas through entry, deployment, return, accrual, withdrawal, queue claim, stray removal, and loss against the accounting ledger.
57. `it_allows_processed_claim_and_partial_cancellation_while_paused` — Pauses after partial processing and verifies the user can claim the fixed portion and cancel the remainder.
58. `it_rejects_non_head_cancellation_without_changing_queue` — Attempts to cancel the second request and verifies the call reverts without changing queue pointers, requests, escrowed shares, or underlying.
59. `it_excludes_processed_claim_liabilities_from_accrual` — Fully processes one holder, accrues funded rewards, and verifies the target excludes the fixed claim while rewards benefit only active shares.
60. `it_recognizes_recovered_loss_as_profit_on_later_return` — Reports a strategy loss, later returns more than the reduced debt, and verifies the recovered amount restores shareholder value as profit.
61. `it_keeps_aggregate_deployed_assets_equal_to_strategy_debts` — Applies independent profit and loss outcomes to two strategies and checks global deployed assets always equal their remaining debts.
62. `it_starts_a_new_lifecycle_at_one_to_one_after_full_exit` — Completes a profitable vault lifecycle, drains all shares and assets, then verifies the next depositor starts from a clean one-to-one rate.
63. `it_allows_request_owner_to_choose_claim_receiver_at_claim_time` — Requests one receiver, claims to another, and verifies the owner-selected claim receiver is paid exactly once.
64. `it_recovers_from_a_donation_made_before_distributor_configuration` — Shows an unrouteable donation blocks withdrawal atomically, then configures the distributor, removes the donation, and restores withdrawal.
65. `it_reverts_failed_underlying_payout_atomically` — Forces the underlying transfer to return false and verifies the failed redemption rolls back burned shares, supply, assets, and accounting.
