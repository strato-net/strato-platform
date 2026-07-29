# Deposit-to-Withdrawal Flow Enumeration

## Definitions

- `D`: the user's successful `deposit` or `mint`.
- `W`: the user's assets leave the vault.
  - Instant: `withdraw`, `redeem`, or immediate `redeemOrQueue`.
  - Queued: `processQueue` fixes the amount, then `claim` transfers it.
- `A`: an accrual checkpoint. It credits currently funded yield and permanently skips any unfunded remainder for the elapsed interval.

Transactions can repeat, so literal sequences are unlimited. The flows below enumerate the semantically distinct transaction classes. Repeated classes matter only when they cross an `A`, entry price, exit price, or partial queue-processing boundary.

## 1. Immediate-exit flows

1. `D -> W`
   - No intervening economic change.

2. `D -> funded yield accrual -> W`
   - Assets per share increase.

3. `D -> strategy profit -> W`
   - Assets per share increase.

4. `D -> strategy loss -> W`
   - Assets per share decrease.

5. `D -> other users deposit/mint -> W`
   - Economically proportional; only integer rounding can change the user's result.

6. `D -> other users withdraw/redeem -> W`
   - Economically proportional; rounding can change the result and idle liquidity can be consumed.

7. `D -> vault-share transfer in/out -> W`
   - Per-share value is unchanged, but the user exits with more or fewer shares.

8. `D -> deployCapital(partial; enough idle remains) -> W`
   - Value is unchanged and the exit remains immediate.

9. `D -> deployCapital -> returnCapital(principal only) -> W`
   - Value is unchanged; liquidity leaves and later returns.

10. `D -> pause -> unpause -> W`
   - Pause changes timing only. Any funded accrual accumulated during the delay is settled at the next `A`.

11. `D -> another user's queue opens -> queue fully clears -> W`
    - The user cannot exit instantly while the queue is open, but can do so after it clears if enough idle remains.

## 2. Funded-accrual ordering flows

These are the complete checkpoint-level variants:

1. `D -> fund distributor -> A -> W`
   - The elapsed target is credited up to funding and allowance.

2. `D -> partially fund distributor -> A -> W`
   - Only the funded portion is credited; the shortfall is permanently skipped.

3. `D -> A while unfunded -> W`
   - The elapsed target is entirely skipped.

4. `D -> A while unfunded/partial -> fund later -> next A -> W`
   - The first shortfall is not recovered; only the later interval is credited.

5. `D -> fund distributor -> remove funding before A -> A -> W`
   - Accrual uses the reduced balance or allowance.

6. `D -> fund distributor -> A -> remove funding -> W`
   - Already credited yield remains in the vault.

7. `D -> direct vault donation -> A -> W`
   - The donation is swept to the distributor, then may fund accrual if allowance exists; it is not directly donated to shareholders.

8. `D -> A -> direct vault donation -> next A -> W`
   - The donation cannot fund the interval already settled; it can only affect the next interval.

`A` can be executed by explicit `accrue`, another entry/exit, `processQueue`, `setPerSecondSavingsRate`, `setRewardDistributor`, `returnCapital`, or `reportStrategyLoss`.

## 3. Rate-change flows

`setPerSecondSavingsRate` always accrues at the old rate before installing the new rate.

1. `D -> fund old-rate interval -> set rate(A) -> fund new-rate interval -> W(A)`
   - Both intervals settle at their respective rates.

2. `D -> set rate(A while unfunded) -> fund new-rate interval -> W(A)`
   - The old-rate interval is skipped; only the new-rate interval settles.

3. `D -> fund old-rate interval -> set rate(A) -> W before new elapsed time`
   - Only the old-rate interval contributes.

Multiple rate changes are repetitions of these interval flows.

## 4. Distributor-change flows

With an existing distributor, `setRewardDistributor` settles from the old distributor before switching.

1. `D -> fund old distributor -> switch distributor(A) -> fund new distributor -> W(A)`
   - Old and new intervals both settle from the correct distributor.

2. `D -> switch distributor(A while old is unfunded) -> fund old distributor -> W(A)`
   - The old interval is skipped; funding the old distributor after the switch has no effect.

3. `D -> switch distributor(A) -> A while new is unfunded -> fund new distributor -> next A -> W`
   - The first new-distributor interval is skipped; later funding applies only to a later interval.

4. `D -> no distributor -> configure funded distributor(A) -> W`
   - Special case: the new distributor is installed before `A` and can fund the previously elapsed interval.

## 5. Strategy ordering flows

`returnCapital` and `reportStrategyLoss` run `A` before recognizing the strategy result.

1. `D -> returnCapital(A, principal only) -> W`
   - NAV is unchanged; idle liquidity increases.

2. `D -> returnCapital(A, principal + profit) -> W`
   - Pre-return accrual uses the old NAV; profit raises NAV afterward.

3. `D -> reportStrategyLoss(A, loss) -> W`
   - Pre-loss accrual uses the old NAV; loss lowers NAV afterward.

4. `D -> profit -> later A -> loss -> W`
   - The intervening accrual uses the higher post-profit NAV.

5. `D -> loss -> later A -> profit -> W`
   - The intervening accrual uses the lower post-loss NAV.

6. `D -> return principal -> report loss -> W`
   - Valid only when remaining strategy debt covers the loss.

7. `D -> report loss -> return capital -> W`
   - The reduced debt can cause part of the return to be classified as profit; this ordering may succeed when flow 6 reverts.

## 6. Queued-exit flows

1. `D -> requestRedeem -> processQueue(full) -> claim`
   - `requestRedeem` always chooses the queue, even when enough idle exists.

2. `D -> insufficient idle -> redeemOrQueue(queued) -> processQueue(full) -> claim`
   - `redeemOrQueue` chooses the queue because immediate payment is unavailable.

3. `D -> deployCapital -> redeemOrQueue(queued) -> returnCapital -> processQueue -> claim`
   - Deployment forces the queue; returned principal supplies processing liquidity.

4. `D -> another request -> user's request -> process earlier request -> process user -> claim`
   - FIFO predecessors consume liquidity before the user.

5. `D -> user's request -> another request -> process user -> claim`
   - The user is ahead of the later request.

6. `D -> another request -> cancel/process it until queue clears -> W`
   - The user never queues and later exits instantly.

7. `D -> requestRedeem -> funded accrual -> processQueue -> claim`
   - Unprocessed shares receive the accrual; funding also adds processing liquidity.

8. `D -> requestRedeem -> strategy profit -> processQueue -> claim`
   - Unprocessed shares receive the profit.

9. `D -> requestRedeem -> strategy loss -> processQueue -> claim`
   - Unprocessed shares bear the loss.

10. `D -> requestRedeem -> another user deposits -> processQueue -> claim`
   - The new deposit adds idle liquidity and proportional supply; rounding can alter price slightly.

11. `D -> requestRedeem -> processQueue(partial) -> processQueue(remainder) -> claim`
    - Portions are fixed separately; without an intervening value change, only rounding differs.

12. `D -> requestRedeem -> processQueue(partial) -> gain -> processQueue(remainder) -> claim`
    - Only the unprocessed remainder receives the gain.

13. `D -> requestRedeem -> processQueue(partial) -> loss -> processQueue(remainder) -> claim`
    - Only the unprocessed remainder bears the loss.

14. `D -> requestRedeem -> processQueue(partial) -> claim fixed portion -> process remainder -> claim`
    - Claim timing does not change either fixed amount.

15. `D -> requestRedeem -> cancelRequest -> W`
    - No shares were processed; all requested shares return to the user before the later exit.

16. `D -> requestRedeem -> processQueue(partial) -> cancelRequest -> claim fixed portion + later W of returned shares`
    - The processed amount stays fixed; only remaining shares are returned.

17. `D -> requestRedeem -> pause -> returnCapital -> unpause -> processQueue -> claim`
    - Processing is paused, but capital can return and internal accrual can occur while paused.

## 7. Delegated-exit flows

1. `D -> approve vault shares -> spender withdraw/redeem -> W to receiver`
2. `D -> approve vault shares -> spender requestRedeem -> processQueue -> owner claim`
3. `D -> transfer shares -> new holder exits`

Approval must precede the delegated action. Queued shares are escrowed and cannot be transferred after the request.

## Combination rule

Any longer valid flow is a combination of the classes above. It is fundamentally different only when the ordering changes:

- assets per share at `D` or `W`;
- the user's share balance;
- whether an accrual interval is funded or skipped;
- idle liquidity and instant-versus-queued routing;
- FIFO position;
- or the price of a separately processed queue portion.
