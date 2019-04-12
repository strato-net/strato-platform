{-# LANGUAGE TemplateHaskell #-}
import           Blockchain.Output
import           Blockchain.Strato.Indexer.TxrIndexer
import           HFlags

main :: IO ()
main = $initHFlags "Strato TxResults Indexer" >> runLoggingT txrIndexer
