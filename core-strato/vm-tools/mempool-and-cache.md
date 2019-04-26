# Bagger - a stateful transaction mempool and mining cache

## Summary

### Motivation and existing pain points

1. Postgres is too slow for our needs. We'd like to use Kafka as much as
   possible throughout the core transactions processing pipeline.

2. Due to a naive implementation of block building and mining, every
   time a new transaction is added to a block thats being mined, we
   have to reprocess EVERY pending transaction. This, of course leads to
   situation where we run N^2+N transactions for every block that we
   mine with N transactions. :(

3. Geth has a mempool and it's really effective for accelerating the
   mining process, as well as mitigating certain classes of DoS attacks.

### Solutions offered by the mempool

1. As a result of the efforts with the sequencer, we already have all
   the groundwork in place to eliminate SQL from all facets of the
   blockchain pipeline. The mempool eliminates the need to store
   transactions in SQL in order to query them later when building the
   block, and eliminates a potentially costly SQL query at the end of
   every VM loop.

2. Now that we have a fast way to keep track of all eligible
   transactions to be mined, we can optimize the mining process to
   only run new incoming transactions on an "incremental" basis. The
   only time we have to re-run ALL pending transactions is if a new 
   chain head comes in, meaning we have to start mining from a new
   stateroot anyway, or if a transaction that we mined incrementally
   earlier gets trumped by another transaction from its original sender
   with the same nonce but a higher gas price. There's no real way to "undo"
   a single transaction at an arbitrary point in the block as it may 
   influence balances/storages/behaviors of later transactions in the
   same block.

3. Upon implementation, we will only need SQL for writing data such
   that the various API layers can access it, which can be offloaded
   to a separate process outside the core pipeline, such as
   `strato-index`.

### Architectural changes

1. Quarry effectively has to be rewritten from the ground-up, as it
   was designed with SQL in mind, and has little carry-over to the 
   mempool model.

2. To avoid having to change a lot of architectural documents, this
   new system will still exist in the Quarry library, however it
   will be known as the Bagger (a nod to the [Bagger 288][1])

3. The introduction of a monadic typeclass that the EVM implementation
   conforms to, effectively a glorified State monad transformer, which
   requires the VM to implement a handful of necessary functions to
   store and retrieve the Bagger state, and execute certain operations 
   against a given StateRoot. These functions enable the Bagger MT to
   add new functionality to the VM, allowing a simple interface to be
   used to work against the mempool and tx result cache.

## Implementation details
For brevity and clarity's sake, the following type aliases may be assumed
throughout this document which are used in the code itself

```haskell
type BS  = BaggerState      -- as definted in Blockchain.Bagger.BaggerState
type TX  = OutputTx         -- a wrapper around a transaction as output by
                            -- the sequencer, which has commonly used data
                            -- such as the transaction's hash and address of
                            -- its sender precomputed for efficiency's sake
type SR  = StateRoot        -- A Merkle-Patricia state root, as used to access
                            -- the blockchain's state.
type GL  = Integer          -- The remaining gas that can be used to execute TXs
                            -- in a given block
type BH  = BlockData        -- A block header (Blockchain.Data.DataDefs.BlockData)
type RAE = RunAttemptError  -- used by to report errors in running certain TXs
                            -- to the Bagger 
```

### MonadBagger minimal complete definition
MonadBagger's minimal complete defintion consists of four functions that
need to be implemented by the VM context to enable it to work.

1. `getBaggerState   :: m BS` - provide access to the Bagger's stateful information so that it may be used

2. `putBaggerState   :: BS -> m ()` - replaces the base monad's BaggerState with a new one.

3. `runFromStateRoot :: SR -> GL -> BH -> [TX] -> m (Either RAE (GL, SR))`
   While this seems like awfully complicated, it's actually not so bad. The arguments can be read as
   "Given a starting stateroot, a gas limit, a block header, and list of transactions, return
   either an error, or a new gas limit and stateroot". We need the ability to run transactions from
   an arbitrary stateroot as we may be running transactions "incrementally" from an intermediate SR,
   or from the SR of an new block that comes in which we deem the parent of the block we are trying to mine.
   Certain opcodes in the EVM require access to the block header of the block they will be in, so we need 
   to provide a temporary BH for the transaction to be able to use. Of course, we want to run some arbitrary
   amount of transactions, so that's the next argument. Lastly, the function either returns an RAE
   which may be something like `CantFindStateRoot` or `GasLimitReached`, which indicates a problem with the
   arguments passed in. Or, in the case of a successful run, a new gas limit (as TXs use gas to execute), and
   a new StateRoot (as TXs change the data the in the Merkle-Patricia DB)

4. `rewardCoinbases :: SR -> Address -> [Address] -> m SR`
   Like `runFromStateRoot`, this modifies the MP state, and thus needs a StateRoot to start from. It then takes
   a single address -- who gets the block reward for mining this block -- and a list of addresses of
   the miners of known uncles (so that they get rewarded for mining uncles), and returns a new SR. This
   is used in the final stage of building blocks, as the reward has to be applied after all transactions to get
   the final stateroot to put in the newly formed BH.

Naturally, functions 1 and 2 are the minimal complete definition for a state monad, and all state monad laws apply
to `getBaggerState` and `putBaggerState`. Functions 3 and 4 enable the Bagger to actually execute VM transactions 
and cache the information necessary for building blocks.

### MonadBagger API
Once the minimal complete definition is met, a monad implementing Bagger has access to the following
three core actions:

1. `addTransactionsToMempool :: [TX] -> m ()`
   As the name suggests, this allows one to tell Bagger to start managing a list of transactions.
   The Bagger will do some precursory culling of transactions which are likely to be unrunnable anyway
   and build up a queue for eventual mining

2. `processNewBestBlock :: SHA -> BH -> m ()`
   This notifies the Bagger that the VM has decided that there is a new blockchain head, and future
   blocks should be built against that. When this is called, the Bagger will automatically cull
   transactions that are found in the new block, and any transactions that can no longer be run.
   We only need the block's hash and its header, as the transactions within it will already have been executed,
   and we can get all information we need about pending TX's eligibility by looking up the accounts of their
   senders from the new StateRoot as encoded in the header. Naturally, this implies that the VM has to have run
   the block and stored its result before calling this function.

3. `makeNewBlock :: m OutputBlock`
   The pièce de résistance of the Bagger, this computes a new complete block to be mined by `strato-adit`, using
   transactions added with `addTransactionsToMempool` without having to use N^2 operations to do so.

### Changes to ethereum-vm's ContextM

1. Adding a `contextBaggerState` to the state record type managed by `ContextM`

2. `getBaggerState` and `putBaggerState` simply allow modifications to the aforementioned field, and
    the State monad law guarantees are inherently derived from the fact that ContextM is itself transformed
    by a StateT.

3. The implementation of `runFromStateRoot` simply wraps ContextM's existing `addTransactions` function
   by setting specified the StateRoot before executing the transactions.

4. Similarly `rewardCoinbases` simply sets the specified SR, applies the mining rewards requested, and
   returns the "final" SR that the newly minted block will have.

5. To avoid a circular module dependency between `ethereum-vm` and `strato-quarry`, the BaggerState record
   also holds a (pure) function that calculates the gas necessary to run a given TX. The `ethereum-vm` process
   should, upon startup, set that record to the function it has implemented (currently named `calculateIntrinsicGas'`
   in `BlockChain.hs`) by using `setCalculateIntrinsicGas`

6. Likewise, upon startup, the EVM should call `processNewBestBlock` with, at the very least, the SHA and BH of
   the genesis block so that the miner has some block header (and thus stateroot), and gas limit to supply to
   `runFromStateRoot` when creating blocks. 

## Nitty-gritty implementation details

1. The Merkle-Patricia database implementation that we have is inherently stateful, thus all before any
   stateroot-related calls, the Bagger will keep a copy of StateRoot that the MPDB was in prior to execution of TXs
   and reset it to that value after. This is mostly motivated by paranoia, but it also keeps the Bagger as
   "transparent" as possible to the VM.

2. The BaggerState maintains two different set of transactions, which are implemented as
   `Map Address (Map Nonce TX))` for optimization purposes. There is a `pending` set, which holds transactions
   that have been added to the mempool, but not yet put into a block, and a `queued` set, which holds transactions
   that are due to be mined in the next block. Two helper functions `promoteTransactions` and `demoteTransactions` 
   move transactions in between these sets.

3. There are only two necessary indicators to determine if a transaction can be included in a block. The last used
   nonce of the sender, and the balance of the sender. If the nonce of a transaction is less than the last used nonce
   of the account that sent it, it's safe to say that this is an old, "stale" transactions that will never get mined.
   Likewise, if the resultant transaction fee is greater than the balance of the account that sent it, they are unable
   to afford it, and thus the transactions cannot be run anyway. There is an argument to be made for retaining TXs that
   are "unaffordable", as there may be a state change later that puts enough funds into the account to run it, however
   it stands to reason that one would not send out a transaction they know they can't afford, and thus there is no
   reasonable expectation of a miner keeping the transaction until they can foot the bill.

4. There is an edge case in which, for the same block, an account may send out multiple transactions with the same
   nonce Since neither of those transactions have been mined yet, they are all equally valid. In order to pick one to be
   mined, the miner looks at the gas price the sender was willing to pay for either transaction. The transaction with
   the highest fee will get included in the block, as it will be more lucrative for the miner.
   There is a possibility that due to network latency and other factors, a "better" transaction will be seen by the
   mempool after a preceding one was incrementally mined. In that scenario, the existing block has to be re-mined from
   scratch, as the two transactions may have different cascading effects on the blockchain.

5. There is a `Map SHA OutputTx` called `seen` in the BaggerState as well. This is to accelerate the process of
   determining whether a transaction that was already executed and cached was "trumped" per #4 by a transaction which
   has yet to be executed. Naively, we'd have to compare every cached transaction to every unran transaction, an O(nm)
   operation -- where `n = cachedTransactions` and `m = unminedTransactions` -- to determine if it was trumped. Because
   Haskell's `Data.Map` is implemented as a binary tree, and trumped transactions get removed from `seen`, this reduces
   the cost of the check to O(n log2 n). "Seen" is a bit of a misnomer, as it doesnt keep track of all transactions that
   were seen, but rather of transactions which are being managed by the pool. 

6. Lastly, there is a `miningCache` field in the `BaggerState` record type. This is used to keep track of what
   transactions were executed in the currently pending block, and which have yet to be.

7. The fields in MiningCache are mostly self explanatory. `bestBlockSHA` and `bestBlockHeader` are the information of
   the block which will be the parent of the block which is currently being mined. `lastExecutedStateRoot` and
   `remainingGas` are used to keep track of the SR and GL of the block as its being built incrementally.
   `lastExecutedTxs` are all the transactions which have been executed and cached, and `promotedTxs` are transactions
   which have yet to be executed and cached. Lastly, `startTimestamp` is a quirk of the fact that the timestamp of a
   block can have an effect on its final state, due to the `TIMESTAMP` opcode in the EVM. This needs to be consistent at
   all times for a block that is being mined.


[1]: https://en.wikipedia.org/wiki/Bagger_288 "Wikipedia - Bagger 288" 
