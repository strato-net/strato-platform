{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import BlockApps.Logging
import Blockchain.EthConf (runKafkaMConfigured)
import Blockchain.SeedDatabases
import HFlags

main :: IO ()
main = do
  _ <- $initHFlags "seed-genesis"
  runLoggingT $
    runKafkaMConfigured "seed-genesis"
    mkDatabases
