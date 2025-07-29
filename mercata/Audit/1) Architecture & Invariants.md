# Mercata Bridge Security Audit - Chapter 1: Architecture & Invariants

**Audit Date:** January 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge architecture lacks **fundamental invariant enforcement mechanisms** that are critical for bridge security. The analysis reveals **CRITICAL gaps** in value conservation tracking, inadequate replay protection, missing circuit breakers, and insufficient upgrade controls that pose significant risks to user funds.

---

## 💰 Conservation of Value Analysis

### ❌ **NO INVARIANT ENFORCEMENT** [Critical]

**Current Implementation:**
- **No Automated Checks**: Bridge lacks on-chain or off-chain invariant validation
- **No Balance Tracking**: No mechanism to verify `total_minted ≤ total_locked` per asset
- **No Fee Accounting**: Bridge operations don't explicitly account for fees in conservation equations

**Missing Conservation Mechanisms:**
```solidity
// ❌ No such validation exists in MercataEthBridge.sol
function validateInvariant(address token) external view returns (bool) {
    uint256 totalLocked = IERC20(token).balanceOf(SAFE_ADDRESS);
    uint256 totalMinted = Token(wrappedToken[token]).totalSupply();
    return totalMinted <= totalLocked; // This check doesn't exist
}
```

**Value Leakage Risks:**
- **Unbacked Minting**: Relayer can call `confirmDeposit()` without verifying actual Ethereum deposits
- **Double Spending**: Withdrawal state transitions don't verify actual Safe wallet balances
- **No Reconciliation**: No periodic auditing of locked vs minted token supplies

**Attack Scenarios:**
1. **Malicious Relayer**: Mint unlimited wrapped tokens without backing deposits
2. **Accounting Errors**: Gradual drift between locked and minted amounts goes undetected
3. **Emergency Scenarios**: No way to verify system solvency during incidents

**Evidence - Missing Balance Verification:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:116-123
function confirmDeposit(string txHash, address token, address to, uint256 amount, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.INITIATED, "BAD_STATE");
    require(tokenFactory.isTokenActive(token), "INACTIVE_TOKEN");

    Token(token).mint(mercataUser, amount); // ⚠️ No verification of backing funds
    depositStatus[txHash] = DepositState.COMPLETED;
    emit DepositCompleted(txHash);
}
```

---

## 🔄 One-Time Message Consumption Analysis

### ⚠️ **BASIC TRANSACTION HASH PROTECTION** [Critical]

**Current Implementation:**
- **Transaction Hash Keying**: Uses Ethereum transaction hashes as unique identifiers
- **Simple State Tracking**: Basic enum-based status mappings
- **No Nonce System**: Lacks sequential nonce-based replay protection

**Code Evidence:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:52-55
mapping(string => WithdrawState) public record withdrawStatus; 
mapping(string => DepositState) public record depositStatus;

// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:108-114
function deposit(string txHash, address token, address from, uint256 amount, address to, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.NONE, "ALREADY_PROCESSED"); // Basic replay protection
    require(amount >= minAmount, "BELOW_MIN");
    depositStatus[txHash] = DepositState.INITIATED;
    emit DepositInitiated(txHash, from, token, amount, to, mercataUser);
}
```

**Missing Security Features:**
- ❌ **Unique Nonces**: No sequential nonce system for guaranteed uniqueness
- ❌ **Domain Separation**: No separation by chainId, bridgeId, or assetId
- ❌ **Cross-Chain Protection**: No protection against replay across similar chains
- ❌ **Version Control**: No protocol version in message structure

**Vulnerability Analysis:**
- **Hash Collision Risk**: Theoretical possibility of transaction hash collisions
- **Chain Fork Scenarios**: Identical transaction hashes on different forks
- **Cross-Domain Replay**: Messages could be replayed across different bridge instances

**Missing Implementation:**
```solidity
// ❌ Should have comprehensive domain separation
struct BridgeMessage {
    uint256 nonce;           // Sequential nonce
    uint256 chainId;         // Source chain ID
    uint256 bridgeId;        // Bridge instance ID
    address assetId;         // Asset being bridged
    bytes32 messageHash;     // Content hash
}
```

---

## 🗺️ Canonical Token Mapping Analysis

### ⚠️ **HARDCODED IMMUTABLE MAPPINGS** [High]

**Current Implementation:**
- **Static Configuration**: Token mappings hardcoded in JavaScript configuration files
- **No Governance**: No on-chain registry or governance mechanism for updates
- **Manual Updates**: Changes require code deployment

**Token Mapping Evidence:**
```javascript
// mercata/services/bridge/src/config/index.ts:145-153
export const TESTNET_ETH_STRATO_TOKEN_MAPPING = {
  '0x0000000000000000000000000000000000000000': '0x93fb7295859b2d70199e0a4883b7c320cf874e6c', // ETH        
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x3d351a4a339f6eef7371b0b1b025b3a434ad0399' // USDC
}
  
export const MAINNET_ETH_STRATO_TOKEN_MAPPING = {
  '0x0000000000000000000000000000000000000000': '0x0000000000000000000000000000000000000000',
  '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238': '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
}
```

**Registry Analysis:**
- **Limited Flexibility**: Only 2 tokens supported (ETH, USDC)
- **No Metadata Verification**: Decimals, symbols, names not enforced
- **Deployment Risk**: Mapping errors require full service redeployment

**Missing Features:**
- ❌ **On-Chain Registry**: No immutable on-chain token pair registry
- ❌ **Governance Control**: No DAO or multisig control over mappings
- ❌ **Upgrade Paths**: No documented procedures for adding new tokens
- ❌ **Metadata Validation**: No verification of token metadata consistency
- ❌ **Decimal Handling**: Inconsistent decimal conversion between chains

**Evidence - Manual Token Filtering:**
```javascript
// mercata/services/bridge/src/services/bridgeService.ts:169-184
// ⚠️ TEMPORARY FIX: Filter out deposits with invalid token addresses from previous testnet deployment
const INVALID_TOKEN_ADDRESSES = [
  "581ee622fb866f3c2076d4260824ce681b15b715", // Old incorrect ETHST address
  "500fb797b0be4ce0edf070a9b17bae56d22a2131", // Old incorrect USDCST address
];

const validDeposits = depositStatus.filter((deposit: any) => {
  const tokenAddress = deposit.token.toLowerCase().replace("0x", "");
  const isInvalid = INVALID_TOKEN_ADDRESSES.includes(tokenAddress);
  
  if (isInvalid) {
    console.warn(`Skipping deposit with invalid token address: ${deposit.txHash} (token: ${tokenAddress})`);
  }
  
  return !isInvalid;
});
```

---

## 🛑 Pause/Kill Switches Analysis

### ❌ **NO CIRCUIT BREAKERS IMPLEMENTED** [High]

**Current Implementation:**
- **No Pause Mechanism**: Bridge contract lacks pause functionality
- **Continuous Operation**: Bridge continues operating during failures
- **No Rate Limiting**: No transaction size or frequency limits

**Missing Pause Controls:**
- ❌ **Emergency Pause**: No ability to halt bridge operations during incidents
- ❌ **Per-Asset Pause**: Cannot pause specific tokens while maintaining others
- ❌ **Directional Pause**: Cannot pause deposits while allowing withdrawals or vice versa
- ❌ **Rate Limiting**: No protection against large volume attacks

**Available Infrastructure - Unused:**
```solidity
// mercata/contracts/abstract/ERC20/extensions/ERC20Pausable.sol:22-33
abstract contract ERC20Pausable is ERC20, Pausable {
    function _update(address from, address to, uint256 value) internal virtual override whenNotPaused {
        super._update(from, to, value);
    }
}
```

**Bridge Contract Analysis:**
```solidity
// ❌ MercataEthBridge.sol does NOT inherit from Pausable
contract record MercataEthBridge is Ownable { // Should be: is Ownable, Pausable
    // No pause modifiers on critical functions
    function deposit(string txHash, address token, address from, uint256 amount, address to, address mercataUser) external onlyRelayer {
        // ❌ Should have: whenNotPaused modifier
    }
}
```

**Emergency Response Gaps:**
- **No Circuit Breakers**: Bridge cannot be halted during anomalous behavior
- **No Volume Limits**: No protection against large-scale drain attacks
- **No Automated Triggers**: No automatic pause on repeated failures
- **Manual Only**: Only owner can make changes, no automated protection

**Infrastructure Rate Limiting:**
```javascript
// mercata/nginx/nginx.tpl.conf:99-100
limit_req_zone $limit_req_key zone=server:10m rate=80r/s; // Only basic HTTP rate limiting
limit_req_status 429;
```

---

## 🔧 Upgradeability Boundaries Analysis

### ⚠️ **BASIC OWNERSHIP WITHOUT SAFEGUARDS** [Critical]

**Current Implementation:**
- **Simple Ownable**: Basic owner-controlled parameter updates
- **No Timelocks**: Changes take effect immediately
- **No Multi-signature**: Single owner key controls upgrades

**Owner Powers Analysis:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:93-97
function setRelayer(address newRelayer) external onlyOwner {
    require(newRelayer != address(0), "ZERO_ADDR");
    emit RelayerUpdated(relayer, newRelayer);
    relayer = newRelayer; // ⚠️ Immediate effect, no timelock
}

// Lines 99-102
function setMinAmount(uint256 newMin) external onlyOwner {
    emit MinAmountUpdated(minAmount, newMin);
    minAmount = newMin; // ⚠️ Immediate effect
}
```

**Missing Upgrade Safeguards:**
- ❌ **Timelock Delays**: No delay between proposal and execution
- ❌ **Multi-signature**: Single owner can make arbitrary changes
- ❌ **Community Governance**: No DAO or community involvement
- ❌ **Emergency Limits**: Owner can mint arbitrarily by changing relayer
- ❌ **Upgrade Boundaries**: No clear separation of upgrade powers

**Critical Vulnerability:**
```solidity
// ⚠️ Owner can instantly replace relayer with malicious actor
function setRelayer(address newRelayer) external onlyOwner {
    // No timelock, no multi-sig, no community approval
    relayer = newRelayer; // New relayer can immediately mint unlimited tokens
}
```

**Recommended Governance Structure:**
```solidity
// ❌ Missing implementation
contract BridgeTimelock {
    uint256 public constant MINIMUM_DELAY = 48 hours;
    
    function queueTransaction(
        address target,
        uint256 value,
        string calldata signature,
        bytes calldata data,
        uint256 eta
    ) external onlyGovernance {
        require(eta >= block.timestamp + MINIMUM_DELAY, "Timelock::queueTransaction: Estimated execution block must satisfy delay.");
        // Queue implementation
    }
}
```

**Emergency Powers Assessment:**
- **Unlimited Minting**: Owner can change relayer who can mint unlimited tokens
- **Fund Seizure**: Owner can set relayer to address that burns user tokens
- **No Observable Process**: Changes happen without transparent governance
- **No Escape Hatch**: Users cannot exit during malicious owner actions

---

## 📋 Event Schema Analysis

### ⚠️ **BASIC EVENT STRUCTURE** [Medium]

**Current Event Schema:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:66-73
event DepositInitiated(string txHash, address from, address token, uint256 amount, address to, address mercataUser);
event DepositCompleted(string txHash);
event WithdrawalInitiated(string txHash, address from, address token, uint256 amount, address to, address mercataUser);
event WithdrawalPendingApproval(string txHash);
event WithdrawalCompleted(string txHash);
event RelayerUpdated(address oldRelayer, address newRelayer);
event MinAmountUpdated(uint256 oldVal, uint256 newVal);
event TokenFactoryUpdated(address oldFactory, address newFactory);
```

**Event Structure Analysis:**

**✅ Strengths:**
- **Basic Lifecycle**: Covers deposit and withdrawal state transitions
- **Parameter Changes**: Logs administrative updates
- **Transaction Tracking**: Includes transaction hashes for correlation

**❌ Missing Elements:**
- **Indexed Fields**: Events lack proper `indexed` parameters for efficient filtering
- **Message IDs**: No unique message identifiers separate from transaction hashes
- **Fee Information**: No fee accounting in events
- **Origin Chain**: No source chain identification in events
- **Net Amounts**: Events show gross amounts, not net of fees
- **Attestation Info**: No attestation or proof information

**Improved Event Schema:**
```solidity
// ❌ Should be implemented
event DepositInitiated(
    bytes32 indexed messageId,      // Unique message identifier
    uint256 indexed sourceChain,    // Origin chain ID
    address indexed token,          // Token address
    string txHash,                  // Source transaction hash
    address from,                   // Depositor
    address to,                     // Recipient
    uint256 grossAmount,           // Amount before fees
    uint256 netAmount,             // Amount after fees
    uint256 fee,                   // Fee amount
    address mercataUser            // Beneficiary
);
```

**Backend Event Handling:**
```typescript
// mercata/backend/src/api/controllers/events.controller.ts:61-72
{
  name: "MercataEthBridge",
  events: [
    "DepositInitiated",
    "DepositCompleted", 
    "WithdrawalInitiated",
    "WithdrawalPendingApproval",
    "WithdrawalCompleted",
    "RelayerUpdated",
    "MinAmountUpdated",
    "TokenFactoryUpdated"
  ]
}
```

**Event Indexing Issues:**
- **Poor Filterability**: Events cannot be efficiently filtered by token or user
- **No Time Indexing**: Missing block timestamp information
- **Limited Correlation**: Difficult to correlate events across transaction lifecycle

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **No Conservation Invariants** - Unlimited minting possible without backing verification
2. **Basic Replay Protection** - Transaction hash collisions and cross-chain replay risks
3. **Immediate Upgrade Powers** - Owner can instantly change relayer to malicious actor

### 🟡 **HIGH RISKS**  
1. **No Circuit Breakers** - Bridge cannot be paused during emergencies
2. **Hardcoded Token Mappings** - Inflexible and error-prone token registry
3. **Missing Rate Limits** - No protection against volume-based attacks

### 🟢 **MEDIUM RISKS**
1. **Basic Event Schema** - Limited monitoring and debugging capabilities
2. **No Automated Invariant Checks** - Manual verification required for system health

---

## 🛠️ Recommendations

### **Priority 1 - Critical Invariants**
1. **Implement Conservation Checks**: Add on-chain invariant validation for `totalMinted ≤ totalLocked`
2. **Add Comprehensive Replay Protection**: Implement nonce-based system with domain separation
3. **Deploy Timelock Governance**: Add 48-hour minimum delay for all parameter changes

### **Priority 2 - Safety Mechanisms**
1. **Implement Pausable Pattern**: Add emergency pause functionality to bridge contract
2. **Add Rate Limiting**: Implement per-asset and per-direction transaction limits
3. **Deploy Automated Monitoring**: Add invariant checking bots with alerting

### **Priority 3 - Infrastructure Improvements**
1. **Create On-Chain Token Registry**: Replace hardcoded mappings with governed registry
2. **Enhance Event Schema**: Add indexed fields, message IDs, and fee information
3. **Implement Multi-signature**: Replace single owner with multi-signature wallet

### **Priority 4 - Advanced Features**
1. **Add Formal Verification**: Mathematical proofs for conservation invariants
2. **Deploy Circuit Breakers**: Automatic pause on anomalous behavior detection
3. **Create Recovery Mechanisms**: Emergency procedures for various failure modes

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Add basic invariant checks to bridge contract
- [ ] Implement emergency pause functionality
- [ ] Deploy timelock for owner operations

### **Short-term Goals (Month 1)**  
- [ ] Create comprehensive replay protection system
- [ ] Add automated invariant monitoring
- [ ] Enhance event schema with indexed fields

### **Long-term Objectives (Quarter 1)**
- [ ] Deploy on-chain token registry with governance
- [ ] Implement formal verification for critical invariants
- [ ] Create comprehensive emergency response procedures

---

**Architectural Security Status: HIGH RISK** 🔴

The Mercata Bridge lacks fundamental architectural safeguards that are essential for secure bridge operations. Immediate implementation of conservation checks, proper replay protection, and governance safeguards is critical before production deployment.

---

**End of Chapter 1 Analysis**