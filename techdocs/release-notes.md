# Release Notes

These notes cover STRATO releases **11.4 through 19.1**. Notes for 11.3 and earlier are on the legacy documentation site, [old-docs.strato.nexus](https://old-docs.strato.nexus).

**Versioning.** Releases are tagged `MAJOR.MINOR[.PATCH]` (for example `18.10` or `16.6.2`). Release candidates are tagged `-rcN` first (for example `19.1-rc0`). The repository's `VERSION` file holds the current version. There is no 13.x. Since 15.x, minor releases ship about once a week.

**The 15.0 gap.** Seven months passed between 14.5.2 (March 24, 2025) and 15.0 (October 31, 2025). During that time the DeFi application (lending, CDP/USDST, swap pools, bridge, rewards) was built into the repository, and the core platform was reworked around it.

**Repository.** The source moved from `github.com/blockapps/strato-platform` to [github.com/strato-net/strato-platform](https://github.com/strato-net/strato-platform) during the 16.5 cycle (March 2026). PR numbers carry over.

Each entry lists only changes that users, developers or node operators can see.

---

## 19.x

### 19.1

_2026-09-15_

!!! warning "Streaming backend: Kafka replaced by JLog"
    The default node now uses an embedded JLog streaming backend instead of a Kafka broker. Snapshots now capture JLog state and are published under a versioned prefix (`<network>/v2/`). Kafka-era (`v1`) snapshots stay at the unversioned root for older builds, so the two never overwrite each other. The Kafka pruning options in `strato-snapshot` are gone. See [Node operations](node/operations.md).

**Changed**

- Kafka replaced by embedded JLog as the default streaming backend, with JLog support in `strato-snapshot` (#7489).

**Added**

- `strato-ps` and `strato-barometer` report the block position of each pipeline stage. The vm-runner position now updates after every block (#7482).
- v3 pool APYs are included in "best available APY" (#7486). The v3 liquidity monitor adds a cooldown between notifications (#7487).
- Tracking dashboard: wallet and activity breakdown behind the snapshot tiles (#7481).
- Browser tab titles use the form "STRATO | page" (#7499).

### 19.0

_2026-09-10_

**Added**

- HyperEVM (chain 999) support in the bridge relayer, app UI and RPC proxy (#7476), plus oracle configuration for WHYPE and KHYPE.

**Fixed**

- The bridge relayer queries `eth_getLogs` in block windows and no longer ignores RPC errors that come back with HTTP 200.

---

## 18.x

### 18.10

_2026-09-10_

!!! warning "SolidVM operator-precedence fork"
    The SolidVM parser now follows Solidity's operator precedence. Before, assignment bound tighter than `&&`/`||` (so `flag = flag || cond` stored only `flag`), the ternary bound tighter than `&&`/`||`, equality bound tighter than the relational operators, and `**` and assignment were left-associative. Parsing is consensus-visible, so the change is gated by `isOperatorPrecedenceForkActive`. New networks get it from genesis. On **upquark and helium no fork height is scheduled yet**, so they keep the old parsing. See [SolidVM](solidvm/index.md).

**Fixed**

- SolidVM operator precedence (fork-gated, see above).
- The SolidVM typechecker no longer rejects a contract that inherits a modifier referencing a `private` state variable of its base.
- `eth_call` bounds ABI array lengths while decoding (#7472).
- StablePool fixes from an internal audit and better liquidity attribution (#7475). `MercataBridge` gains `cancelAndSweepWithdrawalBatch`.
- `convoke` raises the open-file limit for the processes it launches.

### 18.9

_2026-09-08_

**Added**

- JSON-RPC: real `logsBloom` in new block headers and receipts, receipt logs filled in, `eth_getTransactionByHash`, and 0x-prefixed hashes accepted. `eth_getLogs` hardened (#7463).
- Flash borrow on PoolV3 (#7460).
- CDP view functions so third parties can read CDP state on-chain (#7469).
- `v3LiquidityManager` service that alerts when v3 pool liquidity drifts from the oracle price, plus a script that repositions v3 liquidity around spot (#7450).
- SaveUSDST can be bridged, with clearer messages about withdrawal capacity (#7464, #7466).

**Fixed**

- CSRF: the old session token stays valid briefly while the token rotates (#7465).
- The oracle picks asset addresses per network (#7454).

### 18.7 – 18.8

_2026-09-03_

- A long Redis warmup no longer crashes the node (#7448).
- Robinhood chain production bridge configuration (#7446).
- Apex dependency audit, phase 3 (#7420).
- Fixes to the app's milestone popup and to PostHog analytics (#7444, #7447, #7457, #7458).

### 18.6

_2026-09-01_

**Added**

- YieldVault: a permissionless function to sweep surplus profit (#7407), plus protocol-fee revenue reporting for it (#7426).
- Product landing pages under `/defi` (#7412).

**Fixed**

- Space leak in the `strato-sequencer` Blockstanbul context (#7439).

### 18.5

_2026-08-28_

!!! warning "Staking V2, block rewards and fork heights"
    This release adds Staking V2 (`StratoStakingV2`, `ValidatorRegistryV2`, `FeeRouter`), `BlockHeaderV3` with stake-weighted proposer selection, receipts roots in block headers, and per-block rewards to the proposer through `FeeRouter`. These changes are consensus-visible and gated by fork height:

    | Network | Staking activation, receipts root | Stake events from governance, block-reward receipts |
    |---|---|---|
    | helium | 250,000 | 300,000 |
    | upquark | 1,000,000 | 1,000,000 |

    Other networks run the new rules from genesis. Changes made after the staking fork went into separate V2 contracts. The 18.4 contract versions stay in place so pre-fork blocks replay unchanged (#7433). See [Consensus and staking](platform/consensus.md).

**Added**

- Staking V2 and block rewards. Consensus reads the validator set from the staking contract (#7403, #7410).
- Receipts roots and the light-client RPC methods `strato_getReceiptProof` and `strato_getFinalizedHeader`, plus SolidVM BLS12-381 builtins.
- FlashMint (#7408, #7423).
- v3 pools: 0.01% fee tier; fee tiers are no longer hardcoded (#7402, #7430). Robinhood chain SPY token can be bridged in and out (#7383).

**Changed**

- Faster sync: p2p block download, sequencer replay and SolidVM replay were optimized, and RTS flags are chosen from machine size (#7397, #7409, #7416, #7431).
- A node discards new transactions while it is more than 1,000 blocks behind. Slipstream indexing now counts toward `isSynced`.

**Fixed**

- AlarmClock thread leak in the sequencer round timer (#7427). Non-validators no longer flood ROUNDCHANGE messages.
- Slipstream: higher throughput, a bounded SQL statement cache, and handling of invalid UTF-8 (#7425). Duplicate database index creation prevented (#7428).

### 18.4

_2026-08-20_

**Added**

- NFT support (ERC-721 contracts ported from OpenZeppelin) and NFT-based PoolV3 positions (#7335, #7345).
- A parameterized Poseidon2 builtin in SolidVM (#7385).
- Gold and silver yield vaults (#7384).
- PSM upgrade: mint directly into the savings vault, and redeem in one step (#7375).
- `tracking-bot`, plus a tracking dashboard with an interactive user timeline, map widget and finer link metrics (#7377, #7378, #7381, #7352).
- A CDP liquidation alert on the dashboard (#7367).

**Changed**

- PostHog replaces Lucky Orange for app analytics (#7364).

**Fixed**

- The `strato-p2p` merge channel is bounded, so producers get backpressure (#7391).
- `install_deps.sh` and macOS build fixes (#7360).

### 18.1 – 18.3

_2026-08-11 – 2026-08-13_

- Explore page: a Buy button and recent swaps for each token (#7332). v3 pool prices fall back to the pool price when no oracle is configured (#7340).
- Admin vote UI: server-side pagination, and simulation that matches the call the vote actually sends (#7257).
- One-click follow-up actions after a bridge transfer (#7272).
- Net-balance fixes and npm dependency audits (#7329, #7334).

### 18.0

_2026-08-10_

**Added**

- `strato_*` JSON-RPC methods for simulating and tracing SolidVM transactions (#7284). Stateful functions are supported in `eth_call` and the `debug_*` methods. nginx rate-limits the Bloc simulate endpoint and blocks `strato_*` methods on the public `/rpc` endpoint unless the node is set up with `--publicStratoRpc`.
- BLS12-381 support, BN254 fixes, Poseidon2, and gas metering for the BLS, BN254 and Poseidon builtins (#7321).
- SMD: nested multisig UX (#7323).
- App: v3 pool admin (#7316), a Simulate button on the admin page, and an Explore tab for STRATO tokens.
- YieldVault: opt-in funded accrual.

**Fixed**

- Partially rolled back a HexaLiteral typechecker change (#7327).

---

## 17.x

### 17.9

_2026-08-03_

- Cirrus indexing fixes, including struct arrays (#7313). Deposit wallet selection in the Fund flow fixed (#7310).

### 17.8

_2026-07-31_

!!! warning "`mercata/` renamed to `app/`"
    The DeFi application directory `mercata/` is now `app/` (backend, UI, contracts, services). Update any scripts, paths or build tooling that refer to `mercata/` (#7294).

**Added**

- JSON-RPC: `eth_getBlockReceipts` and `debug_traceBlockByHash`.
- An optional attribution suffix on SolidVM transactions (ERC-8021 style), exposed through the API.
- Apex status returns the validator address list (#7302).

**Changed**

- Snapshot fixes: consumed Kafka logs are pruned before a snapshot, restores announce the Cirrus rebuild step, and restores work across user IDs (#7297, #7303).

**Fixed**

- A SolidVM storage decoder bug (#7293). Trade page refactor (#7299).

### 17.7

_2026-07-28_

**Added**

- PoolV3 concentrated-liquidity pools (Uniswap v3 style), with trade and liquidity UI (#7207).
- Tracking and referral links service, enabled with `TRACKING_ENABLED` (#7277, #7280, #7281).
- A `strato-logrotate` service for node logs (#7255). Health endpoints report the peer count (#7265).
- Email notification when a native-token withdrawal is over the instant threshold and needs Safe multisig approval (#7215).

**Changed**

- JSON-RPC `eth_getBlockByNumber` and `eth_getBlockByHash` follow the Ethereum spec (#7276).
- Cirrus: a new Slipstream storage decoder (#7274); contracts created by other contracts inherit the creator's Cirrus namespace (#7248); apostrophes supported in values (#7256).
- `strato-up` keeps snapshot work on the node's data drive and skips restore for existing nodes (#7251). `make` warns when `~/.local/bin` is not on `PATH` (#7253).

**Fixed**

- p2p reuses one stream environment per connection, which reduces memory (#7273). `forceWipe` stops `ethereum-jsonrpc` before restarting (#7283).

### 17.6

_2026-07-14_

- Better NAT handling in p2p and `ethereum-discover` (#7230).
- `ethereum-jsonrpc` uses a shared HTTP manager, which fixes a file-descriptor leak (#7216).
- SMD bug fixes (#7227).
- App navigation simplified: Borrow, Lending, Safety and Liquidations tabs hidden; Vault moved to Advanced (#7231, #7232).

### 17.5

_2026-07-09_

**Added**

- **Staking Phase 1**: `StratoStaking` and `ValidatorRegistry` contracts (delegation, rewards, unbonding, commission) and a Staking page in the app.
- SaveUSDST vault: funded automatic accrual.

**Fixed**

- `ethereum-jsonrpc` is protected from memory spikes on log queries (#7213). Sequencer memory stays bounded during sync, and Kafka fetches use less memory (#7208).
- SMD 401 errors with OAuth login when the wallet extension is installed (#7204).

### 17.4

_2026-07-01_

**Added**

- **STRATO Wallet** browser extension (`strato-wallet/`), with Ethereum, Base and Linea networks and bridging (#7181).
- SMD rewrite: explorer, dashboard, contract editor, and multisig wallet management (#7141, #7198).
- Vault: generation and storage of MPC key shards (#7184).
- `DirectMintPSM` contract and UI (#6688).
- `eth_call` returns struct values (#7180).
- External wallets can create contracts through their on-chain User wallet.

### 17.3

_2026-06-25_

**Added**

- Node snapshots: `strato-snapshot` tooling built into `strato-up`, with public downloads and reuse of a local snapshot when its sha256 matches (#7109, #7126).
- A more detailed public `/health` (#7085).
- localAuth: first-run admin setup from the CLI and a recovery phrase for users.

**Changed**

- The API and p2p indexers merged into one `strato-indexer` process.
- Streaming backends became pluggable and an embedded JLog backend was added. Kafka stayed the default.
- `minPeers` defaults to 10 (#7099). `strato-api` uses up to 4 cores and starts on machines with fewer (#7110, #7131). App, SMD, PostgREST and docs containers run as the host user; Apex runs as non-root.
- Failed transactions stay in the block, so their fees are still collected.
- Referral and card flows removed from the app (#7137).

**Fixed**

- `convoke`: out-of-memory in log tailing, `convoke.log` getting overwritten, and orphaned process groups at shutdown (#7114, #7130).
- The sequencer commits the correct best sequenced block on restart (#7103). A bagger CodeNotFound fix (#7097). Code-collection encoding for `create`/`create2` (#7150).

### 17.2

_2026-05-31_

**Added**

- Native bridge contracts `StratoNativeBridge` and `StratoNativeCustodyVault`: native deposits and withdrawals, with an instant lane and a Safe-approved lane, plus app UI.
- A sandboxed VM mode (#7063).
- Vault: configurable database connection and a vault password change tool (#7044, #7054).
- Litepaper and tokenomics pages in the docs (#7041, #7065).

**Fixed**

- JSON-RPC `eth_call` can no longer commit VM state and rejects mutating functions (#7066).
- The bridge only routes USDC/USDT to STRATO stablecoins (#7022).

### 17.1

_2026-05-13_

**Changed**

- Redis, Postgres, Kafka and local-auth bind to localhost only.
- Node processes crash on critical Redis write failures instead of continuing silently.
- Apex reads the block number from Redis and returns the node address in its status response (#7024).

**Added**

- USDC yield vault and YieldVault transfers (#7019, #7027).

**Fixed**

- An expired STRATO session no longer falls back to a wallet session (#7016). Read-only RPC proxy calls pass nginx auth (#7002).

### 17.0 – 17.0.1

_2026-05-07 – 2026-05-11_

**Added**

- Wallet-only (MetaMask) use across the app: swap, borrow, vaults, metal buys and bridge (#6940 and follow-ups). The STRATO chain's native currency symbol is USDST (tUSDST on testnets), and Stratoscan is set as its block explorer.
- JSON-RPC: `eth_getLogs` returns real events from Cirrus with server-side topic filtering, and Cirrus event tables gain a `transaction_hash` column. `eth_call` supports auto-generated getters for public state variables and returns proper JSON-RPC errors on revert.
- `strato-patch-app` for replacing app images on a node.
- Carry vaults can compose multiple strategies (#6917).

**Fixed**

- `morphTx` for Ethereum-format transactions (#6918, #6919). Question marks in contract state data are escaped (#6984).
- 17.0.1: external-wallet RPC reads go through the backend proxy (#7000), and a "403 Security validation failed" error is fixed (#7001).

---

## 16.x

### 16.15

_2026-04-21_

**Added**

- MetaMask and STRATO wallet signing through EIP-712, with EIP-2718 transaction versioning (`txVersion`) (#6874).
- The metadata API exposes `evmChainId`.
- DefiLlama adapter (#6870).

**Changed**

- Node address settings consolidated into one `nodeUrl` in `ethconf.yaml`. nginx uses the machine hostname as the canonical URL.
- The metadata endpoint no longer returns `nodePubKey` or `nodeAddress`.
- localAuth login and logout fixed; OAuth consent is accepted automatically.

**Fixed**

- A crash when recovering a public key from an invalid signature. A change to the genesis block Pool contract (#6877).

### 16.13 – 16.14

_2026-04-15 – 2026-04-16_

- Cirrus namespace is enforced: creating a table requires a User contract (#6783).
- A development flow for updating the app on a running node (#6771).
- SolidVM fixes for broader Solidity compatibility: file-level `using` statements, optional mapping type identifiers, `$` in identifiers, and reference-resolution fixes (#6687).

### 16.12

_2026-04-13_

- Cirrus foreign keys replaced by functions (#6749).
- YieldVault rewritten as a carry vault with explicit capital management (#6723).
- A warning before transfers to addresses with no transactions on the network (#6739).
- Stable pool swap-fee and APY fixes (#6745, #6759). Vault API performance improvements (#6721, #6744).

### 16.11

_2026-04-09_

- **Ethereum JSON-RPC is exposed publicly** at `/rpc` on the main node port (#6713). See [JSON-RPC](reference/json-rpc.md).
- ERC-4626 and YieldVault (carry vaults for ETH and wBTC) (#6686, #6693).
- DefiLlama TVL adapter (#6667). USDST/STRATO price history chart and stacked APY in the app.
- A node reports itself out of sync only when it is actually falling behind (#6684).

### 16.10

_2026-04-03_

**Added**

- Ethereum-format (legacy) transactions run through SolidVM. Native-value transfers are treated as USDST ERC-20 transfers, and `eth_getBalance` returns the USDST balance, for MetaMask compatibility. `eth_call` is implemented in vm-runner. Transactions carry a chain ID.
- `--localAuth` mode: Ory Hydra and Kratos bundled on the node.
- A single `--sslDir` flag turns on SSL.
- Support for rebasing tokens such as Aave aTokens (#6621, #6622, #6623). A DefiLlama metrics endpoint for TVL and stablecoins (#6626).

**Removed**

- Faucet code, the `InsertTX` tool and the `vrun` interpreter.

**Fixed**

- SolidVM returns an empty list for empty response values (#6660).

### 16.9 – 16.9.1

_2026-03-25 – 2026-03-26_

- The Ethereum JSON-RPC server is back, behind an on/off flag, with initial MetaMask compatibility.
- SaveUSDST vault (#6559) and rebasing-token support (#6501).
- Container logs are written to the node directory. The nginx port is configurable.
- Larger Postgres shared memory for heavy PostgREST queries (#6580).
- 16.9.1: fixes to rewards season wording and stable-pool incentive APY.

### 16.8

_2026-03-19_

**Changed**

- Node management moved to the `strato-*` CLI: `strato-login`, `strato-up`, `strato-down` and `strato-ps` replace the old start, stop and status scripts. OAuth credentials live in `~/.secrets/strato_credentials.yaml`. See [Install a node](node/install.md).
- `strato-setup` generates `docker-compose.yml` from typed Haskell. `convoke` manages the Docker Compose lifecycle.
- More configuration (`httpPort`, `svmTrace`) moved into `ethconf.yaml`. OAuth and Postgres secrets are read from mounted files.

**Added**

- Multi-token StablePool support in the app, and pause/disable controls for StablePools (#6467, #6511).

### 16.7

_2026-03-16_

- Hot wallet support (#6465). Linea Sepolia (#6480).
- Trading desk view and a redesigned Fund page (#6128, #6468).
- Error handling and token-expiry checks in `strato-auth` (#6484).
- The debugger and fuzzer dependencies were removed from vm-runner (#6476). p2p memory improvements (#6477).
- A load-testing suite (#6393).

### 16.6 – 16.6.2

_2026-03-10 – 2026-03-13_

- MetalForge "Buy Metals" flow for GOLDST and SILVST (#6431).
- Linea bridge support and one-to-many bridge routing (#6454, #6384).
- Legacy GitBook docs removed in favor of these MkDocs docs (#6414).
- `strato-sequencer` bootstraps itself from `genesis.json`. vm-runner no longer writes SQL directly; state changes go to the indexers. A node starts with `isSynced=false` (#6471).
- 16.6.1: fixed a MetaMask connection hang caused by STRATO's oversized chain ID (#6459).

### 16.5

_2026-03-05_

**Removed**

- The `vault-proxy` service. Vault calls go through nginx or the vault client directly.
- The `legacy/` directory, including the old marketplace and the `blockapps-rest` source (#6394). The simulator folder (#6425).

**Changed**

- Runtime flags moved to `ethconf.yaml`. Secrets are read from files instead of command-line flags.
- `convoke` shuts down gracefully on SIGTERM.

**Added**

- SolidVM: `abi.encode`, `abi.encodePacked` and `abi.decode`; a `base64encode` builtin; batch UserOperations in User contracts (#6382).
- A credit card top-up service and flow (#6383).

### 16.4

_2026-03-02_

- SolidVM `verifyP256` builtin (#6344).
- Cirrus indexing no longer needs the `record` keyword (#6062).
- OSS policy docs and license updates (#6372).

### 16.3 – 16.3.1

_2026-02-23 – 2026-02-25_

- The `strato-api` spec moved from Swagger 2.0 to OpenAPI 3.0. New `strato-auth` CLI and shell completions.
- Pause and disable controls for swap pools (#6248). The app returns to the same page after login (#6317).
- 16.3.1: Apex stops using the c-ares curl build, which fixes DNS resolution problems (#6328).

### 16.2

_2026-02-19_

- The local session ends when the Keycloak session expires, which stops repeated refresh errors (#6264).
- App API error messages are sanitized (#6273).
- A parsing fix for the `network` field of raw transactions (#6309).
- The oracle uses DefiLlama instead of LiveCoinWatch (#6288).

### 16.1

_2026-02-12_

!!! warning "helium fork: pass-by-reference"
    Pass-by-reference for memory arrays and structs is gated behind a helium fork at block **33,918** (#6277).

- SolidVM: `memory`, `storage` and `calldata` keywords now have effect on function parameters, `address(bytes32)` casts work, and a zero modulus no longer crashes (#6240).
- Groth16 prover libraries (native, snarkjs and rapidsnark wrappers) and a baby-jubjub curve library. `airlock` can unshield and transfer. New `strato-call` CLI.
- Base chain bridge support (#6166). Token symbols can be up to 12 characters (#6256).
- `NGINX_TRUST_PROXY_CIDRS` lets trusted proxies set `X-Forwarded-For` (#6254).
- The `lithium` network was added for local development.

### 16.0 – 16.0.1

_2026-02-05 – 2026-02-06_

**Added**

- STRATO Vault (#6138).
- `airlock`, a Railgun privacy wallet CLI (#6173). A Poseidon hash builtin.
- SolidVM: `block.chainid`; sized type casts (`uint256(...)`, `bytes32(...)`); per-operation gas charges for arithmetic and string operations (#6143); address/integer conversion; hex literals as bytes; struct literals and file-level structs and enums in API arguments.
- Guest mode: public API endpoints and pages for visitors who are not logged in (#6106, #6139).
- Tokens can be renamed (#6148).

**Fixed**

- A state root mismatch seen on helium (#6186). `CodeCollectionAdded` is emitted only when a code collection is actually new (#6161).

### 15.9 – 15.9.1

_2026-01-29 – 2026-02-02_

- Validators vote for a round change when the proposer hasn't proposed a block (#6131).
- Fixed a bagger crash on low account balance (#6130). Duplicate `CodeCollectionAdded` messages removed (#6152).
- wstETH support (#6126). Collateral config manager (#5950).

### 15.8

_2026-01-26_

- Oracle server updates (#6080). Balance checks count vouchers (#6114).
- LP token price history (#6093). Admin issues are paginated (#6120).

### 15.7

_2026-01-22_

- This technical documentation site (MkDocs) was added (#6105).
- CDP redesign, a new borrow flow with a risk slider, and a new landing and portfolio design (#5891, #5992, #6051).
- Minimum withdrawal of 10 USDST (#6109, #6115). Bridge-in mints more vouchers (#6043).
- Fixed a Slipstream crash in the storage decoder (#6066).

---

## 15.x

### 15.6

_2026-01-15_

- PKCE for OAuth in nginx (#6004).
- Referrals: a referral service and a referral management page.
- Bridge and file server URLs updated (#5993). XAUt oracle (#5958).

### 15.5

_2025-12-30_

- StablePool (stableswap) pools (#5906).
- Node sync-time tracking (#5953).
- More oracle price sources, including sUSDS (#5940, #5945).

### 15.4

_2025-12-23_

- Market-closure logic and weekend price feeds for metals (#5900).
- Testnet label in the app (#5898). The dark theme is passed through to Keycloak (#5909).

### 15.3

_2025-12-18_

**Removed**

- The `--blockstanbul` flag, from both `strato-sequencer` and vm-runner. The non-PBFT consensus path is gone; PBFT is the only mode (#5814, #5849).

**Changed**

- The `strato-api` `/transaction` endpoint can filter by timestamp, and stored timestamps are block times (#5850, #5853).
- Bloc converts string arguments that look like JSON arrays or objects (#5871).

### 15.2

_2025-12-11_

- Dark mode (#5760). Rewards leaderboard (#5766).
- AdminRegistry issues can be dismissed (#5789).
- RPC calls go through the app backend (#5780).
- Slipstream stamps proxies with the implementation's contract name, which fixes typed Cirrus views (#5749).
- Remaining `stratomercata.com` links now point to `strato.nexus` (#5829).

### 15.1 – 15.1.1

_2025-12-04_

- Rewards program: the `Rewards` contract (position and one-time activities), the `rewards-poller` service, and rewards UI (#5722, #5733, #5751).
- App UI v2 (#5670).
- Cirrus history tables gain `valid_from` and `valid_to` columns, with faster history updates.
- Gas-free autosave for Easy Savings (#5694).

### 15.0.1 – 15.0.4

_2025-11-07 – 2025-11-26_

- 15.0.1: fixed nested `super` calls (#5544). Delegatecall events for genesis contracts (#5528). `transaction_sender` added to events (#5512). Network and `svmTrace` flags for the start script (#5543).
- 15.0.3: bridge admin UI for deposits and withdrawals (#5577). Swap price-impact and minimum-received display (#5606). The block timestamp is refreshed when a block is made (#5630). The identity server was removed.
- 15.0.4: nodes accept up to 1 s ping time to Vault (#5695). Rewards program groundwork (#5668).

### 15.0

_2025-10-31_

!!! warning "Breaking platform changes in 15.0"
    - **EVM removed.** SolidVM is the only execution engine.
    - **X.509 certificates removed.** Validators and admins are Ethereum addresses. On-chain identity comes from the genesis `UserRegistry`. The identity provider, marketplace, notification and payment servers were dropped from platform builds.
    - **Code-pointer contract creation (`CodeAtAccount`) removed.** Contracts are upgraded through the Proxy pattern.
    - **New networks.** 15.0 introduces the `helium` testnet and the `upquark` mainnet, with new genesis blocks. Older networks are legacy. See [Networks](platform/networks.md).
    - **Every transaction pays a fee.** vm-runner calls the genesis `Decider` contract before each transaction.

**Added**

- The DeFi application (imported as `mercata/` in June 2025): lending pool, CDP engine minting USDST, swap pools, SafetyModule, TokenFactory, MercataBridge, RewardsChef, price oracle, vouchers, and AdminRegistry governance with on-chain voting. These are deployed as proxied genesis-block contracts.
- Transaction fees collected through the `Decider` contract, paid with a voucher or in USDST. See [Transactions and fees](platform/transactions-and-fees.md).
- Native (non-Docker) node build: the `convoke` process manager, `install_deps.sh`, and an optional Nix build (`NIX=true make`).
- SolidVM: `staticcall`; the `modexp`, `ecAdd`, `ecMul` and `ecPairing` precompiles; checks for unsigned integer underflow; `$` in identifiers; indexed variadic event arguments; a `solid-vm-cli` test runner.
- The STRATO VS Code extension was published, with a debug adapter.
- Cirrus rewritten for upgradeable contracts (contract, record, storage and history tables). The `eth` and `cirrus` databases are separate.
- nginx CSRF protection and CSP and security headers. SMD moved to `/smd`.
- Mempool flush.

**Removed**

- The EVM, X.509 and certificate contracts, `CodeAtAccount`, private transactions, chain IDs in the transaction submission API, the faucet, the account nonce limit, and legacy genesis block formats.
- Cirrus `indexed@` event tables and per-contract `history@` tables. History is now in `history@storage` and `history@mapping`. See [Cirrus](reference/cirrus.md).

---

## 14.x

### 14.5 – 14.5.2

_2025-03-05 – 2025-03-24_

- Marketplace: buy-and-stake flow (#3711), wallet disconnect (#3714), a CATA transfer fix (#3765).
- 14.5.1–14.5.2: WBTC bridge address update and price-fluctuation calculation fixes.

### 14.1 – 14.4

_2025-02-21 – 2025-02-25_

- 14.2: `ethereum-discover` fix (#3750).
- 14.3: Blockstanbul messages are broadcast to all peers (the p2p filter was removed) (#3751).
- 14.1 and 14.4: USDST account and STRATs display fixes, a logo update, and removal of the trending section.

### 14.0

_2025-02-21_

!!! warning "Private chains removed"
    The rest of the private-chain code was removed from the core. The chain databases and `chainId` columns were dropped from Postgres, and the transaction route ignores `chainid`. Private-chain endpoints had already been removed in 12.2.1.

**Added**

- Marketplace lending: USDST is minted on borrow, loans can be partly repaid, the default liquidation ratio is 80%, and WBTCST, ETHST and a GOLDST oracle are supported (#3651, #3672, #3676, #3703, #3736).
- nginx rate limiting (#3710, #3715).
- Apache 2.0 license and license metadata on all packages (#3677, #3688).

**Changed**

- The default Blockstanbul round period is 120 s (#3681; also in 12.4.1).

**Removed**

- `TxrIndexer`, and private-chain support (see above).

---

## 12.x

### 12.4 – 12.4.2

_2024-12-27 – 2025-01-30_

- 12.4: ETHST bridge wallet flow; liquidation ratio on reserves; maximum borrow based on LTV (#3644, #3645, #3652).
- 12.4.1: default Blockstanbul round period changed to 120 s.
- 12.4.2: access-token refresh is retried when it fails. Email removed from the profile.

### 12.3.1 – 12.3.5

_2024-12-06 – 2024-12-26_

- ETH staking and ETHST: an ETH oracle using TWAP, an ETH bridge contract, and `BridgeableTokens.sol` (#3627, #3632, #3633, #3634).
- Staked positions are aggregated (#3620). The oracle container gets a heartbeat health check (#3637).
- Order-details and bridge configuration fixes.

### 12.3

_2024-12-06_

- Marketplace staking: Reserve and Escrow contracts, staking UI, borrowing against staked assets (up to 50%), the CATA reward token and TVL display (#3553, #3583, #3602, #3612).
- Oracle service (#3547).
- Supported pragmas consolidated in the SolidVM code collection (#3532). VS Code extension fixes (#3589).

### 12.2.1 – 12.2.3

_2024-11-11 – 2024-11-19_

**Removed**

- Private-chain endpoints and much of the private-chain code in the sequencer. `blockapps-rest` no longer uses `/chain` endpoints or `chainId` parameters (#3526).
- Total difficulty (a proof-of-work leftover). It now refers to the block number (#3541).

**Added**

- Partial IPv6 support (#3531).

**Fixed**

- `ethereum-discover` checks `udp_enable_time` for bonded and available peers.
- The sequencer checkpoint is written to LevelDB.
- The identity server no longer uses default org logic (#3556).

### 12.2

_2024-10-28_

**Added**

- `block.proposer` in SolidVM (#3453, #3516).
- `pragma solidvm 12.0`; pragmas cascade to include earlier pragma sets.
- The wire cache is back in `strato-p2p`, which cuts duplicate Blockstanbul messages (#3440).

**Changed**

- Slipstream indexes only genesis contracts and top-level abstract contracts (or concrete contracts when a code collection has no abstracts) (#3461).
- The default nonce limit is 4000 (#3503).
- nginx logs the original client IP (#3505).

**Fixed**

- Struct decoding in Slipstream, Cirrus foreign-key updates, and p2p repeatedly reconnecting to offline peers (#3472).
- `solidvm 11.4` typechecker fixes (#3495).

**Removed**

- Gossip fanout (`txGossipFanout`). Transactions are broadcast to all peers (#3508).

### 12.1

_2024-10-16_

- Slipstream foreign-key insert order fixed (#3451). Struct value reassignment fixed.
- Marketplace: STRATS as an asset (#3392), bridging with BlockApps tokens (#3204), checkout confirmation (#3411).

### 12.0

_2024-09-23_

**Added**

- `BlockHeaderV2` block header format, supported in the `eth` database, `strato-api` and SMD.
- The `indexed` keyword on event fields, with `indexed@` Cirrus event tables (#3427, #3432).
- Cirrus event array tables and foreign keys between event and contract tables (#3368, #3412).
- `pragma solidvm 11.5` (#3426).
- A strict gas mode for the bagger. The bagger drops transactions that run out of gas (#3419).
- A strict sequencer mode that crashes on block authentication errors (off by default). An `INSTRUMENTATION` flag for per-process memory metrics.

**Changed**

- The VM sends less data to Slipstream (#3329), and fewer redundant Postgres queries run.

**Removed**

- The block Kafka topic. The transaction-result indexer no longer indexes chain, certificate or validator events.

---

## 11.x

### 11.4.1 – 11.4.2

_2024-08-30_

- Marketplace: the rewards server handles ACH payments (#3363); "Liter" unit for spirits (#3354); redemption shipping address shown to issuers (#3355).

### 11.4

_2024-08-15_

**Added**

- Contracts can be created from a code pointer (`CodePtr` transactions).
- `pragma safeExternalCalls` and `pragma solidvm 11.4`, which adds decimal precision strictness and a `truncate` method for decimals.
- Typechecking of `emit` statements, modifier definitions and `revert` statements (#3246, #3286, #3299).
- Accessing mappings of other contracts (#3297). Functions and state-variable accessors are indexed by type signature (#3220).
- Marketplace: payment options, notification and rewards servers, and email confirmations (#3247, #3266, #3278, #3320).

**Fixed**

- A race where the node reported itself synced before the last blocks had run (#3237).
- p2p threads erroring out could take down all p2p threads.
- `truncate` rounded instead of truncating (#3303).

### 11.3.1

_2024-07-10_

- Slipstream stores arrays inside event tables, or in a separate array table otherwise.
- SolidVM `try`/`catch` always throws an exception instead of possibly crashing the node (#3213).
- The `paymentServerUrl` flag was removed from `strato-api`.
- Marketplace: payment server revamp (Stripe ACH flows, transaction fees) and decimal support in asset contracts (#3196, #3206, #3210).
