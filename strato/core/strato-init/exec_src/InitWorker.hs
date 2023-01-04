{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import Data.String
import HFlags

import BlockApps.Logging
import Blockchain.Init.Worker

defineFlag "K:kafkahost" (""  ::  String) "Kafka hostname"
defineFlag "vaultWrapperUrl" ("http://localhost:8013/strato/v2.3" :: String) "The Vault-Wrapper URL"
defineFlag "genesisBlockTestCert" (False :: Bool) "Generate a test X509 Certificate using this node's public key - ideal for test networks"
$(return [])

main :: IO ()
main = do
  _ <- $initHFlags "init-worker"
  let kaddr = case flags_kafkahost of
                  "" -> ("kafka", 9092)
                  _ -> (fromString flags_kafkahost, 9092)
  runLoggingT $ runWorker kaddr
