import           Control.Monad.Logger

import           Blockchain.Output
import           Blockchain.Strato.Indexer.P2PIndexer

main :: IO ()
main = runLoggingT p2pIndexer (printLogMsg' True True)
