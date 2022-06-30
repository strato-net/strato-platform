{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Strato.Indexer.TxrIndexer
import           HFlags

main :: IO ()
main = do
  blockappsInit "strato-txr-indexer"
  _ <- $initHFlags "Strato TxResults Indexer"
  runLoggingT txrIndexer
