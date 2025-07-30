# Mercata Bridge Security Audit - Chapter 12: Cross-Domain Nuances (Rollups/L2s)

**Audit Date:** July 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Network Architecture:** Ethereum ↔ STRATO (Independent Blockchains)  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge operates between **Ethereum (public blockchain)** and **STRATO (BlockApps' independent blockchain)**, not between L1 and L2 rollups. However, the system exhibits **CRITICAL cross-domain vulnerabilities** including inadequate finality handling, address validation gaps, and centralized relayer dependencies that create similar risks to rollup bridge failures without the benefit of rollup security mechanisms.

---

## 🏗️ Architecture Clarification

### ❌ **NOT A ROLLUP BRIDGE - INDEPENDENT BLOCKCHAIN BRIDGE** [Context]

**Network Architecture:**
- **Source Chain**: Ethereum Mainnet/Sepolia (Public Blockchain)
- **Destination Chain**: STRATO Mercata Network (BlockApps Private Blockchain)
- **Bridge Pattern**: Lock/Mint across independent blockchain networks
- **Consensus**: Separate consensus mechanisms, no shared security

**Key Differences from L1↔L2 Rollups:**
```
Traditional Rollup Bridge:
├── L1 (Ethereum) - Settlement Layer
├── L2 (Rollup) - Execution Layer with L1 Security
├── Shared Security Model
├── Data Availability on L1
└── L1 Finality Inheritance

Mercata Bridge:
├── Ethereum - Independent Public Blockchain  
├── STRATO - Independent Private Blockchain
├── No Shared Security Model
├── Separate Data Availability
└── Independent Finality Requirements
```

**Architecture Evidence:**
```javascript
// mercata/services/bridge/bridge-in-seq.puml:11-13
database "\n  Safe Wallet  \n" as safeWallet  // Ethereum
database "\n  STRATO Node \n" as strato       // Independent blockchain
```

**Implications:**
- ✅ **No Rollup Complexities**: Avoids rollup-specific vulnerabilities like fraud proof manipulation
- ❌ **No Shared Security**: Cannot inherit Ethereum's security guarantees
- ❌ **Higher Trust Requirements**: Must trust both network operators independently
- ❌ **Complex Cross-Chain Coordination**: No built-in finality relationships

---

## ⚡ Native Rollup Bridges Analysis

### ❌ **NO ROLLUP MECHANICS - BUT FINALITY GAPS EXIST** [High]

Since this is not a rollup bridge, traditional rollup finality windows don't apply. However, **cross-chain finality coordination** presents similar critical risks:

#### **1. Missing Inclusion/Finality Windows**

**Current Implementation Issues:**
```javascript
// mercata/services/bridge/src/polling/alchemyPolling.ts:53-65
const completedTxHashes = batchResponses.filter((res: any) => res?.result?.status === "0x1");

if (!completedTxHashes.length) {
    console.log('⚠️ No valid receipts with transaction hashes found');
    return;
}

await confirmBridgeinSafePolling(completedTxHashes); // ⚠️ Immediate processing
```

**Finality Problems:**
- **Zero Confirmations**: Processes Ethereum transactions immediately upon receipt status `0x1`
- **No Reorg Protection**: No mechanism to handle Ethereum blockchain reorganizations
- **Aggressive Polling**: 100-second intervals too fast for safe finality

**Missing Safety Mechanisms:**
```javascript
// ❌ Should implement proper finality windows
const FINALITY_REQUIREMENTS = {
  ETHEREUM_MAINNET: {
    SMALL_AMOUNT: 6,   // blocks for < $1,000
    MEDIUM_AMOUNT: 12, // blocks for < $10,000  
    LARGE_AMOUNT: 20,  // blocks for > $10,000
    REORG_DEPTH: 7     // Maximum expected reorg depth
  },
  STRATO_NETWORK: {
    CONFIRMATIONS: 1,  // STRATO finality requirements
    TIMEOUT: 300      // Maximum wait time in seconds
  }
};
```

#### **2. Message Replay After Reorg**

**Current Vulnerability:**
```javascript
// mercata/services/bridge/src/polling/alchemyPolling.ts:35
bridgingService -> bridgingService: Keep track of already processed txns 
(TBD: HOW? MAKE SURE NOT TO PROCESS SAME txn_hash twice)
```

**Reorg Attack Scenario:**
1. **User Deposits**: 1000 USDC to Safe wallet on Ethereum
2. **Bridge Processes**: Immediately confirms and mints 1000 USDCST on STRATO
3. **Ethereum Reorgs**: Original deposit transaction disappears from chain
4. **User Withdraws**: Drains 1000 USDCST before reorg is detected
5. **Result**: Bridge has minted unbacked tokens

**Missing Reorg Protection:**
```javascript
// ❌ No such reorg detection exists
class ReorgDetector {
  private processedBlocks = new Map<number, string>();
  
  async detectReorg(currentBlock: number): Promise<ReorgEvent | null> {
    // Check if previously processed blocks have changed
    // Invalidate affected transactions
    // Not implemented
  }
  
  async handleReorg(reorgEvent: ReorgEvent): Promise<void> {
    // Reverse inappropriate state changes
    // Halt bridge operations
    // Notify administrators
    // Not implemented
  }
}
```

#### **3. Cross-Chain Finality Coordination**

**Missing Coordination Logic:**
```typescript
// ❌ No such coordination exists
interface CrossChainFinality {
  ethereumBlock: number;
  ethereumConfirmations: number;
  stratoBlock: number;
  stratoConfirmations: number;
  finalityAchieved: boolean;
  reorgRisk: 'low' | 'medium' | 'high';
}

class FinalityCoordinator {
  async assessFinality(ethTxHash: string): Promise<CrossChainFinality> {
    // Assess finality on both chains
    // Not implemented
  }
  
  async waitForSafeFinality(ethTxHash: string, amount: bigint): Promise<boolean> {
    // Wait for appropriate confirmations based on amount
    // Not implemented
  }
}
```

---

## 📍 Address Aliasing Analysis

### ⚠️ **NO ROLLUP ADDRESS ALIASING - BUT MAPPING VULNERABILITIES** [High]

Traditional L1↔L2 address aliasing doesn't apply, but **cross-chain address mapping** creates similar security concerns:

#### **1. Token Address Mapping Vulnerabilities**

**Static Mapping Configuration:**
```javascript
// mercata/services/bridge/src/controllers/bridgeController.ts:23-24
const ETH_STRATO_TOKEN_MAPPING = process.env.SHOW_TESTNET === 'true' ? TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING;
const STRATO_TOKENS = process.env.SHOW_TESTNET === 'true' ? TESTNET_STRATO_TOKENS : MAINNET_STRATO_TOKENS;
```

**Hardcoded Address Mappings:**
```javascript
// From previous analysis
Ethereum → STRATO Token Addresses:
- ETH: 0x0000...0000 → 0x93fb7295859b2d70199e0a4883b7c320cf874e6c
- USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 → 0x3d351a4a339f6eef7371b0b1b025b3a434ad0399
```

**Security Issues:**
- **Static Configuration**: No runtime validation of address mappings
- **No Derivation Rules**: Missing cryptographic address derivation
- **Collision Risk**: No protection against mapping collisions
- **Update Vulnerabilities**: Manual mapping updates could introduce errors

#### **2. Missing Address Derivation Protection**

**No Cryptographic Derivation:**
```solidity
// ❌ No such derivation protection exists
contract BridgeAddressDerivation {
    function deriveWrappedTokenAddress(
        uint256 originChainId,
        address originToken,
        bytes32 salt
    ) public pure returns (address) {
        // Deterministic address derivation
        // Should prevent collision attacks
        // Not implemented
    }
    
    function validateAddressMapping(
        address originToken,
        address wrappedToken
    ) public view returns (bool) {
        // Verify mapping follows derivation rules
        // Not implemented
    }
}
```

#### **3. User-Supplied System Address Risks**

**Current Address Handling:**
```javascript
// mercata/services/bridge/src/controllers/bridgeController.ts:261-262
const stratoTokenAddress = ETH_STRATO_TOKEN_MAPPING[tokenAddress as keyof typeof ETH_STRATO_TOKEN_MAPPING] || tokenAddress;
```

**Missing Protection:**
```javascript
// ❌ Should prevent system address abuse
const SYSTEM_ADDRESSES = {
  ETHEREUM: [
    '0x0000000000000000000000000000000000000000', // Zero address
    '0x0000000000000000000000000000000000000001', // Precompile
    // ... other precompiles
  ],
  STRATO: [
    // STRATO system addresses should be blacklisted
  ]
};

function validateUserAddress(address: string, network: 'ethereum' | 'strato'): boolean {
  const systemAddresses = SYSTEM_ADDRESSES[network.toUpperCase()];
  if (systemAddresses.includes(address.toLowerCase())) {
    throw new Error(`System address not allowed: ${address}`);
  }
  return true;
}
```

#### **4. Address Format Inconsistencies**

**Limited Cross-Chain Validation:**
```javascript
// mercata/ui/src/utils/misc.ts:77-82
if (!isAddress(trimmed)) return "Invalid address";
// ⚠️ Only validates Ethereum address format
// No STRATO-specific address validation
```

**Missing Comprehensive Validation:**
```typescript
// ❌ Should implement cross-chain address validation
interface AddressValidator {
  validateEthereumAddress(address: string): boolean;
  validateSTRATOAddress(address: string): boolean;
  validateCrossChainCompatibility(ethAddr: string, stratoAddr: string): boolean;
  detectAddressPoisoning(address: string): boolean;
}
```

---

## 🔒 Data Availability & Sequencer Risk Analysis

### ❌ **NO ROLLUP DA/SEQUENCER - BUT CENTRALIZED RELAYER RISKS** [High]

While traditional rollup DA/sequencer risks don't apply, the **centralized relayer architecture** creates analogous single points of failure:

#### **1. Relayer as "Sequencer" Equivalent**

**Centralized Transaction Processing:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:75
modifier onlyRelayer() { require(msg.sender == relayer, "NOT_RELAYER"); _; }
```

**Relayer Control Scope:**
- **Transaction Ordering**: Relayer determines order of bridge operations
- **Inclusion Control**: Can choose which transactions to process
- **Censorship Power**: Can refuse to process legitimate transactions
- **Double-Spend Risk**: Could attempt to process same transaction multiple times

#### **2. Missing Safe Mode Mechanisms**

**No Relayer Halt Protection:**
```typescript
// ❌ No such safe mode exists
interface SafeMode {
  enabled: boolean;
  trigger: 'relayer_halt' | 'data_unavailable' | 'manual';
  actions: {
    haltNewDeposits: boolean;
    haltNewWithdrawals: boolean;
    enableEmergencyWithdrawals: boolean;
    notifyUsers: boolean;
  };
}

class BridgeSafeMode {
  async activateSafeMode(trigger: string): Promise<void> {
    // Halt risky operations
    // Enable emergency procedures
    // Notify all stakeholders
    // Not implemented
  }
  
  async detectRelayerHalt(): Promise<boolean> {
    // Monitor relayer activity
    // Detect unusual inactivity periods
    // Return true if intervention needed
    // Not implemented
  }
}
```

#### **3. No Optimistic Path Disable**

**Missing Fallback Mechanisms:**
```javascript
// ❌ Current implementation has no fallback when relayer fails
// Should implement emergency procedures:

const EMERGENCY_PROCEDURES = {
  RELAYER_OFFLINE: {
    maxInactivityPeriod: 3600, // 1 hour
    actions: [
      'HALT_NEW_DEPOSITS',
      'ENABLE_EMERGENCY_WITHDRAWALS', 
      'NOTIFY_MULTISIG_SIGNERS',
      'ACTIVATE_BACKUP_RELAYER'
    ]
  },
  DATA_UNAVAILABLE: {
    maxDataLag: 1800, // 30 minutes
    actions: [
      'DISABLE_FAST_CONFIRMATIONS',
      'REQUIRE_MANUAL_VERIFICATION',
      'INCREASE_CONFIRMATION_THRESHOLDS'
    ]
  }
};
```

#### **4. Dependency Monitoring Gaps**

**Current State - No Monitoring:**
```javascript
// mercata/Audit/9) Oracles & External Dependencies.md:256-260
**Current State: Not Applicable**
- **No Sequencer Dependencies**: STRATO uses different consensus mechanism
- **No Bridge Aggregators**: Direct bridge implementation without aggregation layer
- **No AVS/Restaking**: No actively validated services or restaking providers
- **No Data Availability Layers**: Direct blockchain interaction without DA providers
```

**Missing Infrastructure Health Checks:**
```typescript
// ❌ Should implement comprehensive monitoring
class InfrastructureMonitor {
  async checkSTRATOHealth(): Promise<{
    nodeResponsive: boolean;
    consensusActive: boolean;
    mempool: number;
    lastBlockTime: number;
  }> {
    // Monitor STRATO network health
    // Not implemented
  }
  
  async checkEthereumHealth(): Promise<{
    rpcResponsive: boolean;
    gasPrice: number;
    pendingTransactions: number;
    reorgRisk: 'low' | 'medium' | 'high';
  }> {
    // Monitor Ethereum network health  
    // Not implemented
  }
  
  async checkBridgeHealth(): Promise<{
    relayerActive: boolean;
    safeSignersAvailable: number;
    pendingTransactions: number;
    invariantsValid: boolean;
  }> {
    // Monitor bridge component health
    // Not implemented
  }
}
```

---

## ⚠️ Cross-Domain Security Gaps Summary

### **1. Finality Coordination Issues**
- **Immediate Processing**: No confirmation thresholds for Ethereum transactions
- **Reorg Vulnerability**: Zero protection against blockchain reorganizations
- **No Cross-Chain Coordination**: Missing finality relationship management

### **2. Address Security Concerns**
- **Static Mappings**: Hardcoded address relationships without validation
- **No Derivation Rules**: Missing cryptographic address derivation protection
- **System Address Risks**: No blacklisting of system/precompile addresses

### **3. Centralized Control Risks**
- **Single Relayer**: No redundancy or failover mechanisms
- **No Safe Mode**: Missing emergency procedures for relayer failures
- **Censorship Risk**: Relayer can refuse to process legitimate transactions

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **Zero-Confirmation Processing** - Bridge processes Ethereum transactions immediately without waiting for finality, vulnerable to reorg attacks
2. **Single Relayer Control** - Centralized transaction processing creates sequencer-like risks without safety mechanisms
3. **No Emergency Procedures** - Missing safe mode activation when critical components fail

### 🟡 **HIGH RISKS**  
1. **Static Address Mappings** - Hardcoded token mappings lack cryptographic derivation and validation
2. **Missing Reorg Protection** - No detection or handling of blockchain reorganizations
3. **No Infrastructure Monitoring** - Cannot detect or respond to network health issues

### 🟢 **MEDIUM RISKS**
1. **Limited Address Validation** - Basic address format checking without cross-chain compatibility
2. **No Dependency Health Checks** - Missing monitoring for external service degradation

---

## 🛠️ Recommendations

### **Priority 1 - Finality Safety**
1. **Implement Confirmation Thresholds**: Require 6-12 confirmations for Ethereum transactions based on amount
2. **Add Reorg Detection**: Monitor blockchain reorganizations and invalidate affected transactions
3. **Deploy Cross-Chain Finality Coordination**: Ensure proper finality on both chains before execution

### **Priority 2 - Address Security**
1. **Implement Cryptographic Address Derivation**: Use deterministic derivation for token address mappings
2. **Add System Address Blacklisting**: Prevent user-supplied system/precompile addresses
3. **Deploy Cross-Chain Address Validation**: Comprehensive validation for both Ethereum and STRATO formats

### **Priority 3 - Operational Resilience**
1. **Create Relayer Failover System**: Deploy backup relayers with automatic failover
2. **Implement Safe Mode Mechanisms**: Automatic halt procedures when critical components fail
3. **Add Infrastructure Health Monitoring**: Real-time monitoring of all bridge dependencies

### **Priority 4 - Advanced Security**
1. **Deploy Emergency Withdrawal System**: Allow users to exit during relayer failures
2. **Add Cryptographic Proof Systems**: Reduce trust requirements through mathematical verification
3. **Implement Formal Finality Analysis**: Mathematical models for cross-chain finality coordination

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Add minimum 6-block confirmation requirement for Ethereum transactions
- [ ] Implement basic reorg detection for recent blocks
- [ ] Create system address blacklist for both chains

### **Short-term Goals (Month 1)**  
- [ ] Deploy cryptographic address derivation system
- [ ] Implement relayer health monitoring and alerting
- [ ] Add safe mode activation procedures

### **Medium-term Objectives (Quarter 1)**
- [ ] Create backup relayer system with automatic failover
- [ ] Implement comprehensive infrastructure health monitoring
- [ ] Deploy emergency withdrawal mechanisms

### **Long-term Vision (Quarter 2)**
- [ ] Add light client verification for trustless operation
- [ ] Implement formal cross-chain finality coordination
- [ ] Deploy comprehensive proof systems for all bridge operations

---

## 🚨 Critical Implementation Required

### **Immediate Finality Protection:**

```javascript
// CRITICAL: Add to bridge service immediately
class FinalityProtection {
  private readonly CONFIRMATION_REQUIREMENTS = {
    SMALL_AMOUNT: 6,   // < $1,000
    MEDIUM_AMOUNT: 12, // < $10,000  
    LARGE_AMOUNT: 20   // > $10,000
  };
  
  async waitForFinality(txHash: string, amount: bigint): Promise<boolean> {
    const requiredConfirmations = this.getRequiredConfirmations(amount);
    let confirmations = 0;
    
    while (confirmations < requiredConfirmations) {
      const receipt = await this.ethereum.getTransactionReceipt(txHash);
      const currentBlock = await this.ethereum.getBlockNumber();
      confirmations = currentBlock - receipt.blockNumber;
      
      // Check for reorgs
      if (await this.detectReorg(receipt.blockNumber)) {
        throw new Error('Transaction invalidated by reorg');
      }
      
      await this.sleep(30000); // Wait 30 seconds
    }
    
    return true;
  }
  
  private async detectReorg(blockNumber: number): Promise<boolean> {
    // Implementation needed
    return false;
  }
}
```

---

**Cross-Domain Security Status: CRITICAL RISK** 🔴

While the Mercata Bridge avoids traditional rollup complexities, it exhibits **critical cross-domain vulnerabilities** through zero-confirmation processing, centralized relayer control, and missing emergency procedures. The absence of finality coordination and reorg protection creates immediate risks of unbacked token minting during blockchain reorganizations.

---

**End of Chapter 12 Analysis** 