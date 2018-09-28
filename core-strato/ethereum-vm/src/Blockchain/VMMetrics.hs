{-# LANGUAGE TemplateHaskell #-}
module Blockchain.VMMetrics where

import           Prometheus                                as P

vmBlocksProcessed :: P.Metric P.Counter
vmBlocksProcessed = P.unsafeRegisterIO $ counter (P.Info "vm_blocks_processed" "evm counter for blocks processed")

vmBlocksMined:: P.Metric P.Counter
vmBlocksMined = P.unsafeRegisterIO $ counter (P.Info "vm_blocks_mined" "evm counter for blocks mined")

vmBlocksUnmined :: P.Metric P.Counter
vmBlocksUnmined = P.unsafeRegisterIO $ counter (P.Info "vm_blocks_unmined" "evm counter for blocks unmined")

vmBlocksValid :: P.Metric P.Counter
vmBlocksValid = P.unsafeRegisterIO $ counter (P.Info "vm_blocks_valid" "evm counter for blocks valid")

vmBlocksInvalid :: P.Metric P.Counter
vmBlocksInvalid = P.unsafeRegisterIO $ counter (P.Info "vm_blocks_invalid" "evm counter for blocks invalid")

vmTxsSuccessful :: P.Metric P.Counter
vmTxsSuccessful = P.unsafeRegisterIO $ counter (P.Info "vm_txs_successful" "evm counter for txs successful")

vmTxsUnsuccessful :: P.Metric P.Counter
vmTxsUnsuccessful = P.unsafeRegisterIO $ counter (P.Info "vm_txs_unsuccessful" "evm counter for txs unsuccessful")

vmTxsProcessed :: P.Metric P.Counter
vmTxsProcessed = P.unsafeRegisterIO $ counter (P.Info "vm_txs_processed" "evm counter for txs processed")

vmTxsCall :: P.Metric P.Counter
vmTxsCall = P.unsafeRegisterIO $ counter (P.Info "vm_txs_call" "evm counter for txs call")

vmTxsCreation :: P.Metric P.Counter
vmTxsCreation = P.unsafeRegisterIO $ counter (P.Info "vm_txs_creation" "evm counter for txs creation")

vmBlockInsertionMined :: P.Metric P.Gauge
vmBlockInsertionMined = P.unsafeRegisterIO $ gauge (P.Info "vm_block_insertion-mined" "evm gauge for block insertion mined")

vmTxMined :: P.Metric P.Gauge
vmTxMined= P.unsafeRegisterIO $ gauge (P.Info "vm_tx_mined" "evm gauge for tx mined")

vmTxMining :: P.Metric P.Gauge
vmTxMining = P.unsafeRegisterIO $ gauge (P.Info "vm_tx_mining" "evm gauge for transaction mining")
