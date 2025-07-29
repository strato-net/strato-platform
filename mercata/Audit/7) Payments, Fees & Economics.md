# Mercata Bridge Security Audit - Chapter 7: Payments, Fees & Economics

**Audit Date:** January 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge lacks **fundamental economic security mechanisms** and fee structures required for production bridge operations. The analysis reveals **CRITICAL gaps** in fee transparency, accounting systems, gas price protection, MEV resistance, refund mechanisms, and relayer economic incentives that create significant operational and security risks.

---

## 💰 Fee Schedule Clarity Analysis

### ❌ **NO BRIDGE-SPECIFIC FEE STRUCTURE** [Medium]

**Current Implementation:**
- **No Explicit Bridge Fees**: Bridge operations do not charge users any fees for deposits or withdrawals
- **No Fee Transparency**: Users cannot see fee breakdown at quote time
- **Missing Fee Categories**: No origin fee, destination fee, or relayer fee structure
- **No Gas Abstraction**: Users pay Ethereum gas directly without abstraction layer

**Bridge Fee Evidence:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:48
uint256 public minAmount = 0; // ❌ Only dust protection, no fees

// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123
function confirmDeposit(...) external onlyRelayer {
    Token(token).mint(mercataUser, amount); // ❌ Direct 1:1 minting without fee deduction
}
```

**Gas Pricing Structure:**
```typescript
// mercata/services/bridge/src/utils/contractCall.ts:24-28
txParams: {
  gasLimit: 150000,        // ❌ Fixed gas limit
  gasPrice: 30000000000,   // ❌ Fixed gas price (30 Gwei)
}
```

**Missing Fee Infrastructure:**
```solidity
// ❌ No such fee structure exists
struct BridgeFeeSchedule {
    uint256 originFeeFlat;      // Flat fee on origin chain
    uint256 originFeeBps;       // Basis points fee on origin chain
    uint256 destinationFeeFlat; // Flat fee on destination chain  
    uint256 destinationFeeBps;  // Basis points fee on destination chain
    uint256 relayerFeeBps;      // Relayer compensation in basis points
    uint256 gasAbstractionFee;  // Fee for gas abstraction service
}

function calculateTotalFees(uint256 amount, address token) external view returns (
    uint256 totalFees,
    uint256 netAmount,
    BridgeFeeBreakdown memory breakdown
);
```

**Impact of Missing Fee Structure:**
- **No Revenue Model**: Bridge operates without sustainable economic model
- **No User Protection**: Users unaware of true bridge costs
- **No Relayer Compensation**: No economic incentive for relayer operations
- **Gas Risk Exposure**: Users fully exposed to Ethereum gas volatility

---

## 📊 Fee Accounting Analysis

### ❌ **NO DEDICATED FEE ACCOUNTING SYSTEM** [High]

**Current State:**
- **No Fee Vaults**: Bridge has no dedicated contracts for fee collection
- **No Reconciliation**: No periodic auditing of fee collection vs bridge operations
- **No Hidden Mint/Burn Proofs**: No mathematical verification that fees cannot become unbacked tokens

**Missing Fee Vault Infrastructure:**
```solidity
// ❌ No such contract exists for bridge
contract BridgeFeeVault {
    mapping(address => uint256) public collectedFees;      // Per-token fee collection
    mapping(address => uint256) public distributedFees;    // Per-relayer fee distribution
    mapping(address => uint256) public protocolReserves;   // Protocol treasury allocation
    
    function collectOriginFee(address token, uint256 amount) external onlyBridge;
    function collectDestinationFee(address token, uint256 amount) external onlyBridge;
    function distributeRelayerFees(address relayer, address token, uint256 amount) external;
    function reconcileFees(address token) external view returns (bool balanced);
}
```

**Comparison with Other Platform Components:**
```solidity
// ✅ Other platform components have proper fee accounting
// mercata/contracts/concrete/Admin/FeeCollector.sol:26-33
function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
    require(ERC20(token).balanceOf(address(this)) >= amount, "FeeCollector: insufficient balance");
    require(ERC20(token).transfer(to, amount), "FeeCollector: transfer failed");
    emit Withdrawn(token, to, amount);
}
```

**Missing Reconciliation Mechanisms:**
```solidity
// ❌ No such validation exists
function validateFeeInvariant(address token) external view returns (bool) {
    uint256 totalFeesCollected = bridgeFeeVault.collectedFees(token);
    uint256 totalFeesDistributed = bridgeFeeVault.distributedFees(token);
    uint256 vaultBalance = IERC20(token).balanceOf(address(bridgeFeeVault));
    
    // Verify: collected_fees = distributed_fees + vault_balance
    return totalFeesCollected == totalFeesDistributed + vaultBalance;
}
```

**Security Implications:**
- **No Fee Verification**: Cannot prove fees are not being used to mint unbacked tokens
- **No Audit Trail**: No record of fee collection and distribution
- **No Transparency**: Fee flows are invisible to users and auditors

---

## ⛽ Dynamic Gas Pricing Analysis

### ❌ **FIXED GAS PARAMETERS ONLY** [Medium]

**Current Implementation:**
- **Static Gas Price**: Hardcoded 30 Gwei gas price regardless of network conditions
- **Fixed Gas Limit**: Static 150,000 gas limit without optimization
- **No Fallback Mechanisms**: No queuing system for high gas periods
- **No User Protection**: No maximum fee caps or gas spike protection

**Static Gas Configuration:**
```typescript
// mercata/services/bridge/src/utils/contractCall.ts:24-28
txParams: {
  gasLimit: 150000,        // ❌ No dynamic adjustment
  gasPrice: 30000000000,   // ❌ Fixed 30 Gwei (often too low/high)
}
```

**Missing Dynamic Gas Features:**
```typescript
// ❌ No such implementation exists
interface DynamicGasManager {
  getCurrentGasPrice(): Promise<bigint>;
  getOptimalGasLimit(operation: BridgeOperation): Promise<number>;
  calculateMaxUserFee(amount: bigint, maxGasPrice: bigint): bigint;
  queueTransactionForBetterGas(tx: BridgeTransaction): Promise<string>;
  estimateExecutionTime(gasPrice: bigint): Promise<number>;
}

class BridgeGasManager implements DynamicGasManager {
  async executeWithGasProtection(
    operation: BridgeOperation,
    maxUserGas: bigint
  ): Promise<{success: boolean, actualGasUsed: bigint, queuedForLater?: boolean}> {
    const currentGas = await this.getCurrentGasPrice();
    
    if (currentGas > maxUserGas) {
      // Queue for later execution or use fallback mechanisms
      return this.queueTransactionForBetterGas(operation);
    }
    
    return this.executeImmediately(operation, currentGas);
  }
}
```

**Gas Risk Scenarios:**
1. **Network Congestion**: 30 Gwei may be insufficient during high usage
2. **Gas Spikes**: No protection against sudden fee increases
3. **Failed Transactions**: Fixed low gas price causes transaction failures
4. **User Frustration**: No ETA or alternative execution paths

---

## 🛡️ Front-running/MEV Resistance Analysis

### ⚠️ **NO MEV PROTECTION MECHANISMS** [High]

**Current Vulnerability:**
- **No Commit-Reveal**: Bridge operations are immediately visible on-chain
- **No RFQ System**: No request-for-quote mechanism for better pricing
- **No Slippage Protection**: Bridge operates at fixed 1:1 ratios without MEV consideration
- **Public Mempool Exposure**: All transactions visible to MEV bots

**Bridge Operation Visibility:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123
function confirmDeposit(string txHash, address token, address to, uint256 amount, address mercataUser) external onlyRelayer {
    // ⚠️ All parameters visible to MEV bots
    Token(token).mint(mercataUser, amount);
    emit DepositCompleted(txHash); // ⚠️ Broadcast to all observers
}
```

**Missing MEV Protection:**
```solidity
// ❌ No such protection exists
contract BridgeMEVProtection {
    struct CommitRevealDeposit {
        bytes32 commitment;          // hash(txHash, token, amount, nonce, secret)
        uint256 commitBlock;         // Block when commitment was made
        uint256 revealDeadline;      // Block deadline for reveal
        bool revealed;               // Whether commitment was revealed
    }
    
    mapping(string => CommitRevealDeposit) public commitments;
    
    function commitDeposit(bytes32 commitment) external onlyRelayer {
        // Two-phase commit to hide parameters from MEV bots
    }
    
    function revealAndExecuteDeposit(
        string txHash,
        address token, 
        uint256 amount,
        address mercataUser,
        uint256 nonce,
        bytes32 secret
    ) external onlyRelayer {
        bytes32 commitment = keccak256(abi.encodePacked(txHash, token, amount, nonce, secret));
        require(commitments[txHash].commitment == commitment, "Invalid reveal");
        require(block.number <= commitments[txHash].revealDeadline, "Reveal deadline passed");
        
        // Execute after successful reveal
        Token(token).mint(mercataUser, amount);
    }
}
```

**MEV Attack Vectors:**
1. **Withdrawal Front-running**: MEV bots can observe withdrawal requests and front-run execution
2. **Deposit Race Conditions**: Competition for profitable bridge arbitrage opportunities  
3. **Gas Price Manipulation**: Bots can spam network to delay bridge transactions
4. **Cross-Chain Arbitrage**: MEV extraction from bridge price inefficiencies

---

## 🔄 Refunds/Shortfalls Analysis

### ❌ **NO REFUND INFRASTRUCTURE** [Medium]

**Current State:**
- **No Refund Mechanisms**: Bridge has no capability to refund failed operations
- **No Shortfall Handling**: No rules for when operations cannot complete
- **No Fee Bucket Management**: No protection against locked fee scenarios
- **No Failure Recovery**: Users cannot recover from bridge operation failures

**Missing Refund Infrastructure:**
```solidity
// ❌ No such refund system exists
contract BridgeRefundManager {
    struct RefundRequest {
        string originalTxHash;       // Original failed transaction
        address token;               // Token to refund
        uint256 amount;              // Amount to refund
        address recipient;           // Refund recipient
        uint256 requestBlock;        // Block when refund requested
        RefundReason reason;         // Categorized reason for refund
        RefundStatus status;         // Current refund status
    }
    
    enum RefundReason {
        INSUFFICIENT_LIQUIDITY,      // Not enough tokens on destination
        RECIPIENT_REJECTION,         // Recipient contract rejected transfer
        GAS_PRICE_TOO_HIGH,         // Gas exceeded user's max threshold
        TECHNICAL_FAILURE,          // Bridge system technical error
        TIMEOUT_EXCEEDED            // Operation took too long
    }
    
    enum RefundStatus { REQUESTED, APPROVED, EXECUTED, REJECTED }
    
    mapping(string => RefundRequest) public refundRequests;
    
    function requestRefund(string txHash, RefundReason reason) external;
    function approveRefund(string txHash) external onlyGovernance;
    function executeRefund(string txHash) external;
}
```

**Current Failure Scenarios:**
1. **Ethereum Deposit but STRATO Failure**: User loses funds with no recourse
2. **STRATO Burn but Ethereum Failure**: User tokens burned without Ethereum payout
3. **Gas Fee Shortfalls**: Transactions fail but fees are consumed
4. **Smart Contract Rejection**: No handling for contracts that reject transfers

**Missing User Protection:**
```solidity
// ❌ No such protection exists
function executeDepositWithProtection(
    string txHash,
    address token,
    uint256 amount,
    address recipient
) external onlyRelayer {
    // Attempt execution with built-in failure handling
    try Token(token).mint(recipient, amount) {
        depositStatus[txHash] = DepositState.COMPLETED;
        emit DepositCompleted(txHash);
    } catch (bytes memory reason) {
        // Queue for refund processing
        RefundManager(refundManager).requestRefund(
            txHash, 
            RefundReason.TECHNICAL_FAILURE
        );
        emit DepositFailed(txHash, reason);
    }
}
```

---

## 🎯 Relayer Incentive Compatibility Analysis

### ❌ **NO ECONOMIC RELAYER INCENTIVES** [High]

**Current Relayer Model:**
- **No Fee Compensation**: Relayers receive no payment for bridge operations
- **No Anti-Griefing Protection**: No deposits or escrow requirements
- **No Slashing Mechanisms**: No penalties for malicious behavior
- **No Performance Incentives**: No rewards for faster or more reliable service

**Missing Relayer Economics:**
```solidity
// ❌ No such economic model exists
contract RelayerIncentiveManager {
    struct RelayerProfile {
        uint256 stakedAmount;        // Economic security stake
        uint256 totalVolume;         // Historical bridge volume processed
        uint256 successfulOps;       // Count of successful operations
        uint256 failedOps;           // Count of failed operations
        uint256 averageTime;         // Average operation completion time
        uint256 earnedFees;          // Total fees earned
        uint256 slashedAmount;       // Total amount slashed for bad behavior
        bool active;                 // Whether relayer is active
    }
    
    mapping(address => RelayerProfile) public relayers;
    
    function stakeAsRelayer(uint256 amount) external;
    function unstakeRelayer() external;
    function distributeFees(address relayer, uint256 amount) external onlyBridge;
    function slashRelayer(address relayer, uint256 amount, SlashReason reason) external;
    function calculateRelayerFee(uint256 bridgeAmount) external view returns (uint256);
}

enum SlashReason {
    FALSE_ATTESTATION,      // Claiming non-existent deposits
    CENSORSHIP,            // Refusing to process valid requests  
    EXTENDED_DOWNTIME,     // Being offline beyond SLA
    INCORRECT_EXECUTION    // Processing with wrong parameters
}
```

**Current Economic Risks:**
1. **Negative-EV Operations**: Relayers spend gas with no compensation
2. **No Griefing Protection**: Malicious users can spam worthless operations
3. **No Performance Incentives**: No reason to provide better service
4. **Single Point of Failure**: No economic redundancy in relayer set

**Missing Performance Management:**
```typescript
// ❌ No such SLA tracking exists
interface RelayerSLAManager {
  trackOperationTime(relayer: string, txHash: string, startTime: number, endTime: number): void;
  calculateUptimeScore(relayer: string, period: number): number;
  penalizeSlowExecution(relayer: string, expectedTime: number, actualTime: number): void;
  rewardFastExecution(relayer: string, expectedTime: number, actualTime: number): void;
  
  getRelayerMetrics(relayer: string): {
    avgExecutionTime: number;
    uptimePercentage: number;
    successRate: number;
    volumeProcessed: bigint;
    feeEarnings: bigint;
  };
}
```

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **No Economic Security Model** - Bridge operates without sustainable fee structure or relayer incentives
2. **No Fee Accounting System** - Cannot verify fee integrity or prevent hidden minting
3. **No MEV Protection** - Bridge operations vulnerable to front-running and extraction

### 🟡 **HIGH/MEDIUM RISKS**  
1. **Fixed Gas Pricing** - No protection from gas volatility or network congestion
2. **No Refund Mechanisms** - Users cannot recover from failed bridge operations
3. **Missing Performance Incentives** - No economic reason for reliable relayer service

---

## 🛠️ Recommendations

### **Priority 1 - Economic Foundation**
1. **Implement Bridge Fee Structure**: Design transparent fee schedule with origin, destination, and relayer fees
2. **Deploy Fee Accounting System**: Create dedicated vaults with reconciliation mechanisms
3. **Add Relayer Economic Security**: Implement staking, bonding, and slashing for relayers

### **Priority 2 - User Protection**
1. **Dynamic Gas Management**: Implement gas price monitoring with user protection caps
2. **MEV Resistance**: Add commit-reveal or private mempool integration for sensitive operations
3. **Refund Infrastructure**: Build comprehensive refund system for failed operations

### **Priority 3 - Performance Optimization**
1. **Relayer SLA Tracking**: Monitor and incentivize relayer performance metrics
2. **Fee Optimization**: Implement dynamic fee adjustment based on network conditions
3. **Economic Monitoring**: Add dashboards for fee collection, distribution, and bridge economics

### **Priority 4 - Advanced Features**
1. **Cross-Chain Fee Abstraction**: Allow users to pay fees in any supported token
2. **Automated Market Making**: Consider AMM-style pricing for large bridge operations
3. **Economic Security Auditing**: Regular verification of fee accounting and relayer economics

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Design comprehensive bridge fee structure document
- [ ] Implement basic fee collection mechanisms
- [ ] Add minimum relayer staking requirements

### **Short-term (Month 1)**  
- [ ] Deploy dedicated fee vault contracts
- [ ] Implement dynamic gas pricing system
- [ ] Add basic refund request functionality

### **Medium-term (Month 3)**
- [ ] Full MEV protection implementation
- [ ] Complete relayer incentive system
- [ ] Comprehensive economic monitoring dashboard

### **Long-term (Month 6)**
- [ ] Advanced fee optimization algorithms
- [ ] Cross-chain fee abstraction
- [ ] Automated economic security auditing

---

**Conclusion:** The Mercata Bridge requires fundamental economic infrastructure development to achieve production readiness. The current fee-less model with unpaid relayers creates unsustainable operational risk and lacks the economic security needed for trustless bridge operations. 