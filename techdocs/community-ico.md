# The STRATO Community ICO Round: Mechanics

The STRATO Community ICO Round is a public Continuous Clearing Auction (CCA) running on Uniswap's Liquidity Launchpad. This page explains how the auction works, what you are bidding on, and how to participate.

---

## Overview

| Property | Value |
|---|---|
| **Sale name** | STRATO Community ICO Round |
| **Mechanism** | Continuous Clearing Auction (CCA) |
| **Platform** | Uniswap Liquidity Launchpad |
| **Supply on sale** | 2.5% of total $STRATO supply |
| **Pre-bid opens** | June 3, 2026, 12:00 UTC |
| **Public bidding opens** | June 4, 2026, 12:00 UTC |
| **Auction closes** | June 10, 2026, 12:00 UTC |
| **Clearing periods** | 7, one every two days |
| **Bid currency** | USDC |
| **Token delivered** | wSTRATO (ERC-20 on Ethereum) |
| **Conversion to native $STRATO** | 1:1 at TGE, expected Q4 2026 |

---

## How a CCA differs from other auction formats

A sealed-bid auction collects bids and clears once at the end. A traditional Dutch auction descends in price until a bidder accepts. A Continuous Clearing Auction sits between the two: bids accumulate continuously, and the auction clears multiple times across its duration. Each clearing period fills its share of supply at a single price determined by demand during that window.

The design has three properties worth understanding before you bid.

**Bidders set the price collectively.** No party announces a price in advance. The clearing price for each period is whatever the marginal accepted bid pays.

**Late bidders have no informational advantage.** Because the protocol spreads each bid across all remaining clearing periods automatically, a bidder who commits on the final day participates in only the final clearing. A bidder who commits on day one participates in every clearing. There is no benefit to waiting and no penalty for committing early.

**Uniform pricing within each clearing period.** Every successful bidder in a given period pays that period's clearing price, regardless of the maximum price they submitted. Bidding above the expected clearing price increases your chance of filling without increasing what you pay.

---

## The four phases

### Phase 1: Pre-register and prepare

**When:** now through June 3, 2026

Visit [strato.nexus/auction](https://strato.nexus/auction), complete KYC, and connect a wallet. Bids settle in USDC, so the wallet you connect needs to hold enough USDC to cover your intended bids. Pre-registering early lets you avoid the queue when bidding opens, and it adds you to the notification list for each clearing.

US persons and residents of excluded jurisdictions cannot participate. The full exclusion list is on the auction page.

The first 24 hours of the auction, beginning June 3, 2026 at 12:00 UTC, are a **pre-bid period** open only to participants who have completed pre-registration by that time. The pre-bid window gives early community members access to the auction before public bidding opens to the wider market.

### Phase 2: Place your bids

**When:** June 3 (pre-bid) through June 10, 2026 (public)

Each bid has two parts:

- **Budget** — how much USDC you will spend in total across the auction
- **Maximum price** — the most you will pay per wSTRATO token

The protocol divides your budget evenly across the remaining clearing periods. In each clearing period, bids are filled from highest maximum price to lowest until the period's supply is exhausted. The price of the lowest filled bid becomes the clearing price for that period. Every bid above the clearing price pays the clearing price, not their maximum. Any portion of your budget that does not clear in a given period rolls forward to the next one.

You can add bids at any time. You cannot reduce or withdraw a bid once it is submitted, so size carefully.

The first clearing period is sized smaller than the others, around 10% of total auction supply, so early price discovery happens with less weight on the line. Clearing periods 2 through 7 are sized equally.

### Phase 3: Watch the clearings

**When:** every two days through June 10, 2026

After each clearing, the auction dashboard publishes the clearing price, fill amounts, and remaining supply. You can see how much of your budget filled, at what price, and how much remains for future periods. If demand is heavy, clearing prices rise across the auction. If demand softens, prices drift down. The rule is constant: every successful bid in a given period pays that period's clearing price.

### Phase 4: Claim your tokens

**When:** at TGE, expected Q4 2026

The CCA sells wSTRATO, an ERC-20 representation of $STRATO that lives on Ethereum. wSTRATO is redeemable 1:1 for native $STRATO at the Token Generation Event in Q4 2026. The bridge to native $STRATO is automatic for anyone holding wSTRATO at the TGE snapshot.

Holding wSTRATO during the interim gives you a transferable ERC-20 position that any standard wallet or custody solution can hold.

The gap between auction close and TGE gives the team time to finalize CEX listings, complete the final round of audits, and seed launch liquidity.

---

## A concrete example

To illustrate the mechanic, imagine a single clearing period selling 1,000 wSTRATO. Real auctions clear across seven periods, but one is enough to show the logic. Three bidders participate:

| Bidder | Budget | Maximum price |
|---|---|---|
| Alice | $2,000 | $5 per token |
| Bob | $2,400 | $4 per token |
| Charlie | $900 | $3 per token |

When the period clears, the protocol sorts bids from the highest maximum price to the lowest and fills until supply runs out.

1. **Alice is highest.** At her $5 maximum, her $2,000 budget would buy 400 tokens. She gets all 400. Supply remaining: 600.
2. **Bob is next.** At his $4 maximum, his $2,400 budget would buy 600 tokens. He gets all 600. Supply remaining: 0.
3. **Charlie's $3 maximum is below the cutoff.** He fills nothing, and his $900 rolls forward to the next period.

Bob's $4 bid was the last to clear, so **$4 becomes the period's clearing price**. The protocol then settles each bidder:

- **Alice** bid $5 per token, but the clearing price is $4. She receives 400 wSTRATO and a $400 refund (the difference between her bid maximum and the clearing price, on the tokens she filled).
- **Bob** paid exactly the clearing price. He receives 600 wSTRATO and no refund.
- **Charlie** did not fill. His $900 returns to him, or rolls into the next clearing period if the auction is still running.

The key takeaway: bidding above the expected clearing price does not cost you more. It increases your probability of filling. If you believe wSTRATO will trade at $8 at TGE and you bid $6 when the actual clearing price is $4, you pay $4 and fill your full size at that price.

---

## What happens after the CCA

The Community ICO Round is the price-setting event for the broader sale program. Once the CCA closes, fixed-price tranches open at or above the clearing price, partner launchpads (Coinlist, Sonar, Kucoin, Gate) price off the CCA clearing, and the remaining strategic allocations close at the same anchor. Around 12.5% of total $STRATO supply moves through this program in total, of which 2.5% is the CCA itself.

CCA participants are buying at the floor of the program. Every subsequent stage prices higher.

---

## Quick reference

- **Where to bid:** [strato.nexus/auction](https://strato.nexus/auction)
- **Bid currency:** USDC
- **Token received during sale:** wSTRATO (ERC-20 on Ethereum)
- **Token received at TGE:** native $STRATO, 1:1 with wSTRATO holdings
- **TGE expected:** Q4 2026
- **Vesting:** none after TGE; full position is liquid on conversion
- **Excluded jurisdictions:** see the auction page for the full list

For questions, reach the team in Telegram or Discord.
