# Mercata Bridge Security Audit - Chapter 13: UI/UX & Developer Surfaces

**Audit Date:** January 2025  
**Bridge Version:** Current STRATO Platform Implementation  
**Analysis Scope:** User Interface, API Services, Developer Tools  
**Auditor:** Security Assessment Team  

---

## Executive Summary

The Mercata Bridge UI/UX and developer surfaces exhibit **CRITICAL usability and security vulnerabilities** including hardcoded quotes without integrity verification, missing human-readable signing interfaces, inadequate error resolution guidance, and basic API hardening. While the system demonstrates solid foundational patterns, **significant gaps in user safety mechanisms** create risks for both end users and integrating developers.

---

## 💰 Quote Integrity Analysis

### ❌ **HARDCODED STATIC QUOTES - NO INTEGRITY** [Medium]

**Current Quote Display Implementation:**

**Bridge Fee Display:**
```typescript
// mercata/ui/src/components/bridge/BridgeIn.tsx:604-612
<div className="bg-gray-50 p-4 rounded-md space-y-2">
  <div className="flex justify-between text-sm">
    <span className="text-gray-500">Bridge Fee:</span>
    <span>0.1%</span>  {/* ❌ Hardcoded, not calculated */}
  </div>
  <div className="flex justify-between text-sm">
    <span className="text-gray-500">Estimated Time:</span>
    <span>2-5 minutes</span>  {/* ❌ Static estimate */}
  </div>
</div>
```

**Swap Quote Implementation (Contrast):**
```typescript
// mercata/ui/src/components/swap/SwapWidget.tsx:999-1017
<div className="flex justify-between text-sm">
  <span className="text-gray-600 decoration-2">Exchange Rate</span>
  <span className="font-medium">
    1 {fromAsset?._symbol || ""} ≈ {formatAmount(exchangeRate)} {toAsset?._symbol || ""}
  </span>
</div>
<div className="flex justify-between text-sm">
  <span className="text-gray-400">Exchange Rate (Spot)</span>
  <span className="font-medium text-gray-400">
    {oracleLoading ? (
      <LoadingSpinner />
    ) : oracleExchangeRate === "0" ? (
      "Price data unavailable"
    ) : (
      <>1 {oracleDisplayFromSymbol} ≈ {formatAmount(oracleExchangeRate)} {oracleDisplayToSymbol}</>
    )}
  </span>
</div>
```

### **Critical Missing Features:**

#### **1. No Dynamic Fee Calculation**
```typescript
// ❌ Current: Static display
const BRIDGE_FEE_DISPLAY = "0.1%";

// ✅ Should implement: Dynamic calculation
interface BridgeQuote {
  bridgeFee: {
    percentage: number;
    absolute: string;
    tokenSymbol: string;
  };
  estimatedTime: {
    min: number;
    max: number;
    factors: string[];
  };
  netAmount: string;
  minOut: string;
  quoteId: string;
  expiry: number;
}

async function generateBridgeQuote(
  token: string, 
  amount: string, 
  fromChain: string, 
  toChain: string
): Promise<BridgeQuote> {
  // Calculate actual fees based on:
  // - Network gas costs
  // - Relayer fees  
  // - Protocol fees
  // - Slippage tolerance
  // Not implemented
}
```

#### **2. Missing Quote-Message Binding**
```typescript
// ❌ No such binding exists
interface QuoteBinding {
  quoteId: string;
  messageId: string;
  userAddress: string;
  expiry: number;
  params: {
    token: string;
    amount: string;
    fromChain: string;
    toChain: string;
  };
  signature: string;
}

class QuoteManager {
  private quotes = new Map<string, QuoteBinding>();
  
  async bindQuoteToMessage(quote: BridgeQuote, messageId: string): Promise<void> {
    // Cryptographically bind quote to message
    // Prevent quote manipulation attacks
    // Not implemented
  }
  
  async validateQuoteForExecution(quoteId: string, messageId: string): Promise<boolean> {
    // Verify quote is still valid for execution
    // Check expiry and parameters
    // Not implemented
  }
}
```

#### **3. No Stale Quote Warnings**
```typescript
// ❌ Current: No quote freshness tracking
// ✅ Should implement: Quote staleness detection
class QuoteFreshnessTracker {
  private readonly QUOTE_FRESHNESS_THRESHOLD = 30000; // 30 seconds
  
  async checkQuoteFreshness(quoteId: string): Promise<{
    isStale: boolean;
    ageSeconds: number;
    shouldRefresh: boolean;
  }> {
    // Track quote age and warn users
    // Not implemented
  }
  
  displayStaleQuoteWarning(quote: BridgeQuote): React.Component {
    // UI warning for outdated quotes
    // Not implemented
  }
}
```

### **Current Implementation Gap:**

**Missing Net Amount Display:**
```typescript
// ❌ Current: Shows gross amount only
// mercata/ui/src/components/bridge/BridgeIn.tsx:591-596
<p className="bg-blue-50 p-2 rounded-md border border-blue-100">
  You will receive {amount ? `${amount} ` : ""}{" "}
  {selectedToken?.exchangeTokenName} (
  {selectedToken?.exchangeTokenSymbol}) on STRATO network
</p>

// ✅ Should show: Net amount after fees
<p className="bg-blue-50 p-2 rounded-md border border-blue-100">
  You will receive {netAmount} {tokenSymbol} (
  after {feeAmount} {tokenSymbol} bridge fee)
</p>
```

---

## ✍️ Human-Readable Signing Analysis

### ⚠️ **EIP-712 AVAILABLE BUT UNDERUTILIZED** [High]

**EIP-712 Implementation Status:**

**Available Infrastructure:**
```solidity
// mercata/contracts/abstract/ERC20/extensions/ERC20Permit.sol:20-39
abstract contract ERC20Permit is ERC20, IERC20Permit, EIP712, Nonces {
    bytes32 private constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    constructor(string memory name) EIP712(name, "1") {}
    
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) public virtual {
        // EIP-712 signature validation implemented
    }
}
```

**Current Usage Gap:**
```typescript
// ❌ Current: Basic wallet signing without EIP-712 context
// mercata/ui/src/components/bridge/BridgeIn.tsx:393-412
const txHash = await writeContractAsync({
  address: tokenAddress as `0x${string}`,
  abi: [
    {
      name: "transfer",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ],
  functionName: "transfer",
  args: [safeAddress as `0x${string}`, parseUnits(amount, 6)],
});
```

### **Missing Human-Readable Signing:**

#### **1. No EIP-712 Bridge Messages**
```typescript
// ❌ Should implement: Human-readable bridge signatures
interface BridgeMessage {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
  };
  types: {
    BridgeTransfer: {
      name: string;
      type: string;
    }[];
  };
  message: {
    fromChain: string;
    toChain: string;
    asset: string;
    amount: string;
    recipient: string;
    nonce: number;
    expiry: number;
  };
}

async function signBridgeMessage(message: BridgeMessage): Promise<string> {
  // Present human-readable signing interface
  // "You are bridging 100 USDC from Ethereum to STRATO"
  // "Recipient: 0x123..."
  // "Expires: January 15, 2025 at 3:30 PM"
  // Not implemented
}
```

#### **2. Raw Hex Approval Risks**
```typescript
// ⚠️ Current: Direct contract interaction without human context
// User sees raw hex data instead of:
// "Approve 100 USDC for bridge transfer to STRATO network"

// ✅ Should implement: Human-readable approval context
interface ApprovalContext {
  operation: "bridge_deposit" | "bridge_withdrawal" | "swap" | "lending";
  asset: {
    symbol: string;
    name: string;
    amount: string;
  };
  destination: {
    network: string;
    contract: string;
    purpose: string;
  };
  expiry?: Date;
  risks: string[];
}

function formatApprovalMessage(context: ApprovalContext): string {
  return `Approve ${context.asset.amount} ${context.asset.symbol} for ${context.operation} to ${context.destination.network}`;
}
```

#### **3. Missing Chain/Asset Context in Signatures**
```typescript
// ❌ Current: Generic transaction without context
// ✅ Should implement: Explicit chain/asset warnings
interface SigningContext {
  currentNetwork: {
    chainId: number;
    name: string;
    isTestnet: boolean;
  };
  targetNetwork: {
    chainId: number;
    name: string;
    bridgeContract: string;
  };
  asset: {
    address: string;
    symbol: string;
    decimals: number;
    isNative: boolean;
  };
  warnings: string[];
}

function generateSigningWarnings(context: SigningContext): string[] {
  const warnings = [];
  
  if (context.currentNetwork.isTestnet !== context.targetNetwork.isTestnet) {
    warnings.push("⚠️ Bridging between testnet and mainnet");
  }
  
  if (!context.asset.isNative && !isVerifiedToken(context.asset.address)) {
    warnings.push("⚠️ Unverified token contract");
  }
  
  return warnings;
}
```

---

## 🔧 Error/Resolution Guidance Analysis

### ❌ **LIMITED ERROR HANDLING - MISSING STUCK TRANSFER TOOLING** [Medium]

**Current Error Handling Implementation:**

**Basic API Error Mapping:**
```typescript
// mercata/ui/src/lib/errorConfig.ts:42-50
export const API_ERROR_TITLES: Record<string, string> = {
  // Bridge operations 
  "/bridge/config": "Bridge Configuration Error",
  "/bridge/bridgeInTokens": "Bridge In Tokens Error",
  "/bridge/bridgeOutTokens": "Bridge Out Tokens Error",
  "/bridge/bridgeIn": "Bridge In Error",
  "/bridge/bridgeOut": "Bridge Out Error",
  "/bridge/balance": "Bridge Balance Error",
  "/bridge/depositStatus": "Deposit Status Error",
  "/bridge/withdrawalStatus": "Withdrawal Status Error",
};
```

**Basic Error Extraction:**
```typescript
// mercata/backend/src/utils/txHelper.ts:30-67
const extractErrorMessage = (rawError: string): string => {
  // Extract Solidity error messages
  const solidityMatch = rawError.match(/SString "([^"]+)"/);
  if (solidityMatch) {
    return solidityMatch[1];
  }
  return rawError;
};
```

### **Critical Missing Features:**

#### **1. No Stuck Transfer Resolution Tools**
```typescript
// ❌ No such tooling exists
interface StuckTransferDiagnostic {
  transactionHash: string;
  status: 'pending' | 'failed' | 'stuck' | 'expired';
  blockNumber: number;
  confirmations: number;
  estimatedTimeRemaining: number;
  possibleActions: {
    canCancel: boolean;
    canRefund: boolean;
    canForceExecute: boolean;
    canProveExecution: boolean;
  };
  diagnosticSteps: {
    step: string;
    status: 'pending' | 'success' | 'failed';
    action?: string;
  }[];
}

class StuckTransferResolver {
  async diagnoseTx(txHash: string): Promise<StuckTransferDiagnostic> {
    // Analyze transaction state across both chains
    // Determine available recovery options
    // Not implemented
  }
  
  async attemptRefund(txHash: string): Promise<TransactionResult> {
    // Execute refund if transaction is refundable
    // Not implemented
  }
  
  async forceExecute(txHash: string, proof: string): Promise<TransactionResult> {
    // Force execution with cryptographic proof
    // Not implemented
  }
  
  async proveExecution(txHash: string): Promise<ExecutionProof> {
    // Generate proof of execution for manual claims
    // Not implemented
  }
}
```

#### **2. Missing Self-Serve Status Pages**
```typescript
// ❌ No comprehensive status tracking
// ✅ Should implement: Bridge status dashboard
interface BridgeStatusDashboard {
  systemHealth: {
    ethereum: 'operational' | 'degraded' | 'down';
    strato: 'operational' | 'degraded' | 'down';
    relayer: 'operational' | 'degraded' | 'down';
    safe: 'operational' | 'degraded' | 'down';
  };
  recentTransactions: TransactionStatus[];
  knownIssues: {
    id: string;
    title: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    affectedFeatures: string[];
    estimatedResolution: Date;
    workaround?: string;
  }[];
  maintenanceSchedule: {
    start: Date;
    end: Date;
    affectedFeatures: string[];
    description: string;
  }[];
}

class StatusPageManager {
  async getSystemStatus(): Promise<BridgeStatusDashboard> {
    // Aggregate real-time status from all components
    // Not implemented
  }
  
  async getTransactionStatus(txHash: string): Promise<DetailedTransactionStatus> {
    // Comprehensive transaction lifecycle tracking
    // Not implemented
  }
}
```

#### **3. Limited Recovery Guidance**
```typescript
// ❌ Current: Basic error messages
// mercata/services/bridge/src/controllers/bridgeController.ts:279-288
} catch (error: any) {
  logger.error("Error in bridgeIn:", error?.message);
  
  const errorMessage = error?.message || error?.toString() || 'Unknown error';
  res.status(400).json({ 
    success: false, 
    message: errorMessage 
  });
}

// ✅ Should implement: Actionable recovery guidance
interface ErrorRecoveryGuidance {
  errorCode: string;
  userFriendlyMessage: string;
  possibleCauses: string[];
  suggestedActions: {
    action: string;
    description: string;
    automated: boolean;
    estimatedTime: string;
  }[];
  escalationPath?: {
    supportTicket: boolean;
    discordChannel?: string;
    knowledgeBaseUrl?: string;
  };
}

class ErrorRecoveryManager {
  async generateRecoveryGuidance(error: Error, context: TransactionContext): Promise<ErrorRecoveryGuidance> {
    // Analyze error and provide actionable recovery steps
    // Not implemented
  }
}
```

---

## 🛠️ SDK/API Hardening Analysis

### ⚠️ **BASIC VALIDATION WITH GAPS** [Medium]

**Current API Hardening Implementation:**

**Input Validation:**
```typescript
// mercata/services/bridge/src/controllers/bridgeController.ts:213-220
// Validate required fields
if (!ethHash) {
  res.status(400).json({ 
    success: false, 
    message: 'Missing ethHash parameter' 
  });
  return;
}
```

**Transaction Validation:**
```typescript
// mercata/services/bridge/src/controllers/bridgeController.ts:237-251
const validationErrors = validateTransactionDetails(
  transactionDetails,
  amount,
  tokenAddress,
  expectedToAddress
);

if (validationErrors.length > 0) {
  res.status(400).json({ 
    success: false, 
    message: 'Invalid amount or tokenAddress',
    errors: validationErrors
  });
  return;
}
```

**Timeout Configuration:**
```typescript
// mercata/services/bridge/src/utils/contractCall.ts:41
timeout: 30000, // 30 second timeout
```

### **Critical Hardening Gaps:**

#### **1. Missing ChainId Gates**
```typescript
// ❌ No explicit chainId validation
// ✅ Should implement: Strict chain validation
interface ChainValidation {
  requiredChainId: number;
  currentChainId: number;
  isValidChain: boolean;
  supportedChains: number[];
}

class ChainGuard {
  private readonly SUPPORTED_CHAINS = {
    ethereum: [1, 11155111], // Mainnet, Sepolia
    strato: [2018], // STRATO chain ID
  };
  
  async validateChain(chainId: number, operation: 'deposit' | 'withdraw'): Promise<ChainValidation> {
    // Strict chain validation for operations
    // Not implemented
  }
  
  async requireChainSwitch(targetChainId: number): Promise<boolean> {
    // Force chain switch before operations
    // Not implemented
  }
}
```

#### **2. No Asset Registry Sync**
```typescript
// ❌ Current: Static token mappings
const ETH_STRATO_TOKEN_MAPPING = process.env.SHOW_TESTNET === 'true' ? 
  TESTNET_ETH_STRATO_TOKEN_MAPPING : MAINNET_ETH_STRATO_TOKEN_MAPPING;

// ✅ Should implement: Dynamic asset registry
interface AssetRegistry {
  tokens: Map<string, TokenMetadata>;
  lastSync: Date;
  syncInterval: number;
}

class AssetRegistryManager {
  private registry: AssetRegistry = {
    tokens: new Map(),
    lastSync: new Date(0),
    syncInterval: 3600000 // 1 hour
  };
  
  async syncAssetRegistry(): Promise<void> {
    // Fetch latest token mappings from authoritative source
    // Validate token contracts
    // Update supported assets
    // Not implemented
  }
  
  async validateAsset(tokenAddress: string, chainId: number): Promise<boolean> {
    await this.ensureRegistryFresh();
    // Validate token exists and is supported
    // Not implemented
  }
}
```

#### **3. Missing Typed Interfaces**
```typescript
// ❌ Current: Generic any types
// mercata/services/bridge/src/utils/contractCall.ts:8
args: any,

// ✅ Should implement: Strict typing
interface BridgeDepositArgs {
  txHash: string;
  token: string;
  from: string;
  amount: string;
  to: string;
  mercataUser: string;
}

interface BridgeWithdrawArgs {
  txHash: string;
  from: string;
  token: string;
  amount: string;
  to: string;
  mercataUser: string;
}

interface ContractCallParams<T> {
  contractName: string;
  contractAddress: string;
  method: string;
  args: T;
}

async function typedContractCall<T, R>(
  params: ContractCallParams<T>
): Promise<R> {
  // Type-safe contract interactions
  // Not implemented
}
```

#### **4. Insufficient Default Timeouts**
```typescript
// ⚠️ Current: Single timeout value
timeout: 30000, // 30 seconds for all operations

// ✅ Should implement: Operation-specific timeouts
interface TimeoutConfig {
  contractCall: number;
  transactionConfirmation: number;
  balanceQuery: number;
  priceQuery: number;
  healthCheck: number;
}

const TIMEOUT_CONFIG: TimeoutConfig = {
  contractCall: 30000,      // 30 seconds
  transactionConfirmation: 300000, // 5 minutes
  balanceQuery: 10000,      // 10 seconds
  priceQuery: 5000,         // 5 seconds
  healthCheck: 3000,        // 3 seconds
};

class TimeoutManager {
  async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    // Implement operation-specific timeouts with proper error handling
    // Not implemented
  }
}
```

---

## 🎯 User Experience Gap Analysis

### **1. Quote System Deficiencies**
- **Static Fee Display**: 0.1% fee is hardcoded, not calculated from actual costs
- **No Slippage Protection**: Missing minOut guarantees for users
- **Missing Quote Expiry**: No freshness tracking or stale quote warnings
- **No Quote Binding**: Quotes not cryptographically bound to transactions

### **2. Signing Experience Issues**
- **Raw Hex Exposure**: Users see technical data instead of human-readable messages
- **Missing Context**: No explicit chain, asset, or operation warnings
- **Underutilized EIP-712**: Available infrastructure not used for bridge operations
- **Generic Approvals**: No operation-specific approval scoping

### **3. Error Handling Limitations**
- **Basic Error Messages**: Limited actionable guidance for users
- **No Stuck Transfer Tools**: Missing recovery mechanisms for failed operations
- **Limited Status Tracking**: No comprehensive transaction lifecycle visibility
- **Missing Self-Service**: Users cannot resolve common issues independently

### **4. API/SDK Security Gaps**
- **Weak Input Validation**: Basic parameter checking without comprehensive sanitization
- **No Chain Guards**: Missing strict chainId validation for operations
- **Static Asset Registry**: Hardcoded token mappings without dynamic updates
- **Generic Typing**: Loose type safety in critical API interactions

---

## 📊 Risk Assessment Summary

### 🔴 **CRITICAL RISKS**
1. **Missing Quote Integrity** - Hardcoded fees without dynamic calculation enable fee manipulation attacks
2. **Raw Hex Signing** - Users cannot understand what they're signing, enabling social engineering attacks
3. **No Stuck Transfer Recovery** - Users have no recourse when transactions fail, leading to fund loss

### 🟡 **HIGH RISKS**
1. **Underutilized EIP-712** - Missing human-readable signing increases phishing susceptibility
2. **Weak Chain Validation** - Missing chainId gates enable cross-chain operation errors
3. **Static Asset Registry** - Hardcoded token mappings prevent dynamic security updates

### 🟢 **MEDIUM RISKS**
1. **Basic Error Handling** - Limited error guidance reduces user recovery capabilities
2. **Generic API Typing** - Loose type safety increases development error risks
3. **Single Timeout Values** - Non-optimized timeouts affect user experience

---

## 🛠️ Recommendations

### **Priority 1 - Quote Safety**
1. **Implement Dynamic Fee Calculation**: Calculate fees based on real-time gas costs and relayer incentives
2. **Add Quote-Message Binding**: Cryptographically bind quotes to transactions to prevent manipulation
3. **Deploy Quote Freshness Tracking**: Warn users when quotes become stale and require refresh

### **Priority 2 - Signing Safety**
1. **Deploy EIP-712 Bridge Messages**: Implement human-readable signing for all bridge operations
2. **Add Approval Context**: Display operation-specific approval messages with clear risk warnings
3. **Implement Chain/Asset Warnings**: Explicit warnings for cross-chain operations and unverified tokens

### **Priority 3 - Error Recovery**
1. **Build Stuck Transfer Tooling**: Comprehensive diagnostic and recovery tools for failed transactions
2. **Create Self-Service Status Pages**: Real-time bridge status with transaction tracking capabilities
3. **Deploy Recovery Guidance System**: Actionable error messages with automated resolution options

### **Priority 4 - API Hardening**
1. **Implement Chain Guards**: Strict chainId validation before all operations
2. **Deploy Dynamic Asset Registry**: Real-time token validation with security updates
3. **Add Comprehensive Typing**: Type-safe interfaces for all API interactions

---

## 📋 Implementation Checklist

### **Immediate Actions (Week 1)**
- [ ] Replace hardcoded fees with dynamic calculation
- [ ] Add basic quote freshness warnings
- [ ] Implement chainId validation gates

### **Short-term Goals (Month 1)**
- [ ] Deploy EIP-712 human-readable signing
- [ ] Create basic stuck transfer diagnostic tools
- [ ] Add operation-specific approval messages

### **Medium-term Objectives (Quarter 1)**
- [ ] Build comprehensive status dashboard
- [ ] Implement dynamic asset registry
- [ ] Deploy automated error recovery system

### **Long-term Vision (Quarter 2)**
- [ ] Create advanced quote integrity system with binding
- [ ] Build full self-service recovery tooling
- [ ] Deploy comprehensive API typing framework

---

## 🚨 Critical Implementation Required

### **Immediate Quote Safety:**

```typescript
// CRITICAL: Add dynamic fee calculation immediately
interface DynamicBridgeQuote {
  baseFee: string;
  gasFee: string;
  relayerFee: string;
  totalFeeWei: string;
  totalFeeFormatted: string;
  netAmountWei: string;
  netAmountFormatted: string;
  estimatedTime: {
    min: number;
    max: number;
    confidence: number;
  };
  quoteId: string;
  expiry: number;
}

class QuoteEngine {
  async generateQuote(
    token: string,
    amount: string,
    fromChain: number,
    toChain: number
  ): Promise<DynamicBridgeQuote> {
    const baseFee = await this.calculateBaseFee(token, amount);
    const gasFee = await this.estimateGasCosts(fromChain, toChain);
    const relayerFee = await this.calculateRelayerFee(amount);
    
    const totalFeeWei = BigInt(baseFee) + BigInt(gasFee) + BigInt(relayerFee);
    const netAmountWei = BigInt(amount) - totalFeeWei;
    
    return {
      baseFee,
      gasFee,
      relayerFee,
      totalFeeWei: totalFeeWei.toString(),
      totalFeeFormatted: formatUnits(totalFeeWei, 18),
      netAmountWei: netAmountWei.toString(),
      netAmountFormatted: formatUnits(netAmountWei, 18),
      estimatedTime: await this.estimateTransferTime(fromChain, toChain),
      quoteId: generateQuoteId(),
      expiry: Date.now() + 300000 // 5 minutes
    };
  }
}
```

### **Human-Readable Signing:**

```typescript
// CRITICAL: Add EIP-712 bridge signing immediately
const BRIDGE_DOMAIN = {
  name: 'Mercata Bridge',
  version: '1',
  chainId: chainId,
  verifyingContract: bridgeAddress,
};

const BRIDGE_TYPES = {
  Transfer: [
    { name: 'asset', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'fromChain', type: 'string' },
    { name: 'toChain', type: 'string' },
    { name: 'recipient', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' }
  ]
};

async function signBridgeTransfer(transferData: any): Promise<string> {
  const message = {
    asset: transferData.tokenSymbol,
    amount: transferData.formattedAmount,
    fromChain: transferData.fromNetwork,
    toChain: transferData.toNetwork,
    recipient: transferData.recipient,
    nonce: transferData.nonce,
    expiry: transferData.expiry
  };
  
  // User sees: "Bridge 100 USDC from Ethereum to STRATO"
  // Instead of raw hex data
  const signature = await signer._signTypedData(BRIDGE_DOMAIN, BRIDGE_TYPES, message);
  return signature;
}
```

---

**UI/UX Security Status: HIGH RISK** 🟡

The Mercata Bridge demonstrates basic UI functionality but lacks critical user safety mechanisms. **Hardcoded quotes, missing human-readable signing, and limited error recovery tools** create significant risks for both end users and integrating developers. Immediate implementation of dynamic quotes and EIP-712 signing is essential for production readiness.

---

**End of Chapter 13 Analysis** 