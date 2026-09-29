# $STRATO Tokenomics

$STRATO is the utility token of STRATO, an app-chain in the Ethereum ecosystem for tokenizing gold, silver, and other real-world assets for DeFi. The token is designed to do three jobs: pay for gas on the network, secure the network through staking, and grant certain privileges to borrowers.

!!! info "What is live today"
    - **Transaction fees are paid in USDST today.** Every transaction pays **0.01 USDST**, or one voucher, through the Decider system contract. Paying gas in $STRATO is the planned design.
    - **Staking is implemented on-chain.** Validators self-bond and accept delegated $STRATO, and delegators earn a share of rewards. It is active on testnet. On mainnet, stake-weighted consensus and block rewards switch on at the scheduled fork height (block 1,000,000). See [Consensus & Staking](platform/consensus.md).
    - Borrower benefits, stake-weighted tokenholder governance, and the pre-TGE programs described below are planned or program-level economics. They are not protocol behavior enforced by the chain today.

---

## Token at a Glance

| Property | Value |
|---|---|
| **Ticker** | $STRATO |
| **Max supply** | 100,000,000 (fixed) |
| **Circulating at TGE** | 21.7% |
| **Community allocation** | 55.2% of total supply |
| **Network** | STRATO |

---

## Token Utilities

STRATO is a utility token for the network. It is designed to pay for gas, secure the network through staking, and give holders a say in how the protocol runs.

**Gas (planned).** In the planned design, $STRATO pays for transaction fees on the network, gas fees go to the protocol, network activity creates demand for the token, and governance sets gas parameters over time. **Today**, each transaction costs a flat 0.01 USDST, or one voucher. Part of each USDST fee can be credited to the block proposer's validator and delegators, and the rest goes to the protocol fee collector. See [Transactions & Fees](platform/transactions-and-fees.md).

**Staking and security.** Validators stake $STRATO to produce blocks and secure the network, and earn rewards for doing so. Holders who don't run a node can delegate their $STRATO to a validator and share in those rewards.

Implemented on-chain (`StratoStakingV2`, `ValidatorRegistryV2`, `FeeRouter`), active on testnet, and activating on mainnet at block 1,000,000:

- An operator registers, bonds stake, and activates. To join the validator set, its self-bond plus delegations must meet the governance-set minimum stake.
- The block proposer is selected in proportion to stake.
- Delegators can stake to any registered operator, move stake between operators, and unstake. Unstaked tokens are released after an unbonding period.
- Validators charge a commission on delegator rewards, capped by a governance-set maximum.
- Rewards come from the staking reward schedule, the proposer's share of USDST transaction fees, and a flat block reward of 0.01 $STRATO per block paid to the proposer while the fee contract is funded.
- A validator that repeatedly misses its proposals can be temporarily jailed. The staking contract does not seize tokens.

**Early staking and validation (pre-TGE program).** Anyone with 1,000 $STRATO or more is eligible for early staking, earning more $STRATO before the TGE. Validators will need a minimum of 10,000 $STRATO to run a node and earn rewards before the TGE. The on-chain minimum validator stake is a governance parameter.

**Borrowing benefits (planned).** Holding $STRATO is designed to lower the stability fees borrowers pay when minting USDST, alongside other holder benefits. The discount would track your wallet balance, with no staking required. This is not yet implemented in the CDP contracts.

**Governance (planned).** $STRATO holders are intended to govern the protocol through stake-weighted voting on parameters, treasury allocation, and ecosystem priorities. Control moves progressively toward full on-chain tokenholder governance as the network matures.

---

## Token Allocation

The community share (pre-TGE sales, airdrop, ecosystem rewards, ecosystem fund, ecosystem dev) makes up the majority of supply.

| Category | Allocation | At TGE |
|---|---|---|
| Team | 14.0% | 0% |
| Advisors | 0.5% | 0.1% |
| Investors | 30.3% | 0% |
| Pre-TGE sales | 12.5% | 12.5% |
| Airdrop | 5.0% | 5.0% |
| Ecosystem rewards | 24.0% | 0.2% |
| Ecosystem fund | 7.7% | 3.8% |
| Ecosystem dev | 6.0% | 0% |

![Token allocation breakdown](images/token-allocation.png)

---

## STRATO Revenue Flywheel

The protocol generates revenue from credit and liquidity activity, and captures part of that revenue.

The flow runs like this:

1. Users deposit USD-denominated collateral (metals, RWAs, stables, and crypto).
2. They mint USDST against that collateral, creating credit.
3. USDST gets used across the ecosystem: savings, lending, borrowing, asset acquisition, and liquidity provision.
4. That activity generates protocol revenue (for example swap fees, borrow interest, and stability fees).
5. Revenue flows to validators and to the treasury.
6. Staking, and in the planned design gas and fee discounts, create ongoing demand for $STRATO, drawing more liquidity into the system.

![STRATO revenue flywheel](images/revenue-flywheel.png)
