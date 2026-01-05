# Deep Dive Plan: Understanding STRATO Functionality for Documentation

## Goal

Gain comprehensive, in-depth understanding of STRATO's DeFi functionality to create accurate, helpful documentation that reflects real system behavior.

---

## Phase 1: Core Smart Contracts Analysis

### 1.1 Lending Pool Deep Dive

**Files to analyze:**
```
mercata/contracts/concrete/Lending/LendingPool.sol
strato/core/strato-genesis/resources/contracts/concrete/Lending/LendingPool.sol
mercata/contracts/concrete/Lending/PoolConfigurator.sol
mercata/contracts/concrete/Lending/CollateralVault.sol
```

**What to extract:**
- [ ] Complete function flow for supply → borrow → repay → withdraw
- [ ] Exact interest calculation formulas (RAY precision, per-second compounding)
- [ ] Health factor calculation with actual code trace
- [ ] Liquidation logic: triggers, close factors, bonuses
- [ ] Edge cases: dust amounts, bad debt handling
- [ ] Asset configuration constraints (LTV <= liquidation threshold, max values)
- [ ] Reserve factor mechanics (protocol revenue)
- [ ] Debt ceiling enforcement

**Deliverable:** Flow diagrams + example calculations with real numbers

### 1.2 CDP System Deep Dive

**Files to analyze:**
```
mercata/contracts/concrete/CDP/CDPEngine.sol
strato/core/strato-genesis/resources/contracts/concrete/CDP/CDPEngine.sol
```

**What to extract:**
- [ ] Vault lifecycle: open → deposit → mint → repay → withdraw → close
- [ ] Stability fee calculation (rate accumulator mechanics)
- [ ] Collateralization ratio calculation (exact formula)
- [ ] Liquidation mechanics: penalties, close factors, dust cleanup
- [ ] Global vs per-vault debt tracking
- [ ] Rate accumulator updates (_accrue function)
- [ ] Debt floor and ceiling enforcement
- [ ] Unit scale handling (price conversions)

**Deliverable:** State transition diagrams + worked examples

### 1.3 Shared Collateral & Combined Health

**Files to analyze:**
```
mercata/contracts/concrete/Lending/CollateralVault.sol
```

**What to extract:**
- [ ] How collateral is shared between lending and CDP
- [ ] Combined health factor calculation
- [ ] Deposit/withdrawal permissions across systems
- [ ] Edge cases: what if user has both lending debt and CDP debt?
- [ ] Priority/order of operations in liquidations

**Deliverable:** Architecture diagram showing shared collateral model

### 1.4 AMM & Liquidity Pools

**Files to analyze:**
```
mercata/contracts/concrete/Pools/*.sol
strato/core/strato-genesis/resources/contracts/concrete/Pools/*.sol
```

**What to extract:**
- [ ] Constant product formula implementation
- [ ] Fee structure: trading fees, protocol fees, LP fees
- [ ] Slippage calculation and protection
- [ ] Price impact calculation
- [ ] LP token minting/burning mechanics
- [ ] Multi-hop routing (if supported)
- [ ] Impermanent loss scenarios (quantified)

**Deliverable:** AMM mechanics explainer with calculations

### 1.5 Rewards System

**Files to analyze:**
```
mercata/contracts/concrete/Rewards/*.sol
design-documents/rewards-chef.md
design-documents/rewards.md
```

**What to extract:**
- [ ] CATA distribution algorithm
- [ ] Earning rates per activity (supply, borrow, LP, CDP, swaps)
- [ ] Season mechanics and rate changes
- [ ] Claiming process and gas optimization
- [ ] Boosted pools and multipliers
- [ ] Total supply and emission schedule

**Deliverable:** Rewards calculation guide with examples

### 1.6 Bridge System

**Files to analyze:**
```
mercata/contracts/concrete/Bridge/*.sol
```

**What to extract:**
- [ ] Lock/mint mechanism
- [ ] Validator setup and thresholds
- [ ] Time locks and security delays
- [ ] Fee structure
- [ ] Supported chains and assets
- [ ] Failure recovery mechanisms

**Deliverable:** Bridge flow diagram with security model

---

## Phase 2: Backend Business Logic Analysis

### 2.1 Lending Backend Service

**Files to analyze:**
```
mercata/backend/src/api/services/lending.service.ts
mercata/backend/src/api/helpers/lending.helper.ts
```

**What to extract:**
- [ ] How backend simulates health factor
- [ ] getUserLoan logic (index-based calculations)
- [ ] Liquidation listing algorithm
- [ ] Max borrow calculations
- [ ] Asset configuration queries
- [ ] Error handling and edge cases

**Deliverable:** Backend calculation verification against contracts

### 2.2 CDP Backend Service

**Files to analyze:**
```
mercata/backend/src/api/services/cdp.service.ts
```

**What to extract:**
- [ ] How CR is calculated server-side
- [ ] Health factor conversion (CR to lending HF equivalent)
- [ ] Vault aggregation logic
- [ ] Max mint calculations
- [ ] Liquidation detection

**Deliverable:** CDP calculation guide matching contracts

### 2.3 Pools & Swap Backend

**Files to analyze:**
```
mercata/backend/src/api/services/pools.service.ts
mercata/backend/src/api/services/swap.service.ts
```

**What to extract:**
- [ ] Swap quote calculations
- [ ] Routing algorithm (multi-hop)
- [ ] Slippage application
- [ ] Pool statistics aggregation
- [ ] Liquidity calculations

**Deliverable:** Swap mechanics explainer

### 2.4 Rewards Backend

**Files to analyze:**
```
mercata/backend/src/api/services/rewards.service.ts
```

**What to extract:**
- [ ] Pending rewards calculation
- [ ] Historical rewards tracking
- [ ] APR calculation methodology
- [ ] Season management

**Deliverable:** Rewards tracking guide

---

## Phase 3: Configuration & Parameters

### 3.1 Asset Configurations

**Files to analyze:**
```
mercata/services/oracle/src/config/assets.json
mercata/contracts/tests/*/test.sol (for test values)
```

**What to extract:**
- [ ] Default LTV per asset type
- [ ] Default liquidation thresholds
- [ ] Default liquidation bonuses
- [ ] Typical stability fees
- [ ] Debt ceilings and floors

**Deliverable:** Asset parameter reference table

### 3.2 Oracle & Pricing

**Files to analyze:**
```
mercata/contracts/concrete/Oracle/*.sol
strato/core/strato-genesis/resources/contracts/concrete/Oracle/*.sol
```

**What to extract:**
- [ ] Price feed sources
- [ ] Update mechanisms
- [ ] Staleness checks
- [ ] Fallback logic
- [ ] Price manipulation protections

**Deliverable:** Oracle mechanics explainer

### 3.3 Fee Structures

**Search across codebase:**
```
grep -r "fee" mercata/contracts/
grep -r "FEE" mercata/backend/
```

**What to extract:**
- [ ] Gas fees (who pays, in what token)
- [ ] Protocol fees (swap, borrow, bridge)
- [ ] Liquidation bonuses
- [ ] Bridge fees
- [ ] Where fees go (protocol treasury, LPs, etc.)

**Deliverable:** Complete fee reference guide

---

## Phase 4: UI/UX Flows

### 4.1 Frontend Components

**Files to analyze:**
```
mercata/ui/src/components/borrow/
mercata/ui/src/components/cdp/
mercata/ui/src/components/swap/
mercata/ui/src/services/
mercata/ui/src/utils/
```

**What to extract:**
- [ ] Actual user flows in UI
- [ ] Validation logic
- [ ] Error messages users see
- [ ] Transaction building
- [ ] Helper functions for calculations

**Deliverable:** UI flow documentation matching actual app

### 4.2 Transaction Sequences

**What to trace:**
- [ ] Supply collateral flow (approve → deposit)
- [ ] Borrow flow (health check → borrow)
- [ ] CDP mint flow (approve → deposit → mint)
- [ ] Swap flow (approve → swap)
- [ ] Add liquidity flow (approve × 2 → add)
- [ ] Claim rewards flow

**Deliverable:** Transaction sequence diagrams

---

## Phase 5: Testing & Validation

### 5.1 Test Analysis

**Files to analyze:**
```
mercata/contracts/tests/**/*.test.sol
```

**What to extract:**
- [ ] Edge cases tested
- [ ] Expected behaviors in tests
- [ ] Example scenarios with numbers
- [ ] Failure cases and error messages
- [ ] Security considerations

**Deliverable:** Test-derived documentation examples

### 5.2 Calculate Real Examples

**Create scenarios:**
- [ ] Borrowing example with real asset prices
- [ ] CDP minting example with real values
- [ ] Liquidation scenario with exact calculations
- [ ] Impermanent loss calculation with pool data
- [ ] Rewards earning over time period

**Deliverable:** Worked examples section in docs

---

## Phase 6: Integration Points

### 6.1 API Endpoints

**Files to analyze:**
```
mercata/backend/src/api/routes/
docs/mercata/*.md (existing API docs)
```

**What to extract:**
- [ ] All endpoints with parameters
- [ ] Request/response formats
- [ ] Error codes and meanings
- [ ] Rate limits
- [ ] Authentication flow

**Deliverable:** Complete API reference

### 6.2 Events & Indexing

**Files to analyze:**
```
mercata/contracts/**/*.sol (events)
strato/indexer/ (Slipstream)
```

**What to extract:**
- [ ] Events emitted by contracts
- [ ] What gets indexed
- [ ] How to query historical data
- [ ] Real-time vs indexed data

**Deliverable:** Events reference guide

---

## Phase 7: Common Patterns & Best Practices

### 7.1 Optimal Strategies

**From code analysis, document:**
- [ ] Optimal health factor ranges (from liquidation logic)
- [ ] Gas-efficient transaction patterns
- [ ] Best times to claim rewards (gas vs value)
- [ ] Pool selection criteria
- [ ] Collateral diversification strategies

**Deliverable:** Best practices guide backed by code

### 7.2 Error Scenarios

**From contract require statements:**
- [ ] All error messages
- [ ] What triggers each error
- [ ] How to fix each error
- [ ] Prevention strategies

**Deliverable:** Troubleshooting guide with actual errors

---

## Execution Plan

### Week 1: Lending & CDP Foundation
- Days 1-3: Lending contracts deep dive
- Days 4-5: CDP contracts deep dive
- Days 6-7: Shared collateral analysis + documentation

### Week 2: AMM, Rewards & Bridge
- Days 1-2: AMM/Pools analysis
- Days 3-4: Rewards system analysis
- Days 5-6: Bridge analysis
- Day 7: Integration documentation

### Week 3: Backend & Configuration
- Days 1-3: Backend services analysis
- Days 4-5: Configuration extraction
- Days 6-7: API documentation

### Week 4: UI, Testing & Examples
- Days 1-2: UI flows analysis
- Days 3-4: Test analysis
- Days 5-6: Create worked examples
- Day 7: Final documentation review

### Week 5: Polish & Validation
- Days 1-3: Documentation refinement
- Days 4-5: Technical review with team
- Days 6-7: Final edits and publication

---

## Documentation Artifacts to Create

### Core Concepts (Enhanced)
- [ ] Health Factor Deep Dive (with contract code references)
- [ ] Collateralization Ratio Explained (CDP mechanics)
- [ ] Shared Collateral Architecture
- [ ] Interest Rate Models
- [ ] Liquidation Mechanics In-Depth

### Technical Guides
- [ ] Contract Architecture Overview
- [ ] State Management & Indexing
- [ ] Oracle Integration Guide
- [ ] Fee Distribution Model
- [ ] Security Considerations

### User Guides (Enhanced with Real Data)
- [ ] Borrow Guide (with actual calculation examples)
- [ ] CDP Guide (with real CR calculations)
- [ ] Liquidity Guide (with real IL calculations)
- [ ] Rewards Guide (with actual APR calculations)

### Developer References
- [ ] Complete API Reference (all endpoints)
- [ ] Smart Contract Reference (all functions)
- [ ] Event Reference (all events)
- [ ] Error Reference (all error codes)
- [ ] Integration Patterns

### Examples & Tutorials
- [ ] 10 Real-World Scenarios (with calculations)
- [ ] Liquidation Case Studies
- [ ] Optimal Strategy Examples
- [ ] Multi-Collateral Management

---

## Tools & Methodology

### Analysis Tools
```bash
# Find all functions
grep -r "function " mercata/contracts/

# Find all events
grep -r "event " mercata/contracts/

# Find fee-related code
grep -ri "fee\|Fee\|FEE" mercata/contracts/ mercata/backend/

# Find liquidation logic
grep -ri "liquidat" mercata/contracts/

# Map service dependencies
grep -r "import.*service" mercata/backend/src/
```

### Documentation Process
1. **Read contract/code**
2. **Trace execution flow**
3. **Extract key formulas**
4. **Create examples**
5. **Validate against tests**
6. **Document edge cases**
7. **Write user-friendly explanation**
8. **Add diagrams/visuals**
9. **Cross-reference with UI**
10. **Technical review**

### Validation Checklist
For each documented feature:
- [ ] Traced through contract code
- [ ] Validated against tests
- [ ] Confirmed with backend logic
- [ ] Checked UI implementation
- [ ] Created worked example
- [ ] Documented edge cases
- [ ] Listed error scenarios
- [ ] Added troubleshooting tips

---

## Success Criteria

Documentation is complete when:
- ✅ Every user flow has exact transaction sequences
- ✅ All calculations have formulas + worked examples
- ✅ Every error has explanation + fix
- ✅ All parameters documented with actual values
- ✅ Security considerations clearly explained
- ✅ Best practices backed by code analysis
- ✅ Developer integration guide is comprehensive
- ✅ Technical review passes with no major gaps

---

## Notes

- **Prioritize user-facing docs first** (borrow, CDP, swap, liquidity)
- **Validate all numbers** - no "typical" or "around", use actual values
- **Test all examples** - run calculations through actual formulas
- **Keep technical accuracy** while maintaining user-friendly language
- **Update as we learn** - iterative improvement is okay
- **Ask for clarification** when code is ambiguous

---

## Questions to Answer During Deep Dive

### Lending
1. Exactly how is per-second interest calculated?
2. What happens to reserves? Where do they go?
3. How is bad debt handled?
4. What are the actual LTV values per asset?

### CDP
1. How often is rate accumulator updated?
2. What's the exact penalty calculation in liquidation?
3. How does dust cleanup work?
4. What are actual stability fees?

### Rewards
1. How is CATA distributed per block/second?
2. What's the total emission schedule?
3. How do boost multipliers work?
4. When do seasons change?

### Technical
1. How does Slipstream indexing work?
2. What's the oracle update frequency?
3. How are cross-chain messages validated?
4. What's the node consensus mechanism?

---

**Ready to start?** Suggest we begin with Phase 1.1 (Lending Pool) as it's the most user-facing feature.

