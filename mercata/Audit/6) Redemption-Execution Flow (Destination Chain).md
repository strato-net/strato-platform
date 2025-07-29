# Mercata Bridge Security Audit - Chapter 6: Redemption/Execution Flow (Destination Chain)

**Audit Date:** January 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge's redemption/execution flow on the destination chain (STRATO) lacks **fundamental security verification mechanisms** required for production bridge operations. The analysis reveals **CRITICAL vulnerabilities** including complete absence of cryptographic proof verification, inadequate token quirk handling, missing circuit breakers, and insufficient recipient protection mechanisms.

---

## 🔍 Proof Verification Analysis

### ❌ **NO CRYPTOGRAPHIC PROOF VERIFICATION** [Critical]

**Current Implementation:**
- **No Attestation Verification**: Bridge relies entirely on relayer trust without cryptographic proofs
- **No Light-Client Proofs**: No verification against origin chain state or block headers
- **No Domain Separation**: Missing chain ID and contract address verification in proofs
- **No Event Field Verification**: No validation of origin event data against execution parameters

**Current "Verification" Process:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123
function confirmDeposit(string txHash, address token, address to, uint256 amount, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.INITIATED, "BAD_STATE");
    require(tokenFactory.isTokenActive(token), "INACTIVE_TOKEN");

    Token(token).mint(mercataUser, amount); // ⚠️ No proof verification
    depositStatus[txHash] = DepositState.COMPLETED;
    emit DepositCompleted(txHash);
}
```

**Missing Proof Infrastructure:**
```solidity
// ❌ No such verification exists
function verifyProof(
    bytes32 originEventHash,
    uint256 originChainId,
    address originBridge,
    bytes32[] merkleProof,
    bytes32 blockHash,
    uint256 logIndex
) internal pure returns (bool) {
    // Merkle proof verification against origin chain state
    // Domain separation validation 
    // Event field verification
    // Not implemented
}
```

**Security Implications:**
- **Complete Trust Reliance**: Users must trust single relayer with no cryptographic guarantees
- **No Origin Verification**: No proof that origin deposit actually occurred
- **Fabricated Transactions**: Relayer can mint tokens for non-existent deposits
- **Cross-Chain Inconsistency**: No guarantee of 1:1 correspondence with origin events

**Evidence from Previous Analysis:**
```markdown
// mercata/Audit/2) Cryptography, Validation & Relayers.md:17-41
### ❌ **NO CRYPTOGRAPHIC ATTESTATION** [Critical]
- **Simple Address-Based Authentication**: Uses basic onlyRelayer modifier
- **No Threshold Signatures**: Single relayer with complete authority
- **No MPC/TSS**: No multi-party computation or threshold signature schemes
```

---

## 🔂 Idempotency Analysis

### ✅ **BASIC STATE MACHINE PROTECTION** [Adequate with Limitations]

**Current Implementation:**
- **State Tracking**: Uses depositStatus mapping to prevent duplicate execution
- **Sequential Requirements**: Requires INITIATED state before COMPLETED execution  
- **Transaction Hash Keying**: Prevents same txHash from being processed twice

**Idempotency Protection:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:54-55
enum DepositState { NONE, INITIATED, COMPLETED }
mapping(string => DepositState) public record depositStatus;

// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123
function confirmDeposit(string txHash, ...) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.INITIATED, "BAD_STATE"); // ✅ Prevents double execution
    
    Token(token).mint(mercataUser, amount);
    depositStatus[txHash] = DepositState.COMPLETED; // ✅ Marks as completed
    emit DepositCompleted(txHash);
}
```

**Batch Processing Protection:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:125-135
function batchConfirmDeposits(DepositBatch[] deposits) external onlyRelayer {
    for (uint256 i = 0; i < deposits.length; i++) {
        DepositBatch d = deposits[i];
        require(depositStatus[d.txHash] == DepositState.INITIATED, "BAD_STATE"); // ✅ Individual checks
        
        Token(address(d.token)).mint(address(d.mercataUser), d.amount);
        depositStatus[d.txHash] = DepositState.COMPLETED;
        emit DepositCompleted(d.txHash);
    }
}
```

**Strengths:**
- ✅ **Prevents Double Execution**: State machine prevents same transaction from being executed twice
- ✅ **Atomic State Updates**: State change occurs in same transaction as minting
- ✅ **Batch Safety**: Each item in batch individually validated

**Limitations:**
- ⚠️ **Hash Collision Vulnerability**: Relies on transaction hash uniqueness
- ⚠️ **Cross-Chain Replay**: Same hash could be valid on different chains
- ⚠️ **State Machine Simplicity**: Basic enum without advanced failure recovery

---

## 💰 Amount Correctness Analysis

### ⚠️ **DIRECT 1:1 MINTING WITHOUT FEE HANDLING** [Critical]

**Current Implementation:**
- **Direct Amount Minting**: Mints exact amount specified without fee deduction
- **No Fee Accounting**: Bridge operations don't handle explicit fees
- **Basic Overflow Protection**: Relies on underlying ERC20 overflow protection
- **No Decimal Conversion**: Assumes same decimals on both chains

**Amount Handling:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:120
Token(token).mint(mercataUser, amount); // ⚠️ Direct minting without fee deduction
```

**Underlying Mint Protection:**
```solidity
// mercata/contracts/abstract/ERC20/ERC20.sol:207-210
function _mint(address accountAddress, uint256 value) internal {
    require(accountAddress != address(0), "ERC20: mint to the zero address"); // ✅ Zero address check
    _update(address(0), accountAddress, value);
}

// mercata/contracts/abstract/ERC20/ERC20.sol:175-196
function _update(address from, address to, uint256 value) internal virtual {
    if (from == address(0)) {
        _totalSupply += value; // ⚠️ Basic overflow protection from Solidity ^0.8.0
    }
    // ...
}
```

**Token Factory Decimal Handling:**
```solidity
// mercata/contracts/concrete/Tokens/Token.sol:95-97
function decimals() external view virtual override returns (uint8) {
    return customDecimals; // ✅ Configurable decimals per token
}
```

**Issues Identified:**
- ❌ **No Fee Deduction**: Bridge doesn't account for fees in minted amounts
- ❌ **No Rounding Logic**: No explicit rounding for decimal conversions
- ❌ **Missing Amount Validation**: No minimum/maximum amount checks beyond minAmount
- ❌ **No Decimal Consistency Checks**: No verification of decimal matching between chains

**Missing Fee Implementation:**
```solidity
// ❌ Should be implemented
function calculateNetAmount(uint256 grossAmount, uint256 bridgeFee) internal pure returns (uint256) {
    require(grossAmount >= bridgeFee, "Insufficient amount for fees");
    return grossAmount - bridgeFee;
}
```

---

## 🪙 Token Quirks Analysis

### ❌ **NO NON-STANDARD TOKEN SUPPORT** [High]

**Current Implementation:**
- **Standard ERC-20 Only**: Bridge assumes all tokens follow standard ERC-20 behavior
- **No Return Value Checking**: Doesn't handle tokens that return false or no return value
- **No Fee-on-Transfer Support**: Assumes transferFrom transfers exact amount
- **No Rebasing/Staking Derivative Support**: No handling of elastic supply tokens

**Standard Token Operations:**
```solidity
// mercata/contracts/concrete/Tokens/Token.sol:66-72
function mint(address to, uint256 amount) external {
    require(
        TokenAccess(this).isMinter(msg.sender), 
        "Token: Caller is not a minter"
    );
    _mint(to, amount); // ✅ Standard minting
}
```

**Missing Non-Standard Token Handling:**
```solidity
// ❌ No such functionality exists
function safeMintWithBalanceCheck(address token, address to, uint256 amount) internal returns (uint256 actualMinted) {
    uint256 balanceBefore = IERC20(token).balanceOf(to);
    Token(token).mint(to, amount);
    uint256 balanceAfter = IERC20(token).balanceOf(to);
    actualMinted = balanceAfter - balanceBefore;
    require(actualMinted > 0, "No tokens minted");
}

function handleRebasingToken(address token, uint256 amount) internal returns (uint256 normalizedAmount) {
    // Handle rebasing token conversion
    // Not implemented
}
```

**Unsupported Token Types:**
- ❌ **Fee-on-Transfer Tokens**: Tokens that deduct fees during transfers (e.g., SAFEMOON)
- ❌ **Rebasing Tokens**: Tokens with elastic supply (e.g., AMPL, LIDO)
- ❌ **Deflationary Tokens**: Tokens that burn on transfer
- ❌ **Non-Standard Return Tokens**: Tokens that return false or no value
- ❌ **Staking Derivatives**: LSTs/LRTs with changing redemption rates
- ❌ **Pausable Tokens**: Tokens that can halt transfers

**Evidence from Previous Analysis:**
```markdown
// mercata/Audit/4) Deposit Flow (Origin Chain).md:43-47
**Vulnerable Token Types:**
- ❌ **Fee-on-Transfer Tokens**: Tokens that deduct fees during transfers
- ❌ **Rebasing Tokens**: Tokens with elastic supply that changes balances
- ❌ **Deflationary Tokens**: Tokens that burn on transfer
```

---

## 👤 Recipient Handling Analysis

### ⚠️ **BASIC RECIPIENT VALIDATION ONLY** [High]

**Current Implementation:**
- **Zero Address Protection**: ERC20 _mint function prevents minting to zero address
- **No Contract vs EOA Differentiation**: Same handling for contracts and externally owned accounts
- **No SafeTransfer Semantics**: Direct minting without callback protection
- **No Rejection Path Handling**: No refund mechanisms for failed deliveries

**Recipient Validation:**
```solidity
// mercata/contracts/abstract/ERC20/ERC20.sol:207-210
function _mint(address accountAddress, uint256 value) internal {
    require(accountAddress != address(0), "ERC20: mint to the zero address"); // ✅ Basic validation
    _update(address(0), accountAddress, value);
}
```

**Bridge Recipient Usage:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:120
Token(token).mint(mercataUser, amount); // ⚠️ Direct mint to mercataUser without additional checks
```

**Missing Recipient Protections:**
```solidity
// ❌ No such functionality exists
function safeMintToRecipient(address token, address recipient, uint256 amount) internal {
    // Check if recipient is contract
    if (isContract(recipient)) {
        // Attempt callback if ERC1363 receiver
        try IERC1363Receiver(recipient).onTransferReceived(...) returns (bytes4 response) {
            if (response != IERC1363Receiver.onTransferReceived.selector) {
                revert("ERC1363: transfer to non ERC1363Receiver implementer");
            }
        } catch (bytes memory reason) {
            // Handle callback failure with refund
            _refundToOriginalDepositor(txHash, token, amount);
        }
    }
    
    Token(token).mint(recipient, amount);
}

function _refundToOriginalDepositor(string txHash, address token, uint256 amount) internal {
    // Refund mechanism not implemented
}
```

**Missing Features:**
- ❌ **Contract Detection**: No differentiation between contracts and EOAs
- ❌ **Callback Support**: No ERC1363 or similar callback mechanisms
- ❌ **Rejection Handling**: No refund paths for failed deliveries
- ❌ **Gas Stipend Protection**: No protection against gas griefing attacks
- ❌ **Recipient Validation**: No blacklist or validation of recipient addresses
- ❌ **Multi-Signature Recipients**: No support for multisig recipient verification

**Risks:**
- **Lost Tokens**: Tokens minted to incorrect or inaccessible addresses cannot be recovered
- **Contract Incompatibility**: Tokens minted to contracts that don't expect them
- **Gas Griefing**: Malicious contracts could drain gas during callbacks (if implemented)

---

## 🛑 Pause/Rate-Limit Analysis

### ❌ **NO CIRCUIT BREAKERS OR RATE LIMITING** [High]

**Current Implementation:**
- **No Pause Functionality**: Bridge cannot be paused during emergencies
- **No Rate Limiting**: No limits on transaction size, frequency, or volume
- **No TVL-Based Throttles**: No dynamic limits based on total value locked
- **No Oracle-Based Circuit Breakers**: No automated pause triggers from oracle deviations

**Missing Pause Infrastructure:**
```solidity
// ❌ Bridge contract does NOT inherit from Pausable
contract record MercataEthBridge is Ownable {
    // No pause modifiers on critical functions
    function confirmDeposit(...) external onlyRelayer {
        // ⚠️ Should have: whenNotPaused modifier
    }
}
```

**Available but Unused Pause Infrastructure:**
```solidity
// mercata/contracts/abstract/ERC20/extensions/ERC20Pausable.sol:22-33
abstract contract ERC20Pausable is ERC20, Pausable {
    function _update(address from, address to, uint256 value) internal virtual override whenNotPaused {
        super._update(from, to, value);
    }
}
```

**Missing Rate Limiting:**
```solidity
// ❌ No such functionality exists
struct RateLimit {
    uint256 maxAmountPerInterval;
    uint256 maxTransactionsPerInterval;
    uint256 intervalDuration;
    uint256 currentPeriodStart;
    uint256 currentPeriodAmount;
    uint256 currentPeriodTxCount;
}

mapping(address => RateLimit) public assetRateLimits;

modifier withinRateLimit(address token, uint256 amount) {
    RateLimit storage limit = assetRateLimits[token];
    
    // Reset period if needed
    if (block.timestamp >= limit.currentPeriodStart + limit.intervalDuration) {
        limit.currentPeriodStart = block.timestamp;
        limit.currentPeriodAmount = 0;
        limit.currentPeriodTxCount = 0;
    }
    
    require(limit.currentPeriodAmount + amount <= limit.maxAmountPerInterval, "Rate limit exceeded");
    require(limit.currentPeriodTxCount < limit.maxTransactionsPerInterval, "Transaction limit exceeded");
    
    limit.currentPeriodAmount += amount;
    limit.currentPeriodTxCount++;
    _;
}
```

**Missing Circuit Breaker Features:**
- ❌ **Per-Asset Pause**: Cannot pause specific tokens while maintaining others
- ❌ **Directional Pause**: Cannot pause minting while allowing burning
- ❌ **Amount-Based Limits**: No maximum single transaction or hourly limits
- ❌ **TVL-Based Throttles**: No dynamic limits based on bridge reserves
- ❌ **Oracle Deviation Triggers**: No automatic pause on price anomalies
- ❌ **Velocity Limits**: No protection against rapid large-volume attacks
- ❌ **Emergency Pause**: No ability to immediately halt operations

**Evidence from Previous Analysis:**
```markdown
// mercata/Audit/1) Architecture & Invariants.md:166-207
### ❌ **NO CIRCUIT BREAKERS IMPLEMENTED** [High]
- **No Pause Mechanism**: Bridge contract lacks pause functionality
- **Continuous Operation**: Bridge continues operating during failures
- **No Rate Limiting**: No transaction size or frequency limits
```

---

## 🚨 Critical Recommendations

### **Immediate Actions Required:**

1. **Implement Basic Circuit Breakers:**
   ```solidity
   import "@openzeppelin/contracts/security/Pausable.sol";
   
   contract MercataEthBridge is Ownable, Pausable {
       function confirmDeposit(...) external onlyRelayer whenNotPaused {
           // Protected execution
       }
       
       function emergencyPause() external onlyOwner {
           _pause();
       }
   }
   ```

2. **Add Amount-Based Rate Limiting:**
   ```solidity
   mapping(address => uint256) public dailyMinted;
   mapping(address => uint256) public lastResetTime;
   uint256 public constant DAILY_MINT_LIMIT = 1000000 * 1e18; // 1M tokens
   
   modifier rateLimited(address token, uint256 amount) {
       if (block.timestamp > lastResetTime[token] + 1 days) {
           dailyMinted[token] = 0;
           lastResetTime[token] = block.timestamp;
       }
       require(dailyMinted[token] + amount <= DAILY_MINT_LIMIT, "Daily limit exceeded");
       dailyMinted[token] += amount;
       _;
   }
   ```

3. **Add Recipient Validation:**
   ```solidity
   function safeMint(address token, address recipient, uint256 amount) internal {
       require(recipient != address(0), "Invalid recipient");
       require(recipient != address(this), "Cannot mint to bridge");
       Token(token).mint(recipient, amount);
   }
   ```

### **Medium-Term Improvements:**

1. **Implement Cryptographic Proof Verification**
2. **Add Support for Non-Standard Token Types**
3. **Create Oracle-Based Circuit Breakers**
4. **Implement Fee Handling and Accounting**

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **No Proof Verification** - Complete reliance on relayer trust without cryptographic guarantees
2. **No Circuit Breakers** - Bridge cannot be paused during emergencies or attacks
3. **Missing Fee Accounting** - Direct 1:1 minting without proper fee deduction

### 🟡 **HIGH RISKS**
1. **No Non-Standard Token Support** - Vulnerable to fee-on-transfer and rebasing tokens
2. **Basic Recipient Handling** - No refund mechanisms or contract compatibility checks
3. **No Rate Limiting** - Vulnerable to large-scale drain attacks

### 🟢 **MEDIUM RISKS**
1. **Simple Idempotency** - Basic but functional double-execution protection
2. **Amount Correctness** - Generally correct but missing edge case handling

---

**End of Chapter 6 Analysis**

*Severity: CRITICAL - Multiple fundamental security mechanisms missing from execution flow* 