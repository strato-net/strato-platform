# Documentation Framework: Balancing End-Users & Developers

## The Two-Layer Approach

Every feature will have **TWO documentation versions** from the same deep dive:

```
Deep Technical Analysis (Internal)
    ↓
    ├─→ END-USER DOCS (What & How)
    │   - Simple language
    │   - Step-by-step guides
    │   - Visual aids
    │   - Real examples
    │   - Common issues
    │
    └─→ DEVELOPER DOCS (Why & Technical Details)
        - Contract functions
        - API endpoints
        - Formulas & calculations
        - Edge cases
        - Integration patterns
```

---

## Layer 1: End-User Documentation

### Principles

**DO:**
- ✅ Use simple, non-technical language
- ✅ Focus on "what can I do" and "how do I do it"
- ✅ Show UI screenshots and step-by-step flows
- ✅ Provide concrete examples with real numbers
- ✅ Explain risks and best practices
- ✅ Include troubleshooting for common errors

**DON'T:**
- ❌ Mention contract names or functions
- ❌ Show code or technical formulas
- ❌ Discuss implementation details
- ❌ Use jargon without explanation
- ❌ Overwhelm with edge cases

### Example: Supply Collateral (End-User Version)

**Location:** `/techdocs/guides/borrow.md`

```markdown
## Step 1: Supply Collateral

**What is collateral?**
Assets you deposit to back your borrowing. Your collateral stays safe as long as its value stays above your debt.

**How to supply:**

1. **Go to Lending page** in STRATO app
2. **Click "Supply Collateral"**
3. **Select asset** (e.g., ETH, WBTC, USDC)
4. **Enter amount** to supply

5. **First time?** Approve the token:
   - Click "Approve [Token]"
   - Confirm in wallet (< $0.10 gas)
   - Wait 1-2 seconds
   - This is one-time per token

6. **Supply your collateral:**
   - Click "Supply"
   - Confirm in wallet (< $0.10 gas)
   - Wait 1-2 seconds

✅ **Done!** Your collateral is now ready for borrowing.

**Example:**
- Supply: 1 ETH worth $3,000
- Can borrow: Up to $2,250 USDST (75% of value)
- Your position: Very safe with lots of room

**Tips:**
- Start with more collateral than you need
- Don't max out your borrowing capacity
- Monitor your health factor regularly

**Common Issues:**
- "Insufficient allowance" → You need to approve first
- "Asset not configured" → This token isn't accepted as collateral
- "Transfer failed" → Check your balance and gas
```

---

## Layer 2: Developer Documentation

### Principles

**DO:**
- ✅ Include contract names, functions, and parameters
- ✅ Show exact formulas and calculations
- ✅ Document all edge cases and error conditions
- ✅ Provide code examples
- ✅ Explain integration patterns
- ✅ Link to contract source code

**DON'T:**
- ❌ Assume readers understand business context
- ❌ Skip explaining "why" something works this way
- ❌ Omit error codes or failure scenarios
- ❌ Use vague terms like "typically" or "usually"

### Example: Supply Collateral (Developer Version)

**Location:** `/techdocs/reference/lending.md`

```markdown
## Supply Collateral

### Contract Function

```solidity
function supplyCollateral(address asset, uint amount) external
```

**Parameters:**
- `asset`: Address of ERC20 collateral token
- `amount`: Amount in token's native decimals

**Requirements:**
- `amount > 0`
- `asset` must be active in TokenFactory
- Asset must be configured with:
  - `ltv > 0` (configured as collateral)
  - `liquidationThreshold > 0`
  - `liquidationBonus >= 10000` (100% in basis points)
- User must have approved CollateralVault: `asset.approve(collateralVault, amount)`

**Execution Flow:**
1. Validates amount and asset eligibility
2. Checks asset configuration in `assetConfigs[asset]`
3. Delegates to `CollateralVault.addCollateral(msg.sender, asset, amount)`
4. CollateralVault executes:
   ```solidity
   IERC20(asset).transferFrom(borrower, address(this), amount)
   userCollaterals[borrower][asset] += amount
   ```
5. Emits `SuppliedCollateral(msg.sender, asset, amount)`

**State Changes:**
- `CollateralVault.userCollaterals[user][asset]` increases by `amount`
- Tokens transferred from user to CollateralVault

**Collateral Calculation:**
After supply, user's max borrowing power increases:
```
MaxBorrow = Σ (collateral_i × price_i × ltv_i) / 1e18
```

**Error Messages:**
- `"Invalid amount"` - amount is 0
- `"Asset not configured as collateral"` - ltv is 0
- `"Asset missing liquidation threshold"` - liquidationThreshold is 0
- `"Asset missing liquidation bonus"` - liquidationBonus < 10000
- `"Transfer failed"` - Insufficient balance or approval

**Gas Cost:**
- First-time approval: ~45,000 gas
- Supply transaction: ~50,000 gas
- Total for new token: ~95,000 gas

**Integration Example:**

```javascript
// 1. Check if approval needed
const collateralVault = await lendingPool.registry().collateralVault();
const allowance = await token.allowance(userAddress, collateralVault);
const amount = ethers.utils.parseEther("1.0");

if (allowance.lt(amount)) {
  // 2. Approve
  const approveTx = await token.approve(collateralVault, amount);
  await approveTx.wait();
}

// 3. Supply collateral
const supplyTx = await lendingPool.supplyCollateral(tokenAddress, amount);
await supplyTx.wait();

// 4. Check new collateral balance
const vault = await ethers.getContractAt("CollateralVault", collateralVault);
const userCollateral = await vault.userCollaterals(userAddress, tokenAddress);
```

**API Endpoint:**
```
POST /lending/supply
Body: {
  "asset": "0x...",
  "amount": "1000000000000000000" // 18 decimals
}
```

**Related:**
- Contract: `LendingPool.sol` (L285-299)
- Contract: `CollateralVault.sol` (L38-43)
- See also: [Withdraw Collateral](#withdraw-collateral)
- See also: [Calculate Max Borrow](#calculate-max-borrow)
```

---

## Documentation Matrix

For each feature, create content for both audiences:

| Feature | End-User Guide | Developer Reference |
|---------|----------------|---------------------|
| **Supply Collateral** | guides/borrow.md#step-1 | reference/lending.md#supply-collateral |
| **Borrow USDST** | guides/borrow.md#step-2 | reference/lending.md#borrow |
| **Health Factor** | concepts.md#health-factor | reference/lending.md#health-factor-calculation |
| **Liquidation** | concepts.md#liquidation | reference/lending.md#liquidation-mechanics |
| **CDP Mint** | guides/mint-cdp.md#step-3 | reference/cdp.md#mint |
| **Swap** | guides/swap.md | reference/pools.md#swap |
| **Rewards** | guides/rewards.md | reference/rewards.md#distribution-algorithm |

---

## Content Extraction Rules

When doing the deep dive, extract information into both layers:

### From Smart Contracts

**Extract for End-Users:**
- What the function does (in plain English)
- When to use it
- Prerequisites (approvals, setup)
- Step-by-step UI flow
- Common mistakes to avoid
- Example with real numbers

**Extract for Developers:**
- Function signature
- Parameter types and constraints
- Require statements → Error messages
- State changes
- Events emitted
- Gas estimates
- Code examples

### From Backend Services

**Extract for End-Users:**
- What the API returns (in context)
- How it's used in the UI
- What calculations are pre-done
- Error messages users see

**Extract for Developers:**
- Endpoint URL and method
- Request/response schema
- Business logic explanation
- Error codes
- Rate limits
- Integration examples

### From Tests

**Extract for End-Users:**
- Real-world scenarios tested
- Expected outcomes with numbers
- Edge cases users might encounter
- What "should" happen

**Extract for Developers:**
- Test coverage details
- Edge cases and boundaries
- Failure scenarios
- Security considerations
- Performance benchmarks

---

## Content Organization

### End-User Documentation Structure

```
/techdocs/
├── index.md                    # Homepage with clear paths
├── quick-start.md              # Get started in 10 minutes
├── concepts.md                 # Core concepts (simplified)
├── safety.md                   # Risk management
├── faq.md                      # Common questions
│
├── guides/                     # Step-by-step HOW-TOs
│   ├── borrow.md              # "How do I borrow?"
│   ├── mint-cdp.md            # "How do I mint?"
│   ├── swap.md                # "How do I swap?"
│   ├── liquidity.md           # "How do I provide liquidity?"
│   ├── bridge.md              # "How do I bridge?"
│   └── rewards.md             # "How do I earn/claim?"
│
└── examples/                   # Real-world scenarios (NEW)
    ├── first-borrow.md        # Complete beginner example
    ├── managing-risk.md       # Avoiding liquidation
    └── maximize-yield.md      # Optimal strategies
```

### Developer Documentation Structure

```
/techdocs/
├── developers/
│   ├── getting-started.md      # Dev setup & authentication
│   ├── integration.md          # Complete integration guide
│   ├── authentication.md       # OAuth & API keys (NEW)
│   └── examples.md             # Code examples (NEW)
│
├── reference/
│   ├── api-overview.md         # REST API introduction
│   │
│   ├── contracts/              # Smart contract reference (NEW)
│   │   ├── lending-pool.md    # All LendingPool functions
│   │   ├── cdp-engine.md      # All CDPEngine functions
│   │   ├── pools.md           # AMM contract functions
│   │   └── collateral-vault.md
│   │
│   ├── api/                    # REST API reference (REORGANIZED)
│   │   ├── lending.md         # Lending endpoints
│   │   ├── cdp.md             # CDP endpoints
│   │   ├── pools.md           # Pools endpoints
│   │   ├── bridge.md          # Bridge endpoints
│   │   ├── rewards.md         # Rewards endpoints
│   │   └── tokens.md          # Token endpoints
│   │
│   └── technical/              # Deep technical docs
│       ├── architecture.md     # System architecture
│       ├── strato-node-api.md  # Low-level blockchain API
│       ├── calculations.md     # All formulas & math (NEW)
│       └── security.md         # Security model (NEW)
```

---

## Writing Guidelines

### End-User Content

**Voice & Tone:**
- Friendly, encouraging, patient
- "You" and "your" (second person)
- Active voice ("Click the button" not "The button should be clicked")
- Explain "why" before "how"

**Structure:**
1. **What** - Brief explanation of what this does
2. **Why** - When/why you'd want to do this
3. **Prerequisites** - What you need first
4. **Steps** - Numbered, clear instructions
5. **Example** - Real scenario with numbers
6. **Tips** - Best practices
7. **Troubleshooting** - Common issues

**Example Format:**
```markdown
## Borrow USDST

**What is borrowing?**
Get USD liquidity without selling your crypto assets.

**When to borrow:**
- Need cash but don't want to sell
- Short-term liquidity needs
- Leverage your position

**Prerequisites:**
- Collateral supplied (Step 1)
- USDST for gas fees (< $0.10)

**How to borrow:**
1. Step one...
2. Step two...

**Example:**
You have 1 ETH ($3,000) as collateral...

**Tips:**
- Don't borrow maximum
- Maintain health factor > 2.0

**Common issues:**
- "Insufficient collateral" → Add more collateral first
```

### Developer Content

**Voice & Tone:**
- Professional, precise, technical
- Third person or imperative
- Assume technical competence
- Link to relevant specs/standards

**Structure:**
1. **Overview** - Brief technical summary
2. **Function Signature** - Exact contract/API signature
3. **Parameters** - Type, range, validation
4. **Requirements** - Pre-conditions, validations
5. **Execution** - Step-by-step internal flow
6. **Returns** - Return values, events emitted
7. **Errors** - All error conditions
8. **Example** - Code integration example
9. **Related** - Links to related functions

**Example Format:**
```markdown
## Borrow Function

### Overview
Allows users to borrow USDST against their supplied collateral.

### Contract Function
```solidity
function borrow(uint amount) external whenNotPaused
```

### Parameters
- `amount` (uint256): Borrow amount in USDST (18 decimals)
  - Must be > 0
  - Must be <= `calculateMaxBorrowingPower(msg.sender)`

### Requirements
[Detailed list...]

### Execution Flow
[Step-by-step...]

### Example
```javascript
// Code example
```

### Related
- `calculateMaxBorrowingPower`
- `getUserDebt`
- `getHealthFactor`
```

---

## Quality Checklist

Before publishing any documentation:

### End-User Documentation ✓
- [ ] Written at 8th grade reading level (use readability checker)
- [ ] No unexplained jargon or technical terms
- [ ] Every step has clear action ("Click X", "Enter Y")
- [ ] Includes at least one worked example with real numbers
- [ ] Shows expected outcomes ("You should see...")
- [ ] Lists common errors with fixes
- [ ] Has visual aids (screenshots, diagrams) or placeholders for them
- [ ] Links to related guides (next steps, prerequisites)
- [ ] Tested by someone unfamiliar with the system

### Developer Documentation ✓
- [ ] All function signatures are accurate
- [ ] All parameters documented with types and constraints
- [ ] All error messages documented
- [ ] At least one code example provided
- [ ] Gas costs estimated (from tests or mainnet)
- [ ] Links to contract source code
- [ ] Edge cases documented
- [ ] Integration patterns explained
- [ ] Reviewed by technical team member

---

## Examples: Same Feature, Two Layers

### Health Factor

**End-User Version** (`concepts.md`):

```markdown
## Health Factor

**What is it?**
A number that shows how safe your lending position is. Think of it as a "safety score."

**The scale:**
- **Above 2.0**: Very safe ✅ (recommended)
- **1.5 to 2.0**: Safe with buffer
- **1.0 to 1.5**: Moderate risk ⚠️
- **Below 1.0**: DANGER - You'll be liquidated ❌

**What affects it:**
- ⬆️ **Increases:** Add more collateral, repay debt
- ⬇️ **Decreases:** Collateral price drops, borrow more

**Simple example:**
- You deposit: $10,000 of ETH
- You borrow: $5,000 USDST
- Your health factor: **1.6** (safe but watch the price)

**If ETH drops to $8,000:**
- New health factor: **1.28** (getting risky)
- **Action needed:** Add collateral or repay some debt

**How to check:**
- View in Lending dashboard
- App shows color: Green (safe), Yellow (caution), Red (danger)
- Set price alerts on your collateral

**Best practice:**
Keep health factor above 2.0 for peace of mind.
```

**Developer Version** (`reference/lending.md`):

```markdown
## Health Factor Calculation

### Function

```solidity
function getHealthFactor(address user) public view returns (uint)
```

**Returns:** Health factor scaled by 1e18 (1.0 = 1e18)

### Formula

```solidity
healthFactor = (totalCollateralValueForHealth * 1e18) / totalBorrowValue

where:
totalCollateralValueForHealth = Σ (collateral_i × price_i × liquidationThreshold_i) / 1e18
totalBorrowValue = (scaledDebt × borrowIndex) / RAY
```

### Implementation

```solidity
function getHealthFactor(address user) public view returns (uint) {
    uint totalCollateralValue = _getTotalCollateralValueForHealth(user);
    uint totalBorrowValue = _getTotalBorrowValue(user);

    if (totalBorrowValue == 0) return 2**256 - 1; // Infinite (no debt)
    if (totalCollateralValue == 0) return 0; // Zero (no collateral)

    return (totalCollateralValue * 1e18) / totalBorrowValue;
}
```

### Edge Cases

1. **No debt** (`totalBorrowValue == 0`):
   - Returns `2**256 - 1` (max uint, represents infinity)
   - User can withdraw all collateral

2. **No collateral** (`totalCollateralValue == 0`):
   - Returns `0`
   - If user has debt, immediate liquidation risk

3. **Dust amounts**:
   - Very small debt (<1 wei) may cause precision issues
   - System handles via minimum borrow checks

### Collateral Value Calculation

```solidity
function _getTotalCollateralValueForHealth(address user) internal view returns (uint) {
    uint totalValue = 0;
    
    for (uint i = 0; i < configuredAssets.length; i++) {
        address asset = configuredAssets[i];
        uint amount = CollateralVault(_collateralVault()).userCollaterals(user, asset);
        
        if (amount == 0) continue;
        
        (uint price, ) = PriceOracle(_priceOracle()).getAssetPriceWithTimestamp(asset);
        AssetConfig memory config = assetConfigs[asset];
        
        // (amount × price × liquidationThreshold) / 1e18 / 10000
        uint value = (amount * price * config.liquidationThreshold) / (1e18 * 10000);
        totalValue += value;
    }
    
    return totalValue;
}
```

### Liquidation Threshold

Each asset has a liquidation threshold in basis points:
- Example: 8000 = 80%
- Means: Collateral counts as 80% of its value for health

**Common values:**
- ETH: 8000 (80%)
- WBTC: 7500 (75%)
- Stablecoins: 9000 (90%)

### Worked Example

```javascript
// User state:
const collateral = [
  { asset: "ETH", amount: 2e18, price: 3000e18, liquidationThreshold: 8000 }
];
const scaledDebt = 1000e27; // 1000 USDST in scaled units
const borrowIndex = 1.1e27; // 10% interest accrued

// Step 1: Calculate collateral value for health
const ethValue = (2e18 * 3000e18 * 8000) / (1e18 * 10000);
// = 4800e18 (counts as $4,800 for health)

// Step 2: Calculate current debt
const currentDebt = (1000e27 * 1.1e27) / 1e27;
// = 1100e18 ($1,100 owed)

// Step 3: Health factor
const healthFactor = (4800e18 * 1e18) / 1100e18;
// = 4.36e18 (health factor of 4.36)

console.log("Health Factor:", healthFactor / 1e18); // 4.36
```

### Integration

```javascript
// Get user health factor
const healthFactor = await lendingPool.getHealthFactor(userAddress);
const hfNumber = Number(healthFactor) / 1e18;

// Check if liquidatable
if (hfNumber < 1.0) {
  console.log("Position is liquidatable");
}

// Check health status
const status = hfNumber >= 2.0 ? "healthy" :
               hfNumber >= 1.5 ? "moderate" :
               hfNumber >= 1.0 ? "warning" : "danger";
```

### API Endpoint

```
GET /lending/health/:userAddress

Response:
{
  "healthFactor": "4360000000000000000", // 18 decimals
  "healthFactorFloat": 4.36,
  "status": "healthy",
  "collateralValue": "4800000000000000000000",
  "borrowValue": "1100000000000000000000"
}
```

### Related Functions
- `_getTotalCollateralValueForHealth()` - Calculates numerator
- `getUserDebt()` - Calculates denominator
- `calculateMaxBorrowingPower()` - Uses similar logic with LTV
```

---

## Implementation Plan with Dual-Layer Approach

### Phase 1.1: Lending Pool (Week 1)

**Deep Dive Tasks:**
1. Analyze all LendingPool.sol functions
2. Trace execution flows
3. Extract formulas and calculations
4. Document edge cases
5. Review tests for scenarios

**Documentation Output:**

**End-User:**
- Update `guides/borrow.md` with:
  - Accurate step-by-step flows
  - Real transaction sequences
  - Actual error messages
  - Worked examples with calculations
  
**Developer:**
- Create `reference/contracts/lending-pool.md` with:
  - All function signatures
  - Complete parameter documentation
  - Execution flow diagrams
  - Integration code examples
- Update `reference/api/lending.md` with:
  - Backend endpoint mappings
  - Request/response schemas
  - Calculation explanations

**Deliverables:**
- [ ] User guide: Supply collateral section (complete, tested)
- [ ] User guide: Borrow section (complete, tested)
- [ ] User guide: Repay section (complete, tested)
- [ ] User guide: Withdraw section (complete, tested)
- [ ] Dev reference: All contract functions documented
- [ ] Dev reference: All API endpoints documented
- [ ] Examples: 3 worked scenarios with real numbers

---

## Validation Process

### End-User Docs Testing
1. **Have a non-technical person follow the guide**
2. They should be able to complete the task WITHOUT asking questions
3. If they get confused → rewrite that section
4. If they encounter an error not in troubleshooting → add it

### Developer Docs Testing
1. **Have a developer integrate following only the docs**
2. They should not need to read contract source code
3. All code examples should run without modification
4. If anything is unclear → add more detail

---

## Success Metrics

**End-User Documentation:**
- ✅ 90%+ of users complete tasks without support
- ✅ Common support questions decrease
- ✅ Positive feedback on clarity
- ✅ Low bounce rate on guide pages

**Developer Documentation:**
- ✅ Developers successfully integrate in < 1 day
- ✅ No questions about "how does X work internally"
- ✅ All code examples work as-is
- ✅ Technical review passes

---

## Next Steps

1. **Start Phase 1.1**: Lending Pool deep dive
2. **Create dual-layer docs** for supply collateral function
3. **Review with you** for balance/tone
4. **Iterate based on feedback**
5. **Continue systematically** through all features

This ensures we get deep technical understanding while keeping docs accessible to everyone.

Ready to proceed?

