# `bloc` v2.0 roadmap

## Introduction

`bloc` is becoming a major, if not the most central, part of the `strato` product, at the least from the user's point of view. Unfortunately it is not as stable as the rest of our product. This is due to a number of factors:

+ Changing scope, it is an evolving product
+ Often the place for "quick solutions" during deadlines
+ Dynamically typed JavaScript - we have no compile-time checks
+ Filesystem-based DB

## Suggested improvements

A lot of the following suggestions would apply to `blockapps-js` and a few of them are borrowed from `cirrus` which has taken some lessons from `bloc` development. There are a couple of scenarios:
+ `bloc` and `blockapps-js` merge
+ `bloc` and `blockapps-js` both get submerged into the haskell codebase
+ They stay separate, but because of versioning, should have stricter rules as dependencies.

The following are suggested improvements to `bloc`. They are mostly independent within each effort level. However, a solution in a higher effort level might supercede a solution in a lower level.  

### Low effort:

+ Update the `tests` to run on commit. This requires a guarenteed up-to-date `strato` instance. This could possibly be set to a local docker instance in `silo` with a fallback to a publicly available server (`strato-dev5`). This is disabled ever since `strato-dev4` failed to be up-to-date (`/solc` incompatibility).
+ Unify `/templates` and `/app` so that we can test against `bloc` as well as after doing `bloc init`. This will give every `bloc` user a test-suite to test against their `strato` instance as well.
+ Include the existing and growing `e2e` tests in the test-suite.
+ Use a stricter `eslint` profile. Currently we give very few errors and mostly warnings. Perhaps we should even have a no-warning policy. We should enforce the same `eslint` profile for `blockapps-js` (see [`blockapps-js#126251063_strict`](https://github.com/blockapps/blockapps-js/tree/126251063_strict)).
+ Dockerize and use `nodemon` by default so that we get a tight compile-test loop (already implemented in `cirrus`)
+ Version the API and make sure it matches `strato-api` and `cirrus`

### Medium effort:

+ Refactor the routes to only use the newer `*list` functions. Write specialized routes replacing the old routes to cover the API spec. (TODO @kejace: write a detailed proposal on what to do here. This will be work in pair with @charles).
+ Replace disk-backend with a proper DB. This requires(?) the dockerization too (already implemented in `cirrus`)
+ Convert to `TypeScript` or enforce `@flow` type annotations. 

### Large effort:

+ Rewrite `bloc` in haskell / ghcjs / purescript. This could but doesn't have to coincide with rewriting `strato-api` using `servant`.

## Interop 

`bloc` is currently depending on multiple pieces of `strato` and it should reliably handshake with these products to ensure interoperability.

### `strato`

Problem: `bloc` makes assumptions on `strato` that it cannot verify

Solution:
+ On startup, and later (regularly) talk to `strato`. Only after verification allow clients to reach `bloc`  after the following has been verified:
 + Version
 + Mining profile
 + Network info

### `cirrus`

We effectively want to hook in calls to `cirrus` on (every?) route. This is a requirment for `cirrus` to work. This is possibly a pattern that we want to generalize: make async calls out to other products (think logging, perhaps auth, etc.). Ultimately we might want to replace this with Kafka. Additions include:

+ `cirrus` should be enabled with a flag
+ `bloc` should handshake with `cirrus` (regularly) and notify the user if it is down

## Future architecture

We should also consider the above proposed work in the light of future features that we want to see `bloc` have:

+ auth
+ kafka integration (already started implementation in `cirrus`)
+ automatic `REST API` generation for Solidity files: `OPTIONS` should essentially resolve to `xabi` for any contract.
+ improved static html generator
+ throttling / capping
+ multichain support
+ LDAP integration