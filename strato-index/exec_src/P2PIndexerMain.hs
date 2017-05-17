{-# LANGUAGE TemplateHaskell #-}
import           Blockchain.Output
import           Blockchain.Strato.Indexer.P2PIndexer
import           Control.Monad.Logger
import           HFlags

main :: IO ()
main = $initHFlags "Strato P2P Indexer" >> runLoggingT p2pIndexer printLogMsg
