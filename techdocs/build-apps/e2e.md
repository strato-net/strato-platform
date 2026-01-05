# End-to-End Integration Examples

Complete workflow examples for building on STRATO.

---

## Example 1: Yield Farming App

Build an app that helps users earn yield through lending and liquidity provision.

### User Flow

1. User connects wallet
2. Supplies ETH as collateral
3. Borrows USDST
4. Provides USDST-USDC liquidity
5. Earns trading fees + CATA rewards

### Implementation

```javascript
const { ethers } = require('ethers');

class YieldFarmingApp {
  constructor(provider, wallet) {
    this.provider = provider;
    this.wallet = wallet;
    
    // Initialize contracts
    this.lendingPool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, wallet);
    this.router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
    this.rewards = new ethers.Contract(REWARDS, REWARDS_ABI, wallet);
  }
  
  async executeStrategy(ethAmount) {
    console.log('Starting yield farming strategy...');
    
    // 1. Supply collateral
    await this.supplyCollateral(ethAmount);
    
    // 2. Borrow USDST (50% of collateral value)
    const borrowAmount = ethAmount * 3000n * 50n / 100n; // Assume $3k ETH
    await this.borrowUSDST(borrowAmount);
    
    // 3. Swap half to USDC
    const swapAmount = borrowAmount / 2n;
    await this.swapToUSDC(swapAmount);
    
    // 4. Provide liquidity
    await this.provideLiquidity(swapAmount, swapAmount);
    
    // 5. Track position
    return await this.getPositionSummary();
  }
  
  async supplyCollateral(amount) {
    const ethToken = new ethers.Contract(ETH_TOKEN, ERC20_ABI, this.wallet);
    
    // Approve
    let tx = await ethToken.approve(LENDING_POOL, amount);
    await tx.wait();
    
    // Supply
    tx = await this.lendingPool.supplyCollateral(ETH_TOKEN, amount);
    await tx.wait();
    
    console.log('✅ Supplied', ethers.formatEther(amount), 'ETH');
  }
  
  async borrowUSDST(amount) {
    const tx = await this.lendingPool.borrow(USDST_TOKEN, amount);
    await tx.wait();
    
    console.log('✅ Borrowed', ethers.formatEther(amount), 'USDST');
  }
  
  async swapToUSDC(amount) {
    const usdst = new ethers.Contract(USDST_TOKEN, ERC20_ABI, this.wallet);
    
    // Approve
    let tx = await usdst.approve(ROUTER, amount);
    await tx.wait();
    
    // Swap
    const path = [USDST_TOKEN, USDC_TOKEN];
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    
    tx = await this.router.swapExactTokensForTokens(
      amount,
      amount * 995n / 1000n, // 0.5% slippage
      path,
      this.wallet.address,
      deadline
    );
    await tx.wait();
    
    console.log('✅ Swapped', ethers.formatEther(amount), 'USDST → USDC');
  }
  
  async provideLiquidity(usdstAmount, usdcAmount) {
    const usdst = new ethers.Contract(USDST_TOKEN, ERC20_ABI, this.wallet);
    const usdc = new ethers.Contract(USDC_TOKEN, ERC20_ABI, this.wallet);
    
    // Approve both
    await (await usdst.approve(ROUTER, usdstAmount)).wait();
    await (await usdc.approve(ROUTER, usdcAmount)).wait();
    
    // Add liquidity
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const tx = await this.router.addLiquidity(
      USDST_TOKEN,
      USDC_TOKEN,
      usdstAmount,
      usdcAmount,
      usdstAmount * 95n / 100n, // 5% slippage
      usdcAmount * 95n / 100n,
      this.wallet.address,
      deadline
    );
    await tx.wait();
    
    console.log('✅ Provided liquidity');
  }
  
  async getPositionSummary() {
    const hf = await this.lendingPool.getHealthFactor(this.wallet.address);
    const pending = await this.rewards.pendingRewards(this.wallet.address);
    
    return {
      healthFactor: ethers.formatEther(hf),
      pendingRewards: ethers.formatEther(pending)
    };
  }
}

// Usage
const app = new YieldFarmingApp(provider, wallet);
const result = await app.executeStrategy(ethers.parseEther('5.0'));
console.log('Position:', result);
```

---

## Example 2: Portfolio Dashboard

Build a dashboard showing user's complete DeFi position.

```javascript
class PortfolioDashboard {
  constructor(provider, userAddress) {
    this.provider = provider;
    this.userAddress = userAddress;
  }
  
  async getCompletePortfolio() {
    const [lending, cdp, liquidity, rewards] = await Promise.all([
      this.getLendingPosition(),
      this.getCDPPosition(),
      this.getLiquidityPositions(),
      this.getRewards()
    ]);
    
    return {
      lending,
      cdp,
      liquidity,
      rewards,
      totalValue: this.calculateTotalValue(lending, cdp, liquidity)
    };
  }
  
  async getLendingPosition() {
    const pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, this.provider);
    
    const [collateral, debt, , , , hf] = await pool.getUserAccountData(this.userAddress);
    
    return {
      collateral: ethers.formatEther(collateral),
      debt: ethers.formatEther(debt),
      healthFactor: ethers.formatEther(hf)
    };
  }
  
  async getCDPPosition() {
    const cdp = new ethers.Contract(CDP_ENGINE, CDP_ENGINE_ABI, this.provider);
    
    const [collateral, debt, cr] = await cdp.getVault(this.userAddress);
    
    return {
      collateral: ethers.formatEther(collateral),
      debt: ethers.formatEther(debt),
      collateralizationRatio: ethers.formatUnits(cr, 2)
    };
  }
  
  async getLiquidityPositions() {
    // Query all pairs user has LP tokens in
    const factory = new ethers.Contract(FACTORY, FACTORY_ABI, this.provider);
    const pairs = await this.getUserPairs(factory);
    
    const positions = [];
    for (const pairAddress of pairs) {
      const pair = new ethers.Contract(pairAddress, PAIR_ABI, this.provider);
      const balance = await pair.balanceOf(this.userAddress);
      
      if (balance > 0n) {
        const [token0, token1] = await Promise.all([
          pair.token0(),
          pair.token1()
        ]);
        
        positions.push({
          pair: pairAddress,
          token0,
          token1,
          lpBalance: ethers.formatEther(balance)
        });
      }
    }
    
    return positions;
  }
  
  async getRewards() {
    const rewards = new ethers.Contract(REWARDS, REWARDS_ABI, this.provider);
    const pending = await rewards.pendingRewards(this.userAddress);
    
    return {
      cata: ethers.formatEther(pending)
    };
  }
  
  calculateTotalValue(lending, cdp, liquidity) {
    // Simplified - in production, fetch prices and calculate properly
    return {
      totalCollateral: parseFloat(lending.collateral) + parseFloat(cdp.collateral),
      totalDebt: parseFloat(lending.debt) + parseFloat(cdp.debt)
    };
  }
}

// Usage
const dashboard = new PortfolioDashboard(provider, userAddress);
const portfolio = await dashboard.getCompletePortfolio();
console.log(JSON.stringify(portfolio, null, 2));
```

---

## Example 3: Risk Monitor

Monitor health factors and send alerts.

```javascript
class RiskMonitor {
  constructor(provider, addresses) {
    this.provider = provider;
    this.addresses = addresses; // Array of addresses to monitor
    this.pool = new ethers.Contract(LENDING_POOL, LENDING_POOL_ABI, provider);
  }
  
  async checkAllPositions() {
    const alerts = [];
    
    for (const address of this.addresses) {
      const hf = await this.pool.getHealthFactor(address);
      const hfValue = parseFloat(ethers.formatEther(hf));
      
      if (hfValue < 1.5) {
        alerts.push({
          address,
          healthFactor: hfValue,
          severity: hfValue < 1.1 ? 'CRITICAL' : 'WARNING'
        });
      }
    }
    
    if (alerts.length > 0) {
      await this.sendAlerts(alerts);
    }
    
    return alerts;
  }
  
  async sendAlerts(alerts) {
    for (const alert of alerts) {
      console.log(`⚠️  ${alert.severity}: Address ${alert.address} HF: ${alert.healthFactor}`);
      
      // Send email/telegram/etc
      if (alert.severity === 'CRITICAL') {
        await this.sendNotification(alert);
      }
    }
  }
  
  startMonitoring(intervalMs = 60000) {
    console.log('Starting risk monitor...');
    setInterval(() => this.checkAllPositions(), intervalMs);
  }
}

// Usage
const monitor = new RiskMonitor(provider, ['0xUser1...', '0xUser2...']);
monitor.startMonitoring();
```

---

## More Examples

### Quick References

- **[Quick Start](quickstart.md)** - 5-minute integration
- **[Quick Reference](quick-reference.md)** - Common operations
- **[Contract Addresses](contract-addresses.md)** - Deployed contracts

### API Documentation

- **[Borrow Guide](../guides/borrow.md)** - Lending pool integration
- **[CDP Guide](../guides/mint-cdp.md)** - CDP engine integration
- **[Swap](../guides/swap.md)** & **[Liquidity](../guides/liquidity.md)** - DEX integration
- **[Bridge Guide](../guides/bridge.md)** - Cross-chain bridge integration
- **[Rewards Guide](../guides/rewards.md)** - Rewards distribution
- **[API Overview](../reference/api.md)** - General API patterns

---

## Get Help

- **Support**: [support.blockapps.net](https://support.blockapps.net)
- **Telegram**: [t.me/strato_net](https://t.me/strato_net)
- **Docs**: [docs.strato.nexus](https://docs.strato.nexus)
