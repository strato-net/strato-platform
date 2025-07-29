# Mercata Bridge Security Audit - Chapter 4: Deposit Flow (Origin Chain)

**Audit Date:** January 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge's deposit flow on the origin chain (Ethereum) lacks **fundamental security mechanisms** critical for production bridge operations. The analysis reveals **CRITICAL vulnerabilities** in token transfer handling, missing reentrancy protection, inadequate allowance patterns, and absence of advanced deposit management features.

---

## 💰 Value Received Analysis

### ❌ **NO FEE-ON-TRANSFER OR REBASING TOKEN SUPPORT** [High]

**Current Implementation:**
- **Basic Transfer Assumption**: Bridge assumes `transferFrom()` transfers exact specified amount
- **No Balance Verification**: No before/after balance checks to verify actual tokens received
- **Missing Token Type Detection**: No mechanism to identify special token types

**Standard Transfer Pattern:**
```solidity
// Standard ERC-20 pattern used in Pools (similar pattern expected in bridge)
// mercata/contracts/concrete/Pools/Pool.sol:311
require(ERC20(inputToken).transferFrom(msg.sender, address(this), amountIn), "Input transfer failed");
```

**Missing Implementation:**
```solidity
// ❌ No such verification exists in bridge operations
function verifyTransferAmount(address token, address from, uint256 expectedAmount) internal returns (uint256 actualReceived) {
    uint256 balanceBefore = IERC20(token).balanceOf(address(this));
    require(IERC20(token).transferFrom(from, address(this), expectedAmount), "Transfer failed");
    uint256 balanceAfter = IERC20(token).balanceOf(address(this));
    actualReceived = balanceAfter - balanceBefore;
    require(actualReceived > 0, "No tokens received");
}
```

**Vulnerable Token Types:**
- ❌ **Fee-on-Transfer Tokens**: Tokens that deduct fees during transfers (e.g., SAFEMOON)
- ❌ **Rebasing Tokens**: Tokens with elastic supply that changes balances (e.g., AMPL)
- ❌ **Deflationary Tokens**: Tokens that burn on transfer
- ❌ **Pausable Tokens**: Tokens that can halt transfers

**Risk Assessment:**
- **Value Mismatch**: Bridge may mint more wrapped tokens than actually received
- **Accounting Drift**: Gradual accumulation of phantom balances
- **Economic Exploit**: Attackers could use fee-on-transfer tokens to drain bridge

---

## 🔐 Allowance Safety Analysis  

### ⚠️ **BASIC ERC-20 APPROVE PATTERN** [Medium]

**Current Implementation:**
- **Standard Approve/TransferFrom**: Uses basic ERC-20 allowance mechanism
- **No SafeApprove Pattern**: Missing protection against approve race conditions
- **EIP-2612 Available but Unused**: Permit functionality exists but not integrated in bridge

**Standard Allowance Implementation:**
```solidity
// mercata/contracts/abstract/ERC20/ERC20.sol:123-127
function approve(address spender, uint256 value) public override returns (bool) {
    address owner = _msgSender();
    _approve(owner, spender, value);
    return true;
}

// mercata/contracts/abstract/ERC20/ERC20.sol:145-150
function transferFrom(address from, address to, uint256 value) public virtual override returns (bool) {
    address spender = _msgSender();
    _spendAllowance(from, spender, value);
    _transfer(from, to, value);
    return true;
}
```

**Available but Unused EIP-2612 Permit:**
```solidity
// mercata/contracts/abstract/ERC20/extensions/ERC20Permit.sol:44-67
function permit(
    address owner,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v, bytes32 r, bytes32 s
) public virtual {
    if (block.timestamp > deadline) {
        revert ERC2612ExpiredSignature(deadline);
    }
    // ... signature validation and approval
}
```

**Missing Security Features:**
- ❌ **SafeApprove Pattern**: No protection against approve race conditions
- ❌ **Zero-First Approval**: No requirement to approve 0 before setting new amount
- ❌ **Permit Integration**: EIP-2612 gasless approvals not used in bridge operations
- ❌ **Pull vs Push Safety**: Bridge relies on user-initiated approvals vs safer pull patterns

**Approve Race Condition Risk:**
```solidity
// ❌ Vulnerable to front-running
// 1. User approves bridge for 1000 tokens
// 2. User tries to reduce approval to 500 tokens  
// 3. Malicious relayer can spend 1000 + 500 = 1500 tokens if transactions are reordered
```

---

## ⏱️ Non-Blocking Deposits Analysis

### ❌ **NO ADVANCED DEPOSIT MANAGEMENT** [Medium]

**Current Implementation:**
- **Immediate Processing**: All deposits processed synchronously through relayer
- **No Queueing System**: No mechanism to queue deposits during high load or failures
- **No Timeout Handling**: No expiration mechanisms for pending deposits

**Basic State Management:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:52-55
mapping(string => WithdrawState) public record withdrawStatus; 
mapping(string => DepositState) public record depositStatus;

// Simple state transitions without advanced features
enum DepositState { NONE, INITIATED, COMPLETED }
```

**Missing Features:**
- ❌ **Deposit Queueing**: No ability to queue deposits during maintenance or failures
- ❌ **Idempotent Cancellation**: Users cannot cancel pending deposits
- ❌ **Refund Mechanisms**: No automated refund system for failed deposits
- ❌ **Explicit Timeouts**: No time-based expiration for deposit requests
- ❌ **User-Visible Status**: Limited status tracking for users beyond basic states
- ❌ **Batch Processing**: No efficient batch deposit processing capabilities

**Missing Implementation:**
```solidity
// ❌ No such functionality exists
struct DepositRequest {
    address user;
    address token;
    uint256 amount;
    uint256 deadline;
    uint256 timestamp;
    string status; // "pending", "processing", "completed", "failed", "cancelled"
}

function cancelDeposit(string txHash) external {
    // Not implemented
}

function refundExpiredDeposit(string txHash) external {
    // Not implemented  
}
```

---

## 🔒 Reentrancy & Callback Protection Analysis

### ❌ **NO REENTRANCY PROTECTION** [Critical]

**Current Bridge Implementation:**
- **No ReentrancyGuard**: Bridge contract has no reentrancy protection modifiers
- **No Callback Token Handling**: No specific protection against ERC-777/ERC-1363 hooks
- **Missing CEI Pattern**: Doesn't follow Checks-Effects-Interactions pattern

**Bridge Contract Analysis:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:108-114
function deposit(string txHash, address token, address from, uint256 amount, address to, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.NONE, "ALREADY_PROCESSED");
    require(amount >= minAmount, "BELOW_MIN");
    
    depositStatus[txHash] = DepositState.INITIATED; // ⚠️ State change before external calls
    emit DepositInitiated(txHash, from, token, amount, to, mercataUser);
}

// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123  
function confirmDeposit(string txHash, address token, address to, uint256 amount, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.INITIATED, "BAD_STATE");
    require(tokenFactory.isTokenActive(token), "INACTIVE_TOKEN");

    Token(token).mint(mercataUser, amount); // ⚠️ External call without reentrancy protection
    depositStatus[txHash] = DepositState.COMPLETED;
    emit DepositCompleted(txHash);
}
```

**Contrasting Example - Pool Contract HAS Protection:**
```solidity
// mercata/contracts/concrete/Pools/Pool.sol:88-94
modifier nonReentrant() {
    require(!locked, "REENTRANT");
    locked = true;
    _;
    locked = false;
}

// mercata/contracts/concrete/Pools/Pool.sol:294-295
function swap(...) external nonReentrant returns (uint256 amountOut) {
    // Protected swap function
}
```

**Missing Protection Against Callback Tokens:**
- ❌ **ERC-777 Hooks**: No protection against `tokensToSend` and `tokensReceived` hooks
- ❌ **ERC-1363 Callbacks**: No handling of `onTransferReceived` and `onApprovalReceived`
- ❌ **CEI Pattern**: State changes happen before external interactions

**Available ERC-4626 Guidance (Not Used):**
```solidity
// mercata/contracts/abstract/ERC20/extensions/ERC4626.sol:239-248
// If asset() is ERC-777, `transferFrom` can trigger a reentrancy BEFORE the transfer happens through the
// `tokensToSend` hook. On the other hand, the `tokenReceived` hook, that is triggered after the transfer,
// calls the vault, which is assumed not malicious.
//
// Conclusion: we need to do the transfer before we mint so that any reentrancy would happen before the
// assets are transferred and before the shares are minted, which is a valid state.
SafeERC20.safeTransferFrom(IERC20(asset()), caller, address(this), assets);
```

**Attack Vectors:**
1. **ERC-777 Reentrancy**: Malicious token could call bridge functions during transfer hooks
2. **State Corruption**: Multiple simultaneous deposits could corrupt internal state
3. **Double Minting**: Reentrancy could trigger multiple mints for same deposit

---

## 💵 Slashing/Bonder Funds Analysis

### ❌ **NO FAST BRIDGE OR COLLATERAL MECHANISMS** [High]

**Current Implementation:**
- **No Bonder System**: Bridge has no bonded relayer or collateral requirements
- **No Slashing Mechanism**: No way to penalize malicious or incorrect behavior
- **No Collateral Tracking**: No automated caps or exposure limits per asset/chain

**Missing Fast Bridge Features:**
```solidity
// ❌ No such functionality exists in bridge
contract FastBridge {
    mapping(address => uint256) public bonderCollateral;
    mapping(address => mapping(address => uint256)) public assetExposure;
    uint256 public maxExposurePerAsset;
    
    function slashBonder(address bonder, uint256 amount) external;
    function withdrawCollateral(uint256 amount) external;
    function checkExposureLimits(address asset, uint256 amount) external view returns (bool);
}
```

**Single Relayer Risk:**
- **No Economic Security**: Relayer has unlimited minting power without stake
- **No Slashing Deterrent**: No financial penalty for malicious behavior
- **No Exposure Limits**: No caps on amount single relayer can process

**Missing Risk Management:**
- ❌ **Bonder Collateral Requirements**: No stake required to operate as relayer
- ❌ **Automated Exposure Caps**: No limits on relayer exposure per asset or chain
- ❌ **Slashing Conditions**: No definition of slashable offenses
- ❌ **Multi-Relayer Redundancy**: No backup relayers or redundancy mechanisms

---

## 🚨 Critical Recommendations

### **Immediate Actions Required:**

1. **Implement Reentrancy Protection:**
   ```solidity
   import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
   
   contract MercataEthBridge is Ownable, ReentrancyGuard {
       function confirmDeposit(...) external onlyRelayer nonReentrant {
           // Protected implementation
       }
   }
   ```

2. **Add Balance Verification:**
   ```solidity
   function safeTransferFrom(address token, address from, uint256 amount) internal returns (uint256) {
       uint256 balanceBefore = IERC20(token).balanceOf(address(this));
       require(IERC20(token).transferFrom(from, address(this), amount), "Transfer failed");
       uint256 balanceAfter = IERC20(token).balanceOf(address(this));
       return balanceAfter - balanceBefore;
   }
   ```

3. **Implement SafeApprove Pattern:**
   ```solidity
   function safeApprove(address token, address spender, uint256 amount) internal {
       require(IERC20(token).approve(spender, 0), "Approve reset failed");
       require(IERC20(token).approve(spender, amount), "Approve failed");
   }
   ```

### **Medium-Term Improvements:**

1. **Add Deposit Queueing and Timeout Mechanisms**
2. **Integrate EIP-2612 Permit for Gasless Approvals**  
3. **Implement Collateral/Bonder System for Economic Security**
4. **Add Support for Special Token Types (Fee-on-Transfer, Rebasing)**

---

**End of Chapter 4 Analysis**