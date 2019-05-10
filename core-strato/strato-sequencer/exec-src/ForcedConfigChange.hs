{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import Control.Monad
import HFlags
import System.Exit
import Blockchain.Blockstanbul
import Blockchain.EthConf
import Blockchain.Sequencer.Event
import Blockchain.Sequencer.Kafka
import Network.Kafka.Protocol as KP

defineFlag "round_number" (-1::Integer)
  "Forced PBFT to transition to a specific round.\
  \ When enough nodes die (and violating the PBFT requirements), the round change can\
  \ be unable to sync despite all nodes agreeing on which block is the latest.\
  \ How I've circumvented this in the past is to gradually restart the whole network\
  \ after blocks are able to sync to the fresh nodes, so that all nodes are on round 0.\
  \ This obviously is not ideal, and so this tool provides a way to circumvent the normal\
  \ PBFT controls in case of emergency. This tool is authenticated by being able to write\
  \ to the kafka topic instead of through signatures."

$(return [])

main :: IO ()
main = do
  undef <- $initHFlags "forced-config-change"
  putStrLn $ "Undefined flags: " ++ show undef
  when (flags_round_number >= 0) $ do
    let msg = IEForcedConfigChange
            . ForcedRound $ fromIntegral flags_round_number
    print msg
    resp <- runKafkaConfigured (KP.KString "forced-config-change") $ do
      writeUnseqEvents [msg]
    print resp
    exitSuccess
  die "no config change flags provided"
