{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Strato.Indexer.ApiIndexer
import           HFlags

main :: IO ()
main = do
  blockappsInit "strato-api-indexer"
  _ <- $initHFlags "Strato API Indexer"
  runLoggingT apiIndexer
