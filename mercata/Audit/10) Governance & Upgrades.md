# Mercata Bridge Security Audit - Chapter 10: Governance & Upgrades

**Audit Date:** July 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge governance model exhibits **critical security vulnerabilities** through centralized control mechanisms without proper safeguards. The analysis reveals **CRITICAL risks** in admin role management, complete absence of upgrade simulation processes, and missing key rotation procedures that create systemic risks for user funds and platform security.

---

## 👑 Admin Roles & Scopes Analysis

### ❌ **CENTRALIZED SINGLE-OWNER CONTROL** [Critical]

**Current Admin Architecture:**

The system employs multiple layers of centralized control without multi-signature protection or timelock mechanisms:

#### **1. Bridge Owner Powers (Immediate Effect)**

**Primary Bridge Admin:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:93-102
function setRelayer(address newRelayer) external onlyOwner {
    require(newRelayer != address(0), "ZERO_ADDR");
    emit RelayerUpdated(relayer, newRelayer);
    relayer = newRelayer; // ⚠️ Immediate unlimited mint/burn authority
}

function setMinAmount(uint256 newMin) external onlyOwner {
    emit MinAmountUpdated(minAmount, newMin);
    minAmount = newMin; // ⚠️ Can effectively pause bridge by setting extremely high minimum
}
```

**Critical Owner Capabilities:**
- **Unlimited Minting Power**: Can replace relayer with malicious actor who mints unlimited unbacked tokens
- **Bridge Shutdown**: Can set minimum amounts to effectively halt all operations
- **Immediate Execution**: All changes take effect in the same transaction with zero delay
- **No Oversight**: Single key controls entire bridge without multi-signature or DAO approval

#### **2. Token Access Control System**

**Multi-Layered Admin Structure:**
```solidity
// mercata/contracts/concrete/Tokens/TokenAccess.sol:18-34
modifier onlyAdmin() {
    require(msg.sender == admin, "TokenAccess: caller is not admin");
    _;
}

function transferAdmin(address newAdmin) external onlyAdmin {
    require(newAdmin != address(0), "TokenAccess: new admin is zero address");
    emit AdminTransferred(admin, newAdmin);
    admin = newAdmin; // ⚠️ Immediate transfer, no confirmation
}
```

**Token Admin Powers:**
- **Minter Management**: Add/remove addresses with unlimited minting authority
- **Burner Management**: Add/remove addresses with unlimited burning authority  
- **Admin Transfer**: Can transfer admin rights to any address immediately

#### **3. AdminRegistry Centralized Control**

**System-Wide Admin Management:**
```solidity
// mercata/contracts/concrete/Admin/AdminRegistry.sol:28-43
function addAdmin(address admin) external onlyOwner {
    require(admin != address(0), "AdminRegistry: cannot add zero address");
    require(!isAdmin[admin], "AdminRegistry: already admin");
    isAdmin[admin] = true;
    emit AdminAdded(admin);
}

function removeAdmin(address admin) external onlyOwner {
    require(isAdmin[admin], "AdminRegistry: not an admin");
    isAdmin[admin] = false;
    emit AdminRemoved(admin);
}
```

**Registry Owner Powers:**
- **Global Admin Control**: Add/remove admin accounts across entire system
- **Immediate Effect**: Changes take effect without delay or multi-signature approval
- **System-Wide Impact**: Admin status affects multiple contracts and services

#### **4. Token Status Control**

**Token Lifecycle Management:**
```solidity
// mercata/contracts/concrete/Tokens/Token.sol:49-56
function setStatus(uint newStatus) external onlyAdmin {
    require(newStatus != uint(status), "Token: New status is the same as the current status");
    require(newStatus != uint(TokenStatus.NULL), "Token: New status is NULL");
    TokenStatus _newStatus = TokenStatus(newStatus);
    status = _newStatus;
    emit StatusChanged(status);
}
```

**Status Control Powers:**
- **Token Lifecycle**: Can change tokens between PENDING, ACTIVE, and LEGACY states
- **Bridge Disruption**: Can disable tokens by setting to LEGACY status
- **No Safeguards**: No timelock or multi-signature requirements

### **Missing Governance Safeguards:**

**No Multi-Signature Protection:**
```solidity
// ❌ No such protection exists
contract BridgeMultiSig {
    uint256 public constant REQUIRED_SIGNATURES = 3;
    uint256 public constant TOTAL_SIGNERS = 5;
    
    mapping(bytes32 => mapping(address => bool)) public confirmations;
    mapping(bytes32 => uint256) public confirmationCount;
    
    function submitTransaction(
        address target,
        bytes calldata data
    ) external onlySigners returns (bytes32 txId) {
        // Multi-signature implementation - not deployed
    }
}
```

**No Timelock Implementation:**
```solidity
// ❌ No such timelock exists
contract BridgeTimelock {
    uint256 public constant MINIMUM_DELAY = 48 hours;
    uint256 public constant MAXIMUM_DELAY = 30 days;
    
    struct QueuedTransaction {
        bytes32 txHash;
        address target;
        bytes data;
        uint256 eta;
        bool executed;
    }
    
    function queueTransaction(
        address target,
        bytes calldata data,
        uint256 eta
    ) external onlyGovernance returns (bytes32) {
        require(eta >= block.timestamp + MINIMUM_DELAY, "Insufficient delay");
        // Timelock implementation - not deployed
    }
}
```

**No DAO or Community Governance:**
```solidity
// ❌ No such governance exists
contract BridgeGovernance {
    struct Proposal {
        uint256 id;
        address proposer;
        address[] targets;
        bytes[] calldatas;
        uint256 startBlock;
        uint256 endBlock;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
    }
    
    function propose(
        address[] calldata targets,
        bytes[] calldata calldatas,
        string calldata description
    ) external returns (uint256) {
        // DAO governance implementation - not deployed
    }
}
```

---

## 🧪 Upgrade Simulation Analysis

### ❌ **NO UPGRADE SIMULATION INFRASTRUCTURE** [High]

**Current State:**
The Mercata Bridge deployment process completely lacks formal upgrade simulation, staging environments, and post-upgrade invariant verification systems.

#### **1. Missing Staging Environment**

**No Dedicated Test Networks:**
```bash
# mercata/README.md:41 - Only basic environment flags
NETWORK options are: testnet|prod

# ❌ No staging/simulation environment exists
# Missing: staging, upgrade-test, invariant-check environments
```

**Current Testing Infrastructure:**
- **Basic Dev Mode**: Local development with hardcoded contract addresses
- **Testnet**: Direct deployment to testnet without pre-upgrade simulation
- **Production**: Direct deployment to mainnet without formal testing

**Missing Staging Architecture:**
```yaml
# ❌ No such staging infrastructure exists
staging-environments:
  upgrade-simulation:
    description: "Fork-based environment for testing upgrades"
    chain-fork: "mainnet-fork-latest"
    contracts: "production-state-snapshot"
    purpose: "Dry-run upgrades before mainnet deployment"
    
  invariant-testing:
    description: "Automated post-upgrade validation"
    checks:
      - "Conservation invariants (totalMinted ≤ totalLocked)"
      - "Access control integrity"
      - "State migration correctness" 
      - "Event emission consistency"
    
  integration-testing:
    description: "Full user flow testing post-upgrade"
    scenarios:
      - "Deposit → Mint flow"
      - "Withdraw → Burn flow"
      - "Emergency pause/unpause"
      - "Admin role transitions"
```

#### **2. No Dry-Run Upgrade Process**

**Missing Pre-Deployment Simulation:**
```typescript
// ❌ No such upgrade simulation exists
interface UpgradeSimulation {
  environment: 'mainnet-fork' | 'staging';
  preUpgradeState: ContractState;
  upgradeActions: UpgradeAction[];
  postUpgradeValidation: ValidationCheck[];
  rollbackPlan: RollbackAction[];
}

class UpgradeSimulator {
  async simulateUpgrade(simulation: UpgradeSimulation): Promise<UpgradeResult> {
    // 1. Snapshot current state
    const preState = await this.captureState(simulation.preUpgradeState);
    
    // 2. Execute upgrade actions
    const upgradeResult = await this.executeUpgrade(simulation.upgradeActions);
    
    // 3. Run post-upgrade validation
    const validationResult = await this.validateUpgrade(simulation.postUpgradeValidation);
    
    // 4. Test rollback if needed
    if (!validationResult.success) {
      await this.testRollback(simulation.rollbackPlan);
    }
    
    return { preState, upgradeResult, validationResult };
  }
}
```

**Current Deployment Reality:**
```bash
# Current deployment process (simplified)
# mercata/README.md:84-98
sudo \
  OAUTH_DISCOVERY_URL=https://keycloak.blockapps.net/auth/realms/REALM-NAME-HERE/.well-known/openid-configuration \
  docker compose up -d --build
  
# ⚠️ Direct to production without simulation
# ⚠️ No pre-upgrade state validation
# ⚠️ No post-upgrade invariant checks
# ⚠️ No rollback testing
```

#### **3. Missing Post-Upgrade Invariant Validation**

**No Automated Invariant Checks:**
```typescript
// ❌ No such post-upgrade validation exists
interface PostUpgradeInvariantCheck {
  name: string;
  critical: boolean;
  validator: (state: ContractState) => Promise<InvariantResult>;
}

const CRITICAL_INVARIANTS: PostUpgradeInvariantCheck[] = [
  {
    name: "Conservation Invariant",
    critical: true,
    validator: async (state) => {
      // Verify totalMinted ≤ totalLocked for each asset
      for (const asset of state.supportedAssets) {
        const locked = await state.getLockedBalance(asset);
        const minted = await state.getTotalSupply(asset);
        if (minted > locked) {
          return { success: false, error: `Asset ${asset}: minted ${minted} > locked ${locked}` };
        }
      }
      return { success: true };
    }
  },
  {
    name: "Access Control Integrity",
    critical: true,
    validator: async (state) => {
      // Verify admin roles haven't been corrupted
      const expectedRoles = await state.getExpectedRoles();
      const actualRoles = await state.getCurrentRoles();
      return { success: expectedRoles.equals(actualRoles) };
    }
  },
  {
    name: "Bridge State Consistency",
    critical: true,
    validator: async (state) => {
      // Verify no orphaned transactions or inconsistent states
      const pendingDeposits = await state.getPendingDeposits();
      const pendingWithdrawals = await state.getPendingWithdrawals();
      return { success: this.validateStateMachine(pendingDeposits, pendingWithdrawals) };
    }
  }
];
```

**Missing Automated Verification:**
```javascript
// mercata/contracts/deploy/deployment-scripts/postRestart/initLendingContracts.js:215-225
// Limited price verification exists but no bridge-specific invariants
const verifyResults = await callListAndWait(verifyPriceCalls);
const zeroPrices = (Array.isArray(verifyResults) ? verifyResults : [verifyResults])
  .filter(({ price }) => price === "0" || price === 0 || price === "0x0");

if (zeroPrices.length) {
  console.error("\n❌ Price verification failed – zero price for:");
  throw new Error("Price verification failed");
}
// ⚠️ Only checks oracle prices, not bridge conservation or access control
```

#### **4. No Rollback Testing**

**Missing Rollback Procedures:**
```solidity
// ❌ No such rollback capability exists
contract BridgeUpgradeManager {
    struct UpgradeCheckpoint {
        uint256 blockNumber;
        bytes32 stateHash;
        address[] contractAddresses;
        mapping(address => bytes) contractCode;
    }
    
    function createUpgradeCheckpoint() external onlyGovernance returns (uint256 checkpointId) {
        // Create state snapshot before upgrade - not implemented
    }
    
    function rollbackToCheckpoint(uint256 checkpointId) external onlyEmergency {
        // Emergency rollback to previous state - not implemented
    }
    
    function validateUpgradeIntegrity() external view returns (bool) {
        // Post-upgrade validation - not implemented
    }
}
```

---

## 🔄 Key Rotation Analysis

### ❌ **NO FORMAL KEY ROTATION PROCEDURES** [High]

#### **1. Missing Rotation Cadence**

**No Scheduled Key Rotation:**
```typescript
// ❌ No such rotation system exists
interface KeyRotationSchedule {
  keyType: 'owner' | 'relayer' | 'admin' | 'safe-signer';
  currentKey: string;
  rotationInterval: number; // days
  lastRotation: Date;
  nextRotation: Date;
  emergencyRotation: boolean;
}

class KeyRotationManager {
  private rotationSchedules: Map<string, KeyRotationSchedule> = new Map();
  
  async scheduleRegularRotation(keyType: string, intervalDays: number): Promise<void> {
    // Schedule automated key rotation - not implemented
  }
  
  async executeRotation(keyType: string, newKey: string): Promise<void> {
    // Execute key rotation with proper validation - not implemented
  }
  
  async validateRotation(keyType: string): Promise<boolean> {
    // Validate rotation was successful - not implemented
  }
}
```

**Current Key Management Reality:**
- **Static Keys**: All keys stored in environment variables without rotation
- **Manual Process**: No automated or scheduled rotation procedures
- **No Documentation**: Missing rotation schedules or procedures
- **No Coordination**: No process for coordinating rotation across multiple services

#### **2. No Forced-Rotation Drills**

**Missing Emergency Procedures:**
```typescript
// ❌ No such drill system exists
interface RotationDrill {
  drillId: string;
  scheduledDate: Date;
  keyTypes: string[];
  scenario: 'routine' | 'emergency' | 'compromise';
  participants: string[];
  objectives: string[];
  success: boolean;
  lessons: string[];
}

class RotationDrillManager {
  async scheduleRotationDrill(
    scenario: 'routine' | 'emergency' | 'compromise',
    keyTypes: string[]
  ): Promise<RotationDrill> {
    // Schedule practice rotation drill - not implemented
  }
  
  async executeRotationDrill(drillId: string): Promise<DrillResult> {
    // Execute rotation drill with timing and validation - not implemented
  }
  
  async generateDrillReport(drillId: string): Promise<DrillReport> {
    // Generate post-drill analysis and improvements - not implemented
  }
}
```

**Current State:**
- **No Practice Runs**: Never tested key rotation procedures under time pressure
- **No Emergency Protocols**: Missing procedures for urgent key compromise scenarios
- **No Team Training**: Personnel not trained on rotation procedures
- **No Tooling**: Missing automated tools for rapid key rotation

#### **3. Missing Compromised-Key Incident Runbook**

**No Incident Response Procedures:**
```markdown
# ❌ No such runbook exists

## COMPROMISED KEY INCIDENT RESPONSE RUNBOOK

### IMMEDIATE ACTIONS (0-15 minutes)
1. **STOP ALL OPERATIONS**
   - [ ] Pause bridge operations immediately
   - [ ] Revoke compromised key access
   - [ ] Notify all system administrators

2. **ASSESS SCOPE OF COMPROMISE**
   - [ ] Identify which keys are compromised
   - [ ] Check for unauthorized transactions
   - [ ] Assess potential fund exposure

3. **EMERGENCY ROTATION**
   - [ ] Generate new keys using secure procedure
   - [ ] Update all affected contracts
   - [ ] Verify new keys are working correctly

### RECOVERY ACTIONS (15-60 minutes)
4. **SYSTEM VERIFICATION**
   - [ ] Run full invariant checks
   - [ ] Verify no unauthorized state changes
   - [ ] Check all pending transactions

5. **COMMUNICATION**
   - [ ] Notify users about temporary service halt
   - [ ] Prepare incident report
   - [ ] Coordinate with security team

### POST-INCIDENT (1+ hours)
6. **FORENSIC ANALYSIS**
   - [ ] Investigate compromise vector
   - [ ] Review access logs
   - [ ] Identify security improvements

7. **SERVICE RESTORATION**
   - [ ] Gradually restore service
   - [ ] Monitor for anomalous behavior
   - [ ] Update incident response procedures
```

**Current Reality:**
- **No Runbook**: Missing documented incident response procedures
- **No Emergency Contacts**: No defined escalation tree for security incidents
- **No Communication Plan**: No pre-written user notifications for security events
- **No Recovery Testing**: Never tested recovery from key compromise scenario

#### **4. Inadequate Key Storage and Protection**

**Current Key Management Issues:**
```bash
# Current key storage approach
# mercata/services/bridge/README.md:52-56
SAFE_OWNER_PRIVATE_KEY=your-private-key-here
CLIENT_SECRET=your-oauth-secret-here
# ⚠️ Stored as plaintext environment variables
# ⚠️ No HSM or secure enclave protection
# ⚠️ No key derivation or multi-signature protection
```

**Missing Key Protection Infrastructure:**
```typescript
// ❌ No such secure key management exists
interface SecureKeyManager {
  keyId: string;
  keyType: 'owner' | 'relayer' | 'admin';
  protection: 'hsm' | 'tee' | 'multi-sig' | 'social-recovery';
  derivationPath?: string;
  rotationHistory: KeyRotationRecord[];
}

class HSMKeyManager implements SecureKeyManager {
  async generateKey(keyType: string): Promise<string> {
    // Generate key in HSM - not implemented
  }
  
  async rotateKey(keyId: string): Promise<void> {
    // Rotate key with HSM protection - not implemented
  }
  
  async signTransaction(keyId: string, txData: bytes): Promise<Signature> {
    // Sign using HSM-protected key - not implemented
  }
}
```

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **Centralized Single-Owner Control** - Bridge owner can instantly replace relayer with malicious actor and mint unlimited unbacked tokens
2. **No Upgrade Simulation** - Direct production deployments without testing could introduce critical vulnerabilities
3. **No Key Rotation Procedures** - Static keys with no rotation increase compromise risk over time

### 🟡 **HIGH RISKS**  
1. **No Multi-Signature Protection** - All admin operations controlled by single keys without multi-signature validation
2. **Missing Timelock Delays** - All parameter changes take immediate effect without community review period
3. **No Post-Upgrade Validation** - Could deploy broken upgrades that violate critical system invariants

### 🟢 **MEDIUM RISKS**
1. **No Emergency Response Procedures** - Missing incident response runbooks for key compromise scenarios
2. **Basic Access Control** - Token access management lacks sophisticated role-based permissions

---

## 🛠️ Recommendations

### **Priority 1 - Critical Governance Reform**
1. **Deploy Multi-Signature Governance**: Replace single owner with 3-of-5 multi-signature wallet for all admin operations
2. **Implement Timelock Delays**: Add minimum 48-hour delay for all parameter changes with community review period
3. **Create Emergency Pause Mechanisms**: Deploy circuit breaker functionality that doesn't require admin keys

### **Priority 2 - Upgrade Safety Infrastructure**
1. **Build Staging Environment**: Create mainnet fork-based environment for upgrade simulation and testing
2. **Implement Post-Upgrade Validation**: Deploy automated invariant checking after all contract upgrades
3. **Create Rollback Procedures**: Build emergency rollback capability for failed upgrades

### **Priority 3 - Key Management Security**
1. **Deploy HSM/TEE Protection**: Move all critical keys to hardware security modules or secure enclaves
2. **Implement Regular Key Rotation**: Create automated 90-day rotation schedule for all system keys
3. **Create Incident Response Runbook**: Document and test procedures for key compromise scenarios

### **Priority 4 - Advanced Governance Features**
1. **Consider DAO Governance**: Explore community governance mechanisms for major protocol changes
2. **Add Formal Verification**: Mathematical proofs for upgrade safety and invariant preservation
3. **Implement Social Recovery**: Multi-factor key recovery mechanisms for emergency scenarios

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Deploy multi-signature wallet to replace single owner control
- [ ] Implement timelock delays for all admin functions
- [ ] Create emergency pause functionality independent of admin keys

### **Short-term Goals (Month 1)**  
- [ ] Build mainnet fork staging environment for upgrade testing
- [ ] Implement automated post-upgrade invariant validation
- [ ] Create key rotation procedures and schedule first rotation

### **Medium-term Objectives (Quarter 1)**
- [ ] Deploy HSM-based key management system
- [ ] Create comprehensive incident response runbooks
- [ ] Test full upgrade simulation and rollback procedures

### **Long-term Vision (Quarter 2)**
- [ ] Implement community governance mechanisms
- [ ] Add formal verification for upgrade safety
- [ ] Deploy fully automated key rotation and monitoring systems

---

## 🚨 Critical Action Items

### **Immediate Risk Mitigation Required:**

1. **Replace Single Owner Control**:
   ```solidity
   // Deploy immediately
   contract BridgeMultiSig {
       uint256 public constant REQUIRED_SIGNATURES = 3;
       // Multi-signature implementation
   }
   ```

2. **Add Timelock Protection**:
   ```solidity
   // Deploy immediately  
   contract BridgeTimelock {
       uint256 public constant MINIMUM_DELAY = 48 hours;
       // Timelock implementation
   }
   ```

3. **Create Emergency Procedures**:
   ```markdown
   # Deploy immediately
   EMERGENCY_PAUSE_PROCEDURE.md
   - Emergency contact list
   - Pause procedure steps
   - Communication templates
   ```

---

**Governance Security Status: CRITICAL RISK** 🔴

The Mercata Bridge governance model poses **immediate threats to user funds** through centralized control without safeguards. The current owner can instantly mint unlimited unbacked tokens by replacing the relayer, with no timelock, multi-signature, or community oversight. **Immediate governance reform is essential** before any production deployment.

---

**End of Chapter 10 Analysis** 