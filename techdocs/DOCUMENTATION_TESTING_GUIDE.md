# Documentation Testing Guide

Systematic approach to verify documentation accuracy.

---

## Testing Layers

### Layer 1: Automated Tests (Quick)
Run scripts to verify technical accuracy

### Layer 2: Manual UI Verification (Medium)
Follow guides step-by-step in the app

### Layer 3: End-to-End Scenarios (Thorough)
Complete full scenarios with real transactions

---

## Layer 1: Automated Tests

### Test 1: Health Factor Calculations

**Script:** Verify all HF math in scenarios

```python
# test_health_factors.py
import re

def verify_health_factor(collateral, debt, liq_threshold=0.80):
    """Calculate HF and return result"""
    return (collateral * liq_threshold) / debt

def test_scenario_math(file_path):
    """Parse scenario file and verify all HF calculations"""
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Find all HF claims like "HF: 1.5", "Health Factor: 2.4"
    hf_pattern = r'(?:HF|Health Factor):\s*(\d+\.?\d*)'
    
    # Find all collateral/debt pairs
    # This would need to parse the context around each HF claim
    
    # Verify each calculation
    # Report any mismatches

# Run on all scenario files
scenarios = [
    'scenarios/maximize-yield.md',
    'scenarios/leverage-long.md',
    'scenarios/multi-asset-strategy.md',
    # ... etc
]

for scenario in scenarios:
    test_scenario_math(scenario)
```

**What it checks:**
- ✅ All HF calculations are mathematically correct
- ✅ Liquidation thresholds are consistent (0.80)
- ✅ No arithmetic errors

---

### Test 2: API Endpoints

**Script:** Verify all URLs and endpoints work

```bash
#!/bin/bash
# test_endpoints.sh

echo "Testing API Endpoints..."

# Test RPC URLs
curl -s https://app.strato.nexus/strato-api/eth/v1.2 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  && echo "✅ Mainnet RPC" || echo "❌ Mainnet RPC"

curl -s https://testnet.strato.nexus/strato-api/eth/v1.2 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  && echo "✅ Testnet RPC" || echo "❌ Testnet RPC"

# Test API docs
curl -s https://app.strato.nexus/api/docs > /dev/null \
  && echo "✅ App API Swagger" || echo "❌ App API Swagger"

curl -s https://app.strato.nexus/docs > /dev/null \
  && echo "✅ Core API Swagger" || echo "❌ Core API Swagger"

# Test app URLs
curl -s https://app.strato.nexus > /dev/null \
  && echo "✅ Main app" || echo "❌ Main app"

curl -s https://testnet.strato.nexus > /dev/null \
  && echo "✅ Testnet app" || echo "❌ Testnet app"
```

**What it checks:**
- ✅ All RPC URLs are accessible
- ✅ API documentation is available
- ✅ App URLs work
- ✅ No broken external links

---

### Test 3: Link Checker

**Script:** Find all broken links in docs

```bash
#!/bin/bash
# test_links.sh

echo "Checking internal links..."

# Find all markdown links
grep -r '\[.*\](.*\.md)' techdocs/ | while read line; do
  file=$(echo $line | cut -d: -f1)
  link=$(echo $line | grep -o '(.*\.md)' | tr -d '()')
  
  # Resolve relative path
  dir=$(dirname "$file")
  target="$dir/$link"
  
  if [ ! -f "$target" ]; then
    echo "❌ Broken: $file -> $link"
  fi
done

echo "Checking external links..."

# Test external URLs
grep -roh 'https://[^)]*' techdocs/ | sort -u | while read url; do
  curl -s -o /dev/null -w "%{http_code}" "$url" | grep -q "200" \
    && echo "✅ $url" || echo "❌ $url"
done
```

**What it checks:**
- ✅ All internal links point to existing files
- ✅ All external URLs are accessible
- ✅ No 404 errors

---

### Test 4: Contract Address Verification

**Script:** Verify contract addresses are deployed

```javascript
// test_contracts.js
const { ethers } = require('ethers');

const provider = new ethers.JsonRpcProvider('https://app.strato.nexus/strato-api/eth/v1.2');

const contracts = {
  'LENDING_POOL': '0x1Cd8B514c246573952aB6943551A9Aea47F86f01',
  'CDP_ENGINE': '0x7Cde8CA7A5E8c90b034F20bDd5a5e69Ab60F6e30',
  'POOL_FACTORY': '0x6fe50BB26e2BC1E3f86B6aEf5c6f9B3a35AE5c1d',
  // ... all contracts
};

async function verifyContracts() {
  for (const [name, address] of Object.entries(contracts)) {
    const code = await provider.getCode(address);
    if (code === '0x') {
      console.log(`❌ ${name}: No contract at ${address}`);
    } else {
      console.log(`✅ ${name}: Verified at ${address}`);
    }
  }
}

verifyContracts();
```

**What it checks:**
- ✅ All contract addresses have deployed code
- ✅ No addresses point to EOAs or empty addresses
- ✅ Contract addresses match documentation

---

## Layer 2: Manual UI Verification

### UI Testing Checklist

For each user guide, verify the UI navigation:

#### Borrow Guide (`guides/borrow.md`)

**Step-by-step verification:**

- [ ] 1. Open app at https://app.strato.nexus
- [ ] 2. Navigate to "Borrow" page (sidebar)
- [ ] 3. Check: "Supply Collateral" section exists
- [ ] 4. Click "Supply" button in table
- [ ] 5. Modal opens with correct fields (Asset, Amount)
- [ ] 6. Verify "Supply Collateral" button exists
- [ ] 7. Check: "Borrow" section exists below
- [ ] 8. Click "Borrow" button
- [ ] 9. Form opens with correct fields
- [ ] 10. Verify health factor is displayed
- [ ] 11. Check: "Repay" section exists
- [ ] 12. Click "Repay" button in table
- [ ] 13. Form opens with repay amount field

**Document discrepancies:**
- Button label mismatch: Expected "_____", Actual "_____"
- Missing section: "_____"
- Wrong navigation path: "_____"

---

#### Mint CDP Guide (`guides/mint-cdp.md`)

- [ ] 1. Navigate to "Advanced" page (sidebar)
- [ ] 2. Click "Mint" tab
- [ ] 3. Check: Mint widget is visible
- [ ] 4. Verify fields: Collateral, Amount to Mint
- [ ] 5. Check: Button text changes dynamically
  - [ ] "Deposit" (if only deposit)
  - [ ] "Borrow" (if only borrow)
  - [ ] "Deposit & Borrow" (if both)
- [ ] 6. Check: "Your Vaults" list below
- [ ] 7. Verify "Withdraw" and "Repay" buttons in vaults

---

#### Swap Guide (`guides/swap.md`)

- [ ] 1. Navigate to "Swap Assets" page (sidebar)
- [ ] 2. Check: Swap widget is visible
- [ ] 3. Verify fields: From, To, Amount
- [ ] 4. Check: "Swap" button exists
- [ ] 5. Verify: No separate "Approve" button
- [ ] 6. Check: Swap history below widget

---

#### Bridge Guide (`guides/bridge.md`)

- [ ] 1. Navigate to "Deposits" page (sidebar)
- [ ] 2. Check: "Bridge In" tab
- [ ] 3. Verify fields: From, To, Asset, Amount
- [ ] 4. Check: "Bridge" button exists
- [ ] 5. Navigate to "Withdrawals" page
- [ ] 6. Check: "Bridge Out" tab
- [ ] 7. Verify same fields as bridge-in

---

#### Liquidity Guide (`guides/liquidity.md`)

- [ ] 1. Navigate to "Advanced" → "Swap Pools" tab
- [ ] 2. Check: "Add Liquidity" button
- [ ] 3. Click button, verify modal opens
- [ ] 4. Check fields: Token A, Token B, Amounts
- [ ] 5. Verify: No separate "Approve" button
- [ ] 6. Check: "Your Positions" section below
- [ ] 7. Verify "Remove Liquidity" button in positions

---

#### Rewards Guide (`guides/rewards.md`)

- [ ] 1. Navigate to "Rewards" page (sidebar)
- [ ] 2. Check: Three tabs visible
  - [ ] "My Rewards"
  - [ ] "Activities"
  - [ ] "Leaderboard"
- [ ] 3. Verify "Claim All" button in My Rewards
- [ ] 4. Check: Rewards breakdown is displayed

---

### UI Verification Report Template

```markdown
## UI Verification Report

**Date:** [DATE]
**Tester:** [NAME]
**Environment:** Mainnet / Testnet

### Guides Tested

#### Borrow Guide
- Status: ✅ Pass / ❌ Fail
- Issues:
  - [List any discrepancies]

#### Mint CDP Guide  
- Status: ✅ Pass / ❌ Fail
- Issues:
  - [List any discrepancies]

[... continue for all guides]

### Discrepancies Found

1. **Guide:** borrow.md, **Line:** 45
   - **Expected:** "Click 'Supply Collateral'"
   - **Actual:** Button is labeled "Supply"
   - **Action:** Update doc

2. [Continue list...]

### Summary

- Total guides tested: X
- Passed: Y
- Failed: Z
- Discrepancies found: N
```

---

## Layer 3: End-to-End Scenario Testing

### Full Scenario Verification

Test complete user scenarios with real (testnet) transactions:

#### Scenario 1: First Time User

**Prerequisites:**
- Fresh account
- Testnet access
- Test ETH on Ethereum testnet

**Steps:**
1. Register account (follow quick-start.md)
2. Bridge 0.1 ETH from Ethereum testnet
3. Verify: Received 10 vouchers
4. Supply 0.05 ETH as collateral (follow borrow.md)
5. Borrow 50 USDST
6. Check health factor matches calculation
7. Repay 50 USDST
8. Withdraw 0.05 ETH

**Verification:**
- [ ] All steps in documentation are accurate
- [ ] No missing steps
- [ ] Health factor calculations match
- [ ] Gas costs within estimated range
- [ ] Vouchers work as described

---

#### Scenario 2: Maximize Yield

**Prerequisites:**
- Account with 1 ETH on STRATO
- Some USDST available

**Steps:**
1. Follow maximize-yield.md exactly
2. Supply ETH, borrow USDST
3. Swap USDST → sUSDSST
4. Add liquidity to sUSDSST-USDST pool
5. Verify APR/yield estimates
6. Wait 24 hours
7. Check actual rewards earned

**Verification:**
- [ ] All steps work as documented
- [ ] Health factor matches (should be 2.4)
- [ ] Pool exists (sUSDSST-USDST)
- [ ] APR estimates are realistic
- [ ] Actual yields match estimates (±20%)

---

#### Scenario 3: Grow Your Position (Borrow & Loop)

**Prerequisites:**
- 5 ETH on STRATO

**Steps:**
1. Follow grow-position.md Loop 1
2. Supply 5 ETH, borrow 50% max
3. Buy more ETH with borrowed USDST
4. Supply new ETH, repeat
5. After 3 loops, verify final HF
6. Check: HF should be ~2.4

**Verification:**
- [ ] Math is correct at each step
- [ ] Health factor matches doc
- [ ] Conservative borrowing maintains safety
- [ ] Total ETH matches expected (~7.5)

---

### E2E Testing Report Template

```markdown
## E2E Scenario Testing Report

**Date:** [DATE]
**Tester:** [NAME]
**Environment:** Testnet

### Scenario: [NAME]

**Status:** ✅ Pass / ⚠️  Pass with Issues / ❌ Fail

**Steps Completed:**
- [ ] Step 1: [Description]
- [ ] Step 2: [Description]
- [...]

**Issues Found:**
1. **Step X:** [Description of issue]
   - **Expected:** [What doc says]
   - **Actual:** [What happened]
   - **Severity:** High / Medium / Low

**Metrics Verification:**
| Metric | Expected | Actual | Match? |
|--------|----------|--------|--------|
| Health Factor | 2.4 | 2.38 | ✅ Close |
| Gas Cost | $0.10 | $0.12 | ✅ Within range |
| APR | 25% | 24.3% | ✅ Close |

**Overall Assessment:**
[Summary of accuracy]

**Recommendations:**
- Update line X in [file]
- Clarify step Y
- etc.
```

---

## Continuous Verification

### Weekly Automated Tests

Run automated scripts weekly:

```bash
#!/bin/bash
# weekly_verification.sh

echo "=== Weekly Documentation Verification ==="
echo "Date: $(date)"

# Test 1: API Endpoints
./test_endpoints.sh > reports/endpoints_$(date +%Y%m%d).log

# Test 2: Links
./test_links.sh > reports/links_$(date +%Y%m%d).log

# Test 3: Contract Addresses
node test_contracts.js > reports/contracts_$(date +%Y%m%d).log

# Test 4: Health Factor Math
python test_health_factors.py > reports/math_$(date +%Y%m%d).log

echo "Reports saved to reports/"
```

---

### Monthly UI Review

Once per month:
- Assign team member to verify UI navigation
- Complete UI Testing Checklist
- Document any changes in app since last review
- Update docs accordingly

---

### Quarterly E2E Testing

Once per quarter:
- Run 3-5 complete scenario tests on testnet
- Use real transactions (testnet funds)
- Verify all metrics (HF, APR, costs)
- Update docs with any discrepancies

---

## Testing Tools Setup

### Install Dependencies

```bash
# For API/link testing
npm install -g broken-link-checker

# For contract verification
npm install ethers

# For math verification
pip install pytest
```

### Directory Structure

```
strato-platform/
├── techdocs/
│   └── [all docs]
└── tests/
    ├── automated/
    │   ├── test_endpoints.sh
    │   ├── test_links.sh
    │   ├── test_contracts.js
    │   └── test_health_factors.py
    ├── manual/
    │   ├── UI_VERIFICATION_CHECKLIST.md
    │   └── E2E_SCENARIO_TEMPLATES.md
    └── reports/
        ├── endpoints_YYYYMMDD.log
        ├── links_YYYYMMDD.log
        └── [other reports]
```

---

## Quick Start: Test Documentation Now

### 1. Run Automated Tests (5 min)

```bash
cd strato-platform

# Test APIs
curl -s https://app.strato.nexus/strato-api/eth/v1.2 \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Test Swagger
curl -s https://app.strato.nexus/api/docs > /dev/null && echo "✅ API Swagger" || echo "❌ API Swagger"

# Check a few internal links
ls techdocs/guides/borrow.md && echo "✅ borrow.md exists"
ls techdocs/guides/mint-cdp.md && echo "✅ mint-cdp.md exists"
```

### 2. Verify One Guide (15 min)

Pick one guide, open the app, and follow it step-by-step:
- Check every button label
- Verify every navigation path
- Document any discrepancies

### 3. Test One Scenario (30 min - testnet)

Pick simplest scenario (First Time User):
- Create testnet account
- Bridge testnet assets
- Complete the scenario
- Verify calculations

---

## Success Criteria

**Documentation is considered accurate if:**

✅ **Automated Tests:**
- 100% of API endpoints return 200
- 0 broken internal links
- 0 broken external links
- All contract addresses have deployed code
- All HF calculations are correct

✅ **UI Verification:**
- 90%+ of navigation steps match exactly
- Button labels match
- Page names match
- No missing critical steps

✅ **E2E Scenarios:**
- All steps can be completed
- Calculations match actual results (±10%)
- Gas costs within 2x of estimates
- No critical errors or blockers

---

## Maintenance Schedule

| Task | Frequency | Duration | Owner |
|------|-----------|----------|-------|
| Automated tests | Weekly | 5 min | DevOps |
| UI verification | Monthly | 2 hours | QA |
| E2E scenarios | Quarterly | 4 hours | Product |
| Full audit | Yearly | 2 days | Team |

---

## Reporting Issues

When you find inaccuracies:

1. **Document the issue:**
   - File name and line number
   - What the doc says
   - What actually happens
   - Screenshots if UI-related

2. **Assess severity:**
   - **High:** Blocks user, causes errors
   - **Medium:** Confusing, but workaround exists
   - **Low:** Minor wording, doesn't affect usage

3. **Create issue:**
   - Use template above
   - Tag with "documentation"
   - Assign to doc maintainer

4. **Fix and verify:**
   - Update documentation
   - Re-test the specific section
   - Mark issue as resolved

---

## Next Steps

**To implement this testing framework:**

1. Create `tests/` directory structure
2. Write automated test scripts
3. Set up weekly cron job for automated tests
4. Assign QA owner for monthly UI reviews
5. Schedule first quarterly E2E test
6. Create reporting templates
7. Train team on testing process

**Start today:**
- Run quick API endpoint test
- Pick one guide and verify UI
- Document any issues found

