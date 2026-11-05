{-# LANGUAGE TemplateHaskell #-}

module Blockchain.VMOptions
  ( flags_debug,
    flags_trace,
    flags_svmTrace,
    flags_svmDev,
    flags_sqlDiff,
    flags_diffPublish,
    flags_disableSqlIndexing,
    flags_disableCirrusIndexing,
    flags_publishAddressState,
    flags_queryBlocks,
  )
where
import HFlags

defineFlag "debug" False "turn debug info on or off"
defineFlag
  "trace"
  "none"
  "Style of tracing. \n\
  \ none|fast|false|<empty> -> No tracing enabled \n\
  \ trace|true -> Geth style tracing \n\
  \ sqlTrace -> Tracing as pipe separated values to be dumped into SQL \n\
  \ evmProfile -> Profile runtimes labeled by opcode, emitted to the log \n\
  \ evmMetrics -> Profile runtimes labeled by opcode, collected by prometheus"
defineFlag "sqlDiff" True "runs sqlDiff and updates account state and storage in SQL DB"
defineFlag "diffPublish" False "publishes all state changes to kafka"
defineFlag "disableSqlIndexing" False "Skip SQL indexing messages; keep blocks and best-block updates for Redis"
defineFlag "disableCirrusIndexing" False "Skip Cirrus indexing messages; keep transaction results"
defineFlag "publishAddressState" True "Where the SQL state mirror is off (sqlDiff=false), publish each block's balance and nonce changes to the indexer in its place, so address_state_ref stays current. --publishAddressState=false for a node that keeps no account state in SQL at all (strato-setup --role=validator)"
defineFlag "queryBlocks" (10000 :: Int) "Number of blocks to query from SQL to process in one batch"
defineFlag "svmDev" (False :: Bool) "Whether to crash on SolidVM exceptions"
defineFlag "svmTrace" (False :: Bool) "Whether to have verbose logging in SolidVM"