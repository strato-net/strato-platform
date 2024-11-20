# Changelog

![BlockAppsLogos-DarkBG-Horizontal](https://github.com/blockapps/strato-platform/assets/35979292/9d599918-5b53-4655-9d38-439faea97c60)


All notable changes to STRATO will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


BlockApps engineers - for more context, see [here](https://blockappsdev.slack.com/docs/T0884V9NC/F05HWCRMVJR).

All changes merged to `develop` should be documented in "Unreleased" until the version is finalized
so that they could be properly moved to their respective version's subsection.

## [Unrealeased]
### Added
- Partial support for ipv6

### Changed
- Total difficulty now refers to block number (corresponds to ethVersion now being 63)

### Fixed
- Ethereum-discovery now looks at udp_enable_time instead of enable_time for bonded/available peers 

### Removed
- Removed private chain endpoints

## [12.2] - 10/28/2024 
### Added
- Added block.proposer to SolidVM
- Reintroduced wire cache to strato-p2p to reduce redundant blockstanbul messages sent to the sequencer
- Added pragma solidvm 12.0 and cascading pragma set inclusion logic

### Changed
- Reduced Cirrus table indexing to top-level abstract contracts, or concrete contracts when there are no abstracts in the CC
- Only genesis block contracts and top-level abstract contracts are now indexed by Slipstream
- Set default nonce limit to 4000

### Fixed
- Bugfix in slipstream to support decoding structs
- Foreign keys in cirrus properly updated
- Bugfix in p2p to prevent peers from continuously attempting to connect to offline peers
- Fixed solidvm 11.4 logic in the typechecker, including removing instances of error

### Removed
- Removed gossip fanout in p2p so now we broadcast transactions to all peers instead of attempting probabilistically

## [12.0.0] - 9/23/2024
### Added
- Introduced BlockHeaderV2 constructor to BlockHeader type
- Added support for BlockHeaderV2 fields to eth db and strato-api
- Added BlockHeaderV2 fields to BlockView component in SMD
- Added event array tables to Cirrus
- Added Kafka composable monad
- Added strict gas mode for the Bagger
- Added capability to use `indexed` keyword in event declarations to index fields as primary keys, and indexed@ event tables
- Added pragma solidvm 11.5
- Added foreign keys in cirrus between event tables and contract tables
- Added `<best_sequenced_block>` to reduce the redundant block requests in p2p
- Added strict mode to sequencer that will cause crash on block authentication
- Added `INSTRUMENTATION` flag to see finer-grained memory usage in processes

### Changed
- General cleanup of Kafka-related code
- Bagger will now drop transactions that ran out of gas
- Reduced data sent from vm to slipstream
- Reduced redundant queries written to postgres

### Fixed
- Fixed bagger's more lucrative tx decision logic

### Removed
- Removed Globals from Slipstream
- Removed block Kafka topic
- txr-indexer no longer indexes events relating to chains, certificates (registered or revoked), or validators (added or removed)


## [11.4.0] - 8/15/2024
### Added
- CodePtr transactions can be made
- RawTransaction now stores CodePtr information
- Added `pragma safeExternalCalls` for contracts that want to enforce extra type safety on external calls from other contracts
- Added `pragma solidvm 11.4` that includes all existing pragmas and their features
- Added decimal precision strictness to `pragma solidvm 11.4`
- Added `truncate(uint)` built-in method for decimal numbers to `pragma solidvm 11.4`
- Added typechecking to emit statements
- Added typechecking to modifier definitions

### Changed

### Fixed
- patched rare race condition where node updates sync status to true before running the last few blocks left in the sync
- patched p2p bug where occassionally, threads erroring out would cause all the threads in p2p to die
- Fixed truncate logic to actually use truncate rather than round

### Removed

## [11.3.1] - 7/10/2024 
### Added

### Changed
- In Slipstream, index arrays in event tables within the event table, otherwise index them in a separate array table.

### Fixed
- try-catch exception handler in solidVM will throw excpetion in all cases instead of potentially `error`ing so node does not crash

### Removed
- Removed strato-api paymentServerUrl flag

## [11.3.0] - 7/2/2024
### Added
- <address>.nonce accessor in SolidVM
- Upgraded PostgREST to version 12.0
- Support for `decimal` numbers type
- Arrays in events are stored as is i.e without tables

### Changed
- Allow public keys to be passed to x509-generator in PEM format
- default `accountNonceLimit` is 2,000
- max kafka bytes returned to 32MB

### Fixed
- fixed logic for how p2p calculates if it is missing parents blocks and needs to backtrack its sync
- `creator` and `root` get populated in collection tables
- validators run block before voting for it

### Removed


## [11.2.1] - 5/16/2024
### Added
- Contract's `root` is available in slipstream tables

### Changed
- hard-coded `creatorForkBlockNumber` for prod network
- unifying block header data definitions throughout platform

### Fixed
- Fixed the way arrays of strings & assets are displayed in slipstream

### Removed
- Removed block_data table from `eth` database


## [11.2.0] - 5/15/2024 
### Added
- POST `/transaction` allows users to create contracts by providing an address through the `codePtr` field
- `creatorForkBlockNumber` flag added to customize at which block :creator field should start referring to the common name and not org
- can access an address's `creator` (uploader of original contract) and `root` (address of original contract) within SolidVM
- `forced-config-change` executable can now update `sequence_number` in addition to `round_number` of sequencer view

### Changed
- Expansion of Concrete contract to Abstract contract is accomodated by Cirrus
- `:creator` field refers to user's common name, not org (can be customized to occur after particular block number for backwards compatibility)
- `eth_<random 20 bytes>` database is now just named `eth`
- `queryStrato` is now `strato-barometer`
- `strato-barometer` commands point to a copy of `./ethereumH` to access LevelDB data

### Fixed
- When a contract is created by a user, that user is the `:creator`. When a contract is created by another contract, `:creator` is the `:creator` of that contract

### Removed
- Removed 'block', 'blockGO', 'canonRedis', 'compressRoundChanges' commands from blockapps-tools
- Removed `certInfo` flag from strato-sequencer (cert is now derived from genesis block or during sync)
- Removed unused flags, such as `brokenRefundRenable`, `cacheTransactionResults`, `faucetEnabled`, `createTransactionResults`, `gasOn`, `splitinit`, and `useSyncMode`
- unused api endpoints: `/version`, `/coinbase`, `/log`, `transactionList`, `/uuid`, `/transaction/raw`, and `/fill`
- `logserver` package (fileserver for strato logs)
- `blockchain` database in postgres (unused)


## [11.1.0] - 3/28/2024

### Added
- Custom `Show` instances for `CodeCollection`, `Function`, `Contract` data types
- Increase gas consumption for contract creation
- `VM_DEBUGGER=bool` flag added for connecting to the VM debugger + static analysis websocket
- Derive service provider URLs from node's network ID for testnet and production nodes
- Update foreign keys for `BlockApps-Mercata-Asset` + `Sale` contracts whenever there is a table expansion
- Functionality to enumerate threads and their details in `/threads` endpoint of `P2PAPI`
- `/peers` endpoint in `P2PAPI` to list peer connections and their health
- POST `/transaction` contract creation calls will now additionally check for address state ref table entry before resolving
- Jenkins test to ensure slipstream post sync is consistent with boot node

### Changed 
- When a transaction fails, the `<failed>` message blinks :^)
- `keccak256` built-in function should return hex-encoded value instead of bytestring
- Optimized the byteString2Integer function that lies at the foundation of strato's RLP-related functionality (rlpDecode).
- Optimized the integer2Bytes function that lies at the foundation of strato's RLP-related functionality (rlpEncode)
- "DAO Fork" for mercata-hydrogen because buggy block got added to canonical blockchain

### Fixed
- Mappings within a struct within a `(type => Struct)` mapping can be accessed
- Constructor arguments are passed by value instead of reference 
- Escaped quotes for slipstream values
- Properly escape `"` and `\` string arguments in `strato-api`
- `sendOutEvent` inconsistenly encoding code pointer hash
- simplified p2p conduit code so that all threads handling a peer live or die together using the `async` library
- Bugfix for slipstream regarding escaping quotes in contract name
- Fixed bug in BlockApps.X509.Certificate that filled in empty orgUnit fields with a space, rather than the empty string
- Fixed bug in Sequencer.hs that prevented nodes from syncing all the way after changes to the validator pool
- Fixed bug in RedisBlockDB that filled in empty orgUnit fields with the word "Nothing", rather than the empty string
- Minimal changes to statetree before all tx checks complete to prevent potential stateroot mismatches between when the bagger adds txs vs when the vm does

### Removed
- Removed slipstream's dependency on `eth` database for code collection data
- Removed unnecessary stateDiff (and threading) in the vm-runner codebase, fixing numerous sources of persistent memory build-up.
- Removed overcomplicated attempts at solving p2p thread issue (watchdogs, canaries, semaphore, threadmap, etc)
- `bloc/v2.2/x509/createCert` is no more


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
