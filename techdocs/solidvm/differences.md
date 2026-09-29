# Differences from Solidity

SolidVM parses most Solidity syntax, but it is a separate implementation with its own semantics. Every behavior on this page was checked against the SolidVM source, and most were reproduced with `solid-vm-cli`.

## Operator precedence

Before release 18.10, SolidVM ranked operators differently from Solidity:

- Assignment bound tighter than `&&` and `||`. `flag = flag || cond;` parsed as `(flag = flag) || cond` and stored only `flag`; `a = x && y;` stored only `x`.
- The ternary bound tighter than `&&` and `||`, so `a || b ? x : y` parsed as `a || (b ? x : y)`.
- Equality bound tighter than `<`, `>`, `<=` and `>=`.
- `**` and assignment associated to the left.

Declarations such as `bool r = a || b;`, `if` and `require` conditions, and parenthesized right-hand sides were always parsed correctly.

18.10 adds Solidity's precedence behind a block-height switch, because re-parsing contracts that are already deployed would break consensus:

| Network | Precedence |
|---|---|
| upquark (mainnet) | Legacy. The switch is not scheduled. |
| helium (testnet) | Legacy. The switch is not scheduled. |
| New networks | Solidity precedence from genesis |

!!! warning "Local tests use the new precedence"
    `solid-vm-cli` and other off-chain tools always parse with Solidity precedence. So a contract can pass its tests locally and still behave differently on upquark or helium. Until the switch is scheduled, add parentheses: write `flag = (flag || cond);`, and don't mix `? :` with `&&` or `||` without parentheses.

## Integers

- All integers are arbitrary precision. Sizes such as `uint8` and `int128` are accepted but not enforced: after `uint8 x = 255; x = x + 1;`, `x` is `256`, and `uint8(300)` is `300`.
- Nothing wraps. The one range check fires when plain `=` or a declaration stores a negative value in a `uint` variable. It raises `ArithmeticException` ("integer out of bounds: underflow").
- Nothing else is checked. `x -= 1`, `x--`, `unchecked { }`, writes to array elements, mapping values and struct fields, and intermediate results can all be negative. For example, `(a - 1) < 0` is `true` when `uint a` is `0`.
- The underflow error **can be caught**, by a bare `catch`, `catch Panic(uint code)` (code 4) or SolidVM's `catch ArithmeticException`. It is **not** caught by `catch Error(string)`, so code that only catches `Error` lets it fail the transaction.

Check before you subtract: `require(a >= b, "...")`.

## Arrays and storage

- **Out-of-range writes to storage arrays don't fail.** `arr[3] = 7` on an empty storage array stores the element but leaves `arr.length` at `0`. Use `push`.
- **Out-of-range reads of storage arrays don't fail either.** They return whatever is stored at that index, which is usually the zero value.
- Memory arrays are bounds-checked: an out-of-range read raises `IndexOutOfBounds`, and an out-of-range write raises `InvalidWrite`.
- **Storage arrays alias.** After `uint[] b = storageArr;`, `b[0] = 9;` writes to `storageArr`. Assigning a memory array makes a copy.
- Memory arrays and structs are passed to internal functions by reference. Other contracts receive copies.
- There is no `pop()`.

## Hashes, encoding and call data

- `keccak256`, `sha256` and `ripemd160` hash a single `bytes` argument the standard way. For any other arguments, such as a string, they hash an RLP encoding and return a hex string. `keccak256("abc")` therefore differs from Ethereum's value; use `keccak256(bytes("abc"))`.
- `abi.encodePacked` encodes every integer as 32 bytes, whatever size it was declared with.
- `abi.encodeWithSelector`, `abi.encodeWithSignature` and `abi.encodeCall` don't exist. `abi.decode(data, (T))` fails typechecking.
- `msg.sig` is the function name (`"transfer"`), not a 4-byte selector. `msg.data` is the argument list as `variadic`, not raw calldata.
- `address.code` returns source text, and `address.codehash` returns a hex string.

## Chain and transaction context

- `block.chainid` is the **network ID**: `33056204878082667` on upquark, `114784819836269` on helium. The EIP-155 chain ID that `eth_chainId` returns, and that wallets use, is different: `0x7030addddcf2` on upquark and `0xb165855668ca` on helium.
- `msg.value`, `gasleft()` and `tx.gasprice` are not available.
- Gas is a fixed work budget of 400,000 per transaction, not a fee. See [Gas and limits](index.md#gas-and-limits).

## Calls

- A typed call dispatches on the target address: `C(addr).f()` runs the code deployed at `addr`.
- `address.call(name, args...)` calls a function by name and returns its return value directly. Errors propagate. There is no `(bool success, bytes data)` result.
- Inside `fallback`, `msg.sig` is the name of the function that was requested. [Proxies](upgrades.md) rely on this.
- The expression after `try` doesn't have to be an external call; internal calls work too.

## Errors and reverts

- `revert("message")` is **not** delivered to `catch Error(string)`. It arrives as `catch Panic(uint code)` with code 33. Only `require` and `assert` failures produce `Error(string)`.
- When a call fails, its state changes are discarded even if the caller catches the error. However, assignments made directly in a SolidVM `try { }` block before the failure are kept.
- A failed transaction still pays its fee and uses its nonce.

Details and the error code table are in [Error Handling](errors.md).

## Unsupported Solidity features

| Feature | Status |
|---|---|
| `msg.value`, `gasleft()`, `tx.gasprice` | Not available |
| `type(T).max`, `type(T).min`, `type(C).creationCode` | Not supported |
| `fixed`, `ufixed` | Not supported. Use `decimal`. |
| Array `.pop()` | Not supported |
| Inline `assembly` | Only the form `x := mload(add(y, 32))` parses. |
| `abi.encodeWithSelector`, `abi.encodeWithSignature`, `abi.encodeCall` | Not available |
| Time units (`1 days`) and `gwei` | Not supported. The only units are `wei`, `szabo`, `finney` and `ether`. |
| Events declared at file level | Not supported. Declare events inside a contract. |
| Custom-error clauses in Solidity-style `try` (`catch MyError(...)`) | Not supported. Use the [SolidVM form](errors.md#solidvm-style-trycatch). |
| Integer sizes and wraparound | Sizes are ignored; see [Integers](#integers). |
