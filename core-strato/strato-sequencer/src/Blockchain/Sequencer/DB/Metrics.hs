module Blockchain.Sequencer.DB.Metrics where

import Prometheus

chainMetrics :: Metric (Vector String Counter)
chainMetrics = unsafeRegisterIO
             . vector "chain_type"
             . counter
             $ Info "privatechain_chain" "Count for private chain chains"

txMetrics :: Metric (Vector String Counter)
txMetrics = unsafeRegisterIO
           . vector "tx_type"
           . counter
           $ Info "privatechain_tx" "Count for private chain transactions"
