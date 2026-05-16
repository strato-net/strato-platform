# STRATO Litepaper

**HardFi: Making Hard Assets Productive On-Chain**

*Version 1.0*

---

## 1. The HardFi Thesis

DeFi was built to lever volatile collateral. ETH and BTC drove the first wave of on-chain credit, and the protocols that served them optimized for that one job: posting a risky asset, borrowing a stable one, and recycling the spread.

STRATO is built for a different job. We call it HardFi.

HardFi treats gold, silver, tokenized equities, and other hard assets as first-class collateral. Users post them, borrow against them, and keep their underlying position. The vault holds the metal in New York. The chain holds the credit. Nothing is sold.

This expands the addressable market for on-chain credit from a few hundred billion in crypto collateral into the multi-trillion-dollar universe of hard assets that sit dormant in vaults, brokerages, and balance sheets.

Gold was money for five thousand years. It cleared trades, settled debts, and moved between hands as a unit of account. The last century demoted it. Custody got expensive, transfers got slow, and gold became something you hold rather than something you use. Tokenization changes the mechanics, not the metal. STRATO gives holders the rails to borrow against gold, spend against it, and settle in it without selling. The asset returns to the job it always did. This is the restoration.

---

## 2. The Market Opening

Stablecoins proved the demand. Over $200B in on-chain dollars now circulate, used for borrowing, settlement, and spend. That is product-market fit for digital dollars.

The next step is the assets behind those dollars. Three pools matter:

- **Stablecoins ($200B+).** Holders who want to rotate from fiat into productive assets.
- **Tokenizable Assets ($17T+).** Equities and real estate moving on-chain that need native dollar liquidity.
- **Global Gold Market ($9T+).** Central banks are buying at record pace. STRATO makes metals liquid and borrowable without selling.

The opening is simple: once hard assets live on-chain, holders need a way to borrow, spend, and settle against them without giving up the position.

---

## 3. What STRATO Is

STRATO is an institutional-grade Layer-1 app-chain for RWA-backed credit. Three pieces define the stack.

**Chain.** An L1 built on the original Haskell Ethereum client, with EVM compatibility and a Validator-based architecture. The codebase has eleven years of development behind it and was instrumental to the first Blockchain-as-a-Service offering, announced at DEVCON1 in 2015.

**Stablecoin.** USDST is STRATO's native USD-denominated stablecoin, minted through a Collateralised Debt Position (CDP) at an industry-low ~2% stability fee. USDST is overcollateralized and redeemable into USDC/USDT.

**Hard collateral.** GOLDST and SILVST are fully backed, on-chain commodities. Each token represents physical gold or silver vaulted 1:1 in NYC and physically redeemable. Crypto assets (ETH, BTC, LSTs), yield-bearing stables, and tokenized equities are also accepted as collateral.

The result is highly liquid USDST at a fraction of traditional DeFi borrowing costs, secured by collateral that holds value when crypto markets do not.

---

## 4. The Economic Model

STRATO runs a closed-loop credit system in four steps.

**Step one: collateral in.** A user deposits crypto, metals, or tokenized RWAs into a CDP.

**Step two: USDST out.** The user mints USDST against that collateral at ~2% stability fee.

**Step three: deployment.** USDST gets used across STRATO and partner Dapps: lending markets, savings vaults, swap pools, asset acquisition, and yield strategies.

**Step four: revenue.** The protocol earns stability fees, lending spreads, liquidation bonuses, and swap and vault fees. That revenue routes back to validators and the treasury.

Growth is not capped by capital supply. It is capped by borrow demand, risk appetite, asset availability, and liquidity utilization. STRATO prioritizes usage-driven growth over passive TVL accumulation.

---

## 5. Strategies for Capital

USDST supports a layered strategy stack. Users mix sleeves based on risk tolerance.

**Mint and borrow.** Bridge core holdings (ETH, BTC, LSTs, metals) and mint USDST at ~2%. Deploy that capital into higher-yield strategies. Target net returns: 8–21%. A conservative borrow ratio preserves a wide safety buffer against volatility.

**LP in the metastable pool.** Pair saveUSDST with other yield-bearing stables. The pool targets 12–16% APR. Early-stage incentives can lift effective returns up to 62%.

**Passive growth via saveUSDST.** Wrap USDST into the savings vault for a steady 6%+ base return. This is the risk-off sleeve: reliable yield with zero liquidation exposure.

The "double dip" is the structural advantage. A user posts collateral, mints USDST, then deploys that USDST inside STRATO. The user earns yield on the deployed capital, accrues ecosystem points on both sides, and keeps full exposure to the underlying crypto or metals position.

---

## 6. Volume Drivers

Borrowers mint USDST at 2% for two reasons. Both generate revenue for the protocol.

**Leverage (the carry trade).** A user mints USDST, swaps into yield-bearing assets earning 4–5%, and loops. Sky proved this model works for crypto. STRATO runs it with more aggressive collateral types to clear a 300+ bp spread.

**Liquidity without selling.** A user borrows against gold, silver, equities, or LSTs to buy a dip, fund expenses, or rebalance, keeping the initial upside. Every transaction generates swap volume through the pools and borrow revenue for the protocol.

---

## 7. Where STRATO Is Today

| | |
|---|---|
| **Chain** | Live L1 built on the original Haskell Ethereum mainnet client |
| **Stablecoin** | USDST, overcollateralized, redeemable into USDC / USDT |
| **Native assets** | GOLDST, SILVST: fully backed, on-chain commodities |
| **Credit** | CDP mint rate ~2% |
| **Collateral** | Precious metals, crypto, tokenized equities, yield-bearing stables, LSTs |
| **Spending** | Direct fiat off-ramps and non-custodial debit/credit card integrations |
| **Scale** | ~$10M TVL with ~$50M in near-term pipeline |
| **Traction** | Borrowers are executing 7-figure Gold-to-ETH trades using USDST leverage |
| **Code** | Full monorepo open-sourced: 30,000+ commits, 11 years of development |

---

## 8. The $STRATO Token

$STRATO is the economic coordination layer of the network. It aligns borrowers, lenders, liquidity providers, asset issuers, validators, and tokenholders around the same revenue base.

### 8.1 Supply and Distribution

Fixed supply of 100M $STRATO. 21.7% circulating at TGE. 55.2% allocated to community.

| Category | Allocation | At TGE |
|---|---|---|
| Team | 14.0% | 0% |
| Advisors | 0.5% | 0.1% |
| Investors | 30.3% | 0% |
| Public sales | 12.5% | 12.5% |
| Airdrop | 5.0% | 5.0% |
| Ecosystem rewards | 24.0% | 0.2% |
| Ecosystem fund | 7.7% | 3.8% |
| Ecosystem dev | 6.0% | 0% |

No day-one team or investor float. The liquid supply at TGE comes from the public sale, airdrop, and a portion of the ecosystem fund.

### 8.2 Utilities

**Governance.** Tokenholders stake $STRATO to receive stSTRATO and vote on parameters: fees, collateral types, risk limits, treasury allocation, incentive design. stSTRATO is non-transferable, 1:1 with $STRATO staked, redeemable with a 21-day cooldown.

**Fee discounts for borrowers.** Holding $STRATO reduces USDST stability fees on a tiered, time-weighted basis (30-day rolling average):

| Average $STRATO holdings | Stability fee reduction |
|---|---|
| ≥ 1,000 | 10% |
| ≥ 2,000 | 25% |
| ≥ 4,000 | 50% |

Tokens do not need to be staked to qualify. This preserves liquidity for users and creates demand from borrowers, not speculators.

**Validator staking.** Validators stake a minimum of 4,000 $STRATO and operate a node. Non-operators can delegate and earn pro-rata rewards.

**Gas.** Users pay gas in $STRATO or USDST. USDST paid as gas is used to buy $STRATO in the market for validators. Used $STRATO is burned.

### 8.3 Value Accrual

Protocol revenue comes from five sources: stability fees, lending spreads, liquidation bonuses, swap fees, and vault fees.

Revenue routing at TGE: captured protocol revenue is split 50/50 between validators (distributed pro rata to stSTRATO) and the STRATO Treasury. The treasury funds growth initiatives and may vote to use excess balances for buyback-and-burn of $STRATO.

The economic case is simple: usage creates revenue, and revenue creates stronger reasons to hold, stake, and use the token.

### 8.4 Bootstrapping

8.0% of total supply is reserved over the first ten years post-TGE to supplement validator yields while protocol revenues scale. Bootstrapping does not increase the 100M cap.

---

## 9. Governance and Decentralization

Governance moves in two phases.

**Phase I: The Security Council.** Core contributors and partners hold final authority. Tokenholders discuss proposals in a community forum, and stSTRATO holders cast advisory snapshot votes. The council retains final say.

**Phase II: Tokenholder governance.** Control of core contracts transfers progressively to stSTRATO holders. Onchain proposals direct the protocol. An intermediate phase may hand off control of some contracts before others.

Validator decentralization follows the same pattern. The initial set is small and trusted, validation is coordinated by BlockApps and selected partners, and external validators are onboarded over time toward a broad, distributed set.

---

## 10. Why Now

Three trends are converging:

1. **Hard assets are back in favor.** Gold, silver, and commodities are working again as policy, inflation, and sovereign risk rise, and central banks are buying them at a record pace.
2. **Tokenization is moving from theory to flow.** Treasuries, private credit, equities, and commodity-linked assets are coming on-chain in specific categories first.
3. **Stablecoin demand has compounded for years and crossed $200B.** The next leg is liquidity for the assets behind those dollars.

STRATO sits at the intersection: a live L1, native hard-asset collateral, a stablecoin that mints at ~2%, and an open-source codebase with eleven years of history. The team built the original Haskell Ethereum client in 2014 and the first BaaS offering in 2015.

Idle crypto and hard-asset wealth becomes a productive financial engine. Holders retain core exposure, generate institutional-grade yield, anchor positions in vaulted physical collateral, and scale across conservative and opportunistic sleeves.

That is HardFi.

---

## 11. The Team

STRATO is built by the team behind the original Haskell Ethereum client and one of the longest-running enterprise blockchain practices in the industry.

**Kieren James-Lubin, Co-Founder and CEO.** Kieren entered crypto in 2014 as an early Ethereum contributor and developed the project's original Haskell client, which the team still uses today. He pioneered enterprise blockchain deployments at BlockApps before refocusing the company on consumer-grade rails for tokenized real-world assets and DeFi. He holds an A.B. in mathematics from Princeton and completed all-but-dissertation work in mathematical physics at UC Berkeley. He is a co-founder and board alternate of the Enterprise Ethereum Alliance.

**Jim Hormuzdiar, Co-Founder and CTO.** Jim wrote the first commit of the Ethereum Haskell client in September 2014, implementing the EVM directly from the Yellow Paper. The Haskell client was one of six mainnet-compatible clients at Ethereum's Frontier launch in July 2015. Jim has architected enterprise-grade blockchain systems since then and continues to lead engineering for the STRATO platform.

**Victor Wong, Co-Founder and CPO.** Victor co-created the first Blockchain-as-a-Service offering, announced at DEVCON1 with Microsoft in 2015, and helped establish the Enterprise Ethereum Alliance. He developed some of the first real-world assets on private Ethereum networks and now leads product across BlockApps and STRATO.

**Bob Summerwill, Head of Ecosystem.** Bob joined the Ethereum Foundation in 2016 to work on the C++ Ethereum client. He served as co-lead Architect at the launch of the Enterprise Ethereum Alliance and as Executive Director of the Ethereum Classic Cooperative for six years. He led the open-sourcing of the STRATO platform, a 30,000+ commit monorepo released in March 2026.

**Jeffry Powell, Head of Business Development.** Jeff leads institutional outreach and partnership strategy for STRATO.

**Michael Tan, Director of RWA Tokenization.** Michael leads the strategy, development, and execution of initiatives to bring real-world assets on-chain.

---

## Contact

**Jeffry Powell**, Head of BD at STRATO — jeff@strato.nexus — +1 917-714-4790

**Resources** — Docs: [docs.strato.nexus](https://docs.strato.nexus) · App: [app.strato.nexus](https://app.strato.nexus) · Code: [github.com/strato-net/strato-platform](https://github.com/strato-net/strato-platform)

---

!!! info "Disclaimer"
    This document is informational and does not constitute investment, legal, or tax advice. Yields, fees, tokenomics parameters, and protocol mechanics are described as designed and may be adjusted by governance over time. Token allocations and TGE percentages are subject to final confirmation at launch.
