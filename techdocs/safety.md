# Safety & Best Practices

Essential security and risk management guidelines for using STRATO safely.

## Security Checklist

### Wallet Security

- [ ] **Never share seed phrase** - Not with support, not with anyone
- [ ] **Verify URLs** - Bookmark official STRATO URL, watch for phishing
- [ ] **Check transaction details** - Review before signing in wallet
- [ ] **Keep backups** - Secure seed phrase backup in multiple locations
- [ ] **Use hardware wallet** - For large amounts (Ledger, Trezor)

### Transaction Security

- [ ] **Start small** - Test with small amounts first
- [ ] **Double-check addresses** - Verify recipient addresses carefully
- [ ] **Review gas fees** - Check Ethereum gas before bridging
- [ ] **Monitor confirmations** - Wait for full transaction confirmation

### Account Security

- [ ] **Enable 2FA** - On centralized services (exchanges, email)
- [ ] **Use strong passwords** - Unique password for each service
- [ ] **Beware of scams** - Never click suspicious links in Telegram or DMs
- [ ] **Verify support** - STRATO team will never DM you first

## Risk Management

### For Borrowing/Minting

**Keep Health Factor / CR Safe:**

- Maintain health factor > 2.0 or CR > 200%
- Set price alerts for collateral assets
- Don't borrow maximum - leave buffer
- Monitor positions daily during volatility

**Add Safety Margins:**
```
Example Safe Position:

- Collateral: 2 ETHST ($6,000)
- Borrow: Only 2,000 USDST (not max $4,200)
- Health Factor: ~2.4 (very safe)
- Can withstand 58% ETHST price drop
```

**Monitor and React:**

1. Check health factor daily
2. Set alerts at liquidation prices
3. Have plan to add collateral or repay
4. Act quickly during market volatility

### For Liquidity Provision

**Understand Impermanent Loss:**

- Start with stablecoin pairs (minimal IL)
- Calculate potential IL before depositing
- Track fees earned vs. IL regularly
- Only use funds you can afford to hold long-term

**Choose Pools Wisely:**

- High volume = more fees to offset IL
- Check pool size (larger = less slippage)
- Verify both tokens are legitimate
- Start with well-known pairs (ETH-USDC)

**Example Calculation:**
```
Pool: ETH-USDC
Deposit: $10,000
Daily volume: $100,000
Fee tier: 0.3%

Daily fees: $100,000 × 0.003 = $300
Your share (1%): $3/day = $90/month

If IL is $50/month: Net +$40/month
```

### For Bridging

**Minimize Risks:**

- Double-check destination address
- Bridge during low gas times
- Keep transaction hashes
- Wait for full confirmations (12+ blocks Ethereum)
- Start with test amount

**Gas Optimization:**
```
High gas time: 8am-5pm UTC weekdays ($30-50)
Low gas time: Weekends/late night UTC ($5-15)

Savings on $10k bridge: $20-35 in gas fees
```

## Common Mistakes to Avoid

### 1. Borrowing Too Much ❌

**Mistake:** Borrowing maximum allowed amount

**Risk:** No buffer for price volatility, instant liquidation risk

**Fix:** Borrow 50-70% of max, keep health factor > 2.0

### 2. Ignoring Gas Fees ❌

**Mistake:** Bridging small amounts when gas is high

**Risk:** Fees eat into capital

**Fix:** Check gas prices, bridge larger amounts, use low-gas times

### 3. Not Monitoring Positions ❌

**Mistake:** Set and forget

**Risk:** Liquidation during market moves

**Fix:** Check daily, set alerts, have action plan

### 4. Panic Selling ❌

**Mistake:** Selling collateral at a loss during volatility

**Risk:** Realizing losses unnecessarily

**Fix:** Have plan before volatility, maintain high health factor to weather storms

### 5. Skipping Approvals ❌

**Mistake:** Not understanding approve + transaction flow

**Risk:** Confusion, failed transactions

**Fix:** Expect 2-step process (approve then execute)

### 6. Withdrawing Too Much ❌

**Mistake:** Withdrawing collateral without checking health factor

**Risk:** Triggering liquidation

**Fix:** Use "max safe withdrawal" in UI, leave buffer

### 7. Using Full Balance ❌

**Mistake:** Not keeping USDST for fees

**Risk:** Can't execute transactions

**Fix:** Always keep 5-10 USDST reserve

## Liquidation Prevention

### Watch These Metrics

**Daily checks:**

- Current health factor / CR
- Collateral asset prices
- Distance to liquidation price

**Set alerts at:**

- Health factor < 1.5 or CR < 180%
- Collateral price drops 10% from deposit
- Liquidation price approaching

### Action Plan

**If health factor drops below 1.5:**

**Option 1: Add Collateral**
- Fastest way to improve health factor
- No need to have extra USDST
- Immediately improves position

**Option 2: Repay Debt**
- Reduces risk permanently
- Requires having USDST available
- May trigger tax event

**Option 3: Do Nothing**
- Only if you're confident price will recover
- Very risky below 1.2
- Have plan ready if continues dropping

### Example Prevention

```
Starting position:

- 10 ETH @ $3,000 = $30,000
- Borrowed: 15,000 USDST
- Health factor: 1.6

ETHST drops to $2,700:

- Collateral now: $27,000
- Health factor: 1.44 ⚠️

Action: Add 2 ETH collateral
- New collateral: $32,400
- Health factor: 1.73 ✅ Safe again
```

## Getting Help

### Before Asking

1. Check this documentation
2. Search community Telegram or FAQ
3. Review FAQ (if available)

### When Asking for Help

**Provide:**

- Clear description of issue
- Steps you've taken
- Transaction hashes (if applicable)
- Screenshots (crop out sensitive info)

**Never share:**

- Seed phrase / private keys
- Password
- Full wallet address publicly

### Official Channels

- **Documentation**: [docs.strato.nexus](https://docs.strato.nexus)
- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)

!!! warning "Beware of Scammers"
    - Official team will NEVER DM you first
    - Never click links in unsolicited DMs
    - Always verify you're on official channels
    - If something seems too good to be true, it is

## Emergency Procedures

### If You Think You're Compromised

**Immediate actions:**

1. **Transfer assets** to new wallet immediately
2. **Revoke approvals** on compromised wallet
3. **Change passwords** on all connected services
4. **Enable 2FA** on new accounts
5. **Report** to STRATO team and community

### If Transaction Stuck

**Causes:**

- Low gas price (Ethereum)
- Network congestion
- Nonce issues

**Fixes:**

- Speed up transaction (if wallet supports)
- Wait for network to clear
- Cancel and resubmit with higher gas

### If Wrong Address

**Unfortunately:**

- Blockchain transactions are irreversible
- Funds sent to wrong address are likely lost
- Always double-check addresses

**Prevention:**

- Copy-paste addresses (don't type)
- Verify first and last 6 characters
- Send test transaction first

## Resources

- **[Core Concepts](concepts.md)** - Understand the fundamentals
- **[Borrow Guide](guides/borrow.md)** - Lending pool guide
- **[CDP Guide](guides/mint-cdp.md)** - CDP guide
- **[Bridge Guide](guides/bridge.md)** - Bridging guide

## Ready to Start?

With safety practices in mind, choose your path:

- **[Borrow USDST Guide](guides/borrow.md)**
- **[Mint USDST via CDP Guide](guides/mint-cdp.md)**



