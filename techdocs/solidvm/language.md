# Language Reference

This page lists what SolidVM supports in the current release. Where behavior differs from Solidity, the entry says so and links to [Differences from Solidity](differences.md).

## Source files

A source file can contain:

- `contract`, `abstract contract`, `interface` and `library` definitions
- free functions
- file-level `constant`s, `struct`s, `enum`s and `error`s
- `using L for T;` directives
- user-defined value types (`type Price is uint;`)

Events and non-constant variables must be declared inside a contract.

```solidity
import "../abstract/ERC20/IERC20.sol";
```

On chain, every imported file must be included in the same upload (the JSON list of `[filename, source]` pairs). `solid-vm-cli` reads imports from disk, relative to the directory you run it in.

## Types

| Type | Notes |
|---|---|
| `int`, `uint`, `int8` … `int256`, `uint8` … `uint256` | Arbitrary precision. The size is accepted but not enforced: values never wrap and never overflow. See [Integer range checks](#integer-range-checks). |
| `decimal` | Fixed-point decimal. Supports literals such as `1.5`, `+ - * / %`, comparisons, and `d.truncate(places)`. There is no `fixed` or `ufixed`. |
| `bool` | |
| `string` | Concatenate with `+` or `string.concat(a, b, ...)`. `.length` is available. |
| `bytes`, `bytes1` … `bytes32`, `byte` | `+` concatenates `bytes`. |
| `address`, `address payable` | |
| `T[]`, `T[n]` | `.push(x)` also works on memory arrays. There is no `.pop()`. |
| `mapping(K => V)` | Missing keys read as the zero value. |
| `struct`, `enum` | Declare in a contract or at file level. |
| Contract types | `Token t = Token(addr);` |
| `variadic` | Holds any number of values of any type. Used by `fallback(variadic args)` and by calls by name. |
| `type T is V;` | User-defined value type, replaced by `V` at compile time. |

Unset storage and missing mapping keys read as the zero value: `0`, `false`, an empty string or bytes, `address(0)`, an empty array, or the first enum member.

### Integer range checks

SolidVM integers never wrap. The VM checks one case: storing a negative value in a `uint` **variable**, with plain `=` or in the variable's declaration. That raises `ArithmeticException` ("integer out of bounds: underflow").

Nothing else is checked. `-=`, `--`, `unchecked { }`, writes to array elements, mapping values or struct fields, and intermediate results can all hold negative numbers. See [Integers](differences.md#integers).

### Data location

`memory`, `storage` and `calldata` are accepted. How locals and arguments share data:

- A local assigned from a **storage** array refers to storage, so writing through it changes contract state.
- Assigning a **memory** array to another local copies it.
- Arrays and structs in memory are passed **by reference** to internal functions, so the caller sees the callee's changes. Parameters declared `storage` refer to storage.
- Other contracts receive **copies** of arguments, including storage arrays.

## Conversions

| Expression | Result |
|---|---|
| `uint(x)`, `int(x)`, `uint256(x)`, … | Converts an integer, `decimal` (rounded), enum (its index), `bytes` (big-endian), `address` or `string`. |
| `uint("ff")` | Strings are parsed as **hexadecimal** by default, so this is `255`. `uint("255", 10)` parses base 10. |
| `uint8(300)` | `300`. Sized casts don't truncate. |
| `string(x)` | Converts an integer (base 10), `bool` (`"true"`/`"false"`), `address` (40 hex digits without `0x`) or `bytes` (decoded as UTF-8). |
| `string(i, 16)`, `string(i, 16, n)` | Hex with a `0x` prefix, e.g. `string(255, 16)` is `"0xff"`. With `n`, zero-padded to `n` bytes. |
| `bytes(x)` | Converts a string (UTF-8), an integer or an `address` (20 bytes). |
| `bytes32(x)`, `bytesN(x)` | An integer is masked to N bytes and left-padded. A string or `bytes` value is cut to N bytes. |
| `address(x)` | Converts an integer, hex string, `bytes` or contract. |
| `payable(a)` | `address payable` |
| `bool("true")`, `bool("false")` | `bool` |
| `decimal(x)` | Converts an integer or a string such as `"1.25"`. |
| `MyContract(a)` | Contract reference at address `a` |

## Literals and operators

- Solidity's operators are supported, including `**`, `<<`, `>>`, `>>>` and the compound assignments. Upquark and helium still use an older precedence table; see [Operator precedence](differences.md#operator-precedence).
- Number literals accept scientific notation (`1e18`) and the units `wei`, `szabo`, `finney` and `ether`.
- Hex literals (`hex"00ff"`), and strings in single or double quotes.
- `new C(args)` deploys a contract. `new C{salt: "s"}(args)` deploys it to an address derived from the salt.

## Contracts and functions

Supported:

- multiple inheritance, with `super`
- interfaces, abstract contracts, libraries and `using L for T`
- free functions
- modifiers with arguments
- `virtual` and `override`
- overloading, and named arguments (`f({to: a, amount: 1})`)
- `constant` and `immutable`
- getters for `public` state variables
- `receive`, `fallback`, `view` and `pure`

Calling a `private` or `internal` function from another contract fails.

When a call names a function the contract doesn't define, `fallback(variadic args) external returns (variadic)` runs, and `msg.sig` holds the requested function's name.

### Calling other contracts

```solidity
Target t = new Target();
string memory a = t.greet("x");                          // typed call
string memory b = address(t).call("greet", "strato");    // call by function name
```

- `a.call(name, args...)` calls a function by name and returns its return value directly. It does not return a `(bool, bytes)` pair, and errors in the callee propagate to the caller.
- `a.delegatecall(name, args...)` runs `a`'s code against the calling contract's storage, with `msg.sender` unchanged.
- `a.staticcall(name, args...)` runs the call read-only.
- `create(name, source, args...)` and `create2(salt, name, source, args...)` deploy a contract from source text at run time and return its address.

### Address members

| Member | Returns |
|---|---|
| `a.balance` | Account balance |
| `a.transfer(amount)` | Sends balance to an `address payable`. Raises `PaymentError` on failure. |
| `a.send(amount)` | Like `transfer`, but returns `bool` |
| `a.code` | The contract's source text (not bytecode) |
| `a.codehash` | Hash of the contract's code, as a hex string |
| `a.nonce` | Account nonce |

## Global variables

| Name | Value |
|---|---|
| `block.number` | Block number |
| `block.timestamp`, `now` | Block time in seconds |
| `block.proposer` | Address of the block's proposer (same as `block.coinbase`) |
| `block.chainid` | The network ID: `33056204878082667` on upquark, `114784819836269` on helium. This is **not** the EIP-155 chain ID returned by `eth_chainId`. |
| `block.prevProposer`, `block.prevIntendedProposer`, `block.prevRound` | The parent block's proposer, intended proposer and consensus round. A zero intended proposer means no information, as for blocks before stake-weighted proposer selection. |
| `block.difficulty`, `block.gaslimit` | Block header fields |
| `blockhash(n)` | Hash of block `n` |
| `msg.sender` | Immediate caller |
| `msg.data` | The current function's arguments, as a `variadic` value |
| `msg.sig` | The current function's **name**, for example `"transfer"` |
| `tx.origin` | Transaction signer |
| `this` | Current contract |

`msg.value`, `gasleft()`, `tx.gasprice` and `type(T).max` are not available.

## Builtin functions

### Hashing, signatures and encoding

| Function | Notes |
|---|---|
| `keccak256(b)`, `sha256(b)`, `ripemd160(b)` | Given one `bytes` argument, returns the standard digest as `bytes`. Given anything else, hashes an RLP encoding of the arguments and returns a hex string, which doesn't match Ethereum. For standard results use `keccak256(bytes(s))` or `keccak256(abi.encodePacked(...))`. |
| `ecrecover(hash, v, r, s)` | Signer address, or `address(0)` if recovery fails |
| `verifyP256(hash, r, s, x, y)`, `verifyP256(hash, r, s, publicKey)` | Verifies a P-256 (secp256r1) signature over a 32-byte SHA-256 digest. `publicKey` is 64 or 65 bytes. Returns `bool`. |
| `abi.encode(...)`, `abi.encodePacked(...)` | ABI-encoded `bytes`. `encodePacked` encodes every integer as 32 bytes. |
| `base64encode(x)`, `base64urlencode(x)` | Base64 of a string or `bytes`. The URL-safe variant has no padding. |
| `addmod(a, b, m)`, `mulmod(a, b, m)`, `modExp(base, exponent, modulus)` | Modular arithmetic. `modExp` follows EIP-198: a zero modulus returns 0. |

### Cryptography

These builtins run natively and are charged gas before they run, based on input size. Inputs that must be field elements have to be canonical (less than the field modulus), or the call fails.

| Function | Purpose | Gas |
|---|---|---|
| `ecAdd(x1, y1, x2, y2)`, `ecMul(x, y, s)` | BN254 G1 addition and scalar multiplication, with EIP-196 input checks. Both return `(x, y)`. | 50 and 300 |
| `ecPairing(input)` | BN254 pairing check over 6 integers per pair in EIP-197 order. Rejects G2 points outside the subgroup. Returns `bool`. | 45,000 + 17,000 per pair |
| `poseidon(...)` | Poseidon hash of 1 to 8 BN254 field elements | 100 + 100 per input |
| `poseidon2(...)`, `poseidon2Compress(l, r)` | Poseidon2 over BN254 with gnark-crypto parameters | 100 + 100 per input |
| `poseidon2Permute`, `poseidon2Hash`, `poseidon2HashBytes` | Parametrized Poseidon2. The first argument is a 38-byte parameter block selecting a registered instance: BN254 (t=2) or Goldilocks (t=12). | Per permutation |
| `poseidon2gl(inputs)`, `poseidon2glBytes(data)` | Goldilocks Poseidon2, returning 4 elements | Per permutation |
| `bls12381G1Add`, `bls12381G2Add` | BLS12-381 point addition | 4,000 and 9,000 |
| `bls12381G1Msm`, `bls12381G2Msm` | Multi-scalar multiplication | 2,500 and 9,000 per term |
| `bls12381Pairing` | Pairing check. Returns `bool`. | 50,000 + 20,000 per pair |
| `bls12381MapFpToG1`, `bls12381MapFp2ToG2` | Map a field element to the curve | 5,000 and 20,000 |
| `bls12381HashToCurveG1(msg, dst)`, `bls12381HashToCurveG2(msg, dst)` | Hash to curve | 10,000 and 40,000, + 100 per 32 message bytes |
| `bls12381DecompressG1`, `bls12381DecompressG2` | Point decompression | 5,000 and 20,000 |

The BLS12-381 functions take EIP-2537-encoded `bytes`. The addition, MSM and pairing functions also accept flat integer coordinates.

A Groth16 verification is one four-pair `ecPairing` check (113,000 gas), which fits in a transaction's 400,000 budget. `app/contracts/tests/General/main.groth16.sol` is a Groth16 verifier built on these builtins, and `app/contracts/tests/General/cryptoGas.test.sol` checks the gas ceilings.

### Other builtins

| Function | Notes |
|---|---|
| `require`, `assert`, `revert` | See [Error Handling](errors.md). |
| `log(values...)` | Prints values to the VM's standard output: the terminal under `solid-vm-cli`, vm-runner's output on a node. No on-chain effect. |
| `selfdestruct(recipient)` | Clears the contract's code and storage, and sends its balance to `recipient`. |

## Events

```solidity
event Transfer(address indexed from, address indexed to, uint256 value);

function transfer(address to, uint256 value) public {
    // ...
    emit Transfer(msg.sender, to, value);
}
```

- The event must be declared in the emitting contract or a parent. `emit` must pass one value per parameter; argument types are not checked at `emit`.
- Parameters marked `indexed` become Ethereum-style log topics, after the event-signature topic unless the event is `anonymous`. Block log blooms and JSON-RPC log topics use them; see [JSON-RPC](../reference/json-rpc.md).
- Cirrus records every event with all its arguments, `indexed` or not, in a table named `<creator>-<Contract>-<Event>`. For example, transfers from the platform `Token` contract are in `BlockApps-Token-Transfer`. Array arguments get their own table. Current nodes do not create separate `indexed@` tables. See [Cirrus](../reference/cirrus.md).
