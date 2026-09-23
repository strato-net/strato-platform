# Testing with solid-vm-cli

`solid-vm-cli` runs SolidVM's parser, typechecker and interpreter on your machine, with no node. The contract test suites in `app/contracts/tests` are run with it.

## Install

Running `make` in the repository root installs `solid-vm-cli` into `~/.local/bin` along with the other STRATO binaries (see [Install](../node/install.md)). To reinstall only the CLI:

```bash
cd strato
stack install solid-vm-fuzzer:exe:solid-vm-cli
```

Rebuild after you pull or switch branches; an old binary runs old VM semantics.

## Commands

```text
solid-vm-cli parse   <files...>    # syntax check
solid-vm-cli compile <files...>    # parse and typecheck
solid-vm-cli analyze <files...>    # compile, then static-analysis warnings
solid-vm-cli test    <files...>    # run test suites
```

- All files named on the command line are compiled together as one code collection.
- Add `json` before the file names to get JSON output, for example `solid-vm-cli test json Counter.test.sol`.
- `test` exits with a non-zero status if any test fails.
- `analyze` warns about issues such as divide-before-multiply, shadowed state variables, uninitialized locals and unsupported pragmas.

Imports are read from disk, relative to the directory you run the command in. The app suites expect to be run from their own directory:

```bash
cd app/contracts/tests/Proxy
solid-vm-cli test Proxy.test.sol
```

To run every app suite from the repository root:

```bash
find app/contracts/tests -name '*.test.sol' -print0 | xargs -0 -I {} sh -c 'echo "{}" && cd "$(dirname "{}")" && solid-vm-cli test "$(basename "{}")"'
```

## Writing tests

A test file is ordinary SolidVM source. Any contract whose name starts with `Describe_` is a test suite. Other contracts are regular code that the tests deploy.

```solidity
contract Counter {
    uint public count;

    event Incremented(address indexed by, uint newCount);

    function increment(uint by) public returns (uint) {
        require(by > 0, "by must be positive");
        count = count + by;
        emit Incremented(msg.sender, count);
        return count;
    }
}

contract Describe_Counter {
    Counter c;

    constructor() {
    }

    function beforeEach() public {
        c = new Counter();
    }

    function it_starts_at_zero() public {
        require(c.count() == 0, "expected 0, got " + string(c.count()));
    }

    function it_increments() public returns (bool) {
        c.increment(2);
        return c.count() == 2;
    }

    function it_rejects_zero() public {
        try c.increment(0) {
            revert("expected increment(0) to fail");
        } catch Error(string reason) {
            require(reason == "by must be positive", "wrong reason: " + reason);
        }
    }

    function property_increment_adds(uint by) public returns (bool) {
        if (by == 0) {
            return true;
        }
        uint before = c.count();
        c.increment(by);
        return c.count() == before + by;
    }

    function it_can_fast_forward() public {
        uint t = block.timestamp;
        fastForward(3600);
        require(block.timestamp >= t + 3600, "time did not advance");
    }
}
```

`solid-vm-cli test Counter.test.sol` prints one pass or fail line per test, such as `Unit test 'rejects zero' succeeded`. It ends with a summary line, `(5 / 5 tests passed)`.

### Conventions

| Item | Rule |
|---|---|
| Suite constructor | Takes no arguments. Each suite is deployed once. |
| Order | Suites run in source order, and so do the tests inside each suite. State carries over from one test to the next. |
| Hooks | `beforeAll()` runs once before the tests; if it fails, the suite's tests don't run. `beforeEach()` and `afterEach()` run around every test, and `afterAll()` runs at the end. |
| Unit tests | Functions whose names start with `it_`. They take no arguments, are `public`, `external` or have no visibility, and return nothing or `bool`. A test fails if it throws or returns `false`. |
| Property tests | Functions whose names start with `property_`. They take at least one argument and are called 100 times with random arguments (random integers are non-negative). They stop at the first failing input. |
| Reporting | `it_rejects_zero` is reported as `Unit test 'rejects zero'`. |

### Test-only builtins

These builtins are accepted only under `solid-vm-cli test`. Anywhere else they fail typechecking.

- `fastForward(seconds)` or `fastForward(seconds, blocks)` advances `block.timestamp` by at least one second, and `block.number` by `blocks` (default 1).
- `setBlockContext(proposer, prevProposer, prevIntendedProposer, prevRound)` sets `block.proposer` and the `block.prev*` values.

### Tips

- There is no console. Put values in failure messages, as in `require(x == 5, "x=" + string(x))`, or print them with `log(...)`.
- To check that a call fails, wrap it in `try`/`catch` as `it_rejects_zero` does. `catch Error(string)` only catches `require` and `assert` failures; see [Error Handling](errors.md).
- To act as a different `msg.sender`, deploy a small contract that forwards calls. The app suites use this one:

    ```solidity
    contract User {
        function do(address a, string f, variadic args) public returns (variadic) {
            variadic result = address(a).call(f, args);
            return result;
        }
    }
    ```

### Differences from a live network

- Tests parse with Solidity operator precedence, which upquark and helium don't use yet. See [Operator precedence](differences.md#operator-precedence).
- Block values such as `block.number`, `block.proposer` and `block.chainid` don't match any real network.
- Tests start from an empty in-memory state without the genesis contracts. The app suites deploy what they need in `beforeAll`, for example `new Mercata()`.

## Editor support

The VS Code extension in `strato-vscode/` (package name `strato-mercata`) runs `solid-vm-cli compile` and `solid-vm-cli analyze` to show diagnostics, and runs `~/.local/bin/solid-vm-cli` for debugging.
