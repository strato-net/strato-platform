import Control.Monad.Logger

import Blockchain.Output
import Blockchain.Strato.Indexer.Main

main :: IO ()
main = runLoggingT stratoIndex (printLogMsg' True True)
