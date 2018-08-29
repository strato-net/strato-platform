{-# LANGUAGE TemplateHaskell #-}
module Flags where

import           Blockchain.Constants
import           Blockchain.Sequencer.Constants
import           HFlags

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
defineFlag "blockstanbul_InEvent_port" (8081 :: Int) "The port to serve incoming InEvent Beneficiary messages"
