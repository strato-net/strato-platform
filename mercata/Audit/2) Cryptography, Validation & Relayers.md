# Mercata Bridge Security Audit - Chapter 2: Cryptography, Validation & Relayers

**Audit Date:** July 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge employs **basic centralized relayer attestation** without cryptographic proofs or formal verification mechanisms. The analysis reveals **CRITICAL gaps** in cryptographic security including lack of threshold signatures, inadequate key management, missing signature verification standards, and insufficient anti-replay protection.

---

## 🔐 Attestation Mechanism Analysis

### ❌ **NO CRYPTOGRAPHIC ATTESTATION** [Critical]

**Current Implementation:**
- **Simple Address-Based Authentication**: Uses basic `onlyRelayer` modifier for access control
- **No Threshold Signatures**: Single relayer with complete authority
- **No MPC/TSS**: No multi-party computation or threshold signature schemes
- **No BLS Multisig**: Basic ECDSA signatures through Safe multisig only for withdrawals

**Code Evidence:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:75
modifier onlyRelayer() { require(msg.sender == relayer, "NOT_RELAYER"); _; }
```

**Missing Security Features:**
- ❌ **False-positive probability**: Not documented or calculated
- ❌ **Corruption cost**: No economic security model  
- ❌ **Cryptographic proofs**: No mathematical verification of bridge operations
- ❌ **Threshold requirements**: Single point of failure

**Attack Scenarios:**
- **Relayer Key Compromise**: Complete bridge control with single private key
- **No Redundancy**: Bridge halts if relayer becomes unavailable
- **Unlimited Authority**: Can mint/burn arbitrary amounts without verification

---

## 🔑 Key Management Analysis

### ❌ **BASIC ENVIRONMENT VARIABLE STORAGE** [Critical]

**Current Key Storage:**
- **Private Keys in Environment Variables**: All sensitive keys stored as plaintext environment variables
- **No HSM/TEE Usage**: No hardware security modules or trusted execution environments
- **No Key Sharding**: All keys stored in single locations

**Code Evidence:**
```javascript
// mercata/services/bridge/src/services/safeService.ts:50-54
state.protocolKit = await Safe.init({
  provider: config.ethereum.rpcUrl || "",
  signer: config.safe.safeOwnerPrivateKey || "", // Plaintext env var
  safeAddress: config.safe.address || "",
});
```

**Configuration Analysis:**
```javascript
// mercata/services/bridge/src/config/index.ts:36-40
safe: {
  address: process.env.SAFE_ADDRESS,
  safeOwnerAddress: process.env.SAFE_OWNER_ADDRESS,  
  safeOwnerPrivateKey: process.env.SAFE_OWNER_PRIVATE_KEY, // ⚠️ Plaintext storage
},
```

**Missing Security Measures:**
- ❌ **HSM Integration**: No hardware security module usage
- ❌ **TEE Protection**: No trusted execution environment
- ❌ **Key Sharding**: No distributed key storage
- ❌ **Key Rotation**: No automated key rotation procedures
- ❌ **Compromised Key Response**: No documented incident response for key compromise
- ❌ **Proof-of-Possession**: No verification of key ownership during setup
- ❌ **Revocation Lists**: No mechanism to revoke compromised keys

**Security Best Practices Violations:**
```javascript
// mercata/.cursorrules:139-143
// - API keys must always be stored in environment variables
// - Private keys must never be hardcoded or committed  
// - Secrets should be in .env files that are listed in .gitignore
```

---

## ✍️ Signature Safety Analysis  

### ⚠️ **LIMITED EIP-712 USAGE** [High]

**Current Implementation:**
- **EIP-712 Only for Token Permits**: Standard ERC-20 permit functionality uses proper EIP-712
- **No Bridge-Specific EIP-712**: Bridge operations don't use structured signing
- **Safe SDK Handles Signatures**: Withdrawal signatures managed by Safe infrastructure

**EIP-712 Implementation Found:**
```solidity
// mercata/contracts/abstract/ERC20/extensions/ERC20Permit.sol:20-39
abstract contract ERC20Permit is ERC20, IERC20Permit, EIP712, Nonces {
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    
    constructor(string memory name) EIP712(name, "1") {}
```

**Domain Separator Usage:**
```solidity
// Lines 79-82
function DOMAIN_SEPARATOR() external view virtual returns (bytes32) {
    return _domainSeparatorV4();
}
```

**Bridge Operations Analysis:**
- **Deposits**: No user signatures required - relies on transaction verification only
- **Withdrawals**: Uses Safe multisig signatures but not EIP-712 for bridge-specific data

**Missing EIP-712 Implementation:**
- ❌ **Bridge Domain Separator**: No bridge-specific domain separation
- ❌ **Chain ID Integration**: Limited chain ID usage in signatures  
- ❌ **Structured Bridge Data**: Bridge parameters not signed with typed data
- ❌ **Version Control**: No versioning in domain separator
- ❌ **Contract Address Binding**: Bridge contract address not in domain separator

**Signature Validation Gaps:**
- ❌ **Non-canonical Encoding Rejection**: No explicit handling
- ❌ **Malleable Signature Protection**: Relies on underlying ECDSA.recover()
- ❌ **Signature Replay Protection**: Basic nonce-based protection only in permits

---

## 🔍 Light-Client Correctness Analysis

### ❌ **NO LIGHT-CLIENT IMPLEMENTATION** [Not Applicable]

**Analysis Results:**
- **No Light-Client Usage**: Bridge does not implement light client verification
- **No Header Verification**: No block header validation mechanisms
- **No Fraud Proofs**: No fraud proof or validity proof systems
- **No Finality Gadget**: No integration with consensus finality mechanisms
- **No Reorg Handling**: No light-client based reorganization protection
- **No Fork-Choice Updates**: No consensus layer integration

**Current Verification Method:**
- **Transaction Receipt Verification**: Uses Alchemy API and Safe multisig for validation
- **No Cryptographic Proofs**: Relies on trusted third parties

**Light-Client Opportunities:**
- Could implement Ethereum light client for trustless verification
- STRATO finality could be cryptographically verified
- Would reduce trust assumptions significantly

---

## 👥 Relayer Set Identity Analysis

### ❌ **SINGLE RELAYER - NO SET MANAGEMENT** [Critical]

**Current Architecture:**
- **Single Relayer**: One address with complete bridge authority
- **No Set Membership**: No concept of relayer set or committee
- **Simple Address Verification**: Basic `msg.sender` check against stored address

**Relayer Management:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:93-97
function setRelayer(address newRelayer) external onlyOwner {
    require(newRelayer != address(0), "ZERO_ADDR");
    emit RelayerUpdated(relayer, newRelayer);
    relayer = newRelayer;
}
```

**Missing Features:**
- ❌ **Verified Membership**: No cryptographic membership proofs
- ❌ **Slashing/Bonding**: No economic collateral requirements
- ❌ **Sybil Resistance**: No protection against fake identities  
- ❌ **Join/Exit Procedures**: No formal onboarding/offboarding process
- ❌ **Performance Tracking**: No SLA monitoring or performance metrics
- ❌ **Redundancy**: No backup relayers or failover mechanisms

**Authentication Analysis:**
```javascript
// mercata/services/bridge/src/middlewares/index.ts:44-48
jwt.verify(token, publicKey, { 
  algorithms: ["RS256"], 
  issuer 
}, async (err, decoded) => {
  // JWT-based authentication for API access
```

**Trust Model:**
- **Centralized Trust**: Users must trust single relayer operator
- **No Decentralized Verification**: No validator set consensus
- **Manual Updates**: Relayer changes require owner intervention

---

## 🔄 Anti-Replay Protection Analysis

### ⚠️ **BASIC TRANSACTION HASH REPLAY PROTECTION** [High]

**Current Implementation:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:52-55
mapping(string => WithdrawState) public record withdrawStatus; 
mapping(string => DepositState) public record depositStatus;
```

**Replay Protection Mechanisms:**
1. **Transaction Hash Keying**: Uses Ethereum transaction hashes as unique identifiers
2. **State Tracking**: Prevents duplicate processing via status mappings
3. **Chain ID in Safe Calls**: Limited chain ID usage through Safe SDK

**Chain ID Usage:**
```javascript  
// mercata/services/bridge/src/polling/alchemyPolling.ts:9
const apiKit = new SafeApiKit({ chainId: process.env.SHOW_TESTNET === 'true' ? 11155111n : 1n });
```

**Missing Protections:**
- ❌ **Domain Versioning**: No versioning system for protocol upgrades
- ❌ **Address Collision Protection**: No CREATE2 collision prevention
- ❌ **L2 Aliasing Protection**: No protection against cross-chain address aliasing
- ❌ **Explicit Chain ID Validation**: Limited chain ID integration in bridge logic
- ❌ **Cross-Chain Nonce Management**: No global nonce system across chains

**Vulnerability Analysis:**
- **Transaction Hash Collision**: Extremely unlikely but theoretically possible
- **Chain Split Scenarios**: No protection against chain forks with identical transaction hashes
- **Cross-Chain Replay**: Limited protection against replay attacks across similar chains

**Code Evidence - Limited Anti-Replay:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:108-114
function deposit(string txHash, address token, address from, uint256 amount, address to, address mercataUser) external onlyRelayer {
    require(depositStatus[txHash] == DepositState.NONE, "ALREADY_PROCESSED"); // Basic replay protection
    require(amount >= minAmount, "BELOW_MIN");
    depositStatus[txHash] = DepositState.INITIATED;
    emit DepositInitiated(txHash, from, token, amount, to, mercataUser);
}
```

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **No Cryptographic Attestation** - Single relayer with unlimited authority
2. **Plaintext Key Storage** - Private keys in environment variables without HSM protection
3. **Missing Threshold Security** - No multi-signature requirements for critical operations

### 🟡 **HIGH RISKS**  
1. **Limited EIP-712 Usage** - Bridge operations lack structured signing
2. **Basic Replay Protection** - Reliance on transaction hash uniqueness only  
3. **Single Point of Failure** - No relayer redundancy or failover mechanisms

### 🟢 **MEDIUM RISKS**
1. **No Light-Client Verification** - Missed opportunity for trustless validation
2. **Manual Key Management** - No automated rotation or recovery procedures

---

## 🛠️ Recommendations

### **Priority 1 - Critical Security**
1. **Implement Threshold Signatures**: Require M-of-N signatures for all bridge operations
2. **Deploy HSM/TEE Protection**: Move all private keys to hardware security modules  
3. **Add Economic Security**: Implement slashing and bonding for relayers

### **Priority 2 - Cryptographic Hardening**
1. **Implement Bridge-Specific EIP-712**: Create structured signing for all bridge operations
2. **Add Comprehensive Chain ID Validation**: Include chain ID in all critical operations
3. **Deploy Anti-Replay Mechanisms**: Implement nonce-based replay protection

### **Priority 3 - Infrastructure Improvements**
1. **Create Relayer Set Management**: Implement formal relayer onboarding/management
2. **Add Performance Monitoring**: Track relayer SLAs and availability
3. **Implement Key Rotation**: Automated key rotation and recovery procedures

### **Priority 4 - Advanced Features**
1. **Consider Light-Client Integration**: Explore trustless verification mechanisms
2. **Add Formal Verification**: Mathematical proofs for critical bridge operations
3. **Implement Circuit Breakers**: Automatic pause on anomalous signature patterns

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Move private keys to HSM or secure key management service
- [ ] Implement M-of-N multisig requirement for relayer operations
- [ ] Add comprehensive logging for all signature operations

### **Short-term Goals (Month 1)**  
- [ ] Design and implement bridge-specific EIP-712 domain separator
- [ ] Create formal relayer management procedures
- [ ] Add chain ID validation to all bridge operations

### **Long-term Objectives (Quarter 1)**
- [ ] Evaluate threshold signature scheme implementation (TSS/MPC)
- [ ] Design economic security model with slashing conditions
- [ ] Research light-client integration opportunities

---

**Cryptographic Security Status: HIGH RISK** 🔴

The Mercata Bridge currently operates with minimal cryptographic security, relying heavily on centralized trust assumptions. Immediate implementation of threshold signatures and secure key management is critical for production deployment.

---

**End of Chapter 2 Analysis**