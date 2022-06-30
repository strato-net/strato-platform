{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE TemplateHaskell #-}
import           BlockApps.Init
import           BlockApps.Logging
import           Blockchain.Strato.Indexer.P2PIndexer
import           HFlags

main :: IO ()
main = do
  blockappsInit "strato-p2p-indexer"
  _ <- $initHFlags "Strato P2P Indexer"
  runLoggingT p2pIndexer
