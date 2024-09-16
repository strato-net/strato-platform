{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Logging
import Blockchain.Init.Generator
import Blockchain.Init.Options
import Blockchain.Strato.Model.Options ()
import Control.Monad.Composable.Kafka
import Data.String
import HFlags

main :: IO ()
main = do
  _ <- $initHFlags "strato-setup"
  let kaddr = case flags_kafkahost of
        "" -> ("kafka", 9092)
        _ -> (fromString flags_kafkahost, 9092)

  runLoggingT $
    runKafkaM "generator" kaddr $
    mkAll flags_genesisBlockName
