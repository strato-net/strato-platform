# Documentation Accuracy Verification Checklist

## 1. Contract Addresses & Networks

### To Verify:
- [ ] All contract addresses in `developer/contract-addresses.md` are correct
- [ ] RPC URLs work: `https://app.strato.nexus/strato-api/eth/v1.2`
- [ ] Testnet URLs work: `https://buildtest.mercata-testnet.blockapps.net/strato-api/eth/v1.2`
- [ ] Block explorer URLs are functional
- [ ] Chain IDs are correct

**How to verify:**
```bash
# Test RPC endpoints
curl https://app.strato.nexus/strato-api/eth/v1.2

# Check contract on explorer
# Visit block explorer URLs in developer/contract-addresses.md
```

---

## 2. Mathematical Formulas

### Health Factor (Lending)
**Formula in docs:** `(Collateral Value × Liquidation Threshold) / Borrowed Amount`

- [ ] Verify against `LendingPool.sol::getHealthFactor()`
- [ ] Check example calculations are correct
- [ ] Liquidation threshold values match contracts

### Collateralization Ratio (CDP)
**Formula in docs:** `(Collateral Value / Minted USDST) × 100%`

- [ ] Verify against `CDPEngine.sol` logic
- [ ] Check example calculations
- [ ] Liquidation ratios match contracts

**Files to check:**
- `techdocs/concepts.md` (lines 22-45, 47-68)
- `techdocs/guides/borrow.md`
- `techdocs/guides/mint-cdp.md`

---

## 3. API Endpoints

### App API (`/api`)
- [ ] Keycloak OAuth token endpoint - Returns access token (see Quick Start for auth flow)
- [ ] `/tokens/v2` - Lists tokens
- [ ] Lending endpoints exist and match docs
- [ ] CDP endpoints exist and match docs
- [ ] Swap endpoints exist and match docs

### Core Platform API (`/strato-api`)
- [ ] `/strato-api/eth/v1.2/account` works
- [ ] `/strato-api/eth/v1.2/transaction` works
- [ ] Transaction submission format is correct

**How to verify:**
```bash
# Test actual API
curl https://app.strato.nexus/api/docs
curl https://app.strato.nexus/docs
```

**Files to check:**
- `techdocs/reference/api.md`
- `techdocs/reference/strato-node-api.md`
- `techdocs/reference/interactive-api.md`

---

## 4. User Flows & UI Steps

### Quick Start Flow
- [ ] Registration process matches actual UI
- [ ] MetaMask setup steps are correct
- [ ] Network configuration is accurate
- [ ] Bridge flow matches actual experience

**Test:** Walk through `techdocs/quick-start.md` with actual app

### Borrow Guide
- [ ] UI button names match ("Supply Collateral", "Borrow", etc.)
- [ ] Transaction flow is accurate (approve → supply → borrow)
- [ ] Health factor display location is correct
- [ ] Gas costs are realistic

**Test:** Follow `techdocs/guides/borrow.md` step-by-step

### CDP Mint Guide
- [ ] UI flow matches documented steps
- [ ] CR calculation shown correctly in UI
- [ ] Mint/burn process is accurate

**Test:** Follow `techdocs/guides/mint-cdp.md` step-by-step

### Other Guides
- [ ] Swap guide matches DEX UI
- [ ] Liquidity guide matches pool UI
- [ ] Bridge guide matches bridge flow
- [ ] Rewards guide matches rewards UI

---

## 5. Code Examples

### JavaScript/TypeScript Examples
**Files with code:**
- `developer/overview.md`
- `developer/quickstart.md`
- `developer/integration.md`
- `developer/quick-reference.md`
- `developer/e2e.md`

**Verify:**
- [ ] Syntax is valid (no obvious errors)
- [ ] Contract ABIs match actual contracts
- [ ] ethers.js usage is correct
- [ ] API client examples work

**How to verify:**
```bash
# Extract and test a code example
# Create test.js from a code block and run:
node test.js
```

---

## 6. Numerical Claims

### Gas Costs
**Claims in docs:**
- "< $0.10 per transaction"
- "~$0.30 total gas cost"
- "Ethereum gas $5-50"

- [ ] Test actual transactions and verify gas costs

### APR/Returns
**Claims in docs:**
- "8-12% APR" (liquidity fees)
- "10-15% APR" (combined yield)
- "5% annual rate" (borrow interest)

- [ ] Verify against actual pool data
- [ ] Check if rates are current or examples

### Timing
**Claims in docs:**
- "~1-2 second block times"
- "5-15 minutes" (bridge time)
- "~5-10 seconds" (transaction confirmation)

- [ ] Test actual transaction times
- [ ] Test bridge completion times

**Files to check:**
- `developer/overview.md`
- `guides/borrow.md`
- `guides/bridge.md`
- `scenarios/*.md`

---

## 7. Token Information

**In `concepts.md` - Available Tokens section:**
- [ ] ETHST, WBTCST addresses are correct
- [ ] USDCST, USDTST addresses are correct
- [ ] GOLDST, SILVST exist and are correct
- [ ] CATA token address is correct
- [ ] Decimals are accurate

---

## 8. Smart Contract Logic

### Collateral Architecture
**Claim:** CollateralVault is shared between Lending and CDP

- [ ] Verify in `CollateralVault.sol`
- [ ] Confirm Lending and CDP use SEPARATE vaults (CollateralVault vs CDPVault)

### Interest/Stability Fee
**Claim:** Interest accrues per-second using Ray math

- [ ] Verify in contracts (`perSecondFactorRAY`)
- [ ] Check rate accumulator logic

### Liquidation Logic
**Claims:** 
- Lending: HF < 1.0 triggers liquidation
- CDP: CR < liquidation ratio triggers liquidation

- [ ] Verify in `LendingPool.sol::liquidationCall`
- [ ] Verify in `CDPEngine.sol`

**Files to check:**
- `concepts.md`
- `guides/borrow.md`
- `guides/mint-cdp.md`

---

## 9. External Links

- [ ] https://app.strato.nexus (works)
- [ ] https://testnet.strato.nexus (works)
- [ ] https://docs.strato.nexus (works)
- [ ] https://support.blockapps.net (works)
- [ ] https://t.me/strato_net (works)
- [ ] Swagger UI links work:
  - [ ] https://app.strato.nexus/api/docs
  - [ ] https://app.strato.nexus/docs
  - [ ] https://buildtest.mercata-testnet.blockapps.net/api/docs
  - [ ] https://buildtest.mercata-testnet.blockapps.net/docs

---

## 10. System Architecture

**In `reference/architecture.md`:**
- [ ] Frontend tech stack is accurate (React + TypeScript + Vite)
- [ ] Backend tech stack is accurate (Node.js + Express + TypeScript)
- [ ] Database description is accurate (Cirrus PostgreSQL)
- [ ] Component interactions are correct

---

## Verification Priority

### 🔴 Critical (Must Verify):
1. Contract addresses
2. RPC URLs and network config
3. Health Factor / CR formulas
4. Registration/login process
5. Basic transaction flows

### 🟡 Important (Should Verify):
1. All code examples
2. Gas cost estimates
3. UI button names and flows
4. API endpoint responses
5. Bridge timing

### 🟢 Nice to Have (Can Verify):
1. APR estimates (these change)
2. Specific UI styling details
3. Example scenarios
4. Advanced edge cases

---

## How to Use This Checklist

1. **Print or open this file**
2. **Go through each section systematically**
3. **For each item:**
   - Test against actual system
   - Mark ✓ if accurate
   - Mark ✗ if incorrect
   - Add notes on what needs fixing
4. **Create issues for inaccuracies found**
5. **Update docs and re-verify**

---

## Quick Verification Script

Run this to do basic checks:

```bash
# Test RPC endpoints
echo "Testing RPC endpoints..."
curl -s https://app.strato.nexus/strato-api/eth/v1.2 > /dev/null && echo "✓ Mainnet RPC" || echo "✗ Mainnet RPC"
curl -s https://buildtest.mercata-testnet.blockapps.net/strato-api/eth/v1.2 > /dev/null && echo "✓ Testnet RPC" || echo "✗ Testnet RPC"

# Test Swagger UIs
echo -e "\nTesting Swagger UIs..."
curl -s https://app.strato.nexus/api/docs > /dev/null && echo "✓ App API Swagger" || echo "✗ App API Swagger"
curl -s https://app.strato.nexus/docs > /dev/null && echo "✓ Core API Swagger" || echo "✗ Core API Swagger"

# Test external links
echo -e "\nTesting external links..."
curl -s https://app.strato.nexus > /dev/null && echo "✓ Main app" || echo "✗ Main app"
curl -s https://support.blockapps.net > /dev/null && echo "✓ Support portal" || echo "✗ Support portal"

echo -e "\n✓ Basic connectivity check complete"
```

