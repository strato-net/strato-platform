# Mercata Bridge Security Audit - Chapter 8: High-Volatility & External-Asset Risk

**Audit Date:** July 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge and broader Mercata ecosystem lack **critical risk management mechanisms** for handling high-volatility scenarios and external asset risks. The analysis reveals **CRITICAL vulnerabilities** in price-aware controls, oracle manipulation protection, liquidity coverage, and cross-margin risk management that could lead to systemic failures during market stress events.

---

## 🔥 Price-Aware Controls Analysis

### ❌ **NO PRICE DEVIATION CIRCUIT BREAKERS** [Critical]

**Current Implementation:**
- **No Price Monitoring**: Bridge operations continue regardless of asset price volatility
- **No TWAP Integration**: No Time-Weighted Average Price mechanisms for smoothing price shocks
- **No Oracle Deviation Triggers**: No automatic halt when prices deviate beyond reasonable thresholds
- **No Mint/Redemption Freezing**: Bridge cannot halt operations during extreme price movements

**Evidence of Missing Price Controls:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123
function confirmDeposit(string txHash, address token, address to, uint256 amount, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.INITIATED, "BAD_STATE");
    Token(token).mint(mercataUser, amount); // ❌ No price deviation checks
    depositStatus[txHash] = DepositState.COMPLETED;
}
```

**Oracle Price Implementation:**
```solidity
// mercata/contracts/concrete/Lending/PriceOracle.sol:68-73
function getAssetPrice(address asset) external view returns (uint256) {
    uint256 price = prices[asset];
    require(price > 0, "Price not available");
    return price; // ❌ No price bounds or deviation checks
}
```

**Missing Price-Aware Infrastructure:**
```solidity
// ❌ No such functionality exists
contract PriceDeviationGuard {
    struct PriceThreshold {
        uint256 minPrice;           // Minimum acceptable price (18 decimals)
        uint256 maxPrice;           // Maximum acceptable price (18 decimals)
        uint256 maxDeviationBps;    // Maximum deviation from TWAP in basis points
        uint256 twapWindow;         // TWAP calculation window in seconds
        bool circuitBreakerActive;  // Whether circuit breaker is triggered
    }
    
    mapping(address => PriceThreshold) public priceThresholds;
    mapping(address => bool) public assetsHalted;
    
    modifier priceGuarded(address asset, uint256 currentPrice) {
        require(!assetsHalted[asset], "Asset halted due to price volatility");
        require(_isPriceWithinBounds(asset, currentPrice), "Price deviation too high");
        _;
    }
    
    function _isPriceWithinBounds(address asset, uint256 currentPrice) internal view returns (bool) {
        PriceThreshold memory threshold = priceThresholds[asset];
        
        // Check absolute bounds
        if (currentPrice < threshold.minPrice || currentPrice > threshold.maxPrice) {
            return false;
        }
        
        // Check TWAP deviation
        uint256 twapPrice = _calculateTWAP(asset, threshold.twapWindow);
        uint256 deviation = _calculateDeviation(currentPrice, twapPrice);
        
        return deviation <= threshold.maxDeviationBps;
    }
}
```

**Critical Missing Features:**
- ❌ **Circuit Breaker Triggers**: No automatic halt on >30-50% daily moves
- ❌ **TWAP Integration**: No smoothing of price volatility
- ❌ **Slow Path Switching**: No fallback to delayed execution during volatility
- ❌ **Asset-Specific Controls**: No per-token price monitoring
- ❌ **Cross-Reference Validation**: No comparison against multiple oracle sources

---

## 📊 Liquidity Coverage Analysis

### ❌ **NO LIQUIDITY RISK MANAGEMENT** [High]

**Current State:**
- **No VaR Calculations**: No Value-at-Risk modeling for extreme market movements
- **No Exposure Caps**: No limits on per-asset or per-chain bridge exposure
- **No Stress Testing**: No modeling of ≥30-50% daily price movements
- **No Liquidity Monitoring**: No tracking of locked vs available liquidity

**Missing Liquidity Risk Infrastructure:**
```solidity
// ❌ No such risk management exists
contract LiquidityRiskManager {
    struct AssetExposure {
        uint256 totalBridged;          // Total amount bridged to STRATO
        uint256 totalLocked;           // Total amount locked on Ethereum
        uint256 maxExposureLimit;      // Maximum allowed exposure
        uint256 utilizationRate;       // Current utilization percentage
        uint256 liquidityBuffer;       // Required liquidity buffer
        uint256 varEstimate;           // Value-at-Risk estimate (99% confidence)
    }
    
    mapping(address => AssetExposure) public assetExposures;
    
    function calculateVaR(address asset, uint256 confidenceLevel) external view returns (uint256) {
        // Monte Carlo simulation or historical volatility-based VaR calculation
        // Should model extreme scenarios (Black Swan events)
    }
    
    function checkExposureLimit(address asset, uint256 newAmount) external view returns (bool) {
        AssetExposure memory exposure = assetExposures[asset];
        return (exposure.totalBridged + newAmount) <= exposure.maxExposureLimit;
    }
    
    function isLiquidityAdequate(address asset) external view returns (bool) {
        AssetExposure memory exposure = assetExposures[asset];
        uint256 availableLiquidity = exposure.totalLocked;
        uint256 requiredLiquidity = exposure.totalBridged + exposure.liquidityBuffer;
        return availableLiquidity >= requiredLiquidity;
    }
}
```

**Current Bridge State Analysis:**
```javascript
// mercata/Audit/0) Scoping & Threat Model.md:84-88
// Token Mapping:
// ETH: 0x0000...0000 → 0x93fb7295859b2d70199e0a4883b7c320cf874e6c  
// USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 → 0x3d351a4a339f6eef7371b0b1b025b3a434ad0399
```

**Missing Stress Test Scenarios:**
1. **ETH Flash Crash**: 50% price drop within 1 hour
2. **USDC Depeg Event**: Price falls to $0.85-0.90 range
3. **Liquidity Crisis**: Mass redemption requests exceeding Safe wallet balance
4. **Oracle Failure**: Price feeds become stale or manipulated during volatility
5. **Cross-Chain Congestion**: Ethereum network becomes unusable due to high gas fees

**Risk Assessment - No Current Protections:**
- **Unlimited Minting**: Relayer can mint unbacked tokens during price crashes
- **No Exposure Limits**: No caps on total bridged value per asset
- **No Stress Buffers**: No liquidity reserves for extreme scenarios
- **No Risk Monitoring**: No real-time tracking of system-wide exposure

---

## 💰 Stablecoin Depeg Playbooks

### ❌ **NO STABLECOIN RISK MANAGEMENT** [High]

**Current Stablecoin Support:**
- **USDC**: Primary supported stablecoin (6 decimals on Ethereum, 18 on STRATO)
- **USDT**: Configured in oracle feeds but not active in bridge
- **No Other Stables**: No DAI, FRAX, or algorithmic stablecoins

**Missing Depeg Protection:**
```javascript
// ❌ No such depeg detection exists
class StablecoinDepegMonitor {
  constructor() {
    this.depegThresholds = {
      'USDC': { minPrice: 0.95, maxPrice: 1.05, warningThreshold: 0.98 },
      'USDT': { minPrice: 0.95, maxPrice: 1.05, warningThreshold: 0.98 },
      'DAI': { minPrice: 0.95, maxPrice: 1.05, warningThreshold: 0.98 }
    };
  }
  
  async checkDepegStatus(stablecoin) {
    const currentPrice = await this.fetchPrice(stablecoin);
    const threshold = this.depegThresholds[stablecoin];
    
    if (currentPrice < threshold.minPrice || currentPrice > threshold.maxPrice) {
      await this.triggerDepegResponse(stablecoin, currentPrice);
    }
  }
  
  async triggerDepegResponse(stablecoin, price) {
    // 1. Auto-downgrade risky stables
    await this.downgradeStablecoin(stablecoin);
    
    // 2. Halt affected routes  
    await this.haltBridgeRoutes(stablecoin);
    
    // 3. Communicate recovery paths
    await this.notifyUsers(stablecoin, price);
  }
}
```

**Current Oracle Configuration:**
```json
// mercata/services/oracle/src/config/feeds.json:39-47
{
  "name": "USDC-USD",
  "source": "Alchemy", 
  "targetAssetAddress": "3d351a4a339f6eef7371b0b1b025b3a434ad0399",
  "cron": "4 */1 * * *", // ❌ Only hourly updates, too slow for depeg events
  "apiParams": {
    "tokenAddress": "0xA0b86991c6218b36a1d19D4a2e9Eb0cE3606eB48"
  }
}
```

**Missing Stablecoin Safeguards:**
- ❌ **Real-time Depeg Detection**: No sub-minute price monitoring for stables
- ❌ **Automatic Route Halting**: No ability to pause specific stablecoin bridges
- ❌ **User Recovery Paths**: No clear procedures for users during depeg events
- ❌ **Risk Tier Classification**: No tiering of stablecoins by risk profile
- ❌ **Cross-Stable Arbitrage**: No mechanisms to handle price divergence between stables
- ❌ **Depeg Insurance**: No protection or compensation for users affected by depegs

**Depeg Scenarios - No Current Protections:**
1. **USDC Banking Crisis**: Centre freezes USDC, price crashes to $0.70
2. **Regulatory Action**: USDC becomes non-transferable in certain jurisdictions
3. **Technical Failure**: USDC smart contract gets exploited, confidence collapses
4. **Competition**: New stablecoin gains dominance, USDC loses peg temporarily

---

## 🔮 Oracle Latency & Manipulation Analysis

### ⚠️ **BASIC ORACLE WITH LIMITED PROTECTION** [High]

**Current Oracle Implementation:**
- **Single Source Per Asset**: Each asset relies on one API source (Alchemy or Metals.dev)
- **Hourly Updates**: Price feeds updated every hour via cron jobs
- **Basic Staleness Check**: `isPriceFresh()` function available but not enforced
- **No Aggregation**: No cross-reference between multiple oracle sources

**Oracle Configuration Analysis:**
```solidity
// mercata/contracts/concrete/Lending/PriceOracle.sol:88-92
function isPriceFresh(address asset, uint256 maxAge) external view returns (bool) {
    if (prices[asset] == 0) return false;
    return (block.timestamp - lastUpdated[asset]) <= maxAge; // ✅ Basic staleness check
}
```

**Oracle Update Process:**
```typescript
// mercata/services/oracle/src/config/feeds.json:3-11
{
  "name": "ETH-USD",
  "source": "Alchemy",
  "cron": "0 */1 * * *", // ❌ Only hourly updates
  "apiParams": {
    "tokenAddress": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
  }
}
```

**Missing Oracle Protections:**
```solidity
// ❌ No such protection exists
contract OracleManipulationGuard {
    struct OracleConfig {
        address[] primarySources;      // Multiple oracle sources
        address[] fallbackSources;     // Backup oracles
        uint256 maxPriceDeviation;     // Max allowed deviation between sources
        uint256 maxStaleness;          // Maximum age before price is stale
        uint256 minSources;            // Minimum sources required for valid price
        bool useMedian;                // Use median instead of average
    }
    
    mapping(address => OracleConfig) public oracleConfigs;
    
    function getAggregatedPrice(address asset) external view returns (uint256, bool) {
        OracleConfig memory config = oracleConfigs[asset];
        uint256[] memory prices = new uint256[](config.primarySources.length);
        uint256 validSources = 0;
        
        // Fetch prices from all sources
        for (uint256 i = 0; i < config.primarySources.length; i++) {
            (uint256 price, bool isValid) = _fetchPrice(config.primarySources[i], asset);
            if (isValid && !_isStale(asset, config.maxStaleness)) {
                prices[validSources] = price;
                validSources++;
            }
        }
        
        require(validSources >= config.minSources, "Insufficient valid oracle sources");
        
        uint256 aggregatedPrice = config.useMedian ? 
            _calculateMedian(prices, validSources) : 
            _calculateAverage(prices, validSources);
            
        bool isManipulated = _detectManipulation(prices, validSources, config.maxPriceDeviation);
        
        return (aggregatedPrice, !isManipulated);
    }
}
```

**Current Oracle Vulnerabilities:**
1. **Single Point of Failure**: Alchemy API downtime breaks all price feeds
2. **Hourly Updates**: Too slow for volatile market conditions
3. **No Cross-Validation**: Cannot detect manipulated prices
4. **No Staleness Enforcement**: Contracts don't check if prices are fresh
5. **No Kill Switch**: Cannot halt operations on stale/manipulated data

**Missing Oracle Features:**
- ❌ **Multiple Source Aggregation**: No redundancy across oracle providers
- ❌ **Staleness Bounds Enforcement**: No automatic rejection of stale prices
- ❌ **On-Chain TWAP**: No time-weighted averaging of price data
- ❌ **Governance Override Protection**: Owner can immediately replace oracle without delay
- ❌ **Manipulation Detection**: No statistical analysis for price anomalies

---

## ⏱️ Rate-Limited Redemption Analysis

### ❌ **NO WITHDRAWAL QUEUE OR RATE LIMITING** [High]

**Current Withdrawal Process:**
- **Immediate Processing**: Bridge withdrawals processed as soon as relayer confirms
- **No Queue System**: No prioritization or progressive unlock mechanisms
- **No Rate Limits**: No protection against bank-run dynamics
- **Manual Approval**: Relies on email notifications and manual Safe wallet signing

**Missing Rate Limiting Infrastructure:**
```solidity
// ❌ No such system exists
contract WithdrawalQueue {
    struct QueuedWithdrawal {
        address user;
        address token;
        uint256 amount;
        uint256 queueTime;
        uint256 unlockTime;
        uint256 priority;
        WithdrawalStatus status;
    }
    
    enum WithdrawalStatus { QUEUED, UNLOCKING, READY, EXECUTED, CANCELLED }
    
    mapping(bytes32 => QueuedWithdrawal) public withdrawalQueue;
    mapping(address => uint256) public dailyWithdrawnAmount;
    mapping(address => uint256) public lastWithdrawalReset;
    
    uint256 public constant DAILY_WITHDRAWAL_LIMIT = 1000000 * 1e18; // 1M tokens
    uint256 public constant PROGRESSIVE_UNLOCK_DURATION = 24 hours;
    uint256 public constant LARGE_WITHDRAWAL_THRESHOLD = 100000 * 1e18; // 100K tokens
    
    function requestWithdrawal(address token, uint256 amount) external returns (bytes32 queueId) {
        // Calculate unlock time based on amount and current queue
        uint256 unlockTime = _calculateUnlockTime(token, amount);
        
        queueId = keccak256(abi.encodePacked(msg.sender, token, amount, block.timestamp));
        
        withdrawalQueue[queueId] = QueuedWithdrawal({
            user: msg.sender,
            token: token,
            amount: amount,
            queueTime: block.timestamp,
            unlockTime: unlockTime,
            priority: _calculatePriority(msg.sender, amount),
            status: WithdrawalStatus.QUEUED
        });
        
        emit WithdrawalQueued(queueId, msg.sender, token, amount, unlockTime);
    }
    
    function _calculateUnlockTime(address token, uint256 amount) internal view returns (uint256) {
        // Progressive unlock: larger amounts wait longer
        if (amount >= LARGE_WITHDRAWAL_THRESHOLD) {
            return block.timestamp + PROGRESSIVE_UNLOCK_DURATION;
        }
        return block.timestamp + (PROGRESSIVE_UNLOCK_DURATION * amount) / LARGE_WITHDRAWAL_THRESHOLD;
    }
}
```

**Current Bank-Run Vulnerability:**
```javascript
// mercata/services/bridge/src/services/bridgeService.ts:89-157
export const bridgeOut = async (tokenAddress, fromAddress, amount, toAddress, userAddress) => {
  // ❌ No rate limiting or queue checks
  const generator = await safeTransactionGenerator(amount, toAddress, isERC20 ? "erc20" : "eth", ethTokenAddress);
  
  // ❌ Direct processing without considering available liquidity
  await bridgeContract.withdraw({
    txHash: hash.toString().replace("0x", ""),
    token: tokenAddress.toLowerCase().replace("0x", ""),
    from: fromAddress.toLowerCase().replace("0x", ""),
    amount: amount.toString(),
    to: toAddress.toLowerCase().replace("0x", ""),
    mercataUser: userAddress.toLowerCase().replace("0x", "")
  });
};
```

**Missing Rate Limiting Features:**
- ❌ **Progressive Unlock**: No time-based unlocking for large withdrawals
- ❌ **Priority Queue**: No prioritization system for withdrawal requests
- ❌ **Bank-Run Protection**: No circuit breakers during mass redemption events
- ❌ **Liquidity Checks**: No verification of available Ethereum-side liquidity
- ❌ **Daily Limits**: No per-user or per-asset withdrawal caps
- ❌ **Transparent Status**: No clear communication of queue position and wait times

---

## ⚗️ Cross-Margin & Cascading Risk Analysis

### 🚨 **BRIDGE TOKENS USED AS COLLATERAL - HIGH CASCADING RISK** [High]

**Bridge Token Collateral Usage:**
Bridge-issued tokens (ETHST, USDCST) are actively used as collateral in the Mercata lending system, creating significant cascading risk scenarios.

**Collateral Configuration:**
```javascript
// mercata/contracts/deploy/deployment-scripts/postRestart/initLendingContracts.js:38-43
const ETHST = process.env.ETHST_ADDRESS || "93fb7295859b2d70199e0a4883b7c320cf874e6c";
const WBTCST = process.env.WBTCST_ADDRESS || "7a99b5ba11ac280cdd5caf52c12fe89fb1b8d2f9";

const COLLATERAL_DEFAULTS = [ETHST, WBTCST, GOLDST, SILVST]; // ⚠️ Bridge tokens as collateral

// Lines 88-94: Standard collateral configuration
addConfigureAsset(asset, {
  ltv: 7500,                    // 75% loan-to-value ratio
  liquidationThreshold: 8000,   // 80% liquidation threshold  
  liquidationBonus: 10500,      // 5% liquidation bonus
  interestRate: 500,            // 5% interest rate
  reserveFactor: 1000           // 10% reserve factor
});
```

**Cascading Risk Scenarios:**

#### 1. **Bridge Halt → Collateral Crisis**
```solidity
// ❌ No such protection exists
contract BridgeCollateralGuard {
    mapping(address => bool) public isBridgeToken;
    mapping(address => bool) public bridgeHalted;
    
    modifier noBridgeCollateralWhenHalted(address collateralAsset) {
        if (isBridgeToken[collateralAsset]) {
            require(!bridgeHalted[collateralAsset], "Bridge halted: collateral frozen");
        }
        _;
    }
    
    function onBridgeHalt(address bridgeToken) external onlyBridge {
        bridgeHalted[bridgeToken] = true;
        
        // Immediate risk assessment
        uint256 affectedLoans = _countLoansWithCollateral(bridgeToken);
        uint256 totalCollateralValue = _calculateTotalCollateralValue(bridgeToken);
        
        if (totalCollateralValue > SYSTEMIC_RISK_THRESHOLD) {
            _triggerSystemWideRiskResponse();
        }
        
        emit BridgeCollateralHalted(bridgeToken, affectedLoans, totalCollateralValue);
    }
}
```

#### 2. **Price Manipulation → Mass Liquidations**
If bridge tokens experience price manipulation or artificial price inflation/deflation, users with bridge token collateral face immediate liquidation risk:

```typescript
// Current liquidation logic - no bridge-specific protection
// mercata/backend/src/api/services/lending.service.ts:564-582
const hf = calculateHealthFactor(totalCollateralValue, totalOwed.toString());
const hfPct = Number(toBig(hf)) / Number(constants.DECIMALS);
const debtLimit = hfPct <= 0.95 ? totalOwed : totalOwed / 2n; // ⚠️ No bridge halt consideration
```

#### 3. **Withdrawal Queue → Collateral Devaluation**
During bank-run scenarios, bridge tokens may lose value due to redemption pressure, triggering cascading liquidations in the lending system.

**Missing Cross-Margin Protections:**
- ❌ **Bridge Halt Impact Assessment**: No evaluation of lending system exposure when bridge halts
- ❌ **Collateral Value Adjustment**: No mechanism to adjust collateral value during bridge issues
- ❌ **Emergency Liquidation Pause**: Cannot pause liquidations when bridge tokens are affected
- ❌ **Risk Segregation**: No separation between bridge tokens and native assets in risk calculations
- ❌ **Cross-System Monitoring**: No coordinated risk management between bridge and lending systems

**Systemic Risk Assessment:**
```javascript
// ⚠️ Current system has no such monitoring
const bridgeTokenRisk = {
  ETHST: {
    totalCollateralValue: "Unknown", // No monitoring
    numberOfLoans: "Unknown",        // No tracking
    systemicRiskLevel: "HIGH",       // Bridge dependency
    emergencyProcedures: "None"      // No defined response
  },
  USDCST: {
    totalCollateralValue: "Unknown",
    numberOfLoans: "Unknown", 
    systemicRiskLevel: "HIGH",
    emergencyProcedures: "None"
  }
};
```

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **No Price Deviation Controls** - Bridge operates without circuit breakers during extreme volatility
2. **No Oracle Manipulation Protection** - Single oracle source vulnerable to manipulation
3. **Cross-Margin Cascading Risk** - Bridge token collateral creates systemic liquidation risks

### 🟡 **HIGH RISKS**  
1. **No Liquidity Risk Management** - No VaR calculations or exposure caps
2. **No Stablecoin Depeg Protection** - No automatic response to stablecoin failures
3. **No Rate-Limited Redemption** - Vulnerable to bank-run dynamics

### 🟢 **MEDIUM RISKS**
1. **Basic Oracle Staleness** - Limited but present price freshness checks
2. **Limited Asset Coverage** - Focused risk exposure to ETH and USDC only

---

## 🛠️ Recommendations

### **Priority 1 - Immediate Risk Controls**
1. **Implement Price Deviation Circuit Breakers**: Halt bridge operations during >30% daily price moves
2. **Add Oracle Manipulation Detection**: Deploy multi-source price aggregation and deviation monitoring
3. **Create Bridge-Lending Risk Isolation**: Separate risk management for bridge tokens used as collateral

### **Priority 2 - Systemic Risk Management**
1. **Deploy Liquidity Risk Monitoring**: Implement VaR calculations and exposure caps
2. **Add Stablecoin Depeg Detection**: Real-time monitoring with automatic route halting
3. **Implement Withdrawal Queue System**: Progressive unlock and rate limiting for large redemptions

### **Priority 3 - Cross-System Coordination**
1. **Bridge-Lending Risk Dashboard**: Real-time monitoring of cross-system exposures
2. **Emergency Response Procedures**: Defined protocols for bridge halts affecting lending
3. **Stress Testing Framework**: Regular testing of extreme volatility scenarios

### **Priority 4 - Advanced Risk Features**
1. **Multi-Chain Risk Aggregation**: Cross-chain exposure monitoring and limits
2. **Dynamic Risk Parameters**: Adjust lending parameters based on bridge health
3. **Insurance Integration**: Protection mechanisms for users during systemic events

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Implement basic price deviation monitoring
- [ ] Add oracle staleness enforcement to all price-dependent operations
- [ ] Create bridge token risk registry for lending system

### **Short-term (Month 1)**  
- [ ] Deploy multi-source oracle aggregation
- [ ] Implement stablecoin depeg detection system
- [ ] Add emergency circuit breakers for extreme volatility

### **Medium-term (Month 3)**
- [ ] Full withdrawal queue system with progressive unlock
- [ ] Cross-margin risk monitoring dashboard
- [ ] Comprehensive stress testing framework

### **Long-term (Month 6)**
- [ ] Advanced VaR modeling and liquidity risk management
- [ ] Automated cross-system risk response protocols
- [ ] Insurance and protection mechanisms for users

---

**Conclusion:** The Mercata Bridge and ecosystem face significant systemic risks from external asset volatility and cross-margin exposure. The use of bridge tokens as collateral in the lending system creates cascading failure risks that require immediate attention and comprehensive risk management frameworks to achieve production readiness. 