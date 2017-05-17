{-# LANGUAGE TemplateHaskell #-}

import           Blockchain.Output
import           Blockchain.Strato.Indexer.ApiIndexer
import           Control.Monad.Logger
import           HFlags

main :: IO ()
main = do
  _ <- $initHFlags "Strato API Indexer"
  runLoggingT apiIndexer printLogMsg
