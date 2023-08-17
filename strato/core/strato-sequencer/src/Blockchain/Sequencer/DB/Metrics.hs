{-# LANGUAGE OverloadedStrings #-}

module Blockchain.Sequencer.DB.Metrics where

import Data.Text
import Prometheus

chainMetrics :: Vector Text Counter
chainMetrics =
  unsafeRegister
    . vector "chain_type"
    . counter
    $ Info "pc_chain" "Count for private chain chains"

txMetrics :: Vector Text Counter
txMetrics =
  unsafeRegister
    . vector "tx_type"
    . counter
    $ Info "pc_tx" "Count for private chain transactions"

chainBuffer :: Vector Text Gauge
chainBuffer =
  unsafeRegister
    . vector "chain_buffer"
    . gauge
    $ Info "privatechain_buffer" "Size count for each private chain ID"
