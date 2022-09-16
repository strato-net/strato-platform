-- {-# LANGUAGE OverloadedStrings #-}
-- {-# LANGUAGE TemplateHaskell #-}
-- import Control.Monad
-- import HFlags
-- import System.Exit
-- import Blockchain.Blockstanbul
-- import Blockchain.EthConf
-- import Blockchain.Sequencer.Event
-- import Blockchain.Sequencer.Kafka
-- import Network.Kafka.Protocol as KP

-- defineFlag "isDisableValidator" (False :: Bool) "Whether to disable validator behavior if enabled"

-- $(return [])

-- main :: IO ()
-- main = do
--   undef <- $initHFlags "forced_validator_change"
--   putStrLn $ "Undefined flags: " ++ show undef
--   let msg = IEDisableValidator flags_isDisableValidator
--   print msg
--   resp <- runKafkaConfigured (KP.KString "forced_validator_change") $ do
--     writeUnseqEvents [msg]
--   print resp
--   exitSuccess
