# SolidVM

SolidVM is the virtual machine that runs smart contracts on STRATO. It executes a dialect of Solidity by interpreting the contract source directly, with no compile-to-bytecode step. Since release 15.0 it is the only execution engine on STRATO; the EVM engine was removed.

SolidVM accepts most Solidity syntax, and the platform's own contracts in `app/contracts` use ordinary `pragma solidity ^0.8.x` headers. The semantics are not identical, though. Read [Differences from Solidity](differences.md) before you port a contract or rely on edge-case behavior.

## How a contract runs

1. A contract-creation transaction carries **source code**, not bytecode. The source is either a single string or a JSON list of `[filename, source]` pairs.
2. The node parses the whole upload into a **code collection**. That is every contract, interface, library, free function, and file-level constant, struct, enum and error in the upload. The code collection is stored under a hash of the source.
3. The typechecker runs. A type error fails the transaction.
4. The named contract's constructor runs.

STRATO's native transaction format calls a function **by name** with a list of argument values, not with ABI-encoded calldata. `address.code` returns the contract's source text. For transaction formats, signing and fees, see [Transactions and Fees](../platform/transactions-and-fees.md).

## Pragmas

The parser accepts any `pragma <name> <value>;` line. None of them change behavior in the current release:

- `pragma solidity ^0.8.30;` is accepted and ignored.
- `pragma solidvm 11.4;`, `11.5` and `12.0` switched on language features in older releases. Every feature is now always on, so these pragmas are accepted and ignored too.
- A contract without a pragma behaves exactly like one with a pragma.

`solid-vm-cli analyze` warns about any pragma other than `solidity` (`Unsupported pragma: solidvm 12.0`). The warning never blocks deployment.

## Gas and limits

- Every transaction gets a fixed budget of **400,000 gas**, whatever `gasLimit` it carries. A node's `gasLimit` setting can lower this cap but not raise it.
- Gas measures interpreter work. Most statements and expressions cost one unit. Arithmetic on large numbers and string concatenation cost more, and the cryptographic builtins have their own prices (see [Cryptography](language.md#cryptography)).
- A transaction that runs out fails with `TooMuchGas`.
- Gas is only a work limit. It is not bought with tokens, and transaction fees are charged separately (see [Transactions and Fees](../platform/transactions-and-fees.md)).

## Block-height switches

Every node must interpret stored source the same way at every height. So changes to how SolidVM parses or executes code are switched on at a block number:

| Change | Release | upquark (mainnet) | helium (testnet) | Other networks |
|---|---|---|---|---|
| Solidity operator precedence ([details](differences.md#operator-precedence)) | 18.10 | Not scheduled (legacy precedence) | Not scheduled (legacy precedence) | From genesis |
| Memory arrays and structs passed by reference to internal functions | 16.1 | Always on | From block 33,918 | Always on |

A few earlier helium-only switches, all below block 33,918, only matter when replaying early testnet history.

## Feature history

| Release | Change |
|---|---|
| 12.0 | `indexed` event parameters |
| 12.2 | `block.proposer` |
| 15.0 | EVM removed. Code can no longer be replaced at an address; use [proxies](upgrades.md). |
| 16.0 | `block.chainid`, sized integer and `bytesN` casts |
| 18.0 | BLS12-381 builtins |
| 18.10 | Solidity operator precedence, behind a block-height switch |

## Tools

- `solid-vm-cli` parses, typechecks, analyzes and tests contracts locally. See [Testing with solid-vm-cli](testing.md).
- The VS Code extension in `strato-vscode/` uses `solid-vm-cli` for diagnostics and debugging.

## In this section

- [Language Reference](language.md): types, conversions, globals, builtins and events
- [Error Handling](errors.md): `require`, `revert`, custom errors, both `try`/`catch` forms and error codes
- [Differences from Solidity](differences.md): semantic differences and unsupported features
- [Upgradeable Contracts](upgrades.md): the `Proxy` pattern
- [Testing with solid-vm-cli](testing.md): the command-line tool and test-suite conventions
