# $STRATO Tokenomics

$STRATO is the native token of the STRATO network, a Layer-1 app-chain for issuing and using real-world asset-backed credit. This page covers how $STRATO works: what it does, who earns it, and how its value ties to protocol usage.

The token has five jobs: govern the protocol, secure the network through validator staking, give borrowers a fee discount, pay for gas, and capture a share of protocol revenue.

---

## Token at a Glance

| Property | Value |
|---|---|
| **Ticker** | $STRATO |
| **Max supply** | 100,000,000 (fixed) |
| **Circulating at TGE** | 21.7% |
| **Community allocation** | 55.2% of total supply |
| **Network** | STRATO L1 |
| **Staked form** | stSTRATO (non-transferable, 1:1, 21-day cooldown) |

Bootstrapping emissions add to validator yields over the first 10 years but do not raise the max supply. Total supply stays fixed at 100M.

---

## Token Allocation

The supply splits across the team, investors, and the community. The community share (public sales, airdrop, ecosystem rewards, ecosystem fund, ecosystem dev) makes up the majority.

| Category | Allocation | At TGE | Purpose |
|---|---|---|---|
| Team | 14.0% | 0% | No day-one team float |
| Advisors | 0.5% | 0.1% | Minimal immediate float |
| Investors | 30.3% | 0% | Insider supply, locked at TGE |
| Public sales | 12.5% | 12.5% | Primary liquid sale supply |
| Airdrop | 5.0% | 5.0% | Immediate community float |
| Ecosystem rewards | 24.0% | 0.2% | Long-term growth, low day-one unlock |
| Ecosystem fund | 7.7% | 3.8% | Strategic launch capital |
| Ecosystem dev | 6.0% | 0% | Held back at TGE |

---

## How $STRATO Accrues Value

The protocol generates revenue from credit and liquidity activity. The token captures part of that revenue and rewards holders who use, secure, or stake it.

The cycle:

1. A user deposits collateral (crypto, tokenized RWAs, metals) and mints USDST.
2. USDST moves through the ecosystem: lending, savings, swaps, vaults, and asset acquisition.
3. Protocol revenue accrues from stability fees, lending spreads, liquidation bonuses, and protocol fees on swaps and vaults.
4. At TGE, captured revenue splits 50/50 between validators (paid to stSTRATO holders) and the STRATO Treasury.
5. The treasury reinvests in growth or, when balances run above target, funds $STRATO buyback-and-burn.

More usage means more revenue. More revenue means stronger reasons to hold, stake, and use $STRATO.

---

## Token Utilities

### Governance

$STRATO holders govern the protocol through stake-weighted voting. To vote, you stake $STRATO and receive stSTRATO 1:1. stSTRATO is non-transferable and redeems back to $STRATO after a 21-day cooldown.

**What governance decides:**

- Protocol parameters: fees, revenue routing, collateral types, risk limits, validator requirements
- Treasury allocation
- Incentive program design
- Ecosystem development priorities

Governance moves through two phases. See [Progressive Decentralization](#progressive-decentralization) below.

### Validator Staking

Validators stake $STRATO to produce blocks, validate transactions, and secure the network. Each validator stakes at least 4,000 $STRATO and runs a node that meets the technical requirements.

**Validator rewards come from:**

- A share of protocol revenue, distributed pro-rata to stSTRATO holders
- Bootstrapping emissions during early network phases
- Governance influence through token ownership

Validation starts with a controlled set run by BlockApps and partners. External validators onboard as the network matures, ending in a broad, distributed set.

**Slashing applies for:**

- Downtime or performance failures
- Malicious behaviour
- Protocol violations

Slashed stake routes to the treasury, honest participants, or affected users. Slashing parameters start conservative and tighten under governance over time.

### Stability Fee Discounts

Borrowers who hold $STRATO pay lower stability fees when minting USDST through the CDP. Discounts apply on the 30-day time-weighted average $STRATO balance, so short-term balance manipulation does not work.

You do not need to stake to qualify. The discount tracks your wallet balance.

| 30-day Average $STRATO Holdings | Stability Fee Reduction |
|---|---|
| ≥ 1,000 $STRATO | 10% |
| ≥ 2,000 $STRATO | 25% |
| ≥ 4,000 $STRATO | 50% |

Governance may adjust thresholds and discounts in response to market conditions, token distribution, and borrowing activity.

!!! example "Example"
    You mint 10,000 USDST at a 3% stability fee = $300/year base.
    With 4,000 $STRATO held (30-day avg) = 50% discount.
    Your effective stability fee: **$150/year**.

### Gas

You pay STRATO gas in $STRATO or USDST. When USDST pays the fee, the protocol buys $STRATO from the open market for validator distribution and burns it. Network activity becomes recurring $STRATO demand.

---

## Fee Capture and Treasury

Each fee routes to a different destination. The table shows the split at TGE; governance can adjust each over time.

| Fee | Source | Split at TGE |
|---|---|---|
| Stability fees | USDST minted from CDPs | 100% to Safety Module |
| CDP liquidation bonuses | Liquidated CDP positions | 90% liquidators / 10% protocol |
| Borrow-lend spread | Borrowing vs lending rate | 100% to protocol |
| Borrow-lend liquidation bonuses | Liquidated lending positions | 90% liquidators / 10% protocol |
| Swap fees | Swap pool trading | 100% to liquidity providers |
| Third-party vault fees | External vault strategies | 100% to vault partners |
| First-party vault fees | STRATO-run vaults | 100% to protocol |

All revenue captured by the protocol splits 50/50 between validators (paid via stSTRATO) and the treasury. The validator share scales up over time as the protocol matures and reinvestment needs drop.

### Buyback-and-Burn

The treasury funds growth, operations, and ecosystem expansion. When treasury balances exceed what those uses need, governance can vote to spend the excess buying $STRATO on the open market and burning it. Buybacks reduce circulating supply and pass treasury surplus to token holders.

---

## Bootstrapping Emissions

8.0% of total $STRATO supply pays out to validators over the first 10 years post-TGE on top of their protocol-revenue share. The schedule front-loads validator yields while protocol revenue grows to a level that can sustain validators on its own.

Emissions do not change the max supply of 100M. They distribute existing supply from a fixed allocation.

Early validators get more ownership of the network. That ownership, staked as stSTRATO, earns them a larger share of future protocol revenue.

---

## Incentive Programs

A portion of the $STRATO supply funds programs that drive growth and align partners with the network. Each program runs under the protocol's incentive framework and can be adjusted by governance.

- **Airdrop.** $STRATO distributed to early users, aligned communities, and target groups.
- **TVL Program.** Rewards for users who mint USDST, supply to lending pools, capitalize the Safety Module, provide liquidity in swap pools, deposit into vaults, or complete other designated activities. The program runs across multiple campaigns.
- **Referrals.** Token rewards for users who onboard new participants.
- **Ongoing user incentives.** Periodic distributions for key behaviours.
- **Partnerships.** Token arrangements with partner protocols, aggregators, and platforms. Partnership grants often include long-dated options to encourage durable TVL growth.
- **Co-marketing.** $STRATO funds co-incentive campaigns with partner protocols whose users boost STRATO activity.

---

## Progressive Decentralization

Governance moves through two phases.

### Phase I: Security Council

A Security Council of core contributors and partners holds final authority over protocol decisions. Community members discuss proposals in a public forum and vote on snapshots. stSTRATO holders vote in proportion to their share of total stSTRATO. Snapshot votes advise the council; the council retains final say.

### Phase II: Tokenholder Governance

Governance moves on-chain. stSTRATO holders vote directly on proposals that control core contracts. Control hands off progressively to keep the transition safe, and an intermediate stage may give tokenholders authority over some contracts before the full handoff.

Validator participation follows a parallel path: a controlled set run by BlockApps and partners at launch, gradual external validator onboarding, and a broad, distributed validator set at the end state.

---

## Related Docs

- [Core Concepts](concepts.md): USDST, CDPs, collateral, liquidation
- [Mint USDST via CDP](guides/mint-cdp.md): how to mint and earn stability fee discounts
- [Manage Rewards](guides/rewards.md): incentive program participation
- [Safety & Risk](safety.md): risk parameters and protections
