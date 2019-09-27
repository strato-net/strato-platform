{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
module Flags where

import           Blockchain.Constants
import           Blockchain.Sequencer.Constants
import           Blockchain.Strato.Model.Address
import           HFlags
import qualified Data.Text as T
import           Prometheus

-- core flags
defineFlag "q:txdedupwindow" (2000 :: Int) "Transaction window to deduplicate any given Tx (i.e., after N transactions have passed, a previously seen Tx can be reemitted)"


-- leveldb related flags
defineFlag "b:depblockdbpath" (dbDir "h" ++ sequencerDependentBlockDBPath) "Where to store/load the dependent block db"
defineFlag "c:depblockcachesize" (0 :: Int) "Cache size of LevelDB for dependent blocks db (in bytes, 0 = 8MB)"
defineFlag "s:syncwrites" False "Whether or not to sync() all dependent block DB writes"

-- kafka-related flags
defineFlag "k:kafkaclientid" defaultKafkaClientId' "KafkaClientId (for runKafkaConfigured)"

defineFlag "kafkaaddress" ("" :: String) "Alternate kafka instance to connect to."

-- blockstanbul related flags
-- TODO(tim): We may need to specify a starting view, or catch up from the network
defineFlag "blockstanbul" (False :: Bool) "Whether to run blockstanbul"
defineFlag "validators" ("[]" :: String) "JSON encoded addresses of validators"
defineFlag "blockstanbul_block_period_ms" (1000 :: Int) "Minimum delay between block creations"
defineFlag "blockstanbul_round_period_s" (10 :: Int)
  "Maximum seconds that one validator will remain the proposer"
defineFlag "blockstanbul_port" (8050:: Int) "The port serving blockstanbul's admin server"
defineFlag "blockstanbul_admins" ("[]" :: String) "JSON encoded addresses of admins. Admins can, for instance, nominate a new validator"
defineFlag "blockstanbul_skip_check" (False :: Bool) "Necessary to prevent consistency checks from stopping\
                                                     \ a new node from joining an existing network"
defineFlag "seq_debug_mode" (True :: Bool) "Whether to run sequencer debug mode"

defineFlag "seq_max_events_per_iter" (500 :: Int) "How many elements to wait for in each sequencer iteration"
defineFlag "seq_max_us_per_iter" (50000 :: Int) "How many μs to spend waiting for elements"


flags :: Vector (T.Text, T.Text) Counter
flags = unsafeRegister
      . vector ("flag_name", "flag_value")
      $ counter $ Info "sequencer_flags" "A pseudo counter recording flags defined for this process"


exportFlagsAsMetrics :: IO ()
exportFlagsAsMetrics = do
  let set :: String -> String -> IO ()
      set name val = withLabel flags (T.pack name, T.pack val) incCounter
  set "txdedupwindow" $ show flags_txdedupwindow
  set "depblockdbpath" flags_depblockdbpath
  set "depblockdbcachesize" $ show flags_depblockcachesize
  set "syncwrites" $ show flags_syncwrites
  set "kafkaclientid" $ show flags_kafkaclientid
  set "kafkaaddress" flags_kafkaaddress
  set "blockstanbul" $ show flags_blockstanbul
  set "validators" flags_validators
  set "blockstanbul_block_period_ms" $ show flags_blockstanbul_block_period_ms
  set "blockstanbul_round_period_s" $ show flags_blockstanbul_round_period_s
  set "blockstanbul_port" $ show flags_blockstanbul_port
  set "blockstanbul_admins" flags_blockstanbul_admins
  set "blockstanbul_skip_check" $ show flags_blockstanbul_skip_check
  set "seq_debug_mode" $ show flags_seq_debug_mode
  set "seq_max_events_per_iter" $ show flags_seq_max_events_per_iter
  set "seq_max_us_per_iter" $ show flags_seq_max_us_per_iter

addSelfAsMetric :: Address -> IO ()
addSelfAsMetric addr = withLabel flags ("nodekey_address", T.pack $ show addr) incCounter
