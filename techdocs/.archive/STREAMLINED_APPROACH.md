# Streamlined Documentation Approach

## Philosophy

**End-User Docs:** Complete end-to-end examples, practical and scannable  
**Developer Docs:** Quick reference + link to full API docs (don't duplicate)

---

## END-USER DOCUMENTATION

### Structure: Focused on Real Scenarios

```
guides/borrow.md
├── Complete Example First (the journey)
├── Step-by-step breakdown
└── Troubleshooting only
```

### Example: Borrow USDST Guide

```markdown
# Borrow USDST

Access USD liquidity without selling your crypto.

---

## Complete Example: Borrow $1,000 USDST

**Scenario:** You have 1 ETH and need $1,000 USDST

**What you'll do:**
1. Supply 1 ETH as collateral
2. Borrow 1,000 USDST
3. Use USDST (swap, pay fees, etc.)
4. Repay when ready
5. Withdraw your ETH

**Time needed:** 5 minutes  
**Gas cost:** ~$0.30 total (3 transactions)

---

### Step 1: Supply Collateral

**Your assets:** 1 ETH ($3,000)

**In the app:**
1. Go to **Lending** → **Supply**
2. Select **ETH**, enter **1.0**
3. **First time?** Click "Approve ETH" → Confirm (~$0.10 gas)
4. Click "Supply" → Confirm (~$0.10 gas)

**Result:**
```
✓ Collateral: 1 ETH ($3,000)
✓ Can borrow: Up to $2,250 (75% of value)
```

---

### Step 2: Borrow USDST

**In the app:**
1. Go to **Lending** → **Borrow**
2. Enter **1000** USDST
3. Review: Health Factor will be **1.8** (safe ✓)
4. Click "Borrow" → Confirm (~$0.10 gas)

**Result:**
```
✓ Borrowed: 1,000 USDST
✓ Health Factor: 1.8
✓ Wallet: +1,000 USDST
```

**Your position:**
- Collateral: 1 ETH ($3,000)
- Debt: 1,000 USDST
- Health Factor: 1.8 (safe - has buffer)
- Still can borrow: $1,250 more (but don't!)

---

### Step 3: Use Your USDST

You now have 1,000 USDST to:
- Pay for transaction fees on STRATO
- Swap for other tokens
- Provide liquidity
- Bridge to other chains

**Your debt grows slowly:**
- Interest: ~5% annual (0.014% daily)
- After 30 days: Owe ~$1,004 USDST
- After 1 year: Owe ~$1,050 USDST

---

### Step 4: Repay (Anytime)

**When you're ready:**
1. Go to **Lending** → **Repay**
2. Enter amount (or click "Repay All")
3. Confirm (~$0.10 gas)

**Example - Repay All after 30 days:**
```
You repay: 1,004 USDST
Gas: ~$0.10
Health Factor: Returns to N/A (no debt)
```

---

### Step 5: Withdraw Collateral

**After repaying:**
1. Go to **Lending** → **Withdraw**
2. Select **ETH**, enter **1.0** (or "Max")
3. Confirm (~$0.10 gas)

**Result:**
```
✓ Received: 1 ETH back to your wallet
✓ Total cost: ~$4 interest + $0.40 gas
```

---

## What If ETH Price Drops?

**Scenario:** ETH drops from $3,000 to $2,500

**What happens:**
- Your collateral: Now worth $2,500
- Your debt: Still 1,000 USDST
- Your health factor: Drops to **1.5** (caution ⚠️)

**What to do:**
- **Option 1:** Add more collateral
- **Option 2:** Repay some debt
- **Option 3:** Monitor closely (still safe at 1.5)

**Danger zone:**
- If ETH drops to **$2,000**, health factor = **1.0** (liquidation risk ❌)
- **Always keep health factor above 1.5** for safety

---

## Tips

**DO:**
- ✅ Start with small amounts to test
- ✅ Keep health factor above 2.0
- ✅ Set price alerts on your collateral
- ✅ Repay before interest grows too much

**DON'T:**
- ❌ Max out your borrowing capacity
- ❌ Ignore health factor warnings
- ❌ Use all your crypto as collateral
- ❌ Forget about accruing interest

---

## Common Issues

**"Insufficient collateral"**
→ Supply more collateral first

**"Would exceed health factor limit"**  
→ You're trying to borrow too much. Reduce amount or add collateral.

**"Insufficient USDST balance"**  
→ Get more USDST to repay (swap or borrow less initially)

---

## Related

- **[Mint via CDP](mint-cdp.md)** - Alternative with lower fees
- **[Health Factor Guide](../concepts.md#health-factor)** - Understand safety
- **[Liquidation Risk](../safety.md)** - Avoid losing collateral

```

---

## DEVELOPER DOCUMENTATION

### Structure: Quick Reference + Links

```
reference/lending.md
├── Quick overview
├── Key functions (brief)
└── Link to full API docs
```

### Example: Lending Reference

```markdown
# Lending API Reference

Quick reference for integrating STRATO lending. For complete API documentation, see [API Docs](https://app.strato.nexus/api/docs).

---

## Overview

**Lending Pool** enables borrowing USDST against crypto collateral.

**Key Concepts:**
- **Collateral:** Crypto assets locked to back borrowing
- **Health Factor:** Safety metric (must stay > 1.0)
- **LTV:** Max borrow % (typically 75%)

**Contract:** `LendingPool.sol`  
**API Base:** `/lending`

---

## Quick Integration

### 1. Supply Collateral

**Contract:**
```solidity
function supplyCollateral(address asset, uint amount) external
```

**API:**
```bash
POST /lending/supply
{
  "asset": "0x...",
  "amount": "1000000000000000000"
}
```

**Prerequisites:** Approve CollateralVault to spend tokens

**[Full API Reference →](https://app.strato.nexus/api/docs#/lending/post_lending_supply)**

---

### 2. Borrow USDST

**Contract:**
```solidity
function borrow(uint amount) external
```

**API:**
```bash
POST /lending/borrow
{
  "amount": "1000000000000000000"
}
```

**Validation:** Must maintain health factor > 1.0

**[Full API Reference →](https://app.strato.nexus/api/docs#/lending/post_lending_borrow)**

---

### 3. Check Health Factor

**Contract:**
```solidity
function getHealthFactor(address user) public view returns (uint)
```

**API:**
```bash
GET /lending/health/:address
```

**Returns:** Health factor scaled by 1e18 (1.0 = 1e18)

**Formula:**
```
HF = (Collateral × Liquidation Threshold) / Debt
```

**[Full API Reference →](https://app.strato.nexus/api/docs#/lending/get_lending_health__address_)**

---

## Integration Example

```javascript
import { ethers } from "ethers";

// Complete borrow flow
async function borrowUSDST(amount) {
  // 1. Supply collateral (with approval)
  await approveToken(ethAddress, collateralVault, collateralAmount);
  await lendingPool.supplyCollateral(ethAddress, collateralAmount);
  
  // 2. Check max borrow
  const maxBorrow = await lendingPool.calculateMaxBorrowingPower(userAddress);
  if (amount > maxBorrow) throw new Error("Amount exceeds limit");
  
  // 3. Borrow
  await lendingPool.borrow(amount);
  
  // 4. Monitor health
  const hf = await lendingPool.getHealthFactor(userAddress);
  console.log("Health Factor:", Number(hf) / 1e18);
}
```

**[See complete examples in API docs →](https://app.strato.nexus/api/docs)**

---

## Key Parameters

| Asset | LTV | Liquidation Threshold | Liquidation Bonus |
|-------|-----|----------------------|-------------------|
| ETH | 75% | 80% | 105% |
| WBTC | 70% | 75% | 105% |
| USDC | 90% | 90% | 102% |

**Note:** Check current values via `getAssetConfig(asset)` or API

---

## Error Handling

Common errors and solutions:

| Error | Meaning | Fix |
|-------|---------|-----|
| `"Insufficient collateral"` | Not enough collateral supplied | Supply more first |
| `"Insufficient allowance"` | Token not approved | Call approve() |
| `"Position healthy"` | Can't liquidate (HF > 1.0) | Only liquidate if HF < 1.0 |
| `"Withdrawal would exceed loan"` | Would make HF < 1.0 | Repay debt first |

---

## Gas Costs

Typical gas usage on STRATO:

| Operation | Gas | Cost (USDST) |
|-----------|-----|--------------|
| Approve | ~45k | ~$0.10 |
| Supply | ~50k | ~$0.10 |
| Borrow | ~60k | ~$0.10 |
| Repay | ~55k | ~$0.10 |
| Withdraw | ~50k | ~$0.10 |

---

## Resources

**Full Documentation:**
- 📘 [Complete API Docs](https://app.strato.nexus/api/docs)
- 🔗 [Contract Source](https://github.com/blockapps/strato-platform)
- 📊 [Smart Contract Reference](../contracts/lending-pool.md)

**Support:**
- [FAQ](../faq.md#borrowing--lending)
- [Support](https://support.blockapps.net)
- [Telegram](https://t.me/strato_net)

```

---

## Comparison: Before vs After

### Before (Too Extensive)

**End-User:** 1,200 words with every detail  
**Developer:** 2,500 words duplicating API docs

### After (Streamlined)

**End-User:** ~800 words, focused on complete example  
**Developer:** ~400 words, quick reference with links

---

## Content Extraction Rules (Updated)

### From Smart Contracts

**Extract for End-Users:**
- ✅ Complete user journey (what they see/do)
- ✅ Real examples with specific numbers
- ✅ What happens at each step
- ✅ Common errors users see
- ❌ No contract function names
- ❌ No technical implementation

**Extract for Developers:**
- ✅ Function signatures only
- ✅ Key parameters/validations
- ✅ One integration example
- ✅ Link to full API docs
- ❌ Don't duplicate everything
- ❌ Keep it scannable

---

## File Structure (Updated)

```
/techdocs/
├── guides/                    # END-USER: Complete examples
│   ├── borrow.md             # Full journey: supply → borrow → repay
│   ├── mint-cdp.md           # Full journey: deposit → mint → burn
│   ├── swap.md               # Full journey: approve → swap
│   ├── liquidity.md          # Full journey: add → earn → remove
│   ├── bridge.md             # Full journey: initiate → wait → claim
│   └── rewards.md            # Full journey: earn → track → claim
│
├── reference/                 # DEVELOPER: Quick reference
│   ├── lending.md            # Key functions + link to API docs
│   ├── cdp.md                # Key functions + link to API docs
│   ├── pools.md              # Key functions + link to API docs
│   ├── bridge.md             # Key functions + link to API docs
│   └── rewards.md            # Key functions + link to API docs
│
├── concepts.md                # Core concepts (simplified)
├── safety.md                  # Risk management
├── faq.md                     # Common questions
└── quick-start.md             # Get started fast
```

---

## Documentation Principles

### End-User Guides

**1. Start with complete example**
- Show the full journey first
- Then break down each step
- Include actual numbers and results

**2. Keep it scannable**
- Use lots of headings
- Short paragraphs (3-4 lines max)
- Bullet points and tables
- Clear "before/after" states

**3. Show, don't just tell**
- "Click X → Confirm → Result"
- Not just "Supply collateral"
- Include what they see in the UI

**4. Practical troubleshooting**
- Only common issues (from support tickets)
- Quick fixes, not theory
- Links to detailed docs if needed

### Developer Reference

**1. Quick overview only**
- Function signature
- Key validations
- One example
- Link to full API docs

**2. Don't duplicate API docs**
- They exist at `/api/docs`
- Reference them, don't recreate
- Focus on integration patterns

**3. Scannable format**
- Tables for parameters
- Code snippets (not full implementations)
- Links to source

**4. Key information only**
- Gas costs
- Common errors
- Prerequisites
- Related functions

---

## Template: End-User Guide

```markdown
# [Feature Name]

[One sentence what this does and why]

---

## Complete Example: [Scenario]

**Scenario:** [Real user situation]

**What you'll do:**
1. Step one
2. Step two
3. Step three

**Time needed:** X minutes  
**Gas cost:** ~$X total

---

### Step 1: [Action]

**In the app:**
1. Click X
2. Enter Y
3. Confirm

**Result:**
```
✓ What changed
✓ New state
```

---

### Step 2: [Next Action]

[Repeat pattern]

---

## What If [Common Scenario]?

**Scenario:** [What goes wrong]

**What happens:**
- [Consequence]

**What to do:**
- [Solution]

---

## Tips

**DO:**
- ✅ [Best practice]

**DON'T:**
- ❌ [Common mistake]

---

## Common Issues

**"[Error message]"**
→ [Quick fix]

---

## Related

- **[Link](path)** - Description
```

---

## Template: Developer Reference

```markdown
# [Feature] API Reference

Quick reference for [feature]. For complete docs: [Link to API Docs]

---

## Overview

[2-3 sentences what this does]

**Contract:** `ContractName.sol`  
**API Base:** `/endpoint`

---

## Key Functions

### [Function Name]

**Contract:**
```solidity
function name(params) external
```

**API:**
```bash
METHOD /endpoint
{ "param": "value" }
```

**[Full API Reference →](link)**

---

## Integration Example

```javascript
// One complete example
async function doThing() {
  // Complete flow
}
```

**[More examples →](link)**

---

## Key Parameters

[Table of important values]

---

## Resources

- 📘 [Full API Docs](link)
- 🔗 [Contract Source](link)
```

---

## Next Steps

With this streamlined approach:

1. **Update existing guides:**
   - `guides/borrow.md` → Complete end-to-end example
   - Remove excessive detail
   - Focus on real scenarios

2. **Create lean developer refs:**
   - `reference/lending.md` → Quick reference
   - Link to API docs
   - One integration example

3. **Continue systematically:**
   - Each feature: one end-user guide + one quick ref
   - Test with real users
   - Iterate based on feedback

Ready to apply this to the guides?

