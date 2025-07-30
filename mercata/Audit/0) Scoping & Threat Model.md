# Mercata Bridge Security Audit - Chapter 0: Scoping & Threat Model

**Audit Date:** July 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge implements a **lock/mint pattern** between Ethereum (Sepolia/Mainnet) and STRATO Mercata network. The analysis reveals **CRITICAL security risks** due to centralized trust assumptions and missing safety mechanisms that are standard in production bridge implementations.

---

## 🔍 Bridge Pattern Analysis

### ✅ Bridge Pattern Identified: **LOCK/MINT** [Critical]

**Implementation Details:**

**Ethereum → STRATO (Deposit Flow):**
- Tokens are **locked** in a Gnosis Safe multisig wallet on Ethereum
- Corresponding wrapped tokens are **minted** on STRATO via `MercataEthBridge.deposit()` and `confirmDeposit()`
- Relayer monitors Ethereum deposits and triggers minting on STRATO

**STRATO → Ethereum (Withdrawal Flow):**
- Wrapped tokens are **burned** on STRATO via `MercataEthBridge.withdraw()`  
- Native tokens are transferred from Safe wallet on Ethereum after multisig approval
- Three-phase process: INITIATED → PENDING_APPROVAL → COMPLETED

**Code References:**
- Bridge Contract: `mercata/contracts/concrete/Bridge/MercataEthBridge.sol`
- Service Implementation: `mercata/services/bridge/src/services/bridgeService.ts`

---

## 🚨 Trust Assumptions Analysis

### ⚠️ **HIGH RISK - Centralized Trust Model** [Critical]

**Critical Trust Dependencies:**

#### 1. **Relayer Key Compromise Risk** 
- **Single Point of Failure**: The `relayer` address has unilateral control over all bridge operations
- **Minting Authority**: Can mint unlimited tokens by calling `confirmDeposit()` with fabricated transactions
- **Burn Authority**: Can initiate withdrawals and mark them complete without verification
- **Code Evidence**: All bridge functions protected by `onlyRelayer` modifier

#### 2. **Safe Multisig Trust**
- **Fund Custody**: All locked Ethereum assets held in Safe multisig wallet
- **Signer Collusion Risk**: Colluding signers can steal all locked funds
- **Configuration Unknown**: Safe threshold and signer identities not documented in codebase
- **Availability Risk**: Withdrawal execution depends on Safe signer participation

#### 3. **Owner Key Risk**
- **Relayer Replacement**: Owner can replace relayer at any time via `setRelayer()`
- **Parameter Control**: Can modify `minAmount` and effectively pause bridge via `TokenFactory` updates
- **No Timelock**: Changes take effect immediately without delay

**What Users Must Trust:**
- ✅ Relayer will not mint unbacked tokens
- ✅ Relayer will not mark false transactions as confirmed
- ✅ Safe signers will not collude to steal locked funds  
- ✅ Owner will not maliciously replace relayer
- ✅ Bridge service maintains 24/7 uptime and availability

---

## 💰 Assets Coverage Analysis

### ✅ **Limited Asset Support** [High]

**Currently Supported Assets:**

**Testnet Configuration:**
- **ETH**: Native Sepolia Ether (18 decimals)
- **USDC**: USD Coin at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 decimals)

**Mainnet Configuration:**
- **ETH**: Native Ethereum (18 decimals) 
- **USDC**: USD Coin at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (6 decimals)

**Token Mapping:**
```
Ethereum → STRATO Token Addresses:
- ETH: 0x0000...0000 → 0x93fb7295859b2d70199e0a4883b7c320cf874e6c
- USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 → 0x3d351a4a339f6eef7371b0b1b025b3a434ad0399
```

**Missing Asset Type Analysis:**
- ❌ **Fee-on-transfer tokens**: Not handled - could cause accounting discrepancies
- ❌ **Rebasing tokens**: Not supported - dynamic balance changes not tracked  
- ❌ **Permit-enabled tokens**: Not utilized - missing gasless approval functionality
- ❌ **ERC-721/1155 NFTs**: Not supported
- ❌ **Liquid Staking Tokens (LSTs/LRTs)**: Not supported
- ❌ **Real World Assets (RWAs)**: Not supported
- ❌ **Stablecoins beyond USDC**: Limited selection

---

## ⛓️ Chains & Finality Analysis

### ⚠️ **Inadequate Finality Handling** [High]

**Supported Chain Configuration:**

**Ethereum Side:**
- **Testnet**: Sepolia (Chain ID: 11155111)
- **Mainnet**: Ethereum Mainnet (Chain ID: 1)
- **RPC**: Configurable via `ETHEREUM_RPC_URL`

**STRATO Side:**
- **Network**: Mercata testnet
- **RPC**: Configurable via `NODE_URL`

**Critical Finality Issues:**

#### 1. **No Confirmation Thresholds**
- Bridge processes transactions immediately upon receipt status `0x1` 
- No minimum block confirmation requirements
- Risk of processing reorged transactions

#### 2. **Aggressive Polling Intervals**
```javascript
polling: {
  bridgeInInterval: 100 * 1000,     // 100 seconds - too aggressive
  bridgeOutInterval: 3 * 60 * 1000, // 3 minutes
}
```

#### 3. **Missing Safety Mechanisms**
- ❌ No reorg protection implemented
- ❌ No chain halt detection
- ❌ No rollback handling mechanism  
- ❌ No deep confirmation for large amounts

**Recommendations:**
- Implement minimum 6-12 block confirmations for Ethereum
- Add reorg detection and rollback capabilities
- Implement different confirmation thresholds based on transaction size
- Add chain health monitoring

---

## 👹 Adversaries & Attack Vectors

### ⚠️ **Multiple High-Risk Attack Vectors** [High]

**Identified Threat Actors:**

#### 1. **Malicious Relayer** 🚨 **CRITICAL**
**Attack Capabilities:**
- **Unlimited Minting**: Call `confirmDeposit()` with fabricated Ethereum transaction hashes
- **Withdrawal Denial**: Refuse to call required state transition functions
- **False Confirmations**: Mark non-existent transactions as completed
- **Economic Impact**: Complete drainage of bridge reserves

**Attack Scenarios:**
- Mint millions of wrapped tokens without backing deposits
- Steal user funds by preventing legitimate withdrawals
- Create artificial token supply inflation

#### 2. **Safe Signer Collusion** 🚨 **CRITICAL** 
**Attack Capabilities:**
- **Fund Theft**: Direct access to all locked ETH/USDC in Safe wallet
- **Withdrawal Blocking**: Refuse to sign legitimate withdrawal requests
- **Economic Impact**: Loss of all bridged assets on Ethereum side

#### 3. **Key Compromise Scenarios** 🚨 **CRITICAL**
**Compromise Impacts:**
- **Relayer Key**: Complete bridge control, unlimited minting/burning
- **Owner Key**: Ability to replace relayer with malicious actor
- **Safe Signer Keys**: Partial to complete control over locked funds

#### 4. **Infrastructure Failure** ⚠️ **HIGH**
**Failure Modes:**
- **Alchemy API Outage**: Prevents deposit event monitoring
- **STRATO Node Issues**: Blocks transaction execution
- **Email System Failure**: Delays withdrawal approvals
- **Network Partitions**: Creates inconsistent bridge state

#### 5. **MEV/Front-running Attacks** ⚠️ **MEDIUM**
**Attack Vectors:**
- **Withdrawal Front-running**: MEV bots can delay withdrawal execution
- **Deposit Racing**: Competition for profitable arbitrage opportunities
- **Gas Price Manipulation**: Force transaction delays through network congestion

#### 6. **Social Engineering** ⚠️ **MEDIUM**
**Attack Vectors:**
- **Safe Signer Compromise**: Target individual multisig signers
- **Phishing Attacks**: Target relayer operator credentials
- **Supply Chain**: Compromise bridge service dependencies

---

## ⚖️ Safety vs Liveness Analysis

### ❌ **Unsafe Continuation Preferred** [High]

**Current Policy Problems:**

#### 1. **No Circuit Breakers**
- Bridge continues operating during infrastructure failures
- No automatic pause mechanisms for anomalous behavior
- No rate limiting for large transactions

#### 2. **Inadequate Error Handling**
```javascript
} catch (e: any) {
  console.error('❌ Polling error:', e.message);
  // Don't stop polling on errors, let it retry on next interval
}
```
- Errors are logged but bridge continues operating
- No escalation for repeated failures
- No manual intervention triggers

#### 3. **Missing Timeout Mechanisms**
- No timeout handling for stuck transactions
- No deadlock detection for incomplete state transitions
- Withdrawal approvals can remain pending indefinitely

#### 4. **No Emergency Procedures**
- No documented incident response plan
- No emergency contact procedures
- No fund recovery mechanisms

**Recommended Safety-First Design:**

#### ✅ **Implement Circuit Breakers**
- Automatic bridge pause after N consecutive failures
- Rate limiting for transactions above threshold amounts
- Manual override capabilities for operators

#### ✅ **Add Monitoring & Alerts**
- Real-time monitoring of bridge health metrics
- Automated alerts for anomalous behavior
- Integration with incident response systems

#### ✅ **Timeout & Recovery Mechanisms**
- Transaction timeout handling with automatic retries
- State recovery procedures for incomplete transactions
- Manual intervention capabilities for edge cases

#### ✅ **Emergency Procedures**
- Documented incident response playbooks
- Emergency pause mechanisms
- Fund recovery procedures for various failure modes

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **Centralized Relayer Trust** - Single point of failure with unlimited minting authority
2. **Missing Finality Protections** - No confirmation requirements or reorg handling  
3. **No Emergency Pause** - Bridge continues operating during failures

### 🟡 **HIGH RISKS**
1. **Limited Asset Support** - Missing support for complex token types
2. **Safe Multisig Trust** - Unknown threshold and signer configuration
3. **Inadequate Error Handling** - Unsafe continuation during infrastructure failures

### 🟢 **MEDIUM RISKS**
1. **MEV/Front-running** - Withdrawal transactions vulnerable to manipulation
2. **Social Engineering** - Human factors in key management and operations

---

## 🔧 Immediate Action Items

### **Priority 1 - Critical Security**
1. Implement multi-signature requirement for relayer operations
2. Add minimum block confirmation requirements (6-12 blocks)
3. Implement emergency pause mechanisms

### **Priority 2 - Infrastructure Hardening** 
1. Document Safe multisig configuration and signer identities
2. Add circuit breakers for repeated failures
3. Implement transaction timeout and retry logic

### **Priority 3 - Operational Security**
1. Create incident response procedures
2. Add comprehensive monitoring and alerting
3. Document key management and rotation procedures

---

**End of Chapter 0 Analysis**