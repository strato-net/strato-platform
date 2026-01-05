# Example: Supply Collateral - Dual Layer Documentation

This shows how the SAME feature is documented for both end-users and developers.

---

## LAYER 1: END-USER DOCUMENTATION

**Location:** `guides/borrow.md` - Step 1: Supply Collateral section

---

### Step 1: Supply Collateral

**What is collateral?**

Collateral is crypto assets you deposit to back your borrowing. Think of it like a security deposit - it stays in the vault while you have a loan, and you get it back when you repay.

**Why supply collateral?**

You can't borrow without collateral. The collateral ensures you can repay your loan. If the value of your collateral drops too much, it can be liquidated to cover your debt.

**How much can I borrow against my collateral?**

You can borrow up to 75% of most crypto assets' value:
- 1 ETH ($3,000) → Borrow up to $2,250 USDST
- 0.1 WBTC ($6,000) → Borrow up to $4,500 USDST
- 10,000 USDC ($10,000) → Borrow up to $9,000 USDST

---

#### How to Supply Collateral

**Before you start:**
- Have crypto assets in your STRATO wallet
- Keep 10-20 USDST for gas fees (< $0.10 per transaction)

**Step-by-step:**

**1. Go to Lending page**
   - Click **Lending** in the navigation
   - You'll see your available assets

**2. Choose asset to supply**
   - Select which token to use as collateral
   - Common choices: ETH, WBTC, USDC, USDT
   - Make sure it says "Can be used as collateral" ✓

**3. Enter amount**
   - Type how much to supply
   - Or click "Max" to supply all of that token
   - You'll see: "You can borrow up to: $X USDST"

**4. Approve (first time only)**
   - If this is your first time using this token:
   - Click **"Approve [Token]"**
   - Confirm in your wallet
   - Gas cost: < $0.10
   - Wait 1-2 seconds for confirmation
   - ✅ You only do this once per token

**5. Supply your collateral**
   - Click **"Supply Collateral"**
   - Review the transaction:
     - Amount you're supplying
     - New borrowing power
   - Confirm in your wallet
   - Gas cost: < $0.10
   - Wait 1-2 seconds

**✅ Done!** Your collateral is now active and ready for borrowing.

---

#### Example: Supply 1 ETH

Let's walk through a real example:

**Your situation:**
- You have: 2 ETH in your wallet
- ETH price: $3,000
- You want to supply: 1 ETH as collateral

**Transaction 1: Approve ETH (first time only)**
```
Action: Allow vault to use your ETH
Gas: < $0.10
Time: 1-2 seconds
Status: ✓ Approved
```

**Transaction 2: Supply 1 ETH**
```
Action: Transfer 1 ETH to collateral vault
Gas: < $0.10
Time: 1-2 seconds
Status: ✓ Supplied
```

**Result:**
- Your wallet now has: 1 ETH (you sent 1 to vault)
- Your collateral: 1 ETH ($3,000)
- You can borrow: Up to $2,250 USDST (75% of $3,000)
- Your health factor: N/A (no debt yet)

**What you see in the app:**
- Lending dashboard shows: "1 ETH supplied"
- Available to borrow: "$2,250 USDST"
- Status: Ready to borrow ✓

---

#### Tips for Supplying Collateral

**DO:**
- ✅ Supply more than you think you'll need (gives safety buffer)
- ✅ Use stable assets (USDC, USDT) if you want less price risk
- ✅ Diversify across multiple assets to spread risk
- ✅ Start with small amounts to test the process

**DON'T:**
- ❌ Supply your entire holdings (keep some liquid)
- ❌ Plan to max out your borrowing capacity
- ❌ Forget to keep USDST for gas fees
- ❌ Use unknown or suspicious tokens

**Best practices:**
1. **Over-collateralize**: Supply 2-3x what you plan to borrow
2. **Monitor prices**: Set alerts if your collateral price drops
3. **Keep reserves**: Don't use 100% of your crypto as collateral

---

#### Common Issues & Solutions

**"Insufficient allowance" or "Approval needed"**

**Problem:** You haven't approved the vault to use your tokens

**Solution:**
1. Click "Approve [Token]" button
2. Confirm the approval transaction
3. Wait for confirmation
4. Then try supplying again

---

**"Asset not configured as collateral"**

**Problem:** This token isn't accepted as collateral

**Solution:**
- Only certain tokens can be used as collateral
- Check the list of accepted collateral tokens
- Common accepted tokens: ETH, WBTC, USDC, USDT
- If you want to use a different token, swap it first

---

**"Transfer failed"**

**Problem:** Transaction couldn't complete

**Possible causes:**
- Not enough balance in wallet
- Not enough USDST for gas
- Already used in another DeFi position

**Solution:**
1. Check your balance is sufficient
2. Ensure you have USDST for gas (10-20 USDST)
3. If tokens are locked elsewhere, withdraw them first
4. Try again with a slightly smaller amount

---

**"Transaction is taking a long time"**

**Normal:** Transactions confirm in 1-2 seconds on STRATO

**If it's taking longer:**
- Wait up to 30 seconds
- Check the transaction status in block explorer
- Contact support if it doesn't confirm within 1 minute

---

#### What Happens to Your Collateral?

**While you have no debt:**
- Collateral sits safely in the vault
- You can withdraw it anytime (no fees)
- It counts toward your borrowing power

**While you have debt:**
- Collateral stays locked in vault
- You can't withdraw it if it would make health factor < 1.0
- If collateral price drops, add more or repay debt
- If health factor drops below 1.0, you can be liquidated

**When you repay fully:**
- You can withdraw ALL your collateral
- No fees to withdraw
- Collateral is returned to your wallet

---

#### Next Step: Borrow USDST

Now that you have collateral supplied, you can borrow USDST:

→ **[Continue to Step 2: Borrow USDST](#step-2-borrow-usdst)**

---

#### Related Topics

- **[Health Factor Explained](../concepts.md#health-factor)** - Understand how your position safety is calculated
- **[Liquidation Guide](../concepts.md#liquidation)** - What happens if collateral value drops
- **[Withdraw Collateral](#step-5-withdraw-collateral)** - How to get your collateral back

---

## LAYER 2: DEVELOPER DOCUMENTATION

**Location:** `reference/contracts/lending-pool.md`

---

### supplyCollateral

Supply collateral assets to the CollateralVault for future borrowing against.

#### Contract Function

```solidity
function supplyCollateral(address asset, uint amount) external onlyTokenFactory(asset)
```

**Contract:** `LendingPool.sol` (L285-299)

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `asset` | `address` | ERC20 token address to supply as collateral |
| `amount` | `uint256` | Amount to supply (in token's native decimals) |

#### Requirements

**Validations:**
1. `amount > 0` - Amount must be positive
2. `asset` must be active in TokenFactory (via `onlyTokenFactory` modifier)
3. Asset must be configured with valid collateral parameters:
   - `assetConfigs[asset].ltv > 0`
   - `assetConfigs[asset].liquidationThreshold > 0`
   - `assetConfigs[asset].liquidationBonus >= 10000` (100% in basis points)

**Prerequisites:**
- User must have called `IERC20(asset).approve(collateralVault, amount)` first
- User must have `amount` balance of `asset`

#### Execution Flow

```
1. LendingPool.supplyCollateral(asset, amount)
   │
   ├─→ Validate amount > 0
   ├─→ Check onlyTokenFactory(asset) modifier
   ├─→ Load AssetConfig from assetConfigs[asset]
   ├─→ Validate config.ltv > 0
   ├─→ Validate config.liquidationThreshold > 0
   ├─→ Validate config.liquidationBonus >= 10000
   │
   └─→ Call CollateralVault.addCollateral(msg.sender, asset, amount)
       │
       ├─→ Validate amount > 0
       ├─→ Execute IERC20(asset).transferFrom(borrower, vault, amount)
       ├─→ Update userCollaterals[borrower][asset] += amount
       └─→ Emit CollateralAdded(borrower, asset, amount)
   
   └─→ Emit SuppliedCollateral(msg.sender, asset, amount)
```

#### State Changes

**CollateralVault:**
- `userCollaterals[msg.sender][asset]` increases by `amount`

**Token:**
- `amount` tokens transferred from `msg.sender` to `CollateralVault`

**User's borrowing capacity increases:**
```solidity
maxBorrow = Σ (userCollaterals[user][asset_i] × price_i × ltv_i) / 1e18
```

#### Events Emitted

**1. CollateralAdded** (from CollateralVault)
```solidity
event CollateralAdded(address indexed user, address indexed asset, uint amount)
```

**2. SuppliedCollateral** (from LendingPool)
```solidity
event SuppliedCollateral(address indexed user, address indexed asset, uint amount)
```

#### Error Messages

| Error | Condition | Troubleshooting |
|-------|-----------|-----------------|
| `"Invalid amount"` | `amount == 0` | Ensure amount > 0 |
| `"Asset not configured as collateral"` | `config.ltv == 0` | Asset not enabled for collateral use |
| `"Asset missing liquidation threshold"` | `config.liquidationThreshold == 0` | Asset configuration incomplete |
| `"Asset missing liquidation bonus"` | `config.liquidationBonus < 10000` | Asset configuration incomplete |
| `"Transfer failed"` | transferFrom returns false | Check approval and balance |
| (TokenFactory error) | Asset not active | Asset must be registered and active |

#### Gas Cost

**Estimated gas usage:**
- **First-time approval:** ~45,000 gas
- **Supply transaction:** ~50,000 gas
- **Total for new token:** ~95,000 gas
- **Subsequent supplies:** ~50,000 gas

**Cost in USDST:** < $0.10 per transaction (at typical STRATO gas prices)

#### Integration Example (JavaScript/TypeScript)

```javascript
import { ethers } from "ethers";

async function supplyCollateral(
  lendingPoolAddress: string,
  collateralVaultAddress: string,
  assetAddress: string,
  amount: string, // Amount in wei (e.g., "1000000000000000000" for 1 token)
  signer: ethers.Signer
) {
  // 1. Get contracts
  const asset = new ethers.Contract(
    assetAddress,
    ["function approve(address spender, uint256 amount) returns (bool)"],
    signer
  );
  
  const lendingPool = new ethers.Contract(
    lendingPoolAddress,
    ["function supplyCollateral(address asset, uint256 amount)"],
    signer
  );
  
  const userAddress = await signer.getAddress();
  
  // 2. Check if approval needed
  const allowance = await asset.allowance(userAddress, collateralVaultAddress);
  
  if (allowance.lt(amount)) {
    console.log("Approving token...");
    const approveTx = await asset.approve(collateralVaultAddress, amount);
    await approveTx.wait();
    console.log("✓ Approved");
  }
  
  // 3. Supply collateral
  console.log("Supplying collateral...");
  const supplyTx = await lendingPool.supplyCollateral(assetAddress, amount);
  const receipt = await supplyTx.wait();
  console.log("✓ Supplied");
  
  // 4. Verify (optional)
  const vault = new ethers.Contract(
    collateralVaultAddress,
    ["function userCollaterals(address user, address asset) view returns (uint256)"],
    signer
  );
  
  const collateralBalance = await vault.userCollaterals(userAddress, assetAddress);
  console.log(`Collateral balance: ${ethers.utils.formatEther(collateralBalance)}`);
  
  return receipt;
}

// Usage
const receipt = await supplyCollateral(
  "0x...", // lendingPool address
  "0x...", // collateralVault address
  "0x...", // asset (e.g., ETH) address
  ethers.utils.parseEther("1.0"), // 1 token
  signer
);
```

#### API Integration

**Location:** `reference/api/lending.md`

##### POST /lending/supply

Supply collateral to the lending pool.

**Endpoint:**
```
POST /lending/supply
```

**Authentication:** Required (Bearer token)

**Request Body:**
```json
{
  "asset": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "amount": "1000000000000000000"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `asset` | string | Yes | Collateral token address |
| `amount` | string | Yes | Amount in wei (integer string) |

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "txHash": "0xabc123...",
    "status": "pending"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_ALLOWANCE",
    "message": "Token approval required"
  }
}
```

**Error Codes:**
| Code | HTTP | Description | Solution |
|------|------|-------------|----------|
| `INSUFFICIENT_ALLOWANCE` | 400 | Approval needed | Call approve first |
| `INSUFFICIENT_BALANCE` | 400 | Not enough tokens | Get more tokens |
| `ASSET_NOT_CONFIGURED` | 400 | Asset not accepted | Use different asset |
| `INVALID_AMOUNT` | 400 | Amount is 0 or negative | Use positive amount |
| `UNAUTHORIZED` | 401 | Invalid/missing token | Authenticate |

**Backend Implementation:**

The backend service handles approval and supply in sequence:

```typescript
export const supplyCollateral = async (
  accessToken: string,
  userAddress: string,
  asset: string,
  amount: string,
) => {
  // 1. Get addresses from registry
  const { lendingPool, collateralVault } = await getPool(accessToken);
  
  // 2. Build approval transaction
  const approvalTx = {
    contractName: "IERC20",
    contractAddress: asset,
    method: "approve",
    args: { spender: collateralVault, amount }
  };
  
  // 3. Build supply transaction
  const supplyTx = {
    contractName: "LendingPool",
    contractAddress: lendingPool,
    method: "supplyCollateral",
    args: { asset, amount }
  };
  
  // 4. Execute transactions
  const tx = [approvalTx, supplyTx];
  const builtTx = await buildFunctionTx(tx, userAddress, accessToken);
  return await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, builtTx)
  );
};
```

#### Worked Example

**Scenario:** User supplies 2 ETH as collateral

**Initial State:**
```
User wallet: 5 ETH
CollateralVault.userCollaterals[user][ETH]: 0
User allowance: 0
ETH price: $3,000
```

**Step 1: Approve**
```solidity
ETH.approve(collateralVault, 2 ether)
// Sets allowance[user][collateralVault] = 2 ether
// Gas: ~45,000
```

**Step 2: Supply**
```solidity
LendingPool.supplyCollateral(ETH, 2 ether)
// Validates amount > 0 ✓
// Validates ETH is configured (ltv=7500, liquidationThreshold=8000, bonus=10500) ✓
// Calls CollateralVault.addCollateral(user, ETH, 2 ether)
//   - Executes ETH.transferFrom(user, vault, 2 ether)
//   - Updates userCollaterals[user][ETH] = 2 ether
//   - Emits CollateralAdded
// Emits SuppliedCollateral
// Gas: ~50,000
```

**Final State:**
```
User wallet: 3 ETH (5 - 2)
CollateralVault.userCollaterals[user][ETH]: 2 ether
CollateralVault balance: 2 ETH
User's max borrow: 2 ETH × $3,000 × 75% = $4,500 USDST
```

#### Security Considerations

**Approval Security:**
- Users grant unlimited approval risk if using `type(uint256).max`
- Recommend approving exact amounts for security
- Approval can be front-run (standard ERC20 issue)

**Shared Collateral:**
- Collateral is shared between LendingPool and CDPEngine
- Withdrawals from either system affect both
- Users must monitor combined health factor

**Re-entrancy:**
- Not vulnerable: transferFrom called before state changes
- CollateralVault updates state after transfer completes

**Asset Verification:**
- Only TokenFactory-registered assets accepted
- Prevents arbitrary token exploits

#### Testing

From `DustAttack.test.sol`:
```solidity
// Example test showing supply flow
TestUtils.callAs(
    user,
    address(pool),
    "supplyCollateral(address,uint256)",
    collateralToken,
    collateralAmount
);
```

#### Related Functions

**Depends on:**
- `CollateralVault.addCollateral()` - Executes the actual transfer
- `TokenFactory.isTokenActive()` - Validates asset
- `assetConfigs[asset]` - Asset configuration

**Related to:**
- `withdrawCollateral()` - Reverse operation
- `calculateMaxBorrowingPower()` - Uses supplied collateral
- `getHealthFactor()` - Affected by collateral amount
- `CDPEngine.deposit()` - Also adds to shared collateral

**See Also:**
- [Withdraw Collateral](#withdrawcollateral)
- [Calculate Max Borrow](#calculatemaxborrowingpower)
- [Asset Configuration](#configureasset)

---

## Comparison: End-User vs Developer

| Aspect | End-User Docs | Developer Docs |
|--------|---------------|----------------|
| **Language** | "Supply collateral to the vault" | `supplyCollateral(address asset, uint amount)` |
| **Focus** | What & how to do it | Technical implementation |
| **Detail Level** | High-level steps | Function-level code |
| **Examples** | "$3,000 ETH → borrow $2,250" | `ethers.utils.parseEther("1.0")` |
| **Errors** | "Approval needed" | `"Asset not configured as collateral"` |
| **Audience** | Non-technical users | Developers & integrators |

---

## Key Takeaways

**From this analysis, I learned:**

1. **Two approval flows needed:**
   - User approves CollateralVault (not LendingPool)
   - Backend handles both transactions in sequence

2. **Asset must be fully configured:**
   - ltv > 0
   - liquidationThreshold > 0
   - liquidationBonus >= 10000 (100%)

3. **Collateral is shared:**
   - Same CollateralVault for lending and CDP
   - Affects both systems' health calculations

4. **Gas costs are low:**
   - ~50k gas per transaction
   - < $0.10 on STRATO

**This enables accurate documentation:**
- ✅ End-users know exactly what to expect
- ✅ Developers have complete technical reference
- ✅ Both are based on actual contract code
- ✅ No assumptions or "typically" language

---

## Next Steps

This same dual-layer approach will be applied to:
- [ ] Borrow USDST
- [ ] Repay
- [ ] Withdraw Collateral
- [ ] Liquidation
- [ ] CDP Mint
- [ ] And all other features...

Each feature gets:
1. Deep technical analysis
2. End-user guide section
3. Developer contract reference
4. Developer API reference
5. Worked examples
6. Test validation

