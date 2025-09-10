# Adjustable transaction size

## TL;DR

The STRATO blockchain platform currently has a hardcoded transaction size limit
of 2 MiB that is configured via command-line flags at node startup. We've
encountered real-world scenarios where smart contracts exceed this limit,
requiring workarounds like adding them to the genesis block during network
restarts. While this approach works for current network restarts, it highlights
the need for operational flexibility to adjust transaction size limits when
requirements change. The current system requires coordinated restarts across the
entire network to change the limit, making it inflexible for future operational
needs. This document proposes making the transaction size limit configurable
on-chain through governance mechanisms, allowing for dynamic adjustments without
requiring hard forks or coordinated restarts.

## Current Design

### Transaction Size Configuration

The transaction size limit is currently defined as a command-line flag in
`strato/core/strato-model/src/Blockchain/Strato/Model/Options.hs:12`:

```haskell
defineFlag "txSizeLimit" (2097152 :: Int) "The maximum length of a valid RLP encoded transaction bytestring (default is 2 MiB)"
```

This creates a `flags_txSizeLimit` variable with a default value of 2,097,152
bytes (2 MiB) that can be overridden at node startup.

### Network Consensus Vulnerability

Since this is a command-line flag, different nodes can start with different
transaction size limits:

```bash
# Node A starts with default 2MB limit
./strato

# Node B starts with 4MB limit
./strato --txSizeLimit=4194304

# Node C starts with 1MB limit
./strato --txSizeLimit=1048576
```

This configuration flexibility creates a critical consensus vulnerability where
nodes may disagree on transaction validity.

### Three Enforcement Points

The transaction size limit is enforced at three different stages in the
transaction lifecycle:

#### 1. API Layer - Transaction Submission
- **Location**: `strato/api/core/src/Handlers/Transaction.hs:207-209`
- **When**: When transactions are submitted via REST API
- **Purpose**: Reject oversized transactions before they enter the system
- **Action**: Throws `TxSizeError` if transaction exceeds limit

#### 2. Transaction Pool Validation
- **Location**: `strato/core/vm-tools/src/Blockchain/Bagger.hs:497-499`
- **When**: When transactions enter the mempool/transaction pool
- **Purpose**: Validate transactions before they can be included in blocks
- **Action**: Throws `TXSizeLimitExceeded` rejection

#### 3. Block Processing/Execution
- **Location**: `strato/core/vm-runner/src/Blockchain/BlockChain.hs:403-405`
- **When**: During block validation and transaction execution
- **Purpose**: Final validation when processing transactions in blocks
- **Action**: Throws `TFTXSizeLimitExceeded` failure

The transaction size is calculated as the RLP-encoded binary representation of
the entire transaction, including all fields (nonce, gas limit, addresses,
function names, arguments, network identifier, and signature components).

### Genesis Block Exception

Genesis blocks are not subject to transaction size validation. Smart contracts
deployed in the genesis block are stored as pre-initialized account and code
information rather than transactions, bypassing all three validation points
above. This is why adding oversized smart contracts to the genesis block works
as a temporary workaround - they avoid transaction size limits entirely by being
initialized directly in the blockchain state rather than processed as
transactions.

## Proposed Solution

### On-Chain Parameter Contract

A smart contract will be deployed to manage blockchain parameters, specifically
transaction size limits. This contract will be **admin-owned** (specific admin 
mechanism to be clarified later) and will emit a `TransactionSizeLimitChanged`
event whenever the limit is updated.

The contract will be deployed as part of the **genesis block** to ensure it's 
available from block zero. During genesis initialization, the contract 
constructor will emit an initial `TransactionSizeLimitChanged` event with the 
default transaction size limit value, establishing the baseline configuration 
for the network.

### Event Processing Pipeline

All VM events are automatically pushed to Kafka and consumed from the "vmevents"
topic as `VMEvent` messages. The system will:

1. **Event Source**: Monitor `VMEvent.NewAction` messages which contain
   `Action._events :: S.Seq Event`
2. **Event Identification**: Use `Model.Event` text fields to identify events
   from the transaction parameters contract
3. **Contract Information**: The contract name and event signature will be
   statically known at compile time (configuration to be refined later)

### Multi-Service Architecture Challenge

The three validation services operate as independent processes that cannot share
in-memory state (IORef/TVar):

1. **STRATO API Server** (`strato/api/core`): Handles REST API transaction
   submissions
2. **VM Tools/Bagger** (`strato/core/vm-tools`): Manages transaction pool
   validation
3. **VM Runner/Block Processor** (`strato/core/vm-runner`): Processes
   transactions during block execution

Each service needs access to the current transaction size limit but operates in
separate process boundaries.

### Shared State Options

Two approaches were considered for sharing the current transaction size limit:

#### Option 1: Cirrus Events Table
Reading from the PostgreSQL events table would be slow and overkill, especially
since transaction size limits change infrequently. Database queries for every
transaction validation would create unnecessary performance overhead.

#### Option 2: Redis Cache (Recommended)
Redis is already used throughout STRATO as shared infrastructure for blockchain
data caching. All three validation services already access Redis for block
information, sync status, and validator data. This makes Redis the natural
choice for storing the current transaction size limit.

### Redis Implementation Approach

The transaction size limit will be stored in Redis using the existing
`RedisBlockDB` infrastructure. A new namespace or reuse of existing namespaces
will be determined during implementation. Each validation service can retrieve
the current limit with:

```haskell
getCurrentTxSizeLimit :: (HasRedisBlockDB m) => m Int
getCurrentTxSizeLimit = do
  mLimit <- RBDB.withRedisBlockDB getTransactionSizeLimit
  case mLimit of
    Just limit -> return limit
    Nothing -> do
      logWarn "Using default transaction size limit - Redis cache may not be populated yet"
      return defaultTxSizeLimit
```

#### Default Value Fallback

The `defaultTxSizeLimit` fallback is necessary to handle edge cases during node startup. Although the genesis block will emit an initial `TransactionSizeLimitChanged` event, there may be a brief window during genesis processing where:

1. The node has started accepting transactions to the mempool
2. The genesis event has not yet been processed and cached in Redis

This situation should be rare under normal operation. When the system falls back to the default value, it logs a **warning message** as an indicator that the event processing pipeline may not be functioning correctly or that there's an unexpected timing issue during startup.

This leverages existing patterns and ensures all services have fast, consistent access to the current transaction size limit while providing graceful degradation during edge cases.

## Open Questions

### Event Processing Race Condition During Startup

There's a potential race condition during startup where the mempool might accept transactions before the genesis `TransactionSizeLimitChanged` event is processed and cached in Redis. The current design mentions logging a warning and falling back to the default limit, but should we also consider rejecting transactions during this window instead of using the fallback? This would be more conservative but could impact system availability during brief startup periods.

### Network Coordination During Limit Changes

While this design solves the consensus issue, there's still a coordination challenge when the transaction size limit is increased. Nodes that haven't yet processed the limit change event will reject larger transactions from their API/mempool layers, even though the new limit is valid network-wide. Should there be a grace period, staged rollout mechanism, or other coordination strategy to handle this transition period?

### Contract Extensibility for Future Parameters

Should the parameter contract be designed to support adding new configurable blockchain parameters in the future (gas limits, block sizes, etc.), or should it remain focused only on transaction size limits? A more extensible design could provide a foundation for other governance needs but adds complexity to the initial implementation.

### Redis Dependency vs LevelDB Alternative

Should we continue to rely on Redis for caching the transaction size limit, or explore reading directly from LevelDB which the VM is already writing to? There are concerns about increasing Redis dependency given past challenges with its integration in the codebase. Reading from LevelDB could reduce external dependencies but may have different performance characteristics and require additional implementation work to ensure consistency across the three validation services.
