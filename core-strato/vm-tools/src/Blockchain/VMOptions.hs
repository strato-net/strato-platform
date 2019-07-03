{-# LANGUAGE TemplateHaskell #-}

module Blockchain.VMOptions (
  flags_difficultyBomb,
  flags_testnet,
  flags_debug,
  flags_trace,
  flags_svmTrace,
  flags_svmDev,
  flags_altGenBlock,
  flags_brokenRefundReenable,
  flags_cacheTransactionResults,
  flags_createTransactionResults,
  flags_sqlDiff,
  flags_diffPublish,
  flags_queryBlocks,
  flags_miningVerification,
  flags_transactionRootVerification,
  flags_startingBlock,
  flags_miner,
  ) where

import           Blockchain.Mining

import           Blockchain.CoreFlags
import           HFlags

defineFlag "debug" False "turn debug info on or off"
defineFlag "trace" "none" "Style of tracing. \n\
 \ none|fast|false|<empty> -> No tracing enabled \n\
 \ trace|true -> Geth style tracing \n\
 \ sqlTrace -> Tracing as pipe separated values to be dumped into SQL \n\
 \ evmProfile -> Profile runtimes labeled by opcode, emitted to the log \n\
 \ evmMetrics -> Profile runtimes labeled by opcode, collected by prometheus"
defineFlag "altGenBlock" False "use the alternate stablenet genesis block"
defineFlag "brokenRefundReenable" (False::Bool) "Whether to turn on spec incompatible refunds\
  \ See STRATO-1411 or strato-platform/pull/745 for details"
defineFlag "createTransactionResults" False "stores transaction results in the SQL DB"
defineFlag "sqlDiff" True "runs sqlDiff and updates account state and storage in SQL DB"
defineFlag "diffPublish" False "publishes all state changes to kafka"
defineFlag "queryBlocks" (10000::Int) "Number of blocks to query from SQL to process in one batch"
defineFlag "miningVerification" True "Flag to turn mining verification or/off"
defineFlag "transactionRootVerification" False "Flag to turn transaction root verification or/off"
defineFlag "startingBlock" (-1::Integer) "block in kafka to start running the VM on"
defineFlag "svmDev" (False::Bool) "Whether to crash on SolidVM exceptions"
defineFlag "svmTrace" (False::Bool) "Whether to have verbose logging in SolidVM"
defineFlag "cacheTransactionResults" True "Keep transaction results in an LRU cache to avoid reruns"
defineEQFlag "miner" [| Instant :: MinerType |] "MINER" "What mining algorithm"
