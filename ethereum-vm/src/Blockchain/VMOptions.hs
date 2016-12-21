{-# LANGUAGE TemplateHaskell #-}

module Blockchain.VMOptions where
import Blockchain.Mining

import HFlags

defineFlag "debug" False "turn debug info on or off"
defineFlag "trace" False "turn trace info on or off"
defineFlag "sqlTrace" False "Flag to insert VM trace in sql, independent of trace flag"
defineFlag "altGenBlock" False "use the alternate stablenet genesis block"
defineFlag "testnet" False "connect to testnet"
defineFlag "createTransactionResults" False "stores transaction results in the SQL DB"
defineFlag "sqlDiff" True "runs sqlDiff and updates account state and storage in SQL DB"
defineFlag "diffPublish" False "publishes all state changes to kafka"
defineFlag "queryBlocks" (10000::Int) "Number of blocks to query from SQL to process in one batch"
defineFlag "miningVerification" True "Flag to turn mining verification or/off"
defineFlag "transactionRootVerification" True "Flag to turn transaction root verification or/off"
defineFlag "startingBlock" (1::Integer) "block in kafka to start running the VM on"
defineEQFlag "miner" [| Instant :: MinerType |] "MINER" "What mining algorithm"
