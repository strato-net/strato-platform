{-# LANGUAGE TemplateHaskell #-}

module Blockchain.VMOptions
  ( flags_debug,
    flags_trace,
    flags_svmTrace,
    flags_svmDev,
    flags_sqlDiff,
    flags_diffPublish,
    flags_queryBlocks,
    flags_transactionRootVerification,
    flags_startingBlock,
    flags_requireCerts,
    flags_accountNonceLimit,
    flags_txSizeLimit,
    flags_gasLimit,
    flags_creatorForkBlockNumber,
    flags_strictGas,
    flags_strictGasLimit,
  )
where

import Blockchain.Strato.Model.Options
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
defineFlag "queryBlocks" (10000 :: Int) "Number of blocks to query from SQL to process in one batch"
defineFlag "transactionRootVerification" False "Flag to turn transaction root verification or/off"
defineFlag "startingBlock" (-1 :: Integer) "block in kafka to start running the VM on"
defineFlag "svmDev" (False :: Bool) "Whether to crash on SolidVM exceptions"
defineFlag "svmTrace" (True :: Bool) "Whether to have verbose logging in SolidVM"
defineFlag "requireCerts" (True :: Bool) "Flag to enable the requirement of a cert to send transactions"
defineFlag "creatorForkBlockNumber" (-1 :: Integer) "The block number at which to use commonName for the creator value instead of organization"
defineFlag "strictGas" (True :: Bool) "Whether to restrict transactions to approximately 2 second gas timeout"
defineFlag "strictGasLimit" (400000 :: Integer) "The maximum amount of gas that can be used for a transaction in strict mode"