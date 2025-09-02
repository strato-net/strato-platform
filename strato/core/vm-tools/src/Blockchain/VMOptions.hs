{-# LANGUAGE TemplateHaskell #-}

module Blockchain.VMOptions
  ( flags_debug,
    flags_svmTrace,
    flags_svmDev,
    flags_sqlDiff,
    flags_diffPublish,
    flags_txSizeLimit,
    flags_gasLimit,
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
defineFlag "svmDev" (False :: Bool) "Whether to crash on SolidVM exceptions"
defineFlag "svmTrace" (True :: Bool) "Whether to have verbose logging in SolidVM"
defineFlag "strictGas" (True :: Bool) "Whether to restrict transactions to approximately 2 second gas timeout"
defineFlag "strictGasLimit" (400000 :: Integer) "The maximum amount of gas that can be used for a transaction in strict mode"
