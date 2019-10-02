{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}

import           BlockApps.Init
import           Blockchain.Output
import           Blockchain.Strato.Indexer.ApiIndexer
import           HFlags

import           Executable.IndexerFlags()  -- HFlags

main :: IO ()
main = do
  blockappsInit "strato-api-indexer"
  _ <- $initHFlags "Strato API Indexer"
  runLoggingT apiIndexer
