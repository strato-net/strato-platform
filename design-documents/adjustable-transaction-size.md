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
