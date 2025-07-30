# Mercata Bridge Security Audit - Chapter 9: Oracles & External Dependencies

**Audit Date:** July 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge ecosystem exhibits **critical dependencies on single points of failure** across multiple external services and lacks robust monitoring systems. The analysis reveals **CRITICAL vulnerabilities** in oracle independence, inadequate dependency management, missing SLA monitoring, and insufficient alerting systems that could lead to complete service failures and user fund loss.

---

## 🔗 Multiple Independent Sources Analysis

### ❌ **SINGLE RELAYER DOMINATES - NO INDEPENDENCE** [Critical]

**Current Architecture:**
The Mercata Bridge relies on a **single centralized relayer** rather than multiple independent sources or robust proof systems, creating the most critical single point of failure in the entire system.

**Single Relayer Implementation:**
```solidity
// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:75
modifier onlyRelayer() { require(msg.sender == relayer, "NOT_RELAYER"); _; }

// mercata/contracts/concrete/Bridge/MercataEthBridge.sol:93-97
function setRelayer(address newRelayer) external onlyOwner {
    require(newRelayer != address(0), "ZERO_ADDR");
    emit RelayerUpdated(relayer, newRelayer);
    relayer = newRelayer; // ⚠️ Single point of control
}
```

**Oracle Source Diversity Analysis:**
While the oracle system supports multiple API sources, **each asset relies on a single source**:

```json
// mercata/services/oracle/src/config/sources.json
{
  "Alchemy": {
    "urlTemplate": "https://api.g.alchemy.com/prices/v1/${API_KEY}/tokens/by-address",
    "apiKeyEnvVar": "ALCHEMY_API_KEY"
  },
  "Metals.dev": {
    "urlTemplate": "https://api.metals.dev/v1/latest?api_key=${API_KEY}&currency=USD&unit=toz",
    "apiKeyEnvVar": "METALS_API_KEY"
  },
  "LBMA": {
    "urlTemplate": "https://api.lbma.org.uk/json/lbma-${metal}"
  },
  "CoinGecko": {
    "urlTemplate": "https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&precision=full"
  }
}
```

**Asset-to-Source Mapping:**
```json
// mercata/services/oracle/src/config/feeds.json
{
  "name": "ETH-USD",
  "source": "Alchemy",    // ❌ Single source only
  "cron": "0 */1 * * *"
},
{
  "name": "USDC-USD", 
  "source": "Alchemy",    // ❌ Single source only
  "cron": "4 */1 * * *"
},
{
  "name": "XAU-USD",
  "source": "Metals.dev", // ❌ Single source only
  "cron": "5 */1 * * *"
}
```

**Missing Multi-Source Architecture:**
```typescript
// ❌ No such redundancy exists
interface MultiSourceOracle {
  primarySources: OracleSource[];
  fallbackSources: OracleSource[];
  aggregationMethod: 'median' | 'average' | 'weighted';
  deviationThreshold: number;
  minimumSources: number;
}

class RobustOracleSystem {
  async getPrice(asset: string): Promise<{price: number, confidence: number}> {
    const sources = this.config[asset];
    const prices = await Promise.allSettled(
      sources.primarySources.map(source => this.fetchPrice(source, asset))
    );
    
    const validPrices = prices
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value);
      
    if (validPrices.length < sources.minimumSources) {
      throw new Error(`Insufficient valid price sources: ${validPrices.length}/${sources.minimumSources}`);
    }
    
    return this.aggregatePrice(validPrices, sources.aggregationMethod);
  }
}
```

**Critical Single Points of Failure:**
1. **Bridge Relayer**: Single address controls all mint/burn operations
2. **Oracle Sources**: Each asset depends on one API provider  
3. **STRATO Authentication**: Single OAuth endpoint for all operations
4. **Safe Multisig**: Single multisig controls all locked funds
5. **Alchemy API**: Single provider for Ethereum transaction monitoring

**No Light-Client or Proof Systems:**
- ❌ **No Ethereum Light Client**: Could provide trustless transaction verification
- ❌ **No Merkle Proof Verification**: No cryptographic proof of origin chain events  
- ❌ **No STRATO Finality Proofs**: No cryptographic verification of destination chain state
- ❌ **No Consensus Mechanisms**: No validator set or committee-based validation

---

## 📋 Dependency Inventory & Failure Modes

### 🚨 **EXTENSIVE SINGLE-POINT DEPENDENCIES** [High]

**Critical External Dependencies:**

#### 1. **Blockchain Infrastructure Dependencies**

**STRATO Blockchain:**
- **Purpose**: Primary blockchain for wrapped tokens and bridge contracts
- **Endpoints**: Configurable via `NODE_URL` environment variable
- **Authentication**: OAuth2 with `CLIENT_ID` and `CLIENT_SECRET`
- **Failure Modes**:
  - Node downtime prevents all bridge operations
  - Network congestion blocks transaction execution  
  - Authentication service failure prevents contract calls
  - Chain halt or consensus failure stops all operations

**Ethereum Network:**
- **Purpose**: Origin chain for locked assets and deposit monitoring
- **RPC**: Configurable via `ETHEREUM_RPC_URL`
- **Failure Modes**:
  - RPC provider downtime breaks deposit monitoring
  - Network congestion delays withdrawal execution
  - Gas price spikes make operations uneconomical
  - Chain reorgs invalidate processed transactions

#### 2. **API Provider Dependencies**

**Alchemy API (Critical Path):**
```javascript
// mercata/services/bridge/bridge-in-seq.puml:31-36
// Primary dependency for Ethereum monitoring
alchemy -> bridgingService: Emit incoming Safe txns details
bridgingService -> alchemy: Poll for new transactions to Safe Wallet
```

- **Purpose**: Transaction monitoring, price feeds, WebSocket connections
- **API Keys**: `ALCHEMY_API_KEY` and `ALCHEMY_NETWORK`
- **Failure Modes**:
  - API outage stops all deposit processing
  - Rate limiting breaks real-time monitoring
  - WebSocket disconnections cause missed transactions
  - Authentication failures prevent data access

**Metals.dev API:**
- **Purpose**: Precious metals price feeds (Gold, Silver)
- **API Key**: `METALS_API_KEY`  
- **Failure Modes**:
  - API downtime stops precious metals price updates
  - Invalid API responses break oracle updates
  - Rate limiting delays price feed updates

**Other Oracle Sources:**
- **LBMA API**: London Bullion Market Association data
- **CoinGecko API**: Cryptocurrency price data
- **Failure Modes**: Service unavailability, rate limiting, data quality issues

#### 3. **Wallet & Custody Dependencies**

**Gnosis Safe Multisig:**
```javascript
// mercata/services/bridge/src/services/safeService.ts:50-54
state.protocolKit = await Safe.init({
  provider: config.ethereum.rpcUrl || "",
  signer: config.safe.safeOwnerPrivateKey || "",
  safeAddress: config.safe.address || "",
});
```

- **Purpose**: Custody of all locked Ethereum assets
- **Configuration**: `SAFE_ADDRESS`, `SAFE_OWNER_PRIVATE_KEY`, `SAFE_OWNER_ADDRESS`
- **Failure Modes**:
  - Signer unavailability prevents withdrawal execution
  - Safe Transaction Service downtime blocks operations
  - Multisig threshold issues stop fund releases
  - Key compromise enables fund theft

#### 4. **Communication Dependencies**

**Email System:**
```javascript
// mercata/services/bridge/src/services/bridgeService.ts:154
sendEmail(hash.toString()); // ⚠️ Critical for withdrawal approvals
```

- **Purpose**: Withdrawal approval notifications
- **Failure Modes**:
  - Email service downtime delays approvals
  - Spam filtering blocks critical notifications
  - Delivery failures leave withdrawals pending
  - No fallback communication methods

#### 5. **Infrastructure Dependencies**

**OAuth2 Authentication Service:**
- **Purpose**: STRATO blockchain authentication
- **Configuration**: `OPENID_DISCOVERY_URL`, `CLIENT_ID`, `CLIENT_SECRET`
- **Failure Modes**:
  - Authentication service downtime prevents all operations
  - Token expiration without refresh capability
  - Invalid credentials break service access

**Missing Infrastructure:**
```typescript
// ❌ No such monitoring exists
interface DependencyHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'failing';
  lastCheck: Date;
  responseTime: number;
  uptime: number;
  errorRate: number;
}

class DependencyMonitor {
  private dependencies: Map<string, DependencyHealth> = new Map();
  
  async checkHealth(service: string): Promise<DependencyHealth> {
    // Health check implementation
    // Not implemented in current system
  }
  
  getSystemHealth(): { status: string, criticalFailures: string[] } {
    // Overall system health assessment 
    // Not implemented in current system
  }
}
```

#### 6. **Sequencer & Bridge Aggregator Dependencies** 

**Current State: Not Applicable**
- **No Sequencer Dependencies**: STRATO uses different consensus mechanism
- **No Bridge Aggregators**: Direct bridge implementation without aggregation layer
- **No AVS/Restaking**: No actively validated services or restaking providers
- **No Data Availability Layers**: Direct blockchain interaction without DA providers

**Missing Keeper Networks:**
- **No Automated Execution**: Manual relayer operations without keeper automation
- **No Liquidation Keepers**: Manual liquidation processes in lending system
- **No Price Update Keepers**: Cron-based oracle updates without keeper redundancy

---

## 📊 SLA & Alerting Analysis

### ❌ **NO FORMAL SLA MONITORING OR ALERTING** [Medium]

**Current Monitoring State:**
The system lacks formal SLA definitions, monitoring dashboards, and alerting mechanisms for external dependencies.

**Basic Logging Infrastructure:**
```typescript
// mercata/services/bridge/src/utils/logger.ts:3-18
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

**Error Handling Without Escalation:**
```typescript
// mercata/services/oracle/src/utils/oraclePusher.ts:89-105
} catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    
    // Basic retry logic but no alerting
    if (errorMessage.includes('Rejected from mempool') && retryCount < maxRetries) {
        console.log(`Transaction rejected from mempool (attempt ${retryCount + 1}/${maxRetries + 1}). Retrying after delay...`);
        const delay = 2000 + (retryCount * 3000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await callListAndWait(callListArgs, retryCount + 1);
    }
    
    console.error(`[OraclePusher] Error in callListAndWait:`, errorMessage); // ❌ Only console logging
    throw error;
}
```

**Missing SLA Framework:**
```typescript
// ❌ No such SLA system exists
interface ServiceSLA {
  service: string;
  uptime: number;          // e.g., 99.9%
  responseTime: number;    // e.g., 500ms p95
  errorRate: number;       // e.g., < 0.1%
  alertThresholds: {
    uptimeBelow: number;   // e.g., 99.0%
    responseTimeAbove: number; // e.g., 1000ms
    errorRateAbove: number;    // e.g., 1.0%
  };
  escalationPath: string[];
}

class SLAMonitor {
  private slas: Map<string, ServiceSLA> = new Map();
  
  async checkSLA(service: string): Promise<{
    compliant: boolean;
    violations: string[];
    metrics: ServiceMetrics;
  }> {
    // SLA compliance checking
    // Not implemented
  }
  
  async triggerAlert(service: string, violation: string, severity: 'warning' | 'critical'): Promise<void> {
    // Alert triggering and escalation
    // Not implemented  
  }
}
```

**Current Dependency SLA Requirements (Recommended):**

| **Service** | **Uptime** | **Response Time** | **Error Rate** | **Recovery Time** |
|-------------|------------|-------------------|----------------|-------------------|
| **STRATO Node** | 99.9% | < 1s | < 0.1% | < 5 minutes |
| **Ethereum RPC** | 99.9% | < 2s | < 0.1% | < 5 minutes |
| **Alchemy API** | 99.9% | < 500ms | < 0.1% | < 2 minutes |
| **Safe Multisig** | 99.5% | < 30s | < 1% | < 15 minutes |
| **Oracle Sources** | 99.0% | < 5s | < 1% | < 10 minutes |
| **Email System** | 95.0% | < 60s | < 5% | < 30 minutes |

**Missing Alert Categories:**
```typescript
// ❌ No such alerting exists
enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning', 
  CRITICAL = 'critical',
  EMERGENCY = 'emergency'
}

interface Alert {
  service: string;
  severity: AlertSeverity;
  message: string;
  timestamp: Date;
  escalationLevel: number;
  acknowledged: boolean;
  resolvedAt?: Date;
}

class AlertManager {
  async sendAlert(alert: Alert): Promise<void> {
    // Multi-channel alerting (email, SMS, Slack, PagerDuty)
    // Not implemented
  }
  
  async escalateAlert(alertId: string): Promise<void> {
    // Escalation to higher-level on-call engineers
    // Not implemented
  }
}
```

**On-Call Escalation Tree (Missing):**
```typescript
// ❌ No such escalation exists
interface EscalationLevel {
  level: number;
  contacts: {
    type: 'email' | 'sms' | 'slack' | 'pagerduty';
    address: string;
    responseTime: number; // minutes
  }[];
  autoEscalateAfter: number; // minutes
}

const ESCALATION_TREE: EscalationLevel[] = [
  {
    level: 1,
    contacts: [
      { type: 'slack', address: '#bridge-alerts', responseTime: 5 },
      { type: 'email', address: 'bridge-team@mercata.com', responseTime: 15 }
    ],
    autoEscalateAfter: 15
  },
  {
    level: 2, 
    contacts: [
      { type: 'pagerduty', address: 'critical-bridge-issues', responseTime: 10 },
      { type: 'sms', address: '+1-555-ON-CALL', responseTime: 5 }
    ],
    autoEscalateAfter: 30
  },
  {
    level: 3,
    contacts: [
      { type: 'sms', address: '+1-555-CTO', responseTime: 5 },
      { type: 'email', address: 'executives@mercata.com', responseTime: 60 }
    ],
    autoEscalateAfter: 60
  }
];
```

**Missing Monitoring Dashboards:**
- ❌ **Real-time Dependency Health**: No dashboard showing service status
- ❌ **SLA Compliance Tracking**: No metrics on uptime and performance
- ❌ **Alert History & Trends**: No analysis of recurring issues
- ❌ **Recovery Time Analytics**: No measurement of incident resolution
- ❌ **Dependency Impact Assessment**: No analysis of cascading failures

**Error Handling Gaps:**
```javascript
// Current basic error handling
// mercata/Audit/0) Scoping & Threat Model.md:207-216
} catch (e: any) {
  console.error('❌ Polling error:', e.message);
  // Don't stop polling on errors, let it retry on next interval  ❌ No escalation
}
```

**Missing Proactive Monitoring:**
- ❌ **Health Check Endpoints**: No automated dependency testing
- ❌ **Circuit Breakers**: No automatic fallback when dependencies fail
- ❌ **Graceful Degradation**: No reduced functionality modes during outages
- ❌ **Dependency Redundancy**: No backup systems for critical services
- ❌ **Performance Baselines**: No established normal operating parameters

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **Single Relayer Dependency** - Complete bridge control through one address with no redundancy or proof systems
2. **Alchemy API Single Point of Failure** - All Ethereum monitoring depends on one API provider
3. **No Formal SLA Monitoring** - Cannot detect or respond to dependency degradation

### 🟡 **HIGH RISKS**  
1. **Oracle Source Dependencies** - Each asset relies on single API provider without fallbacks
2. **Safe Multisig Dependency** - All locked funds controlled by single multisig without backup custody
3. **No Alerting Infrastructure** - Manual detection of service failures and dependency issues

### 🟢 **MEDIUM RISKS**
1. **Basic Error Handling** - Some retry logic exists but without proper escalation
2. **Email System Dependency** - Critical notifications rely on single communication channel

---

## 🛠️ Recommendations

### **Priority 1 - Critical Redundancy**
1. **Implement Multi-Relayer Architecture**: Deploy threshold signature scheme with M-of-N relayers
2. **Add Oracle Source Redundancy**: Require multiple price sources per asset with deviation monitoring
3. **Deploy Backup Infrastructure**: Secondary RPC providers and API keys for all critical services

### **Priority 2 - Monitoring & Alerting**
1. **Implement SLA Monitoring System**: Define and track uptime, response time, and error rates
2. **Deploy Alerting Infrastructure**: Multi-channel alerts with escalation procedures
3. **Create Dependency Health Dashboard**: Real-time visibility into all external service status

### **Priority 3 - Resilience & Recovery**
1. **Add Circuit Breakers**: Automatic fallback mechanisms during dependency failures
2. **Implement Graceful Degradation**: Reduced functionality modes during partial outages
3. **Deploy Health Check Systems**: Automated dependency testing and validation

### **Priority 4 - Advanced Reliability**
1. **Consider Light-Client Integration**: Reduce trust assumptions through cryptographic proofs
2. **Add Keeper Network Integration**: Automated execution redundancy for critical operations
3. **Implement Dependency Rotation**: Automatic failover between equivalent service providers

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Audit and document all external dependencies with their failure modes
- [ ] Implement basic health check endpoints for critical services
- [ ] Set up centralized logging aggregation for all services

### **Short-term (Month 1)**  
- [ ] Deploy secondary RPC providers and API keys for redundancy
- [ ] Implement basic SLA monitoring for critical dependencies
- [ ] Create alert notifications for service degradation

### **Medium-term (Month 3)**
- [ ] Deploy multi-source oracle aggregation with deviation monitoring
- [ ] Implement comprehensive alerting with escalation procedures
- [ ] Add circuit breakers and graceful degradation mechanisms

### **Long-term (Month 6)**
- [ ] Design and implement multi-relayer threshold signature system
- [ ] Deploy comprehensive dependency monitoring dashboard
- [ ] Add automated dependency rotation and failover capabilities

---

**Conclusion:** The Mercata Bridge's extensive reliance on single points of failure across multiple external dependencies creates systemic risk that could result in complete service failure and user fund loss. Implementing redundancy, monitoring, and alerting systems is critical for production readiness and user safety. 