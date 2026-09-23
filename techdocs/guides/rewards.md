# Manage Rewards

Earn Reward Points for using STRATO DeFi, and claim them.

!!! info "Live rates"
    Activities, emission rates and seasons are configured on-chain by governance and change over time. The Rewards page shows current values. Any APY in the app is an estimate from current rates and prices.

---

## How Rewards Work

Rewards are handled by the `Rewards` contract and organized into **activities**. Each activity tracks one kind of participation, such as holding liquidity in a given pool, minting against a CDP asset, or depositing in a vault.

- **Position activities** follow a balance that can go up or down, such as an LP position or CDP debt. Your stake rises when you add to the position and falls when you reduce it.
- **One-time activities** count discrete actions. Your stake only increases.

Each activity has an **emission rate** (points per second). Emissions are shared among participants in proportion to their stake:

```
Your rewards over a period ≈ emission rate × time × (your stake / total stake)
```

The contract calculates this with a cumulative reward-per-stake index, so your share is exact for whatever stake you held over each interval. Different activities measure stake in different units (token amounts, USD value or shares), so stakes aren't comparable across activities. An activity can also set a minimum amount.

An off-chain rewards service reads protocol events and records them in the `Rewards` contract. New activity can take a short while to show up.

### Seasons

Governance can start a new **season**. The Activities tab label shows the current one (for example "Activities (Season 3)"). Emission rates and the activity list can change between seasons. Rewards you've already accrued are kept.

---

## Rewards Page

Open **Rewards** from the sidebar (under **EARN**).

**Summary cards** (when signed in):

- **Total Claimable Rewards**: what you'd receive by clicking **Claim All**. Marked "(incl. Bonus)" when a community bonus is included.
- **My Claimed Rewards**: **Reward Points** claimed so far, plus any **Community Bonus**
- **Global Rewards Overview**: **Total Earned**, number of **Activities**, and the **Reward Token** the contract pays out (CATA)

**Tabs:**

| Tab | Shows |
|---|---|
| **Activities** | Every activity: type, emission rate, total stake, and an **Earn Now** button that opens the page where you can participate |
| **My Active Positions** | Your stake in each activity, **Estimated Rewards/Day** and last update |
| **Leaderboard** | Top earners |

Guests see the global overview and the Activities and Leaderboard tabs.

---

## Claim Rewards

1. On **Rewards**, check **Total Claimable Rewards**.
2. Click **Claim All**. You can also claim individual activities from **My Active Positions**.
3. Confirm the transaction. It costs **0.01 USDST, or one voucher**.

Claiming settles your pending rewards and transfers the reward token (CATA) to your wallet. Unclaimed rewards don't expire. They keep accumulating until you claim.

!!! note "Pre-funded contract"
    Rewards are paid from tokens held by the `Rewards` contract. If it hasn't been topped up enough, a claim fails with "Insufficient reward tokens" until it is refunded.

---

## Ways to Earn

The **Activities** tab is the authoritative list. Typical sources in the app:

- **Liquidity:** positions in reward-eligible pools ([Provide Liquidity](liquidity.md))
- **CDP minting:** the Borrow page shows **Mint Rewards APY** when minting is an activity ([Borrow USDST](borrow.md))
- **Vaults:** vault deposits on the **Earn** page, when listed as activities
- **Staking:** STRATO staking can carry a rewards APY on top of its native yield ([Consensus and staking](../platform/consensus.md))

### USDST Savings Vault

**Earn > USDST Savings Vault** is the simplest way to earn on idle USDST:

1. Click **Deposit USDST** and enter an amount. You receive **saveUSDST**, the vault's share token.
2. saveUSDST doesn't rebase. The USDST each share redeems for rises as the vault accrues its savings rate and receives reward distributions. The page shows **Current Price**, **TVL** and **Your Position**.
3. To exit, choose **Redeem saveUSDST**.

When you bridge in, you can also deposit straight into the vault with the **auto-save** option on the Fund page ([Bridge Assets](bridge.md)).

---

## Common Issues

| Problem | Cause | What to do |
|---|---|---|
| Nothing to claim | No stake in an active activity yet, or recent events not processed yet | Check **My Active Positions**; allow time for processing |
| Claim failed | Out of USDST or vouchers for the fee, or the contract is underfunded | Top up USDST or vouchers; try again later |
| Rewards lower than expected | Total stake grew, emission rate changed, or your position shrank | Compare current rates on the **Activities** tab |

---

## Next Steps

- **[Provide Liquidity](liquidity.md)**
- **[Borrow USDST](borrow.md)**
- **[Safety Guide](../safety.md)**
