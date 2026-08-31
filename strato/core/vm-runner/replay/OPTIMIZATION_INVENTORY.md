# SolidVM optimization inventory

This inventory separates the useful ideas from unsafe, inconclusive, or
workload-specific experiments. Exact state roots are necessary but not a full
semantic oracle, so every retained change still needs integration coverage.

## Retained in the packaged branch

- Stream replay input in bounded chunks. This removes the full-file object
  graph from the apply phase without changing block order or verification.
- Reuse account, storage, code-collection, Merkle-node, reverse-hash, call-plan,
  and name-resolution work across repeated SolidVM calls.
- Stage newly generated content-addressed Merkle nodes per block, read pending
  nodes before durable storage, and publish the nodes with the block-hash root
  only after `verifyBlock` succeeds.
- Batch account-trie changes instead of serially rebuilding the trie for every
  modified address.
- Select the debugger/tracer cold path once and avoid repeated parsing,
  function lookup, argument validation, and scope setup where the AST proves
  that no binding can escape.
- Preserve immediate exceptions and restore call-stack/local-scope state at
  the actual Solidity catch boundary.
- Reopen LevelDB in a second process and walk the final block-hash, account,
  and nested contract-storage tries before accepting a replay row.
- Preserve canonical `RanBlock` events in live ingestion. State-only replay
  suppression is not allowed to silently remove this event from normal use.

## Rejected, reverted, or not sufficient

- Muting INFO logs and terminal-title updates helped noise but was nowhere near
  the target by itself.
- Gas tuple/cell/environment rewrites and broad interpreter
  monomorphization produced regressions or inconclusive confounded runs.
- A sticky `SvmAbort` flag was rejected. It delayed `require`/`assert` exit,
  could keep evaluating loop bodies or arguments, and interacted incorrectly
  with nested try/catch cleanup.
- Treating generated Merkle nodes as RAM-only cache entries was rejected. A
  process could verify against memory while leaving the durable root pointing
  to missing nodes after restart.
- Unbounded retention of every decoded Merkle node and the historical
  preloaded block list caused multi-gigabyte growth and invalidated full-run
  performance conclusions.
- Deferring root writes without a verified atomic node-and-root publication
  discipline produced fast rows but lacked restart-safe durability proof.
- Disabling SQL/index output had only a small isolated speed effect and changes
  observable behavior. It is an operational catch-up mode, not a general VM
  optimization.
- Parallel transaction execution is not the first target for this dataset:
  the window averages only 1.73 transactions per block, and every transaction
  shares the `decide -> payFees -> voucher.burn -> USDST.transfer` path. A
  measured logical read/write DAG is required before building ordered OCC/MVCC.

## Required before a production PR

1. Move process-global caches into the VM context and bound them by memory, not
   only entry count. Include failure, reorg, no-commit, and concurrent-reader
   lifecycle tests.
   *Partially done (strato-net/private#96): every cache is entry-bounded with
   generational eviction, sized from `--vmCacheBudgetMB` using per-entry byte
   estimates (see `Blockchain.VMCacheBudget`). The account/storage read caches
   are still process-global, keyed by state root.*
2. Restore or canonically compare every normal VM/index output when
   `sqlDiff=false`. If indexing is intentionally deferred, put suppression
   behind an explicit non-validator `catchupNoIndex` role with a rebuild path.
3. Add an online reference-versus-candidate semantic transcript: fee and user
   outcomes, gas/refunds, ordered logs/events, call/exception digest, and
   sorted account/storage/code deltas per transaction.
4. Repair and run the broad SolidVM test target, then add focused tests for
   overload validation, raw/delegate calls, exceptions, local scope, exact OOG,
   rollback, restart, and event parity.
5. Freeze one source and executable SHA, obtain two consecutive exact-root
   streamed 20,000-block rows with fresh-process audits, then run the same SHA
   over all 213,493 blocks.

## Longer-term, semantics-preserving directions

- Lower immutable SolidVM functions to a compact typed IR with dense local
  slots while retaining exact gas, call, storage, and exception host operations.
- Parallelize independent per-contract storage-trie construction and Merkle
  branch hashing after ordered transaction execution, then deterministically
  merge content-addressed nodes.
- Pipeline bounded decode, immutable code preparation, sequential execution,
  and durable writes with explicit backpressure and a final durability fence.
- Instrument serial logical read/write sets before considering ordered
  speculative transaction execution; rerun any stale read at commit time.
