# Upgradeable Contracts

SolidVM can't replace the code at an existing address; that ability was removed in release 15.0. To make a contract upgradeable, deploy it behind a `Proxy`. The proxy keeps the address and the state, and forwards calls to a logic contract that can be swapped out. The platform contracts in `app/contracts` are deployed this way.

## The Proxy contract

`app/contracts/concrete/Proxy/Proxy.sol` (the copy in `strato/core/strato-genesis/resources/contracts/concrete/Proxy/` is identical):

```solidity
contract record Proxy is Ownable {
    address logicContract;

    constructor(address _logicContract, address _initialOwner) Ownable(_initialOwner) {
        logicContract = _logicContract;
    }

    function setLogicContract(address _logicContract) onlyOwner {
        logicContract = _logicContract;
    }

    fallback(variadic args) external returns (variadic) {
        return logicContract.delegatecall(msg.sig, args);
    }
}
```

The `record` keyword after `contract` is accepted and has no effect.

A call to a function that `Proxy` doesn't define runs `fallback`, with `msg.sig` set to the requested function's name. The fallback runs that function on the logic contract with `delegatecall`, so the logic contract's code executes against the proxy's storage and `msg.sender` stays the original caller.

Functions that `Proxy` defines or inherits run on the proxy itself and are not forwarded. These are `setLogicContract` and the `Ownable` functions such as `owner()` and `transferOwnership()`.

## Deploy and call

```solidity
address impl = address(new MyLogic());
MyLogic logic = MyLogic(address(new Proxy(impl, owner)));
logic.doSomething();   // runs MyLogic's code on the proxy's storage
```

A logic contract's constructor runs when the implementation itself is deployed, and it writes to the implementation's storage, not the proxy's. Put setup that belongs in proxy storage into an initializer that can only run once, and call it through the proxy. The platform's `AdminRegistry.initialize(...)` works this way.

Off-chain, `app/contracts/deploy/deployProxy.js` deploys a proxy for an existing implementation (`--impl <address> --owner <address>`), and `app/contracts/deploy/upgrade.js` performs upgrades.

## Upgrade

Deploy the new implementation, then call `setLogicContract` on the proxy:

```solidity
Proxy(address(logic)).setLogicContract(address(new MyLogicV2()));
```

`setLogicContract` is `onlyOwner`. When the caller isn't the owner, the `onlyOwner` modifier in `Ownable` doesn't simply revert. It forwards the call to the owner address as `AdminRegistry.castVoteOnIssue(...)`, so a proxy owned by the platform's `AdminRegistry` is upgraded through that contract's vote.

## Storage rules

SolidVM stores state by **variable name**, not by slot number. That changes the usual proxy rules:

- Declaration order doesn't matter. A new implementation sees an old value only if it declares a variable with the same name.
- Renaming a variable leaves its data behind. If a function becomes a state variable with the same name, the variable starts at zero.
- The proxy's own variables share the namespace: `logicContract` from `Proxy`, and `_owner` from `Ownable`. Don't declare a variable named `logicContract` in a logic contract. A logic contract that inherits `Ownable` uses the proxy's `_owner`, which is the owner passed to the `Proxy` constructor.

## Known limitation

When one contract passes a **storage** array through a proxy's `fallback`, the logic contract currently receives an empty array. Memory arrays, array literals, and arrays in transactions sent directly to the proxy arrive intact. Build a memory array (for example with `push`) and pass that instead.
