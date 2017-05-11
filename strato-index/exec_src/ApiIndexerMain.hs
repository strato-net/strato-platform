import           Control.Monad.Logger

import           Blockchain.Output
import           Blockchain.Strato.Indexer.ApiIndexer

main :: IO ()
main = runLoggingT apiIndexer (printLogMsg' True True)
