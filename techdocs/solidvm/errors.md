# Error Handling

## Raising errors

| Statement | Raises |
|---|---|
| `require(cond)`, `require(cond, "message")` | `Require` |
| `assert(cond)` | `Assert` |
| `revert()`, `revert("message")`, `revert(a, b)` | `RevertError` |
| `revert MyError(args)` | Custom error `MyError`, if `MyError` is declared in the current contract |
| `throw MyError(args)` | Custom error `MyError`, declared in the contract or at file level |

Runtime failures raise their own error types, such as `DivideByZero`, `ArithmeticException` and `TooMuchGas`. See [Error codes](#error-codes).

Declare custom errors at file level or inside a contract:

```solidity
error InsufficientBalance(uint available, uint required);
```

!!! warning "Custom error pitfalls"
    - For a **file-level** `MyError`, `revert MyError(...)` raises a plain `RevertError` and the arguments are lost. Declare the error in the contract, or use `throw MyError(...)`.
    - An argument whose value was never written, such as a missing mapping key or an unset state variable, is dropped from the error, and the later arguments shift one position earlier.

If nothing catches an error, the transaction fails and none of its state changes are kept. It still pays its fee and uses its nonce.

The examples below use this contract:

```solidity
contract Vault {
    mapping(address => uint) public balances;

    function deposit(uint amount) public {
        balances[msg.sender] = balances[msg.sender] + amount;
    }

    function withdraw(uint amount) public {
        uint available = balances[msg.sender];
        if (amount > available) {
            throw InsufficientBalance(available, amount);
        }
        balances[msg.sender] = available - amount;
    }

    function divide(uint a, uint b) public returns (uint) {
        return a / b;
    }
}
```

## Solidity-style try/catch

```solidity
try vault.divide(a, b) returns (uint q) {
    // runs on success
} catch Error(string memory reason) {
    // a require or assert failed
} catch Panic(uint code) {
    // any other error
} catch {
    // anything not handled above
}
```

- The expression after `try` can be any call, including an internal one.
- The only clauses allowed are `Error(string)`, `Panic(uint)` and a bare `catch`. To catch a custom error by name, use the [SolidVM form](#solidvm-style-trycatch).
- `require` and `assert` failures go to `catch Error(string reason)`. `reason` is the `require` message, `"Require Error"` when there is none, or `"Assertion Error"` for `assert`.
- **Every other error goes to `catch Panic(uint code)`.** That includes `revert("message")` (code 33), custom errors (code 34), underflow (code 4) and division by zero (code 12).
- An error that no clause matches keeps propagating.

!!! warning "`revert` is not `Error(string)`"
    `catch Error(string)` doesn't catch `revert("...")`. If the callee reverts with a message, catch it with `catch Panic(uint code)` or a bare `catch`.

## SolidVM-style try/catch

SolidVM also supports a `try` over a block of statements, with catch clauses selected by error type:

```solidity
try {
    vault.withdraw(5);
} catch InsufficientBalance(available, required) {
    // custom error; its arguments are bound in order
}

try {
    uint q = vault.divide(1, 0);
} catch DivideByZero {
    // one error type
} catch {
    // anything else
}
```

- `catch Name { }` catches one error type by name, such as `Require`, `Assert`, `RevertError`, `DivideByZero`, `ArithmeticException`, `IndexOutOfBounds`, `InvalidWrite` or `TooMuchGas`. All names are listed in [Error codes](#error-codes).
- `catch MyError(a, b) { }` catches a custom error and binds its arguments, in order, to the names you give. `MyError` must be declared in the current contract or at file level. Naming an error that is declared in another contract fails to compile.
- `catch { }` catches any error.

!!! warning "Known issue"
    If one `try` block has both a custom-error clause (`catch MyError(x)`) and a bare `catch { }`, the typechecker aborts and the contract doesn't compile. Don't combine the two in the same `try`.

## State after a caught error

- When a function call fails, its state changes are discarded even if the caller catches the error. This applies to internal and external calls, including external calls made inside a SolidVM `try { }` block.
- Assignments made directly inside a SolidVM `try { }` block, before the statement that fails, are **kept**.

Keep `try` blocks to the single call that can fail.

## Error codes

The **Name** column is what you write in SolidVM's `catch Name`, and **Panic code** is the value `catch Panic(uint code)` receives. Error messages, for example in `solid-vm-cli` output, start with the prefix shown.

| Name | Cause | Panic code | Message starts with |
|---|---|---|---|
| `Require` | `require` failed | None (goes to `Error`) | `solidity require failed` |
| `Assert` | `assert` failed | None (goes to `Error`) | `solidity assert failed` |
| `InternalError` | Internal VM error | 1 | `internal error` |
| `TypeError` | Wrong type at run time | 2 | `type error` |
| `InvalidArguments` | Bad arguments to a function or builtin | 3 | `invalid arguments` |
| `ArithmeticException` | Negative value stored in a `uint` variable | 4 | `integer out of bounds` |
| `IndexOutOfBounds` | Memory array, `bytes` or `variadic` read out of range | 4 | `index out of bounds` |
| `TODO` | Feature not implemented | 5 | `Unimplemented feature in SolidVM` |
| `MissingField` | Unknown struct field | 6 | `missing field` |
| `MissingType` | Unknown type, or `emit` of an undeclared event | 7 | `missing type` |
| `ArityMismatch` | Wrong number of values | 9 | `arity mismatch` |
| `UnknownFunction` | No such function, or a `private` or `internal` function called from another contract | 10 | `unknown function` |
| `UnknownVariable` | No such variable | 11 | `unknown variable` |
| `DivideByZero` | Division or modulo by zero | 12 | `divide by zero error` |
| `MissingCodeCollection` | No SolidVM code at the address | 13 | `missing code collection` |
| `InvalidWrite` | Memory array or `bytes` written out of range | 15 | `invalid write` |
| `TooMuchGas` | Out of gas | 18 | `You've run out of gas` |
| `PaymentError` | `transfer` failed | 19 | `There was an error sending` |
| `ParseError` | Source or arguments can't be parsed | 20 | `parse error` |
| `RevertError` | `revert(...)` | 33 | `revert` |
| Custom error's own name | `throw` or `revert` of a custom error | 34 | `custom user error` |
| `DuplicateContract` | Salted contract address already in use | 35 | `duplicate salted contract address` |
