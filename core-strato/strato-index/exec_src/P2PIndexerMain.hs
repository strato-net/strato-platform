{-# LANGUAGE TemplateHaskell #-}
import           Blockchain.Output
import           Blockchain.Strato.Indexer.P2PIndexer
import           HFlags

main :: IO ()
main = $initHFlags "Strato P2P Indexer" >> runLoggingT p2pIndexer
