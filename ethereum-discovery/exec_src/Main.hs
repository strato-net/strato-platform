
import Control.Monad.Logger
import qualified Network.Socket as S

import Blockchain.Output
import Executable.EthereumDiscovery

main :: IO ()
main = S.withSocketsDo $ flip runLoggingT printLogMsg ethereumDiscovery
