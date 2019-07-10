{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Control.Monad.Trans.Resource
import Data.String
import HFlags

import BlockApps.Logging
import Blockchain.Init.Worker

defineFlag "K:kafkahost" (""  ::  String) "Kafka hostname"
$(return [])

main :: IO ()
main = do
  _ <- $initHFlags "init-worker"
  let kaddr = case flags_kafkahost of
                  "" -> ("kafka", 9092)
                  _ -> (fromString flags_kafkahost, 9092)
  runResourceT . runLoggingT $ runWorker kaddr
