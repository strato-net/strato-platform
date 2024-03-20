# Changelog

![BlockAppsLogos-DarkBG-Horizontal](https://github.com/blockapps/strato-platform/assets/35979292/9d599918-5b53-4655-9d38-439faea97c60)


All notable changes to STRATO will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


BlockApps engineers - for more context, see [here](https://blockappsdev.slack.com/docs/T0884V9NC/F05HWCRMVJR).

All changes merged to `develop` should be documented in "Unreleased" until the version is finalized
so that they could be properly moved to their respective version's subsection.

## [Unreleased] 

### Added
- functionality to enumerate threads and their details in `/threads` endpoint of `P2PAPI`
- `/peers` endpoint in `P2PAPI` to list peer connections and their health
- POST `/transaction` contract creation calls will now additionally check for address state ref table entry before resolving

### Changed
- Optimized the byteString2Integer function that lies at the foundation of strato's RLP-related functionality (rlpDecode).
- Optimized the integer2Bytes function that lies at the foundation of strato's RLP-related functionality (rlpEncode)

### Fixed
- `sendOutEvent` inconsistenly encoding code pointer hash
- simplified p2p conduit code so that all threads handling a peer live or die together using the `async` library
- Bugfix for slipstream regarding escaping quotes in contract name
- Fixed bug in BlockApps.X509.Certificate that filled in empty orgUnit fields with a space, rather than the empty string
- Fixed bug in Sequencer.hs that prevented nodes from syncing all the way after changes to the validator pool

### Removed
- Removed unnecessary stateDiff (and threading) in the vm-runner codebase, fixing numerous sources of persistent memory build-up.
- Removed overcomplicated attempts at solving p2p thread issue (watchdogs, canaries, semaphore, threadmap, etc)
- `bloc/v2.2/x509/createCert` is no more


## [11.1.0] - 3/7/2023

### Added
- Custom `Show` instances for `CodeCollection`, `Function`, `Contract` data types
- Increase gas consumption for contract creation
- `VM_DEBUGGER=bool` flag added for connecting to the VM debugger + static analysis websocket
- Derive service provider URLs from node's network ID for testnet and production nodes
- Update foreign keys for `BlockApps-Mercata-Asset` + `Sale` contracts whenever there is a table expansion

### Changed 
- When a transaction fails, the `<failed>` message blinks :^)
- `keccak256` built-in function should return hex-encoded value instead of bytestring

### Fixed
- Mappings within a struct within a `(type => Struct)` mapping can be accessed
- Constructor arguments are passed by value instead of reference 
- Escaped quotes for slipstream values
- Properly escape `"` and `\` string arguments in `strato-api`

### Removed
- Removed slipstream's dependency on `eth` database for code collection data

## [11.0.0] - 1/22/2024

### Added
- Debug log flags: `API_DEBUG_LOG`, `SLIPSTREAM_DEBUG_LOG`, `VM_DEBUG_LOG`, `API_DEBUG_LOG`, `FULL_DEBUG_LOG`
- Improved Slipstream logging

### Changed

### Fixed
- Contracts that inherit from abstract contracts at the grandparent+ level are indexed in Cirrus at all levels

### Removed
- NewStatus message type from strato-p2p


## [10.0.0] - 10/31/2023

### Added
- Abstract contract functionality for SolidVM
- Salted contract creations allow for deterministic addresses
- `/transaction/unsigned` endpoint for generating raw transaction inputs
- Bi-directional sync functionality
- Mappings in SolidVM receive their own table in Cirrus
- `/eth/v1.2/identity` endpoint that will call identity server
- UserRegistry and User Contract on the genesis block
- Connection to Cirrus Certificate table added in the API
- Abstract contracts generate Cirrus tables
- Derived contracts are inserted as rows in abstract tables
- Support for imports from addresses in SolidVM
- More lenient P2P disable times to prevent non-validators from being "locked out"
- Proper behavior of virtual, override, and visibility modifiers
- Introduction of `es6` and `strict` pragmas, which enable braced and qualified import syntax, and proper visibility modifier behavior, respectively.
- `address.derive(salt, args)` function which allows SolidVM to derive salted contracts without creating them
- SolidVM built-in `create` and `create2` functions which allows for the explicit creation of contracts within SolidVM contracts
- new `solidvmevents` kafka topic for emitted solidvm events
- `pretty` Makefile command that triggers the `ormolu` code formatter
- `hoogle` Makefile command that generates Haddock documentation and serves through local Hoogle instance
- new built-in accessor functions for arrays
- `develop`, `profile` Makefile commands added
### Changed
- `/compile` and `/transaction` endpoints use SolidVM compiler
- POST `/transaction` calls redirected to the corresponding User contract
- POST `/transaction` contract creation calls redirected to the corresponding User contract
- optimized logic flow in p2p to prevent sync stalls
### Fixed
- Error handle duplicate key violations in `code_ref` table
- Bagger no longer crashes the VM upon encountering a transaction that exceeds the nonce or size limit
- String formatting related errors in `.code` SolidVM tests
- Typechecker test errors that were missing `pragma strict` and failing
- The out-of-scope errors of storage variables for Solidity try/catch statements
- Free function overloading conflict with the import resolver
- Resolved the ghost thread build-up in strato-p2p via hierarchical thread tracking
- Account not found in call stack errors for returning arrays to another contract
### Removed
- `bloc22` database removed
- dependency on relapse library for rlp encoding
